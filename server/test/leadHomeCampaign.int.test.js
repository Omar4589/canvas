import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// A team lead's home campaign, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/lead_home_test node --test test/leadHomeCampaign.int.test.js
//
// The contract (docs/PROPOSAL_LEAD_CAMPAIGN_LANDING.md §B-§C):
//   1. Every `lead` membership on /auth/login and /auth/me carries homeCampaignId: the one campaign
//      they hold a grant for in that org that is active and not being deleted, or null when there
//      are none or several. The key is always present on a lead row; admin rows never carry it.
//   2. A grant only counts inside its own org: a grant recorded in org A that points at a campaign
//      living in org B is ignored, the same filter /admin/campaigns applies.
//   3. The web decides from this field (client/src/lib/homePath.js); the phone decides from the
//      lead's /admin/campaigns list (mobile/lib/campaignSelection.js soleActiveCampaign). The
//      agreement test pins the two to the same answer.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-lead-home';

const { createApp } = await import('../src/app.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const PASSWORD = 'Sup3r-Str0ng-Pw!';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, Subscription]) {
    await M.deleteMany({});
  }

  const orgA = await Organization.create({ name: 'Lead Home A', slug: 'lead-home-a', isActive: true });
  const orgB = await Organization.create({ name: 'Lead Home B', slug: 'lead-home-b', isActive: true });
  for (const o of [orgA, orgB]) await Subscription.create({ organizationId: o._id, status: 'internal' });

  const camp = (org, name, extra = {}) =>
    Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'TX', isActive: true, ...extra });
  const cA1 = await camp(orgA, 'A one');
  const cA2 = await camp(orgA, 'A archived', { isActive: false });
  const cA3 = await camp(orgA, 'A three');
  const cA4 = await camp(orgA, 'A deleting', {
    deletion: { requestedAt: new Date(), status: 'pending', heartbeatAt: new Date() },
  });
  const cB1 = await camp(orgB, 'B one');
  const cB2 = await camp(orgB, 'B two');

  const passwordHash = await User.hashPassword(PASSWORD);
  const mk = (key) =>
    User.create({ firstName: key, lastName: 'Lead', email: `${key}@leadhome.t.co`, passwordHash, isActive: true });
  const member = (u, org, role) => Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
  // `grantOrg` is the org the grant row is recorded in — normally the campaign's own.
  const grant = (u, c, grantOrg) =>
    CampaignManager.create({ campaignId: c._id, userId: u._id, organizationId: (grantOrg || { _id: c.organizationId })._id });

  const users = {};
  const add = async (key, setup) => {
    const u = await mk(key);
    await setup(u);
    users[key] = u;
  };

  await add('one', async (u) => {
    await member(u, orgA, 'lead');
    await grant(u, cA1);
  });
  await add('witharchived', async (u) => {
    await member(u, orgA, 'lead');
    await grant(u, cA1);
    await grant(u, cA2);
  });
  await add('two', async (u) => {
    await member(u, orgA, 'lead');
    await grant(u, cA1);
    await grant(u, cA3);
  });
  await add('none', async (u) => {
    await member(u, orgA, 'lead');
  });
  await add('onlyarchived', async (u) => {
    await member(u, orgA, 'lead');
    await grant(u, cA2);
  });
  await add('withdeleting', async (u) => {
    await member(u, orgA, 'lead');
    await grant(u, cA1);
    await grant(u, cA4);
  });
  await add('twoorgs', async (u) => {
    await member(u, orgA, 'lead');
    await member(u, orgB, 'lead');
    await grant(u, cA1);
    await grant(u, cB1);
    await grant(u, cB2);
  });
  // A grant recorded in org A that points at org B's campaign. Counting org A's grants without
  // checking where each campaign lives would see two live campaigns (cA1 + cB1) and answer null.
  await add('crossorg', async (u) => {
    await member(u, orgA, 'lead');
    await grant(u, cA1);
    await grant(u, cB1, orgA);
  });
  // Admin in A (with a stray grant there, so the lead-only branch runs) and lead in B.
  await add('adminlead', async (u) => {
    await member(u, orgA, 'admin');
    await member(u, orgB, 'lead');
    await grant(u, cA1);
    await grant(u, cB1);
  });

  Object.assign(ctx, { orgA, orgB, cA1, cA2, cA3, cA4, cB1, cB2, users });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

