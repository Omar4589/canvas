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
  // Reuse a recent OS-level fix when one is fresh and accurate enough, so
  // back-to-back actions at the same door (knock + survey + lit-drop) don't
  // each power up the GPS radio. The requiredAccuracy gate keeps audit stamps
  // at door-level precision; if no good-enough recent fix exists we fall back
  // to a fresh high-accuracy read. (The Mapbox puck keeps location warm while
  // the map is open, so the cached fix is usually very recent.)
  const recent = await Location.getLastKnownPositionAsync({
    maxAge: 15000, // only reuse a fix from the last 15s
    requiredAccuracy: 20, // ...and only if it was accurate to ~20m or better
  });
  const pos =
    recent ??
    (await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    }));
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
  };
}
