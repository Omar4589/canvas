import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { saveActiveCampaign, clearBootstrap } from '../../../../lib/cache';
import CoverageBar from '../../../../components/CoverageBar';
import SectionHeader from '../../../../components/SectionHeader';
import TabSwitcher from '../../../../components/TabSwitcher';
import NavTileGrid from '../../../../components/NavTileGrid';
import DateRangeBar from '../../../../components/DateRangeBar';
import CanvasserCard from '../../../../components/CanvasserCard';
import InsetGroup, {
  InsetHeroRow,
  InsetRow,
  InsetNavRow,
  InsetActionRow,
  InsetTitleRow,
  InsetBlockRow,
  InsetNoteRow,
  RowBar,
  GroupFooter,
} from '../../../../components/InsetGroup';
import MetricSheet from '../../../../components/MetricSheet';
import ElectionCountdownChip from '../../../../components/ElectionCountdownChip';
import { rangeFor, deviceTimezone, labelForRange } from '../../../../lib/dateRanges';
import { rateFromPct, makeRateColors, tierWord } from '../../../../lib/rates';
import { metricHelp } from '../../../../lib/metricHelp';
import { radius, spacing } from '../../../../lib/theme';
import { useTheme } from '../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../lib/useThemedStyles';

// The local OptionRow is gone: a survey answer that drills into its voters is an InsetNavRow
// with a RowBar accessory. Two things it got wrong are fixed by the move — its label was
// numberOfLines={1} so long answers truncated, and its bar had a 2% minimum width, which
// painted a visible sliver on a genuine 0% (reading as "a few" when the truth is "none").

