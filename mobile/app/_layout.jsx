import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuthToken, useAuthReady } from '../lib/authState';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function useAuthGate() {
  const token = useAuthToken();
  const ready = useAuthReady();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!ready) return;
    const hasToken = !!token;
    const inAppGroup = segments[0] === '(app)';
    const onLogin = segments[0] === 'login';
    if (!hasToken && !onLogin) {
      router.replace('/login');
    } else if (hasToken && !inAppGroup) {
      router.replace('/(app)/map');
    }
  }, [token, ready, segments, router]);
}

function RootStack() {
  useAuthGate();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <RootStack />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
