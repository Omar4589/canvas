import { test } from 'node:test';
import assert from 'node:assert';
import { EXPORT_TYPE_META, mergeTypeMeta, paramsFor, outcomeKeysFor, optionsToRemember, knockSplitLine, estimateLineFor, perKnockJobBits } from './exportTypes.js';

// The server registry's copy laid over the local fallback (GET /admin/exports/types). The export
// sheet names Not a target voter only on a campaign that uses it, so it needs BOTH forms of a
// description from the server: `desc`, which never names the outcome, and `descNotTargetInUse`.
// A merge that dropped the second form would silently show every campaign the plain copy.

const server = [
  { id: 'canvass-activity', label: 'Canvassing activity', desc: 'plain', descNotTargetInUse: 'named', filters: ['date'] },
  { id: 'voter-file', label: 'Voter file', desc: 'voters', descNotTargetInUse: null, filters: ['import'] },
];

test('the server copy wins, and the outcome-naming form rides along', () => {
  const byId = Object.fromEntries(mergeTypeMeta(server).map((m) => [m.id, m]));
  assert.equal(byId['canvass-activity'].desc, 'plain');
  assert.equal(byId['canvass-activity'].descNotTargetInUse, 'named');
  assert.equal(byId['voter-file'].descNotTargetInUse, null, 'a type whose copy never names it');
  assert.equal(byId['canvass-activity'].sub, EXPORT_TYPE_META[0].sub, 'mobile-only fields stay local');
});

test('before the server answers, and from an older server, no type has a naming form', () => {
  for (const merged of [mergeTypeMeta(undefined), mergeTypeMeta([{ id: 'canvass-activity', desc: 'old server' }])]) {
    for (const m of merged) assert.ok(!m.descNotTargetInUse, `${m.id}: nothing to show but desc`);
  }
  for (const m of EXPORT_TYPE_META) {
    assert.ok(!/not a target/i.test(m.desc), `${m.id}: the local fallback never names the outcome`);
  }
});

// ── One row per knock (docs/PROPOSAL_ONE_ROW_PER_KNOCK.md) ───────────────────────────────────

const ACTIVITY_SERVER = {
  id: 'canvass-activity',
  filters: ['date', 'effort', 'pass', 'canvasser', 'outcome', 'onePerKnock', 'perVoterRows', 'surveyAnswers'],
};
const ALL_KEYS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'restricted', 'no_soliciting', 'not_target', 'note_added'];

test('the local fallback never carries onePerKnock: the switch shows only where the server advertises it', () => {
  const local = EXPORT_TYPE_META.find((m) => m.id === 'canvass-activity');
  assert.ok(!local.filters.includes('onePerKnock'));
  const merged = mergeTypeMeta([ACTIVITY_SERVER]).find((m) => m.id === 'canvass-activity');
  assert.ok(merged.filters.includes('onePerKnock'), 'a server that knows it turns it on');
});

test('outcomeKeysFor: Restricted and Note added leave while One row per knock is on; Not a target by campaign', () => {
  const meta = ACTIVITY_SERVER;
  assert.deepStrictEqual(outcomeKeysFor(meta, ALL_KEYS, {}), ALL_KEYS.filter((k) => k !== 'not_target'));
  assert.deepStrictEqual(
    outcomeKeysFor(meta, ALL_KEYS, { onePerKnock: true, notTargetInUse: true }),
    ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting', 'not_target']
  );
  // A meta without the token (an older server) ignores a stale switch.
  assert.ok(outcomeKeysFor({ filters: ['outcome'] }, ALL_KEYS, { onePerKnock: true }).includes('restricted'));
});

