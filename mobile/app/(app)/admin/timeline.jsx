import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Switch,
  Modal,
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { PRESETS, rangeFor, labelForRange, todayInTz, shiftDays, deviceTimezone } from '../../../lib/dateRanges';
import { rateFromPct } from '../../../lib/rates';
import { downloadCsv } from '../../../lib/csv';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import DateRangeBar from '../../../components/DateRangeBar';
import CampaignChip from '../../../components/CampaignChip';
import KpiGrid from '../../../components/KpiGrid';
import TabSwitcher from '../../../components/TabSwitcher';
import LiveStatus from '../../../components/LiveStatus';
import CanvasserCard from '../../../components/CanvasserCard';

const ROW_H = 46;
const CELL_W = 40;
const NAME_W = 134;
const SUM_W = 48;

// The endpoint caps ranges (62 days), so this screen doesn't offer "All time"
// and validates custom ranges before querying (the server 400s as a backstop).
const TIMELINE_MAX_DAYS = 62;
// 'All time' is offered again: it swaps the hour/day grid for campaign-to-date totals, the only
// view that shows everyone who has ever worked the campaign — canvassers who left included.
const TIMELINE_PRESETS = PRESETS;

// Sort keys for the canvasser list/grid — mapped to the timeline row fields.
const SORT_OPTIONS = [
  { key: 'surveys', label: 'Surveys' },
  { key: 'knocks', label: 'Knocks' },
  { key: 'connection', label: 'Connection rate' },
  { key: 'hours', label: 'Hours on doors' },
  { key: 'knocksPerHour', label: 'Knocks / hour' },
  { key: 'surveysPerHour', label: 'Surveys / hour' },
];

