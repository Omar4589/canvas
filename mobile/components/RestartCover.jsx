import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  AccessibilityInfo,
  BackHandler,
  findNodeHandle,
  StyleSheet,
} from 'react-native';
import { useReloadPending } from '../lib/appRestart';
import { spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Covers the app from the moment a Restart has been asked for until the reload happens
// (lib/appRestart.js, docs/PROPOSAL_ERROR_RECOVERY.md "As built"). expo-updates runs the reload in the
// same queue as its update checks and downloads, so it can wait behind one — a minute on a weak signal.
// Without the cover the app stays usable meanwhile: a door opened, answers typed or a knock tapped in
// that time would be cut off by the reload. The same opaque fill as SessionGate's "Signing out…".
//
// Mounted last in app/_layout.jsx (above every other overlay; the overlays and the error banner step
// aside while it is up). A crash screen shows its own "Restarting…" instead, through useSlowRestart
// below. A React Native Modal opened by a screen (a sheet) would still paint above this.

const SLOW_MS = 10_000;
const STUCK_MS = 60_000;

// 0 → nothing to add; 1 → it's waiting on an update check; 2 → it may be stuck.
export const useSlowRestart = (pending) => {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!pending) {
      setLevel(0);
      return undefined;
    }
    const slow = setTimeout(() => setLevel(1), SLOW_MS);
    const stuck = setTimeout(() => setLevel(2), STUCK_MS);
    return () => {
      clearTimeout(slow);
      clearTimeout(stuck);
    };
  }, [pending]);
  return level;
};

export const SLOW_RESTART_TEXT = [
  null,
  'Doorline is finishing an update check first — this can take a minute on a weak signal.',
  'If Doorline doesn’t reopen, close it and open it again. Saved work is safe.',
];

const RestartCover = () => {
  const styles = useThemedStyles(makeStyles);
  const pending = useReloadPending();
  const level = useSlowRestart(pending);
  const titleRef = useRef(null);

  // Screen readers start on the title (as on the password screen). The app underneath is hidden from them
  // by app/_layout.jsx and the other overlays step aside, because on Android a screen reader's
  // double-tap reaches a view without a touch.
  useEffect(() => {
    if (!pending) return;
    const tag = findNodeHandle(titleRef.current);
    if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
  }, [pending]);

  // Android Back does nothing while it waits: it would pop screens out of sight under the cover, or leave
  // the app mid-reload.
  useEffect(() => {
    if (!pending) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [pending]);

  if (!pending) return null;
  return (
    <View style={styles.cover} accessibilityViewIsModal>
      <ActivityIndicator />
      <Text ref={titleRef} style={styles.coverText} accessibilityRole="header">
        Restarting Doorline…
      </Text>
      {level >= 1 ? <Text style={styles.hint}>{SLOW_RESTART_TEXT[1]}</Text> : null}
      {level >= 2 ? <Text style={styles.hint}>{SLOW_RESTART_TEXT[2]}</Text> : null}
    </View>
  );
};

export default RestartCover;

const makeStyles = (t) => {
  const { colors, type } = t;
  return StyleSheet.create({
    // SessionGate's cover: an opaque fill on the shared overlay layer; rendered last, so it is on top.
    cover: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
      zIndex: 1000,
      elevation: 1000,
    },
    coverText: { ...type.body, color: colors.textSecondary },
    hint: { ...type.caption, textAlign: 'center' },
  });
};
