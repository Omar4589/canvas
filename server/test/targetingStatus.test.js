import { test } from 'node:test';
import assert from 'node:assert';
import {
  resolveStatus,
  resolveTargetingStatus,
  resolveTargetingStatusFromSummary,
  ANSWERED_ACTIONS,
} from '../src/utils/statusPrecedence.js';

// The TARGETING ladder (Turf Cutting's Target / Exclude doors, the two cut boxes, the saved-search
// Door status filter): what a status tick means when a round is re-cut or a new walk list is
// built. Pins the owner's 2026-10-13 ruling — the door's whole history, in order: Restricted
// wins every time; then Surveyed in any round; then an answered outcome (newest of them); then
// Not home when nobody ever answered; Unknocked when nobody ever visited — and that the row form
// and the summary form agree on a JS-built summary. The real $group that feeds the summary form
// (services/walklist/targetingStatus.js) is exercised end to end by turfTargeting.int.test.js.

const row = (actionType, minute) => ({ actionType, timestamp: new Date(Date.UTC(2026, 9, 13, 14, minute)) });
const seq = (...types) => types.map((t, i) => row(t, i));

// What the aggregate hands the summary form: the action set, the newest row, and the newest
// answered row (null when nobody ever answered).
const summaryOf = (rows) => {
  const live = rows.filter((r) => r.actionType !== 'note_added');
  const newest = (list) => list.reduce((m, r) => (!m || r.timestamp > m.timestamp ? r : m), null);
  return {
    actions: [...new Set(live.map((r) => r.actionType))],
    latestActionType: newest(live)?.actionType,
    latestAnsweredActionType: newest(live.filter((r) => ANSWERED_ACTIONS.includes(r.actionType)))?.actionType,
  };
};
const both = (type, rows) => {
  const a = resolveTargetingStatus(type, rows);
  const b = resolveTargetingStatusFromSummary(type, summaryOf(rows));
  assert.equal(a, b, `row form (${a}) and summary form (${b}) must agree for ${rows.map((r) => r.actionType).join(' → ')}`);
  return a;
};

test('rung 1: restricted wins every time, in any order, over a survey and over a later knock', () => {
  assert.equal(both('survey', seq('restricted')), 'restricted');
  assert.equal(both('survey', seq('restricted', 'not_home')), 'restricted', 'a desk mark the crew knocked through still reads restricted');
  assert.equal(both('survey', seq('not_home', 'restricted')), 'restricted');
  assert.equal(both('survey', seq('survey_submitted', 'restricted')), 'restricted', 'surveyed in round 1, desk-marked in round 2');
  assert.equal(both('survey', seq('restricted', 'survey_submitted')), 'restricted');
  assert.equal(both('survey', seq('refused', 'restricted', 'not_home')), 'restricted');
  assert.equal(both('lit_drop', seq('lit_dropped', 'restricted')), 'restricted');
  assert.equal(resolveStatus('survey', seq('restricted', 'not_home')), 'not_home', 'coverage/Map/phones keep the latest visit');
});

test('rung 2: a completion wins over everything but restricted, whatever came before or after', () => {
  assert.equal(both('survey', seq('not_home', 'survey_submitted')), 'surveyed');
  assert.equal(both('survey', seq('survey_submitted', 'not_home')), 'surveyed');
  assert.equal(both('survey', seq('refused', 'survey_submitted', 'not_home')), 'surveyed');
  assert.equal(both('lit_drop', seq('not_home', 'lit_dropped')), 'lit_dropped');
  assert.equal(both('lit_drop', seq('lit_dropped', 'refused')), 'lit_dropped');
});

test('rung 3: an answered outcome beats not-home in either order; several → the newest of them', () => {
  for (const a of ANSWERED_ACTIONS) {
    const want = { refused: 'refused', wrong_address: 'wrong_address', no_soliciting: 'no_soliciting', not_target: 'not_target' }[a];
    assert.equal(both('survey', seq(a, 'not_home')), want, `${a} then not_home`);
    assert.equal(both('survey', seq('not_home', a)), want, `not_home then ${a}`);
  }
  assert.equal(both('survey', seq('refused', 'wrong_address')), 'wrong_address');
  assert.equal(both('survey', seq('wrong_address', 'refused')), 'refused');
  assert.equal(both('survey', seq('refused', 'not_home', 'no_soliciting', 'not_home')), 'no_soliciting');
  assert.equal(resolveStatus('survey', seq('refused', 'not_home')), 'not_home', 'the one row the owner changed first');
});

test('rungs 4 and 5: only not-homes, and nothing at all', () => {
  assert.equal(both('survey', []), 'unknocked');
  assert.equal(both('survey', seq('note_added')), 'unknocked', 'a note is not a visit');
  assert.equal(both('survey', seq('not_home')), 'not_home');
  assert.equal(both('survey', seq('not_home', 'not_home', 'not_home')), 'not_home');
  // The other campaign type's completion is the only row left: it still reads through the table.
  assert.equal(both('survey', seq('lit_dropped')), 'lit_dropped');
});

test('the ladder is history, not recency: it agrees with resolveStatus only when the two coincide', () => {
  const same = [[], seq('not_home'), seq('not_home', 'refused'), seq('not_home', 'wrong_address'), seq('not_home', 'restricted'), seq('survey_submitted', 'not_home'), seq('refused')];
  for (const rows of same) assert.equal(both('survey', rows), resolveStatus('survey', rows), rows.map((r) => r.actionType).join(' → ') || '(none)');
  const differ = [seq('refused', 'not_home'), seq('restricted', 'not_home'), seq('survey_submitted', 'restricted'), seq('wrong_address', 'not_home')];
  for (const rows of differ) assert.notEqual(both('survey', rows), resolveStatus('survey', rows), rows.map((r) => r.actionType).join(' → '));
});
