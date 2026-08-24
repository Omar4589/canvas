import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickRound,
  completedInRound,
  roundMarkFromEntries,
  roundMark,
  isRestricted,
  unmarkButtonLabel,
} from './restrictMark.js';

// restrictMark.js is the ONE place the web decides "is this door Restricted this round, did the
// mark come from the desk or the door, and is a desk mark still on file after a canvasser
// out-voted it". The rules under lock: kind is 'desk' iff `via === 'bulk'` (the model enum is
// [null,'bulk']) — a missing/undefined `via` (older server) reads as FIELD so the desk never
// offers an undo it cannot honor. The round is matched EXACTLY (no newest/active guess) and the
// 'none' pseudo-round is never a match. And a SUPERSEDED desk row is still reported, because the
// server does not delete it and the per-door undo is the only way back to it.

// Entries as /activity returns them — newest first.
const E = (actionType, extra = {}) => ({ kind: 'knock', actionType, at: '2026-08-21T15:00:00Z', passId: 'p1', canvasser: 'Ada Lovelace', canvasserId: 'u1', ...extra });
const R = (passId, entries, extra = {}) => ({ passId, roundNumber: 1, name: 'Pass 1', entries, ...extra });

test('desk vs field: via "bulk" is a desk mark, anything else is a field mark', () => {
  const desk = roundMarkFromEntries([E('restricted', { via: 'bulk' })]);
  assert.equal(desk.kind, 'desk');
  assert.equal(desk.byName, 'Ada Lovelace');
  assert.equal(desk.byId, 'u1');
  assert.equal(desk.at, '2026-08-21T15:00:00Z');
  assert.equal(desk.passId, 'p1');
  assert.equal(desk.deskRows, 1);
  assert.equal(desk.superseded, false);
  assert.equal(desk.supersededBy, null);
  assert.equal(roundMarkFromEntries([E('restricted', { via: null })]).kind, 'field');
  assert.equal(roundMarkFromEntries([E('restricted', { via: 'anything-else' })]).kind, 'field');
});

test('a FIELD restricted row is never counted as a desk row — the undo could not honor it', () => {
  const field = roundMarkFromEntries([E('restricted', { via: null })]);
  assert.equal(field.kind, 'field');
  assert.equal(field.deskRows, 0);
  assert.equal(field.superseded, false);
});

test('undefined via (older server omits the field) reads as FIELD — no undo offered', () => {
  const m = roundMarkFromEntries([E('restricted')]);
  assert.equal(m.kind, 'field');
  assert.equal(m.deskRows, 0);
});

test('a missing canvasser (removed user) yields byName null, not a crash', () => {
  const m = roundMarkFromEntries([E('restricted', { via: 'bulk', canvasser: null, canvasserId: null })]);
  assert.equal(m.kind, 'desk');
  assert.equal(m.byName, null);
  assert.equal(m.byId, null);
  assert.equal(m.deskByName, null);
});

test('completion wins: a survey or lit drop anywhere in the round means not restricted', () => {
  // Newest-first: the desk mark is newer than the survey and STILL loses.
  const s = roundMarkFromEntries([E('restricted', { via: 'bulk' }), E('survey_submitted', { kind: 'survey' })]);
  assert.equal(s.kind, 'none');
  assert.equal(isRestricted(s), false);
  const l = roundMarkFromEntries([E('restricted', { via: 'bulk' }), E('lit_dropped')]);
  assert.equal(l.kind, 'none');
  assert.equal(completedInRound([E('not_home'), E('survey_submitted', { kind: 'survey' })]), true);
  assert.equal(completedInRound([E('not_home'), E('restricted')]), false);
});

test('THE OVERRIDE: a canvasser surveys a desk-marked door — status flips, the desk row stays findable', () => {
  // The scenario the whole change exists for. Newest-first: the survey is the head, the admin's
  // desk mark is older and still on file (the server's deleteMany is scoped to the canvasser's
  // own userId, so it never removed the admin's row).
  const m = roundMarkFromEntries([
    E('survey_submitted', { kind: 'survey', canvasser: 'Dana Field', canvasserId: 'u9', at: '2026-08-22T18:00:00Z' }),
    E('restricted', { via: 'bulk', canvasser: 'Omar Desk', canvasserId: 'u2' }),
  ]);
  assert.equal(m.kind, 'none', 'the door is NOT restricted any more');
  assert.equal(isRestricted(m), false);
  assert.equal(m.deskRows, 1, 'but the desk row is still on file');
  assert.equal(m.superseded, true);
  assert.equal(m.deskByName, 'Omar Desk', 'so the panel can still say who marked it');
  assert.equal(m.deskAt, '2026-08-21T15:00:00Z');
  assert.equal(m.passId, 'p1', 'and the unmark call can still name the round');
  assert.equal(m.supersededBy.actionType, 'survey_submitted');
  assert.equal(m.supersededBy.canvasser, 'Dana Field');
  assert.equal(m.supersededBy.at, '2026-08-22T18:00:00Z');
});

