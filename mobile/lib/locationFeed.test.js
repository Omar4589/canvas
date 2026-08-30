import { test } from 'node:test';
import assert from 'node:assert';
import {
  acceptCoords,
  isStale,
  shouldRestart,
  MOVE_THRESHOLD_M,
  STALE_FIX_MS,
  RESTART_MIN_INTERVAL_MS,
  FEED_DISTANCE_INTERVAL_M,
} from './locationFeed.js';

// ~1 degree of longitude at the equator is ~111km; these helpers build [lng, lat]
// pairs a known number of meters apart (east-west at lat 0, so haversine is exact).
const M_PER_DEG_LNG = 111194.9; // 2*pi*R/360 for R=6371000
const east = (base, meters) => [base[0] + meters / M_PER_DEG_LNG, base[1]];
const HOME = [-84.5, 0];

// --- acceptCoords ------------------------------------------------------------

test('first fix is accepted (prev is null)', () => {
  assert.equal(acceptCoords(null, HOME), true);
});

test('sub-10m jitter holds position (list does not re-sort per step)', () => {
  assert.equal(acceptCoords(HOME, east(HOME, 3)), false);
});

test('a real move past the threshold is accepted', () => {
  assert.equal(acceptCoords(HOME, east(HOME, 25)), true);
});

test('exactly-threshold move is accepted (pins the old `< 10 -> keep` boundary)', () => {
  // The old inline guard kept prev only when d < 10, so d === 10 moved. Allow a hair of
  // float slack in the constructed distance.
  assert.equal(acceptCoords(HOME, east(HOME, MOVE_THRESHOLD_M + 0.001)), true);
});

test('malformed next is rejected outright (a bad fix can neither freeze nor move the sort anchor)', () => {
  assert.equal(acceptCoords(HOME, [NaN, NaN]), false);
  assert.equal(acceptCoords(HOME, [Infinity, 0]), false);
  assert.equal(acceptCoords(HOME, [-84.5]), false);
  assert.equal(acceptCoords(HOME, [-84.5, 0, 7]), false);
  assert.equal(acceptCoords(HOME, null), false);
  assert.equal(acceptCoords(HOME, 'nope'), false);
  // ...even as the first fix: malformed coords must never become prev.
  assert.equal(acceptCoords(null, [NaN, NaN]), false);
});

test('a NaN first-fix can no longer freeze the feed: poisoned prev + good next -> accept', () => {
  // The regression that motivated this module. The old map.jsx guard was
  // `if (prev && distanceToCoords(prev, next) < 10) return prev` — distanceToCoords
  // returns null for a poisoned prev and `null < 10` is true, so once a NaN fix became
  // prev, EVERY later good fix was rejected forever. A naive port of `d < 10` fails
  // this test; the fixed policy heals instead of freezing.
  assert.equal(acceptCoords([NaN, NaN], HOME), true);
});

// --- isStale -----------------------------------------------------------------

test('a fresh fix is not stale', () => {
  assert.equal(isStale(1000, 1000 + STALE_FIX_MS - 1), false);
});

test('silence past the staleness window is stale (fixes flow ~1s apart even standing still)', () => {
  assert.equal(isStale(1000, 1000 + STALE_FIX_MS), true);
});

test('a stream that never started is stale (null lastAliveAt is a dead stream)', () => {
  assert.equal(isStale(null, 999999), true);
});

test('a backwards clock jump reads as fresh, never a negative-gap restart storm', () => {
  // Device clock moved back: now < lastAliveAt. Must be treated as alive; a later
  // legitimate gap (measured from the same lastAliveAt) still trips.
  assert.equal(isStale(100000, 50000), false);
  assert.equal(isStale(100000, 100000 + STALE_FIX_MS), true);
});

// --- shouldRestart -----------------------------------------------------------

test('a dead stream that was never restarted restarts', () => {
  assert.equal(shouldRestart(null, null, 50000), true);
  assert.equal(shouldRestart(1000, null, 1000 + STALE_FIX_MS), true);
});

test('thrash-guard: a just-restarted feed is not restarted again', () => {
  const now = 100000;
  assert.equal(shouldRestart(null, now - 10000, now), false);
});

test('thrash-guard releases after the restart floor', () => {
  const now = 100000;
  assert.equal(shouldRestart(null, now - RESTART_MIN_INTERVAL_MS, now), true);
});

test('a healthy stream never restarts', () => {
  const now = 100000;
  assert.equal(shouldRestart(now - 1000, null, now), false);
  assert.equal(shouldRestart(now - 1000, now - RESTART_MIN_INTERVAL_MS * 2, now), false);
});

test('one giant forward clock jump yields one restart decision, not one per tick', () => {
  // Clock leaps far ahead: first tick restarts (and stamps lastRestartAt = now);
  // the next tick, 5s later with the stream still silent, is floored.
  const now = 10_000_000;
  assert.equal(shouldRestart(1000, null, now), true);
  assert.equal(shouldRestart(1000, now, now + 5000), false);
});

// --- constant relationships (load-bearing, pinned) ---------------------------

test('restart floor exceeds the staleness window (a fresh subscription gets a full window to prove itself)', () => {
  assert.ok(RESTART_MIN_INTERVAL_MS > STALE_FIX_MS);
});

test('the feed never distance-gates (stationary canvassers must keep the iOS Precise-off probe fed)', () => {
  assert.equal(FEED_DISTANCE_INTERVAL_M, 0);
});