// Signs in, then reads /auth/me with the token it got: both routes build memberships through the
// same loader, and both are checked so neither can drift.
async function signIn(key) {
  const login = await call('POST', '/api/auth/login', {
    body: { email: `${key}@leadhome.t.co`, password: PASSWORD },
  });
  assert.strictEqual(login.status, 200, `login ${key}`);
  const me = await call('GET', '/api/auth/me', { token: login.json.token });
  assert.strictEqual(me.status, 200, `me ${key}`);
  return { token: login.json.token, login: login.json.memberships, me: me.json.memberships };
}

const rowFor = (memberships, org) => memberships.find((m) => m.organizationId === String(org._id));

// Asserts one org's homeCampaignId on both responses; `expected` is a campaign doc or null.
async function expectHome(key, org, expected) {
  const s = await signIn(key);
  for (const [route, ms] of [['login', s.login], ['me', s.me]]) {
    const row = rowFor(ms, org);
    assert.ok(row, `${key} ${route}: membership in ${org.name}`);
    assert.ok('homeCampaignId' in row, `${key} ${route}: a lead row always carries homeCampaignId`);
    assert.strictEqual(row.homeCampaignId, expected ? String(expected._id) : null, `${key} ${route}`);
  }
  return s;
}

test('one active grant → that campaign', { skip }, async () => {
  await expectHome('one', ctx.orgA, ctx.cA1);
});

test('one active + one archived → the active one', { skip }, async () => {
  await expectHome('witharchived', ctx.orgA, ctx.cA1);
});

test('two active → null', { skip }, async () => {
  await expectHome('two', ctx.orgA, null);
});

test('no grants → null, and the key is still present', { skip }, async () => {
  await expectHome('none', ctx.orgA, null);
});

test('only an archived grant → null', { skip }, async () => {
  await expectHome('onlyarchived', ctx.orgA, null);
});

test('one active + one being deleted → the active one', { skip }, async () => {
  await expectHome('withdeleting', ctx.orgA, ctx.cA1);
});

test('a lead in two orgs is decided per org', { skip }, async () => {
  await expectHome('twoorgs', ctx.orgA, ctx.cA1);
  await expectHome('twoorgs', ctx.orgB, null);
});

test('a grant pointing at another org\'s campaign is ignored', { skip }, async () => {
  await expectHome('crossorg', ctx.orgA, ctx.cA1);
});

test('an admin row never carries the key; the same user\'s lead row does', { skip }, async () => {
  const s = await expectHome('adminlead', ctx.orgB, ctx.cB1);
  for (const ms of [s.login, s.me]) {
    const adminRow = rowFor(ms, ctx.orgA);
    assert.strictEqual(adminRow.role, 'admin');
    assert.ok(!('homeCampaignId' in adminRow), 'admin row has no homeCampaignId');
    assert.ok(!('managedCampaignIds' in adminRow), 'admin row has no managedCampaignIds');
  }
});

// The web reads homeCampaignId; the phone counts the lead's own /admin/campaigns list. Same answer,
// for every lead fixture and every org they lead in.
test('homeCampaignId agrees with the lead\'s /admin/campaigns list', { skip }, async () => {
  const cases = [
    ['one', ctx.orgA],
    ['witharchived', ctx.orgA],
    ['two', ctx.orgA],
    ['none', ctx.orgA],
    ['onlyarchived', ctx.orgA],
    ['withdeleting', ctx.orgA],
    ['twoorgs', ctx.orgA],
    ['twoorgs', ctx.orgB],
    ['crossorg', ctx.orgA],
    ['adminlead', ctx.orgB],
  ];
  for (const [key, org] of cases) {
    const s = await signIn(key);
    const list = await call('GET', '/api/admin/campaigns', { token: s.token, orgId: org._id });
    assert.strictEqual(list.status, 200, `${key} list`);
    const live = (list.json.campaigns || []).filter((c) => c.isActive !== false);
    const phoneAnswer = live.length === 1 ? String(live[0]._id) : null;
    assert.strictEqual(rowFor(s.me, org).homeCampaignId, phoneAnswer, `${key} in ${org.name}`);
  }
});
