import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { MAPBOX_PUBLIC_TOKEN } from '../../../lib/config';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

const DEFAULT_CENTER = [-84.5, 39.0];

function timeAgo(date) {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function householdsToFeatures(households) {
  return {
    type: 'FeatureCollection',
    features: households
      .filter((h) => h.location?.lat != null && h.location?.lng != null)
      .map((h) => ({
        type: 'Feature',
        id: String(h.id),
        properties: { id: String(h.id), status: h.status || 'unknocked' },
        geometry: {
          type: 'Point',
          coordinates: [h.location.lng, h.location.lat],
        },
      })),
  };
}

function pingsToFeatures(activities) {
  return {
    type: 'FeatureCollection',
    features: (activities || [])
      .filter((a) => a.location?.lat != null && a.location?.lng != null)
      .map((a) => ({
        type: 'Feature',
        id: String(a.id),
        properties: { actionType: a.actionType },
        geometry: {
          type: 'Point',
          coordinates: [a.location.lng, a.location.lat],
        },
      })),
  };
}

export default function AdminMap() {
  const router = useRouter();
  const cameraRef = useRef(null);
  const [campaign, setCampaign] = useState(undefined);
  const [showPings, setShowPings] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const cId = campaign?.id;

  const mapQ = useQuery({
    queryKey: ['admin', 'households', 'map', cId, showPings],
    queryFn: () =>
      api(
        `/admin/households/map?campaignId=${cId}${
          showPings ? '&includeActivities=1' : ''
        }`
      ),
    enabled: !!cId,
    staleTime: 30 * 1000,
    refetchInterval: showPings ? 30 * 1000 : false,
  });

  const households = mapQ.data?.households || [];
  const activities = mapQ.data?.activities || [];

  const householdFeatures = useMemo(() => householdsToFeatures(households), [households]);
  const pingFeatures = useMemo(
    () => (showPings ? pingsToFeatures(activities) : { type: 'FeatureCollection', features: [] }),
    [activities, showPings]
  );

  const householdsById = useMemo(() => {
    const m = new Map();
    for (const h of households) m.set(String(h.id), h);
    return m;
  }, [households]);

  const onPinPress = useCallback(
    (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const h = householdsById.get(String(f.properties?.id));
      if (h) setSelected(h);
    },
    [householdsById]
  );

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>
          Map unavailable: missing Mapbox configuration.
        </Text>
      </SafeAreaView>
    );
  }
  if (campaign === undefined || mapQ.isLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.brand} />
        <Text style={styles.loadingText}>Loading map…</Text>
      </SafeAreaView>
    );
  }
  if (!campaign) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>
          No campaign selected. Pick one from the admin home.
        </Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const initialCenter = households[0]
    ? [households[0].location.lng, households[0].location.lat]
    : DEFAULT_CENTER;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Mapbox.MapView style={{ flex: 1 }} styleURL={Mapbox.StyleURL.Street}>
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: 12 }}
          animationMode="flyTo"
          animationDuration={500}
        />
        <Mapbox.UserLocation visible androidRenderMode="compass" />

        <Mapbox.Images
          images={{
            'house-unknocked': require('../../../assets/icons/house-unknocked.png'),
            'house-not_home': require('../../../assets/icons/house-not_home.png'),
            'house-surveyed': require('../../../assets/icons/house-surveyed.png'),
            'house-wrong_address': require('../../../assets/icons/house-wrong_address.png'),
            'house-lit_dropped': require('../../../assets/icons/house-surveyed.png'),
          }}
        />

        <Mapbox.ShapeSource id="admin-households" shape={householdFeatures} onPress={onPinPress}>
          <Mapbox.SymbolLayer
            id="admin-household-pins"
            style={{
              iconImage: [
                'match',
                ['get', 'status'],
                'unknocked', 'house-unknocked',
                'not_home', 'house-not_home',
                'surveyed', 'house-surveyed',
                'wrong_address', 'house-wrong_address',
                'lit_dropped', 'house-lit_dropped',
                'house-unknocked',
              ],
              iconSize: ['interpolate', ['linear'], ['zoom'], 10, 0.13, 14, 0.2, 17, 0.28],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
            }}
          />
        </Mapbox.ShapeSource>

        {showPings && (
          <Mapbox.ShapeSource id="admin-pings" shape={pingFeatures}>
            <Mapbox.CircleLayer
              id="admin-ping-dots"
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 17, 7],
                circleColor: [
                  'match',
                  ['get', 'actionType'],
                  'survey_submitted', colors.status.surveyed,
                  'not_home', colors.status.not_home,
                  'wrong_address', colors.status.wrong_address,
                  'lit_dropped', colors.status.lit_dropped,
                  '#6b7280',
                ],
                circleStrokeColor: '#ffffff',
                circleStrokeWidth: 1.5,
              }}
            />
          </Mapbox.ShapeSource>
        )}
      </Mapbox.MapView>

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.topBarWrap} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.topBarLeft} hitSlop={8}>
            <Text style={styles.back}>‹ Admin</Text>
          </Pressable>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {campaign.name}
          </Text>
          <View style={{ width: 80 }} />
        </View>

        <View style={styles.subBar}>
          <View style={styles.toggleChip}>
            <Switch
              value={showPings}
              onValueChange={setShowPings}
              trackColor={{ true: colors.brand, false: colors.border }}
              thumbColor={colors.card}
            />
            <Text style={styles.toggleLabel}>Canvasser pings</Text>
          </View>
          <View style={styles.countChip}>
            <Text style={styles.countText}>
              <Text style={styles.countStrong}>{households.length}</Text> houses
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {selected && (
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetAddress}>
                {selected.addressLine1}
                {selected.addressLine2 ? `, ${selected.addressLine2}` : ''}
              </Text>
              <Text style={styles.sheetSub}>
                {selected.city}, {selected.state} {selected.zipCode}
              </Text>
            </View>
            <View style={[styles.statusPill, { borderColor: colors.status[selected.status] || colors.border }]}>
              <View style={[styles.statusDot, { backgroundColor: colors.status[selected.status] }]} />
              <Text style={styles.statusText}>{colors.statusLabels[selected.status]}</Text>
            </View>
          </View>

          {selected.lastAction && (
            <View style={styles.lastActionRow}>
              <Text style={styles.lastActionText}>
                <Text style={styles.lastActionStrong}>
                  {selected.lastAction.canvasser
                    ? `${selected.lastAction.canvasser.firstName} ${selected.lastAction.canvasser.lastName}`
                    : 'Unknown'}
                </Text>{' '}
                — {colors.statusLabels[selected.status]}{' '}
                <Text style={styles.lastActionSub}>
                  ({timeAgo(selected.lastAction.timestamp)})
                </Text>
              </Text>
            </View>
          )}

          <Pressable onPress={() => setSelected(null)} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 14 },
  errorText: { color: colors.danger, marginBottom: spacing.md, textAlign: 'center' },
  primaryButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  primaryButtonText: { color: colors.textInverse, fontWeight: '700' },

  topBarWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topBarLeft: { width: 80 },
  topBarTitle: { ...type.h3, fontSize: 15, flex: 1, textAlign: 'center' },
  back: { color: colors.brand, fontWeight: '700', fontSize: 15 },

  subBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  toggleChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.sm,
  },
  toggleLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  countChip: {
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  countText: { fontSize: 12, color: colors.textSecondary },
  countStrong: { color: colors.textPrimary, fontWeight: '700' },

  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.raised,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  sheetAddress: { ...type.h3 },
  sheetSub: { ...type.caption, marginTop: 2 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.bg,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },

  lastActionRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lastActionText: { fontSize: 13, color: colors.textSecondary },
  lastActionStrong: { color: colors.textPrimary, fontWeight: '700' },
  lastActionSub: { color: colors.textMuted },

  closeButton: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.bg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeButtonText: { color: colors.textPrimary, fontWeight: '600' },
});
