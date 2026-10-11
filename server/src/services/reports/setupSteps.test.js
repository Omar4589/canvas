import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSetupSteps } from './setupSteps.js';

// The "Check map pins" step (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S8.5, change #3): done when nothing is
// left to look at, current before books are cut while homes wait, skipped once books are cut — it never blocks
// "setup complete".
const campaign = { name: 'C', type: 'survey', surveyTemplateId: 't' };
const ready = { households: 10, ownedDoors: 10, intakeDoors: 0, passes: 1, assignments: 1, orgCanvassers: 1, activePasses: 1 };
const stepOf = (r) => r.steps.find((s) => s.key === 'pinsChecked');

test('no pins to look at: done', () => {
  const r = deriveSetupSteps({ campaign, counts: { ...ready, publishedTurfs: 1, pinsToFix: 0 } });
  assert.equal(stepOf(r).status, 'done');
  assert.equal(stepOf(r).value, 'All pins checked');
  assert.equal(r.complete, true);
});

test('pins waiting, no books yet: the current step, with the warning, ahead of cutting', () => {
  const r = deriveSetupSteps({ campaign, counts: { ...ready, publishedTurfs: 0, assignments: 0, activePasses: 0, pinsToFix: 12 } });
  assert.equal(stepOf(r).status, 'current');
  assert.equal(r.nextStepKey, 'pinsChecked');
  assert.equal(stepOf(r).value, '12 to look at');
  assert.match(stepOf(r).warn, /wrong book/);
  assert.equal(stepOf(r).route, '/pin-fixes');
});

test('pins waiting, books already cut: skipped, never owed — setup can still be complete', () => {
  const r = deriveSetupSteps({ campaign, counts: { ...ready, publishedTurfs: 3, pinsToFix: 40 } });
  assert.equal(stepOf(r).status, 'skipped');
  assert.equal(r.complete, true);
  assert.equal(stepOf(r).value, '40 still to look at — books were cut');
});

test('missing counts read as zero', () => {
  const r = deriveSetupSteps({ campaign, counts: { ...ready, publishedTurfs: 1 } });
  assert.equal(stepOf(r).status, 'done');
});
