import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, Redirect } from 'expo-router';
import { loadCurrentUser } from '../../../lib/cache';
import { colors } from '../../../lib/theme';

export default function AdminLayout() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    let mounted = true;
    loadCurrentUser().then((u) => {
      if (mounted) setUser(u || null);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (user === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!user || user.role !== 'admin') {
    return <Redirect href="/" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="users" />
      <Stack.Screen name="map" />
    </Stack>
  );
}
