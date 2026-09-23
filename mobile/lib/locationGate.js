// Pure policy for the "is Precise Location actually on?" gate (lib/location.js is the
// wiring). Split out so node's test runner can exercise the decisions without RN/expo
// imports — same pattern as locationFeed.js / deltaFold.js / bookStatusFilter.js.
//
// WHY THESE RULES ARE WORTH PINNING. Every knock carries a GPS stamp, and that stamp is
// the whole basis for verifying field work. A canvasser with Precise Location off produces
// fixes kilometres wide, which makes distance-to-door meaningless and would let a whole
// shift of unverifiable doors through. So this is a HARD gate, not a warning: a blocked tap
// records nothing at all (no pin recolor, no offline queue entry, no rollback). These
// predicates are what decide "blocked", and a regression here would fail open silently —
// the app would keep accepting coarse fixes and nothing would break loudly.

// iOS "Precise Location" off, inferred. expo-location v19 exposes no accuracyAuthorization,
// so reduced accuracy can only be read off the fix itself: reduced fixes cluster at 2–5 km
// while a genuine full-accuracy fix never approaches 1 km outdoors. Replace with the real
// API when expo-location exposes it.
export const IOS_REDUCED_ACCURACY_MIN_M = 1000;

// Android reports the grant directly, so there is nothing to infer: Android 12+ lets the
// user pick "Approximate" at the prompt, which arrives as a GRANTED permission whose
// accuracy is 'coarse'. Checking only `status === 'granted'` would wave that through — the
// trap this predicate exists to close.
export const isCoarseGrant = (resp) => resp?.android?.accuracy === 'coarse';

// The iOS heuristic. Platform is passed in rather than imported so this stays pure.
// A null accuracy is NOT treated as reduced: unknown is not the same as bad, and older
// fixes legitimately arrive without one.
export const isReducedAccuracyFix = (platformOS, accuracy) =>
  platformOS === 'ios' && accuracy != null && accuracy > IOS_REDUCED_ACCURACY_MIN_M;

// ---- The proactive probe's run detection ------------------------------------
// A canvasser should learn Precise is off BEFORE walking a block, not one blocked tap at
// a time — but a single coarse reading proves nothing: a cold GPS indoors legitimately
// returns km-wide cell/Wi-Fi fixes while GNSS warms up. So the banner needs a sustained
// RUN: enough coarse readings, spanning enough time, without a long gap that would let a
// stale run from hours ago combine with one fresh warm-up fix.
export const PRECISE_OFF_MIN_COUNT = 6;
export const PRECISE_OFF_MIN_SPAN_MS = 15 * 1000;
export const PRECISE_OFF_MAX_GAP_MS = 30 * 1000;

// Fold one reading into the run state. Returns the next state plus whether the run now
// trips the banner. `state` is { count, firstAt, lastAt }; pass EMPTY_RUN to start.
// A precise reading clears the run outright — one good fix is proof Precise is on.
export const EMPTY_RUN = { count: 0, firstAt: 0, lastAt: 0 };

export function foldCoarseRun(state, { accuracy, now }) {
  if (accuracy == null) return { state, tripped: false }; // unknown ≠ coarse
  if (accuracy <= IOS_REDUCED_ACCURACY_MIN_M) {
    return { state: EMPTY_RUN, tripped: false }; // one precise fix clears it
  }
  // A gap longer than MAX_GAP means the previous run is stale — start over rather than
  // letting this morning's coarse readings combine with one fix now.
  const stale = !state.count || now - state.lastAt > PRECISE_OFF_MAX_GAP_MS;
  const next = stale
    ? { count: 1, firstAt: now, lastAt: now }
    : { count: state.count + 1, firstAt: state.firstAt, lastAt: now };
  const tripped = next.count >= PRECISE_OFF_MIN_COUNT && now - next.firstAt >= PRECISE_OFF_MIN_SPAN_MS;
  return { state: next, tripped };
}
