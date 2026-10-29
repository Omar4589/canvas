import { test } from 'node:test';
import assert from 'node:assert';
import { register } from 'node:module';

// campaignHistory.js imports './goalPace' and './theme' with no extension, which Metro resolves and
// node's ESM loader refuses. This hook retries such a relative import with '.js' (what Metro picks
// here), so the test loads the real file as it ships. It has to be registered before the module is
// imported, hence the dynamic import below.
const RESOLVE_JS = `export const resolve = async (specifier, context, next) => {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || specifier.endsWith('.js')) throw err;
    return next(specifier + '.js', context);
  }
};`;
register(`data:text/javascript,${encodeURIComponent(RESOLVE_JS)}`);
const { labelForField, formatValue, isNotable, answerEditSentence, teamMoveSummary, walkListSentence, actorLabel } = await import(
  './campaignHistory.js'
);

// The History rows for the two door settings. The server stores only the field key and raw values
// (a list as its sorted comma-join, an empty one as null), so a lost label or branch here breaks
// nothing loudly: the rows fall back to "Enabled Outcomes: not set → not_target" and "Door Add
// Policy: all → leads" (how that one read before its fix). Kept identical to
// client/src/lib/campaignHistory.test.js, as the two modules are.

// A row's three strings, joined the way the docs write one.
const row = (field, fromValue, toValue) =>
  `${labelForField(field)}: ${formatValue(field, fromValue)} → ${formatValue(field, toValue)}`;

test('an off-by-default outcome reads as its label both ways, and an empty list reads "none"', () => {
  assert.strictEqual(row('enabledOutcomes', null, 'not_target'), 'Off-by-default outcomes: none → Not a target voter');
  assert.strictEqual(row('enabledOutcomes', 'not_target', null), 'Off-by-default outcomes: Not a target voter → none');
  // Every campaign is born with nothing extra on: empty is "none", never the generic "not set".
  assert.strictEqual(formatValue('enabledOutcomes', undefined), 'none');
  assert.strictEqual(formatValue('enabledOutcomes', ''), 'none');
});

test('switching an off-by-default outcome on or off is highlighted', () => {
  // The trust decision behind an outcome nobody can check: the row is the record of who and when.
  const item = { kind: 'config', field: 'enabledOutcomes' };
  assert.strictEqual(isNotable({ ...item, fromValue: null, toValue: 'not_target' }), true, 'on');
  assert.strictEqual(isNotable({ ...item, fromValue: 'not_target', toValue: null }), true, 'off');
});

test('the Add-person policy reads in words both ways, and an unset one reads as everyone', () => {
  assert.strictEqual(
    row('doorAddPolicy', 'all', 'leads'),
    'Adding people at the door: Everyone on the campaign → Team leads & admins only'
  );
  assert.strictEqual(
    row('doorAddPolicy', 'leads', 'all'),
    'Adding people at the door: Team leads & admins only → Everyone on the campaign'
  );
  // 'all' is the schema default, so a campaign saved before the setting existed reads as it.
  assert.strictEqual(formatValue('doorAddPolicy', null), 'Everyone on the campaign');
});

test('the Door Outcomes acts read in words, are highlighted, and an answer edit is one sentence', () => {
  assert.strictEqual(row('surveyConversion', 'not_home', 'survey_submitted'), 'Surveyed entries: Not home → Surveyed');
  assert.strictEqual(row('surveyConversion', 'mixed', 'survey_submitted'), 'Surveyed entries: several outcomes → Surveyed');
  assert.strictEqual(row('unknock', 'recorded', 'unknocked'), 'Entries: recorded → unknocked');
  for (const field of ['surveyConversion', 'unknock', 'answerEdit', 'answerEditUndo']) {
    assert.strictEqual(isNotable({ kind: 'config', field }), true, field);
  }
  assert.deepStrictEqual(answerEditSentence({ field: 'answerEdit', toValue: 'Q3: took out A (214 surveys)' }), {
    headline: 'Survey answers edited',
    detail: 'Q3: took out A (214 surveys)',
  });
  assert.strictEqual(
    answerEditSentence({ field: 'answerEditUndo', toValue: '212 surveys put back, 2 kept newer answers', fromValue: 'Q3: took out A' }).detail,
    '212 surveys put back, 2 kept newer answers — Q3: took out A'
  );
});

// A crew move's sentence: doors (not rows), surveys or notes when no doors moved, a change that didn't
// finish, and one a later change finished. Kept identical in both copies.
test('a crew move says doors, then surveys, then notes; an unfinished one and a finished-later one say so', () => {
  const base = { user: { name: 'Pat' }, fromCoordinator: { name: 'Dana' }, toCoordinator: { name: 'Yan' } };
  assert.deepStrictEqual(teamMoveSummary({ ...base, doorsMoved: 3, activitiesMoved: 3, rowsMoved: 6, surveysMoved: 1 }), {
    headline: 'Pat: Dana → Yan',
    detail: '3 doors moved to Yan',
  });
  assert.strictEqual(teamMoveSummary({ ...base, doorsMoved: 0, activitiesMoved: 0, surveysMoved: 2 }).detail, '2 surveys moved to Yan');
  assert.strictEqual(teamMoveSummary({ ...base, toCoordinator: null, doorsMoved: 0, activitiesMoved: 0, rowsMoved: 3 }).detail, 'Notes and marks moved to no team');
  assert.strictEqual(teamMoveSummary({ ...base, doorsMoved: 0, activitiesMoved: 0 }).detail, 'No recorded work moved with them');
  assert.strictEqual(teamMoveSummary({ ...base, doorsMoved: 1, restampError: 'boom' }).detail, "Didn't finish moving 1 door to Yan");
  assert.strictEqual(teamMoveSummary({ ...base, doorsMoved: 4, finishedBy: 'x' }).detail, '4 doors moved to Yan · Finished by a later change');
  assert.strictEqual(teamMoveSummary({ ...base, fromCoordinator: { name: 'Several teams' }, activitiesMoved: 2 }).headline, 'Pat: Several teams → Yan');
  assert.strictEqual(teamMoveSummary({ ...base, activitiesMoved: 5 }).detail, '5 doors moved to Yan', 'an older server: activitiesMoved only');
});

