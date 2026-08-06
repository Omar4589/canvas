import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// POST /admin/campaigns/:campaignId/turfs/unassign-bulk over the REAL Express app +
// throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/unassignbulk_test node --test test/unassignBulk.int.test.js
//
// The route shipped for the web console's per-person "unassign everywhere" and went
// untested; both clients now also call it to clear a whole multi-book selection, so the
// contract they rely on is pinned here:
//   · BLAST RADIUS — it deletes TurfAssignment rows and NOTHING else. The campaign roster
//     row (which gates all door access) and every knock survive. This is the assertion the
//     in-app confirm copy's "their work is kept" promise rests on, and it is what would
//     catch someone later folding releaseAssignedWork into the handler.
//   · userIds is REQUIRED — empty is a 400, NOT a "clear everyone" wildcard. A future
//     reader who "helpfully" made omission mean everyone would, from a select-all, wipe a
//     whole round's assignments.
//   · turfIds are re-scoped by campaign, so a foreign id can never reach another campaign.
// The archived-campaign 409 for this route lives in archivedCampaign.int.test.js.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-unassign-bulk';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const pair = (turfId, userId, c) => ({
  organizationId: c.orgId,
  campaignId: c.campaignId,
  passId: c.passId,
  turfId,
  userId,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, CanvassActivity, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Unassign Org', slug: 'unassign-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ua@t.co', passwordHash: 'x', isActive: true });
  const alice = await User.create({ firstName: 'Alice', lastName: 'Walker', email: 'ual@t.co', passwordHash: 'x', isActive: true });
  const bob = await User.create({ firstName: 'Bob', lastName: 'Walker', email: 'ubo@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [alice, bob]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  }

  // Two campaigns in ONE org — the second exists purely to prove cross-campaign scoping.
  const camp = await Campaign.create({ organizationId: org._id, name: 'Main', type: 'survey', state: 'FL', isActive: true });
  const other = await Campaign.create({ organizationId: org._id, name: 'Other', type: 'survey', state: 'FL', isActive: true });
  for (const u of [alice, bob]) {
    await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: u._id });
  }

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Pass 1', status: 'active',
  });
  const otherEffort = await Effort.create({ organizationId: org._id, campaignId: other._id, name: 'Elsewhere' });
  const otherPass = await Pass.create({
    organizationId: org._id, campaignId: other._id, effortId: otherEffort._id, roundNumber: 1, name: 'Pass 1', status: 'active',
  });

  const door = await Household.create({
    organizationId: org._id,
    campaignId: camp._id,
    effortId: effort._id,
    addressLine1: '1 Book St',
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: '1 BOOK ST|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
    isActive: true,
  });

  const mkTurf = (name, campaignId, passId) =>
    Turf.create({
      organizationId: org._id, campaignId, passId, name, mode: 'geometric',
      status: 'published', householdIds: [door._id], doorCount: 1,
    });
  const t1 = await mkTurf('Book 1', camp._id, pass._id);
  const t2 = await mkTurf('Book 2', camp._id, pass._id);
  const t3 = await mkTurf('Book 3', camp._id, pass._id);
  const tOther = await mkTurf('Foreign Book', other._id, otherPass._id);

  const c = { orgId: org._id, campaignId: camp._id, passId: pass._id };
  await TurfAssignment.insertMany([
    pair(t1._id, alice._id, c),
    pair(t1._id, bob._id, c),
    pair(t2._id, alice._id, c),
    pair(t3._id, bob._id, c),
    { ...pair(tOther._id, alice._id, c), campaignId: other._id, passId: otherPass._id },
  ]);

  // A recorded knock by Alice in the book she is about to be removed from.
  await CanvassActivity.create({
    organizationId: org._id,
    campaignId: camp._id,
    householdId: door._id,
    userId: alice._id,
    actionType: 'not_home',
    location: { lat: 28.3001, lng: -81.4, accuracy: 10 },
    distanceFromHouseMeters: 12,
    timestamp: new Date(),
    passId: pass._id,
    turfId: t1._id,
    effortId: effort._id,
  });

  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, other, pass, t1, t2, t3, tOther, admin, alice, bob, door,
    adminTok: signUserToken(admin), aliceTok: signUserToken(alice),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

