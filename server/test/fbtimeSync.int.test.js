import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The FbTime shifts sync: replace-range semantics (hard-delete propagation),
// unmapped-person rows, fatal-vs-transient error handling, the exactly-one
// audit event per failure transition, deep-job recovery — and the read-time
// bucketing the shift cache exists for: one cache serving ANY anchor zone,
// with day totals that reproduce the provider's own /hours math. Throwaway
// mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/fbtsync node --test test/fbtimeSync.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-fbtime-sync';
process.env.CREDENTIAL_SEAL_KEY = process.env.CREDENTIAL_SEAL_KEY || Buffer.alloc(32, 7).toString('base64');

const { Organization } = await import('../src/models/Organization.js');
const { FbTimeConnection } = await import('../src/models/FbTimeConnection.js');
const { FbTimeShift } = await import('../src/models/FbTimeShift.js');
const { FbTimePersonLink } = await import('../src/models/FbTimePersonLink.js');
const { IntegrationEvent } = await import('../src/models/IntegrationEvent.js');
const { User } = await import('../src/models/User.js');
const { sealSecret } = await import('../src/utils/sealedSecret.js');
const { syncOrgHours, syncOneConnection, runFbtimeSync } = await import('../src/services/fbtime/sync.js');
const { loadMeasuredHours } = await import('../src/services/reports/hoursSource.js');
const { zonedDayStr, zonedTimeToUtc } = await import('../src/utils/timezone.js');
const { installFbtimeFake, uninstallFbtimeFake, fbtimeCalls } = await import('./support/fbtimeFake.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const TZ = 'America/New_York';
// An instant `offsetDays` back at `hourUtc` — clockIn fixtures are UTC instants
// on purpose (that is what the cache stores); local days fall out per zone.
const at = (offsetDays, hourUtc = 14) => {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
};

// One fake shift in the /shifts response shape (per-shift figures, already
// 2dp-rounded — the provider's real contract).
const shift = (id, personId, clockIn, hours, extra = {}) => ({
  id,
  userId: personId,
  clockIn: clockIn.toISOString(),
  isOpen: false,
  isStale: false,
  grossHours: hours,
  adjustedHours: hours,
  workedHours: hours,
  isManualEntry: false,
  entryTimeZone: TZ,
  ...extra,
});

const P1 = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const P2 = 'aaaaaaaaaaaaaaaaaaaaaaa2';

let org;
let org2;
let user1;

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, FbTimeConnection, FbTimeShift, FbTimePersonLink, IntegrationEvent, User]) {
    await M.deleteMany({});
  }
  org = await Organization.create({ name: 'SyncOrg', slug: 'sync-org', isActive: true });
  org2 = await Organization.create({ name: 'OtherOrg', slug: 'other-org', isActive: true });
  user1 = await User.create({
    firstName: 'Maria', lastName: 'D', email: 'maria@t.co', passwordHash: 'x', isActive: true,
  });
});

after(async () => {
  uninstallFbtimeFake();
  if (URI) await mongoose.disconnect();
});

beforeEach(async () => {
  if (!URI) return;
  uninstallFbtimeFake();
  for (const M of [FbTimeConnection, FbTimeShift, FbTimePersonLink, IntegrationEvent]) {
    await M.deleteMany({});
  }
});

const makeConnection = (organizationId, overrides = {}) =>
  FbTimeConnection.create({
    organizationId,
    status: 'connected',
    keyCiphertext: sealSecret('fbt_test_synckey'),
    keyPrefix: 'fbt_test_syn',
    fbtimeOrgId: 'f1',
    fbtimeOrgName: 'Fake FbTime Org',
    ...overrides,
  });

