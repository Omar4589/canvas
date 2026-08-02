import { test } from 'node:test';
import assert from 'node:assert';
import {
  KIND_TABS,
  badgesFor,
  summaryFor,
  deletableResponses,
  buildDeletePrompt,
  deleteErrorMessage,
} from './duplicateSurveys.js';

// duplicateSurveys.js holds the Duplicate surveys screen's decisions, and this is where they get
// locked down — mobile has no component-test harness, so the screen itself is unpinnable and
// anything that matters has to live here. Two things are worth the file on their own:
//
//   1. BOTH badges must render when both flags are true. The web page shipped with a precedence
//      rule that hid "Different canvassers" behind "Same canvasser · same day", so a card with a
//      same-day repeat AND a third canvasser looked like a plain double-tap. That was a real bug,
//      fixed in the same batch; this test is what stops the mobile twin from reintroducing it.
//   2. The delete confirm's factual claim. It tells the operator the knock survives and only the
//      Surveys total moves — true because the server bumps stats.surveyCount alone and leaves the
//      survey_submitted CanvassActivity row alone (pinned server-side by campaignStats.int.test.js,
//      'admin survey delete decrements surveyCount only'). If that ever changes, this copy is a lie.
//
// Run from the REPO ROOT: `npm run test:mobile`. The script deliberately lives in the root
// package.json, NOT mobile/package.json — Expo's OTA fingerprint hashes mobile/package.json
// (scripts included), so adding even a test script there re-stamps the runtime fingerprint and
// strands OTA updates.

const chad = { userId: 'u1', firstName: 'Chadwick', lastName: 'Kluttz', email: 'chad@t.co' };
const chris = { userId: 'u2', firstName: 'Christopher', lastName: 'Price', email: 'chris@t.co' };

const dupe = (over = {}) => ({
  voterId: 'v1',
  count: 2,
  voter: { id: 'v1', fullName: 'Kenneth Halloway', party: 'DEM' },
  household: { addressLine1: '10037 Highland Loop', city: 'Zephyrhills', state: 'FL' },
  responses: [
    { responseId: 'r1', submittedAt: '2026-07-21T15:10:00Z', canvasser: chad, roundLabel: 'Pass 1 · Round 1' },
    { responseId: 'r2', submittedAt: '2026-07-21T20:40:00Z', canvasser: chad, roundLabel: 'Pass 2 · Round 2' },
  ],
  sameCanvasserSameDay: true,
  differentCanvassers: false,
  ...over,
});

test('badgesFor: BOTH flag badges render when both are true — the precedence bug', () => {
  const both = dupe({
    count: 3,
    differentCanvassers: true,
    responses: [...dupe().responses, { responseId: 'r3', canvasser: chris, roundLabel: 'Pass 3 · Round 3' }],
  });
  const tones = badgesFor(both).map((b) => b.tone);
  assert.deepEqual(tones, ['neutral', 'danger', 'info'], 'count, same-day AND different-canvassers');
  assert.equal(badgesFor(both)[0].text, '3× surveyed');
});

test('badgesFor: a legitimate cross-round revisit shows only the different-canvassers badge', () => {
  const revisit = dupe({ sameCanvasserSameDay: false, differentCanvassers: true });
  assert.deepEqual(badgesFor(revisit).map((b) => b.key), ['count', 'different']);
});

test('badgesFor: same canvasser on DIFFERENT days carries neither flag — count only', () => {
  const neither = dupe({ sameCanvasserSameDay: false, differentCanvassers: false });
  assert.deepEqual(badgesFor(neither).map((b) => b.key), ['count']);
});

test('summaryFor counts distinct canvassers and rounds, not responses', () => {
  const three = dupe({
    count: 3,
    responses: [
      { responseId: 'r1', canvasser: chad, roundLabel: 'Pass 1 · Round 1' },
      { responseId: 'r2', canvasser: chad, roundLabel: 'Pass 2 · Round 2' },
      { responseId: 'r3', canvasser: chris, roundLabel: 'Pass 2 · Round 2' },
    ],
  });
  assert.equal(summaryFor(three), '2 canvassers · 2 rounds');
  assert.equal(summaryFor(dupe()), '1 canvasser · 2 rounds', 'singular reads right');
});

test('every response is deletable — the report never designates an authoritative one', () => {
  assert.equal(deletableResponses(dupe()).length, 2);
});

test('buildDeletePrompt names the canvasser, voter, round and time — you must know WHICH goes', () => {
  const p = buildDeletePrompt({
    dupe: dupe(),
    response: dupe().responses[1],
    formatTime: () => 'Jul 21, 4:40 PM EDT',
  });
  assert.equal(p.title, "Delete Chadwick Kluttz's response?");
  assert.match(p.message, /Kenneth Halloway/);
  assert.match(p.message, /Pass 2 · Round 2/);
  assert.match(p.message, /Jul 21, 4:40 PM EDT/);
  assert.equal(p.confirmText, 'Delete response');
});

test('buildDeletePrompt states what is lost AND what survives (the server only moves surveyCount)', () => {
  const p = buildDeletePrompt({ dupe: dupe(), response: dupe().responses[0], formatTime: () => 'x' });
  assert.match(p.message, /erased permanently/);
  assert.match(p.message, /no undo/);
  assert.match(p.message, /knock itself stays/);
  assert.match(p.message, /still reads surveyed/);
  assert.match(p.message, /Surveys total drops by one/);
});

test('buildDeletePrompt survives a legacy null-pass response and a missing voter', () => {
  const legacy = dupe({ voter: null });
  const p = buildDeletePrompt({
    dupe: legacy,
    response: { responseId: 'r1', canvasser: chris, roundLabel: 'Legacy / no pass' },
    formatTime: () => '',
  });
  assert.match(p.message, /this voter · Legacy \/ no pass/, 'no trailing separator when time is empty');
});

test('deleteErrorMessage: a timeout never claims failure — it may have gone through', () => {
  const m = deleteErrorMessage({ code: 'TIMEOUT', message: 'Request timed out' });
  assert.match(m.message, /may or may not have gone through/);
  assert.doesNotMatch(m.title + m.message, /failed/i);
});

test('deleteErrorMessage: 404 reads as a concurrent delete, 403 as admin-only', () => {
  assert.match(deleteErrorMessage({ status: 404 }).title, /Already deleted/);
  assert.match(deleteErrorMessage({ status: 403 }).message, /organization admin/);
  assert.equal(deleteErrorMessage({ status: 500, message: 'Boom' }).message, 'Boom');
});

test('KIND_TABS keys are the wire values the server validates — nothing translates', () => {
  assert.deepEqual(KIND_TABS.map((t) => t.key), ['all', 'sameCanvasserSameDay', 'differentCanvassers']);
});
