import { View } from 'react-native';
import { Stack, Redirect } from 'expo-router';
import { useAuthToken, useAuthReady } from '../../lib/authState';
import AddedToOrgBanner from '../../components/AddedToOrgBanner';
import { DrawerProvider } from '../../lib/DrawerContext';
import CanvasserDrawer from '../../components/CanvasserDrawer';

export default function AppLayout() {
  const token = useAuthToken();
  const ready = useAuthReady();

  if (!ready) return null;
  if (!token) return <Redirect href="/login" />;

  return (
    <DrawerProvider>
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="select-org" />
          <Stack.Screen name="campaigns" />
          <Stack.Screen name="books" />
          <Stack.Screen name="map" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="building" />
          <Stack.Screen name="household/[id]" />
          <Stack.Screen name="voter/[id]/survey" />
          <Stack.Screen name="voters/index" />
          <Stack.Screen name="voters/[id]" />
          <Stack.Screen name="admin" />
          <Stack.Screen name="super-admin" />
          <Stack.Screen name="stats" />
          <Stack.Screen name="stats/[date]" />
        </Stack>
        {/* Floats over every in-app screen so canvassers (not just web admins) are
            notified when they're added to an org. Renders nothing when there's
            nothing new. */}
        <AddedToOrgBanner />
        {/* Canvasser drawer overlay — painted last so it sits above the map and
            the bottom sheet. Inert (renders null) until a screen's header opens
            it, so it never appears on admin tab screens. */}
        <CanvasserDrawer />
      </View>
    </DrawerProvider>
  );
}
