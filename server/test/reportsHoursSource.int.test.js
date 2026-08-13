import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The reports endpoints' measured-hours shape, over the REAL app:
//  - timeline rows KEEP the derived span (old builds sum them) + additive
//    measuredHoursOnDoors/hoursSource + the all-or-nothing measuredKpi;
//  - /canvassers rows carry MERGED values + hoursSource;
//  - team-averages applies the aggregate rule server-side;
//  - canvassers.csv carries the preamble stamp + trailing 'Hours source' column;
//  - per-canvasser summary/daily label their days.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/fbtreports node --test test/reportsHoursSource.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-fbtime-reports';
process.env.CREDENTIAL_SEAL_KEY = process.env.CREDENTIAL_SEAL_KEY || Buffer.alloc(32, 5).toString('base64');

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { FbTimeConnection } = await import('../src/models/FbTimeConnection.js');
const { FbTimeDailyHours } = await import('../src/models/FbTimeDailyHours.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const TZ = 'America/New_York'; // the org default — the anchor tz for org-scoped reports
const P1 = 'ccccccccccccccccccccccc1';

// Fixed local days, well in the past so "today" logic never interferes.
const DAY_A = '2026-08-03';
const DAY_B = '2026-08-04';
// An instant HH:00 local (EDT = UTC-4 in August).
const at = (day, hourLocal) => new Date(`${day}T${String(hourLocal).padStart(2, '0')}:00:00-04:00`);

let server;
let base;
const ctx = {};

async function knock(userId, day, hourLocal, actionType = 'not_home') {
  await CanvassActivity.create({
    organizationId: ctx.org._id,
    campaignId: ctx.campaign._id,
    householdId: new mongoose.Types.ObjectId(),
    userId,
    actionType,
    location: { lat: 26.1, lng: -81.8 },
    timestamp: at(day, hourLocal),
  });
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CanvassActivity, FbTimeConnection, FbTimeDailyHours]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'RepOrg', slug: 'rep-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'A', email: 'ada@rep.co', passwordHash: 'x', isActive: true });
  const u1 = await User.create({ firstName: 'Maria', lastName: 'M', email: 'm@rep.co', passwordHash: 'x', isActive: true });
  const u2 = await User.create({ firstName: 'Sam', lastName: 'S', email: 's@rep.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: u1._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: u2._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const campaign = await Campaign.create({ organizationId: org._id, name: 'Rep', type: 'lit_drop', state: 'FL' });

  Object.assign(ctx, { org, campaign, u1, u2, admin: { token: signUserToken(admin), orgId: org._id } });

  // DAY_A: u1 knocks 10:00→14:00 local (span 4h), and has a MEASURED row of 5.5h.
  await knock(u1._id, DAY_A, 10);
  await knock(u1._id, DAY_A, 12, 'lit_dropped');
  await knock(u1._id, DAY_A, 14);
  // DAY_B: u2 knocks 09:00→12:00 (span 3h), NO measured row.
  await knock(u2._id, DAY_B, 9);
  await knock(u2._id, DAY_B, 12, 'lit_dropped');

  await FbTimeConnection.create({
    organizationId: org._id, status: 'connected', keyCiphertext: 'unused-here', keyPrefix: 'fbt_test_xx',
    hourFigure: 'adjustedHours', fbtimeOrgId: 'f1', fbtimeOrgName: 'Fake',
  });
  await FbTimeDailyHours.create({
    organizationId: org._id, fbtimePersonId: P1, userId: u1._id, day: DAY_A, timeZone: TZ,
    grossHours: 6, adjustedHours: 5.5, workedHours: 5.25, shiftCount: 1,
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function get(path, raw = false) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${ctx.admin.token}`, 'X-Org-Id': String(ctx.admin.orgId) },
  });
  return { status: res.status, body: raw ? await res.text() : await res.json() };
}

test('timeline rows keep the DERIVED span; measured arrives additively; mixed window → measuredKpi null', { skip }, async () => {
  const { status, body } = await get(`/admin/reports/canvasser-timeline?from=${DAY_A}&to=${DAY_B}`);
  assert.strictEqual(status, 200);

  const r1 = body.canvassers.find((c) => c.userId === String(ctx.u1._id));
  assert.strictEqual(r1.hoursOnDoors, 4, 'the row field is still the knock span — old builds sum it');
  assert.strictEqual(r1.measuredHoursOnDoors, 5.5, 'the merged figure rides additively');
  assert.strictEqual(r1.hoursSource, 'measured');
  assert.strictEqual(r1.doorsPerHour, Math.round((r1.dayKnocks / 4) * 100) / 100, 'row rate still derived');

  const r2 = body.canvassers.find((c) => c.userId === String(ctx.u2._id));
  assert.strictEqual(r2.hoursSource, 'estimated');
  assert.strictEqual(r2.measuredHoursOnDoors, 3, 'estimated row: merged figure equals its span');

  // One estimated contributor → the aggregate offers NO measured rate.
  assert.strictEqual(body.measuredKpi.hoursOnDoors, null);
  assert.strictEqual(body.measuredKpi.hoursSource, 'estimated');
});

test('an all-measured window yields a non-null measuredKpi equal to the measured sum', { skip }, async () => {
  const { body } = await get(`/admin/reports/canvasser-timeline?from=${DAY_A}&to=${DAY_A}`);
  assert.strictEqual(body.canvassers.length, 1, 'only u1 worked DAY_A');
  assert.strictEqual(body.measuredKpi.hoursSource, 'measured');
  assert.strictEqual(body.measuredKpi.hoursOnDoors, 5.5);
});

test('/canvassers rows carry MERGED hours + provenance', { skip }, async () => {
  const { body } = await get(`/admin/reports/canvassers?from=${DAY_A}&to=${DAY_B}`);
  const r1 = body.find((c) => c.userId === String(ctx.u1._id));
  assert.strictEqual(r1.hoursOnDoors, 5.5, 'leaderboard hours are the merged value');
  assert.strictEqual(r1.hoursSource, 'measured');
  assert.strictEqual(r1.doorsPerHour, Math.round((r1.knocks / 5.5) * 100) / 100);
  assert.strictEqual(r1.daysActive, 1, 'daysActive keeps its knock-day meaning');

  const r2 = body.find((c) => c.userId === String(ctx.u2._id));
  assert.strictEqual(r2.hoursOnDoors, 3, 'no measured row → the span, as before');
  assert.strictEqual(r2.hoursSource, 'estimated');
});

test('team-averages applies the aggregate rule server-side and says which it used', { skip }, async () => {
  const mixed = await get(`/admin/reports/team-averages?from=${DAY_A}&to=${DAY_B}`);
  assert.strictEqual(mixed.body.hoursSource, 'estimated', 'one unmeasured contributor → span for everyone');
  // u1's contribution must be the SPAN (4h), not the measured 5.5 — no partial substitution.
  assert.strictEqual(mixed.body.avg.hoursOnDoors, Math.round(((4 + 3) / 2) * 100) / 100);

  const pure = await get(`/admin/reports/team-averages?from=${DAY_A}&to=${DAY_A}`);
  assert.strictEqual(pure.body.hoursSource, 'measured');
  assert.strictEqual(pure.body.avg.hoursOnDoors, 5.5);
});

test('canvassers.csv opens with the stamp preamble and ends rows with Hours source', { skip }, async () => {
  const { status, body } = await get(`/admin/reports/canvassers.csv?from=${DAY_A}&to=${DAY_B}`, true);
  assert.strictEqual(status, 200);
  const lines = body.split('\n');
  assert.ok(lines[0].startsWith('Canvasser export,'), 'row 1 names the artifact');
  assert.match(lines[0], /hours as of \d{4}-\d{2}-\d{2}T/, 'the in-file generatedAt stamp');
  assert.strictEqual(lines[1], '', 'blank row between preamble and header');
  assert.ok(lines[2].endsWith('Hours source'), 'the provenance column is appended LAST');
  const mariaRow = lines.find((l) => l.includes('Maria'));
  assert.ok(mariaRow.endsWith('Measured'));
  const samRow = lines.find((l) => l.includes('Sam'));
  assert.ok(samRow.endsWith('Estimated'));
});

test('per-canvasser summary + daily label their hours', { skip }, async () => {
  const summary = await get(`/admin/reports/canvassers/${ctx.u1._id}/summary?from=${DAY_A}&to=${DAY_B}`);
  assert.strictEqual(summary.body.kpi.hoursOnDoors, 5.5);
  assert.strictEqual(summary.body.kpi.hoursSource, 'measured');
  assert.strictEqual(summary.body.lastSevenDays[0].hoursSource, 'measured');

  const daily = await get(`/admin/reports/canvassers/${ctx.u2._id}/daily?from=${DAY_A}&to=${DAY_B}`);
  const dayRow = daily.body.days.find((d) => d.date === DAY_B);
  assert.strictEqual(dayRow.hoursSource, 'estimated');
  assert.strictEqual(dayRow.hoursOnDoors, 3);
});

test('a DISCONNECTED org is indistinguishable from never-connected on every surface', { skip }, async () => {
  await FbTimeConnection.updateOne({ organizationId: ctx.org._id }, { $set: { status: 'disconnected' } });
  try {
    const { body } = await get(`/admin/reports/canvassers?from=${DAY_A}&to=${DAY_B}`);
    const r1 = body.find((c) => c.userId === String(ctx.u1._id));
    assert.strictEqual(r1.hoursOnDoors, 4, 'back to the span');
    assert.strictEqual(r1.hoursSource, 'estimated');

    const tl = await get(`/admin/reports/canvasser-timeline?from=${DAY_A}&to=${DAY_A}`);
    assert.strictEqual(tl.body.canvassers[0].measuredHoursOnDoors, null, 'no live connection → null, not a number');
  } finally {
    await FbTimeConnection.updateOne({ organizationId: ctx.org._id }, { $set: { status: 'connected' } });
  }
});
