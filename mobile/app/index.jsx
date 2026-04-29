import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthToken, useAuthReady } from '../lib/authState';

export default function Index() {
  const token = useAuthToken();
  const ready = useAuthReady();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={token ? '/(app)/map' : '/login'} />;
}
