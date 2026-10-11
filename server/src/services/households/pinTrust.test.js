import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPointClaim, stackPolicy, lookupPolicy, answerKey, zipOfMatched, cityOfMatched,
  answerClass, pinClass, zipMatches, answerBeats,
} from './pinTrust.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';
import { cohortSummary } from '../../utils/pinCohorts.js';

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

// Rewritten by the pin-fixes build (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S1.3, S11): two different
// addresses the vendor put on ONE spot whose exact answers are ONE point are the Fairfield pattern — a
// condo complex — not a geocoder placeholder.
test('two different addresses from one vendor spot claiming one point form a complex, and neither remembers the key', () => {
  const r = stackPolicy({
    cands: [cand('a', '5001 E'), cand('b', '5011 E')],
    answers: new Map([['a', ans(X)], ['b', ans(X)]]),
    doorsOnKey: doors({}),
  });
  assert.deepEqual(r.place, []);
  assert.deepEqual(r.complex.map((m) => m.id).sort(), ['a', 'b']);
  assert.ok(r.complex.every((m) => m.key === keyOf(X) && m.spotKey === keyOf(S) && m.moveTo === true));
  assert.equal(r.distrust.size, 0);
});

test('two different addresses from DIFFERENT vendor spots claiming one point are both refused, and both remember the key', () => {
  const T = { lat: 36.205, lng: -115.96 };
  const r = stackPolicy({
    cands: [cand('a', '5001 E', S), cand('b', '5011 E', T)],
    answers: new Map([['a', ans(X)], ['b', ans(X)]]),
    doorsOnKey: doors({}),
  });
  assert.deepEqual(r.place, []);
  assert.deepEqual(r.complex, []);
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
  const T = { lat: 36.205, lng: -115.96 };
  const r = stackPolicy({
    cands: [cand('a', '5001 E', S, { distrusted: [keyOf(X)] }), cand('b', '5011 E', T)],
    answers: new Map([['a', ans(X)], ['b', ans(X)]]),
    doorsOnKey: doors({}),
  });
  assert.equal(r.refused.get('a'), 'a point already distrusted for this home');
  assert.equal(r.place.length, 0);
});

