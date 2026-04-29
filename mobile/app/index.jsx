import { View, ActivityIndicator } from 'react-native';

// The root layout's auth gate handles redirection. This is just a holding
// screen while the gate decides where to send us.
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
