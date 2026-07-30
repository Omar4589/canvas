import { useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { initMapbox } from '../../../../lib/mapbox';
import { useMapStyle } from '../../../../lib/mapStyles';
import { formatExact, timeAgo } from '../../../../lib/datetime';
import { radius, spacing, actionLabel } from '../../../../lib/theme';
import { useTheme } from '../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../lib/useThemedStyles';
import { useConsoleRoleLabel } from '../../../../lib/useConsoleRole';

initMapbox();

// Overlap detail (item D14): one collided house — where it is, and exactly who knocked it
// when, per pass. Opened from the Overlaps list, which threads the whole entry through
// params (`data`) so this renders instantly with no extra fetch; the map centers on the
// house's own coordinates (the overlap payload carries `household.location`).
export default function OverlapDetail() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const roleLabel = useConsoleRoleLabel();
  const params = useLocalSearchParams();
  const { styleURL } = useMapStyle();
  const cameraRef = useRef(null);

  const entry = useMemo(() => {
    try {
      return params.data ? JSON.parse(String(params.data)) : null;
    } catch {
      return null;
    }
  }, [params.data]);
  const campaignId = typeof params.campaignId === 'string' ? params.campaignId : '';
  const tzName = typeof params.tz === 'string' && params.tz ? params.tz : undefined;

  const h = entry?.household || null;
  const coords = h?.location?.coordinates?.length === 2 ? h.location.coordinates : null;
  const pointFC = useMemo(
    () =>
      coords
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} }] }
        : { type: 'FeatureCollection', features: [] },
    [coords]
  );

  function actionColor(t) {
    return colors.status[t === 'survey_submitted' ? 'surveyed' : t] || colors.textMuted;
  }

  if (!entry) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.back} numberOfLines={1}>‹ Overlaps</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Overlap</Text>
          <View style={{ width: 80 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.muted}>This overlap is no longer available — go back and reopen it.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back} numberOfLines={1}>‹ Overlaps</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Overlap</Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.xxl) }}>
        <Text style={styles.address}>
          {h ? `${h.addressLine1}${h.addressLine2 ? `, ${h.addressLine2}` : ''}` : 'Address unavailable'}
        </Text>
        {h ? (
          <Text style={styles.addressSub}>
            {h.city}, {h.state} {h.zipCode}
          </Text>
        ) : null}

        {/* The house. ShapeSource + CircleLayer — never MarkerView/PointAnnotation (they
            break pinch-zoom on Fabric; the repo-wide rule). */}
        {coords ? (
          <View style={styles.mapCard}>
            <Mapbox.MapView
              style={{ flex: 1 }}
              styleURL={styleURL}
              logoEnabled={false}
              attributionPosition={{ bottom: 4, right: 4 }}
              scaleBarEnabled={false}
            >
              <Mapbox.Camera
                ref={cameraRef}
                defaultSettings={{ centerCoordinate: coords, zoomLevel: 16.5 }}
              />
              <Mapbox.ShapeSource id="overlap-house" shape={pointFC}>
                <Mapbox.CircleLayer
                  id="overlap-house-halo"
                  style={{ circleRadius: 16, circleColor: colors.brand, circleOpacity: 0.2 }}
                />
                <Mapbox.CircleLayer
                  id="overlap-house-dot"
                  style={{
                    circleRadius: 7,
                    circleColor: colors.brand,
                    circleStrokeColor: '#ffffff',
                    circleStrokeWidth: 2,
                  }}
                />
              </Mapbox.ShapeSource>
            </Mapbox.MapView>
          </View>
        ) : (
          <Text style={[styles.muted, { marginTop: spacing.md }]}>No coordinates on file for this house.</Text>
        )}

        <View style={styles.countRow}>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{entry.totalCanvassers} canvassers</Text>
          </View>
        </View>

        {(entry.passes || []).map((p) => (
          <View key={p.passId || 'none'} style={styles.passBlock}>
            <Text style={styles.passLabel}>{p.roundLabel}</Text>
            {(p.canvassers || []).map((c, i) => (
              <View key={`${c.userId}-${i}`} style={styles.canvasserRow}>
                <View style={[styles.actionDot, { backgroundColor: actionColor(c.actionType) }]} />
                <View style={{ flex: 1 }}>
                  <View style={styles.canvasserTopLine}>
                    <Text style={styles.canvasserName} numberOfLines={1}>
                      {c.firstName} {c.lastName}
                    </Text>
                    <Text style={styles.canvasserAction}>{actionLabel(c.actionType)}</Text>
                    <Text style={styles.canvasserTimeAgo}>{timeAgo(c.lastAt)}</Text>
                  </View>
                  <Text style={styles.canvasserTimestamp}>
                    {formatExact(c.lastAt, tzName)}
                    {c.inRange === false ? ' · earlier' : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ))}

        {/* Hand off to the full live map (activity history, pings, pin move, …). */}
        {h?.id && campaignId ? (
          <Pressable
            onPress={() =>
              router.push(`/(app)/admin/map?household=${h.id}&focusAt=${Date.now()}&hcid=${campaignId}`)
            }
            style={styles.mapBtn}
          >
            <Text style={styles.mapBtnText}>Open on live map ›</Text>
          </Pressable>
        ) : null}
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
      justifyContent: 'space-between',
    },
    back: { color: colors.brand, fontWeight: '600', fontSize: 14, flexShrink: 0 },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    muted: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
    address: { ...type.h3, color: colors.textPrimary },
    addressSub: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    mapCard: {
      height: 220,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    countRow: { flexDirection: 'row', marginTop: spacing.md },
    countBadge: {
      borderWidth: 1,
      borderColor: colors.brand,
      backgroundColor: colors.brandTint,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 3,
    },
    countBadgeText: { color: colors.brand, fontWeight: '700', fontSize: 12 },
    passBlock: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginTop: spacing.md,
    },
    passLabel: { ...type.caption, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm },
    canvasserRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.sm },
    actionDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
    canvasserTopLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
    canvasserName: { color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
    canvasserAction: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    canvasserTimeAgo: { color: colors.textMuted, fontSize: 12, marginLeft: 'auto' },
    canvasserTimestamp: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    mapBtn: {
      marginTop: spacing.lg,
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    mapBtnText: { color: colors.textInverse, fontWeight: '700' },
  });
}
