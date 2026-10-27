import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doorsPath, nextDoorsPage, doorRows, firstDoorsPage, RECENT_DOOR_ACTIONS } from './personDoors.js';

const page = (...ids) => ({ activities: ids.map((id) => ({ id, actionType: 'not_home' })) });

test('5 first, then 10 more per Show more', () => {
  const one = [page(1, 2, 3, 4, 5)];
  assert.deepEqual(nextDoorsPage(one, firstDoorsPage), { skip: 5, limit: 10 });
  const two = [...one, page(6, 7, 8, 9, 10, 11, 12, 13, 14, 15)];
  assert.deepEqual(nextDoorsPage(two, { skip: 5, limit: 10 }), { skip: 15, limit: 10 });
});

test('Show more stops on a short page, and on a page that adds nothing new (a server that ignores skip)', () => {
  assert.equal(nextDoorsPage([page(1, 2, 3)], firstDoorsPage), undefined, 'fewer than asked for');
  const replayed = [page(1, 2, 3, 4, 5), page(1, 2, 3, 4, 5, 1, 2, 3, 4, 5)];
  assert.equal(nextDoorsPage(replayed, { skip: 5, limit: 10 }), undefined, 'page one again');
  assert.equal(nextDoorsPage([], firstDoorsPage), undefined);
});

test('rows show once each, in order', () => {
  assert.deepEqual(doorRows([page(1, 2), page(2, 3)]).map((a) => a.id), [1, 2, 3]);
});

test('the two reads: the org’s, and one campaign’s with the shared action list (never notes)', () => {
  assert.equal(doorsPath({ userId: 'u7' }, { skip: 5, limit: 10 }), '/admin/memberships/u7/recent-activity?limit=10&skip=5');
  const team = doorsPath({ userId: 'u7', campaignId: 'c1' }, firstDoorsPage);
  assert.equal(
    team,
    '/admin/reports/canvassers/u7/activities?campaignId=c1&actionType=not_home,wrong_address,refused,survey_submitted,lit_dropped,no_soliciting,not_target,restricted&limit=5&skip=0'
  );
  assert.ok(!RECENT_DOOR_ACTIONS.includes('note_added'));
});
