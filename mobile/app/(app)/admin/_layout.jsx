import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, Redirect } from 'expo-router';
import {
  loadCurrentUser,
  loadMemberships,
  loadActiveOrgId,
} from '../../../lib/cache';
import { colors } from '../../../lib/theme';

export default function AdminLayout() {
  const [state, setState] = useState(undefined);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadCurrentUser(), loadMemberships(), loadActiveOrgId()]).then(
      ([user, memberships, activeOrgId]) => {
        if (!mounted) return;
        setState({ user: user || null, memberships: memberships || [], activeOrgId });
      }
    );
    return () => {
      mounted = false;
    };
  }, []);

  if (state === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const { user, memberships, activeOrgId } = state;
  if (!user) return <Redirect href="/" />;
  if (!activeOrgId) return <Redirect href="/" />;

  const isSuperAdmin = !!user.isSuperAdmin;
  const activeMembership = memberships.find((m) => m.organizationId === activeOrgId);
  const isOrgAdmin = activeMembership?.role === 'admin';

  if (!isSuperAdmin && !isOrgAdmin) {
    return <Redirect href="/" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="users" />
      <Stack.Screen name="users/[id]" />
      <Stack.Screen name="map" />
      <Stack.Screen name="canvassers" />
      <Stack.Screen name="overlaps" />
      <Stack.Screen name="campaign-assignments/[campaignId]" />
    </Stack>
  );
}
