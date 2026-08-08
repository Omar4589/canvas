import { test } from 'node:test';
import assert from 'node:assert';
import {
  restrictCounts,
  restrictCountsFromStatusCounts,
  buildMarkPrompt,
  buildUnmarkPrompt,
} from './restrictBooks.js';

// restrictBooks.js is the ONE place mobile's bulk-restrict prompts are decided, so this is
// where the rules get locked down. The gap under test (found in the 2026-07 web/mobile
// parity audit): the book-detail screen had its own restrict flow that sent NO scope — the
// server defaults an omitted scope to 'incomplete', which marks the crew's already-REACHED
// doors (not-home / wrong-address / refused), where web's modal defaults to 'unknocked' and
// leaves them alone. These tests pin that the safe scope is always the plain default path
// and the reached-inclusive scope always costs a second, explicit confirm.

// Run from the REPO ROOT: `npm run test:mobile`. The script deliberately lives in the root
// package.json, NOT mobile/package.json — Expo's OTA fingerprint hashes mobile/package.json
// (scripts included), so adding even a test script there re-stamps the runtime fingerprint
// and strands OTA updates (ota-check blocks the publish). The root file is outside the
// fingerprint. (--experimental-default-type=module because mobile is CommonJS-default for
// Metro; the flag scopes ESM to the test run only.)

test('restrictCounts: reached = not_home + wrong_address + refused + no_soliciting; completed/restricted excluded', () => {
  const counts = restrictCounts([
    'unknocked', 'unknocked', // 2 untouched
    'not_home', 'wrong_address', 'refused', 'no_soliciting', // 4 reached
    'surveyed', 'lit_dropped', 'restricted', // completed / already marked — in neither bucket
  ]);
  assert.deepEqual(counts, { unknocked: 2, reached: 4, incomplete: 6 });
});

test('restrictCountsFromStatusCounts sums per-book progress shapes (missing entries safe)', () => {
  const counts = restrictCountsFromStatusCounts([
    { unknocked: 10, not_home: 2, refused: 1 },
    null, // a book with no progress loaded
    { unknocked: 5, wrong_address: 3, surveyed: 99 },
  ]);
  assert.deepEqual(counts, { unknocked: 15, reached: 6, incomplete: 21 });
});

test('reached > 0: the scope choice is offered, safe option first and plain — the parity rule', () => {
  const p = buildMarkPrompt({ label: '“Book 4”', counts: { unknocked: 40, reached: 7, incomplete: 47 } });
  const scoped = p.buttons.filter((b) => b.scope);
  assert.equal(scoped.length, 2);
  // Safe scope is listed FIRST, unstyled, and needs NO second confirm.
  assert.equal(scoped[0].scope, 'unknocked');
  assert.equal(scoped[0].style, undefined);
  assert.equal(scoped[0].confirm, undefined);
  assert.match(scoped[0].text, /Only unknocked \(40\)/);
  // The reached-inclusive scope is destructive-styled and carries the second confirm.
  assert.equal(scoped[1].scope, 'incomplete');
  assert.equal(scoped[1].style, 'destructive');
  assert.ok(scoped[1].confirm, 'incomplete must require a second confirm');
  assert.match(scoped[1].confirm.message, /7 doors your crew already reached/);
  // The reached count is named up front, so the admin knows what is at stake.
  assert.match(p.message, /already reached 7 doors/);
});

test('THE GAP, PINNED: when reached > 0, no path reaches scope incomplete without a second confirm', () => {
  const p = buildMarkPrompt({ label: '“Book 4”', counts: { unknocked: 1, reached: 1, incomplete: 2 } });
  for (const b of p.buttons) {
    if (b.scope === 'incomplete') assert.ok(b.confirm, 'incomplete must never be a one-tap scope when doors were reached');
    if (b.confirm) assert.equal(b.scope, 'incomplete', 'only the reached-inclusive scope needs the extra confirm');
  }
});

test('reached === 0: single confirm sending incomplete (identical to unknocked on an untouched book)', () => {
  const p = buildMarkPrompt({ label: '3 books', counts: { unknocked: 120, reached: 0, incomplete: 120 }, totalDoors: 150 });
  const scoped = p.buttons.filter((b) => b.scope);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].scope, 'incomplete');
  assert.equal(scoped[0].confirm, undefined); // nothing reached → nothing to double-confirm
  assert.match(p.message, /~150 doors/);
});

test('every mark path carries an EXPLICIT scope — the server default is never relied on', () => {
  for (const counts of [
    { unknocked: 5, reached: 0, incomplete: 5 },
    { unknocked: 5, reached: 2, incomplete: 7 },
  ]) {
    const p = buildMarkPrompt({ label: 'x', counts });
    for (const b of p.buttons) {
      if (b.style === 'cancel') continue;
      assert.ok(b.scope === 'unknocked' || b.scope === 'incomplete', 'every actionable button names its scope');
    }
  }
});

test('unmark prompt: bulk marks only, field marks survive', () => {
  const p = buildUnmarkPrompt({ label: '2 books', bulkMarks: 31 });
  assert.match(p.message, /31 bulk marks will be removed from 2 books/);
  assert.match(p.message, /recorded at the door are kept/);
  assert.equal(p.removeText, 'Remove');
});
