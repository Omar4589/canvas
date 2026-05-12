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
import { rangeFor, deviceTimezone } from '../../../../../lib/dateRanges';
import { formatRange } from '../../../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../../../lib/theme';
import DateRangeBar from '../../../../../components/DateRangeBar';

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function DaysScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id;

  const [campaign, setCampaign] = useState(undefined);
  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const [range, setRange] = useState(() => {
    const preset = params.preset || '30d';
    if (params.from || params.to) return { preset, from: params.from || null, to: params.to || null };
    const r = rangeFor(preset);
    return { preset, from: r.from, to: r.to };
  });

  const cId = campaign?.id;
  const tz = deviceTimezone();

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    p.set('tz', tz);
    return p.toString();
  }, [cId, range.from, range.to, tz]);

  const dailyQ = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'daily', qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/daily?${qs}`),
    enabled: !!cId && !!userId,
  });

  const days = dailyQ.data?.days || [];
  const isLitDrop = campaign?.type === 'lit_drop';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Day-by-day</Text>
        <View style={{ width: 80 }} />
      </View>

      <DateRangeBar value={range} onChange={setRange} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {dailyQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : days.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No active days in this range.</Text>
          </View>
        ) : (
          days.map((d) => (
            <Pressable
              key={d.date}
              onPress={() =>
                router.push({
                  pathname: `/(app)/admin/canvasser/${userId}/day/${d.date}`,
                  params: { preset: range.preset },
                })
              }
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.date}>{fmtDate(d.date)}</Text>
                <Text style={styles.shift}>
                  {formatRange(d.firstActivityAt, d.lastActivityAt)} ·{' '}
                  {d.hoursOnDoors.toFixed(1)}h on doors
                </Text>
                <View style={styles.statsRow}>
                  <Stat label="Doors" value={d.homesKnocked} />
                  {isLitDrop ? (
                    <Stat label="Lit drops" value={d.litDropped} />
                  ) : (
                    <Stat label="Surveys" value={d.surveysSubmitted} />
                  )}
                  {!isLitDrop ? (
                    <Stat label="Connection" value={`${Math.round(d.connectionRatePct)}%`} />
                  ) : null}
                  <Stat label="Doors/hr" value={d.doorsPerHour.toFixed(1)} />
                </View>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
  title: { ...type.h3, flex: 1, textAlign: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  date: { ...type.bodyStrong, fontSize: 15 },
  shift: { ...type.caption, marginTop: 2 },
  statsRow: { flexDirection: 'row', marginTop: spacing.sm, gap: spacing.md },
  stat: {},
  statValue: { ...type.bodyStrong, fontSize: 16 },
  statLabel: { ...type.caption, color: colors.textMuted, marginTop: -1 },
  chev: { color: colors.textMuted, fontSize: 22 },
  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { ...type.caption, fontStyle: 'italic' },
});
