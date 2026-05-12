import { useEffect, useMemo, useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../../lib/api';
import { loadActiveCampaign } from '../../../../../lib/cache';
import { rangeFor, deviceTimezone, labelForRange } from '../../../../../lib/dateRanges';
import { formatRange, timeAgo } from '../../../../../lib/datetime';
import { getConnectionRate } from '../../../../../lib/rates';
import { colors, radius, spacing, type, shadow } from '../../../../../lib/theme';
import DateRangeBar from '../../../../../components/DateRangeBar';
import KpiGrid from '../../../../../components/KpiGrid';
import BarChart from '../../../../../components/BarChart';
import SectionHeader from '../../../../../components/SectionHeader';
import { downloadCsv } from '../../../../../lib/csv';

const HOUR_LABELS = ['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'];
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function initials(name) {
  return (name || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function delta(value, baseline, unit = '') {
  if (baseline == null || value == null) return null;
  const diff = value - baseline;
  return { value: Math.round(diff * 100) / 100, unit };
}

export default function CanvasserOverview() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id;

  const [campaign, setCampaign] = useState(undefined);
  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const [range, setRange] = useState(() => {
    const incomingPreset = params.preset || '7d';
    if (params.from || params.to) {
      return {
        preset: incomingPreset,
        from: params.from || null,
        to: params.to || null,
      };
    }
    const r = rangeFor(incomingPreset);
    return { preset: incomingPreset, from: r.from, to: r.to };
  });

  const cId = campaign?.id;
  const isLitDrop = campaign?.type === 'lit_drop';
  const tz = deviceTimezone();

  const qsBase = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    p.set('tz', tz);
    return p.toString();
  }, [cId, range.from, range.to, tz]);

  const summaryQ = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'summary', qsBase],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/summary?${qsBase}`),
    enabled: !!cId && !!userId,
  });

  const teamQ = useQuery({
    queryKey: ['admin', 'canvasser', 'team-avg', qsBase],
    queryFn: () => api(`/admin/reports/team-averages?${qsBase}`),
    enabled: !!cId,
  });

  const answersQ = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'answers', qsBase],
    queryFn: () =>
      api(`/admin/reports/survey-results?${qsBase}&userId=${userId}&compareToOrg=true`),
    enabled: !!cId && !!userId && !isLitDrop,
  });

  const s = summaryQ.data;
  const team = teamQ.data?.avg;

  const kpiTiles = useMemo(() => {
    if (!s) return [];
    const k = s.kpi;
    const cr = getConnectionRate(k.surveysSubmitted, k.homesKnocked);
    const primaryLabel = isLitDrop ? 'Lit drops' : 'Surveys';
    const primaryValue = isLitDrop ? k.litDropped : k.surveysSubmitted;
    return [
      {
        label: 'Houses knocked',
        value: (k.homesKnocked || 0).toLocaleString(),
        delta: team ? delta(k.homesKnocked, team.homesKnocked) : null,
      },
      {
        label: primaryLabel,
        value: (primaryValue || 0).toLocaleString(),
        delta: team
          ? delta(primaryValue, isLitDrop ? null : team.surveysSubmitted)
          : null,
      },
      {
        label: 'Connection rate',
        value: cr ? cr.value : '—',
        level: cr?.level,
        delta: team && cr
          ? delta(k.connectionRatePct, team.connectionRatePct, '%')
          : null,
      },
      {
        label: 'Hours on doors',
        value: (k.hoursOnDoors || 0).toFixed(1),
        sub: `${k.daysActive || 0} active day${k.daysActive === 1 ? '' : 's'}`,
        delta: team ? delta(k.hoursOnDoors, team.hoursOnDoors, 'h') : null,
      },
      {
        label: 'Doors / hour',
        value: (k.doorsPerHour || 0).toFixed(1),
        delta: team ? delta(k.doorsPerHour, team.doorsPerHour) : null,
      },
      {
        label: 'Surveys / hour',
        value: (k.surveysPerHour || 0).toFixed(1),
        delta: team ? delta(k.surveysPerHour, team.surveysPerHour) : null,
      },
      {
        label: 'Avg minutes / door',
        value: k.avgMinutesPerDoor ? k.avgMinutesPerDoor.toFixed(1) : '—',
      },
      {
        label: 'Not home / wrong',
        value: `${k.notHome || 0} / ${k.wrongAddress || 0}`,
      },
    ];
  }, [s, team, isLitDrop]);

  const hourData = useMemo(() => {
    if (!s) return [];
    // 8 bars covering every 3 hours, for legibility
    const buckets = Array.from({ length: 8 }, () => 0);
    for (const b of s.hourDistribution || []) {
      buckets[Math.floor(b.hour / 3)] += b.count;
    }
    return buckets.map((count, i) => ({ label: HOUR_LABELS[i], value: count }));
  }, [s]);

  const dowData = useMemo(() => {
    if (!s) return [];
    return (s.dayOfWeekDistribution || []).map((d) => ({
      label: DOW_LABELS[d.dow],
      value: d.count,
    }));
  }, [s]);

  const lastSeven = s?.lastSevenDays || [];

  const answers = answersQ.data;

  function exportCsv() {
    const name = `canvasser-${userId}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(
      `/admin/reports/canvassers/${userId}/export.csv?${qsBase}`,
      name
    );
  }

  if (summaryQ.isLoading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (summaryQ.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.loading}>
          <Text style={{ color: colors.danger }}>
            {summaryQ.error.message || 'Failed to load'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!s) return null;

  const fullName =
    `${s.user.firstName || ''} ${s.user.lastName || ''}`.trim() || s.user.email;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title={fullName} />

      <DateRangeBar value={range} onChange={setRange} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Identity */}
        <View style={styles.idCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(fullName) || '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{fullName}</Text>
            <Text style={styles.idMeta}>{s.user.email}</Text>
            {s.user.phone ? (
              <Text style={styles.idMeta}>{s.user.phone}</Text>
            ) : null}
            <View style={styles.idBadges}>
              {s.memberships?.map((m, i) => (
                <View key={i} style={[styles.badge, m.role === 'admin' && styles.badgeAdmin]}>
                  <Text style={[styles.badgeText, m.role === 'admin' && styles.badgeAdminText]}>
                    {m.role}
                  </Text>
                </View>
              ))}
              {!s.user.isActive ? (
                <View style={[styles.badge, styles.badgeInactive]}>
                  <Text style={[styles.badgeText, styles.badgeInactiveText]}>inactive</Text>
                </View>
              ) : null}
              {s.user.lastLoginAt ? (
                <Text style={styles.lastLogin}>
                  · last login {timeAgo(s.user.lastLoginAt)}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <Text style={styles.rangeLabel}>
          Showing: {labelForRange(range)}
          {teamQ.data?.canvasserCount ? ` · ${teamQ.data.canvasserCount} canvassers in scope` : ''}
        </Text>

        {/* KPI grid */}
        <KpiGrid tiles={kpiTiles} />

        {/* Highlights */}
        <View style={styles.highlightRow}>
          <Highlight
            title="Best day"
            value={
              s.highlights.bestDay
                ? `${s.highlights.bestDay.homesKnocked} doors`
                : '—'
            }
            sub={
              s.highlights.bestDay
                ? fmtDate(s.highlights.bestDay.date)
                : 'No activity yet'
            }
          />
          <Highlight
            title="Streak"
            value={`${s.highlights.currentStreak || 0}d`}
            sub="consecutive active days"
          />
          <Highlight
            title="Last activity"
            value={
              s.highlights.lastActivityAt
                ? timeAgo(s.highlights.lastActivityAt)
                : '—'
            }
            sub={
              s.highlights.firstActivityAt
                ? `since ${formatRange(s.highlights.firstActivityAt, null)}`
                : ''
            }
          />
        </View>

        {/* Days preview */}
        <SectionHeader
          title="Recent days"
          onSeeAll={() =>
            router.push({
              pathname: `/(app)/admin/canvasser/${userId}/days`,
              params: { from: range.from || '', to: range.to || '', preset: range.preset },
            })
          }
        />
        {lastSeven.length === 0 ? (
          <Empty text="No active days in this range." />
        ) : (
          lastSeven.map((d) => (
            <Pressable
              key={d.date}
              onPress={() =>
                router.push({
                  pathname: `/(app)/admin/canvasser/${userId}/day/${d.date}`,
                  params: { preset: range.preset },
                })
              }
              style={({ pressed }) => [styles.dayRow, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.dayDate}>{fmtDate(d.date)}</Text>
                <Text style={styles.dayMeta}>
                  {formatRange(d.firstActivityAt, d.lastActivityAt)} ·{' '}
                  {d.hoursOnDoors.toFixed(1)}h
                </Text>
              </View>
              <Text style={styles.dayDoors}>{d.homesKnocked} doors</Text>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))
        )}

        {/* Hour of day */}
        <SectionHeader title="When they work · hour of day" />
        <View style={styles.chartCard}>
          <BarChart data={hourData} />
        </View>

        {/* Day of week */}
        <SectionHeader title="Day of week" />
        <View style={styles.chartCard}>
          <BarChart data={dowData} />
        </View>

        {/* Survey answers preview */}
        {!isLitDrop && answers?.questions?.length ? (
          <>
            <SectionHeader
              title="Survey answers"
              subtitle={
                answers.compareToOrg
                  ? `${answers.totalResponses} responses vs ${answers.orgTotalResponses} org-wide`
                  : `${answers.totalResponses} responses`
              }
              onSeeAll={() =>
                router.push({
                  pathname: `/(app)/admin/canvasser/${userId}/answers`,
                  params: { from: range.from || '', to: range.to || '', preset: range.preset },
                })
              }
            />
            {answers.questions.slice(0, 2).map((q) => (
              <View key={q.key} style={styles.chartCard}>
                <Text style={styles.qLabel} numberOfLines={2}>
                  {q.label}
                </Text>
                <BarChart
                  data={q.options.map((opt) => ({
                    label: String(opt.option).slice(0, 16),
                    value: opt.percent,
                    secondaryValue: opt.orgPercent,
                  }))}
                  max={100}
                  valueFormat={(v) => `${v}%`}
                  secondaryLabel="Org avg"
                />
              </View>
            ))}
          </>
        ) : null}

        {/* Quality */}
        <SectionHeader
          title="Quality & sync"
          onSeeAll={() =>
            router.push({
              pathname: `/(app)/admin/canvasser/${userId}/quality`,
              params: { from: range.from || '', to: range.to || '', preset: range.preset },
            })
          }
        />
        <View style={styles.qualityRow}>
          <Highlight
            title="Offline"
            value={`${s.quality.offlinePercent}%`}
            sub={`${s.quality.offlineCount} submissions`}
          />
          <Highlight
            title="Avg distance"
            value={
              s.quality.avgDistanceFromHouseMeters != null
                ? `${s.quality.avgDistanceFromHouseMeters}m`
                : '—'
            }
            sub="from house"
          />
          <Highlight
            title=">50m"
            value={`${s.quality.farFromHousePercent}%`}
            sub={`${s.quality.farFromHouseCount} flagged`}
          />
        </View>

        {/* Quick links grid */}
        <SectionHeader title="Drill down" />
        <View style={styles.quickGrid}>
          <QuickLink
            label="Activity feed"
            sub="Every knock"
            onPress={() =>
              router.push({
                pathname: `/(app)/admin/canvasser/${userId}/activity`,
                params: { from: range.from || '', to: range.to || '', preset: range.preset },
              })
            }
          />
          <QuickLink
            label="Households"
            sub="Places visited"
            onPress={() =>
              router.push({
                pathname: `/(app)/admin/canvasser/${userId}/households`,
                params: { from: range.from || '', to: range.to || '', preset: range.preset },
              })
            }
          />
          {!isLitDrop ? (
            <QuickLink
              label="Voters surveyed"
              sub="With demographics"
              onPress={() =>
                router.push({
                  pathname: `/(app)/admin/canvasser/${userId}/voters`,
                  params: { from: range.from || '', to: range.to || '', preset: range.preset },
                })
              }
            />
          ) : null}
          <QuickLink
            label="Notes"
            sub="All free-text"
            onPress={() =>
              router.push({
                pathname: `/(app)/admin/canvasser/${userId}/notes`,
                params: { from: range.from || '', to: range.to || '', preset: range.preset },
              })
            }
          />
          <QuickLink
            label="Territory map"
            sub="Knock locations"
            onPress={() =>
              router.push({
                pathname: `/(app)/admin/canvasser/${userId}/map`,
                params: { from: range.from || '', to: range.to || '', preset: range.preset },
              })
            }
          />
          <QuickLink
            label="Export CSV"
            sub="All activity"
            onPress={exportCsv}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ onBack, title }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.back}>‹ Back</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title || ''}
      </Text>
      <View style={{ width: 80 }} />
    </View>
  );
}

