import { test } from 'node:test';
import assert from 'node:assert';
import { foldDeltaVoters, foldDeltaHouseholds, reconcileLocationResponse, changesPath } from './deltaFold.js';

const V = (_id, householdId, extra = {}) => ({ _id, householdId, fullName: `v${_id}`, ...extra });

test('known voters merge whole (delta fields win)', () => {
  const prev = [V('a', 'h1', { surveyStatus: 'not_surveyed' })];
  const delta = [V('a', 'h1', { surveyStatus: 'surveyed', surveyedByMe: true })];
  const out = foldDeltaVoters(prev, delta, new Set(['h1']));
  assert.equal(out.length, 1);
  assert.equal(out[0].surveyStatus, 'surveyed');
  assert.equal(out[0].surveyedByMe, true);
});

test('unknown voter at a known household APPENDS (the walk-up case)', () => {
  const prev = [V('a', 'h1')];
  const delta = [V('b', 'h1')];
  const out = foldDeltaVoters(prev, delta, new Set(['h1']));
  assert.deepEqual(out.map((v) => v._id), ['a', 'b']);
});

test('unknown voter at an UNKNOWN household is skipped (door suppressed or out of scope)', () => {
  const prev = [V('a', 'h1')];
  const delta = [V('b', 'h2')];
  const out = foldDeltaVoters(prev, delta, new Set(['h1']));
  assert.deepEqual(out.map((v) => v._id), ['a']);
});

test('empty delta returns prev by reference (no churn)', () => {
  const prev = [V('a', 'h1')];
  assert.strictEqual(foldDeltaVoters(prev, [], new Set(['h1'])), prev);
});

test('mixed: merge + append + skip in one fold', () => {
  const prev = [V('a', 'h1', { surveyStatus: 'not_surveyed' }), V('c', 'h3')];
  const delta = [
    V('a', 'h1', { surveyStatus: 'surveyed' }), // merge
    V('b', 'h1'), // append (known door)
    V('x', 'h9'), // skip (unknown door)
  ];
  const out = foldDeltaVoters(prev, delta, new Set(['h1', 'h3']));
  assert.deepEqual(out.map((v) => v._id), ['a', 'c', 'b']);
  assert.equal(out[0].surveyStatus, 'surveyed');
});

// The 30s poll's URL (map.jsx). Getting it wrong fails silently on a phone: nothing errors on
// screen, the map just stops hearing about teammates' doors and door-setting changes.
const CAMPAIGN = '66f2a0c1e4b0a1b2c3d4e5f6';
const SINCE = '2026-10-02T15:04:05.123Z';
// The server's stamp for Refused + Restricted off, Not a target voter on, walk-up adds leads-only
// (server/test/outcomeToggles.test.js builds it from that fixture and checks both separators).
const STAMP = 'refused,restricted|not_target|leads';
const query = (path) => new URLSearchParams(path.slice(path.indexOf('?') + 1));

test('changesPath percent-encodes the door-config stamp, which decodes back exactly', () => {
  // A raw '|' is the iOS 15/16 trap: the whole URL is re-encoded and every poll 400s.
  const path = changesPath({ campaignId: CAMPAIGN, since: SINCE, doorConfigStamp: STAMP });
  assert.ok(!path.includes('|') && !path.includes(','), path);
  assert.equal(query(path).get('doorConfigStamp'), STAMP);
  assert.equal(
    path,
    `/mobile/changes?campaignId=${CAMPAIGN}&since=2026-10-02T15%3A04%3A05.123Z&doorConfigStamp=refused%2Crestricted%7Cnot_target%7Cleads`
  );
});

test('changesPath sends no doorConfigStamp when the bootstrap has none (an older server)', () => {
  // No param at all — never a literal "undefined" for the server to compare against.
  for (const doorConfigStamp of [undefined, null]) {
    const path = changesPath({ campaignId: CAMPAIGN, since: SINCE, doorConfigStamp });
    assert.equal(path, `/mobile/changes?campaignId=${CAMPAIGN}&since=2026-10-02T15%3A04%3A05.123Z`);
    assert.equal(query(path).has('doorConfigStamp'), false);
  }
});

