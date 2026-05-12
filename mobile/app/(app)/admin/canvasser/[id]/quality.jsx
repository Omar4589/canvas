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
import { rangeFor } from '../../../../../lib/dateRanges';
import { formatExact, timeAgo } from '../../../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../../../lib/theme';
import DateRangeBar from '../../../../../components/DateRangeBar';
import BarChart from '../../../../../components/BarChart';
import SectionHeader from '../../../../../components/SectionHeader';
import KpiGrid from '../../../../../components/KpiGrid';
import ActivityRow from '../../../../../components/ActivityRow';

export default function QualityScreen() {
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
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    return p.toString();
  }, [cId, range.from, range.to]);

  const q = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'quality', qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/quality?${qs}`),
    enabled: !!cId && !!userId,
  });

  const data = q.data;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Quality & sync audit</Text>
        <View style={{ width: 80 }} />
      </View>

      <DateRangeBar value={range} onChange={setRange} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {q.isLoading || !data ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <>
            <KpiGrid
              tiles={[
                {
                  label: 'Offline submissions',
                  value: `${data.offlinePercent}%`,
                  sub: `${data.offlineCount} of ${data.totalActivities}`,
                  level: data.offlinePercent > 30 ? 'caution' : undefined,
                },
                {
                  label: 'Avg distance from house',
                  value:
                    data.avgDistanceFromHouseMeters != null
                      ? `${data.avgDistanceFromHouseMeters}m`
                      : '—',
                  level:
                    data.avgDistanceFromHouseMeters != null && data.avgDistanceFromHouseMeters > 25
                      ? 'caution'
                      : undefined,
                },
                {
                  label: 'Knocks > 50m',
                  value: `${data.farFromHousePercent}%`,
                  sub: `${data.farFromHouseCount} flagged`,
                  level:
                    data.farFromHousePercent > 10
                      ? 'low'
                      : data.farFromHousePercent > 5
                      ? 'caution'
                      : undefined,
                },
                {
                  label: 'Last sync',
                  value: data.lastSyncAt ? timeAgo(data.lastSyncAt) : '—',
                  sub: data.lastSyncAt
                    ? new Date(data.lastSyncAt).toLocaleDateString()
                    : null,
                },
              ]}
              compact
            />

            <SectionHeader
              title="Distance from house"
              subtitle="GPS accuracy when each knock was logged"
            />
            <View style={styles.chartCard}>
              <BarChart
                data={data.distanceHistogram.map((b) => ({
                  label: b.bucket,
                  value: b.count,
                  color:
                    b.bucket === '100m+'
                      ? colors.danger
                      : b.bucket === '50-100m'
                      ? colors.warn
                      : colors.brand,
                }))}
              />
            </View>

            <SectionHeader
              title="Sync lag"
              subtitle="Time between submitted and synced (survey responses)"
            />
            <View style={styles.chartCard}>
              <BarChart data={data.syncLagHistogram.map((b) => ({ label: b.bucket, value: b.count }))} />
            </View>

            <SectionHeader title="Flagged activities" subtitle="Offline OR > 50m from house" />
            {data.flaggedActivities.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No flagged activity in this range.</Text>
              </View>
            ) : (
              data.flaggedActivities.map((a) => (
                <ActivityRow key={a.id} activity={a} showDate />
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
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
  chartCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
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
