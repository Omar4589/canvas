import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// A customer's admin or lead must not be able to put a Doorline staff account on a book or a
// walk-list crew (PRIVACY_VERIFICATION item 36). partitionAssignable used to let any super-admin
// id through in every org, so the 201, where anyone else's id earns a 409, confirmed the id was
// staff, the book and crew lists then served the staffer's name and email, and the staffer landed
// on the customer's campaign team without the customer adding them. Over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/staffroster_test node --test test/staffRosterScope.int.test.js
//
//   · In a customer org a staff id is refused on all three assign paths exactly like an id that
//     doesn't exist, and nothing is written.
//   · The customer can still let staff in: a staffer they made a member, on the team, is assignable.
//   · In an internal org staff still put themselves on a book with no membership.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-staff-roster';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { EffortMember } = await import('../src/models/EffortMember.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// One campaign with an active round and a published one-door book, in `org`.
const seedCampaign = async (org, name) => {
  const campaign = await Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'FL', isActive: true });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Pass 1', status: 'active',
  });
  const door = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `1 ${name} St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `1 ${name.toUpperCase()} ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
    isActive: true,
  });
  const turf = await Turf.create({
    organizationId: org._id, campaignId: campaign._id, passId: pass._id,
    name: 'Book 1', mode: 'geometric', status: 'published', householdIds: [door._id], doorCount: 1,
  });
  return { campaign, effort, pass, turf };
};

const person = (firstName, email, extra = {}) =>
  User.create({ firstName, lastName: 'X', email, passwordHash: 'x', isActive: true, ...extra });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, Subscription, User, Membership, Campaign, CampaignAssignment, CampaignManager,
    Effort, EffortMember, Pass, Turf, TurfAssignment, Household,
  ]) {
    await M.deleteMany({});
  }

  const cust = await Organization.create({ name: 'Acme Campaigns', slug: 'acme-roster', isActive: true });
  await Subscription.create({ organizationId: cust._id, status: 'active' });
  const internal = await Organization.create({ name: 'Doorline Demo', slug: 'demo-roster', isActive: true, isInternal: true });
  await Subscription.create({ organizationId: internal._id, status: 'internal', statusChangedAt: new Date() });

  const acme = await seedCampaign(cust, 'Acme');
  const demo = await seedCampaign(internal, 'Demo');

  const admin = await person('Ada', 'ada@acme.test');
  const lead = await person('Lee', 'lee@acme.test');
  await Membership.create({ userId: admin._id, organizationId: cust._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: cust._id, role: 'lead', isActive: true });
  await CampaignManager.create({ campaignId: acme.campaign._id, userId: lead._id, organizationId: cust._id, grantedBy: admin._id });

  // Doorline staff, a member of nothing.
  const staff = await person('Sam', 'sam@doorline.app', { isSuperAdmin: true, platformRole: 'support' });
  // Staff the customer chose to add: a canvasser membership and a place on the team.
  const staffMember = await person('Tia', 'tia@doorline.app', { isSuperAdmin: true, platformRole: 'support' });
  await Membership.create({ userId: staffMember._id, organizationId: cust._id, role: 'canvasser', isActive: true });
  await CampaignAssignment.create({ organizationId: cust._id, campaignId: acme.campaign._id, userId: staffMember._id });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    cust, internal, acme, demo, staff, staffMember,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead), staffTok: signUserToken(staff),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (token, org, method, path, body) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Org-Id': String(org._id) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
};

// The three assign paths, each aimed at one candidate id in the customer's campaign.
const assignPaths = () => {
  const { acme } = ctx;
  const c = acme.campaign._id;
  return [
    ['one book', (tok, id) => call(tok, ctx.cust, 'POST', `/admin/campaigns/${c}/turfs/${acme.turf._id}/assignments`, { userIds: [id] })],
    ['assign-bulk', (tok, id) => call(tok, ctx.cust, 'POST', `/admin/campaigns/${c}/turfs/assign-bulk`, { turfIds: [String(acme.turf._id)], userIds: [id] })],
    ['walk-list crew', (tok, id) => call(tok, ctx.cust, 'POST', `/admin/campaigns/${c}/efforts/${acme.effort._id}/members`, { userId: id })],
  ];
};

// A refusal echoes the posted id back in notOnTeam; everything else must match byte for byte.
const masked = (json, id) => JSON.parse(JSON.stringify(json).split(id).join('<id>'));

test("a customer's admin can't put a staff account on a book or a crew: the same 409 as an unknown id", { skip }, async () => {
  const staffId = String(ctx.staff._id);
  const unknownId = String(new mongoose.Types.ObjectId());
  for (const [label, send] of assignPaths()) {
    const forStaff = await send(ctx.adminTok, staffId);
    const forNobody = await send(ctx.adminTok, unknownId);
    assert.equal(forStaff.status, 409, `${label}: a staff id is refused`);
    assert.equal(forStaff.json.code, 'not-on-team', `${label}: as not on the team`);
    assert.equal(forNobody.status, 409, `${label}: (control) an unknown id is refused too`);
    assert.deepEqual(masked(forStaff.json, staffId), masked(forNobody.json, unknownId), `${label}: and the two read identically`);
  }
  const filter = { userId: ctx.staff._id };
  assert.equal(await TurfAssignment.countDocuments(filter), 0, 'no book went to the staffer');
  assert.equal(await EffortMember.countDocuments(filter), 0, 'no crew place went to the staffer');
  assert.equal(await CampaignAssignment.countDocuments(filter), 0, "and they never landed on the customer's team");
});

test('a team lead is refused the same way', { skip }, async () => {
  const staffId = String(ctx.staff._id);
  for (const [label, send] of assignPaths()) {
    const res = await send(ctx.leadTok, staffId);
    assert.equal(res.status, 409, `${label}: a lead can't assign a staff id either`);
  }
  assert.equal(await CampaignAssignment.countDocuments({ userId: ctx.staff._id }), 0);
});

test('the customer can still let staff in: a staffer they made a member, on the team, is assignable', { skip }, async () => {
  const [[, oneBook]] = assignPaths();
  const res = await oneBook(ctx.adminTok, String(ctx.staffMember._id));
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.ok(await TurfAssignment.exists({ turfId: ctx.acme.turf._id, userId: ctx.staffMember._id }));
});

test('in an internal org, staff still put themselves on a book with no membership', { skip }, async () => {
  const { demo, staff } = ctx;
  const res = await call(ctx.staffTok, ctx.internal, 'POST', `/admin/campaigns/${demo.campaign._id}/turfs/${demo.turf._id}/assignments`, {
    userIds: [String(staff._id)],
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.ok(await TurfAssignment.exists({ turfId: demo.turf._id, userId: staff._id }), 'the book is theirs');
  assert.ok(
    await CampaignAssignment.exists({ campaignId: demo.campaign._id, userId: staff._id }),
    'and the book put them on the demo campaign team'
  );
});