test('replace-range: upserts what the response holds, deletes what it no longer does', { skip }, async () => {
  const connection = await makeConnection(org._id);
  await FbTimePersonLink.create({
    organizationId: org._id, userId: user1._id, fbtimePersonId: P1, source: 'manual',
  });

  // Pull 1: two shifts for P1, one for unmapped P2.
  installFbtimeFake({
    shifts: [shift('s1', P1, at(1), 5.5), shift('s2', P1, at(0), 3.25), shift('s3', P2, at(1), 4)],
  });
  const first = await syncOrgHours(connection, { windowDays: 7 });
  assert.strictEqual(first.pulled, 3);

  const rows = await FbTimeShift.find({ organizationId: org._id }).lean();
  assert.strictEqual(rows.length, 3);
  const s1 = rows.find((r) => r.shiftId === 's1');
  assert.strictEqual(s1.adjustedHours, 5.5);
  assert.strictEqual(String(s1.userId), String(user1._id), 'link resolved at sync');
  const s3 = rows.find((r) => r.shiftId === 's3');
  assert.strictEqual(s3.userId, null, 'unmapped person kept with userId null');
  assert.strictEqual(s3.entryTimeZone, TZ, 'the clocked-in zone rides along as a diagnostic');
  assert.strictEqual(s1.isStale, undefined, "the provider's isStale is NEVER cached — it embeds a today");

  // Pull 2: s1 was HARD-DELETED in FbTime (absent from the response) and s2
  // was edited. The cache must equal the response.
  installFbtimeFake({
    shifts: [shift('s2', P1, at(0), 4.0), shift('s3', P2, at(1), 4)],
  });
  const second = await syncOrgHours(connection, { windowDays: 7 });
  assert.strictEqual(second.deleted, 1, 'the vanished shift was deleted');

  const after2 = await FbTimeShift.find({ organizationId: org._id }).lean();
  assert.strictEqual(after2.length, 2);
  assert.ok(!after2.some((r) => r.shiftId === 's1'), 'hard delete propagated');
  assert.strictEqual(after2.find((r) => r.shiftId === 's2').adjustedHours, 4.0, 'edit propagated');
});

test('the project label rides every shift and is NEVER persisted', { skip }, async () => {
  // `project: { id, name }` travels on every real shift row (PARTNER_API.md), and
  // the mapping screen now DISPLAYS it — derived live per request, stored nowhere.
  // That keeps FbTimeShift's "DELIBERATELY NOT STORED" minimization list true, and
  // it keeps the label out of reach of hours attribution, which follows the KNOCK
  // LEDGER by owner ruling (2026-08-16) precisely because an FbTime location is an
  // honor-system dropdown somebody forgets to switch.
  const connection = await makeConnection(org._id);
  installFbtimeFake({
    shifts: [
      shift('proj1', P1, at(1), 6, { project: { id: 'pr1', name: 'Ward 5 Field' } }),
      shift('proj2', P2, at(0), 4, { project: { id: 'pr2', name: 'Warehouse' } }),
    ],
  });
  await syncOrgHours(connection, { windowDays: 7 });

  const rows = await FbTimeShift.find({ organizationId: org._id }).lean();
  assert.ok(rows.length >= 2, 'the shifts still synced');
  for (const row of rows) {
    assert.ok(!('project' in row), 'no shift document may hold the provider project object');
    assert.ok(!('projectId' in row) && !('projectName' in row), 'nor a flattened copy of it');
  }
  // The hours themselves are untouched by the label riding along.
  assert.strictEqual(rows.find((r) => r.shiftId === 'proj1').adjustedHours, 6);
});

test('an edited clockIn UPDATES the same row — the shift id is the identity, not the instant', { skip }, async () => {
  const connection = await makeConnection(org._id);
  installFbtimeFake({ shifts: [shift('s1', P1, at(1, 14), 5.5)] });
  await syncOrgHours(connection, { windowDays: 7 });

  // An admin corrects the clock-in by two hours; same shift, new instant.
  installFbtimeFake({ shifts: [shift('s1', P1, at(1, 12), 7.4)] });
  const res = await syncOrgHours(connection, { windowDays: 7 });
  assert.strictEqual(res.deleted, 0, 'no delete+insert — the row moved in place');
  const rows = await FbTimeShift.find({ organizationId: org._id }).lean();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].clockIn.getUTCHours(), 12);
  assert.strictEqual(rows[0].adjustedHours, 7.4);
});

