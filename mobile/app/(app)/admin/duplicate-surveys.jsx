import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { PRESETS, labelForRange, deviceTimezone } from '../../../lib/dateRanges';
import { spacing } from '../../../lib/theme';
import { formatInTz } from '../../../lib/datetime';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useConsoleRole, useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import { useRefresh } from '../../../lib/useRefresh';
import {
  KIND_ALL,
  KIND_TABS,
  buildDeletePrompt,
  deleteErrorMessage,
} from '../../../lib/duplicateSurveys';
import DateRangeBar from '../../../components/DateRangeBar';
import CampaignChip from '../../../components/CampaignChip';
import ArchivedCampaignBanner from '../../../components/ArchivedCampaignBanner';
import { useCampaignArchived } from '../../../lib/useCampaignArchived';
import TabSwitcher from '../../../components/TabSwitcher';
import DuplicateVoterCard from '../../../components/DuplicateVoterCard';
import InsetGroup, {
  InsetActionRow,
  InsetNoteRow,
  GroupFooter,
} from '../../../components/InsetGroup';

// Mobile Duplicate surveys — the port of web's client/src/pages/DuplicateSurveysPage.jsx, on the
// same GET /admin/reports/duplicate-surveys (no server changes). Voters with more than one survey
// response, which is why "Surveys" can read higher than "Surveyed voters".
//
// Two things set it apart from its sibling report screens:
//  1. An org admin can DELETE the extra response here, closing the fix loop on the phone. The
//     route is admin-only (admin/voters.js is requireOrgRole('admin')), while the REPORT is
//     lead-readable — so a lead sees every row and no Delete. The button is gated for honesty,
//     not for security: the server refuses regardless.
//  2. The paged fetch is written inline instead of via lib/useInfinitePaged, deliberately.
//     scripts/mobile-api-surface.mjs finds mobile's server dependencies by grepping for literal
//     paths at api() call sites, and that helper builds its URL internally — endpoints consumed
//     through it are invisible to `npm run audit:mobile-api` (verified: /super-admin/users and
//     /super-admin/emails are both missing from --list). An audit surface should not hide from the
//     audit. This is the notes.jsx shape with skip semantics.
const LIMIT = 25;

