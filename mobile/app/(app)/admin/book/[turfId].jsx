import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../../../lib/api';
import { loadActiveCampaign } from '../../../../lib/cache';
import { MAPBOX_PUBLIC_TOKEN } from '../../../../lib/config';
import { radius, spacing } from '../../../../lib/theme';
import { useTheme } from '../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../lib/useThemedStyles';
import { useMapStyle } from '../../../../lib/mapStyles';

if (MAPBOX_PUBLIC_TOKEN) Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);

const STATUS_LABEL = {
  unknocked: 'Unknocked',
  not_home: 'Not home',
  surveyed: 'Surveyed',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
};

// Outline of the book's homes, computed from the ACTUAL coordinates so it encloses
// every house — unlike the server's stored boundary, which can miss homes added
// after it was computed. Uses a convex hull when the homes span an area; falls back
// to a small bounding box for degenerate books (<3 distinct or all-collinear homes,
// e.g. a stacked apartment) so a book with homes always shows an enclosing outline.
// Returns a closed [lng,lat] ring, or null only when there are no homes.
function outlineRing(points) {
  return convexHull(points) || bboxRing(points);
}

// Convex hull (Andrew's monotone chain). Returns a closed ring, or null for <3
// distinct, non-collinear points (no polygon possible).
function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return null;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const ring = lower.concat(upper);
  if (ring.length < 3) return null;
  ring.push(ring[0]);
  return ring;
}

