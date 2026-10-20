import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  validatePlan,
  applyEditPlan,
  planFromAnswers,
  keysOf,
  isAnsweredRow,
  skipLiteral,
  fingerprint,
  editorVersion,
  summarizePlan,
  PlanError,
} from './answerEdit.js';
import { compileRouting } from '../surveys/routing.js';
import { answerSchema } from '../../models/SurveyResponse.js';

// docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §C: the plan, the applier and the per-person diff, with no
// database. The integration suite (test/answerEdit.int.test.js) drives the same functions through
// the real routes.

const SUPPORT = { logic: 'any', rules: [{ questionKey: 'candidate_support', op: 'any_of', optionIds: ['strong_support', 'lean_support'] }] };

// The demo survey's three questions (seedDemoOrg.js), plus a written question, a retired one and an
// "Other" write-in on the issue question.
const yardQuestions = () => [
  {
    key: 'candidate_support',
    label: 'Can we count on your support?',
    type: 'single_choice',
    options: [
      { id: 'strong_support', text: 'Support', tag: 'Supporter', order: 0 },
      { id: 'lean_support', text: 'Likely Support', tag: 'Supporter', order: 1 },
      { id: 'undecided', text: 'Undecided', order: 2 },
      { id: 'opposed', text: 'Opposed', order: 3 },
      { id: 'gone', text: 'Old choice', order: 4, retired: true },
    ],
  },
  {
    key: 'top_issue',
    label: 'What is your top issue?',
    type: 'multiple_choice',
    otherOption: true,
    options: [
      { id: 'healthcare', text: 'Healthcare costs', order: 0 },
      { id: 'public_schools', text: 'Public schools & education', order: 1 },
      { id: 'taxes', text: 'Property taxes', order: 2, retired: true },
    ],
  },
  {
    key: 'yard_sign',
    label: 'Could you help us by taking a yard sign?',
    type: 'multiple_choice',
    visibleIf: SUPPORT,
    options: [
      { id: 'yard_sign_delivered', text: 'Yard Sign Delivered', order: 0 },
      { id: 'candidate_follow_up', text: 'Candidate Follow-Up', order: 1 },
      { id: 'volunteer_request', text: 'Volunteer Request', order: 2 },
    ],
  },
  { key: 'comments', label: 'Anything else?', type: 'text' },
  { key: 'old_q', label: 'Retired question', type: 'single_choice', retired: true, options: [{ id: 'a', text: 'A' }] },
  { key: 'intro', label: 'Read this aloud.', type: 'statement' },
];

// Rows exactly as the phone stores them (normalizeAndFilterAnswers' key order).
const row = (questionKey, questionLabel, answer, optionIds = [], otherText = null) => ({
  questionKey,
  questionLabel,
  answer,
  optionIds,
  otherText,
});
const support = (id = 'strong_support', text = 'Support') =>
  row('candidate_support', 'Can we count on your support?', text, [id]);
const sign = (...ids) => {
  const text = { yard_sign_delivered: 'Yard Sign Delivered', candidate_follow_up: 'Candidate Follow-Up', volunteer_request: 'Volunteer Request' };
  return row('yard_sign', 'Could you help us by taking a yard sign?', ids.map((i) => text[i]), ids);
};
const issue = (ids, answer, otherText = null) => row('top_issue', 'What is your top issue?', answer, ids, otherText);

const takeOutFakes = (qs) =>
  validatePlan(qs, [{ questionKey: 'yard_sign', op: 'adjust', remove: ['volunteer_request', 'candidate_follow_up'] }]);

// Every emitted row must be one the schema accepts, exactly as Mongoose would store it.
const Probe = mongoose.model('AnswerEditProbe', new mongoose.Schema({ answers: [answerSchema] }));
const assertValidRows = (answers) => {
  const err = new Probe({ answers }).validateSync();
  assert.equal(err, undefined, err ? String(err) : '');
};

// ---- the plan -------------------------------------------------------------------------------

