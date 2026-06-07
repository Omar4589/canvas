import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useRefresh } from '../../lib/useRefresh';
import { loadActiveCampaign } from '../../lib/cache';
import { getConnectionRate, formatPace } from '../../lib/rates';
import { rangeFor, deviceTimezone } from '../../lib/dateRanges';
import DateRangeBar from '../../components/DateRangeBar';
import { radius, spacing } from '../../lib/theme';
import { useTheme } from '../../lib/ThemeContext';
import { useThemedStyles } from '../../lib/useThemedStyles';

const TREND_HEIGHT = 56;
const TREND_DAYS = 14;

function getLocalDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateStr(d);
}

function parseLocalDate(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatRowDate(yyyymmdd) {
  const d = parseLocalDate(yyyymmdd);
  const wd = d.toLocaleDateString([], { weekday: 'short' });
  const md = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${wd} · ${md}`;
}

function formatBestDate(yyyymmdd) {
  const d = parseLocalDate(yyyymmdd);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function metersToMiles(m) {
  return ((m || 0) * 0.000621371).toFixed(1);
}

function formatClock(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function shiftRange(firstAt, lastAt) {
  const a = formatClock(firstAt);
  const b = formatClock(lastAt);
  if (!a && !b) return null;
  if (a && b) return `${a} – ${b}`;
  return a || b;
}

// One compact inline stat for the summary strip. `level` color-tiers the value
// (used for connection / lit rate).
function Stat({ value, label, level }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const color =
    level === 'good'
      ? colors.success
      : level === 'caution'
      ? colors.warnFg
      : level === 'low'
      ? colors.danger
      : colors.textPrimary;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Tag({ kind, children }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.tag, styles[`tag_${kind}`]]}>
      <Text style={[styles.tagText, styles[`tagText_${kind}`]]}>{children}</Text>
    </View>
  );
}

// Doors-per-day trend: the count sits in a fixed-height label row on top (so the
// numbers stay aligned regardless of bar height), bar bottom-aligned below.
function DoorsTrend({ days }) {
  const styles = useThemedStyles(makeStyles);
  const series = days.slice(0, TREND_DAYS).reverse();
  const max = Math.max(1, ...series.map((d) => d.doorsKnocked || 0));
  return (
    <View style={styles.trendCard}>
      <View style={styles.trendHeader}>
        <Text style={styles.sectionLabel}>Doors per day</Text>
        <Text style={styles.trendPeak}>peak {max}</Text>
      </View>
      <View style={styles.trendBars}>
        {series.map((d) => {
          const v = d.doorsKnocked || 0;
          const h = v > 0 ? Math.max(4, Math.round((v / max) * TREND_HEIGHT)) : 2;
          return (
            <View key={d.date} style={styles.trendCol}>
              <Text style={styles.trendVal} numberOfLines={1}>
                {v > 0 ? v : ''}
              </Text>
              <View style={styles.trendBarZone}>
                <View style={[styles.trendBar, { height: h }, v === 0 && styles.trendBarEmpty]} />
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.trendFoot}>
        <Text style={styles.trendFootText}>{formatBestDate(series[0].date)}</Text>
        <Text style={styles.trendFootText}>{formatBestDate(series[series.length - 1].date)}</Text>
      </View>
    </View>
  );
}

function DayRow({ day, todayStr, yesterdayStr, bestDate, isLitDrop, onPress }) {
  const styles = useThemedStyles(makeStyles);
  const isToday = day.date === todayStr;
  const isYesterday = day.date === yesterdayStr;
  const isBest = bestDate && day.date === bestDate;
  const secondaryLabel = isLitDrop ? 'lit' : 'surveys';
  const secondaryValue = isLitDrop ? day.litDropped || 0 : day.responses || 0;
  const rate = getConnectionRate(secondaryValue, day.doorsKnocked);
  const pace = formatPace(day.doorsKnocked, day.firstDoorAt, day.lastDoorAt);
  const detail = [
    shiftRange(day.firstDoorAt, day.lastDoorAt),
    `${secondaryValue.toLocaleString()} ${secondaryLabel}`,
    rate ? rate.value : null,
    pace !== '—' ? pace : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.dayRow, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.dayHeaderRow}>
          <Text style={styles.dayDate}>{formatRowDate(day.date)}</Text>
          {isToday && <Tag kind="today">Today</Tag>}
          {isYesterday && <Tag kind="yesterday">Yesterday</Tag>}
          {isBest && !isToday && !isYesterday && <Tag kind="best">Best</Tag>}
        </View>
        <Text style={styles.daySummary} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <View style={styles.dayDoorsWrap}>
        <Text style={styles.dayDoors}>{(day.doorsKnocked || 0).toLocaleString()}</Text>
        <Text style={styles.dayDoorsLabel}>doors</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function StatsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [activeCampaign, setActiveCampaign] = useState(undefined);

  // Personal stats stay on the phone's local time — a motivation view, not
  // cross-admin reporting (see docs/TIMEZONES.md). The date filter is computed in
  // the same tz the history is bucketed in.
  const deviceTz = deviceTimezone();
  const [range, setRange] = useState(() => {
    const r = rangeFor('30d', null, deviceTz);
    return { preset: '30d', from: r.from, to: r.to };
  });

  useEffect(() => {
    let mounted = true;
    loadActiveCampaign().then((c) => {
      if (!mounted) return;
      if (!c) {
        router.replace('/(app)/campaigns');
        return;
      }
      setActiveCampaign(c);
    });
    return () => {
      mounted = false;
    };
  }, [router]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mobile', 'me', 'history', activeCampaign?.id, deviceTz],
    queryFn: () =>
      api(
        `/mobile/me/history?campaignId=${activeCampaign.id}&tz=${encodeURIComponent(deviceTz)}`
      ),
    enabled: !!activeCampaign?.id,
    staleTime: 30 * 1000,
  });

  const { refreshing, onRefresh } = useRefresh([refetch]);

  if (activeCampaign === undefined || (activeCampaign && isLoading)) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error.message}</Text>
          <Pressable onPress={refetch} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const allDays = data?.days || [];
  const isLitDrop = activeCampaign.type === 'lit_drop';
  const todayStr = getLocalDateStr();
  const yesterdayStr = getYesterdayStr();

  // Scope the whole page to the selected range — the server returns every day, so
  // we filter client-side (string compare on YYYY-MM-DD; `to` null = open-ended).
  const days = allDays.filter(
    (d) => (!range.from || d.date >= range.from) && (!range.to || d.date <= range.to)
  );

  const totalDoors = days.reduce((s, d) => s + (d.doorsKnocked || 0), 0);
  const totalResponses = days.reduce((s, d) => s + (d.responses || 0), 0);
  const totalLit = days.reduce((s, d) => s + (d.litDropped || 0), 0);
  const totalDistance = days.reduce((s, d) => s + (d.distanceMeters || 0), 0);
  const daysActive = days.filter((d) => (d.doorsKnocked || 0) > 0).length;
  const primaryValue = isLitDrop ? totalLit : totalResponses;
  const rate = getConnectionRate(primaryValue, totalDoors);
  const streak = data?.currentStreak || 0;
  const best = days.reduce(
    (b, d) => (!b || (d.doorsKnocked || 0) > (b.doorsKnocked || 0) ? d : b),
    null
  );
  const bestHasData = best && (best.doorsKnocked || 0) > 0;

  const secondaryParts = [
    bestHasData ? `Best ${best.doorsKnocked.toLocaleString()} (${formatBestDate(best.date)})` : null,
    streak > 0 ? `${streak}-day streak` : null,
    totalDistance > 0 ? `${metersToMiles(totalDistance)} mi` : null,
  ].filter(Boolean);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        <Text style={styles.title}>My Stats</Text>
        <Text style={styles.subtitle}>{activeCampaign.name}</Text>

        <View style={styles.filterWrap}>
          <DateRangeBar value={range} onChange={setRange} tz={deviceTz} />
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Stat value={totalDoors.toLocaleString()} label="Doors" />
            <Stat value={primaryValue.toLocaleString()} label={isLitDrop ? 'Lit drops' : 'Surveys'} />
            <Stat
              value={rate ? rate.value : '—'}
              label={isLitDrop ? 'Lit rate' : 'Connection'}
              level={rate ? rate.level : undefined}
            />
            <Stat value={daysActive.toLocaleString()} label="Days" />
          </View>
          {secondaryParts.length > 0 && (
            <Text style={styles.summarySub}>{secondaryParts.join('  ·  ')}</Text>
          )}
        </View>

        {days.length >= 2 && <DoorsTrend days={days} />}

        <Text style={[styles.sectionLabel, styles.sectionGap]}>Shift history</Text>
        {allDays.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No activity yet. Knock your first door to start tracking.
            </Text>
          </View>
        ) : days.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No activity in this range.</Text>
          </View>
        ) : (
          <View style={styles.dayList}>
            {days.map((d) => (
              <DayRow
                key={d.date}
                day={d}
                todayStr={todayStr}
                yesterdayStr={yesterdayStr}
                bestDate={best?.date}
                isLitDrop={isLitDrop}
                onPress={() => router.push(`/(app)/stats/${d.date}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ onBack }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.back}>‹ Map</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    errorText: {
      ...type.body,
      color: colors.danger,
      textAlign: 'center',
      marginBottom: spacing.md,
    },
    retryBtn: {
      backgroundColor: colors.brand,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.md,
    },
    retryText: { color: colors.textInverse, fontWeight: '700' },

    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    back: { color: colors.brand, fontWeight: '700', fontSize: 16 },

    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    title: { ...type.title, marginTop: spacing.xs },
    subtitle: { ...type.caption, marginBottom: spacing.md },

    // DateRangeBar brings its own horizontal padding; cancel the ScrollView's so
    // the pill row scrolls edge-to-edge and aligns with the title.
    filterWrap: { marginHorizontal: -spacing.lg, marginBottom: spacing.sm },

    sectionLabel: { ...type.micro, marginBottom: spacing.sm },
    sectionGap: { marginTop: spacing.xl },

    summaryCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      ...shadow.card,
    },
    summaryRow: { flexDirection: 'row' },
    stat: { flex: 1 },
    statValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
    statLabel: { ...type.micro, color: colors.textSecondary, marginTop: 2 },
    summarySub: {
      ...type.caption,
      color: colors.textMuted,
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },

    trendCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginTop: spacing.xl,
      ...shadow.card,
    },
    trendHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    trendPeak: { ...type.caption, color: colors.textMuted },
    trendBars: { flexDirection: 'row', gap: 4 },
    trendCol: { flex: 1 },
    trendVal: {
      height: 14,
      fontSize: 10,
      lineHeight: 12,
      textAlign: 'center',
      color: colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
    trendBarZone: { height: TREND_HEIGHT, justifyContent: 'flex-end', alignItems: 'center' },
    trendBar: {
      width: '100%',
      backgroundColor: colors.brand,
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
    },
    trendBarEmpty: { backgroundColor: colors.border },
    trendFoot: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: spacing.xs,
    },
    trendFootText: { ...type.caption, color: colors.textMuted, fontSize: 11 },

    empty: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.xl,
      alignItems: 'center',
    },
    emptyText: {
      ...type.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },

    dayList: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    dayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: spacing.sm,
    },
    dayHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: 2,
    },
    dayDate: { ...type.bodyStrong },
    daySummary: { ...type.caption },
    dayDoorsWrap: { alignItems: 'flex-end', minWidth: 48 },
    dayDoors: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    dayDoorsLabel: {
      fontSize: 9,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: -2,
    },
    chevron: { color: colors.textMuted, fontSize: 22, fontWeight: '300' },

    tag: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    tagText: {
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    tag_today: { backgroundColor: colors.brand, borderColor: colors.brand },
    tagText_today: { color: colors.textInverse },
    tag_yesterday: { backgroundColor: colors.brandTint, borderColor: colors.brand },
    tagText_yesterday: { color: colors.brand },
    tag_best: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
    tagText_best: { color: colors.success },
  });
}
