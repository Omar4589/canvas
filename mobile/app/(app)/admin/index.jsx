import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { useRefresh } from '../../../lib/useRefresh';
import { loadCurrentUser, loadActiveCampaign } from '../../../lib/cache';
import Logo from '../../../components/Logo';
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
  GroupFooter,
} from '../../../components/InsetGroup';
import MetricSheet from '../../../components/MetricSheet';
import { rangeFor, deviceTimezone } from '../../../lib/dateRanges';
import { timeAgo } from '../../../lib/datetime';
import { metricHelp } from '../../../lib/metricHelp';
import { rateFromPct, makeRateColors, tierWord } from '../../../lib/rates';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useBottomInset } from '../../../lib/useBottomInset';

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

export default function AdminOverview() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // The floating tab bar overlays this screen, so bottom padding must clear it.
  const bottomInset = useBottomInset();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  // Anchor date presets to the org's active campaign timezone (not the device clock).
  const [tzCampaign, setTzCampaign] = useState(undefined);
  // Device tz as the always-available fallback so the dashboard loads immediately; refined
  // to the campaign tz once it resolves (below). Never leaves the range unresolved.
  const tz = tzCampaign?.timeZone || deviceTimezone();

  const [range, setRange] = useState(() => {
    const r = rangeFor('today', null, deviceTimezone());
    return { preset: 'today', from: r.from, to: r.to };
  });
  const rangeTouchedRef = useRef(false);
  function onRangeChange(v) {
    rangeTouchedRef.current = true;
    setRange(v);
  }

  useEffect(() => {
    loadCurrentUser().then((u) => setUser(u));
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
  // Archived is reviewed as historical data → always all-time.
  const archivedQ = useQuery({
    queryKey: ['admin', 'reports', 'campaign-rollup', 'archived'],
    queryFn: () => api(`/admin/reports/campaign-rollup?scope=archived&tz=${deviceTimezone()}`),
    enabled: archivedOpen,
  });

  const { refreshing, onRefresh } = useRefresh([
    activeQ.refetch,
    archivedOpen ? archivedQ.refetch : null,
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
    {
      key: 'voters',
      label: 'Surveyed voters',
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
  const archived = archivedQ.data?.campaigns || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={26} />
        <Text style={styles.headerLabel}>Admin{user?.isSuperAdmin ? ' · super' : ''}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl + bottomInset }}
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
                  key="voters"
                  label="Surveyed voters"
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
                    accessory={<CoverageBar canvass={c.coverage} compact />}
                    hint="Opens this campaign"
                    onPress={() => router.push(`/(app)/admin/campaign/${c.id}`)}
                  />
                );
              })
            )}
          </InsetGroup>

          {/* A reveal, not a navigation — so it is an action row, and it carries no chevron. */}
          <SectionHeader title="Archived" />
          <InsetGroup>
            <InsetActionRow
              label={archivedOpen ? 'Hide archived campaigns' : 'Show archived campaigns'}
              onPress={() => setArchivedOpen((v) => !v)}
            />
            {archivedOpen && archivedQ.isLoading ? <InsetNoteRow loading /> : null}
            {archivedOpen && !archivedQ.isLoading && archived.length === 0 ? (
              <InsetNoteRow>No archived campaigns.</InsetNoteRow>
            ) : null}
            {archivedOpen && !archivedQ.isLoading
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
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: { ...type.caption, color: colors.textSecondary },

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
  });
}
