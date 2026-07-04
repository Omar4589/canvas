import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Authorization matrix for the team-lead (campaign-scoped admin) role, exercised over the
// REAL Express app + a throwaway mongod (no Redis — we test the Redis-free authz paths):
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/lead_test node --test test/teamLead.int.test.js
// Seed: one org, an admin, and a lead granted campaign A only (with a campaign B they do NOT
// manage). Assert a lead can run A but is 403 on B, on campaign CRUD, on the org survey/tag
// mutations and the org Users admin — while allowed to read libraries + run their crew.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-team-lead';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Household } = await import('../src/models/Household.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {}; // { org, A, B, adminTok, leadTok }

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, Household, ReportShareLink]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Test Org', slug: 'test-org-lead', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'admin@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'lead@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  const A = await Campaign.create({ organizationId: org._id, name: 'Campaign A', type: 'survey', state: 'KY', isActive: true });
  const B = await Campaign.create({ organizationId: org._id, name: 'Campaign B', type: 'survey', state: 'KY', isActive: true });
  await CampaignManager.create({ campaignId: A._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });

  // A household in each campaign, for the /:householdId/activity scoping test. Raw insert
  // (bypass schema requireds) — the handler only needs _id + organizationId + campaignId.
  const hhA = new mongoose.Types.ObjectId();
  const hhB = new mongoose.Types.ObjectId();
  await Household.collection.insertMany([
    { _id: hhA, campaignId: A._id, organizationId: org._id, isActive: true },
    { _id: hhB, campaignId: B._id, organizationId: org._id, isActive: true },
  ]);

  // A password-protected share link for the unlock rate-limit test.
  const shareToken = 'ratelimit-test-token';
  await ReportShareLink.collection.insertOne({
    token: shareToken,
    organizationId: org._id,
    campaignId: A._id,
    passwordHash: await bcrypt.hash('the-real-password', 10),
    isActive: true,
  });

  Object.assign(ctx, {
    org, A, B, hhA, hhB, shareToken,
    adminTok: signUserToken(admin),
    leadTok: signUserToken(lead),
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
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

test('lead can run a granted campaign (A) — 200 on its field routes', { skip }, async () => {
  const { leadTok, org, A } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  // Slugs with a bare GET / handler (campaignHouseholds only exposes PATCH, so it's
  // excluded here — its guard swap is covered by the B-403 case + Phase 2).
  for (const slug of ['passes', 'assignments', 'efforts', 'walklists', 'voted', 'setup-status', 'turfs', 'crew']) {
    const { status } = await call('GET', `/api/admin/campaigns/${A._id}/${slug}`, opt);
    assert.ok(status < 400, `GET A/${slug} expected <400, got ${status}`);
  }
});

test('lead is 403 on a campaign they do NOT manage (B)', { skip }, async () => {
  const { leadTok, org, B } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  for (const slug of ['passes', 'assignments', 'efforts', 'walklists', 'setup-status', 'turfs', 'crew']) {
    const { status } = await call('GET', `/api/admin/campaigns/${B._id}/${slug}`, opt);
    assert.strictEqual(status, 403, `GET B/${slug} expected 403, got ${status}`);
  }
});

test('GET /admin/campaigns is scoped: lead sees only A, admin sees A + B', { skip }, async () => {
  const { leadTok, adminTok, org, A } = ctx;
  const lead = await call('GET', '/api/admin/campaigns', { token: leadTok, orgId: org._id });
  assert.strictEqual(lead.status, 200);
  assert.strictEqual(lead.json.campaigns.length, 1);
  assert.strictEqual(String(lead.json.campaigns[0]._id), String(A._id));

  const admin = await call('GET', '/api/admin/campaigns', { token: adminTok, orgId: org._id });
  assert.strictEqual(admin.status, 200);
  assert.strictEqual(admin.json.campaigns.length, 2);
});

test('campaign create / archive / delete are admin-only (lead 403)', { skip }, async () => {
  const { leadTok, org, A } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const create = await call('POST', '/api/admin/campaigns', { ...opt, body: { name: 'New', type: 'survey', state: 'KY' } });
  assert.strictEqual(create.status, 403, 'lead create');
  const archive = await call('PATCH', `/api/admin/campaigns/${A._id}`, { ...opt, body: { isActive: false } });
  assert.strictEqual(archive.status, 403, 'lead archive');
  const del = await call('DELETE', `/api/admin/campaigns/${A._id}`, opt);
  assert.strictEqual(del.status, 403, 'lead delete');
});

test('lead can PATCH editable config on a managed campaign, not on B', { skip }, async () => {
  const { leadTok, org, A, B } = ctx;
  const ok = await call('PATCH', `/api/admin/campaigns/${A._id}`, { token: leadTok, orgId: org._id, body: { surveyTemplateId: null } });
  assert.strictEqual(ok.status, 200, 'lead PATCH A survey');
  const no = await call('PATCH', `/api/admin/campaigns/${B._id}`, { token: leadTok, orgId: org._id, body: { name: 'x' } });
  assert.strictEqual(no.status, 403, 'lead PATCH B');
});

test('imports + reports scope to managed campaigns', { skip }, async () => {
  const { leadTok, org, A, B } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  assert.strictEqual((await call('GET', `/api/admin/imports?campaignId=${A._id}`, opt)).status, 200, 'imports A');
  assert.strictEqual((await call('GET', `/api/admin/imports?campaignId=${B._id}`, opt)).status, 403, 'imports B');
  assert.strictEqual((await call('GET', `/api/admin/reports/overview?campaignId=${A._id}`, opt)).status, 200, 'reports A');
  assert.strictEqual((await call('GET', `/api/admin/reports/overview?campaignId=${B._id}`, opt)).status, 403, 'reports B');
  assert.strictEqual((await call('GET', '/api/admin/reports/overview', opt)).status, 403, 'reports org-wide');
  assert.strictEqual((await call('GET', '/api/admin/reports/campaign-rollup', opt)).status, 200, 'rollup self-scopes');
});

test('libraries: lead reads surveys/tags but cannot mutate them, and cannot reach org Users/voters', { skip }, async () => {
  const { leadTok, org } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  assert.strictEqual((await call('GET', '/api/admin/surveys', opt)).status, 200, 'GET surveys');
  assert.strictEqual((await call('GET', '/api/admin/tags', opt)).status, 200, 'GET tags');
  assert.strictEqual((await call('POST', '/api/admin/surveys', { ...opt, body: { name: 'X' } })).status, 403, 'POST surveys');
  assert.strictEqual((await call('POST', '/api/admin/tags', { ...opt, body: { name: 'x' } })).status, 403, 'POST tags');
  assert.strictEqual((await call('GET', '/api/admin/memberships', opt)).status, 403, 'org Users admin');
  assert.strictEqual((await call('GET', '/api/admin/voters', opt)).status, 403, 'org voters');
});

test('lead can create a canvasser onto a managed campaign via /crew, not onto B', { skip }, async () => {
  const { leadTok, org, A, B } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  const ok = await call('POST', `/api/admin/campaigns/${A._id}/crew`, {
    ...opt,
    body: { firstName: 'Cy', lastName: 'Canvasser', email: 'cy@t.co', password: 'password123' },
  });
  assert.strictEqual(ok.status, 201, 'crew create on A');
  const no = await call('POST', `/api/admin/campaigns/${B._id}/crew`, {
    ...opt,
    body: { firstName: 'No', lastName: 'Pe', email: 'nope@t.co', password: 'password123' },
  });
  assert.strictEqual(no.status, 403, 'crew create on B');
});

test('lead can load the campaign map for A, not B, and never org-wide', { skip }, async () => {
  const { leadTok, org, A, B } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  assert.strictEqual((await call('GET', `/api/admin/households/map?campaignId=${A._id}`, opt)).status, 200, 'map A');
  assert.strictEqual((await call('GET', `/api/admin/households/map?campaignId=${B._id}`, opt)).status, 403, 'map B');
  assert.strictEqual((await call('GET', '/api/admin/households/map', opt)).status, 403, 'map org-wide');
});

test('lead household-activity is scoped to a managed campaign', { skip }, async () => {
  const { leadTok, org, hhA, hhB } = ctx;
  const opt = { token: leadTok, orgId: org._id };
  assert.strictEqual((await call('GET', `/api/admin/households/${hhA}/activity`, opt)).status, 200, 'activity A');
  assert.strictEqual((await call('GET', `/api/admin/households/${hhB}/activity`, opt)).status, 403, 'activity B');
});

test('share-link unlock is rate-limited after repeated wrong passwords', { skip }, async () => {
  const { shareToken } = ctx;
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    const r = await call('POST', `/api/share/${shareToken}/unlock`, { body: { password: 'wrong-guess' } });
    statuses.push(r.status);
  }
  assert.strictEqual(statuses[0], 401, 'first wrong attempt is 401');
  assert.strictEqual(statuses[10], 429, '11th attempt in the window is rate-limited (429)');
});
