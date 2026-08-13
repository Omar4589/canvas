import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The FbTime hours sync: replace-range semantics (hard-delete propagation),
// unmapped-person rows, fatal-vs-transient error handling, the exactly-one
// audit event per failure transition, and deep-job recovery. Throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/fbtsync node --test test/fbtimeSync.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-fbtime-sync';
process.env.CREDENTIAL_SEAL_KEY = process.env.CREDENTIAL_SEAL_KEY || Buffer.alloc(32, 7).toString('base64');

const { Organization } = await import('../src/models/Organization.js');
const { FbTimeConnection } = await import('../src/models/FbTimeConnection.js');
const { FbTimeDailyHours } = await import('../src/models/FbTimeDailyHours.js');
const { FbTimePersonLink } = await import('../src/models/FbTimePersonLink.js');
const { IntegrationEvent } = await import('../src/models/IntegrationEvent.js');
const { User } = await import('../src/models/User.js');
const { sealSecret } = await import('../src/utils/sealedSecret.js');
const { syncOrgHours, runFbtimeSync } = await import('../src/services/fbtime/sync.js');
const { installFbtimeFake, uninstallFbtimeFake, fbtimeCalls } = await import('./support/fbtimeFake.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const TZ = 'America/New_York';
const dayStr = (offsetDays = 0) =>
  new Date(Date.now() - offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ });

// One fake person-day in the /hours response shape (person-level hasStaleShift,
// day-level hasOpenShift/hasManualEntry — the provider's real contract).
const personDays = (personId, days, { hasStaleShift = false } = {}) => ({
  userId: personId,
  grossHours: days.reduce((n, d) => n + d.grossHours, 0),
  adjustedHours: days.reduce((n, d) => n + d.adjustedHours, 0),
  workedHours: days.reduce((n, d) => n + d.workedHours, 0),
  shiftCount: days.length,
  hasOpenShift: days.some((d) => d.hasOpenShift),
  hasStaleShift,
  hasManualEntry: days.some((d) => d.hasManualEntry),
  days,
});

const day = (date, hours, extra = {}) => ({
  date,
  grossHours: hours,
  adjustedHours: hours,
  workedHours: hours,
  shiftCount: 1,
  hasOpenShift: false,
  hasManualEntry: false,
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
  for (const M of [Organization, FbTimeConnection, FbTimeDailyHours, FbTimePersonLink, IntegrationEvent, User]) {
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
  for (const M of [FbTimeConnection, FbTimeDailyHours, FbTimePersonLink, IntegrationEvent]) {
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

  // Pull 1: two days for P1, one for unmapped P2.
  installFbtimeFake({
    hours: { people: [personDays(P1, [day(dayStr(1), 5.5), day(dayStr(0), 3.25)]), personDays(P2, [day(dayStr(1), 4)])] },
  });
  const first = await syncOrgHours(connection, { windowDays: 7 });
  assert.strictEqual(first.pulled, 3);

  const rows = await FbTimeDailyHours.find({ organizationId: org._id }).lean();
  assert.strictEqual(rows.length, 3);
  const p1Yesterday = rows.find((r) => r.fbtimePersonId === P1 && r.day === dayStr(1));
  assert.strictEqual(p1Yesterday.adjustedHours, 5.5);
  assert.strictEqual(String(p1Yesterday.userId), String(user1._id), 'link resolved at sync');
  const p2Row = rows.find((r) => r.fbtimePersonId === P2);
  assert.strictEqual(p2Row.userId, null, 'unmapped person kept with userId null');
  assert.strictEqual(p2Row.timeZone, TZ, 'rows stamped with the zone they were pulled under');

  // Pull 2: P1's yesterday shift was HARD-DELETED in FbTime (absent from the
  // response) and today's was edited. The cache must equal the response.
  installFbtimeFake({
    hours: { people: [personDays(P1, [day(dayStr(0), 4.0)]), personDays(P2, [day(dayStr(1), 4)])] },
  });
  const second = await syncOrgHours(connection, { windowDays: 7 });
  assert.strictEqual(second.deleted, 1, 'the vanished day-row was deleted');

  const after2 = await FbTimeDailyHours.find({ organizationId: org._id }).lean();
  assert.strictEqual(after2.length, 2);
  assert.ok(!after2.some((r) => r.fbtimePersonId === P1 && r.day === dayStr(1)), 'hard delete propagated');
  assert.strictEqual(after2.find((r) => r.fbtimePersonId === P1).adjustedHours, 4.0, 'edit propagated');
});

test('rows outside the pulled window are never touched', { skip }, async () => {
  const connection = await makeConnection(org._id);
  // A row 30 days back, beyond the 7-day window.
  await FbTimeDailyHours.create({
    organizationId: org._id, fbtimePersonId: P1, userId: null, day: dayStr(30), timeZone: TZ,
    grossHours: 2, adjustedHours: 2, workedHours: 2, shiftCount: 1,
  });
  installFbtimeFake({ hours: { people: [] } });
  await syncOrgHours(connection, { windowDays: 7 });
  assert.strictEqual(await FbTimeDailyHours.countDocuments({ organizationId: org._id }), 1, 'old row survives an empty recent pull');
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
    hours: ({ apiKey }) => {
      if (apiKey === 'fbt_test_synckey') {
        const err = new Error('FbTime HTTP 500: upstream');
        err.name = 'FbtimeApiError';
        throw Object.assign(err, { code: null, status: 500 });
      }
      return { people: [personDays(P1, [day(dayStr(0), 2)])] };
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
  assert.strictEqual(await FbTimeDailyHours.countDocuments({ organizationId: org2._id }), 1, 'the healthy org synced');
});

test('the deep job self-heals an errored connection and audits the recovery', { skip }, async () => {
  await makeConnection(org._id, { status: 'errored', lastSyncError: 'KEY_REVOKED: revoked' });
  installFbtimeFake({ hours: { people: [personDays(P1, [day(dayStr(0), 6)])] } });

  const run = await runFbtimeSync({ windowDays: 120, recoverErrored: true });
  assert.strictEqual(run.recovered, 1);

  const connection = await FbTimeConnection.findOne({ organizationId: org._id });
  assert.strictEqual(connection.status, 'connected');
  assert.strictEqual(connection.lastSyncError, null);
  assert.strictEqual(await IntegrationEvent.countDocuments({ organizationId: org._id, type: 'sync-recovered' }), 1);
  // The probe pinged before pulling.
  assert.ok(fbtimeCalls().some((c) => c.path === '/ping'));
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

test('stale flag lands only on the open day of a person with a stale shift', { skip }, async () => {
  const connection = await makeConnection(org._id);
  installFbtimeFake({
    hours: {
      people: [
        personDays(P1, [day(dayStr(2), 8), day(dayStr(1), 3.1, { hasOpenShift: true })], { hasStaleShift: true }),
      ],
    },
  });
  await syncOrgHours(connection, { windowDays: 7 });
  const rows = await FbTimeDailyHours.find({ organizationId: org._id }).lean();
  assert.strictEqual(rows.find((r) => r.day === dayStr(1)).isStale, true, 'the open old day is the stale one');
  assert.strictEqual(rows.find((r) => r.day === dayStr(2)).isStale, false, 'the closed day is not');
});
