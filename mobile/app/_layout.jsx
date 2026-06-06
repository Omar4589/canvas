import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { Stack, router } from 'expo-router';
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  focusManager,
} from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { clearActiveOrgId, clearActiveCampaign } from '../lib/cache';
import { ThemeProvider, useTheme } from '../lib/ThemeContext';
import RootErrorBoundary from '../components/RootErrorBoundary';

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
  queryCache: new QueryCache({
    onError: (err) => {
      if (err?.code === 'ORG_CONTEXT') recoverOrgContext();
    },
  }),
});

// Pause React Query interval polling while the app is backgrounded (battery).
// refetchIntervalInBackground defaults to false, so once focusManager knows the
// app is inactive, every interval timer (map, dashboards, activity feed) stops
// and resumes when the user returns to the app.
function onAppStateChange(status) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
}

export default function RootLayout() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
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
            </RootErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
