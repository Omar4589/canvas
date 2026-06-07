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
import { getConnectionRate, formatPace } from '../../../lib/rates';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

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

function ShiftStat({ label, value }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.shiftStat}>
      <Text style={styles.shiftStatValue}>{value}</Text>
      <Text style={styles.shiftStatLabel}>{label}</Text>
    </View>
  );
}

// Compact stat card under the big doors number; `level` color-tiers the value.
function MetaStat({ value, label, level }) {
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
    <View style={styles.metaStat}>
      <Text style={[styles.metaValue, { color }]}>{value}</Text>
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  );
}

function Header({ onBack }) {
  const styles = useThemedStyles(makeStyles);
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  const primaryValue = isLitDrop ? stats.litDropped || 0 : stats.responses || 0;
  const rate = getConnectionRate(primaryValue, stats.doorsKnocked);
  const showExtraLit = !isLitDrop && (stats.litDropped || 0) > 0;

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

        <View style={styles.metaRow}>
          <MetaStat
            value={primaryValue.toLocaleString()}
            label={isLitDrop ? 'Lit drops' : 'Surveys'}
          />
          <MetaStat
            value={rate ? rate.value : '—'}
            label={isLitDrop ? 'Lit rate' : 'Connection'}
            level={rate ? rate.level : undefined}
          />
          {showExtraLit && (
            <MetaStat value={(stats.litDropped || 0).toLocaleString()} label="Lit drops" />
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Shift</Text>
          <View style={styles.shiftGrid}>
            <ShiftStat label="First door" value={formatTime(stats.firstDoorAt)} />
            <ShiftStat label="Last door" value={formatTime(stats.lastDoorAt)} />
            <ShiftStat
              label="Pace"
              value={formatPace(stats.doorsKnocked, stats.firstDoorAt, stats.lastDoorAt)}
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

  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  metaStat: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  metaValue: {
    ...type.title,
    fontVariant: ['tabular-nums'],
  },
  metaLabel: {
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
    columnGap: spacing.md,
  },
  shiftStat: {
    flex: 1,
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
}
