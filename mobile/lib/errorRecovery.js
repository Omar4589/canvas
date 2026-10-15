// One owner for "a JavaScript error escaped a tap, a timer, or a native callback"
// (docs/PROPOSAL_ERROR_RECOVERY.md §B1).
//
// React Native reports such an error as FATAL. On Android that destroys the React host, and because
// expo-updates stops handling host failures ten seconds after the first screen, the phone is left on
// a flat gray screen with the app still running; on an iPhone the app closes. This module catches
// those reports in JavaScript, before anything native happens, and keeps the app running: the error
// goes to the device log as a NON-fatal report and into a small store that the in-app banner
// (components/ErrorNotice.jsx) and the crash screen (components/RootErrorBoundary.jsx) read.
//
// What it never intercepts — each keeps today's path:
//   · development builds (the red box stays);
//   · non-fatal reports (they are log lines today);
//   · anything before a screen exists to draw on (no "host" registered yet);
//   · native exceptions C++ wrapped as "Non-js exception: …" — native state is unknown, and one that
//     escaped the scheduler loop has stalled JavaScript for good (RuntimeScheduler_Modern.cpp:237,
//     :273-292), so a banner would sit over a frozen app;
//   · everything, when the server's switch is off (MOBILE_ERROR_RECOVERY=off, routes/public/buildStatus.js).
//
// Pure: no React Native imports, so `npm run test:mobile` covers all of it.

// Five intercepted errors inside three seconds is a loop (a timer throwing on every tick, a screen
// re-firing a broken callback). A person retrying a broken button can reach it too — which is why a
// takeover never happens on a door (shouldTakeOver); there the banner just counts.
export const BURST_COUNT = 5;
export const BURST_WINDOW_MS = 3_000;
export const MESSAGE_CAP = 4_000;
export const STACK_CAP = 16_000;
// What C++ wraps a native exception in (RuntimeScheduler_Modern.cpp:385, :425; ReactInstance.cpp:89).
const NATIVE_PREFIX = 'Non-js exception: ';

// Monotonic, so a wall-clock jump can't keep old errors "recent". Date.now() is for display only.
export const defaultNow = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const cap = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

// One property read or conversion, guarded: a Proxy, a throwing getter or a throwing toString yields
// the fallback instead of an exception.
const readString = (read, fallback) => {
  try {
    const value = read();
    if (value === undefined || value === null) return fallback;
    return typeof value === 'string' ? value : String(value);
  } catch {
    return fallback;
  }
};

// Any thrown value → a real Error with string name, message and stack, capped. Every property read and
// every conversion happens inside its own try; `typeof` is the only unguarded check. A value with no
// usable message becomes "Unknown error (<type>)" — never "[object Object]". Never throws: normalizing
// first is what keeps a strange value from making React Native's own reporting throw.
export const normalizeError = (value) => {
  const kind = typeof value;
  let name = 'Error';
  let message = '';
  let stack = '';
  if ((kind === 'object' || kind === 'function') && value !== null) {
    name = readString(() => value.name, 'Error') || 'Error';
    message = readString(() => value.message, '');
    stack = readString(() => value.stack, '');
  } else if (kind === 'string') {
    message = value;
  } else if (kind !== 'undefined' && value !== null) {
    message = readString(() => String(value), '');
  }
  if (!message) message = `Unknown error (${value === null ? 'null' : kind})`;
  let error;
  try {
    error = new Error(cap(message, MESSAGE_CAP));
  } catch {
    error = new Error('Unknown error');
  }
  try {
    error.name = cap(name, 200);
  } catch {
    // keep 'Error'
  }
  try {
    error.stack = cap(stack, STACK_CAP);
  } catch {
    // keep the generated stack
  }
  return error;
};

// 'forward' — hand the normalized copy to the previous handler (fatal → today's teardown on Android, a
//             crash on iOS)
// 'notice'  — keep running, show the banner
// 'escalate'— keep running, count it toward a takeover
export const decide = ({ isFatal, isDev, enabled = true, hasHost, message, recent, now }) => {
  if (isDev || !enabled || !isFatal || !hasHost || message.startsWith(NATIVE_PREFIX)) return 'forward';
  const inWindow = recent.filter((t) => now - t < BURST_WINDOW_MS).length + 1;
  return inWindow >= BURST_COUNT ? 'escalate' : 'notice';
};

// The crash screen takes over only on an escalate decided while the person is OFF a door. Nothing is
// sticky: a loop still running when they leave a door escalates again on its next tick (recent is kept,
// so one more error within three seconds of a burst on a door, once off it, counts as the same loop),
// and a burst that has stopped never takes over later.
export const shouldTakeOver = ({ decision, inDoorFlow }) => decision === 'escalate' && !inDoorFlow;

