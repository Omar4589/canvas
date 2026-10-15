import { useEffect } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Stack, router } from 'expo-router';
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
  focusManager,
} from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { clearActiveOrgId, clearActiveCampaign, loadErrorRecoveryEnabled } from '../lib/cache';
import {
  getSessionState,
  subscribeSession,
  requireReauthIfCurrent,
  expandReauth,
  expandReauthIfStale,
  setServerSignOutNotifier,
} from '../lib/authState';
import { api, setSessionEndedHandler } from '../lib/api';
import { phoneAction, inCanvassFlow, retryUnless401, keepReauthInPlace } from '../lib/sessionEnd';
import { promptSupportAccess } from '../lib/supportAccessState';
import { refreshSession } from '../lib/session';
import { loadRoleContext } from '../lib/role';
import { ThemeProvider, useTheme } from '../lib/ThemeContext';
import { errorStore, installGlobalErrorHandler } from '../lib/errorRecovery';
import { useStagingCrash } from '../lib/stagingCrash';
import RootErrorBoundary from '../components/RootErrorBoundary';
import ErrorNotice from '../components/ErrorNotice';
import RestartCover from '../components/RestartCover';
import { useReloadPending } from '../lib/appRestart';
import { OuterFrameCrash } from '../components/CrashRestart';
import UpdateGate from '../components/UpdateGate';
import OtaUpdatePrompt from '../components/OtaUpdatePrompt';
import SessionGate, { queueSessionAction, sessionPath, useSessionCoverUp } from '../components/SessionGate';

// Bar icons must contrast the bar background: light icons on dark, dark on light.
function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

// Any org-scoped query that fails because the active-organization context is
// invalid (stale activeOrgId, or a client/server version skew that left us
// pointing at an org we can't use) gets tagged err.code === 'ORG_CONTEXT' in
// lib/api.js. Recover once, centrally: drop the stale org/campaign and bounce to
// the root, where index.jsx re-routes (super admin → /super-admin, member →
// /select-org). Without this, a bad org context dead-ends every screen on a
// Retry button that can never succeed. Guarded so we don't loop on the picker
// screens, which legitimately run before any org is chosen.
let recovering = false;
async function recoverOrgContext() {
  if (recovering) return;
  recovering = true;
  try {
    await clearActiveOrgId();
    await clearActiveCampaign();
    queryClient.clear();
    router.replace('/');
  } finally {
    // Brief debounce so a burst of failed queries triggers a single recovery.
    setTimeout(() => {
      recovering = false;
    }, 1500);
  }
}

// A role 403 (err.code === 'FORBIDDEN_ROLE') CAN mean "your role changed under you" — an
// admin demoted to canvasser while sitting on an admin screen, whose cached memberships
// still say admin. It can ALSO just mean "this screen called an endpoint above its role",
// which is a bug to fix, not a state to recover from.
//
// So we only recover when a fresh /auth/me PROVES the role actually changed. That makes this
// loop-proof: a lead hitting an admin-only endpoint gets the error surfaced as before,
// rather than an endless bounce through the root re-router.
let recoveringRole = false;
async function recoverRole() {
  if (recoveringRole) return;
  recoveringRole = true;
  try {
    const before = await loadRoleContext();
    await refreshSession({ force: true });
    const after = await loadRoleContext();
    if (before.activeMembership?.role !== after.activeMembership?.role) {
      queryClient.clear();
      router.replace('/'); // index.jsx re-derives the route from the FRESH memberships
    }
  } finally {
    setTimeout(() => {
      recoveringRole = false;
    }, 1500);
  }
}

// Route to the forced-change screen when ANY request reports the temp-password gate — an admin
// reset this user mid-session, and without this the phone just shows errors on every screen until
// a full relaunch re-runs index.jsx's boot redirect. Queued through SessionGate rather than routed
// at once: a replace() mid-survey would unmount the door screen and lose the answers. The gate
// runs it as soon as the person is off the door flow; a burst of failing queries queues it once.
const routeToForcedChange = () => queueSessionAction({ type: 'forcedChange' });

