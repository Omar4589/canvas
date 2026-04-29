import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { getToken } from '../lib/auth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function useAuthGate() {
  const [hasToken, setHasToken] = useState(null); // null = unknown
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    let mounted = true;
    getToken().then((t) => {
      if (mounted) setHasToken(!!t);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (hasToken === null) return;
    const inAuthGroup = segments[0] === '(app)';
    if (!hasToken && inAuthGroup) {
      router.replace('/login');
    } else if (hasToken && !inAuthGroup) {
      router.replace('/(app)/map');
    }
  }, [hasToken, segments, router]);
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