test('paramsFor: onePerKnock rides only where the type takes it, and narrows the chips by the same rule', () => {
  const p = paramsFor(ACTIVITY_SERVER, { onePerKnock: true, actionTypes: ['not_home', 'restricted', 'note_added'] });
  assert.deepStrictEqual(p, { onePerKnock: true, actionTypes: ['not_home'] });
  // Only hidden chips ticked: nothing rides (every knock), never an empty list.
  assert.deepStrictEqual(paramsFor(ACTIVITY_SERVER, { onePerKnock: true, actionTypes: ['restricted'] }), { onePerKnock: true });
  // Off, the chips ride as today.
  assert.deepStrictEqual(paramsFor(ACTIVITY_SERVER, { actionTypes: ['restricted'] }), { actionTypes: ['restricted'] });
  // A type without the token never sends it.
  assert.deepStrictEqual(paramsFor({ filters: ['outcome'] }, { onePerKnock: true, actionTypes: ['restricted'] }), { actionTypes: ['restricted'] });
});

test('optionsToRemember: only Include survey answers, only for a type that carries it', () => {
  assert.deepStrictEqual(optionsToRemember(ACTIVITY_SERVER, { includeSurveyAnswers: true, onePerKnock: true }), { includeSurveyAnswers: true });
  assert.deepStrictEqual(optionsToRemember(ACTIVITY_SERVER, {}), { includeSurveyAnswers: false });
  // The old wipe: queueing another type saved includeSurveyAnswers: false over the choice.
  for (const id of ['doors-by-round', 'survey-results', 'voter-file']) {
    assert.strictEqual(optionsToRemember(EXPORT_TYPE_META.find((m) => m.id === id), {}), null, id);
  }
});

test('knockSplitLine mirrors the web wording', () => {
  assert.strictEqual(knockSplitLine({ onePerKnock: true }, { rows: 4697, surveyRows: 14 }), '4,683 knocks + 14 more people surveyed');
  assert.strictEqual(knockSplitLine({ onePerKnock: true, perVoterRows: true }, { rows: 9000, surveyRows: 1 }), 'includes 1 more person surveyed');
  assert.strictEqual(knockSplitLine({}, { rows: 4707, surveyRows: 14 }), null);
  assert.strictEqual(knockSplitLine({ onePerKnock: true }, { rows: 4683, surveyRows: 0 }), null);
});

test('estimateLineFor labels a count by the params it was COUNTED for, never by switches that moved since', () => {
  const perKnock = { onePerKnock: true };
  assert.strictEqual(estimateLineFor({ rows: 4697, surveyRows: 14, asked: perKnock }), '≈ 4,683 knocks + 14 more people surveyed');
  assert.strictEqual(estimateLineFor({ rows: 4683, surveyRows: 0, asked: perKnock }), '≈ 4,683 knocks');
  assert.strictEqual(
    estimateLineFor({ rows: 9000, surveyRows: 14, asked: { onePerKnock: true, perVoterRows: true } }),
    '≈ 9,000 rows · includes 14 more people surveyed'
  );
  // An answer counted WITHOUT the option (still on screen after the switch flipped): plain rows.
  assert.strictEqual(estimateLineFor({ rows: 4707, asked: {} }), '≈ 4,707 rows');
  assert.strictEqual(estimateLineFor({ rows: null, rowsUnavailable: true, asked: perKnock }), 'Row count not available for this one — you can still queue');
  // Today's lines are unchanged for every other answer.
  assert.strictEqual(estimateLineFor({ rows: 120, rowsAreFloor: true, dncWithheld: 2 }), 'at least 120 rows · 2 withheld (do not contact)');
  assert.strictEqual(estimateLineFor({ rows: 30, files: [{}, {}], contentKind: 'zip' }), '≈ 30 rows · 2 files — one per survey · ZIP');
  assert.strictEqual(estimateLineFor(undefined), null);
});

test('perKnockJobBits: the history line says per knock, with the split when there are survey rows', () => {
  assert.deepStrictEqual(perKnockJobBits({ params: { onePerKnock: true }, rowCount: 4697, surveyRowCount: 14 }), ['per knock', '4,683 knocks + 14 more people surveyed']);
  assert.deepStrictEqual(perKnockJobBits({ params: { onePerKnock: true }, rowCount: 4683 }), ['per knock']);
  assert.deepStrictEqual(perKnockJobBits({ params: { includeSurveyAnswers: true }, rowCount: 4707, surveyRowCount: 0 }), []);
});