test('validatePlan refuses every bad plan with its own code', () => {
  const qs = yardQuestions();
  const refuses = (plan, code) => assert.throws(() => validatePlan(qs, plan), (e) => e instanceof PlanError && e.code === code);
  refuses([], 'PLAN_EMPTY');
  refuses(undefined, 'PLAN_EMPTY');
  refuses([{ questionKey: 'nope', op: 'clear' }], 'PLAN_UNKNOWN_QUESTION');
  refuses([{ questionKey: 'intro', op: 'clear' }], 'PLAN_UNKNOWN_QUESTION');
  refuses([{ questionKey: 'comments', op: 'clear' }, { questionKey: 'comments', op: 'clear' }], 'PLAN_DUPLICATE_QUESTION');
  refuses([{ questionKey: 'yard_sign', op: 'set', optionIds: ['yard_sign_delivered'] }], 'PLAN_OP_TYPE');
  refuses([{ questionKey: 'candidate_support', op: 'adjust', remove: ['opposed'] }], 'PLAN_OP_TYPE');
  refuses([{ questionKey: 'comments', op: 'set', answer: 'x' }], 'PLAN_OP_TYPE');
  refuses([{ questionKey: 'comments', op: 'adjust', remove: ['x'] }], 'PLAN_OP_TYPE');
  refuses([{ questionKey: 'comments', op: 'erase' }], 'PLAN_OP_TYPE');
  refuses([{ questionKey: 'old_q', op: 'set', optionIds: ['a'] }], 'PLAN_RETIRED_QUESTION');
  refuses([{ questionKey: 'candidate_support', op: 'set', optionIds: ['gone'] }], 'PLAN_OPTION_INVALID');
  refuses([{ questionKey: 'candidate_support', op: 'set', optionIds: ['__other__'] }], 'PLAN_OPTION_INVALID');
  refuses([{ questionKey: 'candidate_support', op: 'set', optionIds: ['nope'] }], 'PLAN_OPTION_INVALID');
  refuses([{ questionKey: 'candidate_support', op: 'set', optionIds: ['undecided', 'opposed'] }], 'PLAN_OPTION_INVALID');
  refuses([{ questionKey: 'top_issue', op: 'adjust', remove: ['healthcare'], replaceWith: ['__other__'] }], 'PLAN_OPTION_INVALID');
  refuses([{ questionKey: 'top_issue', op: 'adjust', remove: ['healthcare'], replaceWith: ['taxes'] }], 'PLAN_OPTION_INVALID');
  refuses([{ questionKey: 'top_issue', op: 'adjust', remove: ['healthcare'], replaceWith: ['healthcare'] }], 'PLAN_ADJUST_OVERLAP');
  refuses([{ questionKey: 'top_issue', op: 'adjust', remove: [] }], 'PLAN_ADJUST_EMPTY');
});

test('validatePlan normalizes: the label as the admin saw it, replacements in option order', () => {
  const qs = yardQuestions();
  const plan = validatePlan(qs, [
    { questionKey: 'yard_sign', op: 'adjust', remove: ['volunteer_request', 'volunteer_request'], replaceWith: ['candidate_follow_up', 'yard_sign_delivered'] },
    { questionKey: 'comments', op: 'clear' },
  ]);
  assert.deepEqual(plan, [
    {
      questionKey: 'yard_sign',
      questionLabel: 'Could you help us by taking a yard sign?',
      op: 'adjust',
      remove: ['volunteer_request'],
      removeTexts: [],
      replaceWith: ['yard_sign_delivered', 'candidate_follow_up'],
    },
    { questionKey: 'comments', questionLabel: 'Anything else?', op: 'clear' },
  ]);
  // Retired ids and the write-in may be taken out; they just can't be put in.
  assert.ok(validatePlan(qs, [{ questionKey: 'top_issue', op: 'adjust', remove: ['taxes', '__other__'] }]));
  assert.ok(validatePlan(qs, [{ questionKey: 'old_q', op: 'clear' }]));
});

