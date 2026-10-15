// The one rule for restarting the JavaScript app from inside it (docs/PROPOSAL_ERROR_RECOVERY.md §B6),
// shared by the update banner (components/OtaUpdatePrompt.jsx), the error banner
// (components/ErrorNotice.jsx) and the crash screens. Offered, never forced, and it refuses:
//   · over a door save still in flight — an action mid-POST is neither confirmed nor queued, so a
//     reload at that instant would lose the knock silently (lib/recordAction.js);
//   · over a session change still running — a password change mid-way, or a sign-out that has written
//     the null token but not yet cleared the caches (lib/sessionStore.js);
//   · on a door or in a survey — answers there are component state until Save;
//   · while the password screen is pending — its state lives only in memory, and a reload during an
//     in-place password change turns the next answer into a sign-out that deletes the saved houses.
// A crash screen (`fromCrashScreen`) skips the last two: those screens are already gone, and the only
// other way out (force-closing) loses that memory the same way.
//
// Pure: lib/appRestart.js wires the real modules; the tests inject fakes.
//
//   → 'reloading' | 'saving' | 'door' | 'password' | 'failed'
export const SETTLE_BOUND_MS = 5_000;
export const SETTLE_POLL_MS = 250;

// Monotonic where available, so a clock correction during the wait can't stretch or cut the bound.
const monotonicNow = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

export const createRestart = ({
  hasInFlightActions,
  sessionSettled, // () => the session store's current change chain (a promise)
  getSessionState, // () => { reauth, ending }
  inDoorFlow, // (path) => boolean
  reloadAsync,
  // Told when a reload has been asked for, and if it then fails. The reload can wait in expo-updates'
  // queue behind an update check or download — seconds, or a minute on a weak signal — while the app
  // stays usable, so lib/appRestart.js covers the app for that long (components/RestartCover.jsx).
  onReloadStart = () => {},
  onReloadFailed = () => {},
  // True while another caller's reload is already waiting: this one joins it instead of queueing a second.
  reloadAlreadyPending = () => false,
  now = monotonicNow,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) => {
  // Resolves true once `promise` settles, false if the deadline passes first.
  const settledBy = async (promise, deadline) => {
    let done = false;
    Promise.resolve(promise).then(
      () => {
        done = true;
      },
      () => {
        done = true;
      }
    );
    await null; // an already-settled promise's callback runs before the first check
    while (!done && now() < deadline) await sleep(SETTLE_POLL_MS);
    return done;
  };

  return async ({ getPath, fromCrashScreen = false, beforeReload } = {}) => {
    const deadline = now() + SETTLE_BOUND_MS;
    // Wait, within one bound, until no save is in flight AND the session store is idle at the same
    // moment: a door can be recorded from the map or a building while the session store is busy, and
    // more session work can be queued while a save finishes.
    for (;;) {
      while (hasInFlightActions() && now() < deadline) await sleep(SETTLE_POLL_MS);
      if (hasInFlightActions()) return 'saving';
      const chain = sessionSettled();
      if (!(await settledBy(chain, deadline))) return 'saving';
      if (sessionSettled() !== chain) {
        // More session work was queued meanwhile: wait for that too, while time remains. One poll first,
        // so a chain that keeps being replaced can't spin without ever yielding.
        if (now() >= deadline) return 'saving';
        await sleep(SETTLE_POLL_MS);
        continue;
      }
      if (!hasInFlightActions()) break;
      if (now() >= deadline) return 'saving'; // a save started during the session wait
    }
    const { reauth, ending } = getSessionState() || {};
    if (ending) return 'saving';
    // Read AFTER the wait: the person may have opened a door while it ticked.
    if (getPath && inDoorFlow(getPath())) return 'door';
    if (reauth && !fromCrashScreen) return 'password';
    // Join a reload another button already asked for — before beforeReload, so a held-back sign-out never
    // starts under a reload that could cut it (the stored, ended token brings it back after the reload).
    if (reloadAlreadyPending()) return 'reloading';
    if (beforeReload) {
      try {
        await beforeReload();
      } catch {
        // the reload still happens
      }
    }
    // The last check runs in the same synchronous step as the reload call, as the update banner always
    // did: nothing can start a save between them.
    if (hasInFlightActions()) return 'saving';
    if (reloadAlreadyPending()) return 'reloading';
    onReloadStart();
    try {
      // Resolves before the reload tears JavaScript down, so callers keep showing "Restarting…".
      await reloadAsync();
      return 'reloading';
    } catch {
      onReloadFailed();
      return 'failed';
    }
  };
};