test('…but not a complex group\'s own point: legacy distrusted keys do not stop a complex forming', () => {
  // Release 1 refused Fairfield's collapses and wrote the shared point into every member's distrusted
  // keys; the free re-lookup must still form the complex.
  const r = stackPolicy({
    cands: [cand('a', '5001 E', S, { distrusted: [keyOf(X)] }), cand('b', '5011 E', S, { distrusted: [keyOf(X)] })],
    answers: new Map([['a', ans(X)], ['b', ans(X)]]),
    doorsOnKey: doors({}),
  });
  assert.deepEqual(r.complex.map((m) => m.id).sort(), ['a', 'b']);
  assert.equal(r.refused.size, 0);
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

// ── The pin-fixes build: the ladder, complexes, the far in-place rule (S1.3) ────────────────────

const CT = { zipCode: '06850', state: 'CT', city: 'Norwalk' };
const N1 = { lat: 41.106, lng: -73.408 }; // Norwalk
const N2 = { lat: 41.1065, lng: -73.4085 }; // ~70 m from N1
const ansCT = (p, extra = {}) => ({ ...p, accuracyType: 'rooftop', matchedZip: '06850', matchedCity: 'Norwalk', cacheKey: null, ...extra });
const candCT = (id, base, at, extra = {}) => ({ id, key: keyOf(at), base, ...CT, distrusted: [], loc: [at.lng, at.lat], ...extra });

test('answerClass and pinClass', () => {
  assert.equal(answerClass({ accuracyType: 'rooftop' }), 'exact');
  assert.equal(answerClass({ accuracyType: 'point' }), 'exact');
  assert.equal(answerClass({ accuracyType: 'range_interpolation' }), 'estimate');
  assert.equal(answerClass({ accuracyType: 'street_center' }), 'street');
  assert.equal(answerClass({ accuracyType: 'nearest_rooftop_match' }), 'street');
  assert.equal(answerClass({ accuracyType: 'place' }), 'none');
  assert.equal(answerClass(null), 'none');
  assert.equal(pinClass({ pinSuspect: 'unlocated' }), 0);
  assert.equal(pinClass({ coordSource: 'holding' }), 0);
  assert.equal(pinClass({ pinSuspect: 'placeholder', off: true }), 0, 'a legacy 0,0 door');
  assert.equal(pinClass({ pinSuspect: 'far' }), 1);
  for (const k of ['placeholder', 'stray', 'complex']) assert.equal(pinClass({ pinSuspect: k }), 2, k);
  assert.equal(pinClass({}), 3);
});

test('cityOfMatched reads Geocodio\'s formatted address', () => {
  assert.equal(cityOfMatched('1 N Water St, Norwalk, CT 06854'), 'Norwalk');
  assert.equal(cityOfMatched('5001 E Monte Penne Way, Pahrump, NV 89061-1001'), 'Pahrump');
  assert.equal(cityOfMatched('Fairfield, CT 06824'), null);
  assert.equal(cityOfMatched(null), null);
});

test('zipMatches: ZIP5, or the same city (inside the street\'s cohort when there is one)', () => {
  assert.equal(zipMatches(ansCT(N1), CT), true);
  assert.equal(zipMatches(ansCT(N1, { matchedZip: '06854' }), CT), true, 'same city, no cohort');
  assert.equal(zipMatches(ansCT(N1, { matchedZip: '06854', matchedCity: 'Stamford' }), CT), false, 'another town');
  assert.equal(zipMatches(ansCT(N1, { matchedZip: null }), CT), false, 'no matched ZIP');
  const pts = [0, 1, 2, 3].map((i) => ({ id: i, lat: 41.106 + i * 0.0005, lng: -73.408, street: 'X', zip5: '06850', spotKey: buildingKeyForCoords([-73.408, 41.106 + i * 0.0005]) }));
  const cohort = cohortSummary(pts);
  assert.equal(zipMatches(ansCT(N1, { matchedZip: '06854' }), CT, cohort), true, 'same city, inside the cohort');
  assert.equal(zipMatches(ansCT({ lat: 41.2, lng: -73.3 }, { matchedZip: '06854' }), CT, cohort), false, 'same city, off the street');
});

test('answerBeats: the 4 × 4 ladder and the two floors', () => {
  const at = (pc) => ({ ...CT, pinClass: pc });
  const exact = ansCT(N1);
  const est = (accuracy) => ansCT(N1, { accuracyType: 'range_interpolation', accuracy });
  const street = ansCT(N1, { accuracyType: 'street_center' });
  const none = ansCT(N1, { accuracyType: 'place' });
  const table = [
    [exact, [true, true, true, false]],
    [est(0.9), [true, true, true, false]],
    [est(0.6), [true, false, false, false]],
    [est(0.4), [false, false, false, false]],
    [street, [true, true, false, false]],
    [none, [false, false, false, false]],
  ];
  for (const [a, row] of table) {
    row.forEach((want, pc) => assert.equal(answerBeats(a, at(pc)), want, `${a.accuracyType}@${a.accuracy ?? 1} vs class ${pc}`));
  }
  assert.equal(answerBeats(ansCT({ lat: 26.1, lng: -80.2 }), at(0)), false, 'out of state');
});

test('a far door whose rooftop or estimate lies within 250 m of its pin is confirmed in place', () => {
  const far = (extra = {}) => candCT('f', '19 AVON', N1, { pinClass: 1, ...extra });
  const rooftop = lookupPolicy({ cands: [far()], answers: new Map([['f', ansCT(N2)]]), doorsOnKey: doors({}) });
  assert.deepEqual(rooftop.place, [{ id: 'f', key: keyOf(N2), inPlace: true, near: true }]);
  const estimate = lookupPolicy({ cands: [far()], answers: new Map([['f', ansCT(N2, { accuracyType: 'range_interpolation', accuracy: 0.6 })]]), doorsOnKey: doors({}) });
  assert.equal(estimate.place[0].near, true, 'an estimate at the 0.5 floor confirms; it could never replace');
  const away = { lat: 41.12, lng: -73.39 }; // ~2 km off, same city
  const moved = lookupPolicy({ cands: [far()], answers: new Map([['f', ansCT(away)]]), doorsOnKey: doors({}) });
  assert.deepEqual(moved.place, [{ id: 'f', key: keyOf(away), inPlace: false }]);
});

test('a complex converges on the exact point: members stay when it is their spot, move otherwise', () => {
  const here = lookupPolicy({
    cands: ['a', 'b', 'c'].map((id, i) => candCT(id, `${10 + i} ROWAYTON WOODS DR`, N1)),
    answers: new Map(['a', 'b', 'c'].map((id) => [id, ansCT(N1)])),
    doorsOnKey: doors({}),
  });
  assert.equal(here.complex.length, 3);
  assert.ok(here.complex.every((m) => m.moveTo === false && m.key === keyOf(N1)));
  const there = lookupPolicy({
    cands: ['a', 'b'].map((id, i) => candCT(id, `${10 + i} OAK`, N1, { pinClass: 0 })),
    answers: new Map(['a', 'b'].map((id) => [id, ansCT(N2)])),
    doorsOnKey: doors({}),
  });
  assert.ok(there.complex.every((m) => m.moveTo === true && m.key === keyOf(N2)));
});

test('one address in two spellings is one address, so a shared answer is a placement, not a complex', () => {
  const r = lookupPolicy({
    cands: [candCT('a', '533 BLACK ROCK TURNPIKE', N1, { fam: '533 BLACK ROCK TPKE' }), candCT('b', '533 BLACK ROCK TPKE 3', N1, { fam: '533 BLACK ROCK TPKE' })],
    answers: new Map([['a', ansCT(N2)], ['b', ansCT(N2)]]),
    doorsOnKey: doors({}),
  });
  assert.equal(r.complex.length, 0);
  assert.equal(r.place.length, 2);
});

test('a lone member re-judged, and a later file\'s new home, both JOIN an existing complex; nobody is reverted', () => {
  const existing = [
    { id: 'm1', base: '1 RW', placed: true, candidate: false, complex: true },
    { id: 'm2', base: '2 RW', placed: false, candidate: false, complex: true },
  ];
  const r = lookupPolicy({
    cands: [candCT('m1', '1 RW', N1), candCT('new', '9 RW', { lat: 41.2, lng: -73.4 }, { pinClass: 0 })],
    answers: new Map([['m1', ansCT(N1)], ['new', ansCT(N1)]]),
    doorsOnKey: doors({ [keyOf(N1)]: existing }),
  });
  assert.deepEqual(r.complex.map((m) => m.id).sort(), ['m1', 'new']);
  assert.equal(r.revert.size, 0);
  assert.equal(r.distrust.size, 0);
});

test('an estimate aimed at a complex is refused and the complex is untouched', () => {
  const existing = [{ id: 'm1', base: '1 RW', placed: true, candidate: false, complex: true }];
  const r = lookupPolicy({
    cands: [candCT('e', '7 ELM', { lat: 41.2, lng: -73.4 }, { pinClass: 0 })],
    answers: new Map([['e', ansCT(N1, { accuracyType: 'range_interpolation', accuracy: 0.9 })]]),
    doorsOnKey: doors({ [keyOf(N1)]: existing }),
  });
  assert.equal(r.refused.get('e'), 'another address claims this point');
  assert.equal(r.revert.size, 0);
  assert.ok(!r.distrust.has('m1'));
});

test('two addresses sharing one ESTIMATE are not a complex: both refused', () => {
  const r = lookupPolicy({
    cands: [candCT('a', '1 OAK', N1, { pinClass: 0 }), candCT('b', '2 OAK', N1, { pinClass: 0 })],
    answers: new Map([['a', ansCT(N2, { accuracyType: 'range_interpolation', accuracy: 0.9 })], ['b', ansCT(N2, { accuracyType: 'range_interpolation', accuracy: 0.9 })]]),
    doorsOnKey: doors({}),
  });
  assert.equal(r.complex.length, 0);
  assert.equal(r.place.length, 0);
  assert.equal(r.refused.get('a'), 'another address claims this point');
});

test('an estimate replaces a shared spot only at the measured floor and inside the street', () => {
  const pts = [0, 1, 2, 3].map((i) => ({ id: i, lat: 41.106 + i * 0.0005, lng: -73.408, street: 'X', zip5: '06850', spotKey: buildingKeyForCoords([-73.408, 41.106 + i * 0.0005]) }));
  const cohort = cohortSummary(pts);
  const run = (accuracy, at) => lookupPolicy({
    cands: [candCT('s', '5 OAK', { lat: 41.0, lng: -73.5 })], // class 2 by default
    answers: new Map([['s', ansCT(at, { accuracyType: 'range_interpolation', accuracy })]]),
    doorsOnKey: doors({}),
    cohortFor: () => cohort,
  });
  assert.equal(run(0.9, N2).place.length, 1);
  assert.equal(run(0.6, N2).refused.get('s'), 'does not beat the current pin');
  assert.equal(run(0.9, { lat: 41.15, lng: -73.35 }).refused.get('s'), 'an estimate outside its street');
});
