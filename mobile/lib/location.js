import * as Location from 'expo-location';
import { Platform } from 'react-native';

export async function ensureLocationPermission() {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status === 'granted') return true;
  const req = await Location.requestForegroundPermissionsAsync();
  return req.status === 'granted';
}

// iOS "Precise Location" off fallback heuristic: expo-location v19 exposes no
// accuracyAuthorization, so reduced accuracy can only be inferred from the fix itself —
// reduced fixes cluster at 2–5 km accuracy, while genuine full-accuracy fixes never
// approach 1 km outdoors. Replace with the real API when expo-location exposes it.
const IOS_REDUCED_ACCURACY_MIN_M = 1000;

// Reused fixes older than this can't prove where the canvasser is standing NOW — a
// stale fix stamped as current is exactly the fraud the location gate exists to stop.
const MAX_FIX_AGE_MS = 2 * 60 * 1000;

// Typed gate failures: 'SERVICES_OFF' | 'PERMISSION_DENIED' | 'PRECISE_OFF' | 'NO_FIX'.
function gateError(code, extra) {
  const e = new Error(code);
  e.code = code;
  return Object.assign(e, extra);
}

// The audit stamp. fixTimestamp is when the OS computed the fix (vs the action's own
// timestamp, the tap) — the server flags stamps much older than their tap. mocked is
// Android's isFromMockProvider (fake-GPS apps); null = unknown (iOS / older fixes).
// Deliberately passed through silently — mock detection must stay invisible in this app.
function toStamp(pos) {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
    fixTimestamp: pos.timestamp ? new Date(pos.timestamp).toISOString() : null,
    mocked: pos.mocked === undefined ? null : !!pos.mocked,
  };
}

function assertPrecise(stamp) {
  if (Platform.OS === 'ios' && stamp.accuracy != null && stamp.accuracy > IOS_REDUCED_ACCURACY_MIN_M) {
    throw gateError('PRECISE_OFF');
  }
  return stamp;
}

// --- Gate-block signal for the map banner -----------------------------------
// getCanvassLocation records why it last blocked (cleared on success) so the map's
// LocationBlockedBanner can react to tap-time failures — including iOS PRECISE_OFF,
// which the proactive probe below cannot detect.
let lastGateBlock = null;
const gateSubs = new Set();

function setGateBlock(code) {
  if (lastGateBlock === code) return;
  lastGateBlock = code;
  for (const fn of gateSubs) fn(code);
}

export function subscribeGateBlock(fn) {
  gateSubs.add(fn);
  fn(lastGateBlock);
  return () => gateSubs.delete(fn);
}

// Proactive no-GPS probe for the banner: services + permission + Android precise.
// An 'undetermined' permission returns null — the map's lazy prompt is about to fire,
// so don't nag before the OS has even asked.
export async function getLocationGateStatus() {
  const servicesOn = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!servicesOn) return 'SERVICES_OFF';
  const resp = await Location.getForegroundPermissionsAsync();
  if (resp.status === 'undetermined') return null;
  if (resp.status !== 'granted') return 'PERMISSION_DENIED';
  if (resp.android?.accuracy === 'coarse') return 'PRECISE_OFF';
  return null;
}

// Android-only: the native "turn on location" dialog. Resolves when the user enables
// services, rejects if they dismiss it.
export function promptEnableServices() {
  return Location.enableNetworkProviderAsync();
}

// THE canvassing gate — every disposition/survey stamp comes from here, and a throw
// means the action must NOT be recorded (no location = no knock). Acquisition order:
//   1. device location services on, app permission granted, precise (not coarse);
//   2. a recent OS fix (≤15s, ≤20m — the Mapbox puck keeps this warm, so the common
//      case costs ~no latency);
//   3. a fresh high-accuracy read, capped at freshTimeoutMs;
//   4. any last-known fix no older than MAX_FIX_AGE_MS — NEVER unbounded: a stale fix
//      stamped as current is indistinguishable from spoofing.
export async function getCanvassLocation({ freshTimeoutMs = 6000, maxFixAgeMs = MAX_FIX_AGE_MS } = {}) {
  try {
    const stamp = await acquire(freshTimeoutMs, maxFixAgeMs);
    setGateBlock(null);
    return stamp;
  } catch (err) {
    setGateBlock(err.code || 'NO_FIX');
    throw err;
  }
}

async function acquire(freshTimeoutMs, maxFixAgeMs) {
  // .catch(true): if the services CHECK itself fails, don't block on it — a truly
  // disabled radio still fails below at acquisition.
  const servicesOn = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!servicesOn) throw gateError('SERVICES_OFF');

  let resp = await Location.getForegroundPermissionsAsync();
  if (resp.status !== 'granted') resp = await Location.requestForegroundPermissionsAsync();
  if (resp.status !== 'granted') throw gateError('PERMISSION_DENIED', { canAskAgain: resp.canAskAgain !== false });
  if (resp.android?.accuracy === 'coarse') throw gateError('PRECISE_OFF');

  const recent = await Location.getLastKnownPositionAsync({
    maxAge: 15000, // only reuse a fix from the last 15s
    requiredAccuracy: 20, // ...and only if it was accurate to ~20m or better
  }).catch(() => null);
  if (recent) return assertPrecise(toStamp(recent));

  const fresh = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), freshTimeoutMs)),
  ]);
  if (fresh) return assertPrecise(toStamp(fresh));

  const capped = await Location.getLastKnownPositionAsync({ maxAge: maxFixAgeMs }).catch(() => null);
  if (capped) return assertPrecise(toStamp(capped));

  throw gateError('NO_FIX');
}

// Best-effort read for pin corrections (FixPinModal) — the moved coordinate comes from
// the map drag, so a missing stamp isn't a reason to block map hygiene. Same fresh-first
// strategy as the gate, and the same MAX_FIX_AGE_MS cap on the last-known fallback (a
// stale pin-drop would move the pin to where the phone WAS, not where it is).
export async function getCurrentLocation({ freshTimeoutMs = 6000, maxFixAgeMs = MAX_FIX_AGE_MS } = {}) {
  const granted = await ensureLocationPermission();
  if (!granted) {
    const err = new Error('Location permission denied');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  const recent = await Location.getLastKnownPositionAsync({
    maxAge: 15000,
    requiredAccuracy: 20,
  }).catch(() => null);
  if (recent) return toStamp(recent);

  const fresh = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), freshTimeoutMs)),
  ]);
  if (fresh) return toStamp(fresh);

  const any = await Location.getLastKnownPositionAsync({ maxAge: maxFixAgeMs }).catch(() => null);
  return any ? toStamp(any) : null;
}
