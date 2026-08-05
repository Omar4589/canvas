import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { loadActiveCampaign, saveActiveCampaign } from '../../../lib/cache';
import { PRESETS, rangeFor, labelForRange, todayInTz, deviceTimezone } from '../../../lib/dateRanges';
import { spacing, radius, actionLabel } from '../../../lib/theme';
import { formatInTz } from '../../../lib/datetime';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import DateRangeBar from '../../../components/DateRangeBar';
import CampaignChip from '../../../components/CampaignChip';
import ArchivedCampaignBanner from '../../../components/ArchivedCampaignBanner';
import SourceChips from '../../../components/SourceChips';
import TabSwitcher from '../../../components/TabSwitcher';
import InsetGroup, {
  InsetRow,
  InsetNavRow,
  InsetActionRow,
  InsetNoteRow,
  GroupFooter,
} from '../../../components/InsetGroup';

// Mobile Notes hub — the port of the web client/src/pages/NotesPage.jsx. Reuses the
// same GET /admin/reports/notes endpoint (no server changes). Structure mirrors the
// GPS-audit screen (audit.jsx): campaign-scoped hidden Tabs screen, CampaignChip +
// DateRangeBar, filter chips, and a paginated ("Load more") list — the list itself is
// ONE InsetGroup (see components/InsetGroup.jsx for the row grammar).
const LIMIT = 30;
// The three note-source colors — the ONLY definition of these hexes, matching the web
// NotesPage SOURCES. Feeds both the filter chips (with counts) and each row's leading dot.
const SOURCES = [
  { key: 'door', label: 'Door', color: '#3B82F6' },
  { key: 'survey', label: 'Survey', color: '#22C55E' },
  { key: 'voter', label: 'Admin', color: '#8B5CF6' },
];
const SOURCE_META = Object.fromEntries(SOURCES.map((s) => [s.key, s]));

// The colored source dot sits in the row's `leading` slot — same hue its filter chip uses.
const SourceDot = ({ color }) => <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;

