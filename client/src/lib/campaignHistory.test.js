import { test } from 'node:test';
import assert from 'node:assert';
import { labelForField, formatValue, isNotable, answerEditSentence, teamMoveSummary, walkListSentence } from './campaignHistory.js';

// The History rows for the two door settings. The server stores only the field key and raw values
// (a list as its sorted comma-join, an empty one as null), so a lost label or branch here breaks
// nothing loudly: the rows fall back to "Enabled Outcomes: not set → not_target" and "Door Add
// Policy: all → leads" (how that one read before its fix). Kept identical to
// mobile/lib/campaignHistory.test.js, as the two modules are.

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

// The walk-list archive rows (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.9): one sentence each, who did it
// first, built from the row's `details` with fixed templates — never by splitting its free-text
// strings, so a name holding "·" or "—" comes through whole.
const ADA = { id: 'u1', name: 'Ada', status: 'active' };
const archiveRow = (field, details, by = ADA) => ({ kind: 'config', field, by, details, fromValue: 'before', toValue: 'after' });
const sentence = (field, outcome, extra = {}) =>
  walkListSentence(archiveRow(field, { walkList: 'North', pass: 'Pass 3 · GOTV', outcome, ...extra }));

test('a walk-list archive row is one sentence for every outcome', () => {
  assert.strictEqual(sentence('walkListArchived', 'ended'), 'Ada archived walk list North — ended Pass 3 · GOTV');
  assert.strictEqual(sentence('walkListArchived', 'nothing-live', { pass: null }), 'Ada archived walk list North');
  assert.strictEqual(sentence('walkListUnarchived', 'brought-back'), 'Ada unarchived walk list North — brought back Pass 3 · GOTV');
  assert.strictEqual(sentence('walkListUnarchived', 'stayed-ended'), 'Ada unarchived walk list North — Pass 3 · GOTV stayed ended');
  assert.strictEqual(sentence('walkListUnarchived', 'nothing-ended', { pass: null }), 'Ada unarchived walk list North');
  assert.strictEqual(sentence('passArchived', 'by-hand'), 'Ada archived North · Pass 3 · GOTV');
  assert.strictEqual(sentence('passBroughtBack', 'live'), 'Ada brought back North · Pass 3 · GOTV');
  assert.strictEqual(sentence('passBroughtBack', 'draft'), 'Ada brought back North · Pass 3 · GOTV as a draft');
  // An auto-named pass arrives as just "Pass 2" (the server's passLabel); names are used whole.
  assert.strictEqual(
    sentence('walkListArchived', 'ended', { walkList: 'Elm St · East — 2', pass: 'Pass 2' }),
    'Ada archived walk list Elm St · East — 2 — ended Pass 2'
  );
  // A pass row whose walk list was already gone names the pass alone.
  assert.strictEqual(sentence('passArchived', 'by-hand', { walkList: null }), 'Ada archived Pass 3 · GOTV');
  // A departed actor is still named; a missing one reads as "Someone", as a crew move does.
  assert.strictEqual(walkListSentence(archiveRow('passArchived', { walkList: 'North', pass: 'Pass 1', outcome: 'by-hand' }, null)), 'Someone archived North · Pass 1');
});

test('the one-time repair reads "One-time check ended …", never "Unknown user"', () => {
  // The History route names the actorless row (routes/admin/campaigns.js).
  const system = { id: null, name: 'One-time check' };
  const repair = {
    ...archiveRow('passArchived', { walkList: 'North', pass: 'Pass 3 · GOTV', outcome: 'repair' }, system),
    fromValue: 'North · Pass 3 · GOTV · live',
    toValue: 'North · Pass 3 · GOTV · archived (one-time check)',
  };
  assert.strictEqual(walkListSentence(repair), 'One-time check ended North · Pass 3 · GOTV');
  // Should a repair row ever carry someone else's name, it still says where it came from.
  assert.strictEqual(walkListSentence({ ...repair, by: ADA }), 'Ada ended North · Pass 3 · GOTV (one-time check)');
  assert.strictEqual(walkListSentence({ ...repair, by: null }), 'Someone ended North · Pass 3 · GOTV (one-time check)');
});

test('walk-list rows are labelled, and one without its facts reads its plain strings', () => {
  assert.strictEqual(labelForField('walkListArchived'), 'Walk list archived');
  assert.strictEqual(labelForField('walkListUnarchived'), 'Walk list unarchived');
  assert.strictEqual(labelForField('passArchived'), 'Pass archived');
  assert.strictEqual(labelForField('passBroughtBack'), 'Pass brought back');
  // No details (or not the facts its sentence needs): no sentence, and the generic row reads the
  // readable strings the server stores for exactly this (old phones read them the same way).
  const bare = { kind: 'config', field: 'passArchived', by: ADA, fromValue: 'North · Pass 3 · live', toValue: 'North · Pass 3 · archived' };
  assert.strictEqual(walkListSentence(bare), null);
  assert.strictEqual(walkListSentence({ ...bare, details: { walkList: 'North', pass: null, outcome: 'by-hand' } }), null);
  assert.strictEqual(walkListSentence(archiveRow('walkListArchived', { walkList: null, pass: null, outcome: 'nothing-live' })), null);
  assert.strictEqual(row('passArchived', bare.fromValue, bare.toValue), 'Pass archived: North · Pass 3 · live → North · Pass 3 · archived');
  // Only the four walk-list fields get a sentence.
  assert.strictEqual(walkListSentence({ kind: 'config', field: 'doorGoal', by: ADA, details: { outcome: 'ended' } }), null);
});
