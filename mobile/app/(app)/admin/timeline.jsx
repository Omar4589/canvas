import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { PRESETS, rangeFor, labelForRange, todayInTz, shiftDays, deviceTimezone } from '../../../lib/dateRanges';
import { rateFromPct } from '../../../lib/rates';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import DateRangeBar from '../../../components/DateRangeBar';
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
const TIMELINE_PRESETS = PRESETS.filter((p) => p.key !== 'all');

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
  return t;
}
function actionColor(colors, t) {
  return colors.status[t === 'survey_submitted' ? 'surveyed' : t] || colors.textMuted;
}

export default function AdminTimeline() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams();

  // Campaign: prefer the id the launching screen passed (campaign detail), else the
  // active campaign. Reload the active campaign on focus — this hidden Tabs screen
  // stays mounted forever, so a mount-only load goes stale after a campaign switch.
  const paramCid = params.campaignId
    ? String(Array.isArray(params.campaignId) ? params.campaignId[0] : params.campaignId)
    : null;
  const [activeCampaign, setActiveCampaign] = useState(undefined);
  // useFocusEffect fires on the first focus (mount) too, so this is the only load
  // needed — and it keeps the active campaign fresh after a switch elsewhere, since
  // this hidden Tabs screen never unmounts.
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setActiveCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const cId = paramCid || (activeCampaign ? String(activeCampaign.id) : null);
  const campaignDoc =
    (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(cId)) || null;
  // Only trust activeCampaign's tz/name when it IS the resolved campaign. A param
  // pointing at a not-yet-loaded campaign must not borrow the (possibly different)
  // active campaign's tz, or "today" misbuckets near midnight until campaignsQ lands.
  const activeMatches = activeCampaign && String(activeCampaign.id) === String(cId);
  const tz = campaignDoc?.timeZone || (activeMatches ? activeCampaign.timeZone : null) || deviceTimezone();

  const [metric, setMetric] = useState('knocks');
  const [coordinatorId, setCoordinatorId] = useState(''); // '' = all, 'none' = no coordinator
  const [effortId, setEffortId] = useState('');
  const [live, setLive] = useState(true);
  // Range seeded in device tz so the screen loads immediately; refined to the
  // campaign tz once known, until the admin picks a range (canvassers.jsx pattern).
  const [range, setRange] = useState(() => {
    const r = rangeFor('today', null, deviceTimezone());
    return { preset: 'today', from: r.from, to: r.to };
  });
  const rangeTouchedRef = useRef(false);

  // Reset ALL campaign-scoped view state when the resolved campaign changes — this
  // screen never unmounts, so the filters, the picked range, and the live toggle
  // would otherwise bleed from one campaign into the next.
  const [prevCid, setPrevCid] = useState(cId);
  if (prevCid !== cId) {
    setPrevCid(cId);
    setCoordinatorId('');
    setEffortId('');
    setLive(true);
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
  const fromDay = range ? (range.preset === 'today' ? today : range.from) : null;
  const effectiveTo = range ? range.to || today : null;
  const isSingleDay = !!range && fromDay === effectiveTo;
  const includesToday = !!range && (!range.to || range.to >= today);
  // Bad custom ranges (no start, inverted, > cap) get a notice instead of a query —
  // otherwise the 20s live poll would retry the server's 400 forever.
  const rangeInvalid =
    !!range && (!fromDay || fromDay > effectiveTo || ymdSpanDays(fromDay, effectiveTo) > TIMELINE_MAX_DAYS);

  function stepDay(n) {
    const next = shiftDays(fromDay, n);
    onRangeChange({ preset: 'custom', from: next, to: next });
  }

  const q = useQuery({
    queryKey: ['admin', 'reports', 'canvasser-timeline', cId, effortId, fromDay, range?.to],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('campaignId', cId);
      if (effortId) p.set('effortId', effortId);
      p.set('from', fromDay);
      if (range?.to) p.set('to', range.to); // server defaults a missing `to` to today
      return api(`/admin/reports/canvasser-timeline?${p.toString()}`);
    },
    enabled: !!cId && !!fromDay && !rangeInvalid,
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

  // Coordinator join from the roster; off-roster knockers (removed, cross-campaign)
  // resolve to null → '—' / the 'No coordinator' bucket.
  const coordByUserId = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      m.set(String(a.userId), {
        coordinatorId: a.coordinatorId ? String(a.coordinatorId) : null,
        coordinatorName: a.coordinatorName || null,
      });
    }
    return m;
  }, [assignments]);

  const rows = useMemo(
    () =>
      (data.canvassers || []).map((c) => ({
        ...c,
        coordinatorId: coordByUserId.get(String(c.userId))?.coordinatorId || null,
        coordinatorName: coordByUserId.get(String(c.userId))?.coordinatorName || null,
      })),
    [data.canvassers, coordByUserId]
  );

  const coordinatorOptions = useMemo(() => {
    const seen = new Map();
    for (const r of rows) {
      if (r.coordinatorId && !seen.has(r.coordinatorId)) seen.set(r.coordinatorId, r.coordinatorName);
    }
    for (const a of assignments) {
      const cid = a.coordinatorId ? String(a.coordinatorId) : null;
      if (cid && !seen.has(cid)) seen.set(cid, a.coordinatorName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name: name || 'Coordinator' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, assignments]);

  const filteredRows = useMemo(() => {
    if (!coordinatorId) return rows;
    if (coordinatorId === 'none') return rows.filter((r) => !r.coordinatorId);
    return rows.filter((r) => r.coordinatorId === coordinatorId);
  }, [rows, coordinatorId]);

  // KPI totals from the visible rows so the coordinator filter scopes them too.
  const kpis = useMemo(() => {
    let doors = 0;
    let surveys = 0;
    let lit = 0;
    let hours = 0;
    for (const r of filteredRows) {
      doors += r.dayKnocks || 0;
      surveys += r.daySurveys || 0;
      lit += r.dayLit || 0;
      hours += r.hoursOnDoors || 0;
    }
    const connPct = doors ? Math.round(((surveys + lit) / doors) * 100) : null;
    const doorsPerHour = hours > 0 ? doors / hours : null;
    return { doors, surveys, connPct, doorsPerHour };
  }, [filteredRows]);

  // "Knocking N of M": M = roster canvassers (crew-scoped when filtered), N = the
  // subset with knocks — intersected with the roster so N ⊆ M (admins/off-roster
  // knockers still show in the cards, but "5 of 4" would read as a bug).
  const rosterIds = useMemo(() => {
    const canvasserRows = assignments.filter((a) => a.role === 'canvasser');
    const scoped = !coordinatorId
      ? canvasserRows
      : coordinatorId === 'none'
        ? canvasserRows.filter((a) => !a.coordinatorId)
        : canvasserRows.filter((a) => String(a.coordinatorId || '') === coordinatorId);
    return new Set(scoped.map((a) => String(a.userId)));
  }, [assignments, coordinatorId]);
  const knockingCount = useMemo(
    () => filteredRows.filter((r) => rosterIds.has(String(r.userId))).length,
    [filteredRows, rosterIds]
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
  for (const c of filteredRows)
    for (const col of columns) {
      const v = c[bucketKey]?.[col.key] || 0;
      if (v > maxCell) maxCell = v;
    }
  const cellBg = (v) =>
    v && maxCell ? `rgba(59,130,246,${(0.12 + 0.88 * (v / maxCell)).toFixed(3)})` : 'transparent';

  // Column + grand totals from the visible rows (respects the coordinator filter).
  const colTotals = {};
  let gridGrandTotal = 0;
  for (const c of filteredRows) {
    for (const col of columns) {
      const v = c[bucketKey]?.[col.key] || 0;
      if (v) colTotals[col.key] = (colTotals[col.key] || 0) + v;
    }
    gridGrandTotal += metric === 'surveys' ? c.daySurveys || 0 : c.dayKnocks || 0;
  }

  const rangeLabel = labelForRange(range);
  const campaignName = campaignDoc?.name || (activeMatches ? activeCampaign.name : '') || '';

  const kpiTiles = [
    { label: 'Doors', value: kpis.doors.toLocaleString(), sub: rangeLabel },
    { label: 'Surveys', value: kpis.surveys.toLocaleString(), sub: 'Doors with a survey' },
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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Admin</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Timeline</Text>
        <View style={{ width: 80 }} />
      </View>
      {campaignName ? <Text style={styles.campaignName}>{campaignName}</Text> : null}

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
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
          {/* KPI strip — only when there's activity to summarize. */}
          {rows.length > 0 ? (
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
          ) : filteredRows.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No activity for this crew</Text>
              <Text style={styles.emptyText}>Nobody on this crew knocked in the selected range.</Text>
            </View>
          ) : (
            <>
              {/* Per-canvasser cards */}
              <View style={styles.cardsWrap}>
                {filteredRows.map((r, i) => (
                  <CanvasserCard
                    key={r.userId}
                    row={r}
                    tz={tz}
                    rank={i + 1}
                    litMode={campaignDoc?.type === 'lit_drop'}
                    onPress={() => openCanvasser(r)}
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
                    {data.overlapDoors} overlap door-pass{data.overlapDoors === 1 ? '' : 'es'} (billed once →{' '}
                    {data.billableKnocks})
                  </Text>
                ) : (
                  <Text style={styles.reconMuted}>No overlaps</Text>
                )}
                {coordinatorId ? (
                  <Text style={styles.reconMuted}>Overlap totals cover the whole selection — the coordinator filter isn't applied.</Text>
                ) : null}
              </View>

              {/* Frozen-name-column grid (hours or days) */}
              <View style={styles.gridRow}>
                <View style={{ width: NAME_W }}>
                  <View style={[styles.cellBase, styles.headCell, { width: NAME_W, alignItems: 'flex-start' }]}>
                    <Text style={styles.headText}>Canvasser</Text>
                  </View>
                  {filteredRows.map((c) => (
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
                    {filteredRows.map((c) => (
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
    back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
    campaignName: {
      ...type.caption,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },

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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
      gap: spacing.sm,
    },
    rank: { width: 22, fontSize: 13, fontWeight: '800', color: colors.brand, textAlign: 'center' },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.brand, fontWeight: '800', fontSize: 14 },
    name: { ...type.bodyStrong, fontSize: 14 },
    inactive: { ...type.caption, color: colors.textMuted, fontWeight: '400' },
    meta: { ...type.caption, marginTop: 1 },
    metaSmall: { fontSize: 11, color: colors.textMuted, fontVariant: ['tabular-nums'], marginTop: 2 },
    statsLine: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
    stat: { fontSize: 12, color: colors.textSecondary },
    statBold: { fontSize: 12, color: colors.textPrimary, fontWeight: '700' },
    shift: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },
    chev: { fontSize: 22, color: colors.textMuted, fontWeight: '300' },

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
  });
}
