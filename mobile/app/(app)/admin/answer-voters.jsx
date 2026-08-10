import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { saveActiveCampaign } from '../../../lib/cache';
import InsetGroup, {
  InsetRow,
  InsetNavRow,
  InsetActionRow,
  InsetNoteRow,
  InsetTitleRow,
  GroupFooter,
} from '../../../components/InsetGroup';
import TabSwitcher from '../../../components/TabSwitcher';
import { deviceTimezone } from '../../../lib/dateRanges';
import { formatInTz, timeAgo } from '../../../lib/datetime';
import { radius, spacing } from '../../../lib/theme';
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
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams();
  const campaignId = one(params.campaignId);
  const questionKey = one(params.questionKey);
  const option = one(params.option);
  const optionId = one(params.optionId);
  const label = one(params.label);
  const surveyTemplateId = one(params.surveyTemplateId);
  // TAG mode: a cross-question drill — `tag` + the template id replace questionKey/option.
  // The list is still response-unit entries; the by-team group below is the voter-unit split.
  const tag = one(params.tag);
  const byTag = !!tag;
  // Round scope, forwarded by whoever opened this drill. Absent = all rounds.
  const passId = one(params.passId);
  // Crew scope, forwarded the same way — the drill's total must match the count that was
  // tapped, which is crew-scoped when the campaign screen has a crew picked.
  const coordinatorId = one(params.coordinatorId);
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
  const paramsKey = `${campaignId}|${questionKey}|${optionId}|${option}|${tag}|${surveyTemplateId}|${passId}|${coordinatorId}|${from}|${to}`;
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
    queryKey: ['admin', 'answer-voters', campaignId, questionKey, optionId, option, tag, surveyTemplateId, passId, coordinatorId, canvasserId, from, to, skip],
    queryFn: () => {
      const p = new URLSearchParams({
        campaignId,
        tz: deviceTimezone(),
        limit: String(PAGE),
        skip: String(skip),
      });
      // Tag mode swaps the option identity for the cross-question one; the server's
      // buildVotersByAnswerFilter requires the template id to resolve the tag's members.
      if (byTag) {
        p.set('tag', tag);
      } else {
        p.set('questionKey', questionKey);
        p.set('option', option ?? '');
        if (optionId) p.set('optionId', optionId);
      }
      if (surveyTemplateId) p.set('surveyTemplateId', surveyTemplateId);
      if (passId) p.set('passId', passId);
      if (coordinatorId) p.set('coordinatorId', coordinatorId);
      if (canvasserId) p.set('userId', canvasserId);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return api(`/admin/reports/voters-by-answer?${p.toString()}`);
    },
    enabled: !!campaignId && (byTag ? !!surveyTemplateId : !!questionKey && option != null),
  });

  // Per-canvasser breakdown for this option — powers the "By canvasser" tab AND
  // the canvasser filter menu (its rows are the only canvassers worth listing).
  // DISABLED in tag mode: the server 400s it by design (a distinct-voter rollup has no
  // honest per-canvasser sum), and a designed refusal must never render as an error here.
  const canvassersQ = useQuery({
    queryKey: ['admin', 'answer-canvassers', campaignId, questionKey, optionId, option, surveyTemplateId, passId, coordinatorId, from, to],
    queryFn: () => {
      const p = new URLSearchParams({
        campaignId,
        questionKey,
        option: option ?? '',
        tz: deviceTimezone(),
      });
      if (optionId) p.set('optionId', optionId);
      if (surveyTemplateId) p.set('surveyTemplateId', surveyTemplateId);
      if (passId) p.set('passId', passId);
      if (coordinatorId) p.set('coordinatorId', coordinatorId);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return api(`/admin/reports/answer-canvassers?${p.toString()}`);
    },
    enabled: !byTag && !!campaignId && !!questionKey && option != null,
  });
  const canvasserRows = canvassersQ.data?.rows || [];

  // The by-team split for a tag drill — first-finder credit, so teams + "No team" add up
  // exactly to the campaign line, both units. Hidden entirely when the org's team backfill
  // hasn't run (ready:false) or on error — never an authoritative-looking zero table.
  const tagTeamsQ = useQuery({
    queryKey: ['admin', 'tag-teams', campaignId, tag, surveyTemplateId, passId, coordinatorId, from, to],
    queryFn: () => {
      const p = new URLSearchParams({ campaignId, tag, tz: deviceTimezone() });
      if (surveyTemplateId) p.set('surveyTemplateId', surveyTemplateId);
      if (passId) p.set('passId', passId);
      if (coordinatorId) p.set('coordinatorId', coordinatorId);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return api(`/admin/reports/tag-teams?${p.toString()}`);
    },
    enabled: byTag && !!campaignId && !!surveyTemplateId,
  });
  const tagTeams = tagTeamsQ.data?.ready ? tagTeamsQ.data : null;

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
        {/* No map link in tag mode — the map endpoint's answer filter is per question+option
            only, so the link would silently drop the drill's identity (the web minimap rule). */}
        {campaign && !byTag ? (
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
          {byTag ? 'Tag' : `“${option}”`} ·{' '}
          {q.error && !q.data
            ? '—'
            : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'} — one per round`}
        </Text>

        {/* Tag mode has no By-canvasser tab: tags count distinct voters across questions, which
            have no per-canvasser sum (the server refuses it by design). Say so instead. */}
        {byTag ? (
          <Text style={styles.tagCaption}>
            Tags count distinct voters across questions, so there's no per-canvasser breakdown.
          </Text>
        ) : (
          /* Negative margin cancels the content padding — TabSwitcher carries its own. */
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
        )}

        {/* The by-team split (tag mode only): first-finder credit, so the rows + "No team" add
            up exactly to the Campaign line. Absent until the org's team backfill has run. */}
        {byTag && tagTeams && (tagTeams.teams || []).length > 0 ? (
          <View style={{ marginBottom: spacing.md }}>
            <InsetGroup>
              <InsetTitleRow title="By team" />
              {(tagTeams.teams || []).map((t) => (
                <InsetRow
                  key={t.coordinatorId}
                  label={t.coordinatorName || 'Team'}
                  value={(t.identifiedVoters || 0).toLocaleString()}
                  sub={`${(t.currentVoters || 0).toLocaleString()} still current`}
                />
              ))}
              {(tagTeams.noTeam?.identifiedVoters || 0) > 0 ? (
                <InsetRow
                  label="No team"
                  value={(tagTeams.noTeam.identifiedVoters || 0).toLocaleString()}
                  sub={`${(tagTeams.noTeam.currentVoters || 0).toLocaleString()} still current`}
                />
              ) : null}
              <InsetRow
                label="Campaign"
                value={(tagTeams.totals?.identifiedVoters || 0).toLocaleString()}
                sub={`${(tagTeams.totals?.currentVoters || 0).toLocaleString()} still current`}
              />
            </InsetGroup>
            <GroupFooter>
              Each voter is credited to the team whose canvasser tagged them first, so the team
              rows add up exactly to the Campaign line. “No team” is voters first tagged by
              someone with no crew.
            </GroupFooter>
          </View>
        ) : null}

        {byTag || tab === 'voters' ? (
          <>
            {/* `|| canvasserId` so the chip can never unmount while a filter is applied: the rows
                behind it come from a query a picked canvasser narrows, and a background refetch
                that empties them would otherwise leave no way to clear it. */}
            {canvasserRows.length > 0 || canvasserId ? (
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

            <InsetGroup>
              {items.map((v) => {
                // One response entry ({ responseId, submittedAt, voter, household,
                // canvasser } from /voters-by-answer). Name + party on the label line,
                // address then meta (when · who · offline/note tags) stacked in the sub;
                // the exact campaign-tz time rides the value column.
                const canv = v.canvasser
                  ? ` · ${v.canvasser.firstName || ''}${v.canvasser.lastName ? ' ' + v.canvasser.lastName[0] + '.' : ''}`
                  : '';
                const meta = `${timeAgo(v.submittedAt)}${canv}${v.wasOfflineSubmission ? ' · offline' : ''}${v.note ? ' · note' : ''}`;
                const address = v.household
                  ? `${v.household.addressLine1}${v.household.city ? `, ${v.household.city}` : ''}`
                  : '';
                return (
                  <InsetNavRow
                    key={v.responseId}
                    label={`${v.voter?.fullName || 'Unknown voter'}${v.voter?.party ? ` · ${v.voter.party}` : ''}`}
                    labelLines={1}
                    sub={address ? `${address}\n${meta}` : meta}
                    value={formatInTz(v.submittedAt, tz)}
                    hint="Opens the full response"
                    onPress={() =>
                      router.push({
                        pathname: '/(app)/admin/response-details',
                        params: { responseId: v.responseId, campaignId },
                      })
                    }
                  />
                );
              })}

              {q.isLoading && items.length === 0 ? (
                <InsetNoteRow loading>Loading…</InsetNoteRow>
              ) : q.error && items.length === 0 ? (
                // An error must never render as an authoritative zero on an audit surface.
                <InsetNoteRow>{q.error.message}</InsetNoteRow>
              ) : items.length === 0 ? (
                <InsetNoteRow>{byTag ? 'No voters with this tag.' : 'No voters for this answer.'}</InsetNoteRow>
              ) : items.length < total ? (
                q.isFetching ? (
                  <InsetNoteRow loading>Loading more…</InsetNoteRow>
                ) : (
                  <InsetActionRow label={`Load more (${total - items.length} left)`} onPress={() => setSkip(items.length)} />
                )
              ) : null}
            </InsetGroup>
          </>
        ) : (
          <InsetGroup>
            {canvassersQ.isLoading ? (
              <InsetNoteRow loading>Loading…</InsetNoteRow>
            ) : canvassersQ.error ? (
              <InsetNoteRow>{canvassersQ.error.message}</InsetNoteRow>
            ) : canvasserRows.length === 0 ? (
              <InsetNoteRow>No canvassers recorded this answer.</InsetNoteRow>
            ) : (
              // Tapping re-filters the voters list and flips back to that tab — a nav
              // row all the same: the value column (the count) is owned by the list the
              // tap reveals, which is exactly the InsetNavRow discriminator.
              canvasserRows.map((r, i) => (
                <InsetNavRow
                  key={r.userId}
                  leading={<Text style={styles.rank}>{i + 1}</Text>}
                  label={`${r.firstName} ${r.lastName}`.trim() || 'Unknown'}
                  labelLines={1}
                  sub={[
                    r.status === 'deleted' ? 'removed' : null,
                    `${r.pctOfOwnAnswers}% of their answers on this question`,
                    r.lastAt ? `last entry ${timeAgo(r.lastAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={r.count}
                  hint="Shows this canvasser's voters"
                  onPress={() => { setCanvasserId(String(r.userId)); setTab('voters'); }}
                />
              ))
            )}
          </InsetGroup>
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
  title: { ...type.h2, marginTop: spacing.xs },
  subtitle: { ...type.caption, marginBottom: spacing.md },
  // Tag mode's stand-in for the By-canvasser tab — the "why there isn't one" line.
  tagCaption: { ...type.caption, color: colors.textMuted, marginBottom: spacing.md },

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
  menuItemText: { flex: 1, ...type.body },
  menuItemTextActive: { color: colors.brand, fontWeight: '700' },
  menuCheck: { color: colors.brand, fontWeight: '700' },

  // The By-canvasser rows' leading rank ordinal.
  rank: { ...type.caption, color: colors.textMuted, fontWeight: '700', width: 22, textAlign: 'center' },
  });
}
