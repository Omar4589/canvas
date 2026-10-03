import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { END_SCREEN_ID, buildSubmitRows, canAdvance, nextScreenId, screens, visibleBlocks } from './surveyRunner.js';

// The behaviour itself is pinned by mobile/lib/surveyRunner.test.js (npm run test:mobile, which CI's
// checks job also runs). This file guards the copy: the web preview's "Try it" must walk a survey
// exactly as the phone does. It reads the canonical from disk and compares the two bodies byte for
// byte, so a drift fails CI's client unit job.

const here = dirname(fileURLToPath(import.meta.url));

test('the web door runner is byte-identical to the phone canonical (drift guard)', () => {
  const MARK = '// ==== BEGIN MIRRORED BODY ====';
  const body = (p) => {
    const s = readFileSync(p, 'utf8');
    const i = s.indexOf(MARK);
    assert.notEqual(i, -1, `marker missing in ${p}`);
    return s.slice(i + MARK.length);
  };
  const canonical = body(join(here, '../../../mobile/lib/surveyRunner.js'));
  const mirror = body(join(here, 'surveyRunner.js'));
  assert.equal(mirror, canonical, 'client/src/lib/surveyRunner.js drifted from mobile/lib/surveyRunner.js');
});

test('Try it smoke: an answer routes Next, and a statement never posts a row', () => {
  const survey = {
    flow: 'script',
    presentation: 'steps',
    intro: '',
    closing: 'Thank you for your time.',
    questions: [
      {
        key: 'q1',
        type: 'single_choice',
        label: 'Can he count on your support?',
        required: true,
        options: [
          { id: 'yes', text: 'Yes', goTo: 'q2' },
          { id: 'no', text: 'No', goTo: '__end__' },
        ],
      },
      {
        key: 'q2',
        type: 'text',
        label: 'What matters most to you?',
        visibleIf: { logic: 'any', rules: [{ questionKey: 'q1', op: 'any_of', optionIds: ['yes'] }] },
      },
      {
        key: 'thanks',
        type: 'statement',
        role: 'statement',
        label: 'Thanks, that helps.',
        visibleIf: { logic: 'any', rules: [{ questionKey: 'q1', op: 'any_of', optionIds: ['yes'] }] },
      },
    ],
  };
  assert.equal(canAdvance(survey, {}, {}, 'q1'), false);
  assert.equal(nextScreenId(survey, { q1: 'yes' }, 'q1'), 'q2');
  assert.equal(nextScreenId(survey, { q1: 'no' }, 'q1'), END_SCREEN_ID);
  const answers = { q1: 'yes', q2: 'Roads' };
  assert.deepEqual(
    screens(survey, answers).map((s) => s.id),
    ['q1', 'q2', 'thanks', END_SCREEN_ID]
  );
  assert.deepEqual(
    buildSubmitRows(visibleBlocks(survey, answers), answers, {}).map((r) => r.questionKey),
    ['q1', 'q2']
  );
});
