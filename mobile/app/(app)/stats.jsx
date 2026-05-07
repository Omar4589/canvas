import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { loadActiveCampaign } from '../../lib/cache';
import { colors, radius, spacing, type, shadow } from '../../lib/theme';

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

function StatCell({ value, label }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Tag({ kind, children }) {
  return (
    <View style={[styles.tag, styles[`tag_${kind}`]]}>
      <Text style={[styles.tagText, styles[`tagText_${kind}`]]}>{children}</Text>
    </View>
  );
}

function DayRow({ day, todayStr, yesterdayStr, bestDate, isLitDrop, onPress }) {
  const isToday = day.date === todayStr;
  const isYesterday = day.date === yesterdayStr;
  const isBest = bestDate && day.date === bestDate;
  const secondaryLabel = isLitDrop ? 'lit drops' : 'surveys';
  const secondaryValue = isLitDrop ? day.litDropped : day.responses;
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
        <Text style={styles.daySummary}>
          <Text style={styles.daySummaryStrong}>{day.doorsKnocked}</Text> doors
          {' · '}
          <Text style={styles.daySummaryStrong}>{secondaryValue}</Text> {secondaryLabel}
          {' · '}
          {metersToMiles(day.distanceMeters)} mi
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function StatsScreen() {
  const router = useRouter();
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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>My Stats</Text>
        <Text style={styles.subtitle}>{activeCampaign.name}</Text>

        <View style={styles.allTimeCard}>
          <Text style={styles.sectionLabel}>All time</Text>
          <View style={styles.allTimeGrid}>
            <StatCell value={allTime.doorsKnocked?.toLocaleString()} label="Doors knocked" />
            <StatCell value={primaryValue?.toLocaleString()} label={primaryLabel} />
            <StatCell value={metersToMiles(allTime.distanceMeters)} label="Miles walked" />
            <StatCell value={allTime.daysActive?.toLocaleString()} label="Days active" />
          </View>

          {streak > 0 && (
            <View style={styles.streakBanner}>
              <Text style={styles.streakValue}>{streak}</Text>
              <Text style={styles.streakLabel}>
                day{streak === 1 ? '' : 's'} in a row
              </Text>
            </View>
          )}

          {personalBest && (
            <View style={styles.bestRow}>
              <Text style={styles.bestLabel}>Personal best</Text>
              <Text style={styles.bestValue}>
                {personalBest.doorsKnocked} doors · {formatBestDate(personalBest.date)}
              </Text>
            </View>
          )}
        </View>

        <Text style={[styles.sectionLabel, styles.sectionGap]}>Recent days</Text>
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
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.back}>‹ Map</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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

  sectionLabel: {
    ...type.micro,
    marginBottom: spacing.sm,
  },
  sectionGap: { marginTop: spacing.xl },

  allTimeCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  allTimeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
    columnGap: spacing.md,
  },
  statCell: {
    width: '47%',
  },
  statValue: {
    ...type.title,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    ...type.caption,
    marginTop: 1,
  },

  streakBanner: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: colors.brandTint,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  streakValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.brand,
    fontVariant: ['tabular-nums'],
  },
  streakLabel: {
    ...type.body,
    color: colors.brand,
    fontWeight: '600',
  },

  bestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bestLabel: {
    ...type.micro,
  },
  bestValue: {
    ...type.bodyStrong,
    fontSize: 13,
  },

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
  dayDate: {
    ...type.bodyStrong,
  },
  daySummary: {
    ...type.caption,
  },
  daySummaryStrong: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
    fontWeight: '300',
  },

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
  tag_today: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  tagText_today: { color: colors.textInverse },
  tag_yesterday: {
    backgroundColor: colors.brandTint,
    borderColor: colors.brand,
  },
  tagText_yesterday: { color: colors.brand },
  tag_best: {
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
  },
  tagText_best: { color: colors.success },
});
