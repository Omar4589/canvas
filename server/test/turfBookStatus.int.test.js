import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Per-round door status on the turf-cutting surface, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/turf_book_status_test node --test test/turfBookStatus.int.test.js
//
// The contract this file exists to pin:
//   1. Status on the cut map is PER ROUND. A door surveyed in round 1 must read `unknocked` in
//      round 2 — that is the whole reason the page can't just use Household.status.
//   2. GET /progress is the SINGLE COUNT ORACLE for the page. Its per-book statusCounts must sum
//      to that book's eligible total, and Σ over books must equal the round total — otherwise the
//      coverage bar and the Completed/In-progress/Not-started chips could show different numbers.
//   3. `passStatus` (dot color) and `knocked` (the counts) derive from the same getPassStatusMap
//      over the same pass, so a dot's color can't contradict what it contributes to the totals.
//   4. Both additions are OPT-IN / ADDITIVE: /doors without ?withStatus=1 is unchanged, and
//      /progress still carries turfId/total/knocked for the mobile books screen.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-turf-book-status';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

function hh(orgId, campaignId, effortId, n) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Book St`,
    city: 'Town',
    state: 'TX',
    zipCode: '75701',
    normalizedAddress: `${n} BOOK ST|TOWN|TX|75701`,
    location: { type: 'Point', coordinates: [-95.3 + n * 0.001, 32.35] },
    isActive: true,
    status: 'unknocked',
  };
}

function act(hhDoc, userId, actionType, passId, ts) {
  const [lng, lat] = hhDoc.location.coordinates;
  return {
    organizationId: hhDoc.organizationId,
    campaignId: hhDoc.campaignId,
    householdId: hhDoc._id,
    effortId: hhDoc.effortId,
    userId,
    actionType,
    location: { lat, lng, accuracy: 10 },
    distanceFromHouseMeters: 8,
    timestamp: ts,
    passId,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, Effort, Pass, Turf, Household, CanvassActivity, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Books Org', slug: 'books-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'tba@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'tbc@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'tbl@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp = await Campaign.create({
    organizationId: org._id, name: 'Books C', type: 'survey', state: 'TX', isActive: true, timeZone: 'America/Chicago',
  });
  await CampaignManager.create({ campaignId: camp._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass1 = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'archived',
  });
  const pass2 = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 2, name: 'Round 2', status: 'active',
  });

  // 6 doors: book A owns d1..d4, book B owns d5..d6.
  const homes = await Household.insertMany([1, 2, 3, 4, 5, 6].map((n) => hh(org._id, camp._id, effort._id, n)));
  const [d1, d2, d3, d4, d5, d6] = homes;

  // Round 1: d1 surveyed, d2 not-home. Round 2 re-cuts the SAME doors and must start clean.
  // Round 2 so far: d1 not_home (the same door that was surveyed in R1 — the per-round proof),
  //   d2 survey_submitted, d3 refused. d4/d5/d6 untouched this round.
  await CanvassActivity.insertMany([
    act(d1, canv._id, 'survey_submitted', pass1._id, new Date('2026-06-10T15:00:00Z')),
    act(d2, canv._id, 'not_home', pass1._id, new Date('2026-06-10T15:10:00Z')),
    act(d1, canv._id, 'not_home', pass2._id, new Date('2026-06-12T15:00:00Z')),
    act(d2, canv._id, 'survey_submitted', pass2._id, new Date('2026-06-12T15:10:00Z')),
    act(d3, canv._id, 'refused', pass2._id, new Date('2026-06-12T15:20:00Z')),
  ]);

  const mk = (passId, name, ids) =>
    Turf.create({
      organizationId: org._id, campaignId: camp._id, passId, name, mode: 'geometric',
      householdIds: ids.map((h) => h._id), doorCount: ids.length, status: 'published',
    });
  const bookA = await mk(pass2._id, 'Book A', [d1, d2, d3, d4]);
  const bookB = await mk(pass2._id, 'Book B', [d5, d6]);
  await mk(pass1._id, 'R1 Book', [d1, d2, d3, d4, d5, d6]);
  // Doors currently live in the round-2 books (Household.turfId mirrors the newest cut).
  await Household.updateMany({ _id: { $in: [d1._id, d2._id, d3._id, d4._id] } }, { $set: { turfId: bookA._id } });
  await Household.updateMany({ _id: { $in: [d5._id, d6._id] } }, { $set: { turfId: bookB._id } });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, effort, pass1, pass2, bookA, bookB, admin, lead,
    d1, d2, d3, d4, d5, d6,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  const res = await fetch(`${base}${path}`, { method, headers });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const turfBase = () => `/api/admin/campaigns/${ctx.camp._id}/turfs`;
const byId = (doors, d) => doors.find((x) => x.id === String(d._id));
const rowFor = (progress, book) => progress.find((p) => p.turfId === String(book._id));

test('doors?withStatus=1 reports status FOR THE SELECTED ROUND, not across all rounds', { skip }, async () => {
  const { adminTok, org, pass1, pass2, d1, d2, d3, d4 } = ctx;

  const r2 = await call('GET', `${turfBase()}/doors?passId=${pass2._id}&withStatus=1`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r2.status, 200);
  const doors2 = r2.json.doors;
  // The whole point: d1 was SURVEYED in round 1 and only not-home'd in round 2.
  assert.strictEqual(byId(doors2, d1).passStatus, 'not_home');
  assert.strictEqual(byId(doors2, d2).passStatus, 'surveyed');
  assert.strictEqual(byId(doors2, d3).passStatus, 'refused');
  assert.strictEqual(byId(doors2, d4).passStatus, 'unknocked');

  // Same doors, round 1 — the answers must flip, proving nothing is being read off Household.status.
  const r1 = await call('GET', `${turfBase()}/doors?passId=${pass1._id}&withStatus=1`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r1.status, 200);
  const doors1 = r1.json.doors;
  assert.strictEqual(byId(doors1, d1).passStatus, 'surveyed');
  assert.strictEqual(byId(doors1, d2).passStatus, 'not_home');
  assert.strictEqual(byId(doors1, d3).passStatus, 'unknocked');
});

test('doors WITHOUT withStatus is unchanged — no passStatus key at all', { skip }, async () => {
  const { adminTok, org, pass2 } = ctx;
  const plain = await call('GET', `${turfBase()}/doors?passId=${pass2._id}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(plain.status, 200);
  assert.ok(plain.json.doors.length > 0);
  assert.ok(
    plain.json.doors.every((d) => !('passStatus' in d)),
    'the opt-in must stay opt-in — mobile (slim=1) must not start paying for it'
  );
  // The global Household.status field it has always returned is still there.
  assert.ok(plain.json.doors.every((d) => typeof d.status === 'string'));
});

