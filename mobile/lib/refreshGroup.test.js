import { test } from 'node:test';
import assert from 'node:assert';
import { groupNeedsRefresh, refetchEnabled } from './refreshGroup.js';

// refreshGroup.js holds the two rules useRefreshGroup relies on — when a screen's report sections are
// stale enough to refresh on return, and how to refetch them without the library's two traps.
// Run from the REPO ROOT: `npm run test:mobile` (the script lives in the root package.json on
// purpose — see campaignSelection.test.js).

const NOW = 1_000_000;
const q = (over) => ({ isEnabled: true, dataUpdatedAt: NOW - 1_000, errorUpdatedAt: 0, ...over });

test('a fresh group needs no refresh; one section past the limit does', () => {
  assert.equal(groupNeedsRefresh([q(), q()], 30_000, NOW), false);
  assert.equal(groupNeedsRefresh([q(), q({ dataUpdatedAt: NOW - 31_000 })], 30_000, NOW), true);
});

test('a disabled section never makes the group stale', () => {
  // A lit-drop campaign's survey-results query is disabled and has never fetched.
  assert.equal(groupNeedsRefresh([q(), q({ isEnabled: false, dataUpdatedAt: 0 })], 30_000, NOW), false);
});

test('a section that just failed counts from its failure, not its last success', () => {
  // Old data, fresh error: without errorUpdatedAt this would refetch the whole group on every return.
  const failing = q({ dataUpdatedAt: NOW - 600_000, errorUpdatedAt: NOW - 2_000 });
  assert.equal(groupNeedsRefresh([q(), failing], 30_000, NOW), false);
  // …and once the failure is old too, it is stale again.
  assert.equal(groupNeedsRefresh([q(), q({ dataUpdatedAt: NOW - 600_000, errorUpdatedAt: NOW - 40_000 })], 30_000, NOW), true);
});

test('a first mount (nothing fetched yet) counts as stale', () => {
  assert.equal(groupNeedsRefresh([q({ dataUpdatedAt: 0, errorUpdatedAt: 0 })], 30_000, NOW), true);
  assert.equal(groupNeedsRefresh([], 30_000, NOW), false);
  assert.equal(groupNeedsRefresh(undefined, 30_000, NOW), false);
});

test('refetchEnabled skips disabled sections and never cancels a fetch in flight', async () => {
  const calls = [];
  const mk = (name, isEnabled) => ({ isEnabled, refetch: (opts) => { calls.push([name, opts]); return Promise.resolve(); } });
  await refetchEnabled([mk('rollup', true), mk('survey', false), mk('rounds', true)]);
  assert.deepEqual(calls, [
    ['rollup', { cancelRefetch: false }],
    ['rounds', { cancelRefetch: false }],
  ]);
});
