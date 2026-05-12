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
import Mapbox from '@rnmapbox/maps';
import { api } from '../../../../../../lib/api';
import { loadActiveCampaign } from '../../../../../../lib/cache';
import { MAPBOX_PUBLIC_TOKEN } from '../../../../../../lib/config';
import { deviceTimezone } from '../../../../../../lib/dateRanges';
import { formatRange } from '../../../../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../../../../lib/theme';
import ActivityRow from '../../../../../../components/ActivityRow';

if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

const ACTION_COLOR = {
  survey_submitted: colors.status.surveyed,
  not_home: colors.status.not_home,
  wrong_address: colors.status.wrong_address,
  lit_dropped: colors.status.lit_dropped,
  note_added: colors.textMuted,
};

function dayBounds(dateStr) {
  // Treat as local day; round to UTC ISO for the API.
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start.getTime() + 86400000);
  return { from: start.toISOString(), to: end.toISOString() };
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function DayDetail() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id;
  const date = params.date;

  const [campaign, setCampaign] = useState(undefined);
  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const { from, to } = useMemo(() => dayBounds(date), [date]);
  const cId = campaign?.id;
  const tz = deviceTimezone();

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    p.set('from', from);
    p.set('to', to);
    p.set('tz', tz);
    return p.toString();
  }, [cId, from, to, tz]);

  const summaryQ = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'day-summary', date, qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/summary?${qs}`),
    enabled: !!cId && !!userId,
  });

  const activitiesQ = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'day-activities', date, qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/activities?${qs}&limit=500&order=asc`),
    enabled: !!cId && !!userId,
  });

  const pathQ = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'day-path', date, qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/path?${qs}`),
    enabled: !!cId && !!userId,
  });

  const s = summaryQ.data;
  const activities = activitiesQ.data?.activities || [];
  const points = pathQ.data?.points || [];

  const features = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: points
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          type: 'Feature',
          id: p.id,
          properties: { actionType: p.actionType, id: p.id },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
    };
  }, [points]);

  const lineFeatures = useMemo(() => {
    if (points.length < 2) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: points
              .filter((p) => p.lat != null && p.lng != null)
              .map((p) => [p.lng, p.lat]),
          },
          properties: {},
        },
      ],
    };
  }, [points]);

  const initialCenter = points[0]
    ? [points[0].lng, points[0].lat]
    : [-84.5, 39.0];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {fmtDate(date)}
          </Text>
          {s?.user ? (
            <Text style={styles.subtitle}>
              {s.user.firstName} {s.user.lastName}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {summaryQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : !s ? null : (
          <View style={styles.statsCard}>
            <Stat label="Doors" value={s.kpi.homesKnocked} />
            <Stat
              label="Surveys"
              value={s.kpi.surveysSubmitted}
            />
            <Stat
              label="Connection"
              value={`${Math.round(s.kpi.connectionRatePct)}%`}
            />
            <Stat label="Hours" value={s.kpi.hoursOnDoors.toFixed(1)} />
          </View>
        )}
        {s?.highlights?.firstActivityAt ? (
          <Text style={styles.shiftLine}>
            🕘 {formatRange(s.highlights.firstActivityAt, s.highlights.lastActivityAt)}
          </Text>
        ) : null}

        {/* Mini map */}
        {MAPBOX_PUBLIC_TOKEN && points.length > 0 ? (
          <View style={styles.mapCard}>
            <Mapbox.MapView style={styles.map} styleURL={Mapbox.StyleURL.Street}>
              <Mapbox.Camera
                defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: 13 }}
              />
              <Mapbox.ShapeSource id="day-line" shape={lineFeatures}>
                <Mapbox.LineLayer
                  id="day-line-layer"
                  style={{
                    lineColor: colors.brand,
                    lineWidth: 2,
                    lineOpacity: 0.5,
                  }}
                />
              </Mapbox.ShapeSource>
              <Mapbox.ShapeSource id="day-points" shape={features}>
                <Mapbox.CircleLayer
                  id="day-points-layer"
                  style={{
                    circleRadius: 6,
                    circleColor: [
                      'match',
                      ['get', 'actionType'],
                      'survey_submitted', ACTION_COLOR.survey_submitted,
                      'not_home', ACTION_COLOR.not_home,
                      'wrong_address', ACTION_COLOR.wrong_address,
                      'lit_dropped', ACTION_COLOR.lit_dropped,
                      colors.textMuted,
                    ],
                    circleStrokeColor: '#fff',
                    circleStrokeWidth: 1.5,
                  }}
                />
              </Mapbox.ShapeSource>
            </Mapbox.MapView>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>
          Activity timeline · {activities.length} event{activities.length === 1 ? '' : 's'}
        </Text>

        {activitiesQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : activities.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No activity recorded.</Text>
          </View>
        ) : (
          activities.map((a) => <ActivityRow key={a.id} activity={a} />)
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
  title: { ...type.h3, textAlign: 'center' },
  subtitle: { ...type.caption, textAlign: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.md,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { ...type.h2, fontSize: 20 },
  statLabel: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  shiftLine: { ...type.caption, marginVertical: spacing.sm, textAlign: 'center' },
  mapCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
    height: 220,
  },
  map: { flex: 1 },
  sectionTitle: { ...type.h3, marginTop: spacing.md, marginBottom: spacing.sm },
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
