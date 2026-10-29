import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidateLifecycle, refreshAfterRefusal } from './invalidateLifecycle.js';

// What an archive, unarchive or bring back refreshes, checked against the query keys the pages
// really use: a key that matches no query refreshes nothing, silently (code review round 2 found
// Campaign Home's rollup, ['reports', 'campaign-rollup', …], missed by the ['campaign-rollup'] prefix).

const recorder = () => {
  const calls = [];
  return { calls, invalidateQueries: (filter) => calls.push(filter) };
};
// Does any recorded filter reach a query with this key? The prefix rule React Query applies, or the predicate.
const reaches = (calls, queryKey) =>
  calls.some((f) =>
    f.predicate ? f.predicate({ queryKey }) : f.queryKey.every((part, i) => JSON.stringify(part) === JSON.stringify(queryKey[i]))
  );

test('invalidateLifecycle reaches every view a lifecycle change touches', () => {
  const qc = recorder();
  invalidateLifecycle(qc, 'c1');
  for (const key of [
    ['admin', 'efforts', 'c1'],
    ['admin', 'passes', 'c1'],
    ['admin', 'passes', 'c1', 'e1'],
    ['admin', 'setup-status', 'c1'],
    ['campaign-rollup', 'c1'],
    ['reports', 'campaign-rollup', 'c1', 'all'],
    ['turfs', 'c1', 'p1'],
    ['admin', 'campaign-history', 'c1'],
  ]) {
    assert.ok(reaches(qc.calls, key), `refreshes ${JSON.stringify(key)}`);
  }
  assert.ok(!reaches(qc.calls, ['admin', 'efforts', 'c2']), "never another campaign's walk lists");
  assert.ok(!reaches(qc.calls, ['reports', 'flags', 'c1']), 'never an unrelated report');
});

test('refreshAfterRefusal refreshes only on a 409, and the campaign list too when the campaign may have changed', () => {
  const quiet = recorder();
  refreshAfterRefusal(quiet, 'c1', { status: 400, data: { code: 'survey-required' } });
  refreshAfterRefusal(quiet, 'c1', { status: 500 });
  refreshAfterRefusal(quiet, 'c1', null);
  assert.equal(quiet.calls.length, 0, 'nothing for a non-409');

  const busy = recorder();
  refreshAfterRefusal(busy, 'c1', { status: 409, data: { code: 'recut-locked', temporary: true } });
  assert.ok(reaches(busy.calls, ['admin', 'passes', 'c1']));
  assert.ok(!reaches(busy.calls, ['admin', 'campaigns']), 'a book operation says nothing about the campaign');

  for (const code of ['walk-list-archived', 'pass-archived', 'campaign-archived', 'lifecycle-busy']) {
    const stale = recorder();
    refreshAfterRefusal(stale, 'c1', { status: 409, data: { code } });
    assert.ok(reaches(stale.calls, ['admin', 'efforts', 'c1']), code);
    assert.ok(reaches(stale.calls, ['admin', 'campaigns']), `${code}: the campaign list too`);
  }
});
