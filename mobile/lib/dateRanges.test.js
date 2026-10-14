import { test } from 'node:test';
import assert from 'node:assert';
import { todayInTz, effectiveRange } from './dateRanges.js';

// The midnight rule: a screen left open past midnight must query the new day under "Today", not
// stretch yesterday-plus-today (docs/PROPOSAL_LEAD_CAMPAIGN_LANDING.md §E.3). Run from the REPO
// ROOT: `npm run test:mobile`.

test('todayInTz flips at the zone\'s own midnight, not the device\'s', () => {
  // 2026-10-14 04:30 UTC = 2026-10-13 23:30 in Chicago (CDT, UTC-5) = 2026-10-14 in UTC.
  const t = new Date('2026-10-14T04:30:00Z');
  assert.equal(todayInTz('America/Chicago', t), '2026-10-13');
  assert.equal(todayInTz('UTC', t), '2026-10-14');
  // Thirty-one minutes later Chicago has rolled over too.
  assert.equal(todayInTz('America/Chicago', new Date('2026-10-14T05:01:00Z')), '2026-10-14');
});

test('todayInTz with no clock still reads now (every existing caller)', () => {
  assert.match(todayInTz('America/New_York'), /^\d{4}-\d{2}-\d{2}$/);
});

test('effectiveRange pins Today to the given day', () => {
  const picked = { preset: 'today', from: '2026-10-13', to: null };
  assert.deepEqual(effectiveRange(picked, '2026-10-14'), { preset: 'today', from: '2026-10-14', to: null });
  // Same day: the very same object comes back, so effect deps and query keys don't churn.
  assert.equal(effectiveRange(picked, '2026-10-13'), picked);
});

test('effectiveRange leaves every other preset and a custom range alone', () => {
  for (const r of [
    { preset: 'yesterday', from: '2026-10-12', to: '2026-10-12' },
    { preset: '7d', from: '2026-10-07', to: null },
    { preset: 'all', from: null, to: null },
    { preset: 'custom', from: '2026-09-01', to: '2026-09-30' },
  ]) {
    assert.equal(effectiveRange(r, '2026-10-14'), r);
  }
  assert.equal(effectiveRange(undefined, '2026-10-14'), undefined);
});
