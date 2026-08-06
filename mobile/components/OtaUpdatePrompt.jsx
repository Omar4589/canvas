import { useEffect, useRef, useState } from 'react';
import { AppState, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';
import { hasInFlightActions } from '../lib/recordAction';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Offers a downloaded OTA update instead of letting it wait for a cold start. expo-updates'
// default is download-in-background, apply on the NEXT cold start — and field phones almost
// never cold start, so a published fix can sit unused on a device for days.
//
// This closes that gap the polite way: check + download on launch and on every foreground,
// then OFFER a restart, never force one. `reloadAsync()` destroys all in-memory state, and a
// canvasser can be mid-survey — answers are plain component state until Save. Hence:
//   · the banner never renders on the canvass-flow screens (/household/*, /voter/*) — the
//     download still happens there; the offer just waits for a list or map screen;
//   · Restart waits (bounded) for any in-flight door POST to settle, and REFUSES to reload
//     while one is still unsettled — an action mid-POST is neither confirmed nor queued
//     (the offline queue only enqueues after a FAILED submit, up to the 20 s API timeout
//     later), so a reload at that instant would lose the knock silently. Same refusal if a
//     canvass screen was opened during the wait; either way the banner just re-offers;
//   · Later dismisses THIS update for the session, keyed by updateId — it applies on the
//     next cold start anyway, and only a newer publish re-arms the banner.
//
// Mounted once in app/_layout.jsx BEFORE UpdateGate, so the store nag's hard wall paints
// above this banner if both ever fire. Same soft-banner shell as UpdateGate and
// AddedToOrgBanner, so the three top-of-screen notices read as one family.
//
// FAILS QUIET, ALWAYS: dev (no real channel), a failed check, a failed download — all render
// nothing. A missed update offer is not the canvasser's problem; the app runs fine on the
// bundle it already has.
const CANVASS_FLOW = /^\/(household|voter)\//;

// Bounded settle-wait before reloading: 20 × 250 ms = 5 s worst case.
const SETTLE_TRIES = 20;
const SETTLE_INTERVAL_MS = 250;

const OtaUpdatePrompt = () => {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const pathname = usePathname();
  // Mirrored into a ref so restart(), armed seconds earlier, can see where the user is
  // NOW — the closure's own pathname is frozen at tap time.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  // Reactive expo-updates state: isUpdatePending flips true once a download completes —
  // by the fetch below, or by the native check-on-launch on its own. It is NOT proof a
  // bundle arrived (see the render gate), which is why downloadedUpdate matters too.
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const [dismissedId, setDismissedId] = useState(null);
  const [restarting, setRestarting] = useState(false);
  const checking = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return undefined;

    let cancelled = false;

    const check = async () => {
      if (checking.current) return; // two quick foregrounds collapse to one check
      checking.current = true;
      try {
        // A roll-back-to-embedded directive reports isAvailable:false with
        // isRollBackToEmbedded:true — fetch that too, or an emergency rollback would
        // only ever land via a cold start, the exact gap this component closes.
        const { isAvailable, isRollBackToEmbedded } = await Updates.checkForUpdateAsync();
        if ((!isAvailable && !isRollBackToEmbedded) || cancelled) return;
        await Updates.fetchUpdateAsync(); // useUpdates() flips isUpdatePending when done
      } catch (err) {
        // Never surfaced — see the fail-quiet contract above.
        console.log('OTA check failed:', err?.message);
      } finally {
        checking.current = false;
      }
    };

    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // A pending rollback-to-embedded has no manifest, hence the 'pending' fallback key.
  const readyId = downloadedUpdate?.updateId || 'pending';

  const restart = async () => {
    if (restarting) return;
    setRestarting(true);
    for (let tries = 0; tries < SETTLE_TRIES && hasInFlightActions(); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_INTERVAL_MS));
    }
    // Never reload over anything unsettled. A weak-signal POST can outlive the wait
    // (the API timeout is 20 s, and only a FAILED submit enqueues), and the canvasser
    // may have opened a door screen while the wait ticked. Bail instead: isUpdatePending
    // stays true, so the banner simply re-offers at the next safe moment.
    if (hasInFlightActions() || CANVASS_FLOW.test(pathnameRef.current || '')) {
      setRestarting(false);
      return;
    }
    Updates.reloadAsync().catch(() => setRestarting(false));
  };

  // downloadedUpdate as well as isUpdatePending: a FAILED fetch can leave isUpdatePending
  // true with nothing downloaded (the native reducer never clears it short of a restart),
  // and offering a reload into the same bundle would be pointless state destruction. A
  // pending rollback still shows — useUpdates() synthesizes downloadedUpdate for it, with
  // updateId undefined (hence readyId's 'pending' fallback).
  if (!isUpdatePending || !downloadedUpdate || dismissedId === readyId) return null;
  if (CANVASS_FLOW.test(pathname || '')) return null;

  return (
    <View style={[styles.overlay, { paddingTop: insets.top + spacing.xs }]} pointerEvents="box-none">
      <View style={styles.banner}>
        <Text style={styles.text}>A new version of Doorline is ready.</Text>
        <Pressable
          onPress={restart}
          hitSlop={8}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={styles.actionText}>{restarting ? 'Restarting…' : 'Restart'}</Text>
        </Pressable>
        <Pressable
          onPress={() => setDismissedId(readyId)}
          hitSlop={8}
          style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Text style={styles.dismissText}>Later</Text>
        </Pressable>
      </View>
    </View>
  );
};

export default OtaUpdatePrompt;

const makeStyles = (t) => {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    // Same shell as UpdateGate's soft banner / AddedToOrgBanner.
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingHorizontal: spacing.md,
      zIndex: 1000,
      elevation: 1000,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      backgroundColor: colors.brandTint,
      borderWidth: 1,
      borderColor: colors.brand,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      ...shadow.card,
    },
    text: { ...type.caption, color: colors.brandDark, flex: 1 },
    action: {
      backgroundColor: colors.brand,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    actionText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },
    dismiss: {
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
    },
    dismissText: { ...type.caption, color: colors.brand, fontWeight: '700' },
  });
};
