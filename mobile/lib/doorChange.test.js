import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changePrompt, ownSurveysHere, buildChangePrompt, clearOwnSurveysAtDoor, restoreOwnSurveys } from './doorChange.js';
import { ACTION_PATHS, addVoterPath, addVoterBody, doorResultPath, surveyPath } from './doorPaths.js';

// The "Change this door's result?" decisions (owner ruling 2026-10-02). The queue fixtures are built
// from the SAME path/body builders the writers use (doorPaths.js), with the field offlineQueue adds,
// so a fixture cannot drift from what production queues.
const queued = (path, body) => ({ id: 'q1', path, body: { ...body, wasOfflineSubmission: true }, enqueuedAt: '2026-10-02T15:00:00Z' });
// …and as optimisticSubmit really queues a tap: with its tap time, which is what the server judges by.
const tapped = (path, minute, body = {}) => queued(path, { ...body, timestamp: `2026-10-02T15:${String(minute).padStart(2, '0')}:00.000Z` });

const OUTCOMES = ['not_home', 'wrong_address', 'refused', 'not_target', 'no_soliciting', 'restricted'];
const door = (status, extra = {}) => ({ _id: 'h1', status, ...extra });

test('no prompt: a fresh door, the same result again, the office’s Restricted mark', () => {
  for (const action of [...OUTCOMES, 'survey_submitted']) {
    assert.equal(changePrompt({ door: door('unknocked'), action }), null, `fresh door, ${action}`);
    assert.equal(changePrompt({ door: undefined, action }), null, `door not in the cache, ${action}`);
    assert.equal(changePrompt({ door: door('restricted', { restrictedFrom: 'desk' }), action }), null, `desk mark, ${action}`);
  }
  for (const s of OUTCOMES) assert.equal(changePrompt({ door: door(s), action: s }), null, `re-recording ${s}`);
  assert.equal(changePrompt({ door: door('surveyed'), action: 'survey_submitted' }), null, 'another voter at a Surveyed door');
  assert.equal(changePrompt({ door: door('lit_dropped'), action: 'lit_dropped' }), null, 'Re-record drop');
});

test('every different result asks: change, or survey when opening a survey', () => {
  for (const from of OUTCOMES) {
    for (const to of OUTCOMES) {
      if (from === to) continue;
      // A canvasser's own Restricted tap reads 'field'; it is a result like any other.
      const d = door(from, from === 'restricted' ? { restrictedFrom: 'field' } : {});
      assert.deepEqual(changePrompt({ door: d, action: to }), { kind: 'change', from, to }, `${from} → ${to}`);
    }
    assert.deepEqual(changePrompt({ door: door(from), action: 'survey_submitted' }), { kind: 'survey', from });
  }
  // A Surveyed door (a teammate's survey) asked to take another outcome is a change too.
  assert.deepEqual(changePrompt({ door: door('surveyed'), action: 'not_target' }), { kind: 'change', from: 'surveyed', to: 'not_target' });
  // Lit-drop pairs, both ways.
  assert.deepEqual(changePrompt({ door: door('lit_dropped'), action: 'no_soliciting' }), { kind: 'change', from: 'lit_dropped', to: 'no_soliciting' });
  assert.deepEqual(changePrompt({ door: door('no_soliciting'), action: 'lit_dropped' }), { kind: 'change', from: 'no_soliciting', to: 'lit_dropped' });
});

test('a stale desk mark beside another status is no exemption', () => {
  const worked = door('not_home', { restrictedFrom: 'desk' });
  assert.deepEqual(changePrompt({ door: worked, action: 'refused' }), { kind: 'change', from: 'not_home', to: 'refused' });
  assert.deepEqual(changePrompt({ door: worked, action: 'refused', ownSurveys: 1 }), { kind: 'erase', count: 1, to: 'refused' });
});

test('own surveys win over every exemption: erase, with the count', () => {
  for (const to of OUTCOMES) {
    assert.deepEqual(changePrompt({ door: door('surveyed'), action: to, ownSurveys: 2 }), { kind: 'erase', count: 2, to });
  }
  // A queued survey behind a door the cache briefly reads as fresh, or behind a desk mark.
  assert.deepEqual(changePrompt({ door: door('unknocked'), action: 'not_home', ownSurveys: 1 }), { kind: 'erase', count: 1, to: 'not_home' });
  assert.deepEqual(
    changePrompt({ door: door('restricted', { restrictedFrom: 'desk' }), action: 'not_target', ownSurveys: 1 }),
    { kind: 'erase', count: 1, to: 'not_target' }
  );
  // Opening another survey never erases anything.
  assert.equal(changePrompt({ door: door('surveyed'), action: 'survey_submitted', ownSurveys: 1 }), null);
});

