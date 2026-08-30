import * as Location from 'expo-location';
import { Platform } from 'react-native';

// Concurrent calls share ONE in-flight request. On a cold `undetermined` start the
// map's initial-camera helper and the location feed both land here in the same tick,
// and expo-modules-core's Android permissions service THROWS on an overlapping second
// request ("Another permissions request is in progress") — an unhandled rejection that
// also silently killed the smart-hybrid camera framing. Serializing every caller
// (banner included) through one promise makes the overlap impossible.
let permissionInFlight = null;
export function ensureLocationPermission() {
  if (permissionInFlight) return permissionInFlight;
  permissionInFlight = (async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') return true;
      const req = await Location.requestForegroundPermissionsAsync();
      return req.status === 'granted';
    } finally {
      permissionInFlight = null;
    }
  })();
  return permissionInFlight;
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

// Proactive iOS Precise-off probe. expo-location v19 exposes no accuracyAuthorization,
// so on iOS reduced accuracy is invisible to getLocationGateStatus above — a canvasser
// with Precise Location off only found out one blocked tap at a time. The map's
// location feed (useLocationFeed) streams its fixes here: a sustained run of coarse
// readings lights the same PRECISE_OFF banner the tap-time gate would (deep-indoor
// GNSS-less fixes trip the tap gate's identical >1km heuristic, so probe and gate
// always agree), BEFORE the first wasted knock — and one precise fix clears it.
// Hysteresis is load-bearing, in both count and TIME: the first fixes after a cold
// start can legitimately be km-coarse cell/Wi-Fi fixes while GNSS warms, and a
// stale run of coarse readings from hours ago must not combine with one warm-up
// fix to trip it — so readings only count within a rolling window, and the run
// must span real seconds.
// iOS-only: Android's permission API reports coarse directly.
const PRECISE_OFF_MIN_COUNT = 6;
const PRECISE_OFF_MIN_SPAN_MS = 15 * 1000;
const PRECISE_OFF_MAX_GAP_MS = 30 * 1000;
let coarseCount = 0;
let coarseFirstAt = 0;
let coarseLastAt = 0;

export const reportFixAccuracy = (accuracy) => {
  if (Platform.OS !== 'ios' || accuracy == null) return;
  const now = Date.now();
  if (accuracy > IOS_REDUCED_ACCURACY_MIN_M) {
    if (!coarseCount || now - coarseLastAt > PRECISE_OFF_MAX_GAP_MS) {
      coarseCount = 0;
      coarseFirstAt = now;
    }
    coarseCount += 1;
    coarseLastAt = now;
    // setGateBlock dedups identical codes, and a coarse stream can't co-occur with
    // the blocks that gate fixes off entirely (services off / permission denied) —
    // no fixes reach the feed in those states — so no guard on the current code.
    if (coarseCount >= PRECISE_OFF_MIN_COUNT && now - coarseFirstAt >= PRECISE_OFF_MIN_SPAN_MS) {
      setGateBlock('PRECISE_OFF');
    }
  } else {
    coarseCount = 0;
    // Only clear what this probe (or a coarse tap-time fix) set — a precise fix
    // is proof the Precise toggle is on again.
    if (lastGateBlock === 'PRECISE_OFF') setGateBlock(null);
  }
};

// THE canvassing gate — every disposition/survey stamp comes from here, and a throw
// means the action must NOT be recorded (no location = no knock). Acquisition order:
//   1. device location services on, app permission granted, precise (not coarse);
//   2. a recent OS fix (≤15s, ≤20m — the map's location feed keeps this warm, so the common
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
