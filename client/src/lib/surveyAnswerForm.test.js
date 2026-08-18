import { test } from 'node:test';
import assert from 'node:assert';
import { seedFromAnswers, buildAnswers, dropEmptyAnswers, cellsFromVals } from './surveyAnswerForm.js';

// The pure halves of the survey answer form, shared by the admin response EDITOR and the
// desk-entry COMPOSER. The bug these exist to prevent: rebuilding answers without the __other__
// rule de-classifies a write-in — optionIds empties, otherText nulls, and the answer drops out of
// its reporting bucket into a junk bucket named after the typed text.

const QUESTIONS = [
  {
    key: 'support',
    label: 'Support?',
    type: 'single_choice',
    options: [
      { id: 'yes', text: 'Yes' },
      { id: 'no', text: 'No' },
    ],
  },
  {
    key: 'issues',
    label: 'Issues',
    type: 'multiple_choice',
    otherOption: true,
    options: [
      { id: 'roads', text: 'Roads' },
      { id: 'taxes', text: 'Taxes' },
    ],
  },
  { key: 'notes', label: 'Notes', type: 'text' },
];

test('seedFromAnswers prefers stored option ids', () => {
  const { vals, otherTexts } = seedFromAnswers(QUESTIONS, [
    { questionKey: 'support', optionIds: ['no'], answer: 'No' },
    { questionKey: 'issues', optionIds: ['roads', '__other__'], otherText: 'potholes' },
    { questionKey: 'notes', answer: 'call back' },
  ]);
  assert.equal(vals.support, 'no');
  assert.deepEqual(vals.issues, ['roads', '__other__']);
  assert.equal(vals.notes, 'call back');
  assert.equal(otherTexts.issues, 'potholes');
});

test('seedFromAnswers falls back to matching legacy snapshot TEXT back to ids', () => {
  // Responses recorded before stable option ids existed carry only `answer`. Without this
  // fallback they are un-editable: the form opens blank and saving wipes the answer.
  const { vals } = seedFromAnswers(QUESTIONS, [
    { questionKey: 'support', answer: 'Yes' },
    { questionKey: 'issues', answer: ['Roads', 'Taxes'] },
  ]);
  assert.equal(vals.support, 'yes');
  assert.deepEqual(vals.issues, ['roads', 'taxes']);
});

test('seedFromAnswers gives every question a slot even with no answers', () => {
  const { vals } = seedFromAnswers(QUESTIONS, []);
  assert.equal(vals.support, '');
  assert.deepEqual(vals.issues, []);
  assert.equal(vals.notes, '');
});

test('buildAnswers keeps the __other__ sentinel AND its typed text', () => {
  const [, issues] = buildAnswers(QUESTIONS, { support: 'yes', issues: ['roads', '__other__'] }, { issues: 'potholes' });
  assert.deepEqual(issues.optionIds, ['roads', '__other__']);
  assert.equal(issues.otherText, 'potholes');
  // The sentinel has no option label, so its snapshot IS the typed text.
  assert.deepEqual(issues.answer, ['Roads', 'potholes']);
});

test('buildAnswers falls back to the label "Other" when nothing was typed', () => {
  const [, issues] = buildAnswers(QUESTIONS, { issues: ['__other__'] }, { issues: '   ' });
  assert.equal(issues.otherText, null, 'whitespace is not a write-in');
  assert.deepEqual(issues.answer, ['Other']);
});

test('buildAnswers drops otherText when __other__ is not selected', () => {
  const [, issues] = buildAnswers(QUESTIONS, { issues: ['roads'] }, { issues: 'stale text' });
  assert.equal(issues.otherText, null);
});

test('buildAnswers carries through answers to questions not in the form', () => {
  // A retired question's recorded answer must survive an edit to a live one.
  const retired = { questionKey: 'gone', questionLabel: 'Removed', answer: 'x', optionIds: ['x'] };
  const out = buildAnswers(QUESTIONS, { support: 'yes' }, {}, { carryThrough: [retired] });
  assert.ok(out.some((a) => a.questionKey === 'gone'), 'history is preserved');
});

test('buildAnswers skips retired questions in the form itself', () => {
  const qs = [...QUESTIONS, { key: 'old', label: 'Old', type: 'text', retired: true }];
  const out = buildAnswers(qs, { old: 'typed' }, {});
  assert.ok(!out.some((a) => a.questionKey === 'old'));
});

test('dropEmptyAnswers keeps only what was actually answered', () => {
  const out = dropEmptyAnswers([
    { questionKey: 'a', optionIds: ['yes'], answer: 'Yes' },
    { questionKey: 'b', optionIds: [], answer: null },
    { questionKey: 'c', optionIds: [], answer: '   ' },
    { questionKey: 'd', optionIds: [], answer: 'typed' },
  ]);
  assert.deepEqual(out.map((a) => a.questionKey), ['a', 'd']);
});

test('cellsFromVals never carries text into a CHOICE question', () => {
  // The evaluator's contract across server/web/mobile: only text questions carry text, or
  // answered/not_answered/is_not disagree between the three.
  const cells = cellsFromVals(QUESTIONS, { support: 'yes', issues: ['roads'], notes: 'hello' });
  assert.deepEqual(cells.support, { optionIds: ['yes'], text: null });
  assert.deepEqual(cells.issues, { optionIds: ['roads'], text: null });
  assert.deepEqual(cells.notes, { optionIds: [], text: 'hello' });
});