// ---- the owner's case -------------------------------------------------------------------------

test('Take out leaves the skip literal on a fake-only survey and the sign on a mixed one', () => {
  const qs = yardQuestions();
  const plan = takeOutFakes(qs);
  const fakeOnly = applyEditPlan(qs, [support(), sign('volunteer_request')], plan);
  assert.equal(fakeOnly.changed, true);
  assert.deepEqual(fakeOnly.answers[1], {
    questionKey: 'yard_sign',
    questionLabel: 'Could you help us by taking a yard sign?',
    answer: [],
    optionIds: [],
    otherText: null,
  });
  assert.equal(fakeOnly.rows[0].kind, 'cleared');
  assert.deepEqual(fakeOnly.rows[0].removedIds, ['volunteer_request']);

  const both = applyEditPlan(qs, [support(), sign('candidate_follow_up', 'volunteer_request')], plan);
  assert.deepEqual(both.answers[1].optionIds, []);
  assert.deepEqual(both.rows[0].removedIds, ['candidate_follow_up', 'volunteer_request']);

  const mixed = applyEditPlan(qs, [support(), sign('yard_sign_delivered', 'volunteer_request')], plan);
  assert.deepEqual(mixed.answers[1].optionIds, ['yard_sign_delivered']);
  assert.deepEqual(mixed.answers[1].answer, ['Yard Sign Delivered']);
  assert.equal(mixed.rows[0].kind, 'changed');

  const real = applyEditPlan(qs, [support(), sign('yard_sign_delivered')], plan);
  assert.equal(real.changed, false);
  assert.deepEqual(real.skipped, [{ questionKey: 'yard_sign', reason: 'no_matching_picks' }]);
  assertValidRows(fakeOnly.answers);
  assertValidRows(mixed.answers);
});

test('Clear on a mixed survey takes the real sign too — the reason Take out exists', () => {
  const qs = yardQuestions();
  const res = applyEditPlan(qs, [support(), sign('yard_sign_delivered', 'volunteer_request')], validatePlan(qs, [{ questionKey: 'yard_sign', op: 'clear' }]));
  assert.deepEqual(res.answers[1], skipLiteral(qs[2]));
});

test('Replace them with lands only on a survey that lost a pick', () => {
  const qs = yardQuestions();
  const plan = validatePlan(qs, [{ questionKey: 'yard_sign', op: 'adjust', remove: ['volunteer_request'], replaceWith: ['candidate_follow_up'] }]);
  const lost = applyEditPlan(qs, [support(), sign('yard_sign_delivered', 'volunteer_request')], plan);
  assert.deepEqual(lost.answers[1].optionIds, ['yard_sign_delivered', 'candidate_follow_up']);
  assert.deepEqual(lost.rows[0].addedIds, ['candidate_follow_up']);
  const untouched = applyEditPlan(qs, [support(), sign('yard_sign_delivered')], plan);
  assert.equal(untouched.changed, false, 'nothing filled in that nobody recorded');
  // Already holding the replacement: it is not added twice.
  const has = applyEditPlan(qs, [support(), sign('candidate_follow_up', 'volunteer_request')], plan);
  assert.deepEqual(has.answers[1].optionIds, ['candidate_follow_up']);
});

// ---- rules 1–7 ----------------------------------------------------------------------------------

test('rule 1: untouched rows are carried exactly — same objects, same keys, same order', () => {
  const qs = yardQuestions();
  const old3 = { questionKey: 'top_issue', questionLabel: 'Top issue (old label)', answer: ['Healthcare costs'] };
  const old4 = { questionKey: 'comments', questionLabel: 'Anything else?', answer: 'Call me', optionIds: [] };
  const orphan = { questionKey: 'deleted_q', questionLabel: 'Gone', answer: 'x', optionIds: [], otherText: null };
  const stored = [support(), old3, sign('volunteer_request'), old4, orphan];
  const res = applyEditPlan(qs, stored, takeOutFakes(qs));
  assert.equal(res.answers[0], stored[0]);
  assert.equal(res.answers[1], old3);
  assert.equal(res.answers[3], old4);
  assert.equal(res.answers[4], orphan, 'a row whose key the template lost is never dropped');
  assert.equal(JSON.stringify(res.answers[1]), JSON.stringify(old3));
  assert.deepEqual(Object.keys(res.answers[2]), ['questionKey', 'questionLabel', 'answer', 'optionIds', 'otherText']);
  assert.deepEqual(stored[2].optionIds, ['volunteer_request'], 'the input is never mutated');
});

