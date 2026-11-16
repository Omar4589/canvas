import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The Control Room's overview numbers count customers only (the owner, Nov 16: the Control Room
// shouldn't count the demo):
//
//   npm run test:int -- test/platformOverview.int.test.js
//
// Doorline's internal/demo orgs stay out of every platform-wide number: Organizations, Users (accounts
// that exist only in internal orgs), Campaigns, Active now and Today. Rebuild demo day stages a "today"
// of knocks running up to the minute it was pressed, so before this, pressing it read as real work.
// "Internal" is the same either-or the lifetime totals read: the isInternal flag, or an 'internal'
// subscription. The per-org rows still describe the demo org, since that list is where staff switch
// into it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-platform-overview';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const oid = () => new mongoose.Types.ObjectId();

// A moment ago that is still today in UTC and inside the 15-minute Active now window, even when the
// suite runs just after midnight UTC.
const recent = (ms) => {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  return new Date(Math.max(Date.now() - ms, midnight.getTime()));
};

const overview = async () => {
  const res = await fetch(`${base}/api/super-admin/platform-overview`, {
    headers: { Authorization: `Bearer ${ctx.staffTok}` },
  });
  return { status: res.status, json: await res.json() };
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Subscription, CanvassActivity]) {
    await M.deleteMany({});
    await M.init(); // the unique indexes exist before the fixtures, so a background build can't race them
  }

  // Customers: one active org, one deactivated.
  const acme = await Organization.create({ name: 'Acme Campaigns', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: acme._id, status: 'active' });
  const gone = await Organization.create({ name: 'Gone Co', slug: 'gone-co', isActive: false });
  await Subscription.create({ organizationId: gone._id, status: 'canceled' });

  // Doorline's own: the demo (born flagged, billed internal) and a legacy sandbox that carries only the
  // billing status. Either one makes an org internal.
  const demo = await Organization.create({ name: 'Doorline Demo', slug: 'doorline-demo', isActive: true, isInternal: true });
  await Subscription.create({ organizationId: demo._id, status: 'internal' });
  const sandbox = await Organization.create({ name: 'Old Sandbox', slug: 'old-sandbox', isActive: true });
  await Subscription.create({ organizationId: sandbox._id, status: 'internal' });

  const user = (email, extra = {}) =>
    User.create({ firstName: 'U', lastName: email, email, passwordHash: 'x', isActive: true, ...extra });
  const member = (u, org, role = 'canvasser') =>
    Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });

  // Staff, a member of nothing: reads the Control Room, and counts as a user.
  const staff = await user('staff@doorline.app', { isSuperAdmin: true, platformRole: 'support' });
  const custAdmin = await user('admin@acme.test');
  await member(custAdmin, acme, 'admin');
  const custCanvasser = await user('canvasser@acme.test');
  await member(custCanvasser, acme);
  // In the demo AND a customer org: a real customer's account, so it counts.
  const both = await user('both@acme.test');
  await member(both, demo);
  await member(both, acme);
  // Accounts that exist only for internal orgs: left out.
  const demoCanvasser = await user('canvasser@demo.test');
  await member(demoCanvasser, demo);
  const sandboxUser = await user('someone@sandbox.test');
  await member(sandboxUser, sandbox);
  // Staff who belong to the demo only still count: staff aren't the demo.
  const staffInDemo = await user('omar@doorline.app', { isSuperAdmin: true, platformRole: 'break_glass' });
  await member(staffInDemo, demo, 'admin');

  const campaign = (org, name, isActive = true) =>
    Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'TX', isActive });
  const ward = await campaign(acme, 'Ward 1');
  await campaign(acme, 'Old Race', false);
  const demoCampaign = await campaign(demo, 'Demo Campaign');
  await campaign(demo, 'Demo Round 1', false);
  const sandboxCampaign = await campaign(sandbox, 'Sandbox');

  const knock = (camp, u, actionType, ms) =>
    CanvassActivity.create({
      organizationId: camp.organizationId, campaignId: camp._id, householdId: oid(), userId: u._id,
      actionType, timestamp: recent(ms), location: { lat: 30.26, lng: -97.74 },
    });
  // The customer's real work: two knocks, one a survey, by one canvasser, a minute or two ago.
  await knock(ward, custCanvasser, 'not_home', 60_000);
  await knock(ward, custCanvasser, 'survey_submitted', 120_000);
  // A demo rebuild's staged "today", and a knock in the sandbox: none of it counts.
  await knock(demoCampaign, demoCanvasser, 'not_home', 30_000);
  await knock(demoCampaign, demoCanvasser, 'survey_submitted', 40_000);
  await knock(demoCampaign, demoCanvasser, 'lit_dropped', 50_000);
  await knock(sandboxCampaign, sandboxUser, 'refused', 30_000);

  Object.assign(ctx, { staffTok: signUserToken(staff), acme, demo, sandbox });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('the platform-wide numbers leave out internal orgs, their campaigns and their canvassing', { skip }, async () => {
  const r = await overview();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { totals } = r.json;

  assert.deepEqual(totals.orgs, { total: 2, active: 1, inactive: 1 }, 'Acme and Gone Co; neither the demo nor the sandbox');
  assert.deepEqual(totals.campaigns, { total: 2, active: 1 }, "Acme's two campaigns; none of the internal orgs' three");
  assert.equal(totals.activeNow.count, 1, "Acme's canvasser; the demo's staged knocks don't light it up");
  assert.deepEqual(totals.today, { doorsKnocked: 2, surveysSubmitted: 1, litDropped: 0, restricted: 0 });
});

test('Users leaves out accounts that exist only for internal orgs, never staff', { skip }, async () => {
  const { json } = await overview();
  // staff, admin@acme, canvasser@acme, both@acme and omar@doorline.app; not canvasser@demo or
  // someone@sandbox.
  assert.deepEqual(json.totals.users, { total: 5, active: 5, superAdmins: 2 });
});

test('the per-org rows still describe the demo org, so staff can switch into it', { skip }, async () => {
  const { json } = await overview();
  const row = (org) => json.organizations.find((o) => o.id === String(org._id));
  assert.equal(json.organizations.length, 4, 'every org, internal ones included');

  const demo = row(ctx.demo);
  assert.equal(demo.isInternal, true);
  assert.equal(demo.memberCount, 3, 'both@acme, canvasser@demo and omar@doorline.app');
  assert.equal(demo.campaignCount, 1, 'its active campaign');
  assert.equal(demo.activeNowCount, 1, 'its own row still shows the staged canvasser');
  assert.ok(demo.lastActivityAt, 'and its last activity');

  const acme = row(ctx.acme);
  assert.equal(acme.memberCount, 3);
  assert.equal(acme.campaignCount, 1);
  assert.equal(acme.activeNowCount, 1);
});
