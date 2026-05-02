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
  loadCurrentUser,
} from '../../lib/cache';
import { flushQueue, getPendingCount } from '../../lib/offlineQueue';
import { MAPBOX_PUBLIC_TOKEN } from '../../lib/config';
import Logo from '../../components/Logo';
import PinIcon from '../../components/PinIcon';
import { timeAgo, formatExact } from '../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../lib/theme';

if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

const DEFAULT_CENTER = [-84.5, 39.0];

const SURVEY_FILTER_OPTIONS = [
  { key: 'all', label: 'All houses' },
  { key: 'unknocked', label: 'Unknocked' },
  { key: 'not_home', label: 'Not home' },
  { key: 'surveyed', label: 'Surveyed' },
  { key: 'wrong_address', label: 'Wrong addr' },
];

const LIT_DROP_FILTER_OPTIONS = [
  { key: 'all', label: 'All houses' },
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

function StatusPill({ status, compact = false }) {
  const dotColor = colors.status[status] || colors.textMuted;
  const isDone = status === 'surveyed' || status === 'lit_dropped';
  const isMiss = status === 'not_home' || status === 'wrong_address';
  const bg = isDone ? colors.successBg : isMiss ? colors.dangerBg : colors.bg;
  const border = isDone
    ? colors.successBorder
    : isMiss
    ? '#FCA5A5'
    : colors.border;
  const textColor = isDone
    ? colors.success
    : isMiss
    ? colors.danger
    : colors.textSecondary;
  return (
    <View
      style={[
        pillStyles.pill,
        { backgroundColor: bg, borderColor: border },
        compact && pillStyles.compact,
      ]}
    >
      <View style={[pillStyles.dot, { backgroundColor: dotColor }]} />
      <Text style={[pillStyles.text, { color: textColor }]}>
        {colors.statusLabels[status] || 'Unknown'}
      </Text>
    </View>
  );
}

function ProgressStat({ pinStatus, value, label }) {
  return (
    <View style={styles.progressStat}>
      <PinIcon status={pinStatus} size={26} />
      <View style={{ marginLeft: spacing.sm }}>
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
  const [currentUser, setCurrentUser] = useState(null);

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
    loadCurrentUser().then((u) => {
      if (mounted) setCurrentUser(u);
    });
    return () => {
      mounted = false;
    };
  }, [router]);

  const isAdmin = currentUser?.role === 'admin';

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
    queryFn: () => {
      // Send start-of-today in the device's local timezone as an absolute
      // ISO. Server uses it as-is, so canvassers in different zones each get
      // their own day boundary.
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const since = encodeURIComponent(startOfDay.toISOString());
      return api(`/mobile/me/today?campaignId=${activeCampaign.id}&since=${since}`);
    },
    enabled: !!activeCampaign?.id,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  // Delta polling: every 30s, ask the server for any household/voter changes
  // since the last fetch and patch the bootstrap cache. Keeps multiple
  // canvassers' maps in near-sync without re-fetching the whole campaign.
  const sinceRef = useRef(null);
  useEffect(() => {
    if (data?.generatedAt) sinceRef.current = data.generatedAt;
  }, [data?.generatedAt]);

  const changesQ = useQuery({
    queryKey: ['mobile', 'changes', activeCampaign?.id],
    queryFn: async () => {
      if (!sinceRef.current || !activeCampaign?.id) return null;
      const since = encodeURIComponent(sinceRef.current);
      return api(`/mobile/changes?campaignId=${activeCampaign.id}&since=${since}`);
    },
    enabled: !!activeCampaign?.id && !!data,
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const result = changesQ.data;
    if (!result) return;
    const { households = [], voters = [], serverTime } = result;
    if (households.length || voters.length) {
      qc.setQueryData(['bootstrap'], (prev) => {
        if (!prev) return prev;
        const hMap = new Map(households.map((h) => [String(h._id), h]));
        const vMap = new Map(voters.map((v) => [String(v._id), v]));
        const next = {
          ...prev,
          households: prev.households
            .map((h) => {
              const c = hMap.get(String(h._id));
              if (!c) return h;
              if (c.isActive === false) return null; // archived — drop from map
              return { ...h, status: c.status, lastActionAt: c.lastActionAt };
            })
            .filter(Boolean),
          voters: prev.voters.map((v) => {
            const c = vMap.get(String(v._id));
            return c ? { ...v, surveyStatus: c.surveyStatus } : v;
          }),
        };
        saveBootstrap(next);
        return next;
      });
    }
    if (serverTime) sinceRef.current = serverTime;
  }, [changesQ.data, qc]);

  // Index voters by household for the bottom sheet stats.
  const votersByHousehold = useMemo(() => {
    const m = new Map();
    for (const v of data?.voters || []) {
      const k = String(v.householdId);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(v);
    }
    return m;
  }, [data]);

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
  const isLitDrop = activeCampaign?.type === 'lit_drop';

  // Selected household stats for the bottom sheet.
  const selectedVoters = selected
    ? votersByHousehold.get(String(selected._id)) || []
    : [];
  const selectedSurveyedCount = selectedVoters.filter(
    (v) => v.surveyStatus === 'surveyed'
  ).length;
  const selectedLastSeen = selected ? timeAgo(selected.lastActionAt) : null;

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
                <Text style={styles.pendingBadgeText}>{pendingCount} pending</Text>
              </View>
            )}
            {isAdmin && (
              <Pressable
                onPress={() => router.push('/(app)/admin')}
                style={styles.adminChip}
              >
                <Text style={styles.adminChipText}>Admin ↑</Text>
              </Pressable>
            )}
            <Pressable onPress={onRefresh} style={styles.iconButton}>
              {isFetching ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <Text style={styles.iconButtonText}>↻</Text>
              )}
            </Pressable>
            <Pressable onPress={onLogout} style={styles.iconButtonGhost}>
              <Text style={styles.iconButtonGhostText}>Sign out</Text>
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
          <Pressable
            onPress={() => setFilterMenuOpen((v) => !v)}
            style={[
              styles.filterChip,
              activeFilter !== 'all' && styles.filterChipActive,
            ]}
          >
            <Text style={styles.filterIcon}>⌕</Text>
            <Text
              style={[
                styles.filterChipText,
                activeFilter !== 'all' && styles.filterChipTextActive,
              ]}
              numberOfLines={1}
            >
              {activeOption.label}
            </Text>
            <Text style={styles.filterChevron}>{filterMenuOpen ? '▴' : '▾'}</Text>
          </Pressable>
        </View>

        {filterMenuOpen && (
          <View style={styles.filterMenu}>
            <Text style={styles.filterMenuLabel}>Show on map</Text>
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
          selected ? styles.recenterButtonAboveSheet : styles.recenterButtonAboveProgress,
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

      {/* Pin sheet OR progress card */}
      {selected ? (
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
            <StatusPill status={selected.status} compact />
          </View>

          <View style={styles.sheetMetaRow}>
            {!isLitDrop && (
              <View style={styles.sheetMetaItem}>
                <Text style={styles.sheetMetaIcon}>👥</Text>
                <Text style={styles.sheetMetaText}>
                  <Text style={styles.sheetMetaStrong}>{selectedVoters.length}</Text>{' '}
                  {selectedVoters.length === 1 ? 'voter' : 'voters'}
                  {selectedSurveyedCount > 0 ? (
                    <Text style={styles.sheetMetaSub}>
                      {' '}· {selectedSurveyedCount} surveyed
                    </Text>
                  ) : null}
                </Text>
              </View>
            )}
            {selectedLastSeen && (
              <View style={styles.sheetMetaItem}>
                <Text style={styles.sheetMetaIcon}>🕒</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetMetaText}>
                    <Text style={styles.sheetMetaStrong}>Last visit</Text>{' '}
                    <Text style={styles.sheetMetaSub}>{selectedLastSeen}</Text>
                  </Text>
                  <Text style={styles.sheetTimestamp}>
                    {formatExact(selected.lastActionAt)}
                  </Text>
                </View>
              </View>
            )}
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
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Today's Progress</Text>
            <Text style={styles.progressLegendHint}>also serves as map legend</Text>
          </View>
          <View style={styles.progressRow}>
            <ProgressStat
              pinStatus="not_home"
              value={today.doorsKnocked?.toLocaleString()}
              label="Doors knocked"
            />
            <ProgressStat
              pinStatus={isLitDrop ? 'lit_dropped' : 'surveyed'}
              value={(isLitDrop ? today.litDropped : today.responses)?.toLocaleString()}
              label={isLitDrop ? 'Lit drops' : 'Responses'}
            />
            <ProgressStat
              pinStatus="unknocked"
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
  iconButtonGhost: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  iconButtonGhostText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  pendingBadge: {
    backgroundColor: colors.warnBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  pendingBadgeText: { color: '#92400E', fontWeight: '700', fontSize: 12 },
  adminChip: {
    backgroundColor: colors.brandTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  adminChipText: { color: colors.brand, fontWeight: '700', fontSize: 12 },

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

  filterChip: {
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
  filterChipActive: {
    backgroundColor: colors.brandTint,
    borderColor: colors.brand,
  },
  filterIcon: {
    fontSize: 13,
    color: colors.textSecondary,
    marginRight: 6,
    fontWeight: '700',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    maxWidth: 120,
  },
  filterChipTextActive: { color: colors.brand },
  filterChevron: {
    marginLeft: 6,
    fontSize: 11,
    color: colors.textSecondary,
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
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  recenterButtonAboveProgress: { bottom: 180 },
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
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  sheetAddress: { ...type.h3 },
  sheetSub: { ...type.caption, marginTop: 2 },

  sheetMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sheetMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sheetMetaIcon: { fontSize: 14, marginRight: spacing.xs },
  sheetMetaText: { fontSize: 13, color: colors.textSecondary },
  sheetMetaStrong: { fontWeight: '700', color: colors.textPrimary },
  sheetMetaSub: { color: colors.textSecondary },
  sheetTimestamp: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

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
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  progressTitle: { ...type.h3 },
  progressLegendHint: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
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

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  compact: { paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  text: { fontSize: 11, fontWeight: '700' },
});