test('progress statusCounts sum to each book\'s eligible total', { skip }, async () => {
  const { adminTok, org, pass2, bookA, bookB } = ctx;
  const r = await call('GET', `${turfBase()}/progress?passId=${pass2._id}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r.status, 200);

  for (const row of r.json.progress) {
    const sum = Object.values(row.statusCounts).reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, row.total, `book ${row.turfId}: statusCounts sum ${sum} != total ${row.total}`);
    // `knocked` is "everything that isn't unknocked" — the chips and the bar must agree on that too.
    assert.strictEqual(row.total - row.statusCounts.unknocked, row.knocked);
  }

  const a = rowFor(r.json.progress, bookA);
  assert.deepStrictEqual(
    { total: a.total, knocked: a.knocked, surveyed: a.statusCounts.surveyed, not_home: a.statusCounts.not_home, refused: a.statusCounts.refused, unknocked: a.statusCounts.unknocked },
    { total: 4, knocked: 3, surveyed: 1, not_home: 1, refused: 1, unknocked: 1 }
  );
  const b = rowFor(r.json.progress, bookB);
  assert.strictEqual(b.total, 2);
  assert.strictEqual(b.knocked, 0);
  assert.strictEqual(b.statusCounts.unknocked, 2);
});

test('Σ per-book statusCounts equals the round total — the bar cannot disagree with the chips', { skip }, async () => {
  const { adminTok, org, pass2 } = ctx;
  const r = await call('GET', `${turfBase()}/progress?passId=${pass2._id}`, { token: adminTok, orgId: org._id });
  const rolled = {};
  let knocked = 0;
  let total = 0;
  for (const row of r.json.progress) {
    knocked += row.knocked;
    total += row.total;
    for (const [k, n] of Object.entries(row.statusCounts)) rolled[k] = (rolled[k] || 0) + n;
  }
  assert.strictEqual(total, 6);
  assert.strictEqual(knocked, 3);
  assert.strictEqual(Object.values(rolled).reduce((a, b) => a + b, 0), total);
  assert.strictEqual(total - rolled.unknocked, knocked);
});

test('dot color and the counts derive from the same map — no door can disagree', { skip }, async () => {
  const { adminTok, org, pass2 } = ctx;
  const [doorsR, progR] = await Promise.all([
    call('GET', `${turfBase()}/doors?passId=${pass2._id}&withStatus=1`, { token: adminTok, orgId: org._id }),
    call('GET', `${turfBase()}/progress?passId=${pass2._id}`, { token: adminTok, orgId: org._id }),
  ]);
  // Recount the books straight from the per-door statuses the MAP will paint, and require an
  // exact match with the oracle the NUMBERS come from.
  const fromDoors = new Map();
  for (const d of doorsR.json.doors) {
    if (!d.turfId) continue;
    const c = fromDoors.get(d.turfId) || {};
    c[d.passStatus] = (c[d.passStatus] || 0) + 1;
    fromDoors.set(d.turfId, c);
  }
  for (const row of progR.json.progress) {
    const painted = fromDoors.get(row.turfId) || {};
    for (const [status, n] of Object.entries(painted)) {
      assert.strictEqual(row.statusCounts[status], n, `book ${row.turfId} status ${status}: map paints ${n}, counts say ${row.statusCounts[status]}`);
    }
  }
});

test('progress keeps the fields the mobile books screen already reads', { skip }, async () => {
  const { adminTok, org, pass2 } = ctx;
  const r = await call('GET', `${turfBase()}/progress?passId=${pass2._id}`, { token: adminTok, orgId: org._id });
  for (const row of r.json.progress) {
    assert.strictEqual(typeof row.turfId, 'string');
    assert.strictEqual(typeof row.total, 'number');
    assert.strictEqual(typeof row.knocked, 'number');
  }
});

test('a campaign-managing lead can read both — the cut page is lead-accessible', { skip }, async () => {
  const { leadTok, org, pass2 } = ctx;
  const doors = await call('GET', `${turfBase()}/doors?passId=${pass2._id}&withStatus=1`, { token: leadTok, orgId: org._id });
  const prog = await call('GET', `${turfBase()}/progress?passId=${pass2._id}`, { token: leadTok, orgId: org._id });
  assert.strictEqual(doors.status, 200);
  assert.strictEqual(prog.status, 200);
});

// The door-drill's response shape is unchanged by the audit hook — that the hook actually
// RECORDS the subject is asserted where the support-grant fixture lives, in
// accessLogCoverage.int.test.js ("RECORD-LEVEL: the turf-cutting door drill…").
test('the cut page door drill still returns the household unchanged', { skip }, async () => {
  const { adminTok, org, d1 } = ctx;
  const r = await call('GET', `${turfBase()}/household/${d1._id}`, { token: adminTok, orgId: org._id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.household.id, String(d1._id));
  assert.ok(Array.isArray(r.json.voters));
});
