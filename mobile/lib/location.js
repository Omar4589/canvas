import * as Location from 'expo-location';

export async function ensureLocationPermission() {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status === 'granted') return true;
  const req = await Location.requestForegroundPermissionsAsync();
  return req.status === 'granted';
}

function toCoords(pos) {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
  };
}

export async function getCurrentLocation({ freshTimeoutMs = 6000 } = {}) {
  const granted = await ensureLocationPermission();
  if (!granted) {
    const err = new Error('Location permission denied');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  // Reuse a recent OS-level fix when one is fresh and accurate enough, so
  // back-to-back actions at the same door (knock + survey + lit-drop) don't
  // each power up the GPS radio. The requiredAccuracy gate keeps audit stamps
  // at door-level precision. (The Mapbox puck keeps location warm while the map
  // is open, so the cached fix is usually very recent and accurate.)
  const recent = await Location.getLastKnownPositionAsync({
    maxAge: 15000, // only reuse a fix from the last 15s
    requiredAccuracy: 20, // ...and only if it was accurate to ~20m or better
  });
  if (recent) return toCoords(recent);

  // No good-enough recent fix: take a fresh high-accuracy read, but cap the wait
  // so a cold/indoor GPS can't stall recording. This runs in the background after
  // the pin has already recolored, so spending a few seconds for an accurate fix
  // costs no perceived latency; if it's slow we fall back to any last-known fix,
  // then to null, rather than hanging.
  const fresh = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), freshTimeoutMs)),
  ]);
  if (fresh) return toCoords(fresh);

  const any = await Location.getLastKnownPositionAsync().catch(() => null);
  return any ? toCoords(any) : null;
}
