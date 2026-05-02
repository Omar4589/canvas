import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
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
import Logo from '../../components/Logo';
import { colors, radius, spacing, type, shadow } from '../../lib/theme';

if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

const DEFAULT_CENTER = [-84.5, 39.0];

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

function ProgressStat({ icon, value, label, accent }) {
  return (
    <View style={styles.progressStat}>
      <View style={[styles.progressIcon, { backgroundColor: accent }]}>
        <Text style={styles.progressIconText}>{icon}</Text>
      </View>
      <View>
        <Text style={styles.progressValue}>{value ?? '—'}</Text>
        <Text style={styles.progressLabel}>{label}</Text>
      </View>
    </View>
  );
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

  const todayQ = useQuery({
    queryKey: ['mobile', 'me', 'today', activeCampaign?.id],
    queryFn: () => api(`/mobile/me/today?campaignId=${activeCampaign.id}`),
    enabled: !!activeCampaign?.id,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  async function switchCampaign() {
    await saveActiveCampaign(null);
    await clearBootstrap();
    qc.removeQueries({ queryKey: ['bootstrap'] });
    router.replace('/(app)/campaigns');
  }

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
  }

  async function onRefresh() {
    try {
      await flushQueue();
    } catch {}
    await refetch();
    todayQ.refetch();
    setPendingCount(await getPendingCount());
  }

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>
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
        <ActivityIndicator color={colors.brand} />
        <Text style={styles.loadingText}>Loading houses…</Text>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>{error.message}</Text>
        <Pressable onPress={onRefresh} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const initialCenter = data?.households?.[0]?.location?.coordinates || DEFAULT_CENTER;
  const today = todayQ.data || {};

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
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

      {/* Top chrome */}
      <SafeAreaView edges={['top']} style={styles.topBarWrap} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Logo size={24} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {pendingCount > 0 && (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{pendingCount}</Text>
              </View>
            )}
            <Pressable
              onPress={() => setFilterMenuOpen((v) => !v)}
              style={styles.iconButton}
            >
              <Text style={styles.iconButtonText}>
                {activeFilter === 'all' ? '⚲' : '●'}
              </Text>
            </Pressable>
            <Pressable onPress={onRefresh} style={styles.iconButton}>
              {isFetching ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <Text style={styles.iconButtonText}>↻</Text>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.subBar}>
          {activeCampaign && (
            <Pressable onPress={switchCampaign} style={styles.campaignChip}>
              <View style={styles.campaignDot} />
              <Text style={styles.campaignChipText} numberOfLines={1}>
                {activeCampaign.name}
              </Text>
              <Text style={styles.campaignChipSwitch}>Switch</Text>
            </Pressable>
          )}
          <Pressable onPress={onLogout} style={styles.signOutChip}>
            <Text style={styles.signOutChipText}>Sign out</Text>
          </Pressable>
        </View>

        {filterMenuOpen && (
          <View style={styles.filterMenu}>
            <Text style={styles.filterMenuLabel}>Show</Text>
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
                        { backgroundColor: colors.status[opt.key] },
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
      </SafeAreaView>

      {/* Recenter button */}
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

      {/* Pin sheet OR progress card (sheet takes precedence) */}
      {selected ? (
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHandle} />
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
                { backgroundColor: colors.status[selected.status] },
              ]}
            />
            <Text style={styles.sheetStatusText}>
              {colors.statusLabels[selected.status]}
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
      ) : (
        <SafeAreaView edges={['bottom']} style={styles.progressCard}>
          <View style={styles.sheetHandle} />
          <Text style={styles.progressTitle}>Today's Progress</Text>
          <View style={styles.progressRow}>
            <ProgressStat
              icon="✓"
              accent={colors.status.surveyed}
              value={today.doorsKnocked?.toLocaleString()}
              label="Doors knocked"
            />
            <ProgressStat
              icon="◉"
              accent={colors.info}
              value={today.responses?.toLocaleString()}
              label={
                activeCampaign?.type === 'lit_drop' ? 'Lit drops' : 'Responses'
              }
            />
            <ProgressStat
              icon="⌂"
              accent={colors.textMuted}
              value={today.remaining?.toLocaleString()}
              label="Remaining"
            />
          </View>
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
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: colors.danger,
    marginBottom: spacing.md,
    textAlign: 'center',
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconButtonText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
  pendingBadge: {
    backgroundColor: colors.warnBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  pendingBadgeText: { color: '#92400E', fontWeight: '700', fontSize: 12 },

  subBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  campaignChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  campaignDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand,
    marginRight: spacing.sm,
  },
  campaignChipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  campaignChipSwitch: {
    fontSize: 12,
    color: colors.brand,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
  signOutChip: {
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  signOutChipText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },

  filterMenu: {
    marginHorizontal: spacing.md,
    marginTop: 4,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.raised,
  },
  filterMenuLabel: {
    ...type.micro,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  filterMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  filterMenuItemActive: { backgroundColor: colors.brandTint },
  filterMenuItemText: { fontSize: 14, color: colors.textPrimary },
  filterMenuItemTextActive: { color: colors.brand, fontWeight: '700' },
  filterDot: { width: 9, height: 9, borderRadius: 4.5, marginRight: spacing.sm },
  filterDotPlaceholder: { width: 9, height: 9, marginRight: spacing.sm },

  recenterButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 200,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  recenterButtonAboveSheet: { bottom: 280 },
  recenterButtonActive: { backgroundColor: colors.brand },
  recenterButtonText: { fontSize: 24, color: colors.brand, lineHeight: 26 },
  recenterButtonTextActive: { color: colors.textInverse },

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
  sheetAddress: { ...type.h3 },
  sheetSub: { ...type.caption, marginTop: 2 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  sheetStatusText: { color: colors.textSecondary, textTransform: 'capitalize' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm },
  sheetButtons: { flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.sm },
  primaryButton: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
  secondaryButton: {
    backgroundColor: colors.bg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },

  progressCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.raised,
  },
  progressTitle: {
    ...type.h3,
    marginBottom: spacing.md,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
  },
  progressStat: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  progressIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  progressIconText: {
    color: colors.textInverse,
    fontWeight: '800',
    fontSize: 16,
  },
  progressValue: {
    ...type.h2,
    fontSize: 20,
    lineHeight: 22,
  },
  progressLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
