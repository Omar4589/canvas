import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prePick,
  historyLine,
  joinLine,
  movedReport,
  typedAnything,
  typedIgnoredLine,
  waitLine,
  fromOrgSummary,
  fromOrgLines,
} from './addPeople.js';

const HISTORY = {
  doors: 120,
  sources: [
    { coordinatorId: 'd1', name: 'Dana Cruz', doors: 100, canLead: true },
    { coordinatorId: null, name: null, doors: 20, canLead: false },
  ],
};

test('the pre-pick: the first team whose coordinator can still run a crew, when the select offers them', () => {
  assert.equal(prePick(HISTORY, ['d1', 'y1']), 'd1');
  assert.equal(prePick(HISTORY, ['y1']), '', 'not offered: No crew');
  const switchedOff = { doors: 9, sources: [{ coordinatorId: 'd1', name: 'Dana Cruz', doors: 9, canLead: false }] };
  assert.equal(prePick(switchedOff, ['d1']), '', 'can’t lead any more: No crew');
  const newestNone = { doors: 9, sources: [{ coordinatorId: null, doors: 4, canLead: false }, { coordinatorId: 'y1', doors: 5, canLead: true }] };
  assert.equal(prePick(newestNone, ['y1']), 'y1', 'the first that can lead, newest first');
  assert.equal(prePick({ doors: 0, sources: [] }, ['d1']), '');
});

test('what the step says about a returning person and their pick', () => {
  assert.equal(historyLine('Pat', HISTORY), 'Pat has 120 doors here from before: 100 on Dana Cruz’s team, 20 on No team.');
  assert.equal(historyLine('Pat', { doors: 0, sources: [] }), null, 'new here: nothing to say');
  assert.equal(joinLine(HISTORY, 'd1', 'Dana Cruz'), 'All 120 doors will count for Dana Cruz’s team; the ones on No team move there.');
  assert.equal(joinLine(HISTORY, '', null), 'All 120 doors will count for No team; the ones on Dana Cruz’s team move there.');
  assert.equal(joinLine(HISTORY, 'y1', 'Yan Ito'), 'All 120 doors will count for Yan Ito’s team.');
  const onlyDana = { doors: 3, sources: [{ coordinatorId: 'd1', name: 'Dana Cruz', doors: 3, canLead: true }] };
  assert.equal(joinLine(onlyDana, 'd1', 'Dana Cruz'), 'All 3 doors already count for Dana Cruz’s team.');
});

test('the teams’ own counts can overlap: they are named, never added up into a total', () => {
  // 100 doors, each once; 20 of them have work on both teams, so the teams say 80 and 40.
  const overlap = {
    doors: 100,
    sources: [
      { coordinatorId: 'd1', name: 'Dana Cruz', doors: 80, canLead: true },
      { coordinatorId: null, name: null, doors: 40, canLead: false },
    ],
  };
  assert.equal(
    historyLine('Pat', overlap),
    'Pat has 100 doors here from before: 80 on Dana Cruz’s team, 40 on No team. Some doors count for more than one team.'
  );
  assert.equal(joinLine(overlap, 'y1', 'Yan Ito'), 'All 100 doors will count for Yan Ito’s team.', 'the total, not 120');
  assert.doesNotMatch(joinLine(overlap, 'd1', 'Dana Cruz'), /\d+ move/, 'no count of what moves: it can’t be had from overlapping counts');
});

test('the after-add report says what moved and from which teams', () => {
  const restamp = { changed: true, doors: 120, activities: 130, surveys: 4, error: null, sources: [{ coordinatorId: 'd1', name: 'Dana Cruz', doors: 120 }] };
  assert.equal(movedReport('Pat', restamp, null), 'Pat’s 120 earlier doors moved from Dana Cruz’s team to No team.');
  assert.equal(movedReport('Pat', { ...restamp, error: 'boom' }, 'Yan Ito'), 'Pat’s 120 earlier doors didn’t finish moving to Yan Ito’s team. Open Pat and choose Finish it.');
  assert.equal(movedReport('Pat', { changed: true, doors: 0, activities: 0, surveys: 0 }, null), null, 'a hire with no history');
  assert.equal(movedReport('Pat', { changed: true, doors: 0, activities: 2, surveys: 0, sources: [] }, null), 'Pat’s earlier notes and marks moved to No team.');
});

test('typed details for someone who already has an account', () => {
  assert.equal(typedAnything({ firstName: '', lastName: ' ', phone: '', password: '' }), false);
  assert.equal(typedAnything({ firstName: 'Patricia' }), true);
  assert.equal(typedIgnoredLine('Pat'), 'Pat already has an account, so what you typed wasn’t used.');
});

test('a 429 says how long to wait, in minutes', () => {
  assert.equal(waitLine(30), 'You’ve checked a lot of email addresses in the last hour. Try again in 1 minute.');
  assert.equal(waitLine(1500), 'You’ve checked a lot of email addresses in the last hour. Try again in 25 minutes.');
});

test('From your organization: the summary counts every request, the no-crew path too', () => {
  const s = fromOrgSummary([
    { created: 24, total: 25, crew: { set: null, doors: 30, skipped: [{ userId: 'a', reason: 'already-on-campaign' }] } },
    { created: 2, total: 3, crew: { set: null, doors: 0, skipped: [{ userId: 'b', reason: 'unfinished' }, { userId: 'c', reason: 'error' }] } },
  ]);
  assert.deepEqual(s, { added: 26, already: 1, unfinished: 1, failed: 1, doors: 30 });
  assert.deepEqual(fromOrgLines(s, null), [
    'Added 26 people.',
    'Their 30 earlier doors here now count for No team.',
    '1 person was already on this campaign, so nothing changed for them.',
    '1 person’s earlier doors didn’t finish moving. Open them and choose Finish it.',
    '1 person couldn’t be added. Try them again.',
  ]);
});
