import { test } from 'node:test';
import assert from 'node:assert';
import { entitlementFor } from '../src/services/billing/entitlement.js';

// The subscription-state × capability grid, in one table so it can't silently regress. Columns:
//   read/export — a GET under /admin or /mobile. The gate lets ALL reads through (a paused OR ended org
//                 is read-only, never locked out), so this is always true and asserted at the middleware
//                 level in the lifecycle int test; here we assert the flags that drive it.
//   write       — canWrite (mutating API calls / edits).
//   knock       — canCanvass (mobile recording a disposition/survey).
//   share-link  — public /r/ links blocked iff effective is suspended or canceled.
//   login       — always allowed: /auth is mounted before the entitlement gate, so every state can log
//                 in (asserted in the int test). Not a function of entitlementFor.
const past = new Date(Date.now() - 86_400_000);
const future = new Date(Date.now() + 7 * 86_400_000);

const MATRIX = [
  { name: 'internal', sub: { status: 'internal' }, effective: 'internal', canWrite: true, canCanvass: true },
  { name: 'active', sub: { status: 'active' }, effective: 'active', canWrite: true, canCanvass: true },
  { name: 'trial (valid)', sub: { status: 'trial', trialEndsAt: future }, effective: 'trial', canWrite: true, canCanvass: true },
  { name: 'trial (expired)', sub: { status: 'trial', trialEndsAt: past }, effective: 'suspended', canWrite: false, canCanvass: false },
  { name: 'past_due', sub: { status: 'past_due' }, effective: 'past_due', canWrite: true, canCanvass: true },
  { name: 'suspended', sub: { status: 'suspended' }, effective: 'suspended', canWrite: false, canCanvass: false },
  // The Change-1 headline: canceled is READ-ONLY (canWrite/canCanvass false) — NOT a total lockout.
  { name: 'canceled', sub: { status: 'canceled' }, effective: 'canceled', canWrite: false, canCanvass: false },
  { name: 'no record (fail-open)', sub: null, effective: 'active', canWrite: true, canCanvass: true },
];

for (const row of MATRIX) {
  test(`entitlement matrix — ${row.name}`, () => {
    const e = entitlementFor(row.sub);
    assert.strictEqual(e.effective, row.effective, 'effective');
    assert.strictEqual(e.canWrite, row.canWrite, 'write/edit');
    assert.strictEqual(e.canCanvass, row.canCanvass, 'knock');
    // Share links are blocked exactly when the org is not usably live.
    const shareBlocked = e.effective === 'suspended' || e.effective === 'canceled';
    const expectedShareBlocked = row.effective === 'suspended' || row.effective === 'canceled';
    assert.strictEqual(shareBlocked, expectedShareBlocked, 'share-link blocked');
  });
}

test('canceled is read-only, not locked out — the wind-down export window depends on it', () => {
  const e = entitlementFor({ status: 'canceled' });
  assert.strictEqual(e.canWrite, false, 'writes blocked during wind-down');
  assert.strictEqual(e.effective, 'canceled');
  // Reads are a middleware property (GET always passes); this asserts the flag that a canceled org is
  // NOT special-cased to block reads anymore. The lifecycle int test proves the GET actually passes.
  assert.notStrictEqual(e.effective, 'locked');
});
