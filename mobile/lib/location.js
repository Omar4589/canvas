import * as Location from 'expo-location';

export async function ensureLocationPermission() {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status === 'granted') return true;
  const req = await Location.requestForegroundPermissionsAsync();
  return req.status === 'granted';
}

export async function getCurrentLocation() {
  const granted = await ensureLocationPermission();
  if (!granted) {
    const err = new Error('Location permission denied');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
  };
}
