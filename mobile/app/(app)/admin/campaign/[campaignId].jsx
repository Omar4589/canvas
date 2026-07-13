import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { saveActiveCampaign, clearBootstrap } from '../../../../lib/cache';
import CoverageBar from '../../../../components/CoverageBar';
import SectionHeader from '../../../../components/SectionHeader';
import NavTileGrid from '../../../../components/NavTileGrid';
import DateRangeBar from '../../../../components/DateRangeBar';
import CanvasserCard from '../../../../components/CanvasserCard';
import InfoHint from '../../../../components/InfoHint';
import ElectionCountdownChip from '../../../../components/ElectionCountdownChip';
import { rangeFor, deviceTimezone } from '../../../../lib/dateRanges';
import { rateFromPct, makeRateColors } from '../../../../lib/rates';
import { metricHelp } from '../../../../lib/metricHelp';
import { radius, spacing } from '../../../../lib/theme';
import { useTheme } from '../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../lib/useThemedStyles';

function StatTile({ value, label, level, info }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const RATE_COLORS = makeRateColors(colors);
  const palette = level ? RATE_COLORS[level] : null;
  return (
    <View style={[styles.statTile, palette && { backgroundColor: palette.bg, borderColor: palette.bg }]}>
      <Text style={[styles.statTileValue, palette && { color: palette.fg }]}>{value ?? '—'}</Text>
      <View style={styles.statTileLabelRow}>
        <Text style={[styles.statTileLabel, palette && { color: palette.fg }]}>{label}</Text>
        {info ? <InfoHint title={label} body={info} /> : null}
      </View>
    </View>
  );
}

