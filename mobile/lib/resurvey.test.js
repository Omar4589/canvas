import { test } from 'node:test';
import assert from 'node:assert';
import { shouldConfirmResurvey, buildResurveyPrompt } from './resurvey.js';

// resurvey.js decides when the door asks "another canvasser already surveyed this voter —
// replace their answers?". The matrix matters because the flag rides a cache that can be stale
// in BOTH directions: the gate must fire on exactly one cell (surveyed + surveyedByMe:false) and
// FAIL OPEN everywhere else — the server-side preservation catches what the confirm misses, so a
// missed confirm loses nothing, while a false confirm nags a canvasser mid-conversation.
//
// Run from the REPO ROOT: `npm run test:mobile` (the root glob picks this up; never add a test
// script to mobile/package.json — it is OTA-fingerprint-hashed).

test('fires on exactly one cell of the matrix', () => {
  const statuses = ['surveyed', 'not_surveyed', undefined];
  const flags = [false, true, null, undefined, 'MISSING'];
  let fired = 0;
  for (const surveyStatus of statuses) {
    for (const f of flags) {
      const voter = { surveyStatus };
      if (f !== 'MISSING') voter.surveyedByMe = f;
      if (shouldConfirmResurvey(voter)) {
        fired += 1;
        assert.strictEqual(surveyStatus, 'surveyed');
        assert.strictEqual(f, false);
      }
    }
  }
  assert.strictEqual(fired, 1, "only surveyed + a teammate's flag fires");
});

test('fail-open is explicit: absent flag, null flag, and a missing voter never throw or fire', () => {
  assert.strictEqual(shouldConfirmResurvey({ surveyStatus: 'surveyed' }), false, 'pre-flag cache');
  assert.strictEqual(shouldConfirmResurvey({ surveyStatus: 'surveyed', surveyedByMe: null }), false);
  assert.strictEqual(shouldConfirmResurvey(undefined), false, 'voter not in cache');
  assert.strictEqual(shouldConfirmResurvey(null), false);
});

test('the stale spread-merge case: round-fresh voter with a leftover false flag does not fire', () => {
  // The delta merges voters by spread, so a voter who went round-fresh can briefly keep an old
  // surveyedByMe:false. The double-key on surveyStatus is what makes that harmless.
  assert.strictEqual(
    shouldConfirmResurvey({ surveyStatus: 'not_surveyed', surveyedByMe: false }),
    false
  );
});

test('own re-survey stays one tap', () => {
  assert.strictEqual(shouldConfirmResurvey({ surveyStatus: 'surveyed', surveyedByMe: true }), false);
});

test('the prompt is nameless, countless, and not destructive-styled', () => {
  assert.strictEqual(buildResurveyPrompt.length, 0, 'takes no voter/canvasser — nothing to leak');
  const p = buildResurveyPrompt();
  assert.match(p.message, /Another canvasser/);
  assert.match(p.message, /this round/);
  assert.match(p.message, /replace/);
  assert.match(p.message, /visible to your campaign admins/, 'the preservation claim');
  assert.doesNotMatch(p.message, /\{/, 'no template placeholders — nothing interpolated');
  assert.strictEqual(p.confirmText, 'Survey anyway');
  assert.strictEqual(p.cancelText, 'Cancel');
  assert.ok(!('style' in p), 'proceeding is legitimate — the caller styles Cancel only');
});