export default function AdminDuplicateSurveys() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const roleLabel = useConsoleRoleLabel();
  const router = useRouter();
  const qc = useQueryClient();

  // Deleting is org-admin only. Written in the POSITIVE form on purpose: useConsoleRole returns
  // undefined while it reads the cache, so `!== 'lead'` would flash a Delete button at a lead for
  // a frame (the household/[id].jsx trap — "defaults FALSE because loadRoleContext is async").
  const viewerRole = useConsoleRole();
  const isAdmin = viewerRole === 'admin' || viewerRole === 'super';

  // Hidden Tabs screens stay mounted forever, so re-sync the active campaign on focus.
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

  // An archived campaign is read-only, so Delete goes with it. Same positive form as the role
  // check above — canWrite is false until the campaign list resolves, so the button appears once
  // rather than flashing and retracting.
  const { canWrite } = useCampaignArchived(cId);
  const canDelete = isAdmin && canWrite;

  const [kind, setKind] = useState(KIND_ALL);
  const [userId, setUserId] = useState('');
  // All time by default — this is a history report, same as web. rangeFor('all') is {null,null}
  // in every timezone, so unlike notes.jsx there is no tz re-anchor to do once the campaign lands.
  const [range, setRange] = useState({ preset: 'all', from: null, to: null });

  // Campaign switch resets the canvasser filter in RENDER (never an effect) so no query can fire
  // with the new campaign and the old roster's userId — that id belongs to nobody here and would
  // silently filter to zero. kind and the date range are campaign-agnostic and deliberately stay.
  // Paging needs no reset: cId is in the query key, so the infinite query restarts itself.
  const [prevCid, setPrevCid] = useState(cId);
  if (prevCid !== cId) {
    setPrevCid(cId);
    setUserId('');
  }

  // Ledger-first (NOT the /assignments roster): a departed canvasser's duplicates are still on
  // this report, so they must stay filterable — they are exactly who an audit is looking for. Key
  // is byte-identical to ExportSheet's, so the two share one cache entry.
  const canvassersQ = useQuery({
    queryKey: ['admin', 'report-canvassers', cId],
    queryFn: () => api(`/admin/reports/canvassers?campaignId=${cId}`),
    enabled: !!cId,
    staleTime: 60 * 1000,
  });

  const canvasserTabs = useMemo(() => {
    const rows = Array.isArray(canvassersQ.data) ? canvassersQ.data : [];
    return [
      { key: '', label: 'All canvassers' },
      ...rows
        .map((c) => ({
          key: String(c.userId),
          label:
            (`${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown') +
            (c.status && c.status !== 'active' ? ` (${c.status})` : ''),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [canvassersQ.data]);

  const dupQ = useInfiniteQuery({
    queryKey: ['admin', 'duplicate-surveys', cId, range.from, range.to, kind, userId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams();
      p.set('campaignId', cId);
      if (range.from) p.set('from', range.from);
      if (range.to) p.set('to', range.to);
      // '' is a malformed ObjectId and the server 400s on it — only send a real pick.
      if (kind !== KIND_ALL) p.set('kind', kind);
      if (userId) p.set('userId', userId);
      p.set('skip', String(pageParam));
      p.set('limit', String(LIMIT));
      return api(`/admin/reports/duplicate-surveys?${p.toString()}`);
    },
    // The next skip IS the number of rows already loaded — the endpoint's own contract.
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, pg) => n + (pg.duplicates?.length || 0), 0);
      return loaded < (lastPage.total || 0) ? loaded : undefined;
    },
    enabled: !!cId,
    placeholderData: keepPreviousData,
  });

  const pages = dupQ.data?.pages || [];
  const duplicates = pages.flatMap((pg) => pg.duplicates || []);
  const head = pages[0] || {};
  const total = pages.length ? pages[pages.length - 1].total || 0 : 0;
  const reportTz = head.timeZone || tz;
  const filtered = kind !== KIND_ALL || !!userId;

  const { refreshing, onRefresh } = useRefresh([dupQ.refetch, canvassersQ.refetch]);

  const [busyId, setBusyId] = useState(null);

  const delMut = useMutation({
    mutationFn: ({ voterId, responseId }) =>
      api(`/admin/voters/${voterId}/surveys/${responseId}`, { method: 'DELETE' }),
    onMutate: ({ responseId }) => setBusyId(responseId),
    onSettled: () => setBusyId(null),
    onSuccess: (_profile, { voterId, responseId, canvasserId }) => {
      // Invalidate rather than splice the row out locally. A local patch is cheaper, but
      // sameCanvasserSameDay / differentCanvassers are computed server-side from timezone-bucketed
      // day keys — deleting the third canvasser's response can leave a WRONG badge on the one
      // screen whose entire job is those badges, and re-deriving them here would duplicate the
      // exact aggregation duplicateSurveys.int.test.js exists to protect. Refetching every loaded
      // page is the price of telling the truth, and it stays gapless: react-query recomputes each
      // page's skip from the refetched previous page, so the pages walk the NEW list.
      //
      // The response body (a full rebuilt voter profile, richer than anything this screen shows)
      // is deliberately discarded rather than seeded — invalidating keeps the extra PII out of the
      // cache.
      qc.invalidateQueries({ queryKey: ['admin', 'duplicate-surveys'] });
      // That id is a 404 now — remove, don't invalidate (an invalidate schedules a doomed refetch).
      qc.removeQueries({ queryKey: ['admin', 'response-details', responseId] });
      invalidateSurveyDeleteCaches(qc, { campaignId: cId, canvasserId, voterId });
    },
    onError: (err) => {
      const { title, message } = deleteErrorMessage(err);
      Alert.alert(title, message);
    },
  });

  function confirmDelete(response, dupe) {
    const prompt = buildDeletePrompt({
      dupe,
      response,
      formatTime: (at) => formatInTz(at, reportTz),
    });
    Alert.alert(prompt.title, prompt.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: prompt.confirmText,
        style: 'destructive',
        onPress: () =>
          delMut.mutate({
            voterId: dupe.voterId,
            responseId: response.responseId,
            canvasserId: response.canvasser?.userId,
          }),
      },
    ]);
  }

  // With keepPreviousData a FAILED refetch keeps the previous filters' rows on screen and
  // loadFailed stays false — so the list would pass stale data off as a fresh answer. The house
  // rule is that an error must never render as an authoritative zero on an audit surface; it must
  // not render as an authoritative non-zero either. staleAfterError is that fifth state.
  const loadFailed = !!cId && dupQ.isError && !dupQ.data;
  const loadingFirst = !!cId && !loadFailed && dupQ.isLoading;
  const emptyList = !!cId && !loadFailed && !loadingFirst && duplicates.length === 0;
  const hasList = !!cId && !loadFailed && !loadingFirst && duplicates.length > 0;
  const staleAfterError = !!cId && dupQ.isError && !!dupQ.data;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ {roleLabel}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Duplicate surveys</Text>
        <View style={{ width: 80 }} />
      </View>

      <View style={styles.chipWrap}>
        <CampaignChip value={campaign} onChange={setCampaign} />
      </View>
      <ArchivedCampaignBanner campaignId={cId} style={styles.bannerWrap} />

      <Text style={styles.intro}>
        Voters with more than one survey response. Same round · overwritten means a second submit
        replaced the first answers (preserved — open the response to restore). Same canvasser on
        the same day is usually a mistake; a later-round canvasser is usually a legitimate revisit.
      </Text>

      <DateRangeBar value={range} onChange={setRange} tz={tz} presets={PRESETS} />
      {head.tzAbbrev ? <Text style={styles.tzLine}>Dates &amp; times in {head.tzAbbrev}</Text> : null}

      {/* Filters live in the FIXED area above the scroller — a control that can empty the screen is
          never inside it. The canvasser strip is gated on the ROSTER, never on the report payload,
          so picking someone can't unmount the strip that clears them. */}
      <TabSwitcher tabs={KIND_TABS} activeKey={kind} onChange={setKind} />
      {canvasserTabs.length > 1 ? (
        <TabSwitcher tabs={canvasserTabs} activeKey={userId} onChange={setUserId} />
      ) : null}

      {/* flex:1 is MANDATORY: two TabSwitcher strips are flex siblings of this scroller, and
          without it Yoga crushes their 42pt pills to ~13pt the moment data arrives. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        <InsetGroup>
          {!cId ? <InsetNoteRow>Pick a campaign to see its duplicate surveys.</InsetNoteRow> : null}

          {loadFailed ? (
            <InsetNoteRow>
              Couldn&apos;t load duplicate surveys — {dupQ.error?.message || 'check your connection.'}
            </InsetNoteRow>
          ) : null}
          {loadFailed ? <InsetActionRow label="Try again" onPress={() => dupQ.refetch()} /> : null}

          {loadingFirst ? <InsetNoteRow loading /> : null}

          {emptyList ? (
            <InsetNoteRow>
              {filtered
                ? 'No duplicate surveys match these filters.'
                : `No duplicate surveys${
                    range.preset !== 'all' ? ` in ${labelForRange(range)}` : ''
                  } — every surveyed voter has exactly one response. 🎉`}
            </InsetNoteRow>
          ) : null}

          {hasList
            ? duplicates.map((d) => (
                <DuplicateVoterCard
                  key={d.voterId}
                  dupe={d}
                  tz={reportTz}
                  footer={
                    canDelete
                      ? null
                      : isAdmin
                        ? 'This campaign is archived, so its responses are read-only. Reactivate it from the web to make changes.'
                        : 'Only an organization admin can delete a response. Ask an admin to remove the extra one.'
                  }
                  onOpenVoter={(id) => router.push(`/(app)/voters/${id}?from=duplicates`)}
                  onOpenResponse={(r) =>
                    router.push({
                      pathname: '/(app)/admin/response-details',
                      params: { responseId: r.responseId, campaignId: cId },
                    })
                  }
                  renderResponseAction={
                    canDelete
                      ? (r, dupe) =>
                          r.overwritten ? (
                            // Already not current — nothing to delete. Restore lives on the
                            // response's detail screen (tap the row).
                            <Text style={styles.preserved}>Preserved</Text>
                          ) : (
                            <Pressable
                              onPress={() => confirmDelete(r, dupe)}
                              disabled={delMut.isPending}
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel={`Delete this response`}
                            >
                              <Text style={[styles.delete, delMut.isPending && styles.deleteOff]}>
                                {busyId === r.responseId ? 'Deleting…' : 'Delete'}
                              </Text>
                            </Pressable>
                          )
                      : null
                  }
                />
              ))
            : null}

          {hasList && dupQ.hasNextPage ? (
            <InsetActionRow
              label={
                dupQ.isFetchingNextPage
                  ? 'Loading…'
                  : `Load more (${Math.max(0, total - duplicates.length)} left)`
              }
              disabled={dupQ.isFetchingNextPage}
              onPress={() => dupQ.fetchNextPage()}
            />
          ) : null}
        </InsetGroup>

        {staleAfterError ? (
          <GroupFooter>Couldn&apos;t refresh — showing the last results that loaded.</GroupFooter>
        ) : null}
        {hasList ? (
          <GroupFooter>
            {total.toLocaleString()} voter{total === 1 ? '' : 's'} with more than one response. One
            survey per voter per round is enforced, so these are historical, cross-round revisits,
            or same-round overwrites — where the replaced answers are preserved and restorable.
          </GroupFooter>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// Every cache one survey-response delete moves. The delete removes a SurveyResponse row and bumps
// Campaign.stats.surveyCount by -1, so: anything counting response ROWS live, plus the stats-backed
// overview. Deliberately NOT campaign-rollup (mobile renders only knocks / surveyedKnocks /
// surveyedVoters from it, none of which move for a DUPLICATE delete — the voter keeps >=1 response
// and the survey_submitted CanvassActivity row is untouched) and NOT ['bootstrap'] (an admin write
// there collides with reconcilePendingHouseholds, whose job is to stop non-canvasser writes
// clobbering optimistic pin state).
function invalidateSurveyDeleteCaches(qc, { campaignId, canvasserId, voterId }) {
  qc.invalidateQueries({
    predicate: (q) => {
      const [a, b, c, d] = q.queryKey || [];
      if (a === 'mobile' && b === 'voter' && String(c) === String(voterId)) return true;
      if (a !== 'admin') return false;
      // /reports/canvassers counts surveysSubmitted live; both key shapes read it.
      if (b === 'report-canvassers') return String(c) === String(campaignId);
      // /canvassers/:id/summary does a live countDocuments — only this canvasser moved.
      if (b === 'canvasser') return String(c) === String(canvasserId);
      // The answer drills would still list a response that now 404s.
      if (b === 'answer-voters' || b === 'answer-canvassers') return true;
      if (b !== 'reports') return false;
      return (
        (c === 'canvassers' || c === 'survey-results' || c === 'overview') &&
        String(d) === String(campaignId)
      );
    },
  });
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
    intro: { ...type.caption, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    tzLine: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      fontSize: 11,
      color: colors.textSecondary,
    },
    delete: { fontSize: 12, fontWeight: '700', color: colors.danger, paddingHorizontal: spacing.sm },
    preserved: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, paddingHorizontal: spacing.sm },
    deleteOff: { opacity: 0.4 },
  });
}
