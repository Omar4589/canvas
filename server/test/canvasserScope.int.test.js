import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The admin Map's canvasser dropdown must list only the canvassers OF THE SELECTED CAMPAIGN,
// not every org member. "Of the campaign" = anyone who knocked or surveyed IN it (incl.
// since-deactivated users, whose pins are still on the map) UNIONED with anyone currently
// rostered to it (assigned but zero knocks). Exercised over the REAL Express app + a
// throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/canvasser_scope node --test test/canvasserScope.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-canvasser-scope';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {}; // seeded ids + admin token

const uid = () => new mongoose.Types.ObjectId();

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CanvassActivity, SurveyResponse, CampaignAssignment]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Scope Org', slug: 'scope-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'admin@s.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  const A = await Campaign.create({ organizationId: org._id, name: 'Campaign A', type: 'survey', state: 'KY', isActive: true });
  const B = await Campaign.create({ organizationId: org._id, name: 'Campaign B', type: 'survey', state: 'KY', isActive: true });

  // Cast of canvassers.
  const knocker = await User.create({ firstName: 'Kay', lastName: 'Knocker', email: 'kay@s.co', passwordHash: 'x', isActive: true });
  const deadKnocker = await User.create({ firstName: 'Dee', lastName: 'Deactivated', email: 'dee@s.co', passwordHash: 'x', isActive: false });
  const surveyor = await User.create({ firstName: 'Sam', lastName: 'Surveyor', email: 'sam@s.co', passwordHash: 'x', isActive: true });
  const rostered = await User.create({ firstName: 'Ron', lastName: 'Rostered', email: 'ron@s.co', passwordHash: 'x', isActive: true });
  const otherCamp = await User.create({ firstName: 'Oscar', lastName: 'Other', email: 'oscar@s.co', passwordHash: 'x', isActive: true });
  const idle = await User.create({ firstName: 'Ivy', lastName: 'Idle', email: 'ivy@s.co', passwordHash: 'x', isActive: true });

  // Memberships: all active canvassers except deadKnocker (deactivated in the org too).
  for (const u of [knocker, surveyor, rostered, otherCamp, idle]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  }
  await Membership.create({ userId: deadKnocker._id, organizationId: org._id, role: 'canvasser', isActive: false });

  // Activity/survey/roster footprints (raw inserts — only the fields the roster query reads).
  await CanvassActivity.collection.insertMany([
    { _id: uid(), organizationId: org._id, campaignId: A._id, userId: knocker._id, actionType: 'not_home', timestamp: new Date() },
    { _id: uid(), organizationId: org._id, campaignId: A._id, userId: deadKnocker._id, actionType: 'not_home', timestamp: new Date() },
    // otherCamp knocked ONLY in B — must not appear for A.
    { _id: uid(), organizationId: org._id, campaignId: B._id, userId: otherCamp._id, actionType: 'not_home', timestamp: new Date() },
  ]);
  await SurveyResponse.collection.insertOne({
    _id: uid(), organizationId: org._id, campaignId: A._id, userId: surveyor._id, submittedAt: new Date(),
  });
  await CampaignAssignment.collection.insertOne({
    _id: uid(), organizationId: org._id, campaignId: A._id, userId: rostered._id, assignedAt: new Date(),
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  Object.assign(ctx, {
    org, A, B, adminTok: signUserToken(admin),
    ids: {
      knocker: String(knocker._id),
      deadKnocker: String(deadKnocker._id),
      surveyor: String(surveyor._id),
      rostered: String(rostered._id),
      otherCamp: String(otherCamp._id),
      idle: String(idle._id),
    },
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function mapCanvasserIds(campaignId) {
  const url = campaignId
    ? `${base}/api/admin/households/map?campaignId=${campaignId}&includeActivities=1`
    : `${base}/api/admin/households/map?all=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
  });
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  const json = await res.json();
  return new Set((json.canvassers || []).map((c) => c.id));
}

test('campaign A dropdown = knockers ∪ surveyors ∪ roster (incl. deactivated); excludes idle + other-campaign', { skip }, async () => {
  const { ids } = ctx;
  const got = await mapCanvasserIds(ctx.A._id);

  // Present: everyone whose data can appear on A's map, plus its roster.
  assert.ok(got.has(ids.knocker), 'active knocker in A should appear');
  assert.ok(got.has(ids.deadKnocker), 'DEACTIVATED knocker in A must still appear (pins on the map)');
  assert.ok(got.has(ids.surveyor), 'surveyor in A should appear');
  assert.ok(got.has(ids.rostered), 'rostered-but-zero-knocks canvasser should be selectable');

  // Absent: no campaign connection.
  assert.ok(!got.has(ids.otherCamp), 'canvasser who only knocked in B must NOT appear for A');
  assert.ok(!got.has(ids.idle), 'idle org member (the old bug) must NOT appear for A');

  assert.strictEqual(got.size, 4, `expected exactly 4 canvassers, got ${got.size}`);
});

test('campaign B dropdown = only its knocker', { skip }, async () => {
  const { ids } = ctx;
  const got = await mapCanvasserIds(ctx.B._id);
  assert.deepStrictEqual([...got], [ids.otherCamp]);
});

test('org-wide map (all=1) falls back to all ACTIVE members (deactivated excluded)', { skip }, async () => {
  const { ids } = ctx;
  const got = await mapCanvasserIds(null); // helper sends all=1 — see below
  // Every active canvasser + admin; the deactivated user is gone on this legacy path.
  assert.ok(got.has(ids.knocker) && got.has(ids.surveyor) && got.has(ids.rostered) && got.has(ids.otherCamp) && got.has(ids.idle));
  assert.ok(!got.has(ids.deadKnocker), 'org-wide path keeps its historical isActive filter');
});

test('a BARE unscoped map call 400s in a multi-campaign org (all=1 is the explicit hatch)', { skip }, async () => {
  // This org runs campaigns A and B — an admin request with neither campaignId nor all=1
  // must refuse rather than silently merge both campaigns' doors onto one map.
  const res = await fetch(`${base}/api/admin/households/map`, {
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
  });
  assert.strictEqual(res.status, 400, `expected 400, got ${res.status}`);
});
