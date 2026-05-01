import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthToken, useAuthReady } from '../lib/authState';
import { loadActiveCampaign } from '../lib/cache';

export default function Index() {
  const token = useAuthToken();
  const ready = useAuthReady();
  const [campaign, setCampaign] = useState(undefined);

  useEffect(() => {
    let mounted = true;
    if (!ready || !token) {
      setCampaign(null);
      return;
    }
    loadActiveCampaign().then((c) => {
      if (mounted) setCampaign(c || null);
    });
    return () => {
      mounted = false;
    };
  }, [ready, token]);

  if (!ready || (token && campaign === undefined)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;
  if (!campaign) return <Redirect href="/(app)/campaigns" />;
  return <Redirect href="/(app)/map" />;
}
