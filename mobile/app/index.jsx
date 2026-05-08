import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthToken, useAuthReady } from '../lib/authState';
import {
  loadActiveCampaign,
  loadCurrentUser,
  loadMemberships,
  loadActiveOrgId,
} from '../lib/cache';

export default function Index() {
  const token = useAuthToken();
  const ready = useAuthReady();
  const [boot, setBoot] = useState(undefined);

  useEffect(() => {
    let mounted = true;
    if (!ready || !token) {
      setBoot(null);
      return;
    }
    Promise.all([
      loadCurrentUser(),
      loadActiveCampaign(),
      loadMemberships(),
      loadActiveOrgId(),
    ]).then(([user, campaign, memberships, activeOrgId]) => {
      if (mounted) {
        setBoot({
          user: user || null,
          campaign: campaign || null,
          memberships: memberships || [],
          activeOrgId: activeOrgId || null,
        });
      }
    });
    return () => {
      mounted = false;
    };
  }, [ready, token]);

  if (!ready || (token && boot === undefined)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;

  const isSuperAdmin = !!boot?.user?.isSuperAdmin;

  if (!boot?.activeOrgId) {
    if (isSuperAdmin) return <Redirect href="/(app)/super-admin" />;
    return <Redirect href="/(app)/select-org" />;
  }

  const activeMembership = boot.memberships.find(
    (m) => m.organizationId === boot.activeOrgId
  );
  const role = activeMembership?.role;

  if (role === 'admin' || isSuperAdmin) {
    return <Redirect href="/(app)/admin" />;
  }
  if (!boot?.campaign) return <Redirect href="/(app)/campaigns" />;
  return <Redirect href="/(app)/map" />;
}
