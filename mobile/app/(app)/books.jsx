import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../lib/api';
import {
  saveBootstrap,
  loadBootstrap,
  loadActiveCampaign,
  saveActiveCampaign,
  clearBootstrap,
} from '../../lib/cache';
import { MAPBOX_PUBLIC_TOKEN } from '../../lib/config';
import Logo from '../../components/Logo';
import BookMarker from '../../components/BookMarker';
import { colors, radius } from '../../lib/theme';

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

  const { data, isLoading, error, refetch } = useQuery({
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
    staleTime: 5 * 60 * 1000,
  });

  const books = data?.books || [];
  const households = data?.households || [];

  // Admin / non-turf campaign (sees everything, no assigned books) → straight to the map.
  useEffect(() => {
    if (!data) return;
    if (!books.length && households.length) router.replace('/(app)/map');
  }, [data, books.length, households.length, router]);

  // One book marker per book at its centroid; progress from the houses' status.
  const bookMarkers = useMemo(
    () =>
      books
        .filter((b) => b.centroid?.coordinates?.length === 2)
        .map((b) => {
          const members = households.filter((h) => String(h.turfId) === String(b.id));
          const total = members.length || b.doorCount || 0;
          const knocked = members.filter((h) => (h.status || 'unknocked') !== 'unknocked').length;
          const status = total > 0 && knocked >= total ? 'green' : knocked > 0 ? 'yellow' : 'grey';
          return { id: String(b.id), coordinates: b.centroid.coordinates, name: b.name, knocked, total, status };
        }),
    [books, households]
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

  function onEnter() {
    if (!selected) return;
    router.replace({ pathname: '/(app)/map', params: { selectedBooks: selected } });
  }

  async function switchCampaign() {
    await saveActiveCampaign(null);
    await clearBootstrap();
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
        styleURL={Mapbox.StyleURL.Street}
        onDidFinishLoadingMap={() => setMapReady(true)}
      >
        <Mapbox.Camera ref={cameraRef} defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: 9 }} />
        <Mapbox.UserLocation visible />
        {bookMarkers.map((b) => (
          <Mapbox.MarkerView key={b.id} id={b.id} coordinate={b.coordinates} anchor={{ x: 0.5, y: 1 }} allowOverlap>
            <BookMarker
              name={b.name}
              knocked={b.knocked}
              total={b.total}
              status={b.status}
              selected={selected === b.id}
              onPress={() => onBookPress(b.id)}
            />
          </Mapbox.MarkerView>
        ))}
      </Mapbox.MapView>

      <SafeAreaView edges={['top']} style={styles.headerWrap} pointerEvents="box-none">
        <View style={styles.header}>
          <Logo size={24} />
          <Pressable onPress={switchCampaign} hitSlop={8}>
            <Text style={styles.switch}>Switch campaign</Text>
          </Pressable>
        </View>
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            Tap your books to pick where to start. Grey = not started · yellow = in progress · green = done.
          </Text>
        </View>
      </SafeAreaView>

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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  muted: { color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  emptyTitle: { fontWeight: '700', fontSize: 16, color: colors.textPrimary, marginBottom: 4 },
  errorText: { color: colors.danger, textAlign: 'center' },
  primaryButton: { backgroundColor: colors.brand, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.md, marginTop: 12 },
  primaryButtonText: { color: colors.textInverse, fontWeight: '600' },
  secondaryButton: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.md },
  secondaryButtonText: { color: colors.textPrimary, fontWeight: '600' },
  headerWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  switch: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  hint: {
    marginHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
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
