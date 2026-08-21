import { test } from 'node:test';
import assert from 'node:assert';
import {
  restrictCounts,
  restrictCountsFromStatusCounts,
  buildMarkPrompt,
  buildUnmarkPrompt,
  doorMarkState,
  buildMarkDoorPrompt,
  buildUnmarkDoorPrompt,
  describeMarkDoorResult,
  describeUnmarkDoorResult,
  deskMarkErrorMessage,
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

test('unmark prompt: desk marks only, field marks survive', () => {
  const p = buildUnmarkPrompt({ label: '2 books', bulkMarks: 31 });
  assert.match(p.message, /31 desk marks will be removed from 2 books/);
  assert.match(p.message, /recorded at the door are kept/);
  assert.equal(p.removeText, 'Remove');
});

// ── Single-home desk marks ─────────────────────────────────────────────────────────────
// The /activity `rounds` shape: newest round first, entries newest-first, knock entries carry
// `via` (null for field rows, 'bulk' for desk rows), survey entries carry none.

const R = (passId, entries, extra = {}) => ({ passId, roundNumber: 1, name: 'Pass 1', entries, ...extra });
const E = (actionType, extra = {}) => ({ kind: 'knock', actionType, at: '2026-08-21T15:00:00.000Z', canvasser: 'Dana Lee', canvasserId: 'u1', via: null, ...extra });

test('doorMarkState: desk vs field by via, with who/when/passId carried', () => {
  const desk = doorMarkState([R('p1', [E('restricted', { via: 'bulk', canvasser: 'Omar Z' })])], 'p1');
  assert.deepEqual(desk, { kind: 'desk', by: 'Omar Z', at: '2026-08-21T15:00:00.000Z', passId: 'p1' });
  const field = doorMarkState([R('p1', [E('restricted', { via: null })])], 'p1');
  assert.equal(field.kind, 'field');
  assert.equal(field.by, 'Dana Lee');
});

test('doorMarkState: head entry rules — a later knock or an unrelated head is none', () => {
  // Restricted, then the crew re-knocked: latest wins, the mark is superseded.
  assert.equal(doorMarkState([R('p1', [E('not_home'), E('restricted', { via: 'bulk' })])], 'p1').kind, 'none');
  assert.equal(doorMarkState([R('p1', [E('survey_submitted', { kind: 'survey', via: undefined })])], 'p1').kind, 'none');
  assert.equal(doorMarkState([R('p1', [])], 'p1').kind, 'none');
  assert.equal(doorMarkState([], 'p1').kind, 'none');
  assert.equal(doorMarkState(undefined, 'p1').kind, 'none');
});

test('doorMarkState: EXACT round only — no newest/active fallback; missing round and no passId are none', () => {
  const rounds = [
    R('p2', [E('not_home')], { roundNumber: 2 }),
    R('p1', [E('restricted', { via: 'bulk' })], { roundNumber: 1 }),
  ];
  assert.equal(doorMarkState(rounds, 'p1').kind, 'desk');
  assert.equal(doorMarkState(rounds, 'p2').kind, 'none'); // newest round is not restricted
  assert.equal(doorMarkState(rounds, 'p9').kind, 'none'); // untouched in that round → not restricted there
  assert.equal(doorMarkState(rounds, null).kind, 'none');
  assert.equal(doorMarkState(rounds, '').kind, 'none');
  // ObjectId vs string comparison is by String() on both sides.
  assert.equal(doorMarkState([R({ toString: () => 'p1' }, [E('restricted', { via: 'bulk' })])], 'p1').kind, 'desk');
});

test("doorMarkState: the 'none' pseudo-round (legacy null-pass rows) is skipped, never matched", () => {
  const rounds = [{ passId: null, roundNumber: null, name: 'Before passes', entries: [E('restricted', { via: 'bulk' })] }];
  assert.equal(doorMarkState(rounds, null).kind, 'none');
  assert.equal(doorMarkState(rounds, 'none').kind, 'none');
  assert.equal(doorMarkState(rounds, undefined).kind, 'none');
});

test("THE RULE, PINNED: kind is 'desk' iff via === 'bulk' — anything else is field (no undo the desk can't honor)", () => {
  // The model enum is [null, 'bulk'] (server models/CanvassActivity.js); an old server omits
  // `via` entirely (undefined). Only the literal 'bulk' earns a desk undo.
  for (const via of [undefined, null, 'bulk', 'anything-else']) {
    const entry = E('restricted');
    if (via === undefined) delete entry.via;
    else entry.via = via;
    const st = doorMarkState([R('p1', [entry])], 'p1');
    assert.equal(st.kind, via === 'bulk' ? 'desk' : 'field', `via=${String(via)}`);
  }
});

test('mark-door prompt: one plain confirm — no scope choice, no second confirm', () => {
  const p = buildMarkDoorPrompt({ address: '12 Elm St' });
  assert.equal(p.title, 'Mark this home restricted?');
  assert.match(p.message, /^12 Elm St gets a Restricted Access mark — canvassers see it slate/);
  assert.match(p.message, /If it was completed this round it keeps its result and nothing changes/);
  assert.match(p.message, /A desk mark, not anyone's work\. Reversible\.$/);
  assert.equal(p.confirmText, 'Mark restricted');
  assert.equal(p.buttons, undefined); // no scope buttons, no `confirm` descriptor
  assert.match(buildMarkDoorPrompt({}).message, /^This home gets/);
});

test('unmark-door prompt: names who/when, falls back to "a removed user", field marks never touched', () => {
  const p = buildUnmarkDoorPrompt({ address: '12 Elm St', markedBy: 'Omar Z', markedWhen: 'Aug 21' });
  assert.equal(p.title, 'Remove the desk mark?');
  assert.match(p.message, /marked from the desk by Omar Z · Aug 21/);
  assert.match(p.message, /Marks canvassers recorded at the door are never touched here\.$/);
  assert.equal(p.removeText, 'Remove');
  const gone = buildUnmarkDoorPrompt({ address: '12 Elm St', markedBy: null, markedWhen: null });
  assert.match(gone.message, /by a removed user\. Removing it/);
});

test('result copy: marked / already restricted / completed / ineligible / nothing', () => {
  assert.equal(describeMarkDoorResult({ marked: 1, skipped: { completed: 0, alreadyRestricted: 0, ineligible: 0, reached: 0 } }).title, 'Marked restricted');
  const already = describeMarkDoorResult({ marked: 0, skipped: { alreadyRestricted: 1 } });
  assert.equal(already.title, 'Already restricted');
  assert.match(already.message, /nothing changed/);
  const done = describeMarkDoorResult({ marked: 0, skipped: { completed: 1 } });
  assert.equal(done.title, 'Not marked');
  assert.match(done.message, /keeps its result/);
  const inel = describeMarkDoorResult({ marked: 0, skipped: { ineligible: 1 } });
  assert.equal(inel.title, 'Not marked');
  assert.match(inel.message, /Not a knockable door/);
  assert.equal(describeMarkDoorResult({ marked: 0, skipped: {} }).title, 'Nothing changed');
  assert.equal(describeMarkDoorResult(undefined).title, 'Nothing changed');
});

test('unmark result copy: rows removed vs nothing to remove (field marks stay)', () => {
  assert.match(describeUnmarkDoorResult({ unmarked: 1, households: 1 }).message, /^The desk mark is gone/);
  assert.match(describeUnmarkDoorResult({ unmarked: 2, households: 1 }).message, /^2 desk marks removed/);
  const none = describeUnmarkDoorResult({ unmarked: 0, households: 0 });
  assert.equal(none.title, 'Nothing to remove');
  assert.match(none.message, /recorded at the door stay/);
  assert.equal(describeUnmarkDoorResult(undefined).title, 'Nothing to remove');
});

test('deskMarkErrorMessage: reads e.data.code (NOT e.code — lib/api.js attaches status + data only)', () => {
  const intake = { status: 400, data: { error: 'x', code: 'PASS_REQUIRED', unresolved: [{ id: 'h1', reason: 'intake' }] } };
  assert.equal(deskMarkErrorMessage(intake), "This door isn't in a walk list yet.");
  const noRound = { status: 400, data: { error: 'x', code: 'PASS_REQUIRED', unresolved: [{ id: 'h1', reason: 'no-round' }] } };
  assert.equal(deskMarkErrorMessage(noRound), 'This walk list has no current round — open the door from its book and try again.');
  // A PASS_REQUIRED tagged only on err.code (the ORG_CONTEXT/FORBIDDEN_ROLE slot) is NOT the signal.
  const wrongSlot = Object.assign(new Error('Pick a round first'), { status: 400, code: 'PASS_REQUIRED' });
  assert.equal(deskMarkErrorMessage(wrongSlot), 'Pick a round first');
  // Older server: the route is missing → /api 404.
  assert.equal(deskMarkErrorMessage({ status: 404, data: { error: 'Not found' } }), "Your server doesn't support this yet.");
  // The route's own 404 (explicit passId not in this campaign — a deleted deep-link round) is a
  // current server speaking: never the "update your server" line.
  const passGone = Object.assign(new Error('Pass not found'), { status: 404, data: { error: 'Pass not found' } });
  assert.equal(deskMarkErrorMessage(passGone), 'Pass not found');
  assert.equal(deskMarkErrorMessage(new Error('x')), 'x');
  assert.equal(deskMarkErrorMessage({}), 'Please try again.');
  assert.equal(deskMarkErrorMessage(undefined), 'Please try again.');
});
