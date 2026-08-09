import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOptionRows, voterAnswerClause, choiceKeyStages } from './answerAgg.js';
import { OTHER_OPTION_ID, otherBucketLabel } from './otherOption.js';

// The "Other: ___" write-in is a question FLAG, not a row in options[]. Everything here pins the
// seam that creates: reporting has to materialize the sentinel by hand, and the ways of getting
// that wrong are (a) leaving it an unmatched orphan labelled `__other__`, and (b) over-matching it
// by its display text, which is not stable — the stored `answer` is whatever the canvasser typed.

const q = (over = {}) => ({
  key: 'issue',
  label: 'Top issue?',
  type: 'single_choice',
  options: [
    { id: 'o_roads', text: 'Roads' },
    { id: 'o_schools', text: 'Schools' },
  ],
  ...over,
});

const rows = (obj) => Object.entries(obj).map(([_id, count]) => ({ _id, count }));

test('a write-in is a first-class bucket: real id, human label, not retired', () => {
  const out = mergeOptionRows(q({ otherOption: true }), rows({ o_roads: 5, [OTHER_OPTION_ID]: 3 }));
  const other = out.find((o) => o.id === OTHER_OPTION_ID);
  assert.ok(other, 'the sentinel must produce its own bucket');
  assert.equal(other.text, 'Other');
  assert.equal(other.retired, false);
  assert.equal(other.count, 3);
});

test('without otherOption the sentinel stays an orphan — the flag is what materializes it', () => {
  const out = mergeOptionRows(q({ otherOption: false }), rows({ [OTHER_OPTION_ID]: 3 }));
  const orphan = out.find((o) => o.text === OTHER_OPTION_ID);
  assert.ok(orphan);
  assert.equal(orphan.id, null);
  assert.equal(orphan.retired, true);
});

test('seeding never steals from a real option an operator named "Other"', () => {
  // The hazard: seeding the sentinel by TEXT would clobber this option in the byText map, so its
  // legacy text-keyed rows would be re-attributed to the write-in. Seed byId only.
  const question = q({
    otherOption: true,
    options: [{ id: 'o_roads', text: 'Roads' }, { id: 'o_other', text: 'Other' }],
  });
  const out = mergeOptionRows(question, rows({ Other: 4, [OTHER_OPTION_ID]: 3 }));
  const real = out.find((o) => o.id === 'o_other');
  const writeIn = out.find((o) => o.id === OTHER_OPTION_ID);
  assert.equal(real.count, 4, 'the legacy "Other" text belongs to the real option');
  assert.equal(writeIn.count, 3, 'the write-in keeps only its own id-native rows');
});

test('when a real option already owns the label, the write-in takes the longer name', () => {
  const question = q({
    otherOption: true,
    options: [{ id: 'o_other', text: 'Other' }],
  });
  assert.equal(otherBucketLabel(question), 'Other (specify)');
  assert.equal(otherBucketLabel(q({ otherOption: true })), 'Other');
  const out = mergeOptionRows(question, rows({ [OTHER_OPTION_ID]: 1, Other: 1 }));
  const labels = out.map((o) => o.text);
  assert.equal(new Set(labels).size, labels.length, 'no two buckets may share a label');
});

test('counts still reconcile: every row lands in exactly one bucket', () => {
  const out = mergeOptionRows(
    q({ otherOption: true }),
    rows({ o_roads: 5, o_schools: 2, [OTHER_OPTION_ID]: 3, 'Deleted Option': 1 })
  );
  assert.equal(out.reduce((s, o) => s + o.count, 0), 11);
});

test('the drill matches a write-in by ID ONLY — its text is not stable', () => {
  // `answer` holds the typed text ("potholes"), never the label, so a text lane can never find a
  // real write-in. Worse, it steals: an option named "Other", a legacy row reading "Other", and
  // any multi-select array containing "Other". Measured 6 hits against a 3-row truth before this.
  const clause = voterAnswerClause('issue', OTHER_OPTION_ID, 'Other');
  assert.deepEqual(clause, { $or: [{ answers: { $elemMatch: { questionKey: 'issue', optionIds: OTHER_OPTION_ID } } }] });
  assert.equal(clause.$or.length, 1, 'no legacy answer-text branch for the sentinel');
});

test('a normal option keeps BOTH lanes — id-native and legacy text', () => {
  const clause = voterAnswerClause('issue', 'o_roads', 'Roads');
  assert.equal(clause.$or.length, 2);
  assert.deepEqual(clause.$or[1], { answers: { $elemMatch: { questionKey: 'issue', answer: 'Roads' } } });
});

test('an orphan bucket (id null) still matches by its raw text', () => {
  const clause = voterAnswerClause('issue', null, 'Deleted Option');
  assert.deepEqual(clause.$or, [{ answers: { $elemMatch: { questionKey: 'issue', answer: 'Deleted Option' } } }]);
});

test('nothing selectable matches nothing — never everything', () => {
  assert.deepEqual(voterAnswerClause('issue', null, null), { _id: null });
});

test('choiceKeyStages groups on optionIds when present, so a write-in keys on the sentinel', () => {
  const stages = choiceKeyStages('issue');
  const addFields = stages.find((s) => s.$addFields);
  const cond = addFields.$addFields._answerKeys.$cond;
  // id-native branch first: a row carrying optionIds never falls back to its typed snapshot.
  assert.deepEqual(cond[1], '$answers.optionIds');
});
