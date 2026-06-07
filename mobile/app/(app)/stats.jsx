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
import KpiGrid from '../../components/KpiGrid';
import { radius, spacing } from '../../lib/theme';
import { useTheme } from '../../lib/ThemeContext';
import { useThemedStyles } from '../../lib/useThemedStyles';

const TREND_HEIGHT = 64;
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

function Tag({ kind, children }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.tag, styles[`tag_${kind}`]]}>
      <Text style={[styles.tagText, styles[`tagText_${kind}`]]}>{children}</Text>
    </View>
  );
}

// A compact doors-per-day trend (vertical bars), newest on the right. Bars scale
// to the peak day; days with no activity render as a faint stub so gaps read as
// "didn't canvass" rather than missing.
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
              <View style={[styles.trendBar, { height: h }, v === 0 && styles.trendBarEmpty]} />
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
  const shift = shiftRange(day.firstDoorAt, day.lastDoorAt);
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
        {shift ? <Text style={styles.dayShift}>{shift}</Text> : null}
        <Text style={styles.daySummary}>
          <Text style={styles.daySummaryStrong}>{(day.doorsKnocked || 0).toLocaleString()}</Text> doors
          {'  ·  '}
          <Text style={styles.daySummaryStrong}>{secondaryValue.toLocaleString()}</Text> {secondaryLabel}
          {rate ? (
            <Text>
              {'  ·  '}
              <Text style={styles.daySummaryStrong}>{rate.value}</Text>
            </Text>
          ) : null}
          {pace !== '—' ? `  ·  ${pace}` : ''}
        </Text>
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

  // Personal stats stay on the phone's local time — a motivation view, not
  // cross-admin reporting (see docs/TIMEZONES.md).
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mobile', 'me', 'history', activeCampaign?.id, tz],
    queryFn: () =>
      api(
        `/mobile/me/history?campaignId=${activeCampaign.id}&tz=${encodeURIComponent(tz)}`
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

  const days = data?.days || [];
  const allTime = data?.allTime || {};
  const personalBest = data?.personalBest;
  const streak = data?.currentStreak || 0;
  const isLitDrop = activeCampaign.type === 'lit_drop';
  const todayStr = getLocalDateStr();
  const yesterdayStr = getYesterdayStr();

  const primaryLabel = isLitDrop ? 'Lit drops' : 'Surveys';
  const primaryValue = isLitDrop ? allTime.litDropped : allTime.surveysSubmitted;
  const rate = getConnectionRate(primaryValue, allTime.doorsKnocked);

  const kpiTiles = [
    { label: 'Doors knocked', value: (allTime.doorsKnocked || 0).toLocaleString() },
    { label: primaryLabel, value: (primaryValue || 0).toLocaleString() },
    {
      label: isLitDrop ? 'Lit rate' : 'Connection rate',
      value: rate ? rate.value : '—',
      level: rate ? rate.level : undefined,
    },
    { label: 'Days active', value: (allTime.daysActive || 0).toLocaleString() },
  ];

  const highlightTiles = [
    {
      label: 'Best day',
      value: personalBest ? personalBest.doorsKnocked.toLocaleString() : '—',
      sub: personalBest ? formatBestDate(personalBest.date) : 'no data yet',
    },
    { label: 'Streak', value: String(streak), sub: `day${streak === 1 ? '' : 's'} in a row` },
    { label: 'Miles walked', value: metersToMiles(allTime.distanceMeters), sub: 'all time' },
  ];

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

        <Text style={styles.sectionLabel}>All time</Text>
        <KpiGrid tiles={kpiTiles} columns={2} />
        <View style={styles.highlightGap}>
          <KpiGrid tiles={highlightTiles} columns={3} compact />
        </View>

        {days.length >= 2 && <DoorsTrend days={days} />}

        <Text style={[styles.sectionLabel, styles.sectionGap]}>Shift history</Text>
        {days.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No activity yet. Knock your first door to start tracking.
            </Text>
          </View>
        ) : (
          <View style={styles.dayList}>
            {days.map((d) => (
              <DayRow
                key={d.date}
                day={d}
                todayStr={todayStr}
                yesterdayStr={yesterdayStr}
                bestDate={personalBest?.date}
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
    subtitle: { ...type.caption, marginBottom: spacing.lg },

    sectionLabel: { ...type.micro, marginBottom: spacing.sm },
    sectionGap: { marginTop: spacing.xl },
    highlightGap: { marginTop: spacing.sm },

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
    trendBars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: TREND_HEIGHT,
      gap: 4,
    },
    trendCol: { flex: 1, justifyContent: 'flex-end' },
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
    dayShift: { ...type.caption, color: colors.textMuted, marginBottom: 2 },
    daySummary: { ...type.caption },
    daySummaryStrong: { color: colors.textPrimary, fontWeight: '700' },
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