function Highlight({ title, value, sub }) {
  return (
    <View style={styles.highlight}>
      <Text style={styles.highlightTitle}>{title}</Text>
      <Text style={styles.highlightValue}>{value}</Text>
      {sub ? <Text style={styles.highlightSub}>{sub}</Text> : null}
    </View>
  );
}

function QuickLink({ label, sub, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.quickLabel}>{label}</Text>
      <Text style={styles.quickSub}>{sub}</Text>
      <Text style={styles.quickChev}>›</Text>
    </Pressable>
  );
}

function Empty({ text }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
  headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },

  idCard: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 20 },
  name: { ...type.h2 },
  idMeta: { ...type.caption, marginTop: 1 },
  idBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
  badgeAdmin: { backgroundColor: colors.brandTint, borderColor: colors.brandTint },
  badgeAdminText: { color: colors.brand },
  badgeInactive: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBg },
  badgeInactiveText: { color: colors.danger },
  lastLogin: { ...type.caption, color: colors.textMuted },

  rangeLabel: {
    ...type.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    fontStyle: 'italic',
  },

  highlightRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  highlight: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  highlightTitle: { ...type.micro },
  highlightValue: { ...type.h2, fontSize: 18, marginTop: 4 },
  highlightSub: { ...type.caption, color: colors.textMuted, marginTop: 2 },

  qualityRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  chartCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
  qLabel: {
    ...type.bodyStrong,
    fontSize: 13,
    marginBottom: spacing.sm,
  },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  dayDate: { ...type.bodyStrong, fontSize: 14 },
  dayMeta: { ...type.caption, marginTop: 2 },
  dayDoors: { ...type.bodyStrong, fontVariant: ['tabular-nums'] },
  chev: { color: colors.textMuted, fontSize: 22, fontWeight: '300' },

  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  quickCard: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    minHeight: 64,
    position: 'relative',
  },
  quickLabel: { ...type.bodyStrong, fontSize: 14 },
  quickSub: { ...type.caption, marginTop: 2 },
  quickChev: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    color: colors.textMuted,
    fontSize: 18,
  },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emptyText: { ...type.caption, fontStyle: 'italic' },
});
