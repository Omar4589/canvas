import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { saveActiveCampaign } from '../../../lib/cache';
import VoterRow from '../../../components/VoterRow';
import TabSwitcher from '../../../components/TabSwitcher';
import { deviceTimezone } from '../../../lib/dateRanges';
import { formatInTz, timeAgo } from '../../../lib/datetime';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

const PAGE = 25;

function one(p) {
  return Array.isArray(p) ? p[0] : p;
}

// Filter chip + dropdown item — mirrors the admin map's filter pattern.
function FilterChip({ label, active, open, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.filterChevron}>{open ? '▴' : '▾'}</Text>
    </Pressable>
  );
}

function MenuItem({ label, active, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.menuItem, active && styles.menuItemActive]}>
      <Text style={[styles.menuItemText, active && styles.menuItemTextActive]} numberOfLines={1}>
        {label}
      </Text>
      {active ? <Text style={styles.menuCheck}>✓</Text> : null}
    </Pressable>
  );
}

export default function AnswerVoters() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams();
  const campaignId = one(params.campaignId);
  const questionKey = one(params.questionKey);
  const option = one(params.option);
  const optionId = one(params.optionId);
  const label = one(params.label);
  const surveyTemplateId = one(params.surveyTemplateId);
  const from = one(params.from);
  const to = one(params.to);

  const [tab, setTab] = useState('voters'); // 'voters' | 'canvassers'
  const [canvasserId, setCanvasserId] = useState(''); // local filter, '' = all
  const [canvasserMenuOpen, setCanvasserMenuOpen] = useState(false);
  const [skip, setSkip] = useState(0);
  const [items, setItems] = useState([]);

  // This is a Tabs screen that never unmounts, and expo-router reuses the same
  // instance when navigated to with different params — reset the accumulator
  // synchronously during render whenever the identifying params change. The
  // local canvasser filter is part of the identity (switching it must reset the
  // pages), while a fresh SET of route params also clears the filter itself.
  const paramsKey = `${campaignId}|${questionKey}|${optionId}|${option}|${surveyTemplateId}|${from}|${to}`;
  const identityKey = `${paramsKey}|${canvasserId}`;
  const [prevParamsKey, setPrevParamsKey] = useState(paramsKey);
  const [prevKey, setPrevKey] = useState(identityKey);
  if (prevParamsKey !== paramsKey) {
    setPrevParamsKey(paramsKey);
    setTab('voters');
    setCanvasserId('');
    setCanvasserMenuOpen(false);
  }
  if (prevKey !== identityKey) {
    setPrevKey(identityKey);
    setSkip(0);
    setItems([]);
  }

  // Campaign object (tz for exact times; saveActiveCampaign for "View on map") —
  // shared cache with the screens that pushed here.
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const campaign = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId)) || null;
  const tz = campaign?.timeZone;

  const q = useQuery({
    queryKey: ['admin', 'answer-voters', campaignId, questionKey, optionId, option, surveyTemplateId, canvasserId, from, to, skip],
    queryFn: () => {
      const p = new URLSearchParams({
        campaignId,
        questionKey,
        option: option ?? '',
        tz: deviceTimezone(),
        limit: String(PAGE),
        skip: String(skip),
      });
      if (optionId) p.set('optionId', optionId);
      if (surveyTemplateId) p.set('surveyTemplateId', surveyTemplateId);
      if (canvasserId) p.set('userId', canvasserId);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return api(`/admin/reports/voters-by-answer?${p.toString()}`);
    },
    enabled: !!campaignId && !!questionKey && option != null,
  });

  // Per-canvasser breakdown for this option — powers the "By canvasser" tab AND
  // the canvasser filter menu (its rows are the only canvassers worth listing).
  const canvassersQ = useQuery({
    queryKey: ['admin', 'answer-canvassers', campaignId, questionKey, optionId, option, surveyTemplateId, from, to],
    queryFn: () => {
      const p = new URLSearchParams({
        campaignId,
        questionKey,
        option: option ?? '',
        tz: deviceTimezone(),
      });
      if (optionId) p.set('optionId', optionId);
      if (surveyTemplateId) p.set('surveyTemplateId', surveyTemplateId);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return api(`/admin/reports/answer-canvassers?${p.toString()}`);
    },
    enabled: !!campaignId && !!questionKey && option != null,
  });
  const canvasserRows = canvassersQ.data?.rows || [];

  // Web VoterList semantics: the first page REPLACES (so a refetch after returning to a
  // cached drill shows fresh rows, not the stale cache-then-discard), later pages dedup
  // by responseId (a new submission shifts the desc-sorted pages, re-serving a row).
  useEffect(() => {
    if (!q.data?.voters) return;
    setItems((prev) => {
      if (skip === 0) return q.data.voters;
      const seen = new Set(prev.map((v) => v.responseId));
      return [...prev, ...q.data.voters.filter((v) => !seen.has(v.responseId))];
    });
  }, [q.data, skip]);

  const total = q.data?.total ?? 0;

  const activeCanvasser = canvasserId
    ? canvasserRows.find((r) => String(r.userId) === String(canvasserId))
    : null;
  const canvasserLabel = activeCanvasser
    ? `${activeCanvasser.firstName} ${activeCanvasser.lastName}`.trim() || 'Canvasser'
    : 'All canvassers';

  // Open the admin map pre-filtered to this exact drill (answer + canvasser +
  // window). Same idiom as campaign/[campaignId]'s goTimeline: save the active
  // campaign first, then push; the map consumes the seed params one-shot.
  async function goMap() {
    if (!campaign) return;
    await saveActiveCampaign({ id: String(campaign._id), name: campaign.name, type: campaign.type, state: campaign.state, timeZone: campaign.timeZone });
    router.push({
      pathname: '/(app)/admin/map',
      params: {
        questionKey,
        optionId: optionId || '',
        alabel: option ?? label ?? '',
        surveyTemplateId: surveyTemplateId || '',
        userId: canvasserId || '',
        from: from || '',
        to: to || '',
        scid: String(campaign._id), // the map waits for THIS campaign before seeding
        seedAt: String(Date.now()), // per-tap nonce, same idiom as the household focus link
      },
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        {campaign ? (
          <Pressable onPress={goMap} hitSlop={8}>
            <Text style={styles.mapLink}>View on map ›</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.title} numberOfLines={2}>{label || 'Responses'}</Text>
        {/* "entries", not "voters" — this is response-unit (a voter re-surveyed in a
            later round appears once per round), same wording as the web explorer. */}
        <Text style={styles.subtitle}>
          “{option}” ·{' '}
          {q.error && !q.data ? '—' : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`}
        </Text>

        {/* Negative margin cancels the content padding — TabSwitcher carries its own. */}
        <View style={{ marginHorizontal: -spacing.lg }}>
          <TabSwitcher
            tabs={[
              { key: 'voters', label: 'Voters', count: q.data ? total : null },
              { key: 'canvassers', label: 'By canvasser', count: canvassersQ.data ? canvasserRows.length : null },
            ]}
            activeKey={tab}
            onChange={setTab}
          />
        </View>

        {tab === 'voters' ? (
          <>
            {canvasserRows.length > 0 ? (
              <View style={styles.filterRow}>
                <FilterChip
                  label={canvasserLabel}
                  active={!!canvasserId}
                  open={canvasserMenuOpen}
                  onPress={() => setCanvasserMenuOpen((v) => !v)}
                />
              </View>
            ) : null}
            {canvasserMenuOpen ? (
              <View style={styles.menu}>
                <MenuItem
                  label="All canvassers"
                  active={!canvasserId}
                  onPress={() => { setCanvasserId(''); setCanvasserMenuOpen(false); }}
                />
                {canvasserRows.map((r) => (
                  <MenuItem
                    key={r.userId}
                    label={`${`${r.firstName} ${r.lastName}`.trim() || 'Unknown'} (${r.count})`}
                    active={String(canvasserId) === String(r.userId)}
                    onPress={() => { setCanvasserId(String(r.userId)); setCanvasserMenuOpen(false); }}
                  />
                ))}
              </View>
            ) : null}

            {items.map((v) => (
              <VoterRow
                key={v.responseId}
                v={v}
                showCanvasser
                showBadges
                exactTime={formatInTz(v.submittedAt, tz)}
                onPress={() =>
                  router.push({
                    pathname: '/(app)/admin/response-details',
                    params: { responseId: v.responseId, campaignId },
                  })
                }
              />
            ))}

            {q.isLoading && items.length === 0 ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
            ) : q.error && items.length === 0 ? (
              // An error must never render as an authoritative zero on an audit surface.
              <Text style={styles.muted}>{q.error.message}</Text>
            ) : items.length === 0 ? (
              <Text style={styles.muted}>No voters for this answer.</Text>
            ) : items.length < total ? (
              <Pressable
                onPress={() => setSkip(items.length)}
                disabled={q.isFetching}
                style={({ pressed }) => [styles.loadMore, pressed && { opacity: 0.85 }]}
              >
                {q.isFetching ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Text style={styles.loadMoreText}>Load more ({total - items.length} left)</Text>
                )}
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            {canvassersQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
            ) : canvassersQ.error ? (
              <Text style={styles.muted}>{canvassersQ.error.message}</Text>
            ) : canvasserRows.length === 0 ? (
              <Text style={styles.muted}>No canvassers recorded this answer.</Text>
            ) : (
              canvasserRows.map((r, i) => (
                <Pressable
                  key={r.userId}
                  onPress={() => { setCanvasserId(String(r.userId)); setTab('voters'); }}
                  style={({ pressed }) => [styles.canvRow, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.rank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.canvName} numberOfLines={1}>
                      {`${r.firstName} ${r.lastName}`.trim() || 'Unknown'}
                      {r.status === 'deleted' ? <Text style={styles.canvGone}> · removed</Text> : null}
                    </Text>
                    <Text style={styles.canvMeta} numberOfLines={2}>
                      {r.pctOfOwnAnswers}% of their answers on this question
                      {r.lastAt ? ` · last entry ${timeAgo(r.lastAt)}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.canvCount}>{r.count}</Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  mapLink: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  title: { ...type.h2, fontSize: 18, marginTop: spacing.xs },
  subtitle: { ...type.caption, marginBottom: spacing.md },
  muted: { ...type.caption, marginTop: spacing.lg, textAlign: 'center' },
  loadMore: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  loadMoreText: { color: colors.brand, fontWeight: '700', fontSize: 14 },

  filterRow: { flexDirection: 'row', marginBottom: spacing.sm },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: 6,
  },
  filterChipActive: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  filterChipText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, maxWidth: 200 },
  filterChipTextActive: { color: colors.brand },
  filterChevron: { fontSize: 11, color: colors.textSecondary },
  menu: {
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.raised,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  menuItemActive: { backgroundColor: colors.brandTint },
  menuItemText: { flex: 1, fontSize: 14, color: colors.textPrimary },
  menuItemTextActive: { color: colors.brand, fontWeight: '700' },
  menuCheck: { color: colors.brand, fontWeight: '700' },

  canvRow: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rank: { ...type.caption, color: colors.textMuted, fontWeight: '700', width: 22, textAlign: 'center' },
  canvName: { ...type.bodyStrong, fontSize: 14 },
  canvGone: { color: colors.textMuted, fontWeight: '400' },
  canvMeta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  canvCount: { ...type.bodyStrong, fontSize: 16, color: colors.brand },
  chevron: { fontSize: 18, color: colors.textMuted },
  });
}
