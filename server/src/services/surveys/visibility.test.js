import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeCell, evaluateVisibleIf, visibleQuestionKeys } from './visibility.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, '__fixtures__/visibility.fixtures.json'), 'utf8'));

test('visibleQuestionKeys — fixtures', () => {
  for (const c of fixtures) {
    const got = [...visibleQuestionKeys(c.questions, c.answersByKey)].sort();
    assert.deepEqual(got, [...c.expectedVisibleKeys].sort(), c.name);
  }
});

test('makeCell — choice questions never carry text; text questions do', () => {
  assert.deepEqual(makeCell('single_choice', ['a'], 'ignored'), { optionIds: ['a'], text: null });
  assert.deepEqual(makeCell('multiple_choice', ['a', 'b'], 'ignored'), { optionIds: ['a', 'b'], text: null });
  assert.deepEqual(makeCell('text', [], 'hello'), { optionIds: [], text: 'hello' });
  assert.deepEqual(makeCell('text', [], null), { optionIds: [], text: null });
  assert.deepEqual(makeCell('single_choice', null, null), { optionIds: [], text: null });
});

test('evaluateVisibleIf — op semantics', () => {
  const ans = { q1: { optionIds: ['a'], text: null } };
  const v = (op, optionIds, key = 'q1') =>
    evaluateVisibleIf({ logic: 'all', rules: [{ questionKey: key, op, optionIds }] }, ans);
  assert.equal(v('is', ['a']), true);
  assert.equal(v('is', ['b']), false);
  assert.equal(v('is', []), false); // no target -> never matches
  assert.equal(v('is_not', ['b']), true);
  assert.equal(v('is_not', ['a']), false);
  assert.equal(v('any_of', ['x', 'a']), true);
  assert.equal(v('any_of', ['x', 'y']), false);
  assert.equal(v('any_of', []), false); // empty targets never match
  assert.equal(v('answered', []), true);
  assert.equal(v('not_answered', [], 'qX'), true); // missing upstream is not answered
  assert.equal(evaluateVisibleIf(null, ans), true);
  assert.equal(evaluateVisibleIf({ logic: 'all', rules: [] }, ans), true);
});

test('three evaluator copies are byte-identical (drift guard)', () => {
  const MARK = '// ==== BEGIN MIRRORED BODY ====';
  const body = (p) => {
    const s = readFileSync(p, 'utf8');
    const i = s.indexOf(MARK);
    assert.notEqual(i, -1, `marker missing in ${p}`);
    return s.slice(i + MARK.length);
  };
  const canonical = body(join(here, 'visibility.js'));
  const clientMirror = body(join(here, '../../../../client/src/lib/surveyVisibility.js'));
  const mobileMirror = body(join(here, '../../../../mobile/lib/surveyVisibility.js'));
  assert.equal(clientMirror, canonical, 'client/src/lib/surveyVisibility.js drifted from the canonical');
  assert.equal(mobileMirror, canonical, 'mobile/lib/surveyVisibility.js drifted from the canonical');
});