const EMPTY = Object.freeze({ count: 0, last: null, takeover: false });

// The store the banner and the crash screen read. One immutable snapshot, replaced only when something
// changed (the lib/sessionStore.js rule), so useSyncExternalStore neither loops nor misses an update.
export const createErrorStore = () => {
  let snapshot = EMPTY;
  let recent = [];
  let hosts = 0;
  let inDoorFlow = false;
  let enabled = true;
  let answered = false; // the server's switch has answered this launch
  const listeners = new Set();

  const emit = (next) => {
    if (next === snapshot) return;
    snapshot = next;
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // one listener's fault must not stop the others
      }
    }
  };

  return {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getState: () => snapshot,
    report: (error, { decision, at, wallAt }) => {
      recent = recent.filter((t) => at - t < BURST_WINDOW_MS);
      recent.push(at);
      emit({
        count: snapshot.count + 1,
        last: {
          name: String(error.name),
          message: String(error.message),
          stack: String(error.stack || ''),
          wallAt,
        },
        // Not sticky: it says whether THIS report takes over. The crash screen acts on it the moment it is
        // emitted; a leftover true would let one later error take over even a door.
        takeover: shouldTakeOver({ decision, inDoorFlow }),
      });
    },
    // Hides the banner until the next error: the in-app copy is gone (the device log keeps its own).
    dismiss: () => {
      if (!snapshot.last && snapshot.count === 0) return;
      emit({ ...snapshot, count: 0, last: null });
    },
    // After a sign-out or a Reset. Never touches the host count, the door flag or the switch.
    clear: () => {
      recent = [];
      emit(EMPTY);
    },
    setInDoorFlow: (value) => {
      inDoorFlow = !!value;
    },
    // The server's switch (MOBILE_ERROR_RECOVERY, via components/UpdateGate.jsx). Only an explicit
    // false turns recovery off.
    setEnabled: (value) => {
      answered = true;
      enabled = value !== false;
    },
    // The answer remembered from the last launch (lib/cache.js). Ignored once the server has answered
    // this launch, so a slow storage read can't undo a fresher answer.
    hydrateEnabled: (value) => {
      if (!answered) enabled = value !== false;
    },
    isEnabled: () => enabled,
    // A mounted error boundary that can draw something — the crash screen, or the app frame's own
    // screen. Returns an idempotent release.
    addHost: () => {
      hosts += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        hosts -= 1;
      };
    },
    hasHost: () => hosts > 0,
    recentTimes: () => recent.slice(),
  };
};

export const errorStore = createErrorStore();

const fallbackError = () => new Error('Unknown error');

export const createGlobalHandler = ({ previous, store, isDev, now = defaultNow }) => (value, isFatal) => {
  let error;
  try {
    error = normalizeError(value);
  } catch {
    error = fallbackError();
  }
  let decision = 'forward';
  try {
    decision = decide({
      isFatal,
      isDev,
      enabled: store.isEnabled(),
      hasHost: store.hasHost(),
      message: error.message,
      recent: store.recentTimes(),
      now: now(),
    });
  } catch {
    decision = 'forward';
  }
  if (decision === 'forward') {
    // Passes the normalized copy. Fatal: today's path, unwrapped on purpose — if React Native's own report
    // fails, its C++ fallback must still end the session. Non-fatal: guarded, because Expo's event emitter
    // calls this from a noexcept frame (expo-modules-core EventEmitter.cpp:43), where a throw aborts.
    if (isFatal) return previous?.(error, true);
    try {
      previous?.(error, false);
    } catch {
      // the log line is lost; nothing else to do
    }
    return undefined;
  }
  try {
    // The device-log line (Android logcat "ReactNative", iOS console) without the fatal teardown.
    previous?.(error, false);
  } catch {
    // the log line only
  }
  try {
    store.report(error, { decision, at: now(), wallAt: Date.now() });
  } catch {
    try {
      previous?.(error, true);
    } catch {
      // never throw from here
    }
  }
  return undefined;
};

let installed = false;

// Wraps whatever handler is installed (React Native's default, and expo-router's splash wrapper in
// either order — both pass (error, isFatal) through). Called once from app/_layout.jsx's module scope.
export const installGlobalErrorHandler = ({
  ErrorUtils = globalThis.ErrorUtils,
  isDev = typeof __DEV__ !== 'undefined' && __DEV__,
} = {}) => {
  if (installed || !ErrorUtils?.setGlobalHandler) return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler?.();
  ErrorUtils.setGlobalHandler(createGlobalHandler({ previous, store: errorStore, isDev }));
};

export const _resetForTests = () => {
  installed = false;
};