// Bounding box around the points, padded to a small minimum (~80m) so it's never a
// degenerate line/point. Always encloses the points. null only when there are none.
function bboxRing(points, pad = 0.0008) {
  if (!points.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (maxLng - minLng < pad) { const c = (minLng + maxLng) / 2; minLng = c - pad / 2; maxLng = c + pad / 2; }
  if (maxLat - minLat < pad) { const c = (minLat + maxLat) / 2; minLat = c - pad / 2; maxLat = c + pad / 2; }
  return [[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]];
}

export default function AdminBookDetail() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();
  const { styleURL } = useMapStyle();
  const params = useLocalSearchParams();
  const turfId = Array.isArray(params.turfId) ? params.turfId[0] : params.turfId;

  const [cId, setCId] = useState(
    Array.isArray(params.campaignId) ? params.campaignId[0] : params.campaignId || null
  );
  useEffect(() => {
    if (cId) return;
    loadActiveCampaign().then((c) => c?.id && setCId(c.id));
  }, [cId]);

  const cameraRef = useRef(null);
  const camInit = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const bookQ = useQuery({
    queryKey: ['admin', 'book-households', cId, turfId],
    queryFn: () => api(`/admin/campaigns/${cId}/turfs/${turfId}/households`),
    enabled: !!cId && !!turfId,
  });
  const assignQ = useQuery({
    queryKey: ['admin', 'book-assign', cId, turfId],
    queryFn: () => api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments`),
    enabled: !!cId && !!turfId,
  });
  const membersQ = useQuery({ queryKey: ['admin', 'memberships'], queryFn: () => api('/admin/memberships') });
  const rosterQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
  });

  const turf = bookQ.data?.turf || null;
  const households = useMemo(() => bookQ.data?.households || [], [bookQ.data]);
  const total = households.length;
  const knocked = households.filter((h) => (h.status || 'unknocked') !== 'unknocked').length;
  // Address + PER-PASS status from the already-loaded homes, so the popup agrees
  // with the pin color (the /household/:id endpoint returns the global status).
  const selectedHome = useMemo(
    () => households.find((h) => String(h.id) === selectedId) || null,
    [households, selectedId]
  );

  const assignees = useMemo(
    () =>
      (assignQ.data?.assignments || [])
        .filter((a) => a.userId)
        .map((a) => ({ id: String(a.userId._id), firstName: a.userId.firstName, lastName: a.userId.lastName })),
    [assignQ.data]
  );
  const assignedSet = useMemo(() => new Set(assignees.map((a) => a.id)), [assignees]);

  const rosterUserIds = useMemo(
    () => new Set((rosterQ.data?.assignments || []).map((a) => String(a.userId))),
    [rosterQ.data]
  );
  const roster = useMemo(
    () =>
      (membersQ.data?.members || [])
        .filter((m) => m.role === 'canvasser' && m.user?.isActive && m.isActive && rosterUserIds.has(String(m.user.id)))
        .map((m) => ({ id: String(m.user.id), firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email })),
    [membersQ.data, rosterUserIds]
  );

  const features = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: households.map((h) => ({
        type: 'Feature',
        id: String(h.id),
        properties: { id: String(h.id), status: h.status || 'unknocked' },
        geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
      })),
    }),
    [households]
  );
  const boundaryFeatures = useMemo(() => {
    const ring = outlineRing(households.map((h) => [h.lng, h.lat]));
    return {
      type: 'FeatureCollection',
      features: ring ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }] : [],
    };
  }, [households]);

  // Frame the camera to the book's homes once they're loaded. IMPORTANT: don't lock
  // on the centroid fallback while the homes query is still in flight — otherwise a
  // fast map-load beats the network and we'd never frame the actual houses.
  useEffect(() => {
    if (camInit.current || !mapReady || !cameraRef.current) return;
    const pts = households.map((h) => [h.lng, h.lat]);
    if (pts.length) {
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const [lng, lat] of pts) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      if (pts.length === 1 || (maxLng === minLng && maxLat === minLat)) {
        cameraRef.current.setCamera({ centerCoordinate: [minLng, minLat], zoomLevel: 16, animationDuration: 0 });
      } else {
        cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], [56, 40, 56, 40], 0);
      }
      camInit.current = true;
    } else if (bookQ.isFetched) {
      // The query actually ran and the book has no homes → settle on the centroid,
      // then stop. Gate on isFetched (not !isLoading): a query still disabled while
      // cId resolves reports !isLoading too, and locking there would strand the map.
      if (turf?.centroid?.coordinates?.length === 2) {
        cameraRef.current.setCamera({ centerCoordinate: turf.centroid.coordinates, zoomLevel: 14, animationDuration: 0 });
      }
      camInit.current = true;
    }
  }, [households, mapReady, turf, bookQ.isFetched]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'book-assign', cId, turfId] });
    qc.invalidateQueries({ queryKey: ['admin', 'turf-assignments'] });
    qc.invalidateQueries({ queryKey: ['admin', 'efforts', cId] });
  };
  // Always reconcile to server truth on settle (success OR error) — so a partial /
  // failed write doesn't leave the UI disagreeing with the server — and surface
  // failures instead of failing silently.
  const onErr = (e) => Alert.alert('Could not update assignments', e?.message || 'Please try again.');
  const writeOpts = { onSettled: invalidate, onError: onErr };
  const assignMut = useMutation({
    mutationFn: ({ userId }) =>
      api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments`, { method: 'POST', body: { userIds: [userId] } }),
    ...writeOpts,
  });
  const unassignMut = useMutation({
    mutationFn: ({ userId }) =>
      api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments/${userId}`, { method: 'DELETE' }),
    ...writeOpts,
  });
  const assignAllMut = useMutation({
    mutationFn: () =>
      api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments`, {
        method: 'POST',
        body: { userIds: roster.map((c) => c.id) },
      }),
    ...writeOpts,
  });
  const unassignAllMut = useMutation({
    mutationFn: () =>
      Promise.allSettled(
        assignees.map((a) =>
          api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments/${a.id}`, { method: 'DELETE' })
        )
      ).then((results) => {
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed) throw new Error(`${failed} unassign${failed === 1 ? '' : 's'} failed — refreshed to the latest.`);
      }),
    ...writeOpts,
  });
  const mutating = assignMut.isPending || unassignMut.isPending || assignAllMut.isPending || unassignAllMut.isPending;

  // House popup detail (address + voters), fetched on tap.
  const houseQ = useQuery({
    queryKey: ['admin', 'turf-household', cId, selectedId],
    queryFn: () => api(`/admin/campaigns/${cId}/turfs/household/${selectedId}`),
    enabled: !!cId && !!selectedId,
  });

  function onPinPress(e) {
    const id = e.features?.[0]?.properties?.id;
    if (id) setSelectedId(String(id));
  }

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} title="Book" styles={styles} />
        <View style={styles.center}>
          <Text style={styles.muted}>Map unavailable: missing Mapbox configuration.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title={turf?.name || 'Book'} styles={styles} />
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.topBarCount}>
            {bookQ.isLoading ? 'Loading…' : `${knocked}/${total} done · ${assignees.length} assigned`}
          </Text>
          <Text style={styles.topBarNames} numberOfLines={1}>
            {assignees.length
              ? assignees.map((a) => `${a.firstName} ${(a.lastName || '')[0] || ''}`).join(', ')
              : 'No one assigned'}
          </Text>
        </View>
        <Pressable onPress={() => setAssignOpen(true)} style={styles.barBtn}>
          <Text style={styles.barBtnText}>Assign</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        <Mapbox.MapView
          style={{ flex: 1 }}
          styleURL={styleURL}
          onDidFinishLoadingMap={() => setMapReady(true)}
          zoomEnabled
          scrollEnabled
          pitchEnabled
          rotateEnabled
        >
          <Mapbox.Camera ref={cameraRef} />
          <Mapbox.UserLocation visible />
          <Mapbox.Images
            images={{
              'house-unknocked': require('../../../../assets/icons/house-unknocked.png'),
              'house-not_home': require('../../../../assets/icons/house-not_home.png'),
              'house-surveyed': require('../../../../assets/icons/house-surveyed.png'),
              'house-wrong_address': require('../../../../assets/icons/house-wrong_address.png'),
              'house-lit_dropped': require('../../../../assets/icons/house-surveyed.png'),
            }}
          />
          <Mapbox.ShapeSource id="book-boundary" shape={boundaryFeatures}>
            <Mapbox.FillLayer id="book-boundary-fill" style={{ fillColor: colors.brand, fillOpacity: 0.08 }} />
            <Mapbox.LineLayer
              id="book-boundary-line"
              style={{ lineColor: colors.brand, lineWidth: 2, lineDasharray: [3, 2] }}
            />
          </Mapbox.ShapeSource>
          <Mapbox.ShapeSource id="book-homes" shape={features} onPress={onPinPress}>
            <Mapbox.CircleLayer
              id="book-home-halo"
              filter={['==', ['get', 'id'], selectedId || '']}
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 12, 12, 17, 28],
                circleColor: colors.brandTint,
                circleStrokeColor: colors.brand,
                circleStrokeWidth: 3,
                circleOpacity: 0.55,
              }}
            />
            <Mapbox.SymbolLayer
              id="book-home-pins"
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
                iconSize: ['interpolate', ['linear'], ['zoom'], 12, 0.16, 17, 0.28],
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
          </Mapbox.ShapeSource>
        </Mapbox.MapView>

        {bookQ.isLoading && (
          <View style={styles.mapLoading} pointerEvents="none">
            <ActivityIndicator color={colors.brand} />
          </View>
        )}
      </View>

      {/* House tap detail */}
      <Modal visible={!!selectedId} transparent animationType="slide" onRequestClose={() => setSelectedId(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSelectedId(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>
              {selectedHome?.addressLine1 || houseQ.data?.household?.addressLine1 || 'Address'}
            </Text>
            <Text style={styles.sheetSub}>
              {[selectedHome?.city, selectedHome?.state].filter(Boolean).join(', ')}
            </Text>
            <Text style={styles.sheetStatus}>{STATUS_LABEL[selectedHome?.status] || 'Unknown'}</Text>
            {houseQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
            ) : (houseQ.data?.voters || []).length > 0 ? (
              <View style={styles.voters}>
                {houseQ.data.voters.map((v) => (
                  <Text key={v.id} style={styles.voterRow} numberOfLines={1}>
                    {v.fullName}
                    {v.party ? ` · ${v.party}` : ''}
                  </Text>
                ))}
              </View>
            ) : null}
            <Pressable onPress={() => setSelectedId(null)} style={styles.sheetClose}>
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Assign / unassign */}
      <Modal visible={assignOpen} transparent animationType="slide" onRequestClose={() => setAssignOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.assignSheet}>
            <View style={styles.assignHead}>
              <Text style={styles.sheetTitle}>Assign {turf?.name || 'book'}</Text>
              <Pressable onPress={() => setAssignOpen(false)} hitSlop={8}>
                <Text style={styles.sheetCloseX}>✕</Text>
              </Pressable>
            </View>
            {roster.length === 0 ? (
              <Text style={styles.sheetSub}>
                No canvassers assigned to this campaign yet.{'\n'}
                <Text style={styles.link} onPress={() => router.push(`/(app)/admin/campaign-assignments/${cId}`)}>
                  Assign canvassers →
                </Text>
              </Text>
            ) : (
              <>
                <View style={styles.bulkRow}>
                  <Pressable
                    onPress={() => assignAllMut.mutate()}
                    disabled={mutating}
                    style={[styles.bulkBtn, styles.bulkAssign, mutating && styles.bulkBtnDisabled]}
                  >
                    <Text style={styles.bulkAssignText}>Assign all</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => unassignAllMut.mutate()}
                    disabled={mutating || assignees.length === 0}
                    style={[styles.bulkBtn, styles.bulkUnassign, (mutating || assignees.length === 0) && styles.bulkBtnDisabled]}
                  >
                    <Text style={styles.bulkUnassignText}>Unassign all</Text>
                  </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 360 }}>
                {roster.map((c) => {
                  const assigned = assignedSet.has(c.id);
                  return (
                    <View key={c.id} style={styles.assignRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.assignName}>
                          {c.firstName} {c.lastName}
                        </Text>
                        <Text style={styles.assignSub} numberOfLines={1}>
                          {c.email}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => (assigned ? unassignMut.mutate({ userId: c.id }) : assignMut.mutate({ userId: c.id }))}
                        disabled={mutating}
                        style={[styles.action, assigned ? styles.actionUnassign : styles.actionAssign]}
                      >
                        <Text style={[styles.actionText, assigned ? styles.actionTextUnassign : styles.actionTextAssign]}>
                          {assigned ? 'Unassign' : 'Assign'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Header({ onBack, title, styles }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8} style={styles.headerSide}>
        <Text style={styles.back}>‹ Books</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerSide} />
    </View>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    muted: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    headerSide: { width: 64 },
    back: { color: colors.brand, fontWeight: '700', fontSize: 16 },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
    mapLoading: { position: 'absolute', top: spacing.lg, alignSelf: 'center' },

    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    topBarCount: { ...type.caption, color: colors.textSecondary },
    topBarNames: { ...type.bodyStrong, fontSize: 14, marginTop: 1 },
    barBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2 },
    barBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },

    sheetBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    sheetTitle: { ...type.h3 },
    sheetSub: { ...type.caption, marginTop: 2 },
    sheetStatus: { ...type.bodyStrong, color: colors.textSecondary, marginTop: spacing.sm },
    voters: { marginTop: spacing.md, gap: 4 },
    voterRow: { ...type.body, fontSize: 14 },
    sheetClose: { marginTop: spacing.lg, alignSelf: 'flex-start' },
    sheetCloseText: { color: colors.brand, fontWeight: '700', fontSize: 15 },
    sheetCloseX: { fontSize: 16, color: colors.textSecondary, fontWeight: '700' },

    assignSheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    assignHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    link: { color: colors.brand, fontWeight: '700' },
    bulkRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    bulkBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm + 2, borderRadius: radius.md, borderWidth: 1 },
    bulkBtnDisabled: { opacity: 0.5 },
    bulkAssign: { borderColor: colors.brand, backgroundColor: colors.brandTint },
    bulkAssignText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
    bulkUnassign: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg },
    bulkUnassignText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
    assignRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    assignName: { ...type.bodyStrong, fontSize: 14 },
    assignSub: { ...type.caption, marginTop: 1 },
    action: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
    actionAssign: { borderColor: colors.brand, backgroundColor: colors.brandTint },
    actionUnassign: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg },
    actionText: { fontSize: 12, fontWeight: '700' },
    actionTextAssign: { color: colors.brand },
    actionTextUnassign: { color: colors.danger },
  });
}
