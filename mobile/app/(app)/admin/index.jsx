import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { useRefresh } from '../../../lib/useRefresh';
import { loadActiveCampaign } from '../../../lib/cache';
import { useConsoleRole } from '../../../lib/useConsoleRole';
import { useTodayInTz } from '../../../lib/useTodayInTz';
import { isArchivedCampaign, overviewChoice } from '../../../lib/campaignSelection';
import AdminHeaderRow from '../../../components/AdminHeaderRow';
import CampaignHome from '../../../components/CampaignHome';
import CoverageBar from '../../../components/CoverageBar';
import SectionHeader from '../../../components/SectionHeader';
import DateRangeBar from '../../../components/DateRangeBar';
import InsetGroup, {
  InsetHeroRow,
  InsetRow,
  InsetNavRow,
  InsetActionRow,
  InsetBlockRow,
  InsetNoteRow,
  RowBar,
  GroupFooter,
} from '../../../components/InsetGroup';
import MetricSheet from '../../../components/MetricSheet';
import { rangeFor, deviceTimezone, effectiveRange } from '../../../lib/dateRanges';
import { timeAgo } from '../../../lib/datetime';
import { metricHelp } from '../../../lib/metricHelp';
import { shortCount } from '../../../lib/goalPace';
import { rateFromPct, makeRateColors, tierWord } from '../../../lib/rates';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

function fmt(n) {
  if (n == null) return '—';
  if (typeof n === 'string') return n;
  return Number(n).toLocaleString();
}

function pct(n) {
  return n == null ? '—' : `${n}%`;
}

// One campaign as a navigating row. Everything the old card stacked is still here, just
// distributed into the row's own slots instead of a bespoke layout: the coverage bar becomes
// the accessory (full row width — a proportional bar loses data when squeezed), the mock-GPS
// nudge becomes the standard badge, and the connection rate becomes the tier-colored accent so
// it reads the same as it does inside the campaign itself.
function campaignRowProps(c, isLitDrop) {
  const rate = rateFromPct(c.connectionRate);
  const primary = isLitDrop
    ? `${fmt(c.litDropped)} lit drops`
    : `${fmt(c.surveyedKnocks)} survey doors`;
  const last = c.lastActivityAt ? timeAgo(c.lastActivityAt) : 'no activity in range';
  return {
    label: c.name,
    labelLines: 2,
    badge: (c.openMockFlags || 0) > 0 ? { text: `${c.openMockFlags} mock GPS` } : null,
    value: fmt(c.knocks),
    unit: `${isLitDrop ? 'Lit drop' : 'Survey'} · ${fmt(c.households)} households · ${c.knockedPct ?? 0}% knocked`,
    sub: `${primary} · ${fmt(c.activeCanvassers)} canv · ${last} · `,
    subAccent: `${pct(c.connectionRate)} conn`,
    rate,
  };
}

// Coverage bar plus, when the campaign carries one, a door-goal bar under it. Both live in the
// row's `accessory` because a proportional bar loses data when squeezed into the label column.
// The goal line is ALL-TIME and campaign-wide while everything else on the row honors the range
// picker — hence the explicit "all time" tag, which is the only thing keeping the two bars from
// being read as the same kind of number.
function RowAccessory({ campaign, styles }) {
  const goal = campaign.goal || null;
  return (
    <View>
      <CoverageBar canvass={campaign.coverage} compact />
      {goal?.target ? (
        <View style={styles.goalRow}>
          <Text style={styles.goalLabel}>
            Goal {shortCount(goal.done)} / {shortCount(goal.target)} · all time
          </Text>
          <RowBar pct={goal.percent} />
        </View>
      ) : null}
    </View>
  );
}

// The archived campaigns' query — the key OrgOverview's pull refreshes while the group is open.
const ARCHIVED_KEY = ['admin', 'reports', 'campaign-rollup', 'archived'];

