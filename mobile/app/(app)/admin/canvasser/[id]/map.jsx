import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../../../../lib/api';
import { loadActiveCampaign } from '../../../../../lib/cache';
import { MAPBOX_PUBLIC_TOKEN } from '../../../../../lib/config';
import { rangeFor } from '../../../../../lib/dateRanges';
import { formatExact } from '../../../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../../../lib/theme';
import DateRangeBar from '../../../../../components/DateRangeBar';
import TabSwitcher from '../../../../../components/TabSwitcher';
import PinIcon from '../../../../../components/PinIcon';

if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

const ACTION_TABS = [
  { key: 'all', label: 'All' },
  { key: 'survey_submitted', label: 'Surveys' },
  { key: 'not_home', label: 'Not home' },
  { key: 'wrong_address', label: 'Wrong addr' },
  { key: 'lit_dropped', label: 'Lit drop' },
];

const ACTION_PIN = {
  survey_submitted: 'surveyed',
  not_home: 'not_home',
  wrong_address: 'wrong_address',
  lit_dropped: 'lit_dropped',
  note_added: 'unknocked',
};
const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
  note_added: 'Note',
};

export default function MapScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id;

  const [campaign, setCampaign] = useState(undefined);
  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const [range, setRange] = useState(() => {
    const preset = params.preset || '7d';
    if (params.from || params.to) return { preset, from: params.from || null, to: params.to || null };
    const r = rangeFor(preset);
    return { preset, from: r.from, to: r.to };
  });

  const [actionFilter, setActionFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const cId = campaign?.id;
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    if (actionFilter !== 'all') p.set('actionType', actionFilter);
    p.set('limit', '2000');
    return p.toString();
  }, [cId, range.from, range.to, actionFilter]);

  const q = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'path', qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/path?${qs}`),
    enabled: !!cId && !!userId,
  });

  const points = q.data?.points || [];
  const features = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: points
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          type: 'Feature',
          id: p.id,
          properties: { actionType: p.actionType, id: p.id },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
    }),
    [points]
  );

  const initialCenter = points[0]
    ? [points[0].lng, points[0].lat]
    : [-84.5, 39.0];

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.errText}>Map unavailable: missing Mapbox configuration.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} />
      <DateRangeBar value={range} onChange={setRange} />
      <TabSwitcher tabs={ACTION_TABS} activeKey={actionFilter} onChange={setActionFilter} />

      <View style={{ flex: 1 }}>
        {q.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <Mapbox.MapView style={{ flex: 1 }} styleURL={Mapbox.StyleURL.Street}>
            <Mapbox.Camera
              defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: 12 }}
            />
            <Mapbox.ShapeSource
              id="path-points"
              shape={features}
              onPress={(e) => {
                const f = e.features?.[0];
                if (!f) return;
                const id = String(f.properties?.id);
                const p = points.find((x) => String(x.id) === id);
                setSelected(p || null);
              }}
            >
              <Mapbox.CircleLayer
                id="path-points-layer"
                style={{
                  circleRadius: 6,
                  circleColor: [
                    'match',
                    ['get', 'actionType'],
                    'survey_submitted', colors.status.surveyed,
                    'not_home', colors.status.not_home,
                    'wrong_address', colors.status.wrong_address,
                    'lit_dropped', colors.status.lit_dropped,
                    colors.textMuted,
                  ],
                  circleStrokeColor: '#fff',
                  circleStrokeWidth: 1.5,
                }}
              />
            </Mapbox.ShapeSource>
          </Mapbox.MapView>
        )}

        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            {points.length} knock{points.length === 1 ? '' : 's'} shown
          </Text>
        </View>

        {selected ? (
          <View style={styles.detail}>
            <View style={styles.detailRow}>
              <PinIcon
                status={ACTION_PIN[selected.actionType] || 'unknocked'}
                size={20}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.detailAction}>
                  {ACTION_LABEL[selected.actionType] || selected.actionType}
                </Text>
                {selected.household ? (
                  <Text style={styles.detailAddress}>
                    {selected.household.addressLine1}
                    {selected.household.city ? `, ${selected.household.city}` : ''}
                  </Text>
                ) : null}
                <Text style={styles.detailMeta}>{formatExact(selected.timestamp)}</Text>
                {selected.distanceFromHouseMeters != null ? (
                  <Text style={styles.detailMeta}>
                    {Math.round(selected.distanceFromHouseMeters)}m from house
                    {selected.wasOfflineSubmission ? ' · offline' : ''}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => setSelected(null)} hitSlop={8}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function Header({ onBack }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.back}>‹ Back</Text>
      </Pressable>
      <Text style={styles.title}>Territory map</Text>
      <View style={{ width: 80 }} />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errText: { ...type.caption, color: colors.danger },
  summary: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryText: { ...type.caption, fontWeight: '600' },
  detail: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadow.raised,
  },
  detailRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  detailAction: { ...type.bodyStrong },
  detailAddress: { ...type.caption, marginTop: 1 },
  detailMeta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  close: { fontSize: 18, color: colors.textMuted },
});
