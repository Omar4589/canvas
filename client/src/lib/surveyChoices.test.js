import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choicesFor, isOtherOptionId, OTHER_OPTION_ID } from './surveyChoices.js';

const q = (over = {}) => ({
  key: 'issue',
  type: 'single_choice',
  options: [
    { id: 'o_roads', text: 'Roads' },
    { id: 'o_schools', text: 'Schools' },
  ],
  ...over,
});

test('the write-in is appended LAST, and only when the flag is set', () => {
  assert.deepEqual(choicesFor(q()).map((c) => c.id), ['o_roads', 'o_schools']);
  const withOther = choicesFor(q({ otherOption: true }));
  assert.deepEqual(withOther.map((c) => c.id), ['o_roads', 'o_schools', OTHER_OPTION_ID]);
  assert.equal(withOther.at(-1).text, 'Other (specify)');
  assert.equal(withOther.at(-1).isOther, true);
});

test('retired options are hidden by default but KEPT when the response selected one', () => {
  const question = q({ options: [{ id: 'o_roads', text: 'Roads' }, { id: 'o_old', text: 'Old', retired: true }] });
  assert.deepEqual(choicesFor(question).map((c) => c.id), ['o_roads']);
  // Dropping a selected retired option from the editor silently de-selects it on save —
  // the same data-loss shape as the Other bug.
  assert.deepEqual(choicesFor(question, { keepIds: ['o_old'] }).map((c) => c.id), ['o_roads', 'o_old']);
  assert.deepEqual(choicesFor(question, { includeRetired: true }).map((c) => c.id), ['o_roads', 'o_old']);
});

test('non-choice questions have no choices', () => {
  assert.deepEqual(choicesFor({ type: 'text', otherOption: true }), []);
  assert.deepEqual(choicesFor(null), []);
  assert.deepEqual(choicesFor(undefined), []);
});

test('legacy string options still render', () => {
  const out = choicesFor({ type: 'single_choice', options: ['Yes', 'No'] });
  assert.deepEqual(out.map((c) => c.text), ['Yes', 'No']);
  assert.deepEqual(out.map((c) => c.id), ['Yes', 'No']);
});

test('the label is overridable, for surfaces that word it differently', () => {
  const out = choicesFor(q({ otherOption: true }), { otherLabel: 'Other:' });
  assert.equal(out.at(-1).text, 'Other:');
  assert.equal(out.at(-1).id, OTHER_OPTION_ID);
});

test('multiple_choice gets the write-in too', () => {
  const out = choicesFor(q({ type: 'multiple_choice', otherOption: true }));
  assert.equal(out.at(-1).id, OTHER_OPTION_ID);
});

test('isOtherOptionId recognizes only the exact sentinel', () => {
  assert.ok(isOtherOptionId(OTHER_OPTION_ID));
  assert.ok(!isOtherOptionId('other'));
  assert.ok(!isOtherOptionId('Other'));
  assert.ok(!isOtherOptionId(null));
});

test('the sentinel matches the server constant exactly', () => {
  // Drift here silently splits one bucket in two across the wire.
  assert.equal(OTHER_OPTION_ID, '__other__');
});

test('a question with no options but otherOption set still offers the write-in', () => {
  const out = choicesFor({ type: 'single_choice', options: [], otherOption: true });
  assert.deepEqual(out.map((c) => c.id), [OTHER_OPTION_ID]);
});
