import { test } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import {
  KNOCK_ACTIONS,
  BILLABLE_WITH_RESTRICTED,
  NOT_DESK_MARK,
  fieldVisitMatch,
  fieldVisitActionTypes,
} from '../src/services/reports/aggregations.js';

// "A canvasser was at a door" is now ONE sentence, shared by the billing clock
// (services/billing/statement.js) and the Results by voter export's universe. This file is the
// gate: the shared version must still be the exact filter billing has always run, or a customer's
// first-billed month moves under them.
const id = new mongoose.Types.ObjectId();

test('fieldVisitMatch is the filter billing has always used', () => {
  assert.deepStrictEqual(fieldVisitMatch(id), {
    campaignId: id,
    actionType: { $in: ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting', 'restricted'] },
    $nor: [{ actionType: 'restricted', via: 'bulk' }],
  });
});

test('a field restriction counts; a desk restriction does not', () => {
  const m = fieldVisitMatch(id);
  assert.ok(m.actionType.$in.includes('restricted'), 'the walk was made — it starts the billing clock');
  assert.deepStrictEqual(m.$nor, [{ actionType: 'restricted', via: 'bulk' }], 'desk marks are not visits');
  assert.ok(!m.actionType.$in.includes('note_added'), 'a note is not a visit');
  // NOT a blanket NOT_BULK: a via:'bulk' row on a KNOCK action stays a real billable knock.
  assert.ok(!('via' in m), 'a blanket via filter would delete billable knocks from the invoice');
});

test('NOT_DESK_MARK is frozen — a caller cannot mutate the shared clause', () => {
  assert.throws(() => {
    NOT_DESK_MARK.$nor = [];
  }, TypeError);
});

test('fieldVisitActionTypes intersects with the caller chips instead of colliding', () => {
  assert.deepStrictEqual(fieldVisitActionTypes(), [...BILLABLE_WITH_RESTRICTED], 'no chips = every field visit');
  assert.deepStrictEqual(fieldVisitActionTypes([]), [...BILLABLE_WITH_RESTRICTED], 'an empty selection is not a filter');
  assert.deepStrictEqual(fieldVisitActionTypes(['not_home', 'refused']), ['not_home', 'refused']);
  assert.deepStrictEqual(fieldVisitActionTypes(['not_home', 'note_added']), ['not_home'], 'a note can never become a visit');
  assert.deepStrictEqual(fieldVisitActionTypes(['restricted']), ['restricted']);
});

test('chips that intersect to nothing mean ZERO ROWS, never "no filter"', () => {
  assert.strictEqual(fieldVisitActionTypes(['note_added']), null);
  // The null is the whole point: a caller that treats it as "absent" inverts its own filter and
  // ships every field visit for a selection that asked for none.
  assert.strictEqual(fieldVisitActionTypes(['made_up_action']), null);
});

// Why fieldVisitActionTypes exists at all: BOTH halves own the `actionType` key, so composing by
// spread silently drops one of them — in one direction the operator's chips vanish, in the other
// the billing set does and `note_added` becomes a field visit. Pinned so the comment cannot rot.
test('spreading the predicate into a chip filter silently loses one of them', () => {
  const chips = { actionType: { $in: ['survey_submitted', 'note_added'] } };
  assert.deepStrictEqual(
    { ...fieldVisitMatch(id), ...chips }.actionType.$in,
    ['survey_submitted', 'note_added'],
    'billing set gone, and a note now counts as a visit'
  );
  assert.deepStrictEqual(
    { ...chips, ...fieldVisitMatch(id) }.actionType.$in,
    [...BILLABLE_WITH_RESTRICTED],
    "the operator's chips gone"
  );
  // The correct composition keeps both.
  assert.deepStrictEqual(fieldVisitActionTypes(chips.actionType.$in), ['survey_submitted']);
});

test('KNOCK_ACTIONS is unchanged — restricted is a visit, never a knock', () => {
  assert.ok(!KNOCK_ACTIONS.includes('restricted'));
  assert.strictEqual(BILLABLE_WITH_RESTRICTED.length, KNOCK_ACTIONS.length + 1);
});
