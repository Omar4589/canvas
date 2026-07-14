import { test } from 'node:test';
import assert from 'node:assert';
import { computeReasons, summarize } from '../src/services/audit/flagDetection.js';
import { FLAG_THRESHOLDS } from '../src/services/audit/flagThresholds.js';

// Pure detection tests — no DB. computeReasons() takes lean CanvassActivity-shaped rows and a
// householdId→{lng,lat} pin map, and returns acc = Map<actionId, { row, reasons }>. Locks the
// four flag types + their guards (accuracy suppression, offline-batch, apartment).

const BASE = new Date('2026-07-01T12:00:00Z').getTime();
const at = (sec) => new Date(BASE + sec * 1000);

let counter = 0;
function mkRow(o) {
  return {
    _id: o._id || `a${++counter}`,
    userId: o.userId || 'u',
    householdId: o.householdId || 'h',
    campaignId: 'c',
    actionType: o.actionType || 'not_home',
    timestamp: o.timestamp,
    location: 'location' in o ? o.location : { lat: 30, lng: -95, accuracy: 5 },
    distanceFromHouseMeters: 'distanceFromHouseMeters' in o ? o.distanceFromHouseMeters : null,
    replaced: 'replaced' in o ? o.replaced : null,
    wasOfflineSubmission: o.wasOfflineSubmission || false,
  };
}

function reasonsOf(acc, id) {
  const e = acc.get(String(id));
  return e ? [...e.reasons.values()] : [];
}
function sevOf(acc, id, type) {
  const r = reasonsOf(acc, id).find((x) => x.type === type);
  return r ? r.severity : null;
}
function has(acc, id, type) {
  return reasonsOf(acc, id).some((r) => r.type === type);
}

