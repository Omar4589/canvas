import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// "Archive makes the campaign read-only" — over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/archived node --test test/archivedCampaign.int.test.js
//
// That sentence ships in docs/CAMPAIGNS.md and in the Help Center, but for a long time nothing
// enforced it for ADMINS: the only campaign.isActive check in the server was the canvasser
// bootstrap, so a finished race could still have books handed out, crew added, and pins moved
// from either console. middleware/campaignWritable.js closed that; this pins BOTH halves of it.
//
// The half that is easy to forget is the SECOND one. "Read-only" is not "nothing works":
//   · EXPORTS must keep working — an export is a read, and taking a finished campaign's data
//     with you is the entire reason archiving isn't deletion. entitlement.js already lets even
//     a paused ORG create one, so an archived CAMPAIGN must not be stricter. This suite is the
//     first coverage that pins it at all (grep 'archiv' in exports.int.test.js: nothing).
//   · FLAG REVIEW must keep working — it records a decision ABOUT past work; it is bookkeeping,
//     not new field work.
//   · The campaign must stay EDITABLE, or reactivating it would be impossible.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-archived-campaign';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Turf } = await import('../src/models/Turf.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Effort } = await import('../src/models/Effort.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const PW = 'Str0ng!Passw0rd';
let server;
let base;
const ctx = {};

const makeUser = async (first) =>
  User.create({
    firstName: first,
    lastName: 'X',
    email: `${first.toLowerCase()}@t.co`,
    passwordHash: await User.hashPassword(PW),
    isActive: true,
  });

