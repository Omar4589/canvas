import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, Platform, StyleSheet } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { initMapbox } from '../lib/mapbox';
import { getCurrentToken, requireReauthIfCurrent } from '../lib/authState';
import { armStagingCrash } from '../lib/stagingCrash';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// STAGING ONLY. The error-recovery test rows (docs/PROPOSAL_ERROR_RECOVERY.md §B11, §E device gates),
// revealed by a long-press on the Profile screen's build line on a staging build. app/(app)/profile.jsx
// requires this file only inside its staging branch, so on a store build it is never loaded — and its
// module-scope initMapbox() never runs there.
//
// Every timer starts from a tap. Plain rows, not an Alert: an Android Alert keeps only three buttons,
// and Alert callbacks take a different path than real taps.

// Leaf routes load lazily, and a map without its token fails differently (lib/mapbox.js).
initMapbox();

const fail = (what) => {
  throw new Error(`Staging test: ${what}`);
};

// Module scope on purpose: Profile's own timers would be cleared when it is left, and these must keep
// running while the tester opens a door.
let delayedTimer = null;
const startDelayed = () => {
  clearTimeout(delayedTimer);
  delayedTimer = setTimeout(() => fail('delayed error'), 20_000);
};

let burstTimer = null;
const startBurst = () => {
  clearTimeout(burstTimer);
  burstTimer = setTimeout(() => {
    for (let i = 0; i < 6; i += 1) setTimeout(() => fail(`burst ${i + 1} of 6`), i * 200);
  }, 15_000);
};

// Runs until the app restarts — that is the point.
let loopArmed = false;
const startLoop = () => {
  if (loopArmed) return;
  loopArmed = true;
  setTimeout(() => {
    setInterval(() => fail('keep looping'), 300);
  }, 15_000);
};

const EMPTY = { type: 'FeatureCollection', features: [] };

// Android only: removing a layer setting sends null to the native manager, which reads it as a number
// on the UI thread (RNMBXCircleLayerManager.kt) — the real host-failure path. Until the app-store build
// that turns it into a crash, this is the gray screen.
const NativeFailure = ({ style }) => {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    setZoom(undefined);
  }, []);
  return (
    <Mapbox.MapView style={style}>
      <Mapbox.ShapeSource id="staging-native-failure" shape={EMPTY}>
        {/* The ONE deliberate violation of lib/nativeProps.test.js's rule — invisible to it by design,
            because `zoom` is a variable that becomes undefined. */}
        <Mapbox.CircleLayer id="staging-native-failure-dots" minZoomLevel={zoom} />
      </Mapbox.ShapeSource>
    </Mapbox.MapView>
  );
};

const ErrorRecoveryTests = () => {
  const styles = useThemedStyles(makeStyles);
  const [note, setNote] = useState(null);
  const [repeating, setRepeating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [nativeFailure, setNativeFailure] = useState(false);

  // Owned by this screen: stops once the crash screen unmounts it.
  useEffect(() => {
    if (!repeating) return undefined;
    const id = setInterval(() => fail('repeated errors'), 300);
    return () => clearInterval(id);
  }, [repeating]);

  const rows = [
    {
      title: 'Tap error',
      hint: 'Throws inside this tap. Expect the banner; the app keeps working.',
      onPress: () => fail('tap error'),
    },
    {
      title: 'Repeated errors',
      hint: 'Throws every 0.3 s from this screen. Expect the crash screen; the errors stop once it is up.',
      onPress: () => setRepeating(true),
    },
    {
      title: 'Delayed error',
      hint: 'Throws once, 20 s from now. Open a door meanwhile: the banner shows without Restart.',
      onPress: () => {
        startDelayed();
        setNote('Delayed error armed: it fires in 20 seconds.');
      },
    },
    {
      title: 'Burst on a door',
      hint: '15 s from now, six errors 0.2 s apart. On a door: the banner only. Off a door: the crash screen.',
      onPress: () => {
        startBurst();
        setNote('Burst armed: it starts in 15 seconds.');
      },
    },
    {
      title: 'Keep looping',
      hint: '15 s from now, an error every 0.3 s until the app restarts. On a door: the banner only; back on the map, the crash screen.',
      onPress: () => {
        startLoop();
        setNote('Loop armed: it starts in 15 seconds and runs until Doorline restarts.');
      },
    },
    {
      title: 'Error in a sheet',
      hint: 'Opens a sheet whose button throws. The banner appears when the sheet closes.',
      onPress: () => setSheetOpen(true),
    },
    {
      title: 'Ask for password',
      hint: 'Shows the password screen over this one, as when a sign-in runs out.',
      onPress: () => {
        requireReauthIfCurrent({ reason: 'expired', token: getCurrentToken() }).catch(() => {});
      },
    },
    {
      title: 'Crash the next door',
      hint: 'The next door you open shows its crash card.',
      onPress: () => {
        armStagingCrash('household');
        setNote('Armed: the next door you open crashes.');
      },
    },
    {
      title: 'Crash the next survey',
      hint: 'The next survey you open from a door shows its crash card.',
      onPress: () => {
        armStagingCrash('survey');
        setNote('Armed: the next survey you open crashes.');
      },
    },
    {
      title: 'Crash the next practice survey',
      hint: 'The next practice survey you open shows its crash card.',
      onPress: () => {
        armStagingCrash('practice');
        setNote('Armed: the next practice survey you open crashes.');
      },
    },
    {
      title: 'Crash the app frame',
      hint: 'Now: "Doorline hit a problem", with Restart.',
      onPress: () => armStagingCrash('root'),
    },
  ];
  if (Platform.OS === 'android') {
    rows.push({
      title: 'Native failure',
      hint: 'Mounts a tiny map and removes one of its settings. Until the app-store build: the gray screen.',
      onPress: () => setNativeFailure(true),
    });
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Error recovery tests (staging only)</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {rows.map((row) => (
        <Pressable
          key={row.title}
          onPress={row.onPress}
          accessibilityRole="button"
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Text style={styles.rowTitle}>{row.title}</Text>
          <Text style={styles.rowHint}>{row.hint}</Text>
        </Pressable>
      ))}
      {nativeFailure ? <NativeFailure style={styles.tinyMap} /> : null}

      <Modal visible={sheetOpen} animationType="slide" transparent onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.heading}>Error in a sheet</Text>
            <Text style={styles.rowHint}>Tap Throw, then Close. The banner appears once this sheet is gone.</Text>
            <Pressable
              onPress={() => fail('error in a sheet')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.rowTitle}>Throw</Text>
            </Pressable>
            <Pressable
              onPress={() => setSheetOpen(false)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.rowTitle}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default ErrorRecoveryTests;

const makeStyles = (t) => {
  const { colors, type } = t;
  return StyleSheet.create({
    wrap: { marginTop: spacing.lg, gap: spacing.sm },
    heading: { ...type.h3 },
    note: { ...type.caption, color: colors.textPrimary, fontWeight: '600' },
    row: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      minHeight: 44,
    },
    pressed: { opacity: 0.7 },
    rowTitle: { ...type.bodyStrong },
    rowHint: { ...type.caption, marginTop: spacing.xs },
    tinyMap: { width: 1, height: 1 },
    backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
      gap: spacing.sm,
    },
  });
};
