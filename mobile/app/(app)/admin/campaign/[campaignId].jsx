import { useEffect, useRef, useState } from 'react';
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
import VoterRow from '../../../../components/VoterRow';
import SectionHeader from '../../../../components/SectionHeader';
import DateRangeBar from '../../../../components/DateRangeBar';
import { rangeFor, deviceTimezone } from '../../../../lib/dateRanges';
import { formatRange } from '../../../../lib/datetime';
import { rateFromPct, RATE_COLORS } from '../../../../lib/rates';
import { colors, radius, spacing, type, shadow } from '../../../../lib/theme';

function StatTile({ value, label, level }) {
  const palette = level ? RATE_COLORS[level] : null;
  return (
    <View style={[styles.statTile, palette && { backgroundColor: palette.bg, borderColor: palette.bg }]}>
      <Text style={[styles.statTileValue, palette && { color: palette.fg }]}>{value ?? '—'}</Text>
      <Text style={[styles.statTileLabel, palette && { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

function OptionRow({ option, count, percent, onPress }) {
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

  // Anchor date presets to THIS campaign's timezone (not the device clock).
  const tz = campaign?.timeZone;

  const [range, setRange] = useState(null);
  const rangeTouchedRef = useRef(false);
  function onRangeChange(v) {
    rangeTouchedRef.current = true;
    setRange(v);
  }

  // Once the campaign tz is known, resolve the default preset in that clock.
  // Archived campaigns have no recent activity → default to all-time; active → today.
  useEffect(() => {
    if (rangeTouchedRef.current || range || !tz || !campaign) return;
    const preset = campaign.isActive === false ? 'all' : 'today';
    const r = rangeFor(preset, null, tz);
    setRange({ preset, from: r.from, to: r.to });
  }, [tz, range, campaign]);

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
  const topCanvassers = (canvassersQ.data || []).slice(0, 5);
  const rangeStats = rollupQ.data?.campaigns?.[0] || {};
  const rangeKnocks = rangeStats.knocks || 0;
  const rangePrimary = isLitDrop ? rangeStats.litDropped || 0 : rangeStats.surveysSubmitted || 0;
  const rangeRate = rateFromPct(rangeStats.connectionRate);

  const questions = surveyResultsQ.data?.questions || [];
  const highlightQuestions = questions.filter((q) => q.type === 'multiple_choice' && q.options?.length);

  function goVoters(qn, opt) {
    router.push({
      pathname: '/(app)/admin/answer-voters',
      params: {
        campaignId: cId,
        questionKey: qn.key,
        option: String(opt.option),
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

        <DateRangeBar value={range} onChange={onRangeChange} tz={tz} />

        <View style={{ paddingHorizontal: spacing.lg }}>
          {/* Activity in range */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Activity</Text>
            {rollupQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
            ) : (
              <View style={styles.tileRow}>
                <StatTile value={rangeKnocks.toLocaleString()} label="Knocks" />
                <StatTile value={rangePrimary.toLocaleString()} label={isLitDrop ? 'Lit drops' : 'Surveys'} />
                {!isLitDrop && (
                  <StatTile value={(rangeStats.surveyedVoters || 0).toLocaleString()} label="Surveyed voters" />
                )}
                <StatTile value={rangeRate?.value} label={isLitDrop ? 'Lit rate' : 'Connection rate'} level={rangeRate?.level} />
              </View>
            )}
          </View>

          {/* Coverage (all-time) */}
          <SectionHeader title="Coverage" subtitle="All-time campaign progress" />
          <View style={styles.card}>
            <Text style={styles.coverageSummary}>
              {(totals.households ?? 0).toLocaleString()} households · {(totals.homesKnocked ?? 0).toLocaleString()} knocked
            </Text>
            <CoverageBar canvass={canvass} />
          </View>

          {/* Top canvassers (range) */}
          <Pressable
            onPress={() => router.push('/(app)/admin/canvassers')}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Top canvassers</Text>
              <Text style={styles.cardLink}>See all ›</Text>
            </View>
            {canvassersQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
            ) : topCanvassers.length === 0 ? (
              <Text style={styles.muted}>No activity in this range.</Text>
            ) : (
              topCanvassers.map((c, i) => {
                const primary = isLitDrop ? c.litDropped || 0 : c.surveysSubmitted || 0;
                const primaryLabel = isLitDrop ? 'lit drops' : 'surveys';
                const range2 = formatRange(c.firstActivityAt, c.lastActivityAt, campaign?.timeZone);
                return (
                  <View key={c.userId} style={styles.canvasserRow}>
                    <Text style={styles.canvasserRank}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.canvasserName}>{c.firstName || c.email} {c.lastName || ''}</Text>
                      <Text style={styles.muted}>{c.homesKnocked || 0} knocks · {primary} {primaryLabel}</Text>
                      {range2 ? <Text style={styles.canvasserShift}>🕘 {range2}</Text> : null}
                    </View>
                  </View>
                );
              })
            )}
          </Pressable>

          {/* Voter highlights */}
          {!isLitDrop && highlightQuestions.length > 0 && (
            <>
              <SectionHeader title="Voter highlights" subtitle="Latest voters per option" />
              {highlightQuestions.map((qn) => (
                <View key={qn.key} style={styles.card}>
                  <Text style={styles.qLabel}>{qn.label}</Text>
                  {qn.options.map((o) => (
                    <View key={String(o.option)} style={styles.highlightOpt}>
                      <View style={styles.highlightHead}>
                        <Text style={styles.highlightOptName} numberOfLines={1}>{String(o.option)}</Text>
                        <Text style={styles.highlightCount}>{o.count}</Text>
                      </View>
                      {(o.voters || []).slice(0, 3).map((v) => (
                        <VoterRow key={v.responseId} v={v} showCanvasser />
                      ))}
                      {o.count > (o.voters?.length || 0) && (
                        <Pressable onPress={() => goVoters(qn, o)} hitSlop={6}>
                          <Text style={styles.seeAll}>See all {o.count} ›</Text>
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>
              ))}
            </>
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

          {/* Quick links */}
          <View style={styles.quickLinkRow}>
            <Pressable style={styles.quickLink} onPress={() => router.push('/(app)/admin/map')}>
              <Text style={styles.quickLinkIcon}>🗺️</Text>
              <Text style={styles.quickLinkText}>Live map</Text>
            </Pressable>
            <Pressable style={styles.quickLink} onPress={() => router.push('/(app)/admin/users')}>
              <Text style={styles.quickLinkIcon}>👥</Text>
              <Text style={styles.quickLinkText}>Users</Text>
            </Pressable>
            <Pressable
              style={styles.quickLink}
              onPress={() => router.push(`/(app)/admin/campaign-assignments/${cId}`)}
            >
              <Text style={styles.quickLinkIcon}>🔗</Text>
              <Text style={styles.quickLinkText}>Assignments</Text>
            </Pressable>
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

const styles = StyleSheet.create({
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
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  bannerText: { fontSize: 13, color: '#92400E', fontWeight: '600' },

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
  statTileLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginTop: 2, textAlign: 'center' },

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

  quickLinkRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.lg },
  quickLink: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    ...shadow.card,
  },
  quickLinkIcon: { fontSize: 28, marginBottom: spacing.xs },
  quickLinkText: { ...type.bodyStrong },

  canvassButton: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md + 2, alignItems: 'center' },
  canvassButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
});