test('shifts outside the pulled window are never touched', { skip }, async () => {
  const connection = await makeConnection(org._id);
  // A shift 30 days back, beyond the 7-day window.
  await FbTimeShift.create({
    organizationId: org._id, shiftId: 'old1', fbtimePersonId: P1, userId: null,
    clockIn: at(30), grossHours: 2, adjustedHours: 2, workedHours: 2,
  });
  installFbtimeFake({ shifts: [] });
  await syncOrgHours(connection, { windowDays: 7 });
  assert.strictEqual(await FbTimeShift.countDocuments({ organizationId: org._id }), 1, 'old shift survives an empty recent pull');
});

test('a FATAL code marks the connection errored with exactly ONE audit event across repeated runs', { skip }, async () => {
  await makeConnection(org._id);
  installFbtimeFake({ error: { code: 'KEY_REVOKED', status: 401 } });

  const run1 = await runFbtimeSync({ windowDays: 7 });
  assert.strictEqual(run1.errored, 1);
  let connection = await FbTimeConnection.findOne({ organizationId: org._id });
  assert.strictEqual(connection.status, 'errored');
  assert.match(connection.lastSyncError, /KEY_REVOKED/);

  // Recent runs skip errored connections entirely; a deep run re-pings and
  // fails again — but the transition already happened, so no second event.
  const run2 = await runFbtimeSync({ windowDays: 7 });
  assert.strictEqual(run2.orgs, 0, 'errored connection not retried by the recent job');
  await runFbtimeSync({ windowDays: 120, recoverErrored: true });

  const events = await IntegrationEvent.find({ organizationId: org._id, type: 'sync-failed' });
  assert.strictEqual(events.length, 1, 'one revoked key = one audit row, not a wall of them');
  assert.strictEqual(events[0].detail.code, 'KEY_REVOKED');
  assert.strictEqual(events[0].byUserId, null, 'the worker, not a person');
});

test('a TRANSIENT error records itself but keeps the connection live; other orgs still sync', { skip }, async () => {
  await makeConnection(org._id);
  const conn2 = await makeConnection(org2._id, { keyCiphertext: sealSecret('fbt_test_okkey') });

  // First org's pull 500s; second org's succeeds — keyed per apiKey.
  installFbtimeFake({
    shifts: ({ apiKey }) => {
      if (apiKey === 'fbt_test_synckey') {
        const err = new Error('FbTime HTTP 500: upstream');
        err.name = 'FbtimeApiError';
        throw Object.assign(err, { code: null, status: 500 });
      }
      return [shift('s9', P1, at(0), 2)];
    },
  });

  const run = await runFbtimeSync({ windowDays: 7 });
  assert.strictEqual(run.ok, 1);
  assert.strictEqual(run.errored, 1);

  const failed = await FbTimeConnection.findOne({ organizationId: org._id });
  assert.strictEqual(failed.status, 'connected', 'transient failure does NOT error the connection');
  assert.ok(failed.lastSyncError, 'but the status card can say why');
  assert.strictEqual(await IntegrationEvent.countDocuments({ organizationId: org._id }), 0, 'no audit event for a blip');
  assert.strictEqual(String((await FbTimeConnection.findById(conn2._id)).lastSyncAt) !== 'null', true);
  assert.strictEqual(await FbTimeShift.countDocuments({ organizationId: org2._id }), 1, 'the healthy org synced');
});

test('the deep job self-heals an errored connection and audits the recovery', { skip }, async () => {
  await makeConnection(org._id, { status: 'errored', lastSyncError: 'KEY_REVOKED: revoked' });
  installFbtimeFake({ shifts: [shift('s1', P1, at(0), 6)] });

  const run = await runFbtimeSync({ windowDays: 120, recoverErrored: true });
  assert.strictEqual(run.recovered, 1);

  const connection = await FbTimeConnection.findOne({ organizationId: org._id });
  assert.strictEqual(connection.status, 'connected');
  assert.strictEqual(connection.lastSyncError, null);
  assert.strictEqual(await IntegrationEvent.countDocuments({ organizationId: org._id, type: 'sync-recovered' }), 1);
  // The probe pinged before pulling.
  assert.ok(fbtimeCalls().some((c) => c.path === '/ping'));
});

