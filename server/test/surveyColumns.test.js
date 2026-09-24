import { test } from 'node:test';
import assert from 'node:assert';
import { templateAnswerPlan, snapshotAnswerText } from '../src/services/export/surveyColumns.js';
import { OTHER_OPTION_ID } from '../src/services/surveys/otherOption.js';

// The shared answer-column factory, used by Survey results and by Results by voter. The reason it
// is a factory rather than a module-level map is the last test in this file: two templates can
// legitimately carry the same question key AND the same option id (POST /admin/surveys/:id/duplicate
// clones both verbatim), so one shared map would resolve one survey's option text into another
// survey's file — silently, in an already-shipped export.

const q = (key, label, order, options = [], extra = {}) => ({ key, label, order, options, ...extra });

test('columns are current questions in template order, then orphan keys', () => {
  const plan = templateAnswerPlan(
    { name: 'Issues', questions: [q('second', 'Second', 2), q('first', 'First', 1)] },
    [{ key: 'deleted', label: 'A retired question' }]
  );
  assert.deepStrictEqual(plan.cols.map(plan.columnOf), ['First', 'Second', 'A retired question']);
});

test('an orphan key that still exists on the template is not duplicated', () => {
  const plan = templateAnswerPlan({ questions: [q('top', 'Top issue', 1)] }, [{ key: 'top', label: 'Top issue' }]);
  assert.deepStrictEqual(plan.cols.map((c) => c.key), ['top']);
});

test('an orphan with no snapshot label falls back to its key rather than rendering blank', () => {
  const plan = templateAnswerPlan({ questions: [] }, [{ key: 'ghost_q', label: null }]);
  assert.deepStrictEqual(plan.cols.map(plan.columnOf), ['ghost_q']);
});

test('two questions sharing a label are disambiguated by key, and only then', () => {
  const plan = templateAnswerPlan({
    questions: [q('a', 'Support?', 1), q('b', 'Support?', 2), q('c', 'Turnout', 3)],
  });
  assert.deepStrictEqual(plan.cols.map(plan.columnOf), ['Support? (a)', 'Support? (b)', 'Turnout']);
});

test('answers render id-native against CURRENT option text', () => {
  const plan = templateAnswerPlan({
    questions: [q('top', 'Top issue', 1, [{ id: 'housing', text: 'Housing costs' }])],
  });
  assert.strictEqual(
    plan.renderAnswer('top', [{ questionKey: 'top', optionIds: ['housing'], answer: 'Housing' }]),
    'Housing costs',
    'the option was renamed after the door — the file says what it means today'
  );
});

test('an unresolvable id falls back to the recorded snapshot', () => {
  const plan = templateAnswerPlan({ questions: [q('top', 'Top issue', 1, [{ id: 'housing', text: 'Housing' }])] });
  assert.strictEqual(
    plan.renderAnswer('top', [{ questionKey: 'top', optionIds: ['deleted_option'], answer: 'What they said' }]),
    'What they said'
  );
  assert.strictEqual(
    plan.renderAnswer('top', [{ questionKey: 'top', optionIds: [], answer: 'Free text' }]),
    'Free text'
  );
});

test('a write-in reads "Other — text", never bare text that could pass for a real option', () => {
  const withOther = templateAnswerPlan({
    questions: [q('top', 'Top issue', 1, [{ id: 'housing', text: 'Housing' }], { otherOption: true })],
  });
  assert.strictEqual(
    withOther.renderAnswer('top', [{ questionKey: 'top', optionIds: [OTHER_OPTION_ID], otherText: 'potholes' }]),
    'Other — potholes'
  );
  // Without the seed the id resolves to nothing and the cell falls back to the bare snapshot. On an
  // entry with no `answer` text that is a LEADING separator — ' — potholes' — which is ugly but
  // pre-existing, shared with the detailed-answers export, and only reachable by editing the Other
  // option off a question that already has write-ins. Asserted as it is rather than tidied here: a
  // cell that two shipped exports already print is not this refactor's to change.
  const noOther = templateAnswerPlan({ questions: [q('top', 'Top issue', 1, [{ id: 'housing', text: 'Housing' }])] });
  assert.strictEqual(
    noOther.renderAnswer('top', [{ questionKey: 'top', optionIds: [OTHER_OPTION_ID], otherText: 'potholes' }]),
    ' — potholes'
  );
});

test('multi-select joins with "; " and several entries with " | "', () => {
  const plan = templateAnswerPlan({
    questions: [q('top', 'Top', 1, [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }])],
  });
  assert.strictEqual(plan.renderAnswer('top', [{ questionKey: 'top', optionIds: ['a', 'b'] }]), 'Alpha; Beta');
  assert.strictEqual(
    plan.renderAnswer('top', [
      { questionKey: 'top', optionIds: ['a'] },
      { questionKey: 'top', optionIds: ['b'] },
    ]),
    'Alpha | Beta'
  );
});

test('a question with no answer renders empty, not a placeholder', () => {
  const plan = templateAnswerPlan({ questions: [q('top', 'Top', 1)] });
  assert.strictEqual(plan.renderAnswer('top', []), '');
  assert.strictEqual(plan.renderAnswer('top', undefined), '');
  assert.strictEqual(plan.renderAnswer('top', [{ questionKey: 'other', optionIds: ['x'] }]), '');
});

test('a deleted template still yields a usable plan', () => {
  const plan = templateAnswerPlan(null, [{ key: 'q1', label: 'Asked once' }]);
  assert.deepStrictEqual(plan.cols.map(plan.columnOf), ['Asked once']);
  assert.strictEqual(plan.templateName, '');
});

test('snapshotAnswerText embeds otherText once, never twice', () => {
  assert.strictEqual(snapshotAnswerText({ answer: 'Other', otherText: 'potholes' }), 'Other — potholes');
  assert.strictEqual(snapshotAnswerText({ answer: 'potholes', otherText: 'potholes' }), 'potholes');
  assert.strictEqual(snapshotAnswerText({ answer: ['A', 'potholes'], otherText: 'potholes' }), 'A; potholes');
  assert.strictEqual(snapshotAnswerText({ answer: ['A'], otherText: 'potholes' }), 'A — potholes');
  assert.strictEqual(snapshotAnswerText({ answer: null }), '');
});

// THE REASON THIS IS A FACTORY. Two templates, same question key, same option id, different text —
// reachable through the duplicate route, then editing one copy. Each plan must answer for its own
// template only. A module-level `${key}:${optionId}` map would make one of these print the other's
// wording in a file that already ships.
test('two templates sharing a key and an option id never cross-resolve', () => {
  const a = templateAnswerPlan({ name: 'v1', questions: [q('top', 'Top issue', 1, [{ id: 'main', text: 'Housing' }])] });
  const b = templateAnswerPlan({ name: 'v2', questions: [q('top', 'Top issue', 1, [{ id: 'main', text: 'Crime' }])] });
  const entry = [{ questionKey: 'top', optionIds: ['main'] }];
  assert.strictEqual(a.renderAnswer('top', entry), 'Housing');
  assert.strictEqual(b.renderAnswer('top', entry), 'Crime');
});
