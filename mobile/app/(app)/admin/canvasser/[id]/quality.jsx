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
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../../lib/api';
import { useAdminCampaign } from '../../../../../lib/useAdminCampaign';
import { rangeFor, deviceTimezone } from '../../../../../lib/dateRanges';
import { formatInTz, timeAgo } from '../../../../../lib/datetime';
import { formatDistance } from '../../../../../lib/geo';
import { makeRateColors } from '../../../../../lib/rates';
import { radius, spacing } from '../../../../../lib/theme';
import { useTheme } from '../../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../../lib/useThemedStyles';
import { useBottomInset } from '../../../../../lib/useBottomInset';
import DateRangeBar from '../../../../../components/DateRangeBar';
import BarChart from '../../../../../components/BarChart';
import SectionHeader from '../../../../../components/SectionHeader';
import InsetGroup, { InsetRow } from '../../../../../components/InsetGroup';
import ActivityRow from '../../../../../components/ActivityRow';

export default function QualityScreen() {
  const { colors } = useTheme();
  const rateColors = makeRateColors(colors);
  const styles = useThemedStyles(makeStyles);
  // The floating tab bar overlays this screen, so bottom padding must clear it.
  const bottomInset = useBottomInset();
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id;
  // Walk-list scope threaded from the overview — keeps this audit inside the same walk list.
  const effortId = params.effortId || null;

  // Threaded campaignId wins; the validated cache is the fallback — never the raw
  // cache, which can hold a campaign a team lead doesn't manage (or be empty, which
  // left every query disabled and the screen blank).
  const campaign = useAdminCampaign(params.campaignId);

  const tz = campaign?.timeZone || deviceTimezone();

  const [range, setRange] = useState(() => {
    if (params.from || params.to) {
      return { preset: params.preset || '30d', from: params.from || null, to: params.to || null };
    }
    const r = rangeFor(params.preset || '30d', null, deviceTimezone());
    return { preset: params.preset || '30d', from: r.from, to: r.to };
  });

  const rangeTouchedRef = useRef(!!(params?.from || params?.to));
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    const preset = params?.preset || '30d';
    const r = rangeFor(preset, null, tz);
    setRange({ preset, from: r.from, to: r.to });
  }, [tz]);

  function onRangeChange(next) {
    rangeTouchedRef.current = true;
    setRange(next);
  }

  const cId = campaign?.id;
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (effortId) p.set('effortId', effortId);
    if (range?.from) p.set('from', range.from);
    if (range?.to) p.set('to', range.to);
    return p.toString();
  }, [cId, effortId, range?.from, range?.to]);

  const q = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'quality', qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/quality?${qs}`),
    enabled: !!cId && !!userId && !!range,
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

      <DateRangeBar value={range} onChange={onRangeChange} tz={tz} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: spacing.xxl + bottomInset }]}>
        {q.isLoading || !data ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <>
            <InsetGroup>
              <InsetRow
                label="Offline submissions"
                value={`${data.offlinePercent}%`}
                sub={`${data.offlineCount} of ${data.totalActivities}`}
                chipColors={data.offlinePercent > 30 ? rateColors.caution : undefined}
              />
              <InsetRow
                label="Avg distance from house"
                // ft/mi at display time, metric comparison for the level — thresholds stay meters.
                value={formatDistance(data.avgDistanceFromHouseMeters)}
                chipColors={
                  data.avgDistanceFromHouseMeters != null && data.avgDistanceFromHouseMeters > 25
                    ? rateColors.caution
                    : undefined
                }
              />
              <InsetRow
                // The detector's verdict, not a raw meter cutoff: effective distance minus GPS
                // accuracy, with honest corrections and post-knock pin fixes forgiven. The
                // forgiven count explains why this number can drop after someone fixes a pin.
                label="Far knocks"
                value={`${data.farFromHousePercent}%`}
                sub={
                  data.farForgivenByPinCount != null && data.farForgivenByPinCount > 0
                    ? `${data.farFromHouseCount} flagged · ${data.farForgivenByPinCount} forgiven`
                    : `${data.farFromHouseCount} flagged`
                }
                chipColors={
                  data.farFromHousePercent > 10
                    ? rateColors.low
                    : data.farFromHousePercent > 5
                    ? rateColors.caution
                    : undefined
                }
              />
              <InsetRow
                label="Last sync"
                value={data.lastSyncAt ? timeAgo(data.lastSyncAt) : '—'}
                sub={data.lastSyncAt
                  ? formatInTz(data.lastSyncAt, campaign?.timeZone, { year: 'numeric', month: 'numeric', day: 'numeric' }, false)
                  : null}
              />
            </InsetGroup>

            <SectionHeader
              title="Distance from house"
              subtitle="How far from the house pin each entry was logged"
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

            <SectionHeader title="Flagged activities" subtitle="Offline or > 250 ft from house · forgiven = pin corrected later" />
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

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
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
}
