import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthToken, useAuthReady } from '../lib/authState';
import { loadActiveCampaign, loadCurrentUser } from '../lib/cache';

export default function Index() {
  const token = useAuthToken();
  const ready = useAuthReady();
  const [boot, setBoot] = useState(undefined); // { user, campaign } | null

  useEffect(() => {
    let mounted = true;
    if (!ready || !token) {
      setBoot(null);
      return;
    }
    Promise.all([loadCurrentUser(), loadActiveCampaign()]).then(([user, campaign]) => {
      if (mounted) setBoot({ user: user || null, campaign: campaign || null });
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

  if (boot?.user?.role === 'admin') {
    return <Redirect href="/(app)/admin" />;
  }
  if (!boot?.campaign) return <Redirect href="/(app)/campaigns" />;
  return <Redirect href="/(app)/map" />;
}