// Walk-list lifecycle rows (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.9): one sentence per outcome, built
// from `details` alone — the from/to strings below are deliberately different, to prove they're never
// read. Same sentences as client/src/lib/campaignHistory.test.js.
test('every walk-list and pass lifecycle outcome reads as its sentence, from the details alone', () => {
  const ADA = { id: 'u1', name: 'Ada', status: 'active' };
  const row = (field, outcome, extra = {}, by = ADA) => ({
    kind: 'config',
    field,
    by,
    fromValue: 'not read',
    toValue: 'not read either',
    details: { walkList: 'North', pass: 'Pass 3 · GOTV', outcome, ...extra },
  });
  const cases = [
    [row('walkListArchived', 'ended'), 'Ada archived walk list North — ended Pass 3 · GOTV'],
    [row('walkListArchived', 'nothing-live', { pass: null }), 'Ada archived walk list North'],
    [row('walkListUnarchived', 'brought-back'), 'Ada unarchived walk list North — brought back Pass 3 · GOTV'],
    [row('walkListUnarchived', 'stayed-ended'), 'Ada unarchived walk list North — Pass 3 · GOTV stayed ended'],
    [row('walkListUnarchived', 'nothing-ended', { pass: null }), 'Ada unarchived walk list North'],
    [row('passArchived', 'by-hand'), 'Ada archived North · Pass 3 · GOTV'],
    [row('passBroughtBack', 'live'), 'Ada brought back North · Pass 3 · GOTV'],
    [row('passBroughtBack', 'draft'), 'Ada brought back North · Pass 3 · GOTV as a draft'],
    // The server names the actorless repair row; it isn't said twice.
    [row('passArchived', 'repair', {}, { id: null, name: 'One-time check' }), 'One-time check ended North · Pass 3 · GOTV'],
    [row('passArchived', 'repair'), 'Ada ended North · Pass 3 · GOTV (one-time check)'],
    [row('passArchived', 'by-hand', {}, null), 'Someone archived North · Pass 3 · GOTV'],
  ];
  for (const [item, sentence] of cases) {
    assert.strictEqual(walkListSentence(item), sentence, `${item.field} ${item.details.outcome}`);
  }
  // An auto-named pass is just its number (the server's passLabel), and names are free text: a walk
  // list called "North — Pass 9" stays whole, never split.
  assert.strictEqual(
    walkListSentence(row('passArchived', 'by-hand', { walkList: 'North — Pass 9', pass: 'Pass 2' })),
    'Ada archived North — Pass 9 · Pass 2'
  );
  // A pass whose walk list was gone when the row was written names the pass alone.
  assert.strictEqual(walkListSentence(row('passBroughtBack', 'live', { walkList: null })), 'Ada brought back Pass 3 · GOTV');
});

test('a lifecycle row without usable details falls back to the label row, which old phones show too', () => {
  const base = { kind: 'config', field: 'walkListArchived', fromValue: 'North · live (Pass 3 · GOTV)', toValue: 'North · archived · Pass 3 · GOTV ended' };
  assert.strictEqual(walkListSentence(base), null, 'no details');
  assert.strictEqual(walkListSentence({ ...base, details: { walkList: 'North', pass: 'Pass 3', outcome: 'mystery' } }), null, 'unknown outcome');
  assert.strictEqual(walkListSentence({ ...base, details: { walkList: 'North', pass: null, outcome: 'ended' } }), null, 'an ended pass with no name');
  assert.strictEqual(walkListSentence({ ...base, details: { walkList: null, pass: 'Pass 3', outcome: 'ended' } }), null, 'a walk-list row with no name');
  // Any other row with details is not a lifecycle row.
  assert.strictEqual(walkListSentence({ kind: 'config', field: 'doorGoal', details: { outcome: 'ended' } }), null);
  // The fallback reads in words: the label, and the server's readable from/to strings as they are.
  assert.strictEqual(labelForField('walkListArchived'), 'Walk list archived');
  assert.strictEqual(labelForField('walkListUnarchived'), 'Walk list unarchived');
  assert.strictEqual(labelForField('passArchived'), 'Pass archived');
  assert.strictEqual(labelForField('passBroughtBack'), 'Pass brought back');
  assert.strictEqual(formatValue('walkListArchived', base.toValue), 'North · archived · Pass 3 · GOTV ended');
  // Ordinary upkeep, not flagged for review.
  for (const field of ['walkListArchived', 'walkListUnarchived', 'passArchived', 'passBroughtBack']) {
    assert.strictEqual(isNotable({ kind: 'config', field }), false, field);
  }
});

test('the one-time check is named plainly; a departed person still says so', () => {
  // The History route's actor for a repair row nobody made.
  assert.strictEqual(actorLabel({ id: null, name: 'One-time check', status: 'system' }), 'One-time check');
  assert.strictEqual(actorLabel({ id: 'u1', name: 'Lee Lead', status: 'deactivated' }), 'Lee Lead (deactivated)');
  assert.strictEqual(actorLabel({ id: 'u1', name: 'Ada', status: 'active' }), 'Ada');
  assert.strictEqual(actorLabel(null), 'Unknown user');
});
