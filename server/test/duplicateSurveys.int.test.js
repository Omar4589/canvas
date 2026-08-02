import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The Duplicate surveys report, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/dup_surveys_test node --test test/duplicateSurveys.int.test.js
//
// GET /admin/reports/duplicate-surveys grew three things the auditing workflow needs, all of
// which must happen BEFORE paging or the page and the count disagree:
//   1) ?userId= — groups CONTAINING that canvasser, matched AFTER the $group (pre-filtering would
//      change what counts as a duplicate), so the returned group still lists everyone's responses.
//   2) ?kind=sameCanvasserSameDay|differentCanvassers — the two flags, now computed IN the
//      pipeline so they can be filtered on.
//   3) skip/limit paging with a TRUE total (it used to be the post-$limit-200 page length).
//
// The fixture leans on the anchor timezone: V3's two responses share a UTC day but straddle
// midnight in America/Chicago, so a `timezone`-less $dateToString would wrongly flag it as the
// same-canvasser-same-day mistake. That is the regression this file exists to catch.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-dup-surveys';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Campaign, Effort, Pass,
    Household, Voter, SurveyResponse, SurveyTemplate, Subscription,
  ]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({
    name: 'Dup Org', slug: 'dup-org', isActive: true, timeZone: 'America/Chicago',
  });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'da@t.co', passwordHash: 'x', isActive: true });
  const alice = await User.create({ firstName: 'Alice', lastName: 'Canvasser', email: 'dalice@t.co', passwordHash: 'x', isActive: true });
  const bob = await User.create({ firstName: 'Bob', lastName: 'Canvasser', email: 'dbob@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: alice._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: bob._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp = await Campaign.create({
    organizationId: org._id, name: 'Dup C', type: 'survey', state: 'TX', isActive: true,
    timeZone: 'America/Chicago',
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const [p1, p2, p3] = await Promise.all([1, 2, 3].map((n) =>
    Pass.create({
      organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: n,
      name: `Round ${n}`, status: 'active', activatedAt: new Date('2026-06-09T12:00:00Z'),
    })
  ));
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'S', createdBy: admin._id, version: 1 });

  const house = await Household.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id,
    addressLine1: '1 Dup Ln', city: 'Town', state: 'TX', zipCode: '75701',
    normalizedAddress: '1 DUP LN|TOWN|TX|75701',
    location: { type: 'Point', coordinates: [-95.3, 32.35] }, isActive: true, status: 'surveyed',
  });

  // Voters are created in order, so their ObjectIds ascend — that is the sort's stable tiebreak.
  const [v1, v2, v3, v4, v5] = await Promise.all(
    ['V1 Mistake', 'V2 Revisit', 'V3 Straddle', 'V4 Legacy', 'V5 Control'].map((name, i) =>
      Voter.create({
        organizationId: org._id, campaignId: camp._id, householdId: house._id,
        stateVoterId: `SV-DUP-${i + 1}`,
        firstName: name.split(' ')[0], lastName: name.split(' ')[1], fullName: name,
      })
    )
  );

  // The unique {voterId, passId} index means two responses on one voter need DIFFERENT passes
  // (at most one legacy passId:null row each).
  const resp = (voter, user, passId, submittedAt) => ({
    organizationId: org._id, campaignId: camp._id, voterId: voter._id, householdId: house._id,
    userId: user._id, surveyTemplateId: template._id, surveyTemplateVersion: 1, answers: [],
    location: { lat: 32.35, lng: -95.3, accuracy: 10 }, distanceFromHouseMeters: 8,
    passId, submittedAt: new Date(submittedAt),
  });
  await SurveyResponse.insertMany([
    // V1 — the mistake: Alice twice on the same Chicago day.
    resp(v1, alice, p1._id, '2026-06-10T15:00:00Z'),
    resp(v1, alice, p2._id, '2026-06-10T16:00:00Z'),
    // V2 — a legit revisit, 3 responses, Bob's two on different days.
    resp(v2, alice, p1._id, '2026-06-10T15:00:00Z'),
    resp(v2, bob, p2._id, '2026-06-11T15:00:00Z'),
    resp(v2, bob, p3._id, '2026-06-12T15:00:00Z'),
    // V3 — midnight straddle: one UTC day, TWO Chicago days (23:50 Jun 10 / 00:10 Jun 11).
    resp(v3, alice, p1._id, '2026-06-11T04:50:00Z'),
    resp(v3, alice, p2._id, '2026-06-11T05:10:00Z'),
    // V4 — legacy null pass + a second canvasser.
    resp(v4, alice, null, '2026-06-10T15:00:00Z'),
    resp(v4, bob, p1._id, '2026-06-13T15:00:00Z'),
    // V5 — control: a single response never appears in the report.
    resp(v5, alice, p1._id, '2026-06-10T15:00:00Z'),
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, admin, alice, bob, v1, v2, v3, v4, v5, adminTok: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const report = (qs = '') =>
  call(`/api/admin/reports/duplicate-surveys?campaignId=${ctx.camp._id}${qs}`);

const ids = (json) => json.duplicates.map((d) => d.voterId);

test('baseline: flagged first, then by count, voterId as the tiebreak', { skip }, async () => {
  const { v1, v2, v3, v4, v5 } = ctx;
  const { status, json } = await report();
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(ids(json), [v1, v2, v3, v4].map((v) => String(v._id)));
  assert.ok(!ids(json).includes(String(v5._id)), 'a single-response voter is never a duplicate');
  assert.strictEqual(json.total, 4);
  assert.strictEqual(json.limit, 25);
  assert.strictEqual(json.skip, 0);
  assert.strictEqual(json.timeZone, 'America/Chicago');

  const byId = new Map(json.duplicates.map((d) => [d.voterId, d]));
  assert.deepStrictEqual(
    [byId.get(String(v1._id)).sameCanvasserSameDay, byId.get(String(v1._id)).differentCanvassers],
    [true, false],
    'V1: same canvasser twice in one day, one canvasser'
  );
  assert.deepStrictEqual(
    [byId.get(String(v2._id)).sameCanvasserSameDay, byId.get(String(v2._id)).differentCanvassers],
    [false, true]
  );
  assert.strictEqual(byId.get(String(v2._id)).count, 3);
  // Responses come back oldest → newest regardless of $push order.
  const times = byId.get(String(v2._id)).responses.map((r) => new Date(r.submittedAt).getTime());
  assert.deepStrictEqual(times, [...times].sort((a, b) => a - b));
});

test('the midnight straddle is TWO campaign days, not a same-day mistake', { skip }, async () => {
  const { v3 } = ctx;
  const { json } = await report();
  const d = json.duplicates.find((x) => x.voterId === String(v3._id));
  assert.strictEqual(d.sameCanvasserSameDay, false, '23:50 and 00:10 Chicago are different days');
  assert.deepStrictEqual(d.responses.map((r) => r.day), ['2026-06-10', '2026-06-11']);
});

test('legacy null-pass rows label as "Legacy / no pass" and still group', { skip }, async () => {
  const { v4 } = ctx;
  const { json } = await report();
  const d = json.duplicates.find((x) => x.voterId === String(v4._id));
  assert.strictEqual(d.differentCanvassers, true);
  const legacy = d.responses.find((r) => r.passId === null);
  assert.strictEqual(legacy.roundLabel, 'Legacy / no pass');
  assert.strictEqual(d.responses.find((r) => r.passId).roundLabel, 'Pass 1 · Round 1');
});

test('?userId= filters groups CONTAINING that canvasser, without hiding co-responses', { skip }, async () => {
  const { bob, alice, v2, v4 } = ctx;
  const { status, json } = await report(`&userId=${bob._id}`);
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(ids(json), [String(v2._id), String(v4._id)]);
  assert.strictEqual(json.total, 2);

  // The group is matched after $group, so Alice's response on V2 is still in the returned group —
  // filtering the report must never change what a duplicate IS.
  const d2 = json.duplicates.find((x) => x.voterId === String(v2._id));
  assert.strictEqual(d2.count, 3);
  assert.ok(
    d2.responses.some((r) => r.canvasser.userId === String(alice._id)),
    "Alice's response stays in Bob's filtered group"
  );
});

test('?userId= must be an ObjectId', { skip }, async () => {
  const { status, json } = await report('&userId=nope');
  assert.strictEqual(status, 400);
  assert.strictEqual(json.error, 'Invalid userId');
});

test('?kind= isolates each flag', { skip }, async () => {
  const { v1, v2, v3, v4 } = ctx;

  const same = await report('&kind=sameCanvasserSameDay');
  assert.deepStrictEqual(ids(same.json), [String(v1._id)]);
  assert.strictEqual(same.json.total, 1);
  assert.ok(!ids(same.json).includes(String(v3._id)), 'the tz straddle is not a same-day mistake');

  const diff = await report('&kind=differentCanvassers');
  assert.deepStrictEqual(ids(diff.json), [String(v2._id), String(v4._id)]);
  assert.strictEqual(diff.json.total, 2);

  const all = await report('&kind=all');
  assert.strictEqual(all.json.total, 4, 'kind=all is the same as omitting it');
});

test('?kind= rejects anything else', { skip }, async () => {
  const { status, json } = await report('&kind=banana');
  assert.strictEqual(status, 400);
  assert.strictEqual(json.error, 'Invalid kind');
});

test('paging: total is the full matching count, not the page length', { skip }, async () => {
  const { v1, v2 } = ctx;

  const page1 = await report('&limit=1&skip=0');
  assert.deepStrictEqual(ids(page1.json), [String(v1._id)]);
  assert.strictEqual(page1.json.total, 4);

  const page2 = await report('&limit=1&skip=1');
  assert.deepStrictEqual(ids(page2.json), [String(v2._id)]);
  assert.strictEqual(page2.json.total, 4);

  // Past the end: an empty page still reports the true total (the pager needs it to walk back).
  const past = await report('&limit=1&skip=99');
  assert.deepStrictEqual(past.json.duplicates, []);
  assert.strictEqual(past.json.total, 4);

  const clamped = await report('&limit=500');
  assert.strictEqual(clamped.json.limit, 100, 'limit clamps to 100');
  const floored = await report('&limit=-5');
  assert.strictEqual(floored.json.limit, 1, 'limit floors at 1');
  // The house idiom (`parseInt(...) || 25`) treats a falsy 0 as "unset" — same as voters.js.
  const zero = await report('&limit=0');
  assert.strictEqual(zero.json.limit, 25, 'limit=0 falls back to the default');
});

test('a window with no responses returns the empty envelope, not a crash', { skip }, async () => {
  const { status, json } = await report('&from=2026-01-01&to=2026-01-31');
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(json.duplicates, []);
  assert.strictEqual(json.total, 0);
  assert.strictEqual(json.limit, 25);
});

test('filters and paging compose', { skip }, async () => {
  const { bob, v4 } = ctx;
  const { json } = await report(`&userId=${bob._id}&kind=differentCanvassers&limit=1&skip=1`);
  assert.deepStrictEqual(ids(json), [String(v4._id)]);
  assert.strictEqual(json.total, 2);
});