test('rule 2: clear writes the skip literal with the current label; a blank is a no-op; a hidden answer clears too', () => {
  const qs = yardQuestions();
  const stale = { ...support(), questionLabel: 'Old wording of the question' };
  const res = applyEditPlan(qs, [stale], validatePlan(qs, [{ questionKey: 'candidate_support', op: 'clear' }]));
  assert.deepEqual(res.answers[0], {
    questionKey: 'candidate_support',
    questionLabel: 'Can we count on your support?',
    answer: null,
    optionIds: [],
    otherText: null,
  });
  const text = applyEditPlan(qs, [row('comments', 'Anything else?', 'hello')], validatePlan(qs, [{ questionKey: 'comments', op: 'clear' }]));
  assert.equal(text.answers[0].answer, null);
  for (const blank of [row('comments', 'Anything else?', ''), row('comments', 'Anything else?', null)]) {
    const r = applyEditPlan(qs, [blank], validatePlan(qs, [{ questionKey: 'comments', op: 'clear' }]));
    assert.equal(r.changed, false);
    assert.deepEqual(r.skipped, [{ questionKey: 'comments', reason: 'already_blank' }]);
  }
  // A hidden answer still counts in results, so clearing it applies whatever the path.
  const hidden = applyEditPlan(qs, [support('opposed', 'Opposed'), sign('volunteer_request')], validatePlan(qs, [{ questionKey: 'yard_sign', op: 'clear' }]));
  assert.deepEqual(hidden.answers[1].optionIds, []);
});

test('rule 3: bulk changes only where answered; the same answer is left alone', () => {
  const qs = yardQuestions();
  const set = validatePlan(qs, [{ questionKey: 'candidate_support', op: 'set', optionIds: ['undecided'] }]);
  const blank = applyEditPlan(qs, [row('candidate_support', 'Can we count on your support?', null)], set);
  assert.deepEqual(blank.skipped, [{ questionKey: 'candidate_support', reason: 'not_answered' }]);
  const missing = applyEditPlan(qs, [], set);
  assert.deepEqual(missing.skipped, [{ questionKey: 'candidate_support', reason: 'not_answered' }]);
  assert.deepEqual(missing.answers, []);
  const same = applyEditPlan(qs, [support('undecided', 'Undecided')], set);
  assert.deepEqual(same.skipped, [{ questionKey: 'candidate_support', reason: 'same_answer' }]);
  const changed = applyEditPlan(qs, [support('opposed', 'Opposed')], set);
  assert.deepEqual(changed.answers[0], row('candidate_support', 'Can we count on your support?', 'Undecided', ['undecided']));
  const adjustBlank = applyEditPlan(qs, [support(), sign()], takeOutFakes(qs));
  assert.deepEqual(adjustBlank.skipped, [{ questionKey: 'yard_sign', reason: 'not_answered' }]);
});

test('rule 3: the write-in text survives only while Other stays', () => {
  const qs = yardQuestions();
  const stored = [issue(['healthcare', '__other__'], ['Healthcare costs', 'potholes'], 'potholes')];
  const keep = applyEditPlan(qs, stored, validatePlan(qs, [{ questionKey: 'top_issue', op: 'adjust', remove: ['healthcare'] }]));
  assert.deepEqual(keep.answers[0], issue(['__other__'], ['potholes'], 'potholes'));
  const drop = applyEditPlan(qs, stored, validatePlan(qs, [{ questionKey: 'top_issue', op: 'adjust', remove: ['__other__'] }]));
  assert.deepEqual(drop.answers[0], issue(['healthcare'], ['Healthcare costs'], null));
  assertValidRows(keep.answers);
});

