import { test } from 'node:test';
import assert from 'node:assert';
import { isForeignRoster, answeredByDoorline, rosterErrorIsFinal, seatedRosterView } from './seatedRoster.js';

const A = { campaign: { id: 'A' }, households: [1] };
const B = { campaign: { id: 'B' }, households: [2] };
const failed = (campaignId, extra = {}) => Object.assign(new Error('Request timed out'), { campaignId, ...extra });

test('isForeignRoster: only a roster for another campaign', () => {
  assert.equal(isForeignRoster(A, 'B'), true);
  assert.equal(isForeignRoster(A, 'A'), false);
  assert.equal(isForeignRoster({ campaign: { id: 7 } }, '7'), false, 'ids compare as strings');
  assert.equal(isForeignRoster(undefined, 'B'), false, 'nothing cached');
  assert.equal(isForeignRoster(A, undefined), false, 'no campaign seated yet');
});

test('rosterErrorIsFinal: a 4xx answer from Doorline, except 401 and 429', () => {
  const answer = (status) => ({ status, data: { error: 'Campaign inactive' } });
  for (const status of [400, 403, 404, 410]) assert.equal(rosterErrorIsFinal(answer(status)), true, String(status));
  for (const status of [401, 429, 500, 503]) assert.equal(rosterErrorIsFinal(answer(status)), false, String(status));
  assert.equal(rosterErrorIsFinal({ status: 403, data: { raw: '<html>Accept the terms</html>' } }), false, 'a captive portal');
  assert.equal(rosterErrorIsFinal({ status: 404, data: null }), false, 'an empty body is no answer of ours');
  assert.equal(rosterErrorIsFinal(new Error('Request timed out')), false, 'no signal has no status');
  assert.equal(rosterErrorIsFinal(null), false);
  assert.equal(answeredByDoorline({ status: 503, data: { error: 'Sign-in check unavailable. Try again.' } }), true);
  assert.equal(answeredByDoorline({ status: 404, data: { raw: '<html>' } }), false);
  assert.equal(answeredByDoorline(new Error('Request timed out')), false);
});

test('this campaign: its roster and its failures show as before', () => {
  assert.deepEqual(seatedRosterView({ roster: B, error: null, campaignId: 'B' }), { data: B, error: null, waiting: false });
  const err = failed('B');
  assert.deepEqual(seatedRosterView({ roster: B, error: err, campaignId: 'B' }), { data: B, error: err, waiting: false });
  assert.deepEqual(seatedRosterView({ roster: undefined, error: err, campaignId: 'B' }), { data: undefined, error: err, waiting: false });
  const untagged = new Error('older build');
  assert.equal(seatedRosterView({ roster: B, error: untagged, campaignId: 'B' }).error, untagged, 'an untagged failure counts');
  assert.deepEqual(seatedRosterView({ roster: undefined, error: null, campaignId: 'B' }), { data: undefined, error: null, waiting: false }, 'a first load is the query\'s own loading');
});

test('another campaign\'s roster is never shown, and the screen waits for its own', () => {
  assert.deepEqual(seatedRosterView({ roster: A, error: null, campaignId: 'B' }), { data: undefined, error: null, waiting: true });
  // The previous campaign's failure is not this campaign's: still waiting, never its error screen.
  assert.deepEqual(seatedRosterView({ roster: A, error: failed('A', { status: 404 }), campaignId: 'B' }), { data: undefined, error: null, waiting: true });
  assert.deepEqual(seatedRosterView({ roster: undefined, error: failed('A'), campaignId: 'B' }), { data: undefined, error: null, waiting: true });
  // This campaign's own failure ends the wait (no fetch loop): the error screen.
  const own = failed('B');
  assert.deepEqual(seatedRosterView({ roster: A, error: own, campaignId: 'B' }), { data: undefined, error: own, waiting: false });
});

test('a cancelled refresh is not a failure', () => {
  const cancel = new Error('CancelledError');
  assert.deepEqual(seatedRosterView({ roster: B, error: cancel, cancelled: true, campaignId: 'B' }), { data: B, error: null, waiting: false });
  assert.deepEqual(seatedRosterView({ roster: undefined, error: cancel, cancelled: true, campaignId: 'B' }), { data: undefined, error: null, waiting: true }, 'nothing to show: fetch again');
  assert.deepEqual(seatedRosterView({ roster: A, error: cancel, cancelled: true, campaignId: 'B' }), { data: undefined, error: null, waiting: true });
  assert.deepEqual(seatedRosterView({ roster: B, error: cancel, cancelled: true, campaignId: undefined }), { data: B, error: null, waiting: false });
});
