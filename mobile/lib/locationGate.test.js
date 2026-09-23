import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IOS_REDUCED_ACCURACY_MIN_M,
  PRECISE_OFF_MIN_COUNT,
  PRECISE_OFF_MIN_SPAN_MS,
  PRECISE_OFF_MAX_GAP_MS,
  EMPTY_RUN,
  isCoarseGrant,
  isReducedAccuracyFix,
  foldCoarseRun,
} from './locationGate.js';

// WHY THIS FILE EXISTS. Every knock carries a GPS stamp, and Precise Location being off
// makes that stamp kilometres wide — distance-to-door becomes meaningless and a whole
// shift of doors becomes unverifiable. The gate is therefore HARD: a blocked tap records
// nothing at all. The failure mode these tests guard is silent — if a predicate regressed,
// the app would simply start accepting coarse fixes and nothing would break loudly.

const libDir = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(libDir, f), 'utf8');

// ---- Android: the grant reports coarse directly -----------------------------

test('Android: an Approximate grant is blocked even though the permission IS granted', () => {
  // The trap: Android 12+ "Approximate" arrives as status 'granted'. Anything that checks
  // only the status waves a coarse canvasser straight through.
  const approximate = { status: 'granted', android: { accuracy: 'coarse' } };
  assert.equal(isCoarseGrant(approximate), true);
});

test('Android: a Precise grant passes', () => {
  assert.equal(isCoarseGrant({ status: 'granted', android: { accuracy: 'fine' } }), false);
});

test('isCoarseGrant never throws on the shapes a permission response can actually take', () => {
  // iOS responses carry no `android` key at all; a failed call can yield null.
  assert.equal(isCoarseGrant({ status: 'granted' }), false);
  assert.equal(isCoarseGrant({ status: 'granted', android: {} }), false);
  assert.equal(isCoarseGrant({}), false);
  assert.equal(isCoarseGrant(null), false);
  assert.equal(isCoarseGrant(undefined), false);
});

// ---- iOS: reduced accuracy is inferred from the fix -------------------------

test('iOS: a reduced-accuracy fix is blocked, a real one is not', () => {
  // Reduced fixes cluster at 2-5 km; a genuine full-accuracy fix never approaches 1 km
  // outdoors. 1000 m is the line.
  assert.equal(isReducedAccuracyFix('ios', 3000), true, 'typical Precise-off fix');
  assert.equal(isReducedAccuracyFix('ios', 2000), true);
  assert.equal(isReducedAccuracyFix('ios', 5), false, 'a good GPS fix');
  assert.equal(isReducedAccuracyFix('ios', 65), false, 'a mediocre urban fix still passes');
});

test('iOS: the threshold is exclusive, so exactly 1000 m still passes', () => {
  assert.equal(isReducedAccuracyFix('ios', IOS_REDUCED_ACCURACY_MIN_M), false);
  assert.equal(isReducedAccuracyFix('ios', IOS_REDUCED_ACCURACY_MIN_M + 0.001), true);
});

test('an unknown accuracy is NOT treated as reduced — unknown is not the same as bad', () => {
  // Older fixes legitimately arrive without an accuracy. Blocking those would refuse
  // honest knocks, which is the failure this gate must not have.
  assert.equal(isReducedAccuracyFix('ios', null), false);
  assert.equal(isReducedAccuracyFix('ios', undefined), false);
});

test('the iOS heuristic stays off Android, which reports its grant directly', () => {
  // A wide Android fix is a weak signal, not proof of an Approximate grant — Android is
  // caught by isCoarseGrant instead, and double-gating here would block basements.
  assert.equal(isReducedAccuracyFix('android', 3000), false);
});

// ---- The proactive banner's run detection -----------------------------------

const feed = (readings, start = 1_000_000) => {
  let state = EMPTY_RUN;
  let tripped = false;
  let now = start;
  for (const r of readings) {
    now += r.after ?? 0;
    const out = foldCoarseRun(state, { accuracy: r.accuracy, now });
    state = out.state;
    tripped = tripped || out.tripped;
  }
  return { state, tripped };
};

test('a sustained coarse run trips the banner', () => {
  // Six readings 3s apart: count 6 >= 6 and span 15s >= 15s, both conditions met.
  const readings = Array.from({ length: 6 }, (_, i) => ({ accuracy: 3000, after: i === 0 ? 0 : 3000 }));
  assert.equal(feed(readings).tripped, true);
});

test('a cold GPS warming up indoors does NOT trip it', () => {
  // The false positive that matters: a canvasser opening the app inside gets km-wide
  // cell/Wi-Fi fixes for a moment. Five readings is below the count floor.
  const readings = Array.from({ length: 5 }, (_, i) => ({ accuracy: 3000, after: i === 0 ? 0 : 3000 }));
  assert.equal(feed(readings).tripped, false);
});

test('enough readings but not enough elapsed time does NOT trip it', () => {
  // A 1 Hz burst reaches six readings in five seconds. The span floor is what stops a
  // fast feed from tripping on a warm-up flurry.
  const readings = Array.from({ length: 6 }, (_, i) => ({ accuracy: 3000, after: i === 0 ? 0 : 1000 }));
  const { tripped } = feed(readings);
  assert.equal(tripped, false);
  assert.ok(PRECISE_OFF_MIN_SPAN_MS > 5000, 'span floor is the thing doing the work here');
});