function OptionRow({ option, count, percent, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.optRow, pressed && { opacity: 0.7 }]}>
      <View style={styles.optTop}>
        <Text style={styles.optLabel} numberOfLines={1}>{String(option)}</Text>
        <Text style={styles.optCount}>
          {count} · {percent}% ›
        </Text>
      </View>
      <View style={styles.optTrack}>
        <View style={[styles.optFill, { width: `${Math.max(2, Math.min(100, percent))}%` }]} />
      </View>
    </Pressable>
  );
}

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

  const overviewQ = useQuery({
    queryKey: ['admin', 'reports', 'overview', cId],
    queryFn: () => api(`/admin/reports/overview?campaignId=${cId}`),
    enabled: !!cId,
  });
  const canvassersQ = useQuery({
    queryKey: ['admin', 'reports', 'canvassers', cId, range?.from, range?.to],
    queryFn: () => api(`/admin/reports/canvassers?${rangeParams().toString()}`),
    enabled: !!cId && !!range,
  });
  // Roster for the coordinator label (shared cache with Books/Timeline).
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
  });
  const surveyResultsQ = useQuery({
    queryKey: ['admin', 'reports', 'survey-results', cId, range?.from, range?.to],
    queryFn: () => api(`/admin/reports/survey-results?${rangeParams({ voterPreview: '5' }).toString()}`),
    enabled: !!cId && !isLitDrop && !!range,
  });
  // In-range totals from the same rollup the landing uses (deduped door-days),
  // so the detail's numbers match the Overview exactly.
  const rollupQ = useQuery({
    queryKey: ['admin', 'reports', 'campaign-rollup', 'one', cId, range?.from, range?.to],
    queryFn: () => api(`/admin/reports/campaign-rollup?${rangeParams().toString()}`),
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

  const questions = surveyResultsQ.data?.questions || [];

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
    return (canvassersQ.data || []).slice(0, 5).map((c) => {
      const dayKnocks = c.knocks ?? c.homesKnocked ?? 0;
      const first = c.firstActivityAt ? new Date(c.firstActivityAt).getTime() : null;
      const last = c.lastActivityAt ? new Date(c.lastActivityAt).getTime() : null;
      const hours = first && last ? (last - first) / 3600000 : 0;
      return {
        ...c,
        dayKnocks,
        daySurveys: c.surveysSubmitted ?? 0,
        dayLit: c.litDropped ?? 0,
        hoursOnDoors: Math.round(hours * 100) / 100,
        doorsPerHour: hours > 0 ? Math.round((dayKnocks / hours) * 100) / 100 : 0,
        coordinatorName: coordByUserId.get(String(c.userId)) || null,
      };
    });
  }, [canvassersQ.data, coordByUserId]);

  function goVoters(qn, opt) {
    router.push({
      pathname: '/(app)/admin/answer-voters',
      params: {
        campaignId: cId,
        questionKey: qn.key,
        option: String(opt.option),
        optionId: String(opt.id ?? ''),
        label: qn.label,
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
          <Pressable onPress={() => router.back()} hitSlop={8}>
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
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Overview</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{campaign?.name || 'Campaign'}</Text>
        <View style={{ width: 64 }} />
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

        <View style={{ paddingHorizontal: spacing.lg }}>
          {/* Activity in range */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Activity</Text>
            {rollupQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
            ) : (
              <View style={styles.tileRow}>
                <StatTile value={rangeKnocks.toLocaleString()} label="Knocks" info={metricHelp.doors} />
                <StatTile
                  value={rangePrimary.toLocaleString()}
                  label={isLitDrop ? 'Lit drops' : 'Survey doors'}
                  info={isLitDrop ? metricHelp.litDrops : metricHelp.surveyDoors}
                />
                {!isLitDrop && (
                  <StatTile
                    value={(rangeStats.surveyedVoters || 0).toLocaleString()}
                    label="Surveyed voters"
                    info={metricHelp.surveyedVoters}
                  />
                )}
                <StatTile
                  value={rangeRate?.value}
                  label={isLitDrop ? 'Lit rate' : 'Connection rate'}
                  level={rangeRate?.level}
                  info={metricHelp.connectionRate}
                />
              </View>
            )}
          </View>

          {/* Coverage (all-time) */}
          <SectionHeader
            title="Coverage"
            subtitle="All-time campaign progress"
            action={<InfoHint title="Coverage" body={metricHelp.households} />}
          />
          <View style={styles.card}>
            <Text style={styles.coverageSummary}>
              {(totals.households ?? 0).toLocaleString()} households · {(totals.homesKnocked ?? 0).toLocaleString()} knocked
            </Text>
            <CoverageBar canvass={canvass} />
          </View>

          {/* Top canvassers (range) */}
          <SectionHeader
            title="Top canvassers"
            onSeeAll={goTimeline}
            action={
              <InfoHint
                title="What these mean"
                items={[
                  { label: 'Doors', text: metricHelp.doors },
                  {
                    label: isLitDrop ? 'Lit drops' : 'Survey doors',
                    text: isLitDrop ? metricHelp.litDrops : metricHelp.surveyDoors,
                  },
                  ...(isLitDrop ? [] : [{ label: 'Surveyed voters', text: metricHelp.surveyedVoters }]),
                  { label: 'Conn %', text: metricHelp.connectionRate },
                  { label: 'Contact %', text: metricHelp.contactRate },
                  { label: 'Doors / hr', text: metricHelp.doorsPerHour },
                  { label: 'Coordinator', text: metricHelp.coordinator },
                  { label: 'Start / Last door', text: `${metricHelp.start} ${metricHelp.lastDoor}` },
                ]}
              />
            }
          />
          {canvassersQ.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
          ) : topCanvasserRows.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.muted}>No activity in this range.</Text>
            </View>
          ) : (
            topCanvasserRows.map((c, i) => (
              <CanvasserCard
                key={c.userId}
                row={c}
                tz={tz}
                rank={i + 1}
                litMode={isLitDrop}
                onPress={() =>
                  router.push({
                    pathname: `/(app)/admin/canvasser/${c.userId}`,
                    params: {
                      ...(range?.from ? { from: range.from } : {}),
                      ...(range?.to ? { to: range.to } : {}),
                      ...(range?.preset ? { preset: range.preset } : {}),
                    },
                  })
                }
              />
            ))
          )}

          {/* Survey results */}
          {!isLitDrop && questions.length > 0 && (
            <>
              <SectionHeader title="Survey results" subtitle={`${surveyResultsQ.data?.totalResponses ?? 0} responses`} />
              {questions.map((qn) => (
                <View key={qn.key} style={styles.card}>
                  <Text style={styles.qLabel}>{qn.label}</Text>
                  {qn.type === 'text' ? (
                    qn.options.length === 0 ? (
                      <Text style={styles.muted}>No free-text answers.</Text>
                    ) : (
                      qn.options.slice(0, 10).map((o, i) => (
                        <View key={i} style={styles.verbatim}>
                          <Text style={styles.verbatimText}>“{o.option}”</Text>
                          <Text style={styles.muted}>{o.count} {o.count === 1 ? 'response' : 'responses'}</Text>
                        </View>
                      ))
                    )
                  ) : (
                    qn.options.map((o) => (
                      <OptionRow
                        key={String(o.option)}
                        option={o.option}
                        count={o.count}
                        percent={o.percent}
                        onPress={() => goVoters(qn, o)}
                      />
                    ))
                  )}
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
                { label: 'GPS audit', subtitle: 'Review flagged entries', onPress: goAudit },
                { label: 'Notes', subtitle: 'Door, survey & admin notes', onPress: goNotes },
                { label: 'Users', subtitle: 'Manage people', onPress: () => router.push('/(app)/admin/users') },
                { label: 'Assignments', subtitle: 'Books & canvassers', onPress: () => router.push(`/(app)/admin/campaign-assignments/${cId}`) },
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
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: colors.brand, fontWeight: '600', fontSize: 14, width: 64 },
  headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  banner: {
    backgroundColor: colors.warnBg,
    borderColor: colors.warnBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  bannerText: { fontSize: 13, color: colors.warnFg, fontWeight: '600' },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
  cardTitle: { ...type.h3, marginBottom: spacing.md },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardLink: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  muted: { ...type.caption },

  tileRow: { flexDirection: 'row', gap: spacing.sm },
  statTile: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  statTileValue: { ...type.h2, fontSize: 20, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  statTileLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  statTileLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },

  coverageSummary: { ...type.caption, marginBottom: spacing.sm, color: colors.textPrimary, fontWeight: '600' },

  canvasserRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  canvasserRank: { width: 24, fontSize: 14, fontWeight: '800', color: colors.brand },
  canvasserName: { ...type.bodyStrong, fontSize: 14 },
  canvasserShift: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },

  qLabel: { ...type.bodyStrong, fontSize: 14, marginBottom: spacing.sm },

  optRow: { paddingVertical: spacing.sm },
  optTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  optLabel: { ...type.body, fontSize: 14, flex: 1, marginRight: spacing.sm },
  optCount: { fontSize: 12, color: colors.textSecondary, fontWeight: '600', fontVariant: ['tabular-nums'] },
  optTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.bg, overflow: 'hidden' },
  optFill: { height: 8, backgroundColor: colors.brand, borderRadius: radius.pill },

  highlightOpt: { marginBottom: spacing.md },
  highlightHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  highlightOptName: { ...type.bodyStrong, fontSize: 14, flex: 1, marginRight: spacing.sm },
  highlightCount: { fontSize: 12, fontWeight: '700', color: colors.brand },
  seeAll: { color: colors.brand, fontWeight: '700', fontSize: 13, marginTop: spacing.xs },

  verbatim: { marginBottom: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  verbatimText: { ...type.body, fontSize: 14, fontStyle: 'italic' },

  quickActions: { marginTop: spacing.sm, marginBottom: spacing.lg },

  canvassButton: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md + 2, alignItems: 'center' },
  canvassButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  });
}
