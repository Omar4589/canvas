// Coalesce rapid double-taps that would push the SAME route twice and stack two identical screens
// (common on Android, where a fast double-press fires onPress twice before the first transition
// starts). Ignores an identical router.push within IGNORE_MS of the previous one.

const IGNORE_MS = 800;
let last = { key: null, at: 0 };

function keyFor(target) {
  return typeof target === 'string' ? target : JSON.stringify(target);
}

// Drop-in replacement for router.push(target). Returns true if it navigated, false if the tap was
// swallowed as a duplicate. `now` is injectable for tests.
export function guardedPush(router, target, now = Date.now()) {
  const key = keyFor(target);
  if (key === last.key && now - last.at < IGNORE_MS) return false;
  last = { key, at: now };
  router.push(target);
  return true;
}
