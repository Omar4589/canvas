import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPointClaim, stackPolicy, answerKey, zipOfMatched } from './pinTrust.js';

// Pahrump, NV. Points 0.001° apart are ~100 m apart: different building keys.
const S = { lat: 36.21, lng: -115.95 }; // a vendor's shared spot
const X = { lat: 36.215, lng: -115.94 };
const Y = { lat: 36.22, lng: -115.93 };
const NV = { zipCode: '89061', state: 'NV' };
const keyOf = (p) => answerKey(p);
const ans = (p, extra = {}) => ({ ...p, accuracyType: 'rooftop', matchedZip: '89061', cacheKey: null, ...extra });
const cand = (id, base, at = S, extra = {}) => ({ id, key: keyOf(at), base, ...NV, distrusted: [], ...extra });
const doors = (byKey) => (k) => byKey[k] || [];

test('a claim is a rooftop or point answer, matched in the address ZIP, inside its state', () => {
  assert.equal(isPointClaim(ans(X), NV), true);
  assert.equal(isPointClaim(ans(X, { accuracyType: 'point' }), NV), true);
  for (const t of ['nearest_rooftop_match', 'range_interpolation', 'street_center', null]) {
    assert.equal(isPointClaim(ans(X, { accuracyType: t }), NV), false, String(t));
  }
  assert.equal(isPointClaim(ans(X, { matchedZip: '89048' }), NV), false, 'another ZIP');
  assert.equal(isPointClaim(ans(X, { matchedZip: null }), NV), false, 'no matched address');
  assert.equal(isPointClaim(ans({ lat: 26.1, lng: -80.2 }), NV), false, 'Florida, for a Nevada address');
  assert.equal(zipOfMatched('5001 E Monte Penne Way, Pahrump, NV 89061-1001'), '89061');
  assert.equal(zipOfMatched(''), null);
});

test('a lone answer elsewhere is placed; one on its own spot is placed in place', () => {
  const r = stackPolicy({ cands: [cand('a', '5001 E')], answers: new Map([['a', ans(X)]]), doorsOnKey: doors({}) });
  assert.deepEqual(r.place, [{ id: 'a', key: keyOf(X), inPlace: false }]);
  const r2 = stackPolicy({ cands: [cand('a', '5001 E')], answers: new Map([['a', ans(S)]]), doorsOnKey: doors({}) });
  assert.equal(r2.place[0].inPlace, true);
});

test('two different addresses claiming one point are both refused, and both remember the key', () => {
  const r = stackPolicy({
    cands: [cand('a', '5001 E'), cand('b', '5011 E')],
    answers: new Map([['a', ans(X)], ['b', ans(X)]]),
    doorsOnKey: doors({}),
  });
  assert.deepEqual(r.place, []);
  assert.deepEqual([...r.distrust.get('a')], [keyOf(X)]);
  assert.deepEqual([...r.distrust.get('b')], [keyOf(X)]);
});

test('units of one street address may share a point, and so may answers from one cache entry', () => {
  const units = stackPolicy({
    cands: [cand('a', '100 MAIN'), cand('b', '100 MAIN')],
    answers: new Map([['a', ans(X)], ['b', ans(X)]]),
    doorsOnKey: doors({}),
  });
  assert.equal(units.place.length, 2);
  const oneEntry = stackPolicy({
    cands: [cand('a', '123 NORTH MAIN'), cand('b', '123 N MAIN')],
    answers: new Map([['a', ans(X, { cacheKey: 'K' })], ['b', ans(X, { cacheKey: 'K' })]]),
    doorsOnKey: doors({}),
  });
  assert.equal(oneEntry.place.length, 2);
});

test('an answer landing on a home the lookup placed earlier reverts that home and distrusts the key for both', () => {
  const r = stackPolicy({
    cands: [cand('b', '5011 E')],
    answers: new Map([['b', ans(X)]]),
    doorsOnKey: doors({ [keyOf(X)]: [{ id: 'a', base: '5001 E', placed: true, candidate: false }] }),
  });
  assert.deepEqual(r.place, []);
  assert.deepEqual([...r.revert], [['a', keyOf(X)]]);
  assert.ok(r.distrust.get('a').has(keyOf(X)) && r.distrust.get('b').has(keyOf(X)));
});

test('in its own bucket, the other flagged candidates are judged by their own answers, but anyone else counts', () => {
  const ownBucket = (others) => doors({ [keyOf(S)]: others });
  const flaggedNeighbour = { id: 'b', base: '5011 E', placed: false, candidate: true };
  const placed = stackPolicy({ cands: [cand('a', '5001 E')], answers: new Map([['a', ans(S)]]), doorsOnKey: ownBucket([flaggedNeighbour]) });
  assert.equal(placed.place.length, 1, 'a flagged candidate on the spot is not a rival');
  const vouched = { id: 'v', base: '5016 E', placed: false, candidate: false };
  const refused = stackPolicy({ cands: [cand('a', '5001 E')], answers: new Map([['a', ans(S)]]), doorsOnKey: ownBucket([vouched]) });
  assert.equal(refused.place.length, 0, 'a vouched home of another address refuses an in-place answer');
});

test('a stray whose rooftop lands on its own building is refused', () => {
  const building = [1, 2, 3].map((n) => ({ id: `u${n}`, base: '200 OAK', placed: false, candidate: false }));
  const r = stackPolicy({
    cands: [cand('s', '12 PINE', S)],
    answers: new Map([['s', ans(S)]]),
    doorsOnKey: doors({ [keyOf(S)]: building }),
  });
  assert.equal(r.place.length, 0);
});

test('a distrusted key refuses its door but still counts against others', () => {
  const r = stackPolicy({
    cands: [cand('a', '5001 E', S, { distrusted: [keyOf(X)] }), cand('b', '5011 E')],
    answers: new Map([['a', ans(X)], ['b', ans(X)]]),
    doorsOnKey: doors({}),
  });
  assert.equal(r.refused.get('a'), 'a point already distrusted for this home');
  assert.equal(r.place.length, 0);
});

test('an answer refused for its type never counts against another home', () => {
  const r = stackPolicy({
    cands: [cand('a', '4925 E'), cand('b', '4920 E')],
    answers: new Map([['a', ans(X, { accuracyType: 'nearest_rooftop_match' })], ['b', ans(X)]]),
    doorsOnKey: doors({}),
  });
  assert.deepEqual(r.place.map((p) => p.id), ['b']);
  assert.equal(r.distrust.size, 0);
});

test('an answer on another shared spot collides with the homes still sitting there', () => {
  const r = stackPolicy({
    cands: [cand('a', '5001 E')],
    answers: new Map([['a', ans(Y)]]),
    doorsOnKey: doors({ [keyOf(Y)]: [{ id: 'z', base: '77 ELM', placed: false, candidate: true }] }),
  });
  assert.equal(r.place.length, 0);
});
