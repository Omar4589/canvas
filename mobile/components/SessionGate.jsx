import { useEffect, useState, useSyncExternalStore } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { usePathname, router } from 'expo-router';
import { useSessionState, endSessionIfCurrent, getCurrentToken } from '../lib/authState';
import { hasInFlightActions } from '../lib/recordAction';
import { inCanvassFlow, isFieldScreen } from '../lib/sessionEnd';
import { isReloadPending, useReloadPending } from '../lib/appRestart';
import ReauthSheet from './ReauthSheet';
import { spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// The one place that turns "the server says this session changed" into something on screen, and
// the one owner of WHEN it happens. Mounted once in app/_layout.jsx, between OtaUpdatePrompt and
// UpdateGate, so the store-update hard wall still paints above everything.
//
//   · A sign-in that ran out → the password screen (ReauthSheet), in place. It never covers a door
//     or a survey (the door flow, lib/sessionEnd.js CANVASS_FLOW): saves made there get the 401 and
//     are queued, and the screen appears once the person is back on the map or a list. After a
//     "Later" (offered only when a sign-in attempt failed for lack of signal), it collapses into a
//     notice on the map, books and building screens (ReauthNotice); every other screen keeps the
//     full screen, because those need the network anyway.
//   · A deliberate end (password changed elsewhere, account deleted) and the forced password
//     change after an admin's temporary password → queued here, and run only off the door flow,
//     after any in-flight save settles. A sign-out shows "Signing out…" while the caches clear.
//
// See docs/PROPOSAL_SESSION_EXPIRY.md section D4.

// The pending deliberate action, shared with app/_layout.jsx's module-scope handlers.
//   { type: 'signout', reason, token } | { type: 'forcedChange' }
let pending = null;
const pendingListeners = new Set();
const emitPending = () => {
  for (const fn of pendingListeners) fn(pending);
};
export const queueSessionAction = (action) => {
  if (action.type === 'forcedChange' && pending?.type === 'signout') return; // the sign-out wins
  pending = action;
  emitPending();
};

// Where the person is right now — read by the module-scope handlers, which have no hooks.
export const sessionPath = { current: null };

// For a crash screen's Restart (lib/appRestart.js, docs/PROPOSAL_ERROR_RECOVERY.md §B6). This component
// is unmounted under a crash screen, so its queue can't run there. A queued deliberate sign-out runs now
// instead — the ended token is still stored, so the next answered request would queue it again anyway;
// running it now deletes the houses now rather than whenever the phone next has signal. A queued forced
// password change is left alone: it comes back on the first request after the reload.
//
// usePendingSessionAction re-renders when an action is queued or taken, so the crash screen can say what
// its Restart will cost even for a sign-out queued after the screen came up.
const subscribePending = (fn) => {
  pendingListeners.add(fn);
  return () => {
    pendingListeners.delete(fn);
  };
};
const getPending = () => pending;
export const usePendingSessionAction = () => useSyncExternalStore(subscribePending, getPending);
export const runQueuedSessionAction = async () => {
  const next = pending;
  if (next?.type !== 'signout') return 'none';
  pending = null;
  emitPending();
  await endSessionIfCurrent({ reason: next.reason, token: next.token });
  return 'signed-out';
};

// Same bounded settle-wait as an in-app restart (lib/appRestart.js): 20 × 250 ms = 5 s worst case.
const SETTLE_TRIES = 20;
const SETTLE_INTERVAL_MS = 250;
// How often a pending action re-checks when nothing else (a path change) wakes it — an end stored
// on the map while a quick door result was in flight has no path change to wait for.
const RETRY_MS = 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const reauthCoverShown = ({ path, token, reauth }) =>
  !!reauth && typeof token === 'string' && !inCanvassFlow(path) && !(reauth.collapsed && isFieldScreen(path));

// Whether a full-screen session cover is up, so app/_layout.jsx can hide the navigator from screen
// readers while it is.
export const useSessionCoverUp = () => {
  const pathname = usePathname();
  const { token, reauth, ending } = useSessionState();
  return ending || reauthCoverShown({ path: pathname, token, reauth });
};

const SessionGate = () => {
  const pathname = usePathname();
  sessionPath.current = pathname;
  const { token, reauth, ending } = useSessionState();
  const styles = useThemedStyles(makeStyles);
  const [action, setAction] = useState(pending);
  // components/RestartCover.jsx is on top while a Restart waits; nothing here is reachable then.
  const reloadPending = useReloadPending();

  useEffect(() => {
    pendingListeners.add(setAction);
    setAction(pending);
    return () => {
      pendingListeners.delete(setAction);
    };
  }, []);

  // Run the pending action at the first safe moment: off the door flow, after in-flight saves
  // settle (bounded), and re-checked afterwards in case a door was opened during the wait. A save
  // still in flight after the wait is fine for a sign-out — it gets the 401 and is queued.
  useEffect(() => {
    if (!action) return undefined;
    let cancelled = false;
    let running = false;
    const attempt = async () => {
      // Not while a Restart waits to happen (lib/appRestart.js): the reload could cut a sign-out between
      // forgetting the token and deleting the houses. After the reload the ended token brings it back.
      if (cancelled || running || inCanvassFlow(sessionPath.current) || isReloadPending()) return;
      running = true;
      try {
        for (let tries = 0; tries < SETTLE_TRIES && hasInFlightActions(); tries += 1) {
          await sleep(SETTLE_INTERVAL_MS);
          if (cancelled) return;
        }
        // Again after the wait: a Restart may have been asked for meanwhile. No await between this check
        // and the sign-out taking the session lock, so the two can't overlap.
        if (cancelled || inCanvassFlow(sessionPath.current) || isReloadPending()) return;
        const next = pending;
        if (!next) return;
        pending = null;
        emitPending();
        if (next.type === 'signout') {
          // A no-op if that session is no longer the one held (lib/sessionStore.js).
          await endSessionIfCurrent({ reason: next.reason, token: next.token }).catch(() => {});
        } else if (
          next.type === 'forcedChange' &&
          typeof getCurrentToken() === 'string' &&
          sessionPath.current !== '/change-password'
        ) {
          router.replace('/change-password');
        }
      } finally {
        running = false;
      }
    };
    attempt();
    const timer = setInterval(attempt, RETRY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [action, pathname]);

  if (reloadPending) return null;
  if (ending) {
    return (
      <View style={styles.cover} accessibilityViewIsModal>
        <ActivityIndicator />
        <Text style={styles.coverText} accessibilityRole="header">
          Signing out…
        </Text>
      </View>
    );
  }
  if (reauthCoverShown({ path: pathname, token, reauth })) {
    return <ReauthSheet reauth={reauth} path={pathname} />;
  }
  return null;
};

export default SessionGate;

const makeStyles = (t) => {
  const { colors, type } = t;
  return StyleSheet.create({
    // An opaque fill like UpdateGate's hard wall. Same layer (zIndex/elevation 1000), rendered
    // before UpdateGate, so the store-update wall still paints above it.
    cover: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      zIndex: 1000,
      elevation: 1000,
    },
    coverText: { ...type.body, color: colors.textSecondary },
  });
};