// The Overview tab. For a team lead with exactly ONE active campaign it IS that campaign's screen
// (components/CampaignHome.jsx, embedded) — not a list with one row in it; for everyone else it's
// the org Overview, as always. docs/PROPOSAL_LEAD_CAMPAIGN_LANDING.md §E.4.
//
// This component only decides, so no early return can change a hook's order: the org Overview's
// hooks live in OrgOverview, and only the one being shown mounts (so the org totals don't keep
// polling behind an embedded home).
const AdminOverview = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  // Read once per mount from the cached session, the same read the admin tab gate makes
  // (admin/_layout.jsx). Every org switch and sign-out unmounts these tabs, so it can't go stale
  // across organizations.
  const role = useConsoleRole();
  const caption = role ? { lead: 'Team Lead', admin: 'Admin', super: 'Admin · super' }[role] : null;
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    // Never a bare flag: an undefined `enabled` counts as on, which would fetch before the role is read.
    enabled: role === 'lead',
    // Refetch when the lead comes back to the tab, so a granted or archived campaign moves them
    // between the list and the embedded home in either direction.
    ...useFocusedPoll(),
  });
  const choice = overviewChoice({
    role,
    campaigns: campaignsQ.data?.campaigns,
    listLoading: campaignsQ.isLoading,
  });
  // Remember the last decision, so "deciding" only ever shows before the FIRST one. Coming back after
  // the list aged out of the cache must not unmount OrgOverview and reset its range and Archived
  // toggle. (Setting state during render is allowed for a component's own state; React re-runs this
  // render once.)
  const [last, setLast] = useState(null);
  if (choice && choice !== last) setLast(choice);
  const shown = choice ?? last;

  if (!shown) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <AdminHeaderRow caption={caption} />
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }
  if (shown.startsWith('sole:')) {
    const id = shown.slice('sole:'.length);
    const hasArchived = (campaignsQ.data?.campaigns || []).some(isArchivedCampaign);
    return (
      <CampaignHome
        key={id}
        campaignId={id}
        embedded
        caption={caption}
        footer={hasArchived ? <ArchivedGroup /> : null}
      />
    );
  }
  return <OrgOverview caption={caption} extraRefetch={role === 'lead' ? campaignsQ.refetch : null} />;
};

export default AdminOverview;

// The archived campaigns, revealed on demand — owns its toggle and its query (all-time data, so no
// range). Rendered in the org Overview, and under a team lead's embedded home when they have any.
// Its rows open the campaign screen, whose "‹ Overview" comes back here.
const ArchivedGroup = () => {
  const { colors } = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const archivedQ = useQuery({
    queryKey: ARCHIVED_KEY,
    queryFn: () => api(`/admin/reports/campaign-rollup?scope=archived&tz=${deviceTimezone()}`),
    enabled: open,
  });
  const archived = archivedQ.data?.campaigns || [];
  return (
    <>
      {/* A reveal, not a navigation — so it is an action row, and it carries no chevron. */}
      <SectionHeader title="Archived" />
      <InsetGroup>
        <InsetActionRow
          label={open ? 'Hide archived campaigns' : 'Show archived campaigns'}
          onPress={() => setOpen((v) => !v)}
        />
        {open && archivedQ.isLoading ? <InsetNoteRow loading /> : null}
        {open && !archivedQ.isLoading && archived.length === 0 ? (
          <InsetNoteRow>No archived campaigns.</InsetNoteRow>
        ) : null}
        {open && !archivedQ.isLoading
          ? archived.map((c) => (
              <InsetNavRow
                key={c.id}
                label={c.name}
                labelLines={2}
                badge={{ text: 'Read-only', bg: colors.warnBg, fg: colors.warnFg }}
                value={fmt(c.knocks)}
                unit={`${fmt(c.households)} households · ${c.knockedPct ?? 0}% knocked`}
                hint="Opens this archived campaign, read-only"
                onPress={() => router.push(`/(app)/admin/campaign/${c.id}`)}
              />
            ))
          : null}
      </InsetGroup>
    </>
  );
};

