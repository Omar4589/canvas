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

test('mock_gps: only an affirmative mocked=true flags, always high', () => {
  const rows = [
    mkRow({ _id: 'M1', userId: 'mock', householdId: 'hA', timestamp: at(0), location: { lat: 30, lng: -95, accuracy: 5, mocked: true } }),
    mkRow({ _id: 'M2', userId: 'mock', householdId: 'hB', timestamp: at(3600), location: { lat: 31, lng: -95, accuracy: 5, mocked: false } }),
    mkRow({ _id: 'M3', userId: 'mock', householdId: 'hC', timestamp: at(7200), location: { lat: 32, lng: -95, accuracy: 5, mocked: null } }),
    mkRow({ _id: 'M4', userId: 'mock', householdId: 'hD', timestamp: at(10800), location: { lat: 33, lng: -95, accuracy: 5 } }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(sevOf(acc, 'M1', 'mock_gps'), 'high', 'mocked:true → high, always');
  assert.equal(has(acc, 'M2', 'mock_gps'), false, 'mocked:false never flags');
  assert.equal(has(acc, 'M3', 'mock_gps'), false, 'mocked:null (unknown/iOS) never flags');
  assert.equal(has(acc, 'M4', 'mock_gps'), false, 'absent mocked (legacy rows) never flags');
});

// stale fix: the OS fix time (location.fixTimestamp) far behind the tap escalates weak_gps.
// The client caps reused fixes at 2 min, so these can only be bypassed/old clients.
function staleRow(id, sec, fixAgeSec) {
  return mkRow({
    _id: id,
    userId: `stale-${id}`,
    householdId: `h-${id}`,
    timestamp: at(sec),
    location: {
      lat: 30, lng: -95, accuracy: 5,
      fixTimestamp: fixAgeSec == null ? undefined : at(sec - fixAgeSec),
    },
  });
}

test('stale fix: escalates weak_gps; fresh/absent/negative never flag', () => {
  const rows = [
    staleRow('S1', 0, 600), // fix 10 min before the tap → med
    staleRow('S2', 3600, 2400), // 40 min → high
    staleRow('S3', 7200, 30), // 30s → fine
    staleRow('S4', 10800, null), // no fixTimestamp (legacy/old client) → fine
    staleRow('S5', 14400, -300), // fix stamped AFTER the tap (clock skew) → fine
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(sevOf(acc, 'S1', 'weak_gps'), 'med', '10 min stale → weak_gps med');
  const d1 = reasonsOf(acc, 'S1').find((r) => r.type === 'weak_gps').detail;
  assert.equal(d1.stale, true);
  assert.equal(d1.fixAgeSec, 600);
  assert.equal(sevOf(acc, 'S2', 'weak_gps'), 'high', '40 min stale → weak_gps high');
  assert.equal(has(acc, 'S3', 'weak_gps'), false, 'a 30s-old fix is normal');
  assert.equal(has(acc, 'S4', 'weak_gps'), false, 'absent fixTimestamp never flags');
  assert.equal(has(acc, 'S5', 'weak_gps'), false, 'negative age (clock skew) never flags');
});

test('stale fix: takes the WORSE of accuracy-weak and staleness', () => {
  // ±150 accuracy alone = med; 40 min stale alone = high → high wins.
  const rows = [
    mkRow({
      _id: 'SW', userId: 'sw', householdId: 'hSW', timestamp: at(0),
      location: { lat: 30, lng: -95, accuracy: 150, fixTimestamp: at(-2400) },
    }),
  ];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS);
  assert.equal(sevOf(acc, 'SW', 'weak_gps'), 'high', 'maxSeverity(med accuracy, high stale) = high');
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

// far PIN-CORRECTION downgrade: a far entry whose house pin was corrected AFTER the knock, and
// whose GPS sits beside the corrected pin, drops to low (detail.pinDowngraded) — unless the
// flagged canvasser moved the pin themselves. Never upgrades. Same one-door-per-row discipline
// as the correction block above so rapid/one_spot can't contaminate the assertions.
//
// GEOMETRY: 0.0003° of latitude ≈ 33 m; 0.02° ≈ 2.2 km. Latitude is used (not longitude) so that
// transposing haversineMeters' lat/lng arguments feeds lat=-95 and blows the numbers up — these
// fixtures fail loudly on a swap rather than quietly passing.
const PIN = { lat: 30, lng: -95 };
function pinFix({ lat = PIN.lat, lng = PIN.lng, atSec, by = 'someone-else' } = {}) {
  return { lat, lng, correctedAt: at(atSec), correctedBy: by };
}
// A far row at `sec` whose own GPS is `latOffset` north of PIN.
function pinRow({ _id, sec, dist, latOffset = 0.0003, accuracy = 5, userId }) {
  return mkRow({
    _id,
    userId: userId || `pin-${_id}`,
    householdId: `h-${_id}`,
    timestamp: at(sec),
    location: { lat: PIN.lat + latOffset, lng: PIN.lng, accuracy },
    distanceFromHouseMeters: dist,
  });
}
const fixMap = (id, fix) => new Map([[`h-${id}`, fix]]);

test('pin correction: a pin moved onto the door after the knock downgrades to low', () => {
  const rows = [pinRow({ _id: 'PD', sec: 0, dist: 400 })];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS, fixMap('PD', pinFix({ atSec: 3600 })));
  assert.equal(sevOf(acc, 'PD', 'far'), 'low', 'GPS ~33 m from the corrected pin → exonerated');
  const d = farDetail(acc, 'PD');
  assert.equal(d.pinDowngraded, true);
  assert.ok(d.pinCorrectedMeters >= 30 && d.pinCorrectedMeters <= 36, `~33 m, got ${d.pinCorrectedMeters}`);
  assert.ok(d.pinCorrectedAt, 'the correction time rides along for the UI');
  assert.equal(d.meters, 400, 'the frozen distance is preserved as evidence');
  assert.equal(d.downgraded, undefined, 'this is not a replaced-chain downgrade');
});

test('pin correction: NEVER upgrades — a clean knock whose pin moved away stays unflagged', () => {
  // 20 m frozen → not far at all. The corrected pin is 2.2 km from the GPS.
  const rows = [pinRow({ _id: 'NOUP', sec: 0, dist: 20, latOffset: 0.02 })];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS, fixMap('NOUP', pinFix({ atSec: 3600 })));
  assert.equal(has(acc, 'NOUP', 'far'), false, 'live geometry can never CREATE a far flag');
});

test('pin correction: NEVER upgrades — a med row whose pin moved further stays med', () => {
  const rows = [pinRow({ _id: 'NOUP2', sec: 0, dist: 100, latOffset: 0.02 })];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS, fixMap('NOUP2', pinFix({ atSec: 3600 })));
  assert.equal(sevOf(acc, 'NOUP2', 'far'), 'med', 'severity is unchanged, never raised');
  const d = farDetail(acc, 'NOUP2');
  assert.equal(d.pinDowngraded, undefined);
  assert.ok(d.pinCorrectedMeters > 2000, 'but the reviewer still sees the live distance as context');
});

test('pin correction: the flagged canvasser moving their own pin does NOT downgrade', () => {
  const rows = [pinRow({ _id: 'SELF', sec: 0, dist: 400, userId: 'u-self' })];
  const { acc } = computeReasons(
    rows, new Map(), FLAG_THRESHOLDS, fixMap('SELF', pinFix({ atSec: 3600, by: 'u-self' }))
  );
  assert.equal(sevOf(acc, 'SELF', 'far'), 'high', 'nobody grades their own work');
  const d = farDetail(acc, 'SELF');
  assert.equal(d.pinMovedBySelf, true, 'and the reviewer is told exactly why it stayed');
  assert.equal(d.pinDowngraded, undefined);
  assert.ok(d.pinCorrectedMeters != null, 'context still attached');
});

test('pin correction: a correction that PREDATES the knock attaches nothing', () => {
  // The frozen distance was already measured against this pin — there is nothing to forgive.
  const rows = [pinRow({ _id: 'BEFORE', sec: 3600, dist: 400 })];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS, fixMap('BEFORE', pinFix({ atSec: 0 })));
  assert.equal(sevOf(acc, 'BEFORE', 'far'), 'high');
  assert.equal(farDetail(acc, 'BEFORE').pinCorrectedMeters, undefined);
});

