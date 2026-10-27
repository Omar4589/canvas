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
const { labelForField, formatValue, isNotable, answerEditSentence, teamMoveSummary } = await import('./campaignHistory.js');

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
