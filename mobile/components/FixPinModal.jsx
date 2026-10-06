import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { getCurrentLocation } from '../lib/location';
import { formatDistance } from '../lib/geo';
import { recordLocationCorrection } from '../lib/recordAction';
import { fixPinSaveState, seedAllowed } from '../lib/fixPin';
import { androidAlertOrder } from '../lib/mapsLinks';
import { initMapbox } from '../lib/mapbox';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';

initMapbox();

// Correct a door's pin: drop it at the canvasser's GPS spot, or drag the marker.
// Writes via recordLocationCorrection (optimistic + offline-safe). When other units of the
// door's STREET ADDRESS share its pin (`siblingCount`), asks whether to move just this unit
// or the whole building — the separate homes on a shared spot are never part of that.
//
// `unplaced`: the door, or a unit of its address on the spot, has no exact map spot
// (lib/fixPin.js). The map opens on the shared spot and moves to the lead's GPS fix when one
// arrives near it (shown, not yet placed); Save waits until the lead drags the pin or taps
// "Use my current location" clearly off the spot.
export default function FixPinModal({ visible, household, qc, siblingCount = 0, unplaced = false, onClose }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets(); // clear the Android nav bar / iOS home indicator
  const cur = household?.location?.coordinates; // [lng, lat]
  const [coords, setCoords] = useState(cur ? { lng: cur[0], lat: cur[1] } : null);
  const [accuracy, setAccuracy] = useState(null);
  const [source, setSource] = useState(null); // 'gps' | 'drag'
  const [busy, setBusy] = useState(false);
  const [center, setCenter] = useState(cur || null); // where the map's camera sits
  // Read by the GPS seed when its fix lands, which can be seconds later: a pin the lead
  // placed in the meantime wins.
  const sourceRef = useRef(null);
  sourceRef.current = source;

  // The modal stays mounted between opens (household/[id].jsx), so every open starts over
  // from the door's own pin.
  useEffect(() => {
    if (!visible) return;
    const c = household?.location?.coordinates;
    setCoords(c ? { lng: c[0], lat: c[1] } : null);
    setAccuracy(null);
    setSource(null);
    setCenter(c || null);
  }, [visible, household?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A home with no exact spot: when the lead's fix arrives (up to ~6 s), move the pin and the
  // camera onto them, if they haven't placed the pin yet and the fix is near the spot. The
  // ignore flag drops a fix that lands after the modal closed.
  useEffect(() => {
    if (!visible || !unplaced || !cur) return undefined;
    let ignore = false;
    getCurrentLocation()
      .then((loc) => {
        if (ignore || !loc) return;
        const fix = [loc.lng, loc.lat];
        if (!seedAllowed({ unplaced, source: sourceRef.current, spot: cur, fix })) return;
        setCoords({ lng: loc.lng, lat: loc.lat });
        setCenter(fix);
      })
      .catch(() => {}); // opportunistic — "Use my current location" reports its own errors
    return () => {
      ignore = true;
    };
  }, [visible, unplaced, household?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { canSave, atSpot } = fixPinSaveState({ unplaced, spot: cur, coords, source });

  async function useMyLocation() {
    setBusy(true);
    try {
      const loc = await getCurrentLocation();
      if (!loc) {
        Alert.alert('Location unavailable', 'Could not get your GPS position. Try again outside.');
        return;
      }
      setCoords({ lat: loc.lat, lng: loc.lng });
      setAccuracy(loc.accuracy ?? null);
      setSource('gps');
    } catch {
      Alert.alert('Location off', 'Turn on location permission and try again.');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!coords || !household || !canSave) return;
    const commit = (scope) => {
      recordLocationCorrection(qc, household._id, {
        lat: coords.lat,
        lng: coords.lng,
        source: source || 'drag',
        accuracy,
        scope,
      })
        .then((result) => {
          // An online save the server answered with "nothing moved" (the pin was still on the shared
          // spot). A queued save stays silent: its answer arrives on a later sync.
          if (result?.ok && result.response?.moved === 0) {
            Alert.alert('Nothing moved', 'Nothing moved — the pin is still on its old spot.');
          }
        })
        .catch(() => {});
      onClose();
    };
    const withScope = () => {
      if (siblingCount > 0) {
        const rows = [
          { text: 'Just this unit', onPress: () => commit('unit') },
          { text: 'Whole building', onPress: () => commit('building') },
        ];
        // Android assigns its three slots from the END of the array and emphasizes the last, so Cancel goes
        // first and the rows reversed (lib/mapsLinks.js androidAlertOrder) — or Cancel lands under the thumb.
        const buttons =
          Platform.OS === 'android'
            ? [{ text: 'Cancel', style: 'cancel' }, ...androidAlertOrder(rows)]
            : [...rows, { text: 'Cancel', style: 'cancel' }];
        Alert.alert(
          'Shared pin',
          `This address has ${siblingCount} other unit${siblingCount === 1 ? '' : 's'} on this map spot. Move just this unit, or the whole building?`,
          buttons
        );
      } else {
        commit('unit');
      }
    };
    if (source === 'gps' && (accuracy == null || accuracy > 50)) {
      Alert.alert(
        'Weak GPS signal',
        `Your GPS is only accurate to about ${accuracy == null ? '?' : formatDistance(accuracy)}. Use it anyway?`,
        [
          { text: 'Use anyway', onPress: withScope },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    } else {
      withScope();
    }
  }

  if (!household) return null;
  const cameraCenter = center || cur || (coords ? [coords.lng, coords.lat] : [0, 0]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: spacing.lg + insets.bottom }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Fix pin location</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            {unplaced
              ? 'Drag the pin to the house, or tap Use my current location while standing at it.'
              : "Drag the blue pin to the right spot, or drop it where you're standing."}
          </Text>

          <View style={[styles.mapWrap, { borderColor: colors.border }]}>
            <Mapbox.MapView style={{ flex: 1 }} scaleBarEnabled={false} logoEnabled={false} attributionEnabled={false} compassEnabled={false}>
              <Mapbox.Camera
                defaultSettings={{ centerCoordinate: cameraCenter, zoomLevel: 17 }}
                centerCoordinate={cameraCenter}
                zoomLevel={17}
                animationDuration={0}
              />
              {cur && (
                <Mapbox.PointAnnotation id="old-pin" coordinate={cur}>
                  <View style={[styles.ghost, { borderColor: colors.textMuted }]} />
                </Mapbox.PointAnnotation>
              )}
              {coords && (
                <Mapbox.PointAnnotation
                  id="new-pin"
                  draggable
                  coordinate={[coords.lng, coords.lat]}
                  onDragEnd={(e) => {
                    const c = e?.geometry?.coordinates || e?.payload?.geometry?.coordinates;
                    if (c && c.length === 2) {
                      setCoords({ lng: c[0], lat: c[1] });
                      setSource('drag');
                    }
                  }}
                >
                  <View style={[styles.newPin, { backgroundColor: colors.brand }]} />
                </Mapbox.PointAnnotation>
              )}
            </Mapbox.MapView>
          </View>

          <Pressable onPress={useMyLocation} disabled={busy} style={[styles.locBtn, { borderColor: colors.border }]}>
            <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
              {busy ? 'Locating…' : '📍  Use my current location'}
            </Text>
          </Pressable>
          {source === 'gps' && accuracy != null && (
            <Text style={[styles.acc, { color: accuracy > 50 ? colors.warnFg : colors.textMuted }]}>
              GPS accuracy ±{formatDistance(accuracy)}
            </Text>
          )}
          {atSpot && (
            <Text style={[styles.acc, { color: colors.warnFg }]}>
              You're at this home's map spot. If the home really is here, mark it Looks right in Pin Fixes.
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={[styles.btn, { borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={!canSave || busy}
              style={[styles.btn, styles.primary, { backgroundColor: colors.brand, opacity: !canSave || busy ? 0.6 : 1 }]}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Save location</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700' },
  sub: { fontSize: 13 },
  mapWrap: { height: 260, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden', marginTop: spacing.sm },
  ghost: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, backgroundColor: 'transparent' },
  newPin: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#FFFFFF' },
  locBtn: { borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  acc: { fontSize: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  primary: { borderWidth: 0 },
});
