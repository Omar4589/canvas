import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

function parseLocalDate(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayWindow(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { since: start.toISOString(), until: end.toISOString() };
}

function formatDayHeading(yyyymmdd) {
  const d = parseLocalDate(yyyymmdd);
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatPace(stats) {
  const knocked = stats.doorsKnocked || 0;
  if (!knocked || !stats.firstDoorAt || !stats.lastDoorAt) return '—';
  const hours =
    (new Date(stats.lastDoorAt).getTime() - new Date(stats.firstDoorAt).getTime()) /
    3600000;
  if (hours < 0.25) return '—';
  return `${(knocked / hours).toFixed(1)}/hr`;
}

function formatDistance(meters, doorsKnocked) {
  if (!doorsKnocked) return '—';
  const miles = (meters || 0) * 0.000621371;
  return `${miles.toFixed(1)} mi`;
}

function ShiftStat({ label, value }) {
  return (
    <View style={styles.shiftStat}>
      <Text style={styles.shiftStatValue}>{value}</Text>
      <Text style={styles.shiftStatLabel}>{label}</Text>
    </View>
  );
}

function Header({ onBack }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.back}>‹ My Stats</Text>
      </Pressable>
    </View>
  );
}

export default function DayDetailScreen() {
  const router = useRouter();
  const { date } = useLocalSearchParams();
  const dateStr = Array.isArray(date) ? date[0] : date;
  const [activeCampaign, setActiveCampaign] = useState(undefined);

  useEffect(() => {
    let mounted = true;
    loadActiveCampaign().then((c) => {
      if (mounted) setActiveCampaign(c);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const { since, until } = dayWindow(dateStr);

  const { data, isLoading, error } = useQuery({
    queryKey: ['mobile', 'me', 'day', activeCampaign?.id, dateStr],
    queryFn: () =>
      api(
        `/mobile/me/day?campaignId=${activeCampaign.id}&since=${encodeURIComponent(
          since
        )}&until=${encodeURIComponent(until)}`
      ),
    enabled: !!activeCampaign?.id && !!dateStr,
  });

  if (!activeCampaign || isLoading) {
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
        </View>
      </SafeAreaView>
    );
  }

  const stats = data || {};
  const isLitDrop = activeCampaign.type === 'lit_drop';
  const breakdown = stats.answerBreakdown || [];
  const showAnswers = !isLitDrop && breakdown.length > 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{formatDayHeading(dateStr)}</Text>

        <View style={styles.bigStat}>
          <Text style={styles.bigStatValue}>
            {(stats.doorsKnocked || 0).toLocaleString()}
          </Text>
          <Text style={styles.bigStatLabel}>doors knocked</Text>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue}>
              {isLitDrop
                ? (stats.litDropped || 0).toLocaleString()
                : (stats.responses || 0).toLocaleString()}
            </Text>
            <Text style={styles.summaryLabel}>
              {isLitDrop ? 'Lit drops' : 'Surveys'}
            </Text>
          </View>
          {!isLitDrop && (stats.litDropped || 0) > 0 && (
            <View style={styles.summaryStat}>
              <Text style={styles.summaryValue}>
                {(stats.litDropped || 0).toLocaleString()}
              </Text>
              <Text style={styles.summaryLabel}>Lit drops</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Shift</Text>
          <View style={styles.shiftGrid}>
            <ShiftStat label="First door" value={formatTime(stats.firstDoorAt)} />
            <ShiftStat label="Last door" value={formatTime(stats.lastDoorAt)} />
            <ShiftStat label="Pace" value={formatPace(stats)} />
            <ShiftStat
              label="Distance"
              value={formatDistance(stats.distanceMeters, stats.doorsKnocked)}
            />
          </View>
        </View>

        {showAnswers && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Top answers</Text>
            <View style={styles.answersList}>
              {breakdown.map((q) => (
                <View key={q.questionKey} style={styles.answerRow}>
                  <Text style={styles.answerQuestion} numberOfLines={2}>
                    {q.questionLabel}
                  </Text>
                  <Text style={styles.answerOptions}>
                    {q.topOptions.map((o) => `${o.option} ${o.count}`).join('  ·  ')}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {(stats.doorsKnocked || 0) === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No activity recorded for this day.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
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
  },

  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16 },

  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...type.title,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },

  bigStat: {
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    ...shadow.card,
  },
  bigStatValue: {
    fontSize: 48,
    fontWeight: '800',
    color: colors.textInverse,
    fontVariant: ['tabular-nums'],
    lineHeight: 52,
  },
  bigStatLabel: {
    ...type.caption,
    color: colors.textInverse,
    opacity: 0.85,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
  },

  summaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  summaryStat: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  summaryValue: {
    ...type.title,
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    ...type.caption,
    marginTop: 1,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.md,
    ...shadow.card,
  },
  sectionLabel: {
    ...type.micro,
    marginBottom: spacing.md,
  },

  shiftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
    columnGap: spacing.md,
  },
  shiftStat: {
    width: '47%',
  },
  shiftStatValue: {
    ...type.h3,
    fontVariant: ['tabular-nums'],
  },
  shiftStatLabel: {
    ...type.caption,
    marginTop: 1,
  },

  answersList: {
    gap: spacing.md,
  },
  answerRow: {},
  answerQuestion: {
    ...type.bodyStrong,
    fontSize: 14,
  },
  answerOptions: {
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  emptyText: {
    ...type.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
