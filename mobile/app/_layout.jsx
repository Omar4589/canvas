import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
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
import { clearActiveOrgId, clearActiveCampaign } from '../lib/cache';
import { signOut } from '../lib/authState';
import { refreshSession } from '../lib/session';
import { loadRoleContext } from '../lib/role';
import { ThemeProvider, useTheme } from '../lib/ThemeContext';
import RootErrorBoundary from '../components/RootErrorBoundary';
import UpdateGate from '../components/UpdateGate';

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

// Route to the forced-change screen the moment ANY request reports the temp-password gate —
// an admin reset this user mid-session, and without this the phone just shows errors on every
// screen until a full relaunch re-runs index.jsx's boot redirect. Debounced like recoverRole:
// a burst of failing queries triggers one navigation.
let routingToChangePassword = false;
function routeToForcedChange() {
  if (routingToChangePassword) return;
  routingToChangePassword = true;
  try {
    router.replace('/change-password');
  } finally {
    setTimeout(() => {
      routingToChangePassword = false;
    }, 1500);
  }
}

// Shared by the query AND mutation caches — a revoked session can surface through either
// (a dashboard poll or a notes/assignment mutation), and both must land on the same recovery.
function onGlobalError(err) {
  if (err?.code === 'ORG_CONTEXT') recoverOrgContext();
  else if (err?.code === 'FORBIDDEN_ROLE') recoverRole();
  // The password was changed elsewhere and this session is revoked — sign out to the login
  // screen (signOut is idempotent, so several failing queries landing at once is fine).
  // Queued knocks survive: signOut clears identity caches, never the offline queue.
  else if (err?.code === 'SESSION_REVOKED') signOut();
  else if (err?.status === 403 && err?.data?.code === 'PASSWORD_CHANGE_REQUIRED') routeToForcedChange();
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
  queryCache: new QueryCache({ onError: onGlobalError }),
  mutationCache: new MutationCache({ onError: onGlobalError }),
});

// Pause React Query interval polling while the app is backgrounded (battery).
// refetchIntervalInBackground defaults to false, so once focusManager knows the
// app is inactive, every interval timer (map, dashboards, activity feed) stops
// and resumes when the user returns to the app.
function onAppStateChange(status) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
  // Coming back to the app is the natural moment to notice a role change made while we were
  // away. refreshSession throttles itself to ≤1/min, so a user flipping between apps doesn't
  // spam /auth/me, and a failure (offline) is a no-op that keeps the cached identity.
  if (status === 'active') refreshSession();
}

export default function RootLayout() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ThemedStatusBar />
            <RootErrorBoundary>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="login" />
                <Stack.Screen name="change-password" />
                <Stack.Screen name="update-required" />
                <Stack.Screen name="(app)" />
              </Stack>
              {/* Above the whole Stack (login included): the store-update nag/wall for
                  superseded native builds. Server-driven; fails open. */}
              <UpdateGate />
            </RootErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
