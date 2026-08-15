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
const { FbTimeShift } = await import('../src/models/FbTimeShift.js');
const { FbTimePersonLink } = await import('../src/models/FbTimePersonLink.js');
const { zonedDayStr } = await import('../src/utils/timezone.js');

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
  for (const M of [Organization, User, Membership, Campaign, CanvassActivity, FbTimeConnection, FbTimeShift, FbTimePersonLink]) {
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

  // DAY_A: u1 knocks 10:00→14:00 local (span 4h), and has a MEASURED 5.5h shift.
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
  // u1 is LINKED and u2 is not — the shape production actually produces, since a link is
  // what stamps userId onto an hours row in the first place. It is also what separates the
  // two flavours of "estimated" that hoursReason exists to tell apart.
  await FbTimePersonLink.create({
    organizationId: org._id, userId: u1._id, fbtimePersonId: P1,
    fbtimeEmail: 'm@rep.co', fbtimeName: 'Maria M', source: 'auto-email',
  });
  // One shift, clocked in at 09:00 local — its day is derived at read time in
  // whatever zone the report anchors to (09:00 EDT is 08:00 CDT, the same
  // local day in both, which is what lets the Central-campaign test below
  // read this same cache).
  await FbTimeShift.create({
    organizationId: org._id, shiftId: 'shA', fbtimePersonId: P1, userId: u1._id,
    clockIn: at(DAY_A, 9), grossHours: 6, adjustedHours: 5.5, workedHours: 5.25,
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

  // WHY, not just whether: an admin looking at Sam's row has to be able to tell
  // "nobody mapped him" from "he took the day off", and the wire is where that
  // distinction has to survive.
  assert.strictEqual(r1.hoursReason, null, 'a measured row has nothing to explain');
  assert.strictEqual(r2.hoursReason, 'not-linked', 'Sam has no FbTimePersonLink');
});

test('/canvasser-timeline carries the same reason as /canvassers for the same person', { skip }, async () => {
  const { body } = await get(`/admin/reports/canvasser-timeline?from=${DAY_A}&to=${DAY_B}`);
  const r1 = body.canvassers.find((c) => c.userId === String(ctx.u1._id));
  const r2 = body.canvassers.find((c) => c.userId === String(ctx.u2._id));
  assert.strictEqual(r1.hoursReason, null);
  assert.strictEqual(r2.hoursReason, 'not-linked');
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

// ── the export's scope must equal the table's scope ─────────────────────────
// /canvassers honored ?coordinatorId and canvassers.csv silently did not, so a
// crew-filtered Timeline exported the whole campaign. The file and the table it
// sits under have to agree, and the file has to SAY which crew it holds.

test('canvassers.csv honors ?coordinatorId and stamps the crew it exported', { skip }, async () => {
  // A DEDICATED coordinator who knocked nothing. Using u1 here would prove nothing: teamMatch
  // deliberately counts a lead's OWN doors in their own crew (`{userId: id, coordinatorId: null}`),
  // so u1 would come back legitimately and the filter would look broken when it wasn't.
  const boss = await User.create({
    firstName: 'Dana', lastName: 'D', email: 'dana@rep.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({
    userId: boss._id, organizationId: ctx.org._id, role: 'lead', isActive: true,
  });
  await CanvassActivity.updateMany(
    { organizationId: ctx.org._id, userId: ctx.u2._id },
    { $set: { coordinatorId: boss._id } }
  );

  const all = await get(`/admin/reports/canvassers.csv?from=${DAY_A}&to=${DAY_B}`, true);
  assert.ok(all.body.includes('s@rep.co'), 'unfiltered export holds Sam');
  assert.ok(all.body.includes('m@rep.co'), 'unfiltered export holds Maria');
  assert.ok(!all.body.split('\n')[0].includes('Crew:'), 'no crew filter → no crew stamp');

  const crew = await get(
    `/admin/reports/canvassers.csv?from=${DAY_A}&to=${DAY_B}&coordinatorId=${boss._id}`,
    true
  );
  assert.strictEqual(crew.status, 200);
  assert.ok(crew.body.includes('s@rep.co'), "the crew's own canvasser is in");
  assert.ok(
    !crew.body.includes('m@rep.co'),
    'Maria knocked with no coordinator — a crew-scoped export must NOT return her'
  );
  assert.match(crew.body.split('\n')[0], /Crew: Dana D/, 'the frozen file names its scope');

  await CanvassActivity.updateMany(
    { organizationId: ctx.org._id, userId: ctx.u2._id },
    { $unset: { coordinatorId: '' } }
  );
});

// ── staleness only reaches backward, over the real app ──────────────────────
// The unit tests pin the rule; this pins the WIRING — that loadMeasuredHours
// derives staleness per request against today-in-anchor-tz. Appended last, and
// it cleans up after itself: the fixtures are shared, and every test above
// pins an explicit [DAY_A..DAY_B] window that today can never fall in.

test("an OPEN shift clocked in TODAY still measures — an old clock-out must not estimate today", { skip }, async () => {
  const today = zonedDayStr(new Date(), TZ);
  // u1 on the clock right now: an open shift whose clockIn is the present
  // instant, so its derived day is today in every season.
  await knock(ctx.u1._id, today, 9);
  await knock(ctx.u1._id, today, 11);
  await FbTimeShift.create({
    organizationId: ctx.org._id, shiftId: 'shToday', fbtimePersonId: P1, userId: ctx.u1._id,
    clockIn: new Date(), grossHours: 5, adjustedHours: 4.5, workedHours: 4.25, isOpen: true,
  });

  const { body } = await get(`/admin/reports/canvassers?from=${today}&to=${today}`);
  const r1 = body.find((c) => c.userId === String(ctx.u1._id));
  assert.ok(r1, 'u1 knocked today');
  assert.strictEqual(r1.hoursSource, 'measured', "today's open shift is not a forgotten clock-out");
  assert.strictEqual(r1.hoursOnDoors, 4.5, 'the measured figure, not the 2h knock span');
  assert.strictEqual(r1.hoursReason, null);
  assert.strictEqual(r1.hoursFlags.hasOpenShift, true, 'still labeled as running');
  assert.strictEqual(r1.hoursFlags.hasStaleShift, false);

  await FbTimeShift.deleteMany({ organizationId: ctx.org._id, shiftId: 'shToday' });
  await CanvassActivity.deleteMany({ organizationId: ctx.org._id, timestamp: { $gte: at(today, 0) } });
});

// ── the Nebraska regression, over the real app ──────────────────────────────
// A campaign whose timeZone differs from the org's used to read ZERO measured
// rows — the cache was stamped with the org's zone and the campaign-anchored
// request filtered on its own, so every canvasser fell back to the span with a
// misleading 'no-hours'. The shift cache buckets at read time in the request's
// anchor zone, so the SAME cache must now measure under a Central campaign.

test('a campaign in a DIFFERENT timezone than the org still reads measured hours', { skip }, async () => {
  const central = await Campaign.create({
    organizationId: ctx.org._id, name: 'Nebraska', type: 'lit_drop', state: 'NE',
    timeZone: 'America/Chicago',
  });
  // u1 knocks DAY_A on the Central campaign. 10:00/14:00 EDT are 09:00/13:00
  // CDT — the same local day under both anchors, so the [DAY_A..DAY_A] window
  // means the same day the shared 09:00-EDT shift buckets to.
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: central._id, householdId: new mongoose.Types.ObjectId(),
    userId: ctx.u1._id, actionType: 'not_home', location: { lat: 41.2, lng: -96.0 }, timestamp: at(DAY_A, 10),
  });
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: central._id, householdId: new mongoose.Types.ObjectId(),
    userId: ctx.u1._id, actionType: 'lit_dropped', location: { lat: 41.2, lng: -96.0 }, timestamp: at(DAY_A, 14),
  });

  const { body } = await get(`/admin/reports/canvassers?campaignId=${central._id}&from=${DAY_A}&to=${DAY_A}`);
  const r1 = body.find((c) => c.userId === String(ctx.u1._id));
  assert.ok(r1, 'u1 knocked the Central campaign');
  assert.strictEqual(r1.hoursSource, 'measured', 'the org-level shift cache serves a Central-anchored report');
  assert.strictEqual(r1.hoursOnDoors, 5.5, "the same shift, bucketed in the campaign's own zone");
  assert.strictEqual(r1.hoursReason, null, "and no false 'no-hours' accusation");

  await CanvassActivity.deleteMany({ campaignId: central._id });
  await Campaign.deleteOne({ _id: central._id });
});