test('pin correction: omitting the 4th argument is byte-identical to passing an empty map', () => {
  // TEST-COMPAT LOCK. Every other suite in this file calls computeReasons with three args.
  const mk = () => [pinRow({ _id: 'COMPAT', sec: 0, dist: 400 })];
  const three = computeReasons(mk(), new Map(), FLAG_THRESHOLDS);
  const four = computeReasons(mk(), new Map(), FLAG_THRESHOLDS, new Map());
  assert.equal(sevOf(three.acc, 'COMPAT', 'far'), 'high');
  assert.equal(sevOf(four.acc, 'COMPAT', 'far'), 'high');
  assert.deepEqual(farDetail(three.acc, 'COMPAT'), farDetail(four.acc, 'COMPAT'));
});

test('pin correction: legacy rows with no location, and null distance, are safe no-ops', () => {
  const noLoc = mkRow({
    _id: 'NOLOC', userId: 'u-nl', householdId: 'h-NOLOC',
    timestamp: at(0), location: null, distanceFromHouseMeters: 400,
  });
  const noDist = pinRow({ _id: 'NODIST', sec: 7200, dist: null });
  const fixes = new Map([
    ['h-NOLOC', pinFix({ atSec: 3600 })],
    ['h-NODIST', pinFix({ atSec: 10800 })],
  ]);
  const { acc } = computeReasons([noLoc, noDist], new Map(), FLAG_THRESHOLDS, fixes);
  assert.equal(sevOf(acc, 'NOLOC', 'far'), 'high', 'no GPS → nothing to compare, severity untouched');
  assert.equal(farDetail(acc, 'NOLOC').pinCorrectedMeters, undefined);
  assert.equal(has(acc, 'NODIST', 'far'), false, 'null distance is still never far');
});