test('latest wins: a not_home after a restricted mark means not restricted — and is also superseded', () => {
  const m = roundMarkFromEntries([E('not_home'), E('restricted', { via: 'bulk' })]);
  assert.equal(m.kind, 'none');
  assert.equal(m.deskRows, 1);
  assert.equal(m.superseded, true);
  assert.equal(m.supersededBy.actionType, 'not_home');
  // …and the reverse order is restricted (desk), with the older not_home still on file.
  const d = roundMarkFromEntries([E('restricted', { via: 'bulk' }), E('not_home')]);
  assert.equal(d.kind, 'desk');
  assert.equal(d.superseded, false, 'a mark that still HOLDS is not superseded');
});

test('two desk rows on one round are both counted — the undo deletes rows, so the count is rows', () => {
  // Reachable: mark, canvasser knock, mark again. There is no unique index and the server
  // counts rows everywhere, so the confirm dialog and the toast reconcile.
  const m = roundMarkFromEntries([
    E('restricted', { via: 'bulk', at: '2026-08-23T10:00:00Z' }),
    E('not_home', { at: '2026-08-22T10:00:00Z' }),
    E('restricted', { via: 'bulk', at: '2026-08-21T10:00:00Z' }),
  ]);
  assert.equal(m.kind, 'desk');
  assert.equal(m.deskRows, 2);
  assert.equal(m.deskAt, '2026-08-23T10:00:00Z', 'deskAt is the NEWEST desk row');
});

test('a superseded mark keeps its own round even when the head entry carries none', () => {
  const m = roundMarkFromEntries([
    E('survey_submitted', { kind: 'survey', passId: null }),
    E('restricted', { via: 'bulk', passId: 'p7' }),
  ]);
  assert.equal(m.superseded, true);
  assert.equal(m.passId, 'p7');
});

test('empty / missing entries → the no-mark object, never null', () => {
  for (const empty of [[], undefined, null]) {
    const m = roundMarkFromEntries(empty);
    assert.equal(m.kind, 'none');
    assert.equal(m.deskRows, 0);
    assert.equal(m.superseded, false);
    assert.equal(isRestricted(m), false);
  }
  assert.equal(completedInRound(undefined), false);
});

test('isRestricted is the replacement for the old truthiness test on the return value', () => {
  assert.equal(isRestricted(roundMarkFromEntries([E('restricted', { via: 'bulk' })])), true);
  assert.equal(isRestricted(roundMarkFromEntries([E('restricted', { via: null })])), true);
  assert.equal(isRestricted(roundMarkFromEntries([E('not_home')])), false);
  assert.equal(isRestricted(roundMarkFromEntries([])), false);
  assert.equal(isRestricted(null), false);
  assert.equal(isRestricted(undefined), false);
});

test('pickRound matches the passId exactly and never falls back to newest/active', () => {
  const rounds = [
    R('p2', [E('restricted', { via: 'bulk', passId: 'p2' })], { roundNumber: 2 }),
    R('p1', [E('not_home')]),
  ];
  assert.equal(pickRound(rounds, 'p1').roundNumber, 1);
  assert.equal(pickRound(rounds, 'p2').roundNumber, 2);
  // ObjectId-ish objects compare by string form.
  assert.equal(pickRound(rounds, { toString: () => 'p2' }).roundNumber, 2);
  // A round the door was never touched in is missing — NOT the newest one.
  assert.equal(pickRound(rounds, 'p3'), null);
  assert.equal(roundMark(rounds, 'p3').kind, 'none');
});

test('the "none" pseudo-round (legacy null-pass rows) is skipped, even for an empty passId', () => {
  const rounds = [R(null, [E('restricted', { via: 'bulk', passId: null })], { name: 'Before passes', roundNumber: null })];
  assert.equal(pickRound(rounds, null), null);
  assert.equal(pickRound(rounds, ''), null);
  assert.equal(pickRound(rounds, undefined), null);
  assert.equal(roundMark(rounds, null).kind, 'none');
  assert.equal(pickRound([], 'p1'), null);
  assert.equal(pickRound(undefined, 'p1'), null);
});

test('roundMark composes: desk mark in the target round, missing round → no-mark', () => {
  const rounds = [R('p1', [E('restricted', { via: 'bulk' })])];
  assert.equal(roundMark(rounds, 'p1').kind, 'desk');
  assert.equal(roundMark(rounds, 'p9').kind, 'none');
});

test('unmarkButtonLabel words the undo the same way on every surface', () => {
  assert.equal(unmarkButtonLabel({ deskRows: 1, superseded: false }), 'Unmark restricted');
  assert.equal(unmarkButtonLabel({ deskRows: 1, superseded: true }), 'Remove desk mark');
  assert.equal(unmarkButtonLabel({ deskRows: 2, superseded: true }), 'Unmark restricted (2 desk marks)');
  assert.equal(unmarkButtonLabel({}), 'Unmark restricted');
});
