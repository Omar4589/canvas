import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRound, completedInRound, roundMarkFromEntries, roundMark } from './restrictMark.js';

// restrictMark.js is the ONE place the web decides "is this door Restricted this round, and
// did the mark come from the desk or the door". The rule under lock: kind is 'desk' iff
// `via === 'bulk'` (the model enum is [null,'bulk']) — a missing/undefined `via` (older
// server) reads as FIELD so the desk never offers an undo it cannot honor. The round is
// matched EXACTLY (no newest/active guess) and the 'none' pseudo-round is never a match.

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
  assert.equal(roundMarkFromEntries([E('restricted', { via: null })]).kind, 'field');
  assert.equal(roundMarkFromEntries([E('restricted', { via: 'anything-else' })]).kind, 'field');
});

test('undefined via (older server omits the field) reads as FIELD — no undo offered', () => {
  assert.equal(roundMarkFromEntries([E('restricted')]).kind, 'field');
});

test('a missing canvasser (removed user) yields byName null, not a crash', () => {
  const m = roundMarkFromEntries([E('restricted', { via: 'bulk', canvasser: null, canvasserId: null })]);
  assert.equal(m.kind, 'desk');
  assert.equal(m.byName, null);
  assert.equal(m.byId, null);
});

test('completion wins: a survey or lit drop anywhere in the round means not restricted', () => {
  // Newest-first: the desk mark is newer than the survey and STILL loses.
  assert.equal(roundMarkFromEntries([E('restricted', { via: 'bulk' }), E('survey_submitted', { kind: 'survey' })]), null);
  assert.equal(roundMarkFromEntries([E('restricted', { via: 'bulk' }), E('lit_dropped')]), null);
  assert.equal(completedInRound([E('not_home'), E('survey_submitted', { kind: 'survey' })]), true);
  assert.equal(completedInRound([E('not_home'), E('restricted')]), false);
});

test('latest wins: a not_home after a restricted mark means not restricted any more', () => {
  assert.equal(roundMarkFromEntries([E('not_home'), E('restricted', { via: 'bulk' })]), null);
  // …and the reverse order is restricted (desk), with the older not_home still on file.
  assert.equal(roundMarkFromEntries([E('restricted', { via: 'bulk' }), E('not_home')]).kind, 'desk');
});

test('empty / missing entries → null', () => {
  assert.equal(roundMarkFromEntries([]), null);
  assert.equal(roundMarkFromEntries(undefined), null);
  assert.equal(roundMarkFromEntries(null), null);
  assert.equal(completedInRound(undefined), false);
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
  assert.equal(roundMark(rounds, 'p3'), null);
});

test('the "none" pseudo-round (legacy null-pass rows) is skipped, even for an empty passId', () => {
  const rounds = [R(null, [E('restricted', { via: 'bulk', passId: null })], { name: 'Before passes', roundNumber: null })];
  assert.equal(pickRound(rounds, null), null);
  assert.equal(pickRound(rounds, ''), null);
  assert.equal(pickRound(rounds, undefined), null);
  assert.equal(roundMark(rounds, null), null);
  assert.equal(pickRound([], 'p1'), null);
  assert.equal(pickRound(undefined, 'p1'), null);
});

test('roundMark composes: desk mark in the target round, missing round → null', () => {
  const rounds = [R('p1', [E('restricted', { via: 'bulk' })])];
  assert.equal(roundMark(rounds, 'p1').kind, 'desk');
  assert.equal(roundMark(rounds, 'p9'), null);
});