test('far: tiers on distance − accuracy; null distance is never far', () => {
  // Far apart in time + space so rapid/one_spot can't fire.
  const rows = [
    mkRow({ _id: 'A', userId: 'far', householdId: 'hA', timestamp: at(0), location: { lat: 31, lng: -95, accuracy: 60 }, distanceFromHouseMeters: 90 }),
    mkRow({ _id: 'B', userId: 'far', householdId: 'hB', timestamp: at(3600), location: { lat: 32, lng: -95, accuracy: 5 }, distanceFromHouseMeters: 260 }),
    mkRow({ _id: 'C', userId: 'far', householdId: 'hC', timestamp: at(7200), location: { lat: 33, lng: -95, accuracy: null }, distanceFromHouseMeters: 100 }),
    mkRow({ _id: 'D', userId: 'far', householdId: 'hD', timestamp: at(10800), location: { lat: 34, lng: -95, accuracy: 5 }, distanceFromHouseMeters: null }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(has(acc, 'A', 'far'), false, '90m @ ±60 → effective 30 → not far');
  assert.equal(sevOf(acc, 'B', 'far'), 'high', '260m @ ±5 → high');
  assert.equal(sevOf(acc, 'C', 'far'), 'med', '100m @ null → med');
  assert.equal(has(acc, 'D', 'far'), false, 'null distance is never far');
});

test('weak_gps: missing/poor/offline flag with the right severity; null accuracy alone does not', () => {
  const rows = [
    mkRow({ _id: 'W1', userId: 'weak', householdId: 'hA', timestamp: at(0), location: { lat: 40, lng: -95, accuracy: 150 } }),
    mkRow({ _id: 'W2', userId: 'weak', householdId: 'hB', timestamp: at(3600), location: null }),
    mkRow({ _id: 'W3', userId: 'weak', householdId: 'hC', timestamp: at(7200), location: { lat: 42, lng: -95, accuracy: 5 }, wasOfflineSubmission: true }),
    mkRow({ _id: 'W4', userId: 'weak', householdId: 'hD', timestamp: at(10800), location: { lat: 43, lng: -95, accuracy: 300 } }),
    mkRow({ _id: 'W5', userId: 'weak', householdId: 'hE', timestamp: at(14400), location: { lat: 44, lng: -95, accuracy: null } }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(sevOf(acc, 'W1', 'weak_gps'), 'med', '±150 → med');
  assert.equal(sevOf(acc, 'W2', 'weak_gps'), 'high', 'missing location → high');
  assert.equal(sevOf(acc, 'W3', 'weak_gps'), 'low', 'offline w/ good fix → low');
  assert.equal(sevOf(acc, 'W4', 'weak_gps'), 'high', '±300 → high');
  assert.equal(has(acc, 'W5', 'weak_gps'), false, 'null accuracy alone → not flagged');
});

test('rapid: fires across distinct doors under the gap; skips same door and notes', () => {
  const rows = [
    mkRow({ _id: 'R1', userId: 'rapid', householdId: 'hA', timestamp: at(0), location: { lat: 50.0, lng: -95, accuracy: 5 } }),
    mkRow({ _id: 'R2', userId: 'rapid', householdId: 'hB', timestamp: at(10), location: { lat: 51.0, lng: -95, accuracy: 5 } }),
    mkRow({ _id: 'NOTE', userId: 'rapid', householdId: 'hZ', actionType: 'note_added', timestamp: at(12), location: { lat: 51.5, lng: -95, accuracy: 5 } }),
    mkRow({ _id: 'R3', userId: 'rapid', householdId: 'hC', timestamp: at(15), location: { lat: 52.0, lng: -95, accuracy: 5 } }),
    mkRow({ _id: 'R4', userId: 'rapid', householdId: 'hC', timestamp: at(20), location: { lat: 52.0, lng: -95, accuracy: 5 } }),
    mkRow({ _id: 'R5', userId: 'rapid', householdId: 'hD', timestamp: at(100), location: { lat: 53.0, lng: -95, accuracy: 5 } }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(has(acc, 'R1', 'rapid'), false, 'first row has no predecessor');
  assert.equal(sevOf(acc, 'R2', 'rapid'), 'med', '10s gap → med');
  assert.equal(sevOf(acc, 'R3', 'rapid'), 'high', '5s gap (notes excluded) → high');
  assert.equal(has(acc, 'R4', 'rapid'), false, 'same household as R3 → not rapid');
  assert.equal(has(acc, 'R5', 'rapid'), false, '80s gap → not rapid');
  assert.equal(has(acc, 'NOTE', 'rapid'), false, 'a note is never rapid');
});

test('rapid: identical-timestamp offline pair is suppressed; a real offline gap still fires', () => {
  const rows = [
    mkRow({ _id: 'O1', userId: 'off', householdId: 'hA', timestamp: at(1000), location: { lat: 60, lng: -95, accuracy: 5 }, wasOfflineSubmission: true }),
    mkRow({ _id: 'O2', userId: 'off', householdId: 'hB', timestamp: at(1000), location: { lat: 61, lng: -95, accuracy: 5 }, wasOfflineSubmission: true }),
    mkRow({ _id: 'O3', userId: 'off', householdId: 'hC', timestamp: at(1005), location: { lat: 62, lng: -95, accuracy: 5 }, wasOfflineSubmission: true }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(has(acc, 'O2', 'rapid'), false, 'identical offline stamp = sync artifact → suppressed');
  assert.equal(sevOf(acc, 'O3', 'rapid'), 'high', 'genuine 5s offline gap → fires');
});

// Five doors from ~one GPS spot, over a short span. pinMap decides spread vs apartment.
function oneSpotRows(user, houseLat) {
  return [0, 60, 120, 180, 240].map((s, i) =>
    mkRow({
      _id: `${user}${i}`,
      userId: user,
      householdId: `${user}_h${i}`,
      timestamp: at(s),
      location: { lat: 30.0, lng: -95.0, accuracy: 5 }, // canvasser never moved
      distanceFromHouseMeters: 5,
    })
  );
}

test('one_spot: fires when doors are spread out but the canvasser never moved', () => {
  const rows = oneSpotRows('spot');
  // Houses ~111m apart down the block → spread > 60m.
  const pins = new Map(rows.map((r, i) => [String(r.householdId), { lat: 30 + i * 0.001, lng: -95 }]));
  const { acc } = computeReasons(rows, pins, FLAG_THRESHOLDS);
  for (const r of rows) assert.equal(has(acc, r._id, 'one_spot'), true, `${r._id} should be one_spot`);
  assert.equal(sevOf(acc, 'spot0', 'one_spot'), 'med', '5 distinct → med');
});

test('one_spot: does NOT fire for an apartment (many units at one coordinate)', () => {
  const rows = oneSpotRows('apt');
  // All units share one building pin → spread ≈ 0 → apartment guard holds.
  const pins = new Map(rows.map((r) => [String(r.householdId), { lat: 30.5, lng: -95.5 }]));
  const { acc } = computeReasons(rows, pins, FLAG_THRESHOLDS);
  for (const r of rows) assert.equal(has(acc, r._id, 'one_spot'), false, `${r._id} must not fire (apartment)`);
});

// far correction downgrade: a far entry whose `replaced.nearest` proves a near visit within
// FAR_CORRECTION_WINDOW_MIN drops to low (detail.downgraded); prior-entry context rides on
// EVERY far correction. Rows are hours apart on distinct doors so rapid/one_spot can't fire.
function correction({ _id, sec, dist, replaced }) {
  return mkRow({
    _id,
    userId: `corr-${_id}`,
    householdId: `h-${_id}`,
    timestamp: at(sec),
    location: { lat: 30, lng: -95, accuracy: 5 },
    distanceFromHouseMeters: dist,
    replaced,
  });
}
function farDetail(acc, id) {
  return reasonsOf(acc, id).find((r) => r.type === 'far')?.detail;
}
// nearest recorded `minAgo` minutes before the row it exonerates.
function nearest(rowSec, minAgo, dist, accuracy = 5) {
  return { distanceFromHouseMeters: dist, accuracy, timestamp: at(rowSec - minAgo * 60) };
}

test('far correction: near prior within the window downgrades to low with context', () => {
  const rows = [
    correction({
      _id: 'DG',
      sec: 600,
      dist: 200,
      replaced: {
        actionType: 'restricted',
        timestamp: at(0),
        location: { lat: 30, lng: -95, accuracy: 5 },
        distanceFromHouseMeters: 5,
        nearest: nearest(600, 10, 5),
      },
    }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(sevOf(acc, 'DG', 'far'), 'low', 'near prior 10 min ago → downgraded');
  const d = farDetail(acc, 'DG');
  assert.equal(d.downgraded, true);
  assert.equal(d.priorActionType, 'restricted');
  assert.equal(d.priorMeters, 5);
  assert.equal(d.minutesSincePrior, 10);
  assert.equal(d.nearestMeters, 5);
  assert.equal(d.minutesSinceNearest, 10);
});

test('far correction: outside the same-day window keeps full severity (context still present)', () => {
  const thirteenHoursSec = 13 * 3600;
  const rows = [
    correction({
      _id: 'LATE',
      sec: thirteenHoursSec,
      dist: 300,
      replaced: {
        actionType: 'not_home',
        timestamp: at(0),
        location: { lat: 30, lng: -95, accuracy: 5 },
        distanceFromHouseMeters: 5,
        nearest: nearest(thirteenHoursSec, 13 * 60, 5),
      },
    }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(sevOf(acc, 'LATE', 'far'), 'high', '13h later → no downgrade');
  const d = farDetail(acc, 'LATE');
  assert.equal(d.downgraded, undefined, 'not downgraded');
  assert.equal(d.priorActionType, 'not_home', 'prior context still rides along');
});

test('far correction: a prior that was ALSO far never downgrades', () => {
  const rows = [
    correction({
      _id: 'FARPRIOR',
      sec: 600,
      dist: 300,
      replaced: {
        actionType: 'refused',
        timestamp: at(0),
        location: { lat: 30, lng: -95, accuracy: 5 },
        distanceFromHouseMeters: 200,
        nearest: nearest(600, 10, 200),
      },
    }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(sevOf(acc, 'FARPRIOR', 'far'), 'high', 'prior 200m effective 195 > 75 → full severity');
  assert.equal(farDetail(acc, 'FARPRIOR').downgraded, undefined);
});

test('far correction: accuracy is subtracted from the nearest evidence too', () => {
  const rows = [
    correction({
      _id: 'ACC',
      sec: 600,
      dist: 200,
      replaced: {
        actionType: 'not_home',
        timestamp: at(0),
        location: { lat: 30, lng: -95, accuracy: 60 },
        distanceFromHouseMeters: 90,
        nearest: nearest(600, 10, 90, 60),
      },
    }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(sevOf(acc, 'ACC', 'far'), 'low', 'nearest 90m @ ±60 → effective 30 ≤ 75 → downgrades');
});

test('far correction: no nearest evidence / no snapshot / reversed clock never downgrade', () => {
  const rows = [
    correction({
      _id: 'NONEAR',
      sec: 600,
      dist: 200,
      replaced: {
        actionType: 'not_home',
        timestamp: at(0),
        location: null,
        distanceFromHouseMeters: null,
        nearest: null,
      },
    }),
    correction({ _id: 'LEGACY', sec: 4200, dist: 200, replaced: null }),
    correction({
      _id: 'SKEW',
      sec: 7800,
      dist: 200,
      // nearest stamped AFTER the row (device clock skew) → the >=0 guard denies it.
      replaced: {
        actionType: 'not_home',
        timestamp: at(9000),
        location: { lat: 30, lng: -95, accuracy: 5 },
        distanceFromHouseMeters: 5,
        nearest: { distanceFromHouseMeters: 5, accuracy: 5, timestamp: at(9000) },
      },
    }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(sevOf(acc, 'NONEAR', 'far'), 'med', 'snapshot without distance can’t prove near');
  assert.equal(farDetail(acc, 'NONEAR').priorActionType, 'not_home', 'context line still renders');
  assert.equal(farDetail(acc, 'NONEAR').priorMeters, null);
  assert.equal(sevOf(acc, 'LEGACY', 'far'), 'med', 'legacy row (no snapshot) behaves exactly as before');
  assert.equal(farDetail(acc, 'LEGACY').priorActionType, undefined, 'no prior fields on legacy rows');
  assert.equal(sevOf(acc, 'SKEW', 'far'), 'med', 'negative gap never downgrades');
  assert.equal(farDetail(acc, 'SKEW').downgraded, undefined);
});

// summarize() count semantics: the prominent "flagged" number is OPEN-based, each status is
// counted exactly once (regression guard for the old reviewed double-count), per-reason totals
// reflect OPEN flags only, and flaggedActions stays the full-range total.
function sEntry({ userId = 'u', reasons = [], status }) {
  return {
    userId,
    reasons: reasons.map((t) => ({ type: t, severity: 'med' })),
    maxSeverity: 'med',
    review: status ? { status } : undefined, // undefined → treated as 'open'
  };
}

test('summarize: open-based totals, no double-count, per-reason open-only', () => {
  const entries = [
    sEntry({ userId: 'u1', reasons: ['far'] }), // open
    sEntry({ userId: 'u1', reasons: ['rapid'], status: 'reviewed' }), // reviewed
    sEntry({ userId: 'u2', reasons: ['far', 'one_spot'], status: 'dismissed' }), // dismissed, multi-reason
    sEntry({ userId: 'u2', reasons: ['weak_gps'], status: 'confirmed' }), // confirmed
    sEntry({ userId: 'u2', reasons: ['far'] }), // open
  ];
  const byUser = new Map([['u1', []], ['u2', []]]);
  const { totals, byCanvasser } = summarize(entries, byUser, (id) => id);

  assert.equal(totals.flaggedActions, 5, 'flaggedActions = every flag in range');
  assert.equal(totals.open, 2, 'open = the two entries with no review');
  assert.equal(totals.reviewed, 1, 'reviewed counted once (not doubled)');
  assert.equal(totals.dismissed, 1, 'dismissed once');
  assert.equal(totals.confirmed, 1, 'confirmed once');
  assert.equal(totals.far, 2, 'far = open-only (2 open far flags; the dismissed far is excluded)');
  assert.equal(totals.rapid, 0, 'rapid was on a reviewed flag → excluded from open per-reason');
  assert.equal(totals.oneSpot, 0, 'one_spot was on a dismissed flag → excluded');
  assert.equal(totals.weakGps, 0, 'weak_gps was on a confirmed flag → excluded');

  // per-canvasser: openCount is status-aware; flaggedActions is the total.
  const u2 = byCanvasser.find((u) => u.userId === 'u2');
  assert.equal(u2.flaggedActions, 3, 'u2 has 3 flags total');
  assert.equal(u2.openCount, 1, 'u2 has 1 open flag');
});
