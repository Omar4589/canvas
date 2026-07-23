import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
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
import { spacing, radius } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import DateRangeBar from '../../../components/DateRangeBar';
import CampaignChip from '../../../components/CampaignChip';
import SourceChips from '../../../components/SourceChips';
import TabSwitcher from '../../../components/TabSwitcher';
import NoteCard from '../../../components/NoteCard';

// Mobile Notes hub — the port of the web client/src/pages/NotesPage.jsx. Reuses the
// same GET /admin/reports/notes endpoint (no server changes). Structure mirrors the
// GPS-audit screen (audit.jsx): campaign-scoped hidden Tabs screen, CampaignChip +
// DateRangeBar, filter chips, and a paginated ("Load more") list.
const LIMIT = 30;
const SOURCES = [
  { key: 'door', label: 'Door', color: '#3B82F6' },
  { key: 'survey', label: 'Survey', color: '#22C55E' },
  { key: 'voter', label: 'Admin', color: '#8B5CF6' },
];

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
        {effortId ? (
          <Text style={styles.notice}>
            Admin notes aren&apos;t tied to a walk list, so they&apos;re hidden while one is selected.
          </Text>
        ) : null}

        {capped ? (
          <Text style={styles.notice}>
            Showing the most recent {resultCap.toLocaleString()} per type — narrow the date range or filters to
            see the rest.
          </Text>
        ) : null}

        {!cId ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>Pick a campaign to see its notes.</Text>
          </View>
        ) : notesQ.isError && !notesQ.data ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>Couldn&apos;t load notes</Text>
            <Text style={styles.emptyText}>{notesQ.error?.message || 'Check your connection and try again.'}</Text>
            <Pressable onPress={() => notesQ.refetch()} style={styles.retryBtn} hitSlop={6}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </Pressable>
          </View>
        ) : notesQ.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : notes.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No notes</Text>
            <Text style={styles.emptyText}>
              Nothing matches these filters{range.preset !== 'all' ? ` in ${labelForRange(range)}` : ''}.
            </Text>
          </View>
        ) : (
          <View style={styles.listWrap}>
            {notes.map((n) => (
              <NoteCard
                key={`${n.source}:${n.id}`}
                note={n}
                tz={reportTz}
                onOpenVoter={openVoter}
                onOpenHousehold={openHousehold}
              />
            ))}
            {notesQ.hasNextPage ? (
              <Pressable
                onPress={() => notesQ.fetchNextPage()}
                disabled={notesQ.isFetchingNextPage}
                style={({ pressed }) => [styles.loadMore, pressed && { opacity: 0.85 }]}
              >
                {notesQ.isFetchingNextPage ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Text style={styles.loadMoreText}>Load more</Text>
                )}
              </Pressable>
            ) : (
              <Text style={styles.endNote}>
                {total.toLocaleString()} note{total === 1 ? '' : 's'}
                {capped ? '+' : ''}
              </Text>
            )}
          </View>
        )}
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
    notice: {
      ...type.caption,
      color: colors.textMuted,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xs },
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
      marginTop: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      gap: spacing.xs,
    },
    listWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.xs },
    loadMore: {
      marginTop: spacing.sm,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: 'center',
    },
    loadMoreText: { color: colors.brand, fontWeight: '700', fontSize: 14 },
    endNote: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  });
}
