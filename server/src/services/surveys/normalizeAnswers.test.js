import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAndFilterAnswers } from './normalizeAnswers.js';
import { OTHER_OPTION_ID } from './otherOption.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';

// normalizeAndFilterAnswers is the one door every stored answer comes through: the mobile submit,
// the admin response edit (dropHidden: false), the conversion worker (rebuildAnswerText) and the
// demo seeder. A statement (read-aloud text or a closing) records nothing, so its row must never
// get past here in any mode — this is the backstop for a phone on an older bundle, which posts an
// empty row for every statement it showed, and for an offline replay queued days before.
// docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §I.

const reachedBy = (questionKey, ...optionIds) => ({
  logic: 'any',
  rules: [{ questionKey, op: 'any_of', optionIds }],
});

// A small script: the support question, a pitch read to "No", the typed reason, a closing for
// "Yes", a follow-up question only "Yes" reaches, and a retired closing.
const script = () => ({
  questions: [
    {
      key: 'support',
      label: 'Can Paul count on your support?',
      type: 'single_choice',
      required: true,
      options: [
        { id: 'yes', text: 'Yes' },
        { id: 'no', text: 'No' },
        { id: 'maybe', text: 'Maybe', retired: true },
      ],
    },
    { key: 'pitch', label: "That's completely understandable.", type: 'statement', role: 'statement', options: [], visibleIf: reachedBy('support', 'no') },
    { key: 'reason', label: 'Is there a particular reason?', type: 'text', options: [], visibleIf: reachedBy('support', 'no') },
    { key: 'plan', label: 'How do you plan to vote?', type: 'single_choice', options: [{ id: 'early', text: 'Early' }], visibleIf: reachedBy('support', 'yes') },
    { key: 'close_2', label: 'Every vote matters.', type: 'statement', role: 'closing', options: [], visibleIf: reachedBy('support', 'yes') },
    { key: 'close_old', label: 'An old goodbye.', type: 'statement', role: 'closing', options: [], retired: true },
  ],
});

// Exactly what a phone on an older bundle posts for a statement it showed.
const oldBundleRow = (questionKey) => ({ questionKey, answer: null, optionIds: [], otherText: null });

const keys = (rows) => rows.map((r) => r.questionKey);

test('the field submit drops statement rows an older bundle posts (dropHidden: true)', () => {
  const out = normalizeAndFilterAnswers(script(), [
    { questionKey: 'support', optionIds: ['no'], answer: 'No' },
    oldBundleRow('pitch'),
    { questionKey: 'reason', optionIds: [], answer: 'Taxes' },
  ]);
  assert.deepEqual(keys(out), ['support', 'reason'], 'the pitch was visible, and still no row is kept');
  // The answers around it are untouched.
  assert.deepEqual(out[1], { questionKey: 'reason', questionLabel: 'Is there a particular reason?', answer: 'Taxes', optionIds: [], otherText: null });
});

test('the admin edit drops statement rows too, though it keeps hidden question rows (dropHidden: false)', () => {
  const out = normalizeAndFilterAnswers(
    script(),
    [
      { questionKey: 'support', optionIds: ['no'], answer: 'No' },
      oldBundleRow('pitch'), // visible
      { questionKey: 'plan', optionIds: ['early'], answer: 'Early' }, // hidden question: kept as history
      oldBundleRow('close_2'), // hidden statement
      oldBundleRow('close_old'), // retired statement
    ],
    { dropHidden: false }
  );
  assert.deepEqual(keys(out), ['support', 'plan'], 'history is preserved for questions, never invented for statements');
});

test('the conversion worker drops statement rows even when they carry ids and text (rebuildAnswerText)', () => {
  const out = normalizeAndFilterAnswers(
    script(),
    [
      { questionKey: 'support', optionIds: ['yes'], answer: 'stale snapshot' },
      // A hand-built row is no more welcome than an empty one.
      { questionKey: 'close_2', optionIds: ['yes'], answer: 'Every vote matters.', otherText: 'typed' },
    ],
    { dropHidden: true, rebuildAnswerText: true }
  );
  assert.deepEqual(out, [
    { questionKey: 'support', questionLabel: 'Can Paul count on your support?', answer: 'Yes', optionIds: ['yes'], otherText: null },
  ]);
});

