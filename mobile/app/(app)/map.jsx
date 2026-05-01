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
import {
  saveBootstrap,
  loadBootstrap,
  loadActiveCampaign,
  saveActiveCampaign,
  clearBootstrap,
} from '../../lib/cache';
import { flushQueue, getPendingCount } from '../../lib/offlineQueue';
import { MAPBOX_PUBLIC_TOKEN } from '../../lib/config';
import { STATUS_COLORS } from '../../components/StatusColor';

if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

const DEFAULT_CENTER = [-84.5, 39.0]; // northern Kentucky default

const SURVEY_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'unknocked', label: 'Unknocked' },
  { key: 'not_home', label: 'Not home' },
  { key: 'surveyed', label: 'Surveyed' },
  { key: 'wrong_address', label: 'Wrong addr' },
];

const LIT_DROP_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'unknocked', label: 'Not yet' },
  { key: 'lit_dropped', label: 'Dropped' },
];

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
  const [following, setFollowing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState(undefined);

  useEffect(() => {
    let mounted = true;
    loadActiveCampaign().then((c) => {
      if (!mounted) return;
      if (!c) {
        router.replace('/(app)/campaigns');
        return;
      }
      setActiveCampaign(c);
    });
    return () => {
      mounted = false;
    };
  }, [router]);

  const filterOptions =
    activeCampaign?.type === 'lit_drop' ? LIT_DROP_FILTER_OPTIONS : SURVEY_FILTER_OPTIONS;
  const activeOption = filterOptions.find((o) => o.key === activeFilter) || filterOptions[0];

  // 'all' shows every status; any other value shows only that status.
  const layerFilter = useMemo(
    () =>
      activeFilter === 'all'
        ? ['has', 'status']
        : ['==', ['get', 'status'], activeFilter],
    [activeFilter]
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['bootstrap'],
    queryFn: async () => {
      try {
        const fresh = await api(`/mobile/bootstrap?campaignId=${activeCampaign.id}`);
        await saveBootstrap(fresh);
        return fresh;
      } catch (err) {
        // Fall back to cache when offline (only if it was for the same campaign).
        const cached = await loadBootstrap();
        if (cached && String(cached.campaign?.id) === String(activeCampaign.id)) {
          return cached;
        }
        throw err;
      }
    },
    enabled: !!activeCampaign?.id,
    staleTime: 5 * 60 * 1000,
  });

  async function switchCampaign() {
    await saveActiveCampaign(null);
    await clearBootstrap();
    qc.removeQueries({ queryKey: ['bootstrap'] });
    router.replace('/(app)/campaigns');
  }

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

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={{ color: '#b91c1c', marginBottom: 12, textAlign: 'center' }}>
          Map unavailable: missing Mapbox configuration. Please contact support.
        </Text>
        <Pressable onPress={onLogout} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Sign out</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (activeCampaign === undefined || (activeCampaign && isLoading)) {
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
          defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: 12 }}
          followUserLocation={following}
          followZoomLevel={16}
          animationMode="flyTo"
          animationDuration={500}
        />
        <Mapbox.UserLocation visible androidRenderMode="compass" />

        <Mapbox.Images
          images={{
            'house-unknocked': require('../../assets/icons/house-unknocked.png'),
            'house-not_home': require('../../assets/icons/house-not_home.png'),
            'house-surveyed': require('../../assets/icons/house-surveyed.png'),
            'house-wrong_address': require('../../assets/icons/house-wrong_address.png'),
            'house-lit_dropped': require('../../assets/icons/house-surveyed.png'),
          }}
        />
        <Mapbox.ShapeSource id="households" shape={features} onPress={onPinPress}>
          <Mapbox.SymbolLayer
            id="household-pins"
            filter={layerFilter}
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
              iconSize: [
                'interpolate',
                ['linear'],
                ['zoom'],
                10, 0.13,
                14, 0.2,
                17, 0.28,
              ],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
            }}
          />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      <SafeAreaView edges={['top']} style={styles.topBarWrap} pointerEvents="box-none">
        <View style={styles.topBar}>
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
        </View>

        {activeCampaign && (
          <Pressable onPress={switchCampaign} style={styles.campaignBar}>
            <Text style={styles.campaignBarText}>
              {activeCampaign.name}
              {activeCampaign.type === 'lit_drop' ? ' · Lit drop' : ''}
            </Text>
            <Text style={styles.campaignBarSwitch}>Switch ›</Text>
          </Pressable>
        )}

        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setFilterMenuOpen((v) => !v)}
            style={styles.filterButton}
          >
            {activeFilter !== 'all' && (
              <View
                style={[
                  styles.filterDot,
                  { backgroundColor: STATUS_COLORS[activeFilter] },
                ]}
              />
            )}
            <Text style={styles.filterButtonText}>{activeOption.label}</Text>
            <Text style={styles.filterChevron}>{filterMenuOpen ? '▲' : '▼'}</Text>
          </Pressable>

          {filterMenuOpen && (
            <View style={styles.filterMenu}>
              {filterOptions.map((opt) => {
                const isActive = opt.key === activeFilter;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => {
                      setActiveFilter(opt.key);
                      setFilterMenuOpen(false);
                    }}
                    style={[
                      styles.filterMenuItem,
                      isActive && styles.filterMenuItemActive,
                    ]}
                  >
                    {opt.key !== 'all' ? (
                      <View
                        style={[
                          styles.filterDot,
                          { backgroundColor: STATUS_COLORS[opt.key] },
                        ]}
                      />
                    ) : (
                      <View style={styles.filterDotPlaceholder} />
                    )}
                    <Text
                      style={[
                        styles.filterMenuItemText,
                        isActive && styles.filterMenuItemTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </SafeAreaView>

      <Pressable
        onPress={() => setFollowing((v) => !v)}
        style={[
          styles.recenterButton,
          selected && styles.recenterButtonAboveSheet,
          following && styles.recenterButtonActive,
        ]}
      >
        <Text
          style={[
            styles.recenterButtonText,
            following && styles.recenterButtonTextActive,
          ]}
        >
          ◎
        </Text>
      </Pressable>

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
  topBarWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 8,
  },
  filterRow: {
    paddingHorizontal: 8,
    paddingBottom: 4,
    alignItems: 'flex-start',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffffee',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  filterChevron: {
    marginLeft: 6,
    fontSize: 9,
    color: '#6b7280',
  },
  filterDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    marginRight: 7,
  },
  filterDotPlaceholder: {
    width: 9,
    height: 9,
    marginRight: 7,
  },
  filterMenu: {
    marginTop: 6,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingVertical: 4,
    minWidth: 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  filterMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  filterMenuItemActive: {
    backgroundColor: '#f3f4f6',
  },
  filterMenuItemText: {
    fontSize: 14,
    color: '#111827',
  },
  filterMenuItemTextActive: {
    fontWeight: '700',
    color: '#0284c7',
  },
  iconButton: {
    backgroundColor: '#ffffffcc',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  campaignBar: {
    marginHorizontal: 8,
    marginBottom: 4,
    backgroundColor: '#ffffffee',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  campaignBarText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  campaignBarSwitch: {
    fontSize: 13,
    color: '#0284c7',
    fontWeight: '600',
  },
  iconButtonText: { color: '#0284c7', fontWeight: '600' },
  pendingBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  pendingBadgeText: { color: '#92400e', fontWeight: '600', fontSize: 12 },
  recenterButton: {
    position: 'absolute',
    right: 16,
    bottom: 32,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  recenterButtonAboveSheet: { bottom: 220 },
  recenterButtonActive: { backgroundColor: '#0284c7' },
  recenterButtonText: { fontSize: 24, color: '#0284c7', lineHeight: 26 },
  recenterButtonTextActive: { color: '#ffffff' },
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