test('ownSurveysHere counts this canvasser’s cached and queued surveys at THIS door only', () => {
  const voters = [
    { _id: 'v1', householdId: 'h1', surveyStatus: 'surveyed', surveyedByMe: true }, // mine, cached
    { _id: 'v2', householdId: 'h1', surveyStatus: 'surveyed', surveyedByMe: false }, // a teammate's
    { _id: 'v3', householdId: 'h1', surveyStatus: 'not_surveyed', surveyedByMe: true }, // stale flag
    { _id: 'v4', householdId: 'h1', surveyStatus: 'surveyed' }, // no flag (legacy book)
    { _id: 'v5', householdId: 'h2', surveyStatus: 'surveyed', surveyedByMe: true }, // another door
  ];
  assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending: [] }), 1);

  // Queued: a survey for v4 (still waiting to upload), and a walk-up voter added here whose add
  // AND survey are both still queued — the add's body carries the client-minted id as voterId.
  const walkUp = addVoterBody({ voterId: 'w1', firstName: 'Sam', lastName: 'Q' });
  const pending = [
    queued(surveyPath('v4'), { surveyTemplateId: 't1', answers: [] }),
    queued(addVoterPath('h1'), walkUp),
    queued(surveyPath('w1'), { surveyTemplateId: 't1', answers: [] }),
    queued(surveyPath('v5'), { surveyTemplateId: 't1', answers: [] }), // another door's voter
    queued(addVoterPath('h2'), addVoterBody({ voterId: 'w2', firstName: 'A', lastName: 'B' })),
    queued(surveyPath('w2'), { surveyTemplateId: 't1', answers: [] }), // another door's walk-up
    queued(doorResultPath('h2', 'refused'), { note: null }), // another door's result: deletes nothing here
    queued('/mobile/households/h1/location', { lat: 1, lng: 2 }), // a pin fix here replaces nothing
  ];
  assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending }), 3, 'v1 cached + v4 queued + the walk-up');
  // A queued survey for a cached own survey is not counted twice.
  assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending: [queued(surveyPath('v1'), {})] }), 1);
  assert.equal(ownSurveysHere({ voters: [], householdId: 'h1' }), 0, 'defaults are safe');
});

test('a queued survey that a door result here was tapped AFTER is already gone: tap time decides', () => {
  // v4 lives at h1 (cached, not yet surveyed there); its survey is the queued one.
  const voters = [{ _id: 'v4', householdId: 'h1', surveyStatus: 'not_surveyed' }];
  const v4 = (minute) => tapped(surveyPath('v4'), minute, { surveyTemplateId: 't1', answers: [] });
  // Every one of the seven results replaces — none may be missed by the path check.
  for (const action of Object.keys(ACTION_PATHS)) {
    const result = (minute) => tapped(doorResultPath('h1', action), minute, { note: null });
    assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending: [v4(1), result(2)] }), 0, `${action} tapped after the survey`);
    assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending: [result(1), v4(2)] }), 1, `${action} tapped before it`);
    // Queue order is not tap order: two failed uploads can land in either order. The server compares
    // tap times, so this does too.
    assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending: [result(2), v4(1)] }), 0, `${action}: enqueued first, tapped later`);
  }
  // An item without a tap time (enqueued before the field existed) falls back to queue position.
  assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending: [queued(surveyPath('v4'), {}), queued(doorResultPath('h1', 'refused'), {})] }), 0);
  assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending: [queued(doorResultPath('h1', 'refused'), {}), queued(surveyPath('v4'), {})] }), 1);
  // A walk-up voter added and surveyed, then a result: the same rule.
  const add = tapped(addVoterPath('h1'), 1, addVoterBody({ voterId: 'w1', firstName: 'Sam', lastName: 'Q' }));
  assert.equal(ownSurveysHere({ householdId: 'h1', pending: [add, tapped(surveyPath('w1'), 2), tapped(doorResultPath('h1', 'not_target'), 3)] }), 0);
  assert.equal(ownSurveysHere({ householdId: 'h1', pending: [add, tapped(doorResultPath('h1', 'not_target'), 2), tapped(surveyPath('w1'), 3)] }), 1);
  // Another door's result, and the add-a-person and pin-fix writes here, delete nothing.
  for (const other of [tapped(doorResultPath('h2', 'refused'), 3), tapped(addVoterPath('h1'), 3), tapped('/mobile/households/h1/location', 3)]) {
    assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending: [v4(1), other] }), 1, other.path);
  }
  // The field report: offline, survey → Refused (Replace anyway) → change again. Recording Refused
  // cleared v4's cached mark, so only the queue speaks — and it says the answers are already gone.
  // Before, the second change warned again and "Keep my survey" kept nothing.
  const offline = [v4(1), tapped(doorResultPath('h1', 'refused'), 2)];
  assert.equal(changePrompt({ door: door('refused'), action: 'not_home', ownSurveys: ownSurveysHere({ voters, householdId: 'h1', pending: offline }) }).kind, 'change');
});

