import { Stack, Redirect } from 'expo-router';
import { useAuthToken, useAuthReady } from '../../lib/authState';

export default function AppLayout() {
  const token = useAuthToken();
  const ready = useAuthReady();

  if (!ready) return null;
  if (!token) return <Redirect href="/login" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="campaigns" />
      <Stack.Screen name="map" />
      <Stack.Screen name="household/[id]" />
      <Stack.Screen name="voter/[id]/survey" />
      <Stack.Screen name="admin" />
    </Stack>
  );
}
