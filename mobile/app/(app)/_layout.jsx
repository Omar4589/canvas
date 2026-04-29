import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="map" />
      <Stack.Screen name="household/[id]" />
      <Stack.Screen name="voter/[id]/survey" />
    </Stack>
  );
}