export default function CampaignDetail() {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();
  const { campaignId } = useLocalSearchParams();
  const cId = Array.isArray(campaignId) ? campaignId[0] : campaignId;

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });
  const campaign = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(cId)) || null;
  const isLitDrop = campaign?.type === 'lit_drop';
  const isArchived = campaign && campaign.isActive === false;

  // Device tz fallback so the screen loads immediately; refined to the campaign tz (and to
  // all-time for an archived campaign) once campaignsQ resolves (below).
  const tz = campaign?.timeZone || deviceTimezone();

  const [range, setRange] = useState(() => {
    const r = rangeFor('today', null, deviceTimezone());
    return { preset: 'today', from: r.from, to: r.to };
  });
  const rangeTouchedRef = useRef(false);
  function onRangeChange(v) {
    rangeTouchedRef.current = true;
    setRange(v);
  }

  // Refine into the campaign tz once campaignsQ resolves, until the admin picks a range.
  // Archived campaigns have no recent activity → all-time; active → today. (range is seeded
  // with the device tz above so the screen never blocks.)
  useEffect(() => {
    if (rangeTouchedRef.current || !campaign) return;
    const preset = campaign.isActive === false ? 'all' : 'today';
    const r = rangeFor(preset, null, tz);
    setRange({ preset, from: r.from, to: r.to });
  }, [tz, campaign]);

  function rangeParams(extra = {}) {
    const p = new URLSearchParams({ campaignId: cId, tz: deviceTimezone(), ...extra });
    if (range?.from) p.set('from', range.from);
    if (range?.to) p.set('to', range.to);
    return p;
  }

  // Walk-list roster for the scoping pills (same source Timeline uses).
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/efforts`),
    enabled: !!cId,
  });
  const efforts = effortsQ.data?.efforts || [];
  // Walk-list scoping for Activity, By pass, Coverage, and Top canvassers. '' = all.
  // Applied SERVER-SIDE (baseFilter's ?effortId) on the overview, rollup, canvassers, and
  // knocks-by-pass queries; survey results keep their own per-(walk list · pass) chips.
  // No reset on campaign change — this is a pushed drill-in that remounts per campaign
  // (surveyPassId below already leans on the same fact).
  const [effortId, setEffortId] = useState('');
  const effortParam = effortId ? { effortId } : {};

  const overviewQ = useQuery({
    queryKey: ['admin', 'reports', 'overview', cId, effortId],
    queryFn: () => api(`/admin/reports/overview?campaignId=${cId}${effortId ? `&effortId=${effortId}` : ''}`),
    enabled: !!cId,
  });
  const canvassersQ = useQuery({
    queryKey: ['admin', 'reports', 'canvassers', cId, range?.from, range?.to, effortId],
    queryFn: () => api(`/admin/reports/canvassers?${rangeParams(effortParam).toString()}`),
    enabled: !!cId && !!range,
  });
  // Roster for the coordinator label (shared cache with Books/Timeline).
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
  });
  // Round scoping for the survey results. '' = all rounds. A Pass _id, never a round NUMBER:
  // roundNumber restarts per walk list, so "Pass 2" names a different round in each one.
  const [surveyPassId, setSurveyPassId] = useState('');
  const surveyResultsQ = useQuery({
    queryKey: ['admin', 'reports', 'survey-results', cId, range?.from, range?.to, surveyPassId],
    queryFn: () =>
      api(
        `/admin/reports/survey-results?${rangeParams({
          voterPreview: '5',
          ...(surveyPassId ? { passId: surveyPassId } : {}),
        }).toString()}`
      ),
    enabled: !!cId && !isLitDrop && !!range,
  });
  // In-range totals from the same rollup the landing uses (deduped door-days),
  // so the detail's numbers match the Overview exactly.
  const rollupQ = useQuery({
    queryKey: ['admin', 'reports', 'campaign-rollup', 'one', cId, range?.from, range?.to, effortId],
    queryFn: () => api(`/admin/reports/campaign-rollup?${rangeParams(effortParam).toString()}`),
    enabled: !!cId && !!range,
  });
  // Per-round knocks (walk list × round) over the SAME window — the billing
  // pipeline's rows, so they sum exactly to the invoice. Server sorts: walk list
  // asc, round asc, legacy last. Follows the walk-list filter so the By-pass rows
  // reconcile against the (also filtered) Activity knocks above them.
  const roundsQ = useQuery({
    queryKey: ['admin', 'reports', 'knocks-by-pass', cId, range?.from, range?.to, effortId],
    queryFn: () => api(`/admin/reports/knocks-by-pass?${rangeParams(effortParam).toString()}`),
    enabled: !!cId && !!range,
  });

  const totals = overviewQ.data?.totals || {};
  const canvass = overviewQ.data?.canvass || {};
  const rangeStats = rollupQ.data?.campaigns?.[0] || {};
  const rangeKnocks = rangeStats.knocks || 0;
  // Survey DOORS (the connection-rate numerator), not voters — the tile used to show
  // surveysSubmitted (voters) under a bare "Surveys", so the rate beside it couldn't be checked
  // from the screen's own numbers. Voters keep their own tile ("Surveyed voters") below.
  const rangePrimary = isLitDrop ? rangeStats.litDropped || 0 : rangeStats.surveyedKnocks || 0;
  const rangeRate = rateFromPct(rangeStats.connectionRate);

  // Which "how these are counted" sheet is open, or null. One state for the whole screen —
  // Activity and Top canvassers both feed the single <MetricSheet> at the bottom.
  const [sheet, setSheet] = useState(null);
  const rateColors = makeRateColors(colors);
  const loadingActivity = rollupQ.isLoading;

  // ONE description of the Activity numbers: the rows render from it and the sheet explains
  // from it, so a label can never end up next to a different metric's definition (they used
  // to be typed out twice). `help` is metricHelp verbatim — no copy is restated here.
  const activityMetrics = useMemo(() => {
    const rate = rangeRate;
    const m = [
      {
        key: 'knocks',
        label: 'Knocks',
        value: rangeKnocks.toLocaleString(),
        unit: 'doors',
        help: metricHelp.doors,
      },
      {
        key: 'primary',
        label: isLitDrop ? 'Lit drops' : 'Survey doors',
        value: rangePrimary.toLocaleString(),
        // `rangePrimary` is `litDropped` on a lit campaign — the raw count of drop ACTIONS,
        // not doors. Calling its unit "doors" (and describing it with metricHelp.litDrops,
        // which says "once per door per pass") labelled it as a number it is not: that copy
        // describes `litKnocks`, a different server field, and litKnocks is also what the lit
        // rate actually divides by. Unit and help now match the field that is printed.
        unit: isLitDrop ? 'drops' : 'houses',
        help: isLitDrop ? metricHelp.litDropEvents : metricHelp.surveyDoors,
      },
    ];
    if (!isLitDrop) {
      m.push({
        key: 'voters',
        label: 'Surveyed voters',
        value: (rangeStats.surveyedVoters || 0).toLocaleString(),
        unit: 'people',
        help: metricHelp.surveyedVoters,
      });
    }
    m.push({
      key: 'rate',
      label: isLitDrop ? 'Lit rate' : 'Connection rate',
      value: rate?.value ?? '—',
      level: rate?.level,
      // The tier as a WORD plus the fraction it came from — and on a SURVEY campaign both
      // operands are already printed in the rows above, so the rate is checkable without
      // opening anything. On a LIT campaign the row above prints drop events, not the doors
      // the rate divides by, so printing a fraction here would assert an equation the screen
      // cannot support: the tier word stands alone instead.
      sub: rate
        ? isLitDrop
          ? tierWord(rate.level)
          : `${tierWord(rate.level)} · ${rangePrimary.toLocaleString()} of ${rangeKnocks.toLocaleString()} doors`
        : null,
      math:
        rate && !isLitDrop
          ? `${rangePrimary.toLocaleString()} survey doors ÷ ${rangeKnocks.toLocaleString()} knocks = ${rate.value}`
          : null,
      help: metricHelp.connectionRate,
    });
    return m;
  }, [isLitDrop, rangeKnocks, rangePrimary, rangeStats.surveyedVoters, rangeRate]);

  // The Top-canvassers column key. Same shape as activityMetrics minus the live values —
  // these explain a table's columns, not four numbers on screen.
  const canvasserMetrics = useMemo(
    () => [
      { key: 'doors', label: 'Doors', help: metricHelp.doors },
      {
        key: 'primary',
        label: isLitDrop ? 'Lit drops' : 'Survey doors',
        // CanvasserCard's lit column is `dayLit` ← `c.litDropped`, i.e. drop EVENTS. Same
        // field/definition mismatch as the Activity row above — see the note there.
        help: isLitDrop ? metricHelp.litDropEvents : metricHelp.surveyDoors,
      },
      ...(isLitDrop ? [] : [{ key: 'voters', label: 'Surveyed voters', help: metricHelp.surveyedVoters }]),
      { key: 'conn', label: 'Conn %', help: metricHelp.connectionRate },
      { key: 'contact', label: 'Contact %', help: metricHelp.contactRate },
      { key: 'pace', label: 'Doors / hr', help: metricHelp.doorsPerHour },
      { key: 'coordinator', label: 'Coordinator', help: metricHelp.coordinator },
      { key: 'span', label: 'Start / Last door', help: `${metricHelp.start} ${metricHelp.lastDoor}` },
    ],
    [isLitDrop]
  );

  const questions = surveyResultsQ.data?.questions || [];
  const rounds = roundsQ.data?.rounds || [];
  // Pass chips: "All passes" + every real Pass, plus the pre-turf bucket when one exists.
  // knocks-by-pass emits that bucket as a passId:null row ("Legacy / no pass") — without an option
  // for it those responses would sit in All passes and in no selectable pass, so the passes would
  // not add up to the headline. 'legacy' is the server-side sentinel for passId:null — an API value,
  // not a label, so it stays 'legacy' even though the display text now says "pass".
  const roundChipOptions = useMemo(() => {
    const real = rounds.filter((r) => r.passId);
    const opts = [{ passId: '', roundLabel: 'All passes' }, ...real];
    if (real.length && rounds.some((r) => !r.passId)) {
      opts.push({ passId: 'legacy', roundLabel: 'Legacy / no pass' });
    }
    return opts;
  }, [rounds]);

  // Top-5 canvassers normalized to the shared CanvasserCard shape: rename Doors/
  // Surveys/Lit, compute doors-per-hour from first→last, join the coordinator.
  const coordByUserId = useMemo(() => {
    const m = new Map();
    for (const a of assignmentsQ.data?.assignments || []) {
      m.set(String(a.userId), a.coordinatorName || null);
    }
    return m;
  }, [assignmentsQ.data]);
  const topCanvasserRows = useMemo(() => {
    // Re-sort by the DOOR count this card actually displays. /admin/reports/canvassers sorts by
    // surveysSubmitted (response rows); once the card switched to surveyKnocks (survey doors) the
    // displayed number stopped being the sort key, so a top-5 taken off the server order could
    // render visibly out of order.
    return [...(canvassersQ.data || [])]
      .sort((a, b) => (b.surveyKnocks ?? 0) - (a.surveyKnocks ?? 0) || (b.knocks ?? 0) - (a.knocks ?? 0))
      .slice(0, 5)
      .map((c) => {
      const dayKnocks = c.knocks ?? c.homesKnocked ?? 0;
      const first = c.firstActivityAt ? new Date(c.firstActivityAt).getTime() : null;
      const last = c.lastActivityAt ? new Date(c.lastActivityAt).getTime() : null;
      const hours = first && last ? (last - first) / 3600000 : 0;
      return {
        ...c,
        dayKnocks,
        // Survey DOORS, matching the web leaderboard (DashboardPage maps `surveyKnocks` here too)
        // and `canvasserMetrics` below, which labels this column "Survey doors". It read
        // `surveysSubmitted` — a VOTER-unit count in a door-unit slot, so the card's own
        // server-computed connectionRate (built from surveyKnocks) could not be checked against the
        // number printed beside it.
        daySurveys: c.surveyKnocks ?? 0,
        dayLit: c.litDropped ?? 0,
        hoursOnDoors: Math.round(hours * 100) / 100,
        doorsPerHour: hours > 0 ? Math.round((dayKnocks / hours) * 100) / 100 : 0,
        coordinatorName: coordByUserId.get(String(c.userId)) || null,
      };
    });
  }, [canvassersQ.data, coordByUserId]);

  function goVoters(qn, opt) {
    // Scope the drill to the SAME template these on-screen counts came from.
    const tplId = surveyResultsQ.data?.surveyTemplate?.id;
    router.push({
      pathname: '/(app)/admin/answer-voters',
      params: {
        campaignId: cId,
        questionKey: qn.key,
        option: String(opt.option),
        optionId: String(opt.id ?? ''),
        label: qn.label,
        ...(tplId ? { surveyTemplateId: String(tplId) } : {}),
        // Carry the ROUND. The on-screen option count is round-scoped when a chip is active, and
        // the drill must sum to it — the counting contract /answer-canvassers is built on.
        ...(surveyPassId ? { passId: String(surveyPassId) } : {}),
        ...(range?.from ? { from: range.from } : {}),
        ...(range?.to ? { to: range.to } : {}),
      },
    });
  }

  async function goCanvass() {
    if (!campaign) return;
    await saveActiveCampaign({ id: String(campaign._id), name: campaign.name, type: campaign.type, state: campaign.state, timeZone: campaign.timeZone });
    await clearBootstrap();
    qc.removeQueries({ queryKey: ['bootstrap'] });
    // Enter the canvasser flow (book picker), scoped to this admin's own books.
    router.push('/(app)/books');
  }

  // Set this campaign active, then open the Timeline tab (which reads the active
  // campaign via CampaignChip + a focus re-sync) so "See all" lands on THIS crew.
  async function goTimeline() {
    if (!campaign) return;
    await saveActiveCampaign({ id: String(campaign._id), name: campaign.name, type: campaign.type, state: campaign.state, timeZone: campaign.timeZone });
    router.push('/(app)/admin/timeline');
  }

  // Set this campaign active, then open the GPS audit screen (it reads the active campaign).
  async function goAudit() {
    if (!campaign) return;
    await saveActiveCampaign({ id: String(campaign._id), name: campaign.name, type: campaign.type, state: campaign.state, timeZone: campaign.timeZone });
    router.push('/(app)/admin/audit');
  }

  // Set this campaign active, then open the Notes hub (it reads the active campaign).
  async function goNotes() {
    if (!campaign) return;
    await saveActiveCampaign({ id: String(campaign._id), name: campaign.name, type: campaign.type, state: campaign.state, timeZone: campaign.timeZone });
    router.push('/(app)/admin/notes');
  }

  if (campaignsQ.data && !campaign) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
            <Text style={styles.back}>‹ Overview</Text>
          </Pressable>
        </View>
        <View style={styles.centered}>
          <Text style={type.body}>Campaign not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Left-aligned, back link on its own line. The old centered title needed a magic
          `width: 64` spacer to balance the back link — a number that was already recorded in
          this file as having wrapped '‹ Overvie / w' once — and squeezed the campaign name into
          ~230pt. Left-aligned it gets the full width and two lines, so a name like
          "Springfield City Council 2026" no longer truncates. */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
          <Text style={styles.back}>‹ Overview</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={2}>{campaign?.name || 'Campaign'}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {isArchived && (
          <View style={[styles.banner, { marginHorizontal: spacing.lg }]}>
            <Text style={styles.bannerText}>
              This campaign is archived — data is read-only. Reactivate it from the web to resume canvassing.
            </Text>
          </View>
        )}

        {campaign && (
          <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm }}>
            <ElectionCountdownChip
              electionDay={campaign.electionDay}
              earlyVotingStart={campaign.earlyVotingStart}
              earlyVotingEnd={campaign.earlyVotingEnd}
              timeZone={campaign.timeZone}
              datesNote={campaign.datesNote}
              showNote
            />
          </View>
        )}

        <DateRangeBar value={range} onChange={onRangeChange} tz={tz} />

        {/* Walk-list filter (Timeline's pattern) — only worth showing once a campaign HAS a
            second walk list. Switching lists also clears any picked survey pass: the pass
            chips below draw from the (now filtered) By-pass rows, so a pass from another
            walk list would keep scoping the survey numbers with no visible chip saying so. */}
        {efforts.length > 1 && (
          <TabSwitcher
            tabs={[
              { key: '', label: 'All walk lists' },
              ...efforts.map((ef) => ({ key: String(ef._id), label: ef.name })),
            ]}
            activeKey={effortId}
            onChange={(k) => {
              setEffortId(k);
              setSurveyPassId('');
            }}
          />
        )}

        <View style={{ paddingHorizontal: spacing.lg }}>
          {/* Activity in range. The hero is Knocks: the rate's own operands are the survey-door
              count and the knock count, so leading with the denominator lets the fraction read
              straight down the group. Loading renders the group with em-dashes rather than
              swapping in a spinner, so nothing jumps when the numbers land. */}
          <SectionHeader title="Activity" subtitle={range ? labelForRange(range) : null} />
          <InsetGroup>
            {activityMetrics.map((m, i) =>
              i === 0 ? (
                <InsetHeroRow key={m.key} label={m.label} value={loadingActivity ? '—' : m.value} />
              ) : (
                <InsetRow
                  key={m.key}
                  label={m.label}
                  unit={m.level ? null : m.unit}
                  sub={loadingActivity ? null : m.sub}
                  value={loadingActivity ? '—' : m.value}
                  chipColors={!loadingActivity && m.level ? rateColors[m.level] : null}
                />
              )
            )}
            <InsetActionRow
              label="How these are counted"
              onPress={() => setSheet({ title: 'How these are counted', items: activityMetrics })}
            />
          </InsetGroup>
          <GroupFooter>
            {isLitDrop
              ? 'Lit rate is doors that got literature ÷ knocks — counted once per door per pass, so it is not the drop count above. '
              : 'Connection rate is survey doors ÷ knocks. '}
            20% or better is on target.
          </GroupFooter>

          {/* By pass (range) — one row per walk list × pass from the billing pipeline */}
          <SectionHeader title="By pass" subtitle="Knocks per walk-list pass in range" />
          {/* Every state is a one-row group, so the section keeps its silhouette instead of
              becoming a differently-shaped card the moment the network hiccups. */}
          {roundsQ.isLoading ? (
            <InsetGroup>
              <InsetNoteRow loading />
            </InsetGroup>
          ) : roundsQ.error ? (
            // A failed fetch (weak signal, or an old server during the OTA window) must
            // never render as an authoritative zero on a billing surface.
            <InsetGroup>
              <InsetNoteRow>Couldn't load passes — {roundsQ.error.message}</InsetNoteRow>
            </InsetGroup>
          ) : rounds.length === 0 ? (
            <InsetGroup>
              <InsetNoteRow>No passes yet.</InsetNoteRow>
            </InsetGroup>
          ) : (
            <>
              {/* The rate moves into the label's sub-line so the right column is exactly one
                  tabular number per row — a stacked percentage there broke the digit column
                  and put a rate where the eye is scanning door counts. */}
              <InsetGroup>
                {rounds.map((r, i) => {
                  const rate = rateFromPct(r.connectionRate);
                  return (
                    <InsetRow
                      key={r.passId || `legacy-${i}`}
                      label={r.effortName || r.roundLabel}
                      sub={r.effortName ? `${r.roundLabel} · ` : ''}
                      subAccent={`${isLitDrop ? 'Lit' : 'Conn'} ${r.connectionRate ?? 0}%`}
                      accentColor={rate ? rateColors[rate.level].deep : null}
                      value={(r.knocks || 0).toLocaleString()}
                    />
                  );
                })}
              </InsetGroup>
              <GroupFooter>
                Each row is one walk-list pass. Passes add up to the {rangeKnocks.toLocaleString()} above
                — a home knocked again in a later pass counts again.
              </GroupFooter>
            </>
          )}

          {/* Coverage (all-time; effortId narrows it to one walk list's doors) */}
          <SectionHeader
            title="Coverage"
            subtitle={effortId ? 'All-time walk-list progress' : 'All-time campaign progress'}
          />
          <InsetGroup>
            <InsetRow
              label="Households"
              value={(totals.households ?? 0).toLocaleString()}
              sub={`${(totals.homesKnocked ?? 0).toLocaleString()} knocked`}
            />
            {/* The bar isn't a label/value pair, so it takes a block slot rather than
                pretending to be a row. */}
            <InsetBlockRow>
              <CoverageBar canvass={canvass} />
            </InsetBlockRow>
          </InsetGroup>
          {/* The definition that used to hide behind an (i) — now simply readable. */}
          <GroupFooter>{metricHelp.households}</GroupFooter>

          {/* Top canvassers (range) */}
          <SectionHeader title="Top canvassers" onSeeAll={goTimeline} />
          {/* One group holds the whole leaderboard: the cards go `bare` so the group draws the
              card once instead of five floating ones, and the explain row is no longer an
              orphan below them. They stay pressable — each still drills into its canvasser. */}
          <InsetGroup>
            {canvassersQ.isLoading ? (
              <InsetNoteRow loading />
            ) : topCanvasserRows.length === 0 ? (
              <InsetNoteRow>No activity in this range.</InsetNoteRow>
            ) : (
              topCanvasserRows.map((c, i) => (
                <CanvasserCard
                  key={c.userId}
                  bare
                  row={c}
                  tz={tz}
                  rank={i + 1}
                  litMode={isLitDrop}
                  onPress={() =>
                    router.push({
                      pathname: `/(app)/admin/canvasser/${c.userId}`,
                      params: {
                        // The profile screen must not depend on the cached active campaign —
                        // with an empty cache it white-screened (queries never enabled).
                        campaignId: cId,
                        ...(range?.from ? { from: range.from } : {}),
                        ...(range?.to ? { to: range.to } : {}),
                        ...(range?.preset ? { preset: range.preset } : {}),
                      },
                    })
                  }
                />
              ))
            )}
            {topCanvasserRows.length > 0 ? (
              <InsetActionRow
                label="How these are counted"
                onPress={() => setSheet({ title: 'What these columns mean', items: canvasserMetrics })}
              />
            ) : null}
          </InsetGroup>

          {/* Survey results */}
          {!isLitDrop && questions.length > 0 && (
            <>
              <SectionHeader
                title="Survey results"
                subtitle={`${surveyResultsQ.data?.totalResponses ?? 0} surveys taken`}
              />
              {/* Round filter. Only worth showing once a campaign HAS a second round — before that
                  "All rounds" is the only answer. Labelled per walk list because roundNumber
                  restarts in each one. */}
              {roundChipOptions.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.roundChips}
                >
                  {roundChipOptions.map(
                    (r) => {
                      const active = String(surveyPassId) === String(r.passId || '');
                      return (
                        <Pressable
                          key={r.passId || 'all'}
                          onPress={() => setSurveyPassId(r.passId || '')}
                          style={[styles.roundChip, active && styles.roundChipOn]}
                        >
                          <Text style={[styles.roundChipText, active && styles.roundChipTextOn]}>
                            {r.effortName ? `${r.effortName} · ` : ''}
                            {r.roundLabel}
                          </Text>
                        </Pressable>
                      );
                    }
                  )}
                </ScrollView>
              )}
              {questions.map((qn) => (
                <View key={qn.key} style={styles.qGroup}>
                  <InsetGroup>
                    {/* The question titles itself INSIDE its own card, so it can't compete
                        with the "Survey results" SectionHeader above it. */}
                    <InsetTitleRow title={qn.label} />
                    {qn.type === 'text' ? (
                      qn.options.length === 0 ? (
                        <InsetNoteRow>No free-text answers.</InsetNoteRow>
                      ) : (
                        qn.options.slice(0, 10).map((o, i) => (
                          <InsetRow
                            key={i}
                            label={`“${o.option}”`}
                            unit={`${o.count} ${o.count === 1 ? 'response' : 'responses'}`}
                          />
                        ))
                      )
                    ) : (
                      // An answer that drills into the voters who gave it: a data row that
                      // NAVIGATES, so it gets a real chevron rather than the `›` that used to
                      // be smuggled into the count string. The share bar is the row's
                      // accessory, full-width — a proportional bar loses data when squeezed.
                      qn.options.map((o) => (
                        <InsetNavRow
                          key={String(o.option)}
                          label={String(o.option)}
                          value={`${o.count} · ${o.percent}%`}
                          hint="Opens the voters who gave this answer"
                          accessory={<RowBar pct={o.percent} />}
                          onPress={() => goVoters(qn, o)}
                        />
                      ))
                    )}
                  </InsetGroup>
                </View>
              ))}
            </>
          )}

          {/* Quick actions */}
          <SectionHeader title="Quick actions" />
          <View style={styles.quickActions}>
            <NavTileGrid
              items={[
                { label: 'Live map', subtitle: 'Doors & canvasser pings', onPress: () => router.push('/(app)/admin/map') },
                { label: 'GPS audit', subtitle: 'Review flagged entries', badge: campaign?.openMockFlags || 0, onPress: goAudit },
                { label: 'Notes', subtitle: 'Door, survey & admin notes', onPress: goNotes },
                // "Team" opens the Users hub pre-filtered to this campaign — the old
                // standalone Team page merged into Users (one people surface, lead-scoped
                // server-side, so it is safe for every console role).
                { label: 'Team', subtitle: 'Crew & assignments', onPress: () => router.push(`/(app)/admin/users?campaignId=${cId}`) },
              ]}
            />
          </View>

          {!isArchived && (
            <Pressable onPress={goCanvass} style={({ pressed }) => [styles.canvassButton, { opacity: pressed ? 0.85 : 1 }]}>
              <Text style={styles.canvassButtonText}>Switch to canvass mode</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* One sheet for the whole screen — Activity and Top canvassers both open it. */}
      <MetricSheet
        visible={!!sheet}
        title={sheet?.title}
        items={sheet?.items || []}
        onClose={() => setSheet(null)}
      />
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // Stacked, left-aligned: back link, then the title on its own line with the full width.
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  back: { ...type.caption, color: colors.brand, fontWeight: '600', alignSelf: 'flex-start' },
  headerTitle: { ...type.title, marginTop: 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  banner: {
    backgroundColor: colors.warnBg,
    borderColor: colors.warnBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  bannerText: { ...type.caption, color: colors.warnFg, fontWeight: '600' },

  // Chips deliberately mirror DateRangeBar's pills — same paddings, same active treatment.
  // Two pill rows on one screen that don't match each other is worse than either shape.
  // (DateRangeBar itself has 16 importers and is not touched.)
  roundChips: { gap: spacing.sm, paddingBottom: spacing.sm },
  roundChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  roundChipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  // `type.small` has never existed in theme.js — this spread `undefined`, so the chip silently
  // fell back to the default 14pt instead of the intended caption size.
  roundChipText: { ...type.caption, color: colors.textPrimary, fontWeight: '600' },
  roundChipTextOn: { color: colors.textInverse },

  // Each survey question is its own group, so they need the section's vertical rhythm
  // between them rather than the card's old marginBottom.
  qGroup: { marginBottom: spacing.sm },

  quickActions: { marginTop: spacing.sm, marginBottom: spacing.lg },

  canvassButton: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md + 2, alignItems: 'center' },
  canvassButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  });
}