// The org Overview: every active campaign added together, then one row per campaign.
//   caption       the header's role label, from the decider
//   extraRefetch  a team lead's campaigns-list refetch, so pulling this list can also turn it into
//                 their embedded home
function OrgOverview({ caption, extraRefetch }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();

  // Anchor date presets to the org's active campaign timezone (not the device clock).
  const [tzCampaign, setTzCampaign] = useState(undefined);
  // Device tz as the always-available fallback so the dashboard loads immediately; refined
  // to the campaign tz once it resolves (below). Never leaves the range unresolved.
  const tz = tzCampaign?.timeZone || deviceTimezone();

  // What the admin picked; everything reads `range` — Today pinned to the current day, so totals left
  // on screen past midnight move to the new day instead of stretching over two (dateRanges.js).
  const [pickedRange, setRange] = useState(() => {
    const r = rangeFor('today', null, deviceTimezone());
    return { preset: 'today', from: r.from, to: r.to };
  });
  const range = effectiveRange(pickedRange, useTodayInTz(tz));
  const rangeTouchedRef = useRef(false);
  function onRangeChange(v) {
    rangeTouchedRef.current = true;
    setRange(v);
  }

  useEffect(() => {
    loadActiveCampaign().then((c) => setTzCampaign(c || null));
  }, []);

  // Refine the default preset into the campaign tz as it resolves, until the admin picks a
  // range. The range is already seeded (device tz) above, so the screen never blocks.
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    const r = rangeFor('today', null, tz);
    setRange({ preset: 'today', from: r.from, to: r.to });
  }, [tz]);

  const activeQ = useQuery({
    queryKey: ['admin', 'reports', 'campaign-rollup', 'active', range?.from, range?.to],
    queryFn: () => {
      const p = new URLSearchParams({ scope: 'active', tz: deviceTimezone() });
      if (range?.from) p.set('from', range.from);
      if (range?.to) p.set('to', range.to);
      return api(`/admin/reports/campaign-rollup?${p.toString()}`);
    },
    enabled: !!range,
    refetchInterval: 30 * 1000,
    // Tabs keep Overview mounted forever once visited — pause the poll (and
    // refresh on return) whenever another screen covers it.
    ...useFocusedPoll(),
  });
  // The pull also refreshes the Archived group when it's open: a closed group's query is disabled,
  // so `type: 'active'` skips it — what `archivedOpen ? archivedQ.refetch : null` did before the
  // group took its own state.
  const { refreshing, onRefresh } = useRefresh([
    activeQ.refetch,
    () => qc.refetchQueries({ queryKey: ARCHIVED_KEY, type: 'active' }),
    extraRefetch,
  ]);

  const cumulative = activeQ.data?.cumulative || {};
  const campaigns = activeQ.data?.campaigns || [];

  const [sheet, setSheet] = useState(null);
  const rateColors = makeRateColors(colors);
  const cumRate = rateFromPct(cumulative.connectionRate);

  // The same shape the campaign screen's Activity group uses, so the org totals and a single
  // campaign's totals explain themselves identically — one MetricSheet, one vocabulary.
  const orgMetrics = [
    { key: 'knocks', label: 'Knocks', value: fmt(cumulative.knocks), unit: 'doors', help: metricHelp.doors },
    {
      key: 'surveyDoors',
      label: 'Survey doors',
      value: fmt(cumulative.surveyedKnocks),
      unit: 'houses',
      help: metricHelp.surveyDoors,
    },
    // The response unit and the voter unit — both, in that order. They are the same number only
    // while every campaign in scope runs one round; the app's per-question survey counts are
    // response-unit, so the org rollup has to name that unit too. See docs/METRICS.md §G.
    {
      key: 'surveys',
      label: 'Surveys taken',
      value: fmt(cumulative.surveysSubmitted),
      unit: 'forms',
      help: metricHelp.surveysTaken,
    },
    {
      key: 'voters',
      label: 'Voters surveyed',
      value: fmt(cumulative.surveyedVoters),
      unit: 'people',
      help: metricHelp.surveyedVoters,
    },
    {
      key: 'lit',
      label: 'Lit drops',
      value: fmt(cumulative.litDropped),
      // litDropped counts drop ACTIONS, not doors — see docs/METRICS.md. It is deliberately
      // NOT the lit rate's operand, so it gets the event copy, never metricHelp.litDrops.
      unit: 'drops',
      help: metricHelp.litDropEvents,
    },
    {
      key: 'rate',
      label: 'Connection rate',
      value: pct(cumulative.connectionRate),
      level: cumRate?.level,
      sub: cumRate ? tierWord(cumRate.level) : null,
      help: metricHelp.connectionRate,
    },
    {
      key: 'canvassers',
      label: 'Canvassers',
      value: fmt(cumulative.activeCanvassers),
      unit: 'active in range',
      help: metricHelp.activeCanvassers,
    },
  ];

  // Heads-up when a relative preset could read a day off for an off-zone campaign near
  // midnight (server flag). Hidden for All-time / Custom (explicit dates → no seam).
  const seamNames = activeQ.data?.seamCampaigns || [];
  const showDaySeam =
    activeQ.data?.crossZoneDaySeam && range?.preset !== 'all' && range?.preset !== 'custom';
  const seamLabel =
    seamNames.length <= 2
      ? seamNames.join(' and ')
      : `${seamNames.slice(0, 2).join(', ')} and ${seamNames.length - 2} more`;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AdminHeaderRow caption={caption} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        <DateRangeBar value={range} onChange={onRangeChange} tz={tz} />
        {activeQ.data?.tzAbbrev ? (
          <Text style={{ paddingHorizontal: spacing.lg, marginTop: 2, fontSize: 11, color: colors.textSecondary }}>
            Dates &amp; times in {activeQ.data.tzAbbrev}
          </Text>
        ) : null}

        {showDaySeam ? (
          <View style={[styles.seamBanner, { marginHorizontal: spacing.lg }]}>
            <Text style={styles.seamBannerText}>
              Heads up — it's just past midnight in another time zone. {seamLabel}{' '}
              {seamNames.length > 1 ? 'have' : 'has'} already started a new day, so{' '}
              {seamNames.length > 1 ? 'their' : 'its'} numbers in this range may be a day off here. Open{' '}
              {seamNames.length > 1 ? 'those campaigns' : 'that campaign'} directly for exact figures.
            </Text>
          </View>
        ) : null}

        <View style={{ paddingHorizontal: spacing.lg }}>
          <SectionHeader title="All active campaigns" />
          <InsetGroup>
            {activeQ.isLoading ? (
              <InsetNoteRow loading />
            ) : activeQ.error ? (
              <InsetNoteRow>Couldn't load overview. Pull to retry.</InsetNoteRow>
            ) : (
              [
                <InsetHeroRow key="knocks" label="Knocks" value={fmt(cumulative.knocks)} />,
                <InsetRow
                  key="doors"
                  label="Survey doors"
                  unit="houses"
                  value={fmt(cumulative.surveyedKnocks)}
                />,
                <InsetRow
                  key="surveys"
                  label="Surveys taken"
                  unit="forms"
                  value={fmt(cumulative.surveysSubmitted)}
                />,
                <InsetRow
                  key="voters"
                  label="Voters surveyed"
                  unit="people"
                  value={fmt(cumulative.surveyedVoters)}
                />,
                <InsetRow
                  key="rate"
                  label="Connection rate"
                  value={pct(cumulative.connectionRate)}
                  sub={cumRate ? tierWord(cumRate.level) : null}
                  chipColors={cumRate ? rateColors[cumRate.level] : null}
                />,
                <InsetRow
                  key="canv"
                  label="Canvassers"
                  unit="active in range"
                  value={fmt(cumulative.activeCanvassers)}
                />,
                <InsetBlockRow key="bar">
                  <CoverageBar canvass={cumulative.coverage} />
                  <Text style={styles.coverageLine}>
                    {fmt(cumulative.households)} households · {fmt(cumulative.homesKnocked)} knocked (
                    {cumulative.knockedPct ?? 0}%)
                  </Text>
                </InsetBlockRow>,
                <InsetActionRow
                  key="explain"
                  label="How these are counted"
                  onPress={() => setSheet({ title: 'How these are counted', items: orgMetrics })}
                />,
              ]
            )}
          </InsetGroup>
          <GroupFooter>
            Every active campaign added together, over the selected range. Connection rate is survey
            doors ÷ knocks — 20% or better is on target.
          </GroupFooter>

          <SectionHeader title="Campaigns" />
          <InsetGroup>
            {activeQ.isLoading ? (
              <InsetNoteRow loading />
            ) : campaigns.length === 0 ? (
              <InsetNoteRow>No active campaigns yet.</InsetNoteRow>
            ) : (
              campaigns.map((c) => {
                const isLitDrop = c.type === 'lit_drop';
                const { rate, ...rowProps } = campaignRowProps(c, isLitDrop);
                return (
                  <InsetNavRow
                    key={c.id}
                    {...rowProps}
                    accentColor={rate ? rateColors[rate.level].deep : null}
                    accessory={<RowAccessory campaign={c} styles={styles} />}
                    hint="Opens this campaign"
                    onPress={() => router.push(`/(app)/admin/campaign/${c.id}`)}
                  />
                );
              })
            )}
          </InsetGroup>

          <ArchivedGroup />
        </View>
      </ScrollView>

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

  seamBanner: {
    backgroundColor: colors.warnBg,
    borderColor: colors.warnBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  seamBannerText: { ...type.caption, color: colors.warnFg },
  coverageLine: { ...type.caption, marginTop: spacing.sm, fontVariant: ['tabular-nums'] },
  goalRow: { marginTop: spacing.sm, gap: 4 },
  goalLabel: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  });
}
