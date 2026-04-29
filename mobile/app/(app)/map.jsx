import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../lib/api';
import { signOut } from '../../lib/authState';
import { saveBootstrap, loadBootstrap } from '../../lib/cache';
import { flushQueue, getPendingCount } from '../../lib/offlineQueue';
import { MAPBOX_PUBLIC_TOKEN } from '../../lib/config';
import { STATUS_COLORS } from '../../components/StatusColor';

Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);

const DEFAULT_CENTER = [-84.5, 39.0]; // northern Kentucky default

function buildFeatureCollection(households) {
  return {
    type: 'FeatureCollection',
    features: households
      .filter((h) => h.location?.coordinates?.length === 2)
      .map((h) => ({
        type: 'Feature',
        id: String(h._id),
        properties: {
          id: String(h._id),
          status: h.status || 'unknocked',
          addressLine1: h.addressLine1,
        },
        geometry: { type: 'Point', coordinates: h.location.coordinates },
      })),
  };
}

export default function MapScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const cameraRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['bootstrap'],
    queryFn: async () => {
      try {
        const fresh = await api('/mobile/bootstrap');
        await saveBootstrap(fresh);
        return fresh;
      } catch (err) {
        // Fall back to cache when offline
        const cached = await loadBootstrap();
        if (cached) return cached;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  // Try to flush offline queue on mount and after focus
  useEffect(() => {
    let mounted = true;
    async function refreshPending() {
      const c = await getPendingCount();
      if (mounted) setPendingCount(c);
    }
    refreshPending();
    flushQueue()
      .then(refreshPending)
      .catch(() => {});
    const interval = setInterval(refreshPending, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const features = useMemo(() => buildFeatureCollection(data?.households || []), [data]);

  const householdsById = useMemo(() => {
    const m = new Map();
    for (const h of data?.households || []) m.set(String(h._id), h);
    return m;
  }, [data]);

  const onPinPress = useCallback(
    (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = f.properties?.id;
      const h = householdsById.get(String(id));
      if (h) setSelected(h);
    },
    [householdsById]
  );

  async function onLogout() {
    qc.clear();
    await signOut();
    // Auth gate in _layout handles redirect to /login
  }

  async function onRefresh() {
    try {
      await flushQueue();
    } catch {}
    await refetch();
    setPendingCount(await getPendingCount());
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, color: '#6b7280' }}>Loading houses…</Text>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ color: '#b91c1c', marginBottom: 12 }}>{error.message}</Text>
        <Pressable onPress={onRefresh} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Center camera on first household if available
  const initialCenter =
    data?.households?.[0]?.location?.coordinates || DEFAULT_CENTER;

  return (
    <View style={{ flex: 1 }}>
      <Mapbox.MapView style={{ flex: 1 }} styleURL={Mapbox.StyleURL.Street}>
        <Mapbox.Camera
          ref={cameraRef}
          zoomLevel={12}
          centerCoordinate={initialCenter}
          animationMode="none"
        />
        <Mapbox.UserLocation visible androidRenderMode="compass" />

        <Mapbox.ShapeSource id="households" shape={features} onPress={onPinPress}>
          <Mapbox.CircleLayer
            id="household-pins"
            style={{
              circleRadius: [
                'interpolate',
                ['linear'],
                ['zoom'],
                10, 4,
                14, 7,
                17, 10,
              ],
              circleColor: [
                'match',
                ['get', 'status'],
                'unknocked', STATUS_COLORS.unknocked,
                'not_home', STATUS_COLORS.not_home,
                'surveyed', STATUS_COLORS.surveyed,
                'wrong_address', STATUS_COLORS.wrong_address,
                STATUS_COLORS.unknocked,
              ],
              circleStrokeWidth: 1.5,
              circleStrokeColor: '#ffffff',
            }}
          />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
        <Pressable onPress={onRefresh} style={styles.iconButton}>
          {isFetching ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text style={styles.iconButtonText}>Refresh</Text>
          )}
        </Pressable>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>
              {pendingCount} pending sync
            </Text>
          </View>
        )}
        <Pressable onPress={onLogout} style={styles.iconButton}>
          <Text style={styles.iconButtonText}>Sign out</Text>
        </Pressable>
      </SafeAreaView>

      {selected && (
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <Text style={styles.sheetAddress}>
            {selected.addressLine1}
            {selected.addressLine2 ? `, ${selected.addressLine2}` : ''}
          </Text>
          <Text style={styles.sheetSub}>
            {selected.city}, {selected.state} {selected.zipCode}
          </Text>
          <View style={styles.sheetRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: STATUS_COLORS[selected.status] },
              ]}
            />
            <Text style={{ color: '#374151', textTransform: 'capitalize' }}>
              {selected.status.replace('_', ' ')}
            </Text>
          </View>
          <View style={styles.sheetButtons}>
            <Pressable
              onPress={() => {
                setSelected(null);
                router.push(`/(app)/household/${selected._id}`);
              }}
              style={[styles.primaryButton, { flex: 1, marginRight: 6 }]}
            >
              <Text style={styles.primaryButtonText}>Open</Text>
            </Pressable>
            <Pressable
              onPress={() => setSelected(null)}
              style={[styles.secondaryButton, { flex: 1, marginLeft: 6 }]}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#f9fafb',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 8,
  },
  iconButton: {
    backgroundColor: '#ffffffcc',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  iconButtonText: { color: '#0284c7', fontWeight: '600' },
  pendingBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  pendingBadgeText: { color: '#92400e', fontWeight: '600', fontSize: 12 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  sheetAddress: { fontSize: 16, fontWeight: '600' },
  sheetSub: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  sheetButtons: { flexDirection: 'row', marginTop: 14 },
  primaryButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '600' },
  secondaryButton: {
    backgroundColor: '#f3f4f6',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#111827', fontWeight: '600' },
});