test('rule 4: old text rows — set rewrites id-native, adjust maps texts (retired too), an unknown text skips', () => {
  const qs = yardQuestions();
  const legacySupport = { questionKey: 'candidate_support', questionLabel: 'Support?', answer: 'Opposed' };
  const set = applyEditPlan(qs, [legacySupport], validatePlan(qs, [{ questionKey: 'candidate_support', op: 'set', optionIds: ['undecided'] }]));
  assert.deepEqual(set.answers[0], row('candidate_support', 'Can we count on your support?', 'Undecided', ['undecided']));
  const sameLegacy = applyEditPlan(qs, [{ ...legacySupport, answer: 'Undecided' }], validatePlan(qs, [{ questionKey: 'candidate_support', op: 'set', optionIds: ['undecided'] }]));
  assert.equal(sameLegacy.changed, false);

  const legacyIssue = { questionKey: 'top_issue', questionLabel: 'Issue', answer: ['Healthcare costs', 'Property taxes'], optionIds: [] };
  const mapped = applyEditPlan(qs, [legacyIssue], validatePlan(qs, [{ questionKey: 'top_issue', op: 'adjust', remove: ['healthcare'] }]));
  assert.deepEqual(mapped.answers[0].optionIds, ['taxes'], 'a retired option text maps to its id');

  const unknown = { questionKey: 'top_issue', questionLabel: 'Issue', answer: ['Healthcare costs', 'Volunteer interest'], optionIds: [] };
  const skip = applyEditPlan(qs, [unknown], validatePlan(qs, [{ questionKey: 'top_issue', op: 'adjust', remove: ['healthcare'] }]));
  assert.deepEqual(skip.skipped, [{ questionKey: 'top_issue', reason: 'legacy_answer' }]);
  const named = applyEditPlan(qs, [unknown], validatePlan(qs, [{ questionKey: 'top_issue', op: 'adjust', remove: [], removeTexts: ['Volunteer interest'] }]));
  assert.deepEqual(named.answers[0].optionIds, ['healthcare']);
  assert.deepEqual(named.rows[0].removedTexts, ['Volunteer interest']);
});

test('rule 5: an answer the edit hides is dropped and reported; one hidden beforehand is kept', () => {
  const qs = yardQuestions();
  const plan = validatePlan(qs, [{ questionKey: 'candidate_support', op: 'set', optionIds: ['opposed'] }]);
  const res = applyEditPlan(qs, [support(), sign('yard_sign_delivered')], plan);
  assert.deepEqual(res.answers.map((r) => r.questionKey), ['candidate_support']);
  assert.deepEqual(res.rows.map((r) => [r.questionKey, r.kind]), [['candidate_support', 'changed'], ['yard_sign', 'dropped']]);
  assert.deepEqual(res.rows[1].before.optionIds, ['yard_sign_delivered']);
  assert.equal(res.endsScript, false, 'a List survey never ends early');

  // Hidden before the edit (support Opposed) and still hidden: untouched by an edit elsewhere.
  const before = [support('opposed', 'Opposed'), issue(['healthcare'], ['Healthcare costs']), sign('volunteer_request')];
  const kept = applyEditPlan(qs, before, validatePlan(qs, [{ questionKey: 'top_issue', op: 'clear' }]));
  assert.equal(kept.answers[2], before[2]);
  // An unanswered row of a newly hidden question is left as it is.
  const empty = applyEditPlan(qs, [support(), sign()], plan);
  assert.equal(empty.answers.length, 2);
});

