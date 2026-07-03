import { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { getCurrentLocation } from '../lib/location';
import { recordLocationCorrection } from '../lib/recordAction';
import { MAPBOX_PUBLIC_TOKEN } from '../lib/config';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';

if (MAPBOX_PUBLIC_TOKEN) Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);

// Correct a door's pin: drop it at the canvasser's GPS spot, or drag the marker.
// Writes via recordLocationCorrection (optimistic + offline-safe). When the door
// shares a pin with other units, asks whether to move just this unit or all of them.
export default function FixPinModal({ visible, household, qc, siblingCount = 0, onClose }) {
  const { colors } = useTheme();
  const cur = household?.location?.coordinates; // [lng, lat]
  const [coords, setCoords] = useState(cur ? { lng: cur[0], lat: cur[1] } : null);
  const [accuracy, setAccuracy] = useState(null);
  const [source, setSource] = useState(null); // 'gps' | 'drag'
  const [busy, setBusy] = useState(false);

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
    if (!coords || !household) return;
    const commit = (scope) => {
      recordLocationCorrection(qc, household._id, {
        lat: coords.lat,
        lng: coords.lng,
        source: source || 'drag',
        accuracy,
        scope,
      });
      onClose();
    };
    const withScope = () => {
      if (siblingCount > 0) {
        Alert.alert(
          'Shared pin',
          `This address shares a pin with ${siblingCount} other unit${siblingCount === 1 ? '' : 's'}. Move just this unit, or the whole building?`,
          [
            { text: 'Just this unit', onPress: () => commit('unit') },
            { text: 'Whole building', onPress: () => commit('building') },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
      } else {
        commit('unit');
      }
    };
    if (source === 'gps' && (accuracy == null || accuracy > 50)) {
      Alert.alert(
        'Weak GPS signal',
        `Your GPS is only accurate to about ${accuracy == null ? '?' : Math.round(accuracy)} m. Use it anyway?`,
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
  const center = cur || (coords ? [coords.lng, coords.lat] : [0, 0]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Fix pin location</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            Drag the blue pin to the right spot, or drop it where you're standing.
          </Text>

          <View style={[styles.mapWrap, { borderColor: colors.border }]}>
            <Mapbox.MapView style={{ flex: 1 }} scaleBarEnabled={false} logoEnabled={false} attributionEnabled={false} compassEnabled={false}>
              <Mapbox.Camera
                defaultSettings={{ centerCoordinate: center, zoomLevel: 17 }}
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
              GPS accuracy ±{Math.round(accuracy)} m
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={[styles.btn, { borderColor: colors.border }]}>
              <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={!coords || busy}
              style={[styles.btn, styles.primary, { backgroundColor: colors.brand, opacity: !coords || busy ? 0.6 : 1 }]}
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
