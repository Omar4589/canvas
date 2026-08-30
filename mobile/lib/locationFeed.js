// Pure policy for the canvasser map's GPS feed (lib/useLocationFeed.js is the wiring).
// Split out so node's test runner can exercise the decisions without RN/expo imports —
// same pattern as deltaFold.js / bookStatusFilter.js.
//
// Background: the blue dot used to be the JS-drawn <Mapbox.UserLocation>, whose onUpdate
// stream both fed the list's "nearest to me" sort and could silently die on Android
// (rnmapbox #3965 — a canvasser's dot froze a block behind her). The dot is now the
// engine-rendered <Mapbox.LocationPuck> (can't freeze from JS), and this feed exists only
// for the JS consumers — so its worst failure is a stale list sort, never a lying dot.

// Explicit .js extension: node's test runner resolves this as real ESM (Metro is fine
// with it too) — the first lib module under test that imports a sibling.
import { distanceToCoords } from './geo.js';

// ---- Feed cadence -----------------------------------------------------------
// distanceInterval 0 + timeInterval 1000 is LOAD-BEARING, not a tuning choice: the iOS
// Precise-off probe (lib/location.js reportFixAccuracy) needs 6 coarse fixes spanning
// >=15s with <=30s gaps — a distance-gated feed goes silent the moment the canvasser
// stands still and the probe could never trip.
export const FEED_TIME_INTERVAL_MS = 1000; // Android-only min cadence (iOS ignores it; streams ~1Hz at High)
export const FEED_DISTANCE_INTERVAL_M = 0; // deliver even when stationary

// The list re-sort hysteresis, moved verbatim from map.jsx's old inline `< 10`.
export const MOVE_THRESHOLD_M = 10;

// ---- Watchdog ---------------------------------------------------------------
// Fixes arrive ~1s apart even when stationary (see above), so 15s of silence while the
// app is ACTIVE genuinely means a dead stream, not a still canvasser.
export const STALE_FIX_MS = 15 * 1000;
// Restart floor > staleness window: a fresh subscription gets a full staleness window to
// prove itself before it can be declared dead again — no thrash. Also floors the retry
// cadence when watchPositionAsync itself rejects (services off).
export const RESTART_MIN_INTERVAL_MS = 30 * 1000;
export const WATCHDOG_TICK_MS = 5 * 1000; // check cadence; cheap, coarse is fine

// Should `next` replace the current userCoords? Replaces map.jsx's old
// `distanceToCoords(prev, next) < 10` guard, which had a freeze trap: distanceToCoords
// returns null on malformed input and `null < 10` is true — so if a NaN fix ever became
// the FIRST userCoords, every later good fix was rejected forever. Rules:
//   - malformed next ([NaN,...], wrong shape): never accept — don't poison state;
//   - no prev yet: accept (first fix);
//   - unmeasurable distance (prev is poisoned): accept — heal, don't freeze;
//   - otherwise accept only a real >= MOVE_THRESHOLD_M move.
// (Boundary preserved from the old code: `d < 10 → keep prev` accepted d === 10.)
export const acceptCoords = (prev, next) => {
  if (!Array.isArray(next) || next.length !== 2 || !next.every(Number.isFinite)) return false;
  if (prev == null) return true;
  const d = distanceToCoords(prev, next);
  if (d == null) return true;
  return d >= MOVE_THRESHOLD_M;
};

// Is the stream dead? lastAliveAt = the later of (subscribe success, last delivered fix).
// null means no subscription ever succeeded — that IS a dead stream (the hook gates the
// watchdog off entirely until permission is granted, so null-is-stale can't spin before
// the first start attempt). A backwards clock jump (now < lastAliveAt) reads as fresh —
// never a negative-gap restart storm; a later legitimate gap still trips.
export const isStale = (lastAliveAt, now) =>
  lastAliveAt == null || now - lastAliveAt >= STALE_FIX_MS;

// The watchdog decision: dead stream AND we haven't just tried. lastRestartAt is stamped
// at every ATTEMPT (success or reject), so one giant clock jump yields one restart
// decision — not one per tick — and a rejecting subscribe retries at most every
// RESTART_MIN_INTERVAL_MS.
export const shouldRestart = (lastAliveAt, lastRestartAt, now) =>
  isStale(lastAliveAt, now) &&
  (lastRestartAt == null || now - lastRestartAt >= RESTART_MIN_INTERVAL_MS);
