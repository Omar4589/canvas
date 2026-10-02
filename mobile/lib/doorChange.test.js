import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changePrompt, ownSurveysHere, buildChangePrompt } from './doorChange.js';
import { addVoterPath, addVoterBody, surveyPath } from './doorPaths.js';

// The "Change this door's result?" decisions (owner ruling 2026-10-02). The queue fixtures are built
// from the SAME path/body builders the writers use (doorPaths.js), with the field offlineQueue adds,
// so a fixture cannot drift from what production queues.
const queued = (path, body) => ({ id: 'q1', path, body: { ...body, wasOfflineSubmission: true }, enqueuedAt: '2026-10-02T15:00:00Z' });

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
    queued('/mobile/households/h1/refused', { note: null }), // not a survey
  ];
  assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending }), 3, 'v1 cached + v4 queued + the walk-up');
  // A queued survey for a cached own survey is not counted twice.
  assert.equal(ownSurveysHere({ voters, householdId: 'h1', pending: [queued(surveyPath('v1'), {})] }), 1);
  assert.equal(ownSurveysHere({ voters: [], householdId: 'h1' }), 0, 'defaults are safe');
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
