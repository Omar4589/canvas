import { test } from 'node:test';
import assert from 'node:assert';
import { foldDeltaVoters, changesPath } from './deltaFold.js';

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