test('rule 5: a three-level chain drops every level the edit hides', () => {
  const chain = [
    { key: 'sign', label: 'Sign?', type: 'single_choice', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }] },
    { key: 'size', label: 'Size?', type: 'single_choice', visibleIf: { logic: 'all', rules: [{ questionKey: 'sign', op: 'is', optionIds: ['yes'] }] }, options: [{ id: 'big', text: 'Big' }] },
    { key: 'color', label: 'Color?', type: 'text', visibleIf: { logic: 'all', rules: [{ questionKey: 'size', op: 'answered', optionIds: [] }] } },
  ];
  const stored = [row('sign', 'Sign?', 'Yes', ['yes']), row('size', 'Size?', 'Big', ['big']), row('color', 'Color?', 'Red')];
  const res = applyEditPlan(chain, stored, validatePlan(chain, [{ questionKey: 'sign', op: 'set', optionIds: ['no'] }]));
  assert.deepEqual(res.answers.map((r) => r.questionKey), ['sign']);
  assert.deepEqual(res.rows.filter((r) => r.kind === 'dropped').map((r) => r.questionKey), ['size', 'color']);
});

test('rule 5 / D7: a blank answer that ends a Script-flow survey drops the rest of that path', () => {
  const { questions, errors } = compileRouting([
    { key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No', goTo: '__end__' }] },
    { key: 'sign', label: 'Yard sign?', type: 'multiple_choice', options: [{ id: 'sd', text: 'Sign delivered', goTo: 'size' }, { id: 'vr', text: 'Volunteer', goTo: '__end__' }] },
    { key: 'size', label: 'How big?', type: 'single_choice', options: [{ id: 'big', text: 'Big' }] },
  ]);
  assert.deepEqual(errors, []);
  const stored = [row('support', 'Support?', 'Yes', ['yes']), row('sign', 'Yard sign?', ['Sign delivered'], ['sd']), row('size', 'How big?', 'Big', ['big'])];
  const res = applyEditPlan(questions, stored, validatePlan(questions, [{ questionKey: 'sign', op: 'clear' }]), { flow: 'script' });
  assert.deepEqual(res.answers.map((r) => r.questionKey), ['support', 'sign']);
  assert.equal(res.endsScript, true);
  assert.deepEqual(res.rows.map((r) => [r.questionKey, r.kind]), [['sign', 'cleared'], ['size', 'dropped']]);
});

test('D7: a re-route plus an unrelated blank does not read as the blank ending the script (code review round 2)', () => {
  const { questions, errors } = compileRouting([
    { key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No', goTo: '__end__' }] },
    { key: 'note', label: 'Anything else?', type: 'text' },
    { key: 'sign', label: 'Yard sign?', type: 'multiple_choice', options: [{ id: 'sd', text: 'Sign delivered', goTo: 'size' }, { id: 'vr', text: 'Volunteer', goTo: '__end__' }] },
    { key: 'size', label: 'How big?', type: 'single_choice', options: [{ id: 'big', text: 'Big' }] },
  ]);
  assert.deepEqual(errors, []);
  const stored = [
    row('support', 'Support?', 'Yes', ['yes']),
    row('note', 'Anything else?', 'call after 6'),
    row('sign', 'Yard sign?', ['Sign delivered'], ['sd']),
    row('size', 'How big?', 'Big', ['big']),
  ];
  const plan = validatePlan(questions, [
    { questionKey: 'note', op: 'clear' },
    { questionKey: 'sign', op: 'adjust', remove: ['sd'], replaceWith: ['vr'] },
  ]);
  const res = applyEditPlan(questions, stored, plan, { flow: 'script' });
  assert.deepEqual(res.rows.filter((r) => r.kind === 'dropped').map((r) => r.questionKey), ['size'], 'the re-route drops the follow-up');
  assert.equal(res.endsScript, false, 'the blank on a plain question is not what cut the survey short');
});

test('rule 6: one person at a time may fill a blank, but never on a question their path hides', () => {
  const qs = yardQuestions();
  const opposed = [support('opposed', 'Opposed')];
  const ghost = applyEditPlan(qs, opposed, [{ questionKey: 'yard_sign', questionLabel: 'x', op: 'set', optionIds: ['yard_sign_delivered'] }], { mode: 'person' });
  assert.equal(ghost.changed, false);
  assert.deepEqual(ghost.skipped, [{ questionKey: 'yard_sign', reason: 'hidden_on_path' }]);
  assert.deepEqual(ghost.answers, opposed);

  const fill = applyEditPlan(qs, [support(), row('comments', 'Anything else?', 'hi')], [{ questionKey: 'yard_sign', questionLabel: 'x', op: 'set', optionIds: ['yard_sign_delivered'] }], { mode: 'person' });
  assert.deepEqual(fill.answers.map((r) => r.questionKey), ['candidate_support', 'yard_sign', 'comments'], 'a new row goes where the survey puts it');
  assertValidRows(fill.answers);
  const written = applyEditPlan(qs, [], [{ questionKey: 'comments', questionLabel: 'x', op: 'set', answer: '  call back  ' }], { mode: 'person' });
  assert.deepEqual(written.answers, [row('comments', 'Anything else?', 'call back')]);
});

test('rule 7: nothing differs → not changed, and the answers are the same array contents', () => {
  const qs = yardQuestions();
  const stored = [support(), sign('yard_sign_delivered')];
  const res = applyEditPlan(qs, stored, takeOutFakes(qs));
  assert.equal(res.changed, false);
  assert.deepEqual(res.rows, []);
  res.answers.forEach((r, i) => assert.equal(r, stored[i]));
});

// ---- the per-person diff ---------------------------------------------------------------------------

test('planFromAnswers: an untouched save is no change, whatever the posted shape', () => {
  const qs = yardQuestions();
  const stored = [support(), issue(['__other__', 'healthcare'], ['potholes ', 'Healthcare costs'], 'potholes '), sign('candidate_follow_up', 'yard_sign_delivered'), row('comments', 'Anything else?', 'Call me ')];
  const posted = [
    { questionKey: 'candidate_support', questionLabel: 'relabelled', answer: 'Support', optionIds: ['strong_support'] },
    { questionKey: 'top_issue', answer: ['Healthcare costs', 'potholes'], optionIds: ['healthcare', '__other__'], otherText: 'potholes' },
    { questionKey: 'yard_sign', answer: ['x'], optionIds: ['yard_sign_delivered', 'candidate_follow_up'] },
    { questionKey: 'comments', answer: 'Call me' },
    { questionKey: 'not_a_question', answer: 'ignored' },
  ];
  assert.deepEqual(planFromAnswers(qs, stored, posted), []);
  // Blank on both sides, in any shape, is no change.
  assert.deepEqual(planFromAnswers(qs, [row('comments', 'c', null)], [{ questionKey: 'comments', answer: '' }]), []);
  assert.deepEqual(planFromAnswers(qs, [], [{ questionKey: 'yard_sign', answer: [], optionIds: [] }]), []);
  // An old text answer the editor seeded as ids is no change either.
  assert.deepEqual(planFromAnswers(qs, [{ questionKey: 'candidate_support', answer: 'Opposed' }], [{ questionKey: 'candidate_support', optionIds: ['opposed'] }]), []);
});

test('planFromAnswers: a pick-several cleared in the editor is a clear; a change is a set', () => {
  const qs = yardQuestions();
  const stored = [support(), sign('volunteer_request')];
  assert.deepEqual(planFromAnswers(qs, stored, [{ questionKey: 'yard_sign', answer: [], optionIds: [] }]), [
    { questionKey: 'yard_sign', questionLabel: 'Could you help us by taking a yard sign?', op: 'clear' },
  ]);
  assert.deepEqual(planFromAnswers(qs, stored, [{ questionKey: 'candidate_support', optionIds: ['undecided'] }]), [
    { questionKey: 'candidate_support', questionLabel: 'Can we count on your support?', op: 'set', optionIds: ['undecided'], otherText: null },
  ]);
  assert.deepEqual(planFromAnswers(qs, [], [{ questionKey: 'comments', answer: ' hi ' }]), [
    { questionKey: 'comments', questionLabel: 'Anything else?', op: 'set', answer: 'hi' },
  ]);
  // A retired question is read-only here, except that it can be cleared.
  assert.deepEqual(planFromAnswers(qs, [row('old_q', 'Retired question', 'A', ['a'])], [{ questionKey: 'old_q', optionIds: [] }]).map((p) => p.op), ['clear']);
  assert.deepEqual(planFromAnswers(qs, [], [{ questionKey: 'old_q', optionIds: ['a'] }]), []);
});

// ---- keys and fingerprints -------------------------------------------------------------------

test('keysOf mirrors choiceKeyStages: ids first, else texts, never null or empty', () => {
  assert.deepEqual(keysOf(sign('volunteer_request')), ['volunteer_request']);
  assert.deepEqual(keysOf({ answer: ['A', null, ''] }), ['A']);
  assert.deepEqual(keysOf({ answer: 'A', optionIds: [] }), ['A']);
  assert.deepEqual(keysOf({ answer: null }), []);
  assert.equal(isAnsweredRow({ type: 'multiple_choice' }, { answer: [], optionIds: [] }), false);
  assert.equal(isAnsweredRow({ type: 'text' }, { answer: '  ' }), true, 'counted in results, so answered');
});

test('the fingerprint survives a Mongoose re-cast, a string id and re-ordered keys — and nothing else', () => {
  const userId = new mongoose.Types.ObjectId();
  const lean = { userId, answers: [{ questionKey: 'q', questionLabel: 'Q', answer: 'A' }], editedBy: null, editedAt: null, note: 'n' };
  const recast = {
    userId: String(userId),
    note: 'other note',
    answers: [{ otherText: null, optionIds: [], answer: 'A', questionLabel: 'Q', questionKey: 'q' }],
  };
  assert.equal(fingerprint(lean), fingerprint(recast), 'defaults, id type, key order and the note never move it');
  assert.notEqual(fingerprint(lean), fingerprint({ ...lean, answers: [{ ...lean.answers[0], answer: 'B' }] }));
  assert.notEqual(fingerprint(lean), fingerprint({ ...lean, userId: new mongoose.Types.ObjectId() }));
  assert.notEqual(fingerprint(lean), fingerprint({ ...lean, editedBy: userId, editedAt: new Date('2026-10-19T12:00:00Z') }));
  assert.equal(fingerprint({ ...lean, editedAt: '2026-10-19T12:00:00.000Z', editedBy: String(userId) }), fingerprint({ ...lean, editedAt: new Date('2026-10-19T12:00:00Z'), editedBy: userId }));
  assert.notEqual(fingerprint({ answers: [{ answer: [] }] }), fingerprint({ answers: [{ answer: null }] }), '[] and null are different stored values');
  // The editors' version also covers the note and its stamp.
  assert.notEqual(editorVersion(lean), editorVersion({ ...lean, note: 'changed' }));
  assert.notEqual(editorVersion(lean), editorVersion({ ...lean, noteEditedAt: new Date() }));
  assert.equal(editorVersion(lean), editorVersion({ ...lean }));
});

test('summarizePlan reads the change in the survey’s own words', () => {
  const qs = yardQuestions();
  assert.equal(
    summarizePlan(qs, takeOutFakes(qs)),
    'Could you help us by taking a yard sign?: took out Volunteer Request, Candidate Follow-Up'
  );
  const plan = validatePlan(qs, [
    { questionKey: 'candidate_support', op: 'set', optionIds: ['undecided'] },
    { questionKey: 'comments', op: 'clear' },
    { questionKey: 'top_issue', op: 'adjust', remove: ['__other__'], removeTexts: ['Volunteer interest'], replaceWith: ['healthcare'] },
  ]);
  assert.equal(
    summarizePlan(qs, plan),
    'Can we count on your support?: changed to Undecided · Anything else?: cleared · What is your top issue?: took out Other, old answer "Volunteer interest"; put in Healthcare costs where one came out'
  );
});