// Inclusive day count between two YYYY-MM-DD strings (UTC calendar math).
function ymdSpanDays(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

function fmtDay(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
function fmtHour(h) {
  const ampm = h < 12 ? 'a' : 'p';
  return `${((h + 11) % 12) + 1}${ampm}`;
}
// "2026-07-06" → "7/6" — pure string math, no Date/tz involved.
function fmtDayCol(ymd) {
  const [, m, d] = ymd.split('-');
  return `${Number(m)}/${Number(d)}`;
}
function actionLabel(t) {
  if (t === 'survey_submitted') return 'Surveyed';
  if (t === 'lit_dropped') return 'Lit dropped';
  if (t === 'not_home') return 'Not home';
  if (t === 'wrong_address') return 'Wrong addr';
  if (t === 'refused') return 'Refused';
  if (t === 'restricted') return 'Restricted';
  return t;
}
function actionColor(colors, t) {
  return colors.status[t === 'survey_submitted' ? 'surveyed' : t] || colors.textMuted;
}

export default function AdminTimeline() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  // Campaign scoping via the shared CampaignChip (as used by Insights/Map): it
  // restores + persists the active campaign and lets the admin switch inline.
  const [campaign, setCampaign] = useState(undefined);
  // This is a Tabs screen that never unmounts, so also re-sync the active campaign
  // on focus — a per-campaign drill-in (campaign home "See all" saves the active
  // campaign then navigates here) must be reflected even when we were already mounted.
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );

  const cId = campaign?.id ? String(campaign.id) : null;
  const tz = campaign?.timeZone || deviceTimezone();
  const litMode = campaign?.type === 'lit_drop';

  const [metric, setMetric] = useState('knocks');
  const [coordinatorId, setCoordinatorId] = useState(''); // '' = all, 'none' = no coordinator
  const [effortId, setEffortId] = useState('');
  const [live, setLive] = useState(true);
  // Folded-in list tools (from the retired Insights screen).
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('surveys');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [hideInactive, setHideInactive] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  // Range seeded in device tz so the screen loads immediately; refined to the
  // campaign tz once known, until the admin picks a range (canvassers.jsx pattern).
  const [range, setRange] = useState(() => {
    const r = rangeFor('today', null, deviceTimezone());
    return { preset: 'today', from: r.from, to: r.to };
  });
  const rangeTouchedRef = useRef(false);

  // Reset ALL campaign-scoped view state when the resolved campaign changes — this
  // screen never unmounts, so the filters, tools, picked range, and live toggle
  // would otherwise bleed from one campaign into the next.
  const [prevCid, setPrevCid] = useState(cId);
  if (prevCid !== cId) {
    setPrevCid(cId);
    setCoordinatorId('');
    setEffortId('');
    setLive(true);
    setSearch('');
    setSortKey('surveys');
    setHideInactive(false);
    setCompareMode(false);
    setSelectedIds(new Set());
    const r = rangeFor('today', null, tz);
    setRange({ preset: 'today', from: r.from, to: r.to });
    rangeTouchedRef.current = false;
  }

  useEffect(() => {
    if (rangeTouchedRef.current) return;
    const r = rangeFor('today', null, tz);
    setRange({ preset: 'today', from: r.from, to: r.to });
  }, [tz]);
  function onRangeChange(v) {
    rangeTouchedRef.current = true;
    setRange(v);
  }

  // 'today' pins to the CURRENT today so the live poll doesn't silently widen into a
  // 2-day range after campaign-tz midnight. Recomputed every render.
  const today = todayInTz(tz);
  // 'All time' = campaign-to-date. It asks for totals only (no hour/day buckets), which is what
  // lets it escape the 62-day cap: the cap exists to stop the grid growing a column per day, not
  // to limit the aggregation.
  const allTime = range?.preset === 'all';
  const fromDay = range ? (range.preset === 'today' ? today : range.from) : null;
  const effectiveTo = range ? range.to || today : null;
  const isSingleDay = !allTime && !!range && fromDay === effectiveTo;
  const includesToday = allTime || (!!range && (!range.to || range.to >= today));
  // Bad custom ranges (no start, inverted, > cap) get a notice instead of a query —
  // otherwise the 20s live poll would retry the server's 400 forever. All-time is unbounded on
  // purpose, so none of that applies to it.
  const rangeInvalid =
    !allTime &&
    !!range && (!fromDay || fromDay > effectiveTo || ymdSpanDays(fromDay, effectiveTo) > TIMELINE_MAX_DAYS);

  function stepDay(n) {
    const next = shiftDays(fromDay, n);
    onRangeChange({ preset: 'custom', from: next, to: next });
  }

  const q = useQuery({
    queryKey: [
      'admin', 'reports', 'canvasser-timeline', cId, effortId,
      allTime ? 'all' : fromDay, range?.to, coordinatorId,
    ],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('campaignId', cId);
      if (effortId) p.set('effortId', effortId);
      // Team scope goes to the SERVER — a deduped door count can't be derived by filtering rows here.
      if (coordinatorId) p.set('coordinatorId', coordinatorId);
      if (allTime) {
        p.set('totals', '1'); // no bounds at all — the server reads that as the whole ledger
      } else {
        p.set('from', fromDay);
        if (range?.to) p.set('to', range.to); // server defaults a missing `to` to today
      }
      return api(`/admin/reports/canvasser-timeline?${p.toString()}`);
    },
    enabled: !!cId && (allTime || (!!fromDay && !rangeInvalid)),
    refetchInterval: live && includesToday ? 20_000 : false,
    refetchIntervalInBackground: false,
    // Keeps the grid/cards from blanking on every 20s poll and on preset switches.
    placeholderData: keepPreviousData,
    // Hidden Tabs screen (href:null) stays mounted after leaving — pause the
    // poll (and refresh on return) whenever another screen covers it.
    ...useFocusedPoll(20 * 1000),
  });

  // Roster (shared cache with Books): flat rows with role/coordinatorId/coordinatorName.
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
  });
  const assignments = assignmentsQ.data?.assignments || [];

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/efforts`),
    enabled: !!cId,
  });
  const efforts = effortsQ.data?.efforts || [];

  const data = q.data || {};
  const overlaps = data.overlaps || [];
  const isRange = data.mode === 'range';
  // Read the SERVER's mode, not the local `allTime` flag: keepPreviousData means the previous
  // range-shaped payload is still on screen during an all-time fetch, and gating the grid on the
  // local flag would blank it a beat early.
  const isTotals = data.mode === 'totals';

  // The coordinator comes from the LEDGER — the server stamps the team onto each knock when it
  // happens, and returns it on the row. It used to be joined here from the campaign ROSTER, which
  // meant a canvasser taken off the campaign lost their team and their doors fell silently into
  // "No coordinator" — the bucket admins deliberately exclude when reporting a team to a client.
  // (On the live HD54 campaign that under-reported one team by 104 doors.) Do not re-introduce a
  // roster join here; the roster is for deciding who can be ASSIGNED work, not who DID it.
  const rows = data.canvassers || [];

  const coordinatorOptions = useMemo(() => {
    const seen = new Map();
    for (const r of rows) {
      if (r.coordinatorId && !seen.has(r.coordinatorId)) seen.set(r.coordinatorId, r.coordinatorName);
    }
    // Also offer a coordinator whose whole crew hasn't knocked yet (they'd have no ledger rows).
    for (const a of assignments) {
      const cid = a.coordinatorId ? String(a.coordinatorId) : null;
      if (cid && !seen.has(cid)) seen.set(cid, a.coordinatorName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name: name || 'Coordinator' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, assignments]);

  // The team filter is applied SERVER-SIDE (?coordinatorId), so the rows are already scoped. It has
  // to be: the billable door count is deduped by (house, round) ACROSS canvassers, so a team's real
  // figure cannot be produced by filtering and summing rows here.
  const coordRows = rows;

  // Displayed set — hide-inactive + name/email search + sort shape the cards AND the
  // grid (so both agree), while the KPI strip above stays on coordRows.
  const displayRows = useMemo(() => {
    let out = coordRows;
    if (hideInactive) out = out.filter((r) => r.isActive);
    const s = search.trim().toLowerCase();
    if (s) {
      out = out.filter((r) =>
        `${r.firstName || ''} ${r.lastName || ''} ${r.email || ''}`.toLowerCase().includes(s)
      );
    }
    const surveysPerHour = (r) => (r.hoursOnDoors > 0 ? (r.daySurveys || 0) / r.hoursOnDoors : 0);
    return [...out].sort((a, b) => {
      switch (sortKey) {
        case 'knocks':
          return (b.dayKnocks || 0) - (a.dayKnocks || 0);
        case 'connection':
          return (b.connectionRate || 0) - (a.connectionRate || 0);
        case 'hours':
          return (b.hoursOnDoors || 0) - (a.hoursOnDoors || 0);
        case 'knocksPerHour':
          return (b.doorsPerHour || 0) - (a.doorsPerHour || 0);
        case 'surveysPerHour':
          return surveysPerHour(b) - surveysPerHour(a);
        case 'surveys':
        default:
          return (b.daySurveys || 0) - (a.daySurveys || 0) || (b.dayKnocks || 0) - (a.dayKnocks || 0);
      }
    });
  }, [coordRows, hideInactive, search, sortKey]);

  // DOORS is the DEDUPED count, from the server — one house per round, however many people knocked
  // it. It cannot be computed here: summing rows gives the RAW event count, which counts a house two
  // canvassers both worked twice. (Web had the same flaw: its Doors card showed 1,255 while the
  // campaign Home tab showed 1,252.) The raw figure still lives in the reconciliation line below.
  const kpis = useMemo(() => {
    const doors = data.billableKnocks ?? 0;
    let surveys = 0;
    let lit = 0;
    let hours = 0;
    let rawDoors = 0;
    for (const r of coordRows) {
      rawDoors += r.dayKnocks || 0;
      surveys += r.daySurveys || 0; // survey DOORS — the connection-rate numerator
      lit += r.dayLit || 0;
      hours += r.hoursOnDoors || 0;
    }
    const connPct = doors ? Math.round(((surveys + lit) / doors) * 100) : null;
    // Pace stays raw effort: it's a per-person rate, not a billing figure.
    const doorsPerHour = hours > 0 ? rawDoors / hours : null;
    return { doors, surveys, connPct, doorsPerHour };
  }, [coordRows, data.billableKnocks]);

  // "Knocking N of M": M = the current roster UNION everyone who knocked in the range; N = how
  // many of them actually knocked. The roster alone undercounted both numbers — a canvasser who
  // worked the campaign and then quit is deleted from the roster, so a crew that had turned over
  // read "1 of 1" with four people's work sitting in the cards below. The union keeps N ⊆ M by
  // construction (every knocker is in M), so "5 of 4" still can't happen.
  const rosterIds = useMemo(() => {
    const canvasserRows = assignments.filter((a) => a.role === 'canvasser');
    const scoped = !coordinatorId
      ? canvasserRows
      : coordinatorId === 'none'
        ? canvasserRows.filter((a) => !a.coordinatorId)
        : canvasserRows.filter((a) => String(a.coordinatorId || '') === coordinatorId);
    const ids = new Set(scoped.map((a) => String(a.userId)));
    for (const r of coordRows) ids.add(String(r.userId));
    return ids;
  }, [assignments, coordinatorId, coordRows]);
  // Counts people who actually KNOCKED: a restricted-only row has activity but no knock
  // (restricted is never billable and never in dayKnocks), and the tile says "Knocking".
  const knockingCount = useMemo(
    () => coordRows.filter((r) => (r.dayKnocks || 0) > 0).length,
    [coordRows]
  );

  // Grid columns: hours for a single day, days for a range. Mode-guarded so
  // keepPreviousData transitions (day-shaped data during a range fetch) never crash.
  const columns = useMemo(
    () =>
      isRange
        ? (data.days || []).map((d) => ({ key: d, label: fmtDayCol(d) }))
        : (data.hours || []).map((h) => ({ key: h, label: fmtHour(h) })),
    [isRange, data.days, data.hours]
  );
  const bucketKey = isRange
    ? metric === 'surveys'
      ? 'surveysByDay'
      : 'knocksByDay'
    : metric === 'surveys'
      ? 'surveysByHour'
      : 'knocksByHour';

  let maxCell = 0;
  for (const c of displayRows)
    for (const col of columns) {
      const v = c[bucketKey]?.[col.key] || 0;
      if (v > maxCell) maxCell = v;
    }
  const cellBg = (v) =>
    v && maxCell ? `rgba(59,130,246,${(0.12 + 0.88 * (v / maxCell)).toFixed(3)})` : 'transparent';

  // Column + grand totals from the displayed rows (respects the coordinator filter,
  // hide-inactive, and search so the grid footer matches what's on screen).
  const colTotals = {};
  let gridGrandTotal = 0;
  for (const c of displayRows) {
    for (const col of columns) {
      const v = c[bucketKey]?.[col.key] || 0;
      if (v) colTotals[col.key] = (colTotals[col.key] || 0) + v;
    }
    gridGrandTotal += metric === 'surveys' ? c.daySurveys || 0 : c.dayKnocks || 0;
  }

  const rangeLabel = labelForRange(range);

  const kpiTiles = [
    { label: 'Doors', value: kpis.doors.toLocaleString(), sub: `Distinct doors · ${rangeLabel}` },
    { label: 'Survey doors', value: kpis.surveys.toLocaleString(), sub: 'Doors with a survey' },
    {
      label: 'Connection rate',
      value: kpis.connPct != null ? `${kpis.connPct}%` : '—',
      sub: 'Surveys + lit ÷ doors',
      level: rateFromPct(kpis.connPct)?.level,
    },
    {
      label: 'Doors / hour',
      value: kpis.doorsPerHour != null ? kpis.doorsPerHour.toFixed(1) : '—',
      sub: 'While on doors',
    },
    {
      label: 'Knocking',
      value: `${knockingCount} of ${rosterIds.size}`,
      sub: coordinatorId ? 'Crew canvassers' : 'Roster canvassers',
    },
  ];

  function openCanvasser(r) {
    router.push({
      pathname: `/(app)/admin/canvasser/${r.userId}`,
      params: {
        ...(fromDay ? { from: fromDay } : {}),
        ...(range?.to ? { to: range.to } : {}),
        ...(range?.preset ? { preset: range.preset } : {}),
      },
    });
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      else Alert.alert('Limit reached', 'Compare up to 5 canvassers at a time.');
      return next;
    });
  }

  function openCompare() {
    if (selectedIds.size < 2) {
      Alert.alert('Pick at least 2', 'Select 2–5 canvassers to compare.');
      return;
    }
    router.push({
      pathname: '/(app)/admin/canvasser/compare',
      params: {
        ids: Array.from(selectedIds).join(','),
        from: fromDay || '',
        to: range?.to || '',
        preset: range?.preset,
      },
    });
  }

  function exportCsv() {
    if (!cId) return;
    const params = new URLSearchParams();
    params.set('campaignId', cId);
    if (fromDay) params.set('from', fromDay);
    if (effectiveTo) params.set('to', effectiveTo);
    params.set('tz', deviceTimezone());
    const name = `canvassers-${fromDay || 'export'}.csv`;
    downloadCsv(`/admin/reports/canvassers.csv?${params.toString()}`, name);
  }

  const activeSortLabel = SORT_OPTIONS.find((s) => s.key === sortKey)?.label || 'Sort';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Timeline</Text>
      </View>
      <View style={styles.chipWrap}>
        <CampaignChip value={campaign} onChange={setCampaign} />
      </View>

      <DateRangeBar value={range} onChange={onRangeChange} tz={tz} presets={TIMELINE_PRESETS} />

      {/* Stepper (single-day) + metric toggle + live pill */}
      <View style={styles.controls}>
        <View style={styles.controlsLeft}>
          {isSingleDay ? (
            <View style={styles.stepper}>
              <Pressable onPress={() => stepDay(-1)} style={styles.stepBtn} hitSlop={6}>
                <Text style={styles.stepBtnText}>‹</Text>
              </Pressable>
              <Text style={styles.dayLabel}>{fmtDay(fromDay)}</Text>
              <Pressable
                onPress={() => stepDay(1)}
                disabled={fromDay >= today}
                style={[styles.stepBtn, fromDay >= today && styles.stepBtnDisabled]}
                hitSlop={6}
              >
                <Text style={styles.stepBtnText}>›</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.toggle}>
            {['knocks', 'surveys'].map((m) => {
              const active = m === metric;
              return (
                <Pressable key={m} onPress={() => setMetric(m)} style={[styles.pill, active && styles.pillActive]}>
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>
                    {m === 'knocks' ? 'Knocks' : 'Surveys'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.controlsRight}>
          {includesToday ? (
            <LiveStatus
              live={live}
              onToggle={() => setLive((v) => !v)}
              isFetching={q.isFetching}
              updatedAt={q.dataUpdatedAt}
              onRefresh={() => q.refetch()}
            />
          ) : null}
          {data.tzAbbrev ? <Text style={styles.tzText}>{data.tzAbbrev}</Text> : null}
        </View>
      </View>

      {/* Name/email search + sort (folded in from Insights) */}
      <View style={styles.filterRow}>
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            placeholder="Search name or email"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Text style={styles.clear}>✕</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => setSortMenuOpen(true)} style={styles.sortBtn}>
          <Text style={styles.sortBtnText} numberOfLines={1}>
            {activeSortLabel} ▾
          </Text>
        </Pressable>
      </View>

      {/* Hide-inactive + compare + CSV export */}
      <View style={styles.toggleRow}>
        <View style={styles.toggleItem}>
          <Switch
            value={hideInactive}
            onValueChange={setHideInactive}
            trackColor={{ true: colors.brand, false: colors.border }}
            thumbColor={colors.card}
          />
          <Text style={styles.toggleLabel}>Hide inactive</Text>
        </View>
        <Pressable
          onPress={() => {
            setCompareMode((v) => !v);
            setSelectedIds(new Set());
          }}
          style={[styles.actionBtn, compareMode && styles.actionBtnActive]}
        >
          <Text style={[styles.actionBtnText, compareMode && styles.actionBtnTextActive]}>
            {compareMode ? 'Cancel' : 'Compare'}
          </Text>
        </Pressable>
        <Pressable onPress={exportCsv} style={styles.actionBtn}>
          <Text style={styles.actionBtnText}>Export CSV</Text>
        </Pressable>
      </View>

      {rangeInvalid ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>That range won't work</Text>
          <Text style={styles.emptyText}>
            Pick a start date on or before the end date, spanning at most {TIMELINE_MAX_DAYS} days.
          </Text>
        </View>
      ) : q.isError && !q.data ? (
        // Only a first-load failure blanks the screen; a poll error with cached data
        // below keeps the last-good dashboard on screen (LiveStatus shows how stale).
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn't load the timeline</Text>
          <Text style={styles.emptyText}>
            {q.error?.message || 'Something went wrong. Check your connection and try again.'}
          </Text>
          <Pressable onPress={() => q.refetch()} style={styles.retryBtn} hitSlop={6}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl + (compareMode ? 72 : 0) }}>
          {/* KPI strip — only when there's activity to summarize. */}
          {coordRows.length > 0 ? (
            <View style={styles.kpiWrap}>
              <KpiGrid tiles={kpiTiles} columns={2} compact />
            </View>
          ) : null}

          {/* Walk-list filter stays visible even when the chosen list is empty, so
              picking a not-yet-knocked list is never a dead end. Coordinator chips
              only when there are rows to filter. */}
          {efforts.length > 1 ? (
            <TabSwitcher
              tabs={[
                { key: '', label: 'All walk lists' },
                ...efforts.map((ef) => ({ key: String(ef._id), label: ef.name })),
              ]}
              activeKey={effortId}
              onChange={setEffortId}
            />
          ) : null}
          {rows.length > 0 && coordinatorOptions.length > 0 ? (
            <TabSwitcher
              tabs={[
                { key: '', label: 'All' },
                ...coordinatorOptions.map((c) => ({ key: c.id, label: c.name })),
                { key: 'none', label: 'No coordinator' },
              ]}
              activeKey={coordinatorId}
              onChange={setCoordinatorId}
            />
          ) : null}

          {rows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No activity</Text>
              <Text style={styles.emptyText}>
                {effortId ? 'No knocks in this walk list' : 'No knocks recorded'} — {rangeLabel}. Pick
                another {efforts.length > 1 ? 'walk list or ' : ''}range above.
              </Text>
            </View>
          ) : coordRows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No activity for this crew</Text>
              <Text style={styles.emptyText}>Nobody on this crew knocked in the selected range.</Text>
            </View>
          ) : displayRows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyText}>
                {search ? `No one matches “${search.trim()}”.` : 'No active canvassers in this range.'}
              </Text>
            </View>
          ) : (
            <>
              {/* Per-canvasser cards (checkbox selection in compare mode) */}
              <View style={styles.cardsWrap}>
                {displayRows.map((r, i) => (
                  <CanvasserCard
                    key={r.userId}
                    row={r}
                    tz={tz}
                    rank={i + 1}
                    litMode={litMode}
                    onPress={() => openCanvasser(r)}
                    selectable={compareMode}
                    selected={selectedIds.has(r.userId)}
                    onToggle={() => toggleSelected(r.userId)}
                  />
                ))}
              </View>

              {/* Reconciliation — reflects the campaign/walk-list/range selection
                  (effortId is applied server-side), but NOT the client-side coordinator
                  filter, so its totals ignore any crew selection. */}
              <View style={styles.reconCard}>
                <Text style={styles.reconText}>
                  <Text style={styles.reconStrong}>{(data.grandKnocks || 0).toLocaleString()}</Text> knocks across{' '}
                  <Text style={styles.reconStrong}>{(data.canvassers || []).length}</Text>{' '}
                  {(data.canvassers || []).length === 1 ? 'canvasser' : 'canvassers'}
                </Text>
                {data.overlapDoors > 0 ? (
                  <Text style={styles.reconWarn}>
                    {data.overlapDoors} overlap door-pass{data.overlapDoors === 1 ? '' : 'es'} (counted once →{' '}
                    {data.billableKnocks})
                  </Text>
                ) : (
                  <Text style={styles.reconMuted}>No overlaps</Text>
                )}
                {coordinatorId ? (
                  <Text style={styles.reconMuted}>Overlap totals cover the whole selection — the coordinator filter isn't applied.</Text>
                ) : null}
              </View>

              {/* Frozen-name-column grid (hours or days). Campaign-to-date ships no buckets —
                  that is precisely what lets it escape the 62-day cap — so there is nothing to
                  draw. The totals above are complete either way. */}
              {!isTotals && (
              <View style={styles.gridRow}>
                <View style={{ width: NAME_W }}>
                  <View style={[styles.cellBase, styles.headCell, { width: NAME_W, alignItems: 'flex-start' }]}>
                    <Text style={styles.headText}>Canvasser</Text>
                  </View>
                  {displayRows.map((c) => (
                    <View key={c.userId} style={[styles.cellBase, styles.nameCell, { width: NAME_W }]}>
                      <Text style={styles.nameText} numberOfLines={1}>
                        {c.firstName} {c.lastName}
                        {c.inOverlap ? ' ⚠' : ''}
                      </Text>
                    </View>
                  ))}
                  <View style={[styles.cellBase, styles.totalCell, { width: NAME_W, alignItems: 'flex-start' }]}>
                    <Text style={styles.totalText}>Total</Text>
                  </View>
                </View>

                {/* Up to 62 day columns ≈ 2.5k px of plain Views — fine at typical roster
                    sizes; FlatList-ify only if a 62-day × 50-canvasser grid ever janks. */}
                <ScrollView horizontal showsHorizontalScrollIndicator>
                  <View>
                    <View style={{ flexDirection: 'row' }}>
                      {columns.map((col) => (
                        <View key={col.key} style={[styles.cellBase, styles.headCell, { width: CELL_W }]}>
                          <Text style={styles.headText}>{col.label}</Text>
                        </View>
                      ))}
                      <View style={[styles.cellBase, styles.headCell, { width: SUM_W }]}>
                        <Text style={styles.headText}>{metric === 'surveys' ? 'Sv' : 'Kn'}</Text>
                      </View>
                    </View>
                    {displayRows.map((c) => (
                      <View key={c.userId} style={{ flexDirection: 'row' }}>
                        {columns.map((col) => {
                          const v = c[bucketKey]?.[col.key] || 0;
                          return (
                            <View
                              key={col.key}
                              style={[styles.cellBase, styles.dataCell, { width: CELL_W, backgroundColor: cellBg(v) }]}
                            >
                              <Text style={styles.cellText}>{v || ''}</Text>
                            </View>
                          );
                        })}
                        <View style={[styles.cellBase, styles.dataCell, { width: SUM_W }]}>
                          <Text style={styles.sumStrong}>
                            {metric === 'surveys' ? c.daySurveys || 0 : c.dayKnocks || 0}
                          </Text>
                        </View>
                      </View>
                    ))}
                    <View style={{ flexDirection: 'row' }}>
                      {columns.map((col) => (
                        <View key={col.key} style={[styles.cellBase, styles.totalCell, { width: CELL_W }]}>
                          <Text style={styles.totalText}>{colTotals[col.key] || ''}</Text>
                        </View>
                      ))}
                      <View style={[styles.cellBase, styles.totalCell, { width: SUM_W }]}>
                        <Text style={styles.totalText}>{gridGrandTotal.toLocaleString()}</Text>
                      </View>
                    </View>
                  </View>
                </ScrollView>
              </View>
              )}

              {isTotals && (
                <Text style={styles.totalsNote}>
                  Campaign to date — everyone who has worked this campaign, including anyone who
                  has since left the team. The hour-by-hour grid needs a range of{' '}
                  {TIMELINE_MAX_DAYS} days or less.
                </Text>
              )}
            </>
          )}

          {/* Range's overlaps (card list caps at 200 worst-first; overlapCount is the true total) */}
          {overlaps.length > 0 && (
            <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
              <Text style={styles.sectionLabel}>
                Overlaps (
                {data.overlapCount > overlaps.length
                  ? `${overlaps.length} of ${data.overlapCount} shown`
                  : overlaps.length}
                )
              </Text>
              {overlaps.map((o) => (
                <View key={o.household.id} style={styles.card}>
                  <Text style={styles.address}>
                    {o.household.addressLine1}
                    {o.household.addressLine2 ? `, ${o.household.addressLine2}` : ''}
                  </Text>
                  <Text style={styles.addressSub}>
                    {[o.household.city, o.household.state, o.household.zipCode].filter(Boolean).join(', ')}
                  </Text>
                  {o.passes.map((p) => (
                    <View key={p.passId || 'none'} style={styles.passBlock}>
                      <Text style={styles.passLabel}>{p.roundLabel}</Text>
                      {p.canvassers.map((c, i) => (
                        <View key={`${c.userId}-${i}`} style={styles.canvasserRow}>
                          <View style={[styles.actionDot, { backgroundColor: actionColor(colors, c.actionType) }]} />
                          <Text style={styles.canvasserName} numberOfLines={1}>
                            {c.firstName} {c.lastName}
                          </Text>
                          <Text style={styles.canvasserAction}>{actionLabel(c.actionType)}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* Compare selection bar (folded in from Insights) */}
      {compareMode ? (
        <View style={styles.compareBar}>
          <Text style={styles.compareCount}>{selectedIds.size} selected</Text>
          <Pressable
            onPress={openCompare}
            disabled={selectedIds.size < 2}
            style={[styles.compareGo, selectedIds.size < 2 && styles.compareGoDisabled]}
          >
            <Text style={styles.compareGoText}>Compare {selectedIds.size > 0 ? selectedIds.size : ''} ›</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={sortMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortMenuOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSortMenuOpen(false)}>
          <Pressable style={styles.sortSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sortSheetTitle}>Sort by</Text>
            {SORT_OPTIONS.map((opt) => {
              const active = opt.key === sortKey;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    setSortKey(opt.key);
                    setSortMenuOpen(false);
                  }}
                  style={[styles.sortOpt, active && styles.sortOptActive]}
                >
                  <Text style={[styles.sortOptText, active && styles.sortOptTextActive]}>
                    {active ? '✓ ' : '  '}
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
    chipWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },

    controls: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    controlsLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    controlsRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    stepBtnDisabled: { opacity: 0.4 },
    stepBtnText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
    dayLabel: { ...type.bodyStrong, minWidth: 96, textAlign: 'center' },
    tzText: { ...type.caption, color: colors.textMuted },

    toggle: { flexDirection: 'row', gap: spacing.xs },
    pill: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    pillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
    pillText: { color: colors.textPrimary, fontWeight: '600', fontSize: 12 },
    pillTextActive: { color: colors.textInverse },

    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
      paddingBottom: spacing.sm,
    },
    searchWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
    },
    searchIcon: { marginRight: spacing.xs, fontSize: 13 },
    searchInput: { flex: 1, paddingVertical: 8, color: colors.textPrimary, fontSize: 14 },
    clear: { color: colors.textMuted, fontSize: 14, paddingHorizontal: spacing.xs },
    sortBtn: {
      backgroundColor: colors.card,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      minWidth: 130,
    },
    sortBtnText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    toggleItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    toggleLabel: { ...type.caption, color: colors.textSecondary },
    actionBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionBtnActive: { backgroundColor: colors.danger, borderColor: colors.danger },
    actionBtnText: { ...type.caption, color: colors.textPrimary, fontWeight: '700' },
    actionBtnTextActive: { color: colors.textInverse },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xs },
    emptyTitle: { ...type.h3 },
    emptyText: { ...type.caption, textAlign: 'center' },
    retryBtn: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.brand,
    },
    retryBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
    emptyCard: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      gap: spacing.xs,
    },

    kpiWrap: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },

    cardsWrap: { paddingHorizontal: spacing.lg },

    reconCard: {
      margin: spacing.lg,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    reconText: { ...type.body },
    reconStrong: { fontWeight: '800', color: colors.textPrimary },
    reconWarn: { ...type.caption, color: colors.warnFg, marginTop: 2, fontWeight: '600' },
    reconMuted: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    totalsNote: {
      ...type.caption,
      color: colors.textMuted,
      paddingHorizontal: spacing.lg,
      marginTop: spacing.md,
    },

    gridRow: { flexDirection: 'row', paddingHorizontal: spacing.lg },
    cellBase: {
      height: ROW_H,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingHorizontal: 2,
    },
    headCell: { backgroundColor: colors.bg },
    headText: { ...type.caption, fontWeight: '700', color: colors.textMuted, fontSize: 11 },
    nameCell: { alignItems: 'flex-start', backgroundColor: colors.card },
    nameText: { ...type.body, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    dataCell: {},
    cellText: { fontSize: 12, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    sumStrong: { fontSize: 12, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    totalCell: { backgroundColor: colors.bg, borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: colors.border },
    totalText: { fontSize: 12, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },

    sectionLabel: { ...type.caption, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    address: { ...type.bodyStrong, fontSize: 14 },
    addressSub: { ...type.caption, marginTop: 2 },
    passBlock: { marginTop: spacing.sm },
    passLabel: { ...type.caption, fontWeight: '700', color: colors.textSecondary },
    canvasserRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    actionDot: { width: 8, height: 8, borderRadius: 4 },
    canvasserName: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, flex: 1 },
    canvasserAction: { fontSize: 12, color: colors.textSecondary },

    compareBar: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.lg,
      backgroundColor: colors.textPrimary,
      borderRadius: radius.lg,
      padding: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      ...shadow.raised,
    },
    compareCount: { color: colors.textInverse, fontWeight: '700', flex: 1 },
    compareGo: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    compareGoDisabled: { opacity: 0.4 },
    compareGoText: { color: colors.textInverse, fontWeight: '800' },

    modalBackdrop: {
      flex: 1,
      backgroundColor: colors.backdrop,
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.lg,
    },
    sortSheet: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      width: '100%',
      maxWidth: 320,
      ...shadow.raised,
    },
    sortSheetTitle: { ...type.h3, marginBottom: spacing.sm },
    sortOpt: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md },
    sortOptActive: { backgroundColor: colors.brandTint },
    sortOptText: { ...type.body },
    sortOptTextActive: { color: colors.brand, fontWeight: '700' },
  });
}