test('pin correction: accuracy is subtracted from the live distance too', () => {
  // ~110 m from the corrected pin at ±60 → effective 50 ≤ FAR_WARN_M → forgiven.
  const rows = [pinRow({ _id: 'ACC', sec: 0, dist: 400, latOffset: 0.001, accuracy: 60 })];
  const { acc } = computeReasons(rows, new Map(), FLAG_THRESHOLDS, fixMap('ACC', pinFix({ atSec: 3600 })));
  assert.equal(sevOf(acc, 'ACC', 'far'), 'low', 'a poor fix beside the corrected pin still exonerates');
  assert.equal(farDetail(acc, 'ACC').pinDowngraded, true);
});

test('pin correction: composes with the replaced-chain downgrade', () => {
  const replacedNear = {
    actionType: 'restricted',
    timestamp: at(0),
    location: { lat: PIN.lat, lng: PIN.lng, accuracy: 5 },
    distanceFromHouseMeters: 5,
    nearest: nearest(600, 10, 5),
  };
  // (a) both paths exonerate → low, both markers present.
  const both = pinRow({ _id: 'BOTH', sec: 600, dist: 400 });
  both.replaced = replacedNear;
  // (b) replaced is outside the window (would stay high) but the pin move forgives it.
  const pinOnly = pinRow({ _id: 'PINONLY', sec: 14 * 3600, dist: 400 });
  pinOnly.replaced = { ...replacedNear, nearest: nearest(14 * 3600, 13 * 60, 5) };
  // (c) replaced already earned low; a SELF pin-move must not revert it upward.
  const selfKeep = pinRow({ _id: 'KEEP', sec: 600, dist: 400, userId: 'u-keep' });
  selfKeep.replaced = replacedNear;

  const fixes = new Map([
    ['h-BOTH', pinFix({ atSec: 20000 })],
    ['h-PINONLY', pinFix({ atSec: 15 * 3600 })],
    ['h-KEEP', pinFix({ atSec: 20000, by: 'u-keep' })],
  ]);
  const { acc } = computeReasons([both, pinOnly, selfKeep], new Map(), FLAG_THRESHOLDS, fixes);

  assert.equal(sevOf(acc, 'BOTH', 'far'), 'low');
  assert.equal(farDetail(acc, 'BOTH').downgraded, true, 'both markers ride together');
  assert.equal(farDetail(acc, 'BOTH').pinDowngraded, true);

  assert.equal(sevOf(acc, 'PINONLY', 'far'), 'low', 'the pin path forgives what the chain could not');
  assert.equal(farDetail(acc, 'PINONLY').downgraded, undefined);
  assert.equal(farDetail(acc, 'PINONLY').pinDowngraded, true);

  // WITHHOLD, NOT REVERT — the self-move guard declines to help, it never takes back a low the
  // replaced chain already earned on independent at-the-door evidence.
  assert.equal(sevOf(acc, 'KEEP', 'far'), 'low', 'a self pin-move never upgrades an earned low');
  assert.equal(farDetail(acc, 'KEEP').downgraded, true);
  assert.equal(farDetail(acc, 'KEEP').pinMovedBySelf, true);
  assert.equal(farDetail(acc, 'KEEP').pinDowngraded, undefined);
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

test('summarize: mockGps counts open-only, like every other reason', () => {
  const entries = [
    sEntry({ userId: 'u1', reasons: ['mock_gps'] }), // open
    sEntry({ userId: 'u1', reasons: ['mock_gps'], status: 'dismissed' }),
  ];
  const { totals, byCanvasser } = summarize(entries, new Map([['u1', []]]), (id) => id);
  assert.equal(totals.mockGps, 1, 'only the open mock flag counts');
  assert.equal(byCanvasser.find((u) => u.userId === 'u1').mockGps, 1);
});
