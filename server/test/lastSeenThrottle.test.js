import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  shouldStampLastSeen,
  resetLastSeenThrottle,
  trackedCount,
  WINDOW_MS,
  MAX_TRACKED,
} from '../src/middleware/lastSeen.js';

// Pure decision tests — no DB, always run. The throttle guards the User.lastSeenAt write in
// requireAuth, which is on every authenticated request, so its two real jobs are: don't write more
// than once per window, and don't grow without bound.

beforeEach(() => resetLastSeenThrottle());

test('first sighting of a user stamps', () => {
  assert.strictEqual(shouldStampLastSeen('u1', 1_000), true);
});

test('repeat calls inside the same request do NOT stamp again', () => {
  // THE regression this file exists for. requireAuth runs twice on every /admin, /mobile and
  // /super-admin request (the index gate plus each sub-router's own mount) and three times on
  // nested campaign routes. All of those passes read the same stale user document, so a
  // "is the stored value old enough?" check would fire the write on every one of them.
  const now = 1_000;
  assert.strictEqual(shouldStampLastSeen('u1', now), true);
  assert.strictEqual(shouldStampLastSeen('u1', now), false);
  assert.strictEqual(shouldStampLastSeen('u1', now), false);
});

test('the window boundary is exclusive-below, inclusive-at', () => {
  assert.strictEqual(shouldStampLastSeen('u1', 0), true);
  assert.strictEqual(shouldStampLastSeen('u1', WINDOW_MS - 1), false);
  assert.strictEqual(shouldStampLastSeen('u1', WINDOW_MS), true);
});

test('one user being throttled never suppresses another', () => {
  const now = 1_000;
  assert.strictEqual(shouldStampLastSeen('u1', now), true);
  assert.strictEqual(shouldStampLastSeen('u2', now), true);
  assert.strictEqual(shouldStampLastSeen('u3', now), true);
});

test('the table is bounded and evicts least-recently-seen first', () => {
  const now = 1_000;
  for (let i = 0; i < MAX_TRACKED + 100; i += 1) {
    shouldStampLastSeen(`user-${i}`, now);
  }
  assert.strictEqual(trackedCount(), MAX_TRACKED, 'the bound actually holds');

  // The first ids in were evicted, so they stamp again (one redundant write — the intended,
  // harmless failure mode). The most recent are still tracked and stay throttled.
  assert.strictEqual(shouldStampLastSeen('user-0', now), true, 'oldest was evicted');
  assert.strictEqual(
    shouldStampLastSeen(`user-${MAX_TRACKED + 99}`, now),
    false,
    'newest was retained'
  );
});

test('re-stamping refreshes recency, so an active user is not evicted first', () => {
  // This is what the delete-then-set in shouldStampLastSeen buys. 'veteran' goes in FIRST, then
  // fills the table behind it, then is seen again — which must move it to the back of the queue.
  // With a bare Map.set() it would stay pinned at the front and be the first thing evicted below,
  // despite being the most recently active account in the table.
  shouldStampLastSeen('veteran', 0);
  for (let i = 0; i < MAX_TRACKED - 1; i += 1) {
    shouldStampLastSeen(`filler-${i}`, 0);
  }
  assert.strictEqual(trackedCount(), MAX_TRACKED, 'table is exactly full, nothing evicted yet');

  shouldStampLastSeen('veteran', WINDOW_MS); // seen again — now the newest entry

  for (let i = 0; i < 10; i += 1) {
    shouldStampLastSeen(`newcomer-${i}`, WINDOW_MS);
  }

  assert.strictEqual(trackedCount(), MAX_TRACKED);
  assert.strictEqual(
    shouldStampLastSeen('veteran', WINDOW_MS + 1),
    false,
    'a recently-seen user survives eviction'
  );
  assert.strictEqual(
    shouldStampLastSeen('filler-0', WINDOW_MS + 1),
    true,
    'the genuinely-oldest entry is the one that got evicted'
  );
});