test('a survey on the server always counts — even with an older result still queued', () => {
  // The regression this guards: a result stuck in the queue (minute 1), then a survey that went out
  // LIVE (minute 2). The server keeps the survey — the result's replay is older, so it is discarded —
  // and the next result tapped here really deletes it. The cache cannot tell this survey from one the
  // queued result will delete, so it counts: a spare warning only asks, a missed one loses answers.
  const voters = [{ _id: 'v1', householdId: 'h1', surveyStatus: 'surveyed', surveyedByMe: true }];
  const pending = [tapped(doorResultPath('h1', 'not_home'), 1)];
  assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending }), 1);
  assert.equal(changePrompt({ door: door('surveyed'), action: 'refused', ownSurveys: 1 }).kind, 'erase');
});

test('recording a result clears this canvasser’s surveys at the door from the cache, as the server does', () => {
  const bootstrap = {
    households: [{ _id: 'h1', status: 'surveyed' }],
    voters: [
      { _id: 'v1', householdId: 'h1', surveyStatus: 'surveyed', surveyedByMe: true, fullName: 'A' }, // mine
      { _id: 'v2', householdId: 'h1', surveyStatus: 'surveyed', surveyedByMe: false }, // a teammate's
      { _id: 'v4', householdId: 'h1', surveyStatus: 'surveyed' }, // legacy book: no flag
      { _id: 'v5', householdId: 'h2', surveyStatus: 'surveyed', surveyedByMe: true }, // another door
    ],
  };
  const next = clearOwnSurveysAtDoor(bootstrap, 'h1');
  const byId = Object.fromEntries(next.voters.map((v) => [v._id, v]));
  // Exactly the wire's round-fresh voter: 'not_surveyed' and NO surveyedByMe key. Leaving the flag
  // false would read as a teammate's survey and fire the re-survey confirm (resurvey.js).
  assert.deepEqual(byId.v1, { _id: 'v1', householdId: 'h1', surveyStatus: 'not_surveyed', fullName: 'A' });
  assert.equal(byId.v2, bootstrap.voters[1], "a teammate's survey is untouched");
  assert.equal(byId.v4, bootstrap.voters[2], 'a legacy-book voter is untouched');
  assert.equal(byId.v5, bootstrap.voters[3], 'another door is untouched');
  assert.equal(next.households, bootstrap.households, 'the household patch is the caller’s');
  assert.equal(ownSurveysHere({ voters: next.voters, householdId: 'h1' }), 0, 'the next change asks no erase question');
  // Nothing to clear: the same object back, so the caller skips a needless cache write.
  assert.equal(clearOwnSurveysAtDoor(next, 'h1'), next);
  const noVoters = { households: [] };
  assert.equal(clearOwnSurveysAtDoor(noVoters, 'h1'), noVoters);

  // Rejected by the server (a 4xx), the result deleted nothing: the marks come straight back, or the
  // next tap would skip the erase warning and really delete the answers.
  const undone = restoreOwnSurveys(next, ['v1']);
  assert.deepEqual(undone.voters, bootstrap.voters);
  assert.equal(ownSurveysHere({ voters: undone.voters, householdId: 'h1' }), 1);
  // …unless the voter was rewritten since — newer truth than the undo.
  const rewritten = { ...next, voters: next.voters.map((v) => (v._id === 'v1' ? { ...v, surveyStatus: 'surveyed', surveyedByMe: false } : v)) };
  assert.equal(restoreOwnSurveys(rewritten, ['v1']), rewritten);
  assert.equal(restoreOwnSurveys(next, []), next);
});

test('the words never promise the door changes, and destructive styling is for erase only', () => {
  const labels = { not_home: 'Not home', refused: 'Refused', not_target: 'Not a target voter', surveyed: 'Surveyed' };
  const change = buildChangePrompt({ kind: 'change', from: 'not_home', to: 'refused' }, labels);
  assert.equal(change.title, "Change this door's result?");
  assert.match(change.message, /already marked Not home this round\. Record Refused instead\?/);
  assert.deepEqual([change.cancelText, change.confirmText, change.destructive], ['Cancel', 'Record', false]);

  const survey = buildChangePrompt({ kind: 'survey', from: 'not_home' }, labels);
  assert.equal(survey.title, 'This door is marked Not home');
  assert.deepEqual([survey.confirmText, survey.destructive], ['Continue', false]);

  const erase = buildChangePrompt({ kind: 'erase', count: 1, to: 'not_target' }, labels);
  assert.equal(erase.title, 'You surveyed someone here');
  assert.match(erase.message, /You took 1 survey at this door this round\. Recording "Not a target voter"/);
  assert.deepEqual([erase.cancelText, erase.confirmText, erase.destructive], ['Keep my survey', 'Replace anyway', true]);
  assert.match(buildChangePrompt({ kind: 'erase', count: 2, to: 'refused' }, labels).message, /You took 2 surveys/);
});