test('syncOneConnection self-heals an errored connection in one call — the manual-refresh retry path', { skip }, async () => {
  const connection = await makeConnection(org._id, { status: 'errored', lastSyncError: 'KEY_REVOKED: revoked' });
  installFbtimeFake({ shifts: [shift('s1', P1, at(0), 6)] });

  const res = await syncOneConnection(connection, { windowDays: 120 });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.recovered, true);

  const saved = await FbTimeConnection.findOne({ organizationId: org._id });
  assert.strictEqual(saved.status, 'connected');
  assert.strictEqual(saved.lastSyncError, null);
  assert.strictEqual(await IntegrationEvent.countDocuments({ organizationId: org._id, type: 'sync-recovered' }), 1);
  assert.strictEqual(await FbTimeShift.countDocuments({ organizationId: org._id }), 1, 'the pull ran after the probe');
});

test('syncOneConnection absorbs a fatal refusal instead of throwing — the org job stays alive to record it', { skip }, async () => {
  const connection = await makeConnection(org._id);
  installFbtimeFake({ error: { code: 'KEY_REVOKED', status: 401 } });

  const res = await syncOneConnection(connection, { windowDays: 120 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'KEY_REVOKED');

  const saved = await FbTimeConnection.findOne({ organizationId: org._id });
  assert.strictEqual(saved.status, 'errored');
  assert.match(saved.lastSyncError, /KEY_REVOKED/);
  assert.ok(saved.lastErrorAt, 'the client reads completion off this stamp');
  assert.strictEqual(await IntegrationEvent.countDocuments({ organizationId: org._id, type: 'sync-failed' }), 1);
});

test('sync is dormant without CREDENTIAL_SEAL_KEY — a no-op, not a crash', { skip }, async () => {
  const saved = process.env.CREDENTIAL_SEAL_KEY;
  delete process.env.CREDENTIAL_SEAL_KEY;
  try {
    const run = await runFbtimeSync({ windowDays: 7 });
    assert.strictEqual(run.dormant, true);
  } finally {
    process.env.CREDENTIAL_SEAL_KEY = saved;
  }
});

// ── read-time bucketing: what the shift cache exists for ────────────────────

test('ONE cache serves ANY anchor zone — the Nebraska regression', { skip }, async () => {
  const connection = await makeConnection(org._id);
  await FbTimePersonLink.create({
    organizationId: org._id, userId: user1._id, fbtimePersonId: P1, source: 'manual',
  });
  // 14:00 UTC = 10:00 EDT = 09:00 CDT — the same local day everywhere.
  installFbtimeFake({ shifts: [shift('s1', P1, at(3, 14), 5.5)] });
  await syncOrgHours(connection, { windowDays: 7 });

  for (const tz of ['America/New_York', 'America/Chicago']) {
    const day = zonedDayStr(at(3, 14), tz);
    const measured = await loadMeasuredHours({ organizationId: org._id, from: day, to: day, tz });
    assert.strictEqual(measured.enabled, true);
    assert.strictEqual(
      measured.byUserDay.get(`${user1._id}|${day}`)?.hours, 5.5,
      `the same cached shift measures under ${tz} — no zone is a second-class campaign`
    );
  }
});

test('a cross-midnight shift belongs to the day it STARTED — in each zone’s own calendar', { skip }, async () => {
  const connection = await makeConnection(org._id);
  await FbTimePersonLink.create({
    organizationId: org._id, userId: user1._id, fbtimePersonId: P1, source: 'manual',
  });
  // 00:30 New York = 23:30 Chicago the previous local day, in EVERY season
  // (the zones sit exactly one hour apart year-round, so a UTC-anchored
  // fixture would flake across DST — build the instant from a LOCAL spec).
  // The SAME instant is one calendar day in Chicago and the next in New York —
  // and both must agree with how knocks at that instant would bucket, which
  // zonedDayStr defines.
  const [y, m, d] = zonedDayStr(at(3), 'America/New_York').split('-').map(Number);
  const clockIn = zonedTimeToUtc(y, m, d, 0, 30, 0, 'America/New_York');
  installFbtimeFake({ shifts: [shift('s1', P1, clockIn, 4.2)] });
  await syncOrgHours(connection, { windowDays: 7 });

  const cdtDay = zonedDayStr(clockIn, 'America/Chicago');
  const edtDay = zonedDayStr(clockIn, 'America/New_York');
  assert.notStrictEqual(cdtDay, edtDay, 'the fixture instant really straddles midnight');

  const central = await loadMeasuredHours({ organizationId: org._id, from: cdtDay, to: cdtDay, tz: 'America/Chicago' });
  assert.strictEqual(central.byUserDay.get(`${user1._id}|${cdtDay}`)?.hours, 4.2);

  const eastern = await loadMeasuredHours({ organizationId: org._id, from: edtDay, to: edtDay, tz: 'America/New_York' });
  assert.strictEqual(eastern.byUserDay.get(`${user1._id}|${edtDay}`)?.hours, 4.2);
  assert.ok(!eastern.byUserDay.has(`${user1._id}|${cdtDay}`), 'never double-bucketed');
});

test('day totals reproduce the provider’s own /hours math: 2dp per shift, summed already-rounded', { skip }, async () => {
  const connection = await makeConnection(org._id);
  await FbTimePersonLink.create({
    organizationId: org._id, userId: user1._id, fbtimePersonId: P1, source: 'manual',
  });
  // Three shifts in one local day, figures already 2dp as the contract sends
  // them. The provider's /hours would report round2(1.13 + 2.87 + 0.1) = 4.1.
  installFbtimeFake({
    shifts: [
      shift('s1', P1, at(2, 12), 1.13),
      shift('s2', P1, at(2, 15), 2.87),
      shift('s3', P1, at(2, 18), 0.1),
    ],
  });
  await syncOrgHours(connection, { windowDays: 7 });

  const day = zonedDayStr(at(2, 12), TZ);
  const measured = await loadMeasuredHours({ organizationId: org._id, from: day, to: day, tz: TZ });
  assert.strictEqual(measured.byUserDay.get(`${user1._id}|${day}`)?.hours, 4.1, 'no float noise reaches the wire');
});

test('staleness is derived at read: yesterday’s open shift falls back, today’s measures', { skip }, async () => {
  const connection = await makeConnection(org._id);
  await FbTimePersonLink.create({
    organizationId: org._id, userId: user1._id, fbtimePersonId: P1, source: 'manual',
  });
  // A forgotten clock-out from an earlier day and a healthy open shift right
  // now. Two days back at 13:00 UTC is strictly before NY-today at any wall
  // clock; clockIn = the present instant is NY-today by definition.
  const staleOpen = shift('s1', P1, at(2, 13), 26.4, { isOpen: true });
  const todayOpen = shift('s2', P1, new Date(), 1.0, { isOpen: true });
  installFbtimeFake({ shifts: [staleOpen, todayOpen] });
  await syncOrgHours(connection, { windowDays: 7 });

  const measured = await loadMeasuredHours({ organizationId: org._id, from: null, to: null, tz: TZ });
  const yDay = zonedDayStr(at(2, 13), TZ);
  const tDay = zonedDayStr(new Date(), TZ);
  assert.strictEqual(measured.byUserDay.get(`${user1._id}|${yDay}`)?.isStale, true, 'the ghost day is disqualified');
  assert.strictEqual(measured.byUserDay.get(`${user1._id}|${tDay}`)?.isStale, false, "today's open shift is just open");
  assert.strictEqual(measured.byUserDay.get(`${user1._id}|${tDay}`)?.isOpen, true, 'and labeled as running');
});