test('a hydrated template drops statement rows the same way (the mobile submit and the admin edit load one)', () => {
  const doc = new SurveyTemplate({ organizationId: '64b000000000000000000001', name: 'Burton', ...script() });
  assert.equal(doc.questions[1].type, 'statement', 'the subdocument reads its type through a getter');
  const rows = [{ questionKey: 'support', optionIds: ['yes'] }, oldBundleRow('close_2')];
  assert.deepEqual(keys(normalizeAndFilterAnswers(doc, rows)), ['support']);
  assert.deepEqual(keys(normalizeAndFilterAnswers(doc, rows, { dropHidden: false })), ['support']);
});

test('unknown-key rows are still dropped in both modes', () => {
  const rows = [{ questionKey: 'support', optionIds: ['yes'] }, { questionKey: 'deleted_question', optionIds: ['x'], answer: 'x' }];
  assert.deepEqual(keys(normalizeAndFilterAnswers(script(), rows)), ['support']);
  assert.deepEqual(keys(normalizeAndFilterAnswers(script(), rows, { dropHidden: false })), ['support']);
});

test('a retired option id is still kept, and an id the template never had is still pruned', () => {
  for (const opts of [{}, { dropHidden: false }, { rebuildAnswerText: true }]) {
    const [row] = normalizeAndFilterAnswers(script(), [{ questionKey: 'support', optionIds: ['maybe', 'invented'], answer: 'Maybe' }], opts);
    assert.deepEqual(row.optionIds, ['maybe'], JSON.stringify(opts));
    assert.equal(row.answer, 'Maybe', JSON.stringify(opts));
  }
});

// A survey with no statements comes out exactly as it did before statements existed: every rule
// below is pinned field by field, in both modes.
test('a survey with no statements is normalized exactly as before', () => {
  const plain = {
    questions: [
      { key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }] },
      {
        key: 'issues',
        label: 'Top issues?',
        type: 'multiple_choice',
        otherOption: true,
        options: [{ id: 'roads', text: 'Roads' }, { id: 'schools', text: 'Schools' }],
      },
      { key: 'why', label: 'Why?', type: 'text', options: [] },
      { key: 'sign', label: 'Yard sign?', type: 'single_choice', options: [{ id: 'sign_yes', text: 'Yes' }], visibleIf: reachedBy('support', 'yes') },
    ],
  };
  const rows = [
    // Phase-1 backfill: no ids, so the snapshot text is mapped to its id.
    { questionKey: 'support', answer: 'No' },
    { questionKey: 'issues', optionIds: ['roads', OTHER_OPTION_ID, 'invented'], answer: ['Roads', 'potholes'], otherText: 'potholes' },
    { questionKey: 'why', optionIds: [], answer: 'Because', otherText: 'ignored' },
    { questionKey: 'sign', optionIds: ['sign_yes'], answer: 'Yes' }, // hidden: support is No
    { questionKey: 'nope', optionIds: ['x'] },
  ];
  const expected = [
    { questionKey: 'support', questionLabel: 'Support?', answer: 'No', optionIds: ['no'], otherText: null },
    { questionKey: 'issues', questionLabel: 'Top issues?', answer: ['Roads', 'potholes'], optionIds: ['roads', OTHER_OPTION_ID], otherText: 'potholes' },
    { questionKey: 'why', questionLabel: 'Why?', answer: 'Because', optionIds: [], otherText: null },
  ];
  assert.deepEqual(normalizeAndFilterAnswers(plain, rows), expected);
  assert.deepEqual(normalizeAndFilterAnswers(plain, rows, { dropHidden: false }), [
    ...expected,
    { questionKey: 'sign', questionLabel: 'Yard sign?', answer: 'Yes', optionIds: ['sign_yes'], otherText: null },
  ]);
});
