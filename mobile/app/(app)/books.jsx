import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../lib/api';
import {
  saveBootstrap,
  loadBootstrap,
  loadActiveCampaign,
  saveActiveCampaign,
  clearBootstrap,
  saveSelectedBooks,
  clearSelectedBooks,
  saveCurrentEffort,
  loadCurrentEffort,
  clearCurrentEffort,
} from '../../lib/cache';
import { MAPBOX_PUBLIC_TOKEN } from '../../lib/config';
import { flushQueue, getPendingCount } from '../../lib/offlineQueue';
import { ensureLocationPermission } from '../../lib/location';
import CanvasserHeader from '../../components/CanvasserHeader';
import MapControlStack from '../../components/MapControlStack';
import EffortPicker from '../../components/EffortPicker';
import { radius, spacing } from '../../lib/theme';
import { useTheme } from '../../lib/ThemeContext';
import { useThemedStyles } from '../../lib/useThemedStyles';
import { useMapStyle } from '../../lib/mapStyles';

if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

const DEFAULT_CENTER = [-84.5, 39.0];

export default function BooksScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const cameraRef = useRef(null);
  const cameraInitRef = useRef(false);
  const [activeCampaign, setActiveCampaign] = useState(undefined);
  const [selected, setSelected] = useState(null); // a single book id, or null
  const [mapReady, setMapReady] = useState(false);
  const [currentEffort, setCurrentEffort] = useState(null);
  const [following, setFollowing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const effortResolvedRef = useRef(false);
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { styleId, styleURL, setStyle } = useMapStyle();
  const insets = useSafeAreaInsets();

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

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['bootstrap'],
    queryFn: async () => {
      try {
        const fresh = await api(`/mobile/bootstrap?campaignId=${activeCampaign.id}`);
        await saveBootstrap(fresh);
        return fresh;
      } catch (err) {
        const cached = await loadBootstrap();
        if (cached && String(cached.campaign?.id) === String(activeCampaign.id)) return cached;
        throw err;
      }
    },
    enabled: !!activeCampaign?.id,
    // Short window so a freshly-activated round refetches per-round status on mount
    // rather than showing the prior round's cached colors.
    staleTime: 30 * 1000,
  });

  const books = data?.books || [];
  const households = data?.households || [];
  const efforts = useMemo(() => data?.efforts || [], [data]);

  // Resolve the canvasser's current effort once efforts load — the saved choice
  // if still valid, else the first effort. Re-resolves if the set ever changes.
  useEffect(() => {
    if (!activeCampaign?.id || !efforts.length) return;
    if (currentEffort && efforts.some((e) => String(e.id) === String(currentEffort))) return;
    let mounted = true;
    (async () => {
      const saved = effortResolvedRef.current ? null : await loadCurrentEffort(activeCampaign.id);
      effortResolvedRef.current = true;
      if (!mounted) return;
      const valid = saved && efforts.some((e) => String(e.id) === String(saved));
      setCurrentEffort(valid ? saved : efforts[0].id);
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaign, efforts, currentEffort]);

  // Books shown in the picker, scoped to the chosen effort. Book numbers restart
  // per effort, so without this a canvasser on two efforts sees two "Book 6"s.
  const visibleBooks = useMemo(() => {
    if (efforts.length <= 1 || !currentEffort) return books;
    return books.filter((b) => String(b.effortId) === String(currentEffort));
  }, [books, efforts, currentEffort]);

  const onEffortChange = useCallback(
    (effortId) => {
      setCurrentEffort(effortId);
      saveCurrentEffort(activeCampaign?.id, effortId);
      setSelected(null); // the previously-picked book belonged to the old effort
      setFollowing(false); // drop follow so the re-frame isn't suppressed by rnmapbox
      cameraInitRef.current = false; // re-frame the map to the new effort's books
    },
    [activeCampaign]
  );

  // A real pan/zoom/rotate gesture breaks follow mode (standard map behavior);
  // programmatic camera moves aren't gestures, so they don't trip this.
  const onCameraChanged = useCallback((state) => {
    if (state?.gestures?.isGestureActive) setFollowing((f) => (f ? false : f));
  }, []);

  const refreshPending = useCallback(async () => {
    setPendingCount(await getPendingCount());
  }, []);

  // Mirror the houses map's refresh: flush any offline-queued actions, reload the
  // books, then update the pending badge — so the shared cluster's refresh button
  // behaves identically on both maps.
  const onRefresh = useCallback(async () => {
    try {
      await flushQueue();
    } catch {}
    await refetch();
    await refreshPending();
  }, [refetch, refreshPending]);

  // Establish location permission before enabling follow so the recenter button
  // can't silently no-op (rnmapbox v10 doesn't auto-request on Android).
  const onRecenter = useCallback(async () => {
    if (following) {
      setFollowing(false);
      return;
    }
    const granted = await ensureLocationPermission();
    if (granted) setFollowing(true);
  }, [following]);

  // Keep the pending badge current when returning to the picker (e.g. after
  // recording knocks offline on the map and coming back).
  useFocusEffect(
    useCallback(() => {
      refreshPending();
    }, [refreshPending])
  );

  // Admin / non-turf campaign (sees everything, no assigned books) → straight to the map.
  useEffect(() => {
    if (!data) return;
    if (!books.length && households.length) router.replace('/(app)/map');
  }, [data, books.length, households.length, router]);

  // One book marker per book at its centroid; progress from the houses' status.
  const bookMarkers = useMemo(
    () =>
      visibleBooks
        .filter((b) => b.centroid?.coordinates?.length === 2)
        .map((b) => {
          const members = households.filter((h) => String(h.turfId) === String(b.id));
          const total = members.length || b.doorCount || 0;
          const knocked = members.filter((h) => (h.status || 'unknocked') !== 'unknocked').length;
          const status = total > 0 && knocked >= total ? 'green' : knocked > 0 ? 'yellow' : 'grey';
          return { id: String(b.id), coordinates: b.centroid.coordinates, name: b.name, knocked, total, status };
        }),
    [visibleBooks, households]
  );
  const selectedBook = bookMarkers.find((b) => b.id === selected) || null;

  // Frame all the book markers — but only once the map is ready, otherwise the
  // camera ref isn't attached yet and we'd silently stay at the default center.
  useEffect(() => {
    if (cameraInitRef.current || !mapReady || !cameraRef.current) return;
    const pts = bookMarkers.map((b) => b.coordinates);
    if (!pts.length) return;
    if (pts.length === 1) {
      cameraRef.current.setCamera({ centerCoordinate: pts[0], zoomLevel: 14, animationDuration: 0 });
    } else {
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const [lng, lat] of pts) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], [110, 50, 160, 50], 0);
    }
    cameraInitRef.current = true;
  }, [bookMarkers, mapReady]);

  const onBookPress = useCallback((id) => {
    setSelected((cur) => (cur === String(id) ? null : String(id)));
  }, []);

  // Book markers as native symbol features (not MarkerView overlays, which would
  // block pinch-zoom). `selected` rides along so the chosen book's glyph grows.
  const bookFeatures = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: bookMarkers.map((b) => ({
        type: 'Feature',
        id: b.id,
        properties: {
          id: b.id,
          name: b.name,
          knocked: b.knocked,
          total: b.total,
          status: b.status,
          selected: selected === b.id,
        },
        geometry: { type: 'Point', coordinates: b.coordinates },
      })),
    }),
    [bookMarkers, selected]
  );

  const onBookMarkerPress = useCallback(
    (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) onBookPress(id);
    },
    [onBookPress]
  );

  async function onEnter() {
    if (!selected) return;
    // Persist the choice so a cold start can re-scope the map to this book
    // instead of falling open to all houses.
    await saveSelectedBooks(activeCampaign?.id, selected);
    router.replace({ pathname: '/(app)/map', params: { selectedBooks: selected } });
  }

  async function switchCampaign() {
    await saveActiveCampaign(null);
    await clearBootstrap();
    await clearSelectedBooks();
    await clearCurrentEffort();
    qc.removeQueries({ queryKey: ['bootstrap'] });
    router.replace('/(app)/campaigns');
  }

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>Map unavailable: missing Mapbox configuration.</Text>
      </SafeAreaView>
    );
  }
  if (activeCampaign === undefined || (activeCampaign && isLoading)) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.brand} />
        <Text style={styles.muted}>Loading your books…</Text>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>{error.message}</Text>
        <Pressable onPress={() => refetch()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!books.length) {
    // Has houses but no books → admin/non-turf, redirecting to the full map.
    if (households.length) {
      return (
        <SafeAreaView style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyTitle}>No turf assigned yet</Text>
        <Text style={styles.muted}>Your admin will assign you a book to start canvassing.</Text>
        <Pressable onPress={() => refetch()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Refresh</Text>
        </Pressable>
        <Pressable onPress={switchCampaign} style={[styles.secondaryButton, { marginTop: 10 }]}>
          <Text style={styles.secondaryButtonText}>Choose a different campaign</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Mapbox.MapView
        style={{ flex: 1 }}
        styleURL={styleURL}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onCameraChanged={onCameraChanged}
        zoomEnabled
        scrollEnabled
        pitchEnabled
        rotateEnabled
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: 9 }}
          followUserLocation={following}
          followZoomLevel={16}
          animationMode="flyTo"
          animationDuration={500}
        />
        <Mapbox.UserLocation visible />
        <Mapbox.Images
          images={{
            'book-grey': require('../../assets/icons/book-grey.png'),
            'book-yellow': require('../../assets/icons/book-yellow.png'),
            'book-green': require('../../assets/icons/book-green.png'),
          }}
        />
        {/* Book markers as native symbols + haloed label. Tap selects; the
            selected glyph grows via the `selected` feature property. */}
        <Mapbox.ShapeSource id="books" shape={bookFeatures} onPress={onBookMarkerPress} cluster={false}>
          <Mapbox.SymbolLayer
            id="book-markers"
            style={{
              iconImage: [
                'match',
                ['get', 'status'],
                'green', 'book-green',
                'yellow', 'book-yellow',
                'book-grey',
              ],
              iconSize: ['case', ['get', 'selected'], 0.42, 0.3],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              textField: '{name} · {knocked}/{total}',
              textSize: 11,
              textColor: colors.mapLabel,
              textHaloColor: colors.mapLabelHalo,
              textHaloWidth: 1.6,
              textAnchor: 'top',
              textOffset: [0, 1.1],
              textAllowOverlap: true,
              textIgnorePlacement: true,
              textOptional: true,
            }}
          />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      <SafeAreaView edges={['top']} style={styles.headerWrap} pointerEvents="box-none">
        <CanvasserHeader variant="floating" onSwitchCampaign={switchCampaign} />
        {efforts.length > 1 && (
          <View style={styles.effortRow}>
            <EffortPicker efforts={efforts} value={currentEffort} onChange={onEffortChange} />
          </View>
        )}
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            Tap your books to pick where to start. Grey = not started · yellow = in progress · green = done.
          </Text>
        </View>
      </SafeAreaView>

      {/* Bottom-right control stack — same cluster as the houses map (refresh,
          terrain, recenter/follow). Lifts above the "Enter book" button when a
          book is selected so the two never overlap. */}
      <View
        style={[styles.controlsWrap, { bottom: insets.bottom + (selectedBook ? 84 : spacing.lg) }]}
        pointerEvents="box-none"
      >
        <MapControlStack
          following={following}
          onRecenter={onRecenter}
          styleId={styleId}
          onStyleChange={setStyle}
          onRefresh={onRefresh}
          refreshing={isFetching}
          pendingCount={pendingCount}
        />
      </View>

      {selectedBook && (
        <SafeAreaView edges={['bottom']} style={styles.enterWrap} pointerEvents="box-none">
          <Pressable onPress={onEnter} style={styles.enterButton}>
            <Text style={styles.enterButtonText} numberOfLines={1}>
              Enter {selectedBook.name} →
            </Text>
          </Pressable>
        </SafeAreaView>
      )}
    </View>
  );
}

function makeStyles(t) {
  const { colors } = t;
  return StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  muted: { color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  emptyTitle: { fontWeight: '700', fontSize: 16, color: colors.textPrimary, marginBottom: 4 },
  errorText: { color: colors.danger, textAlign: 'center' },
  primaryButton: { backgroundColor: colors.brand, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.md, marginTop: 12 },
  primaryButtonText: { color: colors.textInverse, fontWeight: '600' },
  secondaryButton: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.md },
  secondaryButtonText: { color: colors.textPrimary, fontWeight: '600' },
  headerWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  controlsWrap: { position: 'absolute', right: spacing.lg, alignItems: 'flex-end' },
  effortRow: { marginHorizontal: 12, marginBottom: 8, zIndex: 10 },
  hint: {
    marginHorizontal: 12,
    backgroundColor: colors.chromeBar,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hintText: { fontSize: 12, color: colors.textSecondary },
  enterWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, alignItems: 'center' },
  enterButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  enterButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
  });
}