test('changesPath encodes since too', () => {
  const path = changesPath({ campaignId: CAMPAIGN, since: SINCE });
  assert.ok(!path.includes(':'), path);
  assert.equal(query(path).get('since'), SINCE);
});

// ── Households (placeholder pins, release 2) ──
const H = (_id, extra = {}) => ({ _id, status: 'unknocked', location: { type: 'Point', coordinates: [-116, 36.2] }, coordSource: 'file', coordConfidence: null, ...extra });

test('a delta door folds its status, stamp and shared-spot flag; an absent flag clears it', () => {
  const prev = [H('a', { pinSuspect: 'placeholder' }), H('b', { pinSuspect: 'stray' }), H('c')];
  const delta = [
    // a: a lead moved the pin — the delta carries the new spot and no flag.
    { _id: 'a', status: 'unknocked', lastActionAt: null, location: { type: 'Point', coordinates: [-116.1, 36.3] }, coordSource: 'corrected', coordConfidence: null },
    // b: still on the shared spot.
    { _id: 'b', status: 'not_home', lastActionAt: '2026-10-05T18:00:00Z', pinSuspect: 'stray' },
  ];
  const out = foldDeltaHouseholds(prev, delta);
  assert.equal(out.length, 3);
  assert.equal(out[0].pinSuspect, null);
  assert.deepEqual(out[0].location.coordinates, [-116.1, 36.3]);
  assert.equal(out[0].coordSource, 'corrected');
  assert.equal(out[1].pinSuspect, 'stray');
  assert.equal(out[1].status, 'not_home');
  assert.deepEqual(out[1].location.coordinates, [-116, 36.2], 'no location in the delta: the pin stays');
  assert.strictEqual(out[2], prev[2], 'a door outside the delta is untouched');
});

test('a door suppressed mid-shift leaves the phone; an empty delta changes nothing', () => {
  const prev = [H('a'), H('b'), H('c'), H('d'), H('e')];
  const out = foldDeltaHouseholds(prev, [
    { _id: 'a', isActive: false },
    { _id: 'b', fullyVoted: true },
    { _id: 'c', fullyDnc: true },
    { _id: 'd', doNotKnock: true },
  ]);
  assert.deepEqual(out.map((h) => h._id), ['e']);
  assert.strictEqual(foldDeltaHouseholds(prev, []), prev);
});

test('the pin-fix reconcile: the server state wins, a no-op restores the flag and the stamp', () => {
  const prev = { households: [H('a', { pinSuspect: null, coordSource: 'corrected', locationConfirmedAt: null }), H('b')] };
  // Nothing moved: the server answers with the untouched pin, its flag and an approximate geocode.
  const noop = reconcileLocationResponse(prev, 'a', {
    moved: 0,
    household: { _id: 'a', location: { type: 'Point', coordinates: [-116, 36.2] }, coordSource: 'geocodio', coordConfidence: 'interpolated', locationConfirmedAt: null, pinSuspect: 'placeholder' },
  });
  assert.equal(noop.households[0].pinSuspect, 'placeholder');
  assert.equal(noop.households[0].coordSource, 'geocodio');
  assert.equal(noop.households[0].coordConfidence, 'interpolated', 'an approximate badge survives the reconcile');
  assert.strictEqual(noop.households[1], prev.households[1]);
  // A real move: no flag, no stamp.
  const moved = reconcileLocationResponse(prev, 'a', {
    moved: 1,
    household: { _id: 'a', location: { type: 'Point', coordinates: [-116.1, 36.3] }, coordSource: 'corrected', coordConfidence: null, locationConfirmedAt: null },
  });
  assert.equal(moved.households[0].pinSuspect, null);
  assert.deepEqual(moved.households[0].location.coordinates, [-116.1, 36.3]);
  // No pin in the response: nothing to reconcile.
  assert.strictEqual(reconcileLocationResponse(prev, 'a', { ok: true }), prev);
});