// The server said a session ended (lib/api.js reports it, for the session the answer is about).
// A sign-in that ran out → the password screen, in place: nothing on screen is lost and the phone
// keeps its saved houses. A deliberate end (password changed elsewhere, account deleted) → a full
// sign-out, queued so it never lands mid-door. See docs/PROPOSAL_SESSION_EXPIRY.md section D.
const LATER_REEXPAND_MS = 30 * 60 * 1000;
const onSessionEnded = ({ reason, token }) => {
  const { reauth } = getSessionState();
  // A password changed while the password screen is up, within half an hour of it coming up, being
  // used, or switching to ask for the new password, is the person's own "Forgot password?": ask for
  // the new one in place. A screen left untouched for longer may be on a lost phone — sign it out
  // and delete its houses (lib/sessionEnd.js keepReauthInPlace).
  if (phoneAction(reason, { reauthUp: keepReauthInPlace(reauth, Date.now()) }) === 'reauth') {
    requireReauthIfCurrent({ reason, token })
      .then(() => {
        // An answer from the server proves there is signal again: if the person tapped "Later" a
        // while ago and isn't on a door, bring the password screen back.
        if (!inCanvassFlow(sessionPath.current)) expandReauthIfStale(Date.now(), LATER_REEXPAND_MS);
      })
      .catch(() => {});
    return;
  }
  queueSessionAction({ type: 'signout', reason, token });
};
setSessionEndedHandler(onSessionEnded);

// A JavaScript error that escapes a tap, a timer or a native callback keeps the app running and shows
// the "Something went wrong" banner, instead of a gray screen on Android or a closed app on an iPhone
// (lib/errorRecovery.js, components/ErrorNotice.jsx, docs/PROPOSAL_ERROR_RECOVERY.md). The server can
// switch it off (MOBILE_ERROR_RECOVERY, read by UpdateGate); the last answer is remembered on the phone.
installGlobalErrorHandler();
loadErrorRecoveryEnabled()
  .then((enabled) => errorStore.hydrateEnabled(enabled))
  .catch(() => {});

// A manual sign-out also ends the session on the server (POST /auth/logout), so copies of the
// token stop working. Fire-and-forget and quiet: with no signal it simply never arrives.
setServerSignOutNotifier((token) => api('/auth/logout', { method: 'POST', token, quiet: true }));

// Shared by the query AND mutation caches — a revoked session can surface through either
// (a dashboard poll or a notes/assignment mutation), and both must land on the same recovery.
// Ended sessions are not handled here: lib/api.js reports them itself (onSessionEnded above), because
// several callers swallow that 401 before react-query would ever see it.
function onGlobalError(err) {
  if (err?.code === 'ORG_CONTEXT') recoverOrgContext();
  else if (err?.code === 'FORBIDDEN_ROLE') recoverRole();
  else if (err?.status === 403 && err?.data?.code === 'PASSWORD_CHANGE_REQUIRED') routeToForcedChange();
  // A customer org needs a support session. Unlike the recoveries above this does NOT eject —
  // it offers the grant sheet (components/SupportAccessGate) so the operator can state a reason
  // and go in; ejecting is what DECLINING does. No debounce flag needed: promptSupportAccess
  // ignores everything after the first, so the burst of 403s from entering an org opens one sheet.
  else if (err?.code === 'SUPPORT_ACCESS_REQUIRED') promptSupportAccess(err?.data);
}

const queryClient = new QueryClient({
  defaultOptions: {
    // One retry, as before — except a 401, which can't succeed a second later.
    queries: { retry: retryUnless401, refetchOnWindowFocus: false },
  },
  queryCache: new QueryCache({ onError: onGlobalError }),
  mutationCache: new MutationCache({ onError: onGlobalError }),
});

// Pause React Query interval polling while the app is backgrounded (battery).
// refetchIntervalInBackground defaults to false, so once focusManager knows the
// app is inactive, every interval timer (map, dashboards, activity feed) stops
// and resumes when the user returns to the app.
//
// Polls also pause while the password screen is pending: every one of them would just get the same
// 401 again. They resume the moment the password is entered.
const syncFocus = (status = AppState.currentState) => {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active' && !getSessionState().reauth);
  }
};
subscribeSession(() => syncFocus());