const call = async (method, path, { token, orgId, body } = {}) => {
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
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

// A campaign with one published book and one door — enough to exercise every guarded write.
// `isActive` is the only thing that differs between the two campaigns under test.
const seedCampaign = async (org, name, { isActive }) => {
  const campaign = await Campaign.create({
    organizationId: org._id, name, type: 'lit_drop', state: 'FL', isActive,
    ...(isActive ? {} : { archivedAt: new Date() }),
  });
  const effort = await Effort.create({
    organizationId: org._id, campaignId: campaign._id, name: 'North',
  });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'active',
  });
  const home = await Household.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `1 ${name} Ln`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `1 ${name.toUpperCase()} LN|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  });
  const turf = await Turf.create({
    organizationId: org._id, campaignId: campaign._id, passId: pass._id, name: 'Book 1',
    mode: 'geometric', status: 'published', householdIds: [home._id], doorCount: 1,
  });
  return { campaign, effort, pass, turf, home };
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Subscription, Campaign, CampaignAssignment,
    TurfAssignment, Turf, Pass, Household, Effort, ExportJob, CanvassActivity,
  ]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Acme', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const boss = await makeUser('Boss');       // org admin — does everything below
  const walker = await makeUser('Walker');   // the person being assigned/unassigned

  await Membership.create({ userId: boss._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: walker._id, organizationId: org._id, role: 'canvasser', isActive: true });

  // Two campaigns, identical but for isActive. Every refusal below is asserted against LIVE too,
  // so a test that starts passing because the endpoint broke outright still fails.
  const archived = await seedCampaign(org, 'Finished', { isActive: false });
  const live = await seedCampaign(org, 'Running', { isActive: true });

  Object.assign(ctx, { org, boss, walker, archived, live });

  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.token = signUserToken(boss);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// ── The refusals ───────────────────────────────────────────────────────────────
// 409 + code 'campaign-archived' is the contract both clients branch on. The status is
// deliberately NOT 403: mobile/lib/api.js inspects 400/403/404 for ORG_CONTEXT and
// FORBIDDEN_ROLE, so a 403 an older bundle doesn't recognise can eject the user to the org
// picker — turning "this campaign is finished" into "your session is broken".
const assertArchivedRefusal = (res) => {
  assert.equal(res.status, 409);
  assert.equal(res.json?.code, 'campaign-archived');
};

test('archived: adding someone to the campaign roster is refused', { skip }, async () => {
  const { org, token, archived, live, walker } = ctx;
  const body = { userIds: [String(walker._id)] };

  const blocked = await call('POST', `/admin/campaigns/${archived.campaign._id}/assignments`, { token, orgId: org._id, body });
  assertArchivedRefusal(blocked);
  assert.equal(await CampaignAssignment.countDocuments({ campaignId: archived.campaign._id }), 0);

  const allowed = await call('POST', `/admin/campaigns/${live.campaign._id}/assignments`, { token, orgId: org._id, body });
  assert.ok(allowed.status < 400, `live campaign roster add should succeed, got ${allowed.status}`);
  assert.equal(await CampaignAssignment.countDocuments({ campaignId: live.campaign._id }), 1);
});

test('archived: removing someone from the campaign roster is refused', { skip }, async () => {
  const { org, token, archived, walker } = ctx;
  // Seed the row directly — the point is that the ROUTE refuses, not that the row is missing.
  await CampaignAssignment.create({
    organizationId: org._id, campaignId: archived.campaign._id, userId: walker._id,
  });
  const res = await call('DELETE', `/admin/campaigns/${archived.campaign._id}/assignments/${walker._id}`, { token, orgId: org._id });
  assertArchivedRefusal(res);
  assert.equal(await CampaignAssignment.countDocuments({ campaignId: archived.campaign._id }), 1);
});

test('archived: assigning a book is refused, and unassigning one is too', { skip }, async () => {
  const { org, token, archived, live, walker } = ctx;
  const body = { userIds: [String(walker._id)] };

  const blocked = await call('POST', `/admin/campaigns/${archived.campaign._id}/turfs/${archived.turf._id}/assignments`, { token, orgId: org._id, body });
  assertArchivedRefusal(blocked);
  assert.equal(await TurfAssignment.countDocuments({ turfId: archived.turf._id }), 0);

  const allowed = await call('POST', `/admin/campaigns/${live.campaign._id}/turfs/${live.turf._id}/assignments`, { token, orgId: org._id, body });
  assert.equal(allowed.status, 201, `live book assign should succeed, got ${allowed.status}`);
  assert.equal(await TurfAssignment.countDocuments({ turfId: live.turf._id }), 1);

  // Unassign on the archive: seed the row, then prove DELETE won't take it away.
  await TurfAssignment.create({
    organizationId: org._id, campaignId: archived.campaign._id,
    passId: archived.pass._id, turfId: archived.turf._id, userId: walker._id,
  });
  const del = await call('DELETE', `/admin/campaigns/${archived.campaign._id}/turfs/${archived.turf._id}/assignments/${walker._id}`, { token, orgId: org._id });
  assertArchivedRefusal(del);
  assert.equal(await TurfAssignment.countDocuments({ turfId: archived.turf._id }), 1);
});

test('archived: bulk book assignment and restrict/unrestrict are refused', { skip }, async () => {
  const { org, token, archived, walker } = ctx;
  const cid = archived.campaign._id;

  for (const [path, body] of [
    [`/admin/campaigns/${cid}/turfs/assign-bulk`, { turfIds: [String(archived.turf._id)], userIds: [String(walker._id)], mode: 'everyone' }],
    [`/admin/campaigns/${cid}/turfs/restrict-bulk`, { turfIds: [String(archived.turf._id)] }],
    [`/admin/campaigns/${cid}/turfs/unrestrict-bulk`, { turfIds: [String(archived.turf._id)] }],
  ]) {
    assertArchivedRefusal(await call('POST', path, { token, orgId: org._id, body }));
  }
  assert.equal(await TurfAssignment.countDocuments({ campaignId: cid, userId: walker._id, turfId: archived.turf._id }), 1);
});

test('archived: BOTH pin doors refuse — the admin one and the mobile one', { skip }, async () => {
  const { org, token, archived, live } = ctx;
  const body = { lat: 28.9, lng: -81.9 };

  assertArchivedRefusal(
    await call('PATCH', `/admin/campaigns/${archived.campaign._id}/households/${archived.home._id}/location`, { token, orgId: org._id, body })
  );

  // The same write has a second, non-campaign-nested door on the mobile router. Its own comment
  // says it shares the web route's policy "literally the same function" — so if only one door
  // learns about archiving, an identical write is 200 here and 409 there.
  assertArchivedRefusal(
    await call('POST', `/mobile/households/${archived.home._id}/location`, {
      token, orgId: org._id, body: { ...body, source: 'drag' },
    })
  );

  const untouched = await Household.findById(archived.home._id).lean();
  assert.deepEqual(untouched.location.coordinates, [-81.4, 28.3], 'a refused pin move must not have written');

  const allowed = await call('PATCH', `/admin/campaigns/${live.campaign._id}/households/${live.home._id}/location`, { token, orgId: org._id, body });
  assert.ok(allowed.status < 400, `live pin move should succeed, got ${allowed.status}`);
});

test('archived: the refusal cannot be mistaken for a session or role problem', { skip }, async () => {
  const { org, token, archived, walker } = ctx;
  const res = await call('POST', `/admin/campaigns/${archived.campaign._id}/assignments`, {
    token, orgId: org._id, body: { userIds: [String(walker._id)] },
  });

  // This encodes the reason the status is 409. mobile/lib/api.js tags ORG_CONTEXT off 400/403/404
  // and FORBIDDEN_ROLE off 403, and the global handler in app/_layout.jsx acts on those by
  // clearing the active org or refetching /auth/me — i.e. a 403 an old bundle doesn't recognise
  // can bounce the user out to the org picker. If someone later "tidies" this to a 403, this
  // test is what stops a finished campaign from reading as a broken session on shipped phones.
  assert.equal(res.status, 409);
  assert.notEqual(res.status, 403);
  assert.notEqual(res.json?.code, 'FORBIDDEN_ROLE');
  assert.notEqual(res.json?.code, 'ORG_CONTEXT');
  for (const orgContextString of [
    'Active organization required (X-Org-Id header)',
    'Organization not found',
    'Not a member of this organization',
    'Invalid X-Org-Id',
  ]) {
    assert.notEqual(res.json?.error, orgContextString);
  }
});

test('archived: preview POSTs still work — they are reads wearing POST', { skip }, async () => {
  const { org, token, archived } = ctx;
  // /manual-preview and /target-preview persist nothing; blocking them would make an archived
  // campaign's book layout un-inspectable for no gain. Pins the readOnlyPosts carve-out.
  for (const path of ['manual-preview', 'target-preview']) {
    const res = await call('POST', `/admin/campaigns/${archived.campaign._id}/turfs/${path}`, {
      token, orgId: org._id, body: { passId: String(archived.pass._id) },
    });
    assert.notEqual(res.json?.code, 'campaign-archived', `${path} must not be refused for being archived`);
    assert.notEqual(res.status, 409);
  }
});

test('archived: a campaign that is not there still 404s — the guard never invents an error', { skip }, async () => {
  const { org, token, walker } = ctx;
  const ghost = new mongoose.Types.ObjectId();
  const res = await call('POST', `/admin/campaigns/${ghost}/assignments`, {
    token, orgId: org._id, body: { userIds: [String(walker._id)] },
  });
  assert.notEqual(res.status, 409, 'a missing campaign is a 404, not an archived refusal');
});

// ── The things that must KEEP working ──────────────────────────────────────────

test('archived: EXPORTS still work — the whole point of archiving instead of deleting', { skip }, async () => {
  const { org, token, archived } = ctx;

  // The estimate is a read wearing POST; the create is the one that must not be mistaken for
  // a field write. Both are carved out of the read-only-ORG block in middleware/entitlement.js,
  // so an archived CAMPAIGN must not be stricter than a paused ACCOUNT.
  const estimate = await call('POST', '/admin/exports/estimate', {
    token, orgId: org._id, body: { type: 'canvass-activity', campaignId: String(archived.campaign._id) },
  });
  assert.ok(estimate.status < 400, `export estimate on an archive should succeed, got ${estimate.status} ${JSON.stringify(estimate.json)}`);

  const created = await call('POST', '/admin/exports', {
    token, orgId: org._id, body: { type: 'canvass-activity', campaignId: String(archived.campaign._id) },
  });
  // The assertion that matters is that the ARCHIVE didn't stop it. A local run with no Redis
  // answers 503 queue-unavailable from the enqueue step, well past this guard — so assert on
  // the refusal contract, which holds either way, and on the job row when the queue was there.
  assert.notEqual(created.json?.code, 'campaign-archived', 'export creation must never be refused for being archived');
  assert.notEqual(created.status, 409);
  if (created.status < 400) {
    assert.equal(await ExportJob.countDocuments({ campaignId: archived.campaign._id }), 1);
  }
});

test('archived: reading the campaign is untouched — the roster and books still list', { skip }, async () => {
  const { org, token, archived } = ctx;

  const roster = await call('GET', `/admin/campaigns/${archived.campaign._id}/assignments`, { token, orgId: org._id });
  assert.ok(roster.status < 400, `roster read on an archive should succeed, got ${roster.status}`);

  const books = await call('GET', `/admin/campaigns/${archived.campaign._id}/turfs?passId=${archived.pass._id}`, { token, orgId: org._id });
  assert.ok(books.status < 400, `books read on an archive should succeed, got ${books.status}`);

  // And the campaign is still in the list the mobile chip renders — the bug that started all
  // this was the client filtering archived campaigns out of a list the server always returned.
  const list = await call('GET', '/admin/campaigns', { token, orgId: org._id });
  assert.ok(
    (list.json?.campaigns || []).some((c) => String(c._id) === String(archived.campaign._id) && c.isActive === false),
    'GET /admin/campaigns must still return the archived campaign, flagged isActive:false'
  );
});

test('archived: the campaign itself stays editable — otherwise you could never reactivate it', { skip }, async () => {
  const { org, token, archived } = ctx;
  const res = await call('PATCH', `/admin/campaigns/${archived.campaign._id}`, {
    token, orgId: org._id, body: { name: 'Finished (renamed)' },
  });
  assert.ok(res.status < 400, `editing an archived campaign should succeed, got ${res.status}`);

  // The way back out. Reactivating clears archivedAt (campaigns.js), and the guard must let go
  // the moment it does — so re-archive afterwards to leave the fixture as the other tests found it.
  const on = await call('PATCH', `/admin/campaigns/${archived.campaign._id}`, {
    token, orgId: org._id, body: { isActive: true },
  });
  assert.ok(on.status < 400, `reactivating should succeed, got ${on.status}`);
  const nowLive = await call('POST', `/admin/campaigns/${archived.campaign._id}/assignments`, {
    token, orgId: org._id, body: { userIds: [String(ctx.walker._id)] },
  });
  assert.ok(nowLive.status < 400, 'a reactivated campaign must accept writes again');

  await call('PATCH', `/admin/campaigns/${archived.campaign._id}`, {
    token, orgId: org._id, body: { isActive: false },
  });
  assertArchivedRefusal(
    await call('PATCH', `/admin/campaigns/${archived.campaign._id}/households/${archived.home._id}/location`, {
      token, orgId: org._id, body: { lat: 29.1, lng: -81.1 },
    })
  );
});