test('a stale run cannot combine with a fresh fix to trip it', () => {
  // Five coarse readings this morning, then one now. Without the gap rule those six
  // would trip the banner on a phone whose Precise is fine.
  const readings = [
    ...Array.from({ length: 5 }, (_, i) => ({ accuracy: 3000, after: i === 0 ? 0 : 3000 })),
    { accuracy: 3000, after: PRECISE_OFF_MAX_GAP_MS + 1 },
  ];
  const { state, tripped } = feed(readings);
  assert.equal(tripped, false);
  assert.equal(state.count, 1, 'the stale run was discarded, not extended');
});

test('one precise fix clears the run outright', () => {
  const readings = [
    ...Array.from({ length: 5 }, (_, i) => ({ accuracy: 3000, after: i === 0 ? 0 : 3000 })),
    { accuracy: 8, after: 3000 },
  ];
  const { state } = feed(readings);
  assert.deepEqual(state, EMPTY_RUN);
});

test('a precise fix mid-run means a later coarse burst must start over', () => {
  const readings = [
    ...Array.from({ length: 5 }, (_, i) => ({ accuracy: 3000, after: i === 0 ? 0 : 3000 })),
    { accuracy: 8, after: 3000 },
    ...Array.from({ length: 5 }, () => ({ accuracy: 3000, after: 3000 })),
  ];
  assert.equal(feed(readings).tripped, false, 'five after the reset is still below the floor');
});

test('an unknown accuracy leaves the run untouched rather than breaking it', () => {
  const before = feed(Array.from({ length: 3 }, (_, i) => ({ accuracy: 3000, after: i === 0 ? 0 : 3000 })));
  const after = foldCoarseRun(before.state, { accuracy: null, now: 1_100_000 });
  assert.deepEqual(after.state, before.state);
  assert.equal(after.tripped, false);
});

test('the floors are the documented ones, so a silent retune fails here', () => {
  assert.equal(IOS_REDUCED_ACCURACY_MIN_M, 1000);
  assert.equal(PRECISE_OFF_MIN_COUNT, 6);
  assert.equal(PRECISE_OFF_MIN_SPAN_MS, 15000);
  assert.equal(PRECISE_OFF_MAX_GAP_MS, 30000);
});

// ---- The invariants that live in location.js / recordAction.js --------------
// These two cannot be exercised directly (both modules import expo-location and
// react-native, and node 20 has no module mocking), so they are pinned structurally.
// A structural check is weaker than running the code, and it is here because the
// alternative is no check at all on the two rules the whole gate rests on.

test('location.js applies BOTH gates on the knock path, before any fix is used', () => {
  const src = read('location.js');
  const acquire = src.slice(src.indexOf('async function acquire('), src.indexOf('// Best-effort read'));

  // The Android grant check must sit before the first fix is requested — a coarse
  // canvasser is refused without even asking the OS where they are.
  const coarseAt = acquire.indexOf('isCoarseGrant(resp)');
  const firstFixAt = acquire.indexOf('getLastKnownPositionAsync');
  assert.ok(coarseAt > 0, 'the Android coarse-grant gate is on the knock path');
  assert.ok(firstFixAt > 0);
  assert.ok(coarseAt < firstFixAt, 'coarse grant is refused before any fix is requested');

  // Every fix that can be returned must pass the iOS heuristic. Three return paths.
  const returns = acquire.match(/return assertPrecise\(toStamp\((recent|fresh|capped)\)\)/g) || [];
  assert.equal(returns.length, 3, 'all three fix sources go through assertPrecise');
  assert.ok(
    !/return toStamp\(/.test(acquire),
    'no path returns a fix that skipped the precise check'
  );
});

test('a blocked tap records NOTHING — the gate runs before the patch and the queue', () => {
  // The excuse this closes: turn Precise off, walk a block tapping doors, let them pile
  // into the offline queue, then sync. The gate has to run before anything is written.
  const src = read('recordAction.js');
  const body = src.slice(src.indexOf('const submitPromise = (async () => {'));

  const gateAt = body.indexOf('await getCanvassLocation()');
  const patchAt = body.indexOf('optimisticPatch');
  const queueAt = body.indexOf('submitOrQueue');
  assert.ok(gateAt > 0, 'the knock path calls the location gate');
  assert.ok(patchAt > 0, 'and it patches the bootstrap cache (the visible recolor)');
  assert.ok(queueAt > 0, 'and it submits or queues the action');
  assert.ok(gateAt < patchAt, 'gate runs before the optimistic recolor');
  assert.ok(gateAt < queueAt, 'gate runs before anything reaches the offline queue');

  // The gate's failure branch must return, not fall through into the write path.
  const blocked = body.slice(gateAt, patchAt);
  assert.ok(/catch \(err\)/.test(blocked), 'a gate failure is caught');
  assert.ok(/return new Promise/.test(blocked), 'and returns instead of continuing to the write');
});

test('the gate is re-checked per knock, not cached at sign-in', () => {
  // Turning Precise off mid-shift must start blocking immediately, so the permission has
  // to be read inside the per-knock path rather than memoised at startup.
  const src = read('location.js');
  const acquire = src.slice(src.indexOf('async function acquire('), src.indexOf('// Best-effort read'));
  assert.ok(
    acquire.includes('getForegroundPermissionsAsync'),
    'permission is read inside acquire, which runs on every knock'
  );
});