// A sign-out clears the error banner, and so does the next sign-in after one (an error can land on the
// sign-in screen too), so the next person never sees the previous person's error. The token is undefined
// until the session store hydrates; a string → string change is a renewal, not a new person.
let lastToken = getSessionState().token;
subscribeSession(() => {
  const { token } = getSessionState();
  const signedOut = typeof lastToken === 'string' && token === null;
  const signedIn = lastToken === null && typeof token === 'string';
  if (signedOut || signedIn) errorStore.clear();
  lastToken = token;
});

// iOS reports inactive→active for a Notification Center or Control Center pull; only a real return
// from the background brings a collapsed password screen back.
let lastAppState = AppState.currentState;

function onAppStateChange(status) {
  const fromBackground = lastAppState === 'background';
  lastAppState = status;
  syncFocus(status);
  // Coming back to the app is the natural moment to notice a role change made while we were
  // away. refreshSession throttles itself to ≤1/min, so a user flipping between apps doesn't
  // spam /auth/me, and a failure (offline) is a no-op that keeps the cached identity. It is also
  // how a used sign-in gets extended (lib/session.js).
  if (status === 'active') {
    // A password screen collapsed with "Later" comes back on the next return to the app.
    if (fromBackground) expandReauth();
    refreshSession();
  }
}

export default function RootLayout() {
  // Staging test hook (lib/stagingCrash.js): first, so the hook order never changes.
  useStagingCrash('root');
  useEffect(() => {
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, []);
  // While a full-screen session cover is up, screen readers must not walk the screen underneath.
  const coverUp = useSessionCoverUp();
  // Same while "Restarting Doorline…" covers the app (components/RestartCover.jsx): on Android a screen
  // reader's double-tap reaches a view without a touch, so the cover alone can't stop it.
  const reloadPending = useReloadPending();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ThemedStatusBar />
            <RootErrorBoundary>
              {/* collapsable={false}: one stable native view. Without it the renderer flattens this
                  wrapper away while the prop is 'auto' and re-creates it when a cover appears,
                  re-mounting the whole navigator (and the map) underneath. */}
              <View
                style={{ flex: 1 }}
                collapsable={false}
                importantForAccessibility={coverUp || reloadPending ? 'no-hide-descendants' : 'auto'}
              >
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="login" />
                  <Stack.Screen name="change-password" />
                  <Stack.Screen name="update-required" />
                  <Stack.Screen name="(app)" />
                </Stack>
              </View>
              {/* Above the whole Stack (login included): a downloaded OTA update, offered
                  politely (never auto-applied). Renders BEFORE UpdateGate so the store
                  nag's hard wall paints above this banner if both ever fire. */}
              <OtaUpdatePrompt />
              {/* Session changes, above the whole Stack: the in-place password screen, "Signing
                  out…", and the queue that keeps a sign-out or a forced password change off the
                  door flow. Before UpdateGate, so the store's hard wall still paints on top. */}
              <SessionGate />
              {/* Above the whole Stack (login included): the store-update nag/wall for
                  superseded native builds. Server-driven; fails open. */}
              <UpdateGate />
              {/* LAST, so no other root overlay hides it: the "Something went wrong" banner for an
                  error that escaped a tap or a timer. Inside the boundary, so a crash-screen
                  takeover removes it with everything else. */}
              <ErrorNotice />
              {/* On top of everything while an asked-for restart waits to happen, so nothing new can
                  start and then be cut off by the reload. */}
              <RestartCover />
            </RootErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// expo-router wraps this layout in its own boundary when it exports one (views/Try.js), which catches
// what a boundary inside RootLayout can't: RootLayout's own hooks and every provider it renders. It
// always shows its screen — by the time RootLayout can fail, the first screen has already appeared.
export const ErrorBoundary = ({ error }) => <OuterFrameCrash error={error} />;
