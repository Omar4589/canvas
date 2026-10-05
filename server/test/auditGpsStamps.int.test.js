import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// The GPS stamp audit, run as the OPERATOR runs it (a child process over the real script, MONGODB_URI
// pointed at a throwaway mongod), against ledgers seeded with one row per odd-stamp category and the
// door results each path of the read-side clamp can change: a far reason removed, a high flag dropping
// to med, an honest-correction downgrade a negative snapshot accuracy denied before the clamp, and a
// pin-fix downgrade ("forgiven") a negative own accuracy denied. Seeds go in through the raw driver, so
// NaN, ±Infinity and negative values land unchanged. Locks that the script is read-only, prints no
// coordinate or id, and refuses every malformed --since before it touches the database.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/audit_gps_test node --test test/auditGpsStamps.int.test.js

const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyResponseArchive } = await import('../src/models/SurveyResponseArchive.js');
const { UnknockRunChunk } = await import('../src/models/UnknockRunChunk.js');
const { HouseholdLocationChange } = await import('../src/models/HouseholdLocationChange.js');
const { Household } = await import('../src/models/Household.js');
const { haversineMeters } = await import('../src/utils/normalizeAddress.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const run = promisify(execFile);
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations/auditGpsStamps.js');
const MODELS = [CanvassActivity, SurveyResponse, SurveyResponseArchive, UnknockRunChunk, HouseholdLocationChange, Household];

const audit = async (...flags) =>
  run(process.execPath, [SCRIPT, ...flags], { env: { ...process.env, MONGODB_URI: URI }, maxBuffer: 4 * 1024 * 1024 });
const refused = async (...flags) => {
  // No database at all: a refused --since must exit before connecting.
  try {
    await run(process.execPath, [SCRIPT, ...flags], { env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/never' } });
  } catch (e) {
    return { code: e.code, stderr: e.stderr };
  }
  return { code: 0, stderr: '' };
};
const line = (stdout, re) => {
  const m = stdout.split('\n').map((l) => re.exec(l)).find(Boolean);
  assert.ok(m, `expected a line matching ${re} in:\n${stdout}`);
  return m.slice(1).map((x) => Number(x.replace(/[+,]/g, '')));
};

const NOW = Date.now();
const RECENT = new Date(NOW - 60 * 60 * 1000);
const OLD = new Date(NOW - 60 * 24 * 60 * 60 * 1000);
const ids = {};
const oid = () => new mongoose.Types.ObjectId();
const P = { lat: 33.8, lng: -84.4 };
// A corrected pin about 72 m north of P: inside FAR_WARN_M (75) as stored, outside it while a
// negative accuracy of -10 still adds distance.
const PIN_72 = { lat: 33.8 + 0.000647, lng: -84.4 };

const act = (over) => ({
  _id: oid(),
  organizationId: ids.org,
  campaignId: ids.campaign,
  householdId: ids.door,
  userId: ids.u5,
  actionType: 'not_home',
  timestamp: RECENT,
  location: { lat: P.lat, lng: P.lng, accuracy: 8, mocked: null },
  distanceFromHouseMeters: null,
  replaced: null,
  via: null,
  createdAt: RECENT,
  updatedAt: RECENT,
  ...over,
});
const loc = (accuracy, extra = {}) => ({ lat: P.lat, lng: P.lng, accuracy, mocked: null, ...extra });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of MODELS) await M.collection.deleteMany({});
  Object.assign(ids, { org: oid(), campaign: oid(), door: oid(), pinDoor: oid(), u1: oid(), u2: oid(), u3: oid(), u4: oid(), u5: oid(), mover: oid() });

  await Household.collection.insertMany([
    { _id: ids.door, organizationId: ids.org, campaignId: ids.campaign, addressLine1: '1 Audit Ave', city: 'Town', state: 'GA', zipCode: '30342', location: { type: 'Point', coordinates: [P.lng, P.lat] }, coordSource: 'import' },
    // Moved by a lead AFTER the knock in row F: the pin-downgrade path.
    { _id: ids.pinDoor, organizationId: ids.org, campaignId: ids.campaign, addressLine1: '2 Audit Ave', city: 'Town', state: 'GA', zipCode: '30342', location: { type: 'Point', coordinates: [PIN_72.lng, PIN_72.lat] }, coordSource: 'corrected', correctedAt: new Date(NOW - 10 * 60 * 1000), correctedBy: ids.mover },
  ]);

  const nearTime = new Date(RECENT.getTime() - 30 * 60 * 1000);
  ids.rows = await CanvassActivity.collection.insertMany([
    act({ location: loc(8) }), // clean
    // The clamp's paths.
    act({ userId: ids.u1, location: loc(-10), distanceFromHouseMeters: 70 }), // A: med today, nothing after
    act({ userId: ids.u1, location: loc(-10), distanceFromHouseMeters: 245 }), // B: high today, med after
    act({ userId: ids.u4, location: loc(-1), distanceFromHouseMeters: 5 }), // C: never far
    act({
      // E: high, and the chain's nearest stamp is only "at the door" once its negative radius stops adding
      userId: ids.u2,
      location: loc(5),
      distanceFromHouseMeters: 300,
      replaced: { actionType: 'not_home', timestamp: nearTime, distanceFromHouseMeters: 300, location: loc(5), nearest: { distanceFromHouseMeters: 70, accuracy: -10, timestamp: nearTime } },
    }),
    act({ userId: ids.u3, householdId: ids.pinDoor, location: loc(-10), distanceFromHouseMeters: 300 }), // F: pin-forgiven only after
    act({ userId: ids.u1, location: loc(-10), distanceFromHouseMeters: 70, via: 'bulk' }), // G: desk row, never audited
    // One per odd-stamp category, no distance so the far rule ignores them.
    act({ location: loc(0, { mocked: true }), createdAt: new Date('2026-08-15T12:00:00Z') }),
    act({ location: loc(0, { mocked: false }), createdAt: new Date('2026-09-15T12:00:00Z') }),
    act({ location: loc(0), createdAt: new Date('2026-09-20T12:00:00Z') }),
    act({ location: loc(NaN) }),
    act({ location: loc(Infinity) }),
    act({ location: { lat: Infinity, lng: P.lng, accuracy: 8 } }),
    act({ location: { lat: 95, lng: P.lng, accuracy: 8 } }),
    act({ location: { lat: 0, lng: 0, accuracy: 8 } }),
    act({ replaced: { actionType: 'not_home', timestamp: OLD, location: loc(-1), distanceFromHouseMeters: 10, nearest: null } }),
  ]);

  const survey = (accuracy, extra = {}) => ({ _id: oid(), organizationId: ids.org, campaignId: ids.campaign, householdId: ids.door, userId: ids.u5, location: { lat: P.lat, lng: P.lng, accuracy, ...extra }, createdAt: RECENT, updatedAt: RECENT });
  await SurveyResponse.collection.insertMany([survey(10), survey(-2), { ...survey(10), location: { lat: P.lat, lng: 200, accuracy: 10 } }]);
  await SurveyResponseArchive.collection.insertMany([survey(10), survey(0)]);
  await UnknockRunChunk.collection.insertMany([
    {
      _id: oid(), runId: oid(), campaignId: ids.campaign, organizationId: ids.org, seq: 0, frozenAt: RECENT, createdAt: RECENT, updatedAt: RECENT,
      // Frozen verbatim: rows from two months ago, in a chunk written an hour ago.
      rows: [act({ createdAt: OLD }), act({ location: loc(-1), createdAt: OLD })],
    },
  ]);
  await HouseholdLocationChange.collection.insertMany([
    { _id: oid(), householdId: ids.door, source: 'gps', accuracy: 0, createdAt: RECENT },
    { _id: oid(), householdId: ids.door, source: 'gps', accuracy: 12, createdAt: RECENT },
    { _id: oid(), householdId: ids.door, source: 'admin_drag', accuracy: null, createdAt: RECENT },
  ]);
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('every odd-stamp category is counted on each ledger, against the rows scanned', { skip }, async () => {
  const { stdout } = await audit();
  assert.match(stdout, /every stored row\. Read-only\./);
  assert.deepStrictEqual(line(stdout, /^Door results \(CanvassActivity\): ([\d,]+) with an odd GPS stamp, of ([\d,]+) stored$/), [15, 16]);
  assert.deepStrictEqual(line(stdout, /^  accuracy negative ([\d,]+) · zero ([\d,]+) · not finite ([\d,]+)$/), [5, 3, 2], 'NaN counts as not finite, never as negative');
  assert.deepStrictEqual(line(stdout, /^  coordinate not finite ([\d,]+) · off the Earth ([\d,]+) · exactly \(0, 0\) ([\d,]+)$/), [1, 1, 1]);
  assert.deepStrictEqual(line(stdout, /^  replaced-entry snapshot with an unusable accuracy ([\d,]+)$/), [2]);
  assert.deepStrictEqual(line(stdout, /^Survey responses \(SurveyResponse\): ([\d,]+) with an odd GPS stamp, of ([\d,]+) stored$/), [2, 3]);
  assert.deepStrictEqual(line(stdout, /^Replaced survey answers \(SurveyResponseArchive\): ([\d,]+) with an odd GPS stamp, of ([\d,]+) stored$/), [1, 2]);
  assert.deepStrictEqual(line(stdout, /^Unknocked entries held for a revert: ([\d,]+) with an odd GPS stamp, of ([\d,]+) stored$/), [1, 2]);
  assert.deepStrictEqual(line(stdout, /^GPS pin fixes with a zero, negative or non-finite accuracy: ([\d,]+), of ([\d,]+) stored$/), [1, 2], 'only GPS pin fixes are scanned');
});

test('zero accuracies are split by month and by the mock-location flag', { skip }, async () => {
  const { stdout } = await audit();
  assert.match(stdout, /zero accuracies by month: 2026-08: 1 mock-location, 0 other · 2026-09: 0 mock-location, 2 other/);
});

test('what the clamp changes: far reasons removed, severity drops, the Far count and forgiven', { skip }, async () => {
  // Pin the fixture's geometry first: the pin-downgrade row depends on it.
  const liveM = Math.round(haversineMeters(P.lat, P.lng, PIN_72.lat, PIN_72.lng));
  assert.ok(liveM <= 75 && liveM + 10 > 75, `the corrected pin sits ${liveM} m away`);
  const { stdout } = await audit();
  assert.deepStrictEqual(line(stdout, /^What the clamp changes .*: ([\d,]+) row\(s\)$/), [5], 'A, B, C, E and F; the desk row G is never audited');
  assert.deepStrictEqual(line(stdout, /^  audit far reasons removed ([\d,]+) · flags whose severity drops ([\d,]+)$/), [1, 4], 'A removed; A, B, E and F drop');
  assert.deepStrictEqual(
    line(stdout, /^  per-canvasser Far count ([+-]?[\d,]+) · forgiven ([+-]?[\d,]+) · canvassers affected ([\d,]+)$/),
    [-2, 1, 3],
    'E and F leave the Far count, F is forgiven, and the untouched C does not count its canvasser'
  );
});

test('--since with an offset narrows to rows created at or after it; frozen rows by their own dates', { skip }, async () => {
  // One day back, written in Central daylight time.
  const at = new Date(NOW - 24 * 60 * 60 * 1000);
  const local = new Date(at.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const { stdout } = await audit(`--since=${local}-05:00`);
  assert.match(stdout, new RegExp(`rows created at or after ${at.toISOString().slice(0, 16)}`), 'prints the instant it parsed, in UTC');
  assert.match(stdout, / at -05:00\)/, 'and in the offset it was given');
  assert.deepStrictEqual(line(stdout, /^Door results \(CanvassActivity\): ([\d,]+) with an odd GPS stamp, of ([\d,]+) created since then$/), [12, 13], 'the three dated zero rows fall away');
  assert.deepStrictEqual(line(stdout, /^  accuracy negative ([\d,]+) · zero ([\d,]+) · not finite ([\d,]+)$/), [5, 0, 2]);
  assert.deepStrictEqual(line(stdout, /^Unknocked entries held for a revert: ([\d,]+) with an odd GPS stamp, of ([\d,]+) created since then$/), [0, 0], 'a recent chunk holding old rows counts none of them');
});

test('a bare --since date is read as 00:00 UTC', { skip }, async () => {
  const { stdout } = await audit('--since=2026-09-01');
  assert.match(stdout, /rows created at or after 2026-09-01T00:00:00\.000Z \(the bare date 2026-09-01, read as 00:00 UTC\)/);
  assert.deepStrictEqual(line(stdout, /^  accuracy negative ([\d,]+) · zero ([\d,]+) · not finite ([\d,]+)$/), [5, 2, 2], 'the August zero falls away');
});

test('a time without an offset, an impossible date, a future time and stray arguments are refused before any connection', { skip }, async () => {
  for (const [flags, why] of [
    [['--since=2026-10-13T23:45'], /no UTC offset/],
    [['--since=2026-10-13 23:45'], /no UTC offset/],
    [['--since=2026-02-30'], /not a real date/],
    [['--since=2026-10-13T24:00-05:00'], /not a real date/],
    [['--since=2026-10-13T23:45+15:00'], /impossible UTC offset/],
    [['--since=2999-01-01'], /in the future/],
    [['--since=yesterday'], /not a date/],
    [['--since=2026-10'], /not a date/],
    [['--apply'], /Unknown argument/],
  ]) {
    const r = await refused(...flags);
    assert.strictEqual(r.code, 1, `${flags} must exit 1`);
    assert.match(r.stderr, why, `${flags}: ${r.stderr}`);
  }
});

test('prints no coordinate, name or id', { skip }, async () => {
  const { stdout } = await audit();
  for (const id of [ids.org, ids.campaign, ids.door, ids.pinDoor, ids.u1, ids.u2, ids.u3, ids.u5, ids.mover]) {
    assert.ok(!stdout.includes(String(id)), `id ${id} printed`);
  }
  for (const coord of ['33.8', '84.4', '33.800647']) assert.ok(!stdout.includes(coord), `coordinate ${coord} printed`);
});

test('read-only: every collection count and a sampled document are unchanged after a run', { skip }, async () => {
  const counts = async () => Promise.all(MODELS.map((M) => M.collection.countDocuments()));
  const sampleId = ids.rows.insertedIds[1];
  const before = { counts: await counts(), doc: await CanvassActivity.collection.findOne({ _id: sampleId }) };
  await audit();
  await audit('--since=2026-09-01');
  assert.deepStrictEqual(await counts(), before.counts);
  assert.deepStrictEqual(await CanvassActivity.collection.findOne({ _id: sampleId }), before.doc);
});