const unassign = (body) =>
  call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/unassign-bulk`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body,
  });

test('unassign-bulk: userIds is required — empty is a 400, never a "clear everyone" wildcard', { skip }, async () => {
  const before = await TurfAssignment.countDocuments({});
  for (const body of [
    { turfIds: [String(ctx.t1._id)], userIds: [] },
    { turfIds: [String(ctx.t1._id)] },
    { turfIds: [], userIds: [String(ctx.alice._id)] },
    {},
  ]) {
    const r = await unassign(body);
    assert.strictEqual(r.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  assert.strictEqual(await TurfAssignment.countDocuments({}), before, 'a 400 must delete nothing');
});

test('unassign-bulk: a turfId from another campaign is scoped out, not honoured', { skip }, async () => {
  const r = await unassign({ turfIds: [String(ctx.tOther._id)], userIds: [String(ctx.alice._id)] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.deleted, 0);
  assert.strictEqual(
    await TurfAssignment.countDocuments({ turfId: ctx.tOther._id, userId: ctx.alice._id }),
    1,
    "the other campaign's assignment survives"
  );
});

test('unassign-bulk: deletes the turf × user cross product and nothing outside it', { skip }, async () => {
  const r = await unassign({
    turfIds: [String(ctx.t1._id), String(ctx.t2._id)],
    userIds: [String(ctx.alice._id), String(ctx.bob._id)],
  });
  assert.strictEqual(r.status, 200);
  // (t1,alice) (t1,bob) (t2,alice) — (t2,bob) never existed.
  assert.strictEqual(r.json.deleted, 3, '`deleted` counts (book, person) PAIRS');
  assert.strictEqual(await TurfAssignment.countDocuments({ turfId: ctx.t1._id }), 0);
  assert.strictEqual(await TurfAssignment.countDocuments({ turfId: ctx.t2._id }), 0);
  assert.strictEqual(
    await TurfAssignment.countDocuments({ turfId: ctx.t3._id, userId: ctx.bob._id }),
    1,
    'an unselected book keeps its assignment'
  );
});

// The safety claim the whole feature — and the in-app confirm copy — rests on.
test('unassign-bulk: the campaign roster and every recorded knock survive', { skip }, async () => {
  assert.strictEqual(
    await CampaignAssignment.countDocuments({ campaignId: ctx.camp._id }),
    2,
    'roster rows gate ALL door access — unassigning a book must never remove them'
  );
  for (const u of [ctx.alice, ctx.bob]) {
    assert.ok(
      await CampaignAssignment.exists({ campaignId: ctx.camp._id, userId: u._id }),
      'still on the campaign team'
    );
  }
  // CanvassActivity is the billable ledger; SurveyResponse is independent of TurfAssignment
  // in exactly the same way (both stamp userId/turfId/passId at the door, neither joins back).
  const knocks = await CanvassActivity.find({ campaignId: ctx.camp._id }).lean();
  assert.strictEqual(knocks.length, 1, 'no knock was deleted');
  assert.strictEqual(String(knocks[0].userId), String(ctx.alice._id), 'attribution intact');
  assert.strictEqual(String(knocks[0].turfId), String(ctx.t1._id), 'still stamped with its book');
  assert.strictEqual(String(knocks[0].passId), String(ctx.pass._id));
});

test('unassign-bulk: replaying the same call is a 200 no-op', { skip }, async () => {
  const r = await unassign({
    turfIds: [String(ctx.t1._id), String(ctx.t2._id)],
    userIds: [String(ctx.alice._id), String(ctx.bob._id)],
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.deleted, 0);
});

test('unassign-bulk: a canvasser cannot call it', { skip }, async () => {
  const r = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/unassign-bulk`, {
    token: ctx.aliceTok,
    orgId: ctx.org._id,
    body: { turfIds: [String(ctx.t3._id)], userIds: [String(ctx.bob._id)] },
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(
    await TurfAssignment.countDocuments({ turfId: ctx.t3._id }),
    1,
    'the refused call deleted nothing'
  );
});

// The 402 the mobile action bar now renders (it used to fail silently there).
test('unassign-bulk: a suspended subscription 402s the write', { skip }, async () => {
  await Subscription.updateOne({ organizationId: ctx.org._id }, { status: 'suspended' });
  try {
    const r = await unassign({ turfIds: [String(ctx.t3._id)], userIds: [String(ctx.bob._id)] });
    assert.strictEqual(r.status, 402);
    assert.strictEqual(r.json.code, 'subscription-inactive');
    assert.strictEqual(await TurfAssignment.countDocuments({ turfId: ctx.t3._id }), 1);
  } finally {
    await Subscription.updateOne({ organizationId: ctx.org._id }, { status: 'internal' });
  }
});