export default function AdminNotes() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const roleLabel = useConsoleRoleLabel();
  const router = useRouter();

  // Campaign scoping via CampaignChip (like Timeline/Map/Audit). This hidden Tabs
  // screen stays mounted, so re-sync the active campaign on focus.
  const [campaign, setCampaign] = useState(undefined);
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );

  const cId = campaign?.id ? String(campaign.id) : null;
  const tz = campaign?.timeZone || deviceTimezone();

  // Filters
  const [types, setTypes] = useState([]); // [] = all sources
  const [authorId, setAuthorId] = useState(''); // '' = any author
  const [effortId, setEffortId] = useState(''); // '' = all walk lists
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [range, setRange] = useState(() => {
    const r = rangeFor('today', null, deviceTimezone());
    return { preset: 'today', from: r.from, to: r.to };
  });
  const rangeTouchedRef = useRef(false);

  // Reset all campaign-scoped view state when the resolved campaign changes (the
  // screen stays mounted, so filters/range would otherwise bleed across campaigns).
  const [prevCid, setPrevCid] = useState(cId);
  if (prevCid !== cId) {
    setPrevCid(cId);
    setTypes([]);
    setAuthorId('');
    setEffortId('');
    setQInput('');
    setQ('');
    const r = rangeFor('today', null, tz);
    setRange({ preset: 'today', from: r.from, to: r.to });
    rangeTouchedRef.current = false;
  }

  // Re-anchor the untouched "today" default to the campaign's tz once it resolves
  // (a viewer in another timezone must see the campaign's today).
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    const r = rangeFor('today', null, tz);
    setRange((prev) =>
      prev.preset === 'today' && prev.from === r.from ? prev : { preset: 'today', from: r.from, to: r.to }
    );
  }, [tz]);

  function onRangeChange(v) {
    rangeTouchedRef.current = true;
    setRange(v);
  }

  // Debounce the search box (mirrors the web NotesPage).
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Author options — shared roster cache with Timeline/Books (flat assignment rows).
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
    staleTime: 60 * 1000,
  });
  const authorTabs = useMemo(() => {
    const rows = assignmentsQ.data?.assignments || [];
    const opts = rows
      .map((a) => ({
        key: String(a.userId),
        label: `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.email || 'Unknown',
      }))
      .sort((x, y) => x.label.localeCompare(y.label));
    return [{ key: '', label: 'Any author' }, ...opts];
  }, [assignmentsQ.data]);

  // Walk-list / effort options (only shown when a campaign has more than one).
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/efforts`),
    enabled: !!cId,
    staleTime: 60 * 1000,
  });
  const efforts = effortsQ.data?.efforts || [];
  const effortTabs = useMemo(
    () => [{ key: '', label: 'All walk lists' }, ...efforts.map((ef) => ({ key: String(ef._id), label: ef.name }))],
    [efforts]
  );

  // "today" for the query is recomputed each render in the campaign tz so a filter
  // on the open-ended today preset stays anchored to the campaign's day.
  const today = todayInTz(tz);
  const fromDay = range.preset === 'today' ? today : range.from;
  const typeCsv = types.join(',');

  const notesQ = useInfiniteQuery({
    queryKey: ['admin', 'notes', cId, fromDay, range?.to, typeCsv, authorId, effortId, q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      p.set('campaignId', cId);
      if (fromDay) p.set('from', fromDay);
      if (range?.to) p.set('to', range.to);
      if (typeCsv) p.set('type', typeCsv);
      if (authorId) p.set('userId', authorId);
      if (effortId) p.set('effortId', effortId);
      if (q) p.set('q', q);
      p.set('page', String(pageParam));
      p.set('limit', String(LIMIT));
      return api(`/admin/reports/notes?${p.toString()}`);
    },
    // Paginate off `total` (the merged wanted-source count), NOT counts.total.
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, pg) => n + (pg.notes?.length || 0), 0);
      return loaded < (lastPage.total || 0) ? allPages.length : undefined;
    },
    enabled: !!cId,
    placeholderData: keepPreviousData,
    ...useFocusedPoll(),
  });

  const pages = notesQ.data?.pages || [];
  const notes = pages.flatMap((pg) => pg.notes || []);
  const head = pages[0] || {};
  const counts = head.counts || { door: 0, survey: 0, voter: 0, total: 0 };
  const total = head.total || 0;
  const capped = !!head.capped;
  const resultCap = head.resultCap || 500;
  const reportTz = head.timeZone || tz;

  function toggleType(key) {
    setTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function openVoter(id) {
    // ?from=notes so the voter screen's back returns here, not to the Voters list.
    router.push(`/(app)/voters/${id}?from=notes`);
  }
  async function openHousehold(id) {
    // The map reads the active campaign (not a param); re-assert this campaign in
    // case the always-mounted map was last left on a different one.
    if (campaign && cId) {
      await saveActiveCampaign({
        id: cId,
        name: campaign.name,
        type: campaign.type,
        state: campaign.state,
        timeZone: campaign.timeZone,
      });
    }
    // focusAt nonce so re-tapping the same door still re-focuses the mounted map;
    // hcid lets the map safely give up if this campaign loads without the door.
    router.push(`/(app)/admin/map?household=${id}&focusAt=${Date.now()}&hcid=${cId}`);
  }

  const sourcesWithCounts = SOURCES.map((s) => ({ ...s, count: counts[s.key] ?? 0 }));

  // One note as an inset row. A note with a target NAVIGATES (voter note → voter profile;
  // household-only note → the map focused on that door); a note with neither is INERT — the
  // same pressable/unpressable distinction the old NoteCard drew. The quoted body is the
  // label (it wraps, never truncates); source · door action · edited · author · time ·
  // voter · address collapse into the sub line. Timestamps use the SERVER-resolved tz
  // (reportTz) so the clock matches web exactly.
  const noteRow = (n) => {
    const meta = SOURCE_META[n.source] || SOURCE_META.door;
    const when =
      formatInTz(n.timestamp, reportTz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }, true) || '—';
    const sub = [
      meta.label,
      n.source === 'door' && n.actionType ? actionLabel(n.actionType) : null,
      n.edited ? 'edited' : null,
      n.author?.name || 'Unknown',
      when,
      n.voter?.name,
      n.household?.address,
    ]
      .filter(Boolean)
      .join(' · ');
    const key = `${n.source}:${n.id}`;
    const shared = { label: `“${n.note}”`, sub, leading: <SourceDot color={meta.color} /> };
    if (n.voter) {
      return <InsetNavRow key={key} {...shared} hint="Opens the voter profile" onPress={() => openVoter(n.voter.id)} />;
    }
    if (n.household) {
      return (
        <InsetNavRow key={key} {...shared} hint="Shows this door on the map" onPress={() => openHousehold(n.household.id)} />
      );
    }
    return <InsetRow key={key} {...shared} />;
  };

  // The list-area states, mutually exclusive and in the same precedence the old branch
  // chain used: no campaign → hard error (no stale data to show) → first load → empty → list.
  const loadFailed = !!cId && notesQ.isError && !notesQ.data;
  const loadingFirst = !!cId && !loadFailed && notesQ.isLoading;
  const emptyList = !!cId && !loadFailed && !loadingFirst && notes.length === 0;
  const hasList = !!cId && !loadFailed && !loadingFirst && notes.length > 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ {roleLabel}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Notes</Text>
        <View style={{ width: 80 }} />
      </View>
      <View style={styles.chipWrap}>
        <CampaignChip value={campaign} onChange={setCampaign} />
      </View>
      <ArchivedCampaignBanner campaignId={cId} style={styles.bannerWrap} />

      <DateRangeBar value={range} onChange={onRangeChange} tz={tz} presets={PRESETS} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={notesQ.isRefetching && !notesQ.isFetchingNextPage}
            onRefresh={() => notesQ.refetch()}
            tintColor={colors.brand}
          />
        }
      >
        <View style={styles.searchWrap}>
          <TextInput
            value={qInput}
            onChangeText={setQInput}
            placeholder="Search note text…"
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        <SourceChips sources={sourcesWithCounts} selected={types} onToggle={toggleType} />

        {authorTabs.length > 1 ? (
          <TabSwitcher tabs={authorTabs} activeKey={authorId} onChange={setAuthorId} />
        ) : null}

        {efforts.length > 1 ? (
          <TabSwitcher tabs={effortTabs} activeKey={effortId} onChange={setEffortId} />
        ) : null}
        <View style={styles.listWrap}>
          <InsetGroup>
            {!cId ? <InsetNoteRow>Pick a campaign to see its notes.</InsetNoteRow> : null}
            {loadFailed ? (
              <InsetNoteRow>
                Couldn&apos;t load notes — {notesQ.error?.message || 'check your connection and try again.'}
              </InsetNoteRow>
            ) : null}
            {/* Retry ACTS IN PLACE (refetches into this same list) — action row, no chevron. */}
            {loadFailed ? <InsetActionRow label="Try again" onPress={() => notesQ.refetch()} /> : null}
            {loadingFirst ? <InsetNoteRow loading /> : null}
            {emptyList ? (
              <InsetNoteRow>
                No notes — nothing matches these filters
                {range.preset !== 'all' ? ` in ${labelForRange(range)}` : ''}.
              </InsetNoteRow>
            ) : null}
            {hasList ? notes.map(noteRow) : null}
            {hasList && notesQ.hasNextPage ? (
              <InsetActionRow
                label={notesQ.isFetchingNextPage ? 'Loading…' : 'Load more'}
                disabled={notesQ.isFetchingNextPage}
                onPress={() => notesQ.fetchNextPage()}
              />
            ) : null}
          </InsetGroup>
          {hasList && !notesQ.hasNextPage ? (
            <GroupFooter>
              {total.toLocaleString()} note{total === 1 ? '' : 's'}
              {capped ? '+' : ''}
            </GroupFooter>
          ) : null}
          {effortId ? (
            <GroupFooter>
              Admin notes aren&apos;t tied to a walk list, so they&apos;re hidden while one is selected.
            </GroupFooter>
          ) : null}
          {capped ? (
            <GroupFooter>
              Showing the most recent {resultCap.toLocaleString()} per type — narrow the date range or filters to
              see the rest.
            </GroupFooter>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
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
    chipWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    bannerWrap: { marginHorizontal: spacing.lg },
    searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    search: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 14,
      color: colors.textPrimary,
    },
    listWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  });
}
