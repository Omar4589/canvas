import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The bulk-restrict SCOPE param over the REAL Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/bulkrestrict_scope_test node --test test/bulkRestrictScope.int.test.js
//
// Contract (owner request 2026-07-23): a book worked in part shouldn't force the reached doors
// to be relabeled inaccessible. `scope:'unknocked'` marks ONLY the never-touched doors and leaves
// every door the crew reached (not-home / refused / wrong-address) exactly as it is; the default
// `scope:'incomplete'` keeps today's behavior (marks the reached-but-unfinished doors too). Both
// always skip completed (surveyed/lit-dropped) and already-restricted doors.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-bulk-restrict-scope';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { getPassStatusMap } = await import('../src/services/passes/passStatus.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
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

function makeHousehold(orgId, campaignId, effortId, n, status) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Mixed Ct`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} MIXED CT|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
    isActive: true,
    status,
  };
}
function fieldRow(hh, userId, actionType, passId, turfId, ts) {
  const [lng, lat] = hh.location.coordinates;
  return {
    organizationId: hh.organizationId,
    campaignId: hh.campaignId,
    householdId: hh._id,
    userId,
    actionType,
    location: { lat: lat + 0.0001, lng, accuracy: 10 },
    distanceFromHouseMeters: 12,
    timestamp: ts,
    passId,
    turfId,
    effortId: hh.effortId,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, Household, CanvassActivity, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Scope Org', slug: 'scope-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'sa@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'sc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Scope C', type: 'survey', state: 'FL', isActive: true });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Pass 1', status: 'active',
  });

  // 6 doors: 2 untouched, 2 not-home, 1 refused, 1 surveyed (this round).
  const hhs = await Household.insertMany([
    makeHousehold(org._id, camp._id, effort._id, 1, 'unknocked'),
    makeHousehold(org._id, camp._id, effort._id, 2, 'unknocked'),
    makeHousehold(org._id, camp._id, effort._id, 3, 'not_home'),
    makeHousehold(org._id, camp._id, effort._id, 4, 'not_home'),
    makeHousehold(org._id, camp._id, effort._id, 5, 'refused'),
    makeHousehold(org._id, camp._id, effort._id, 6, 'surveyed'),
  ]);
  const [hhU1, hhU2, hhNH1, hhNH2, hhRF, hhSV] = hhs;

  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book M', mode: 'geometric',
    status: 'published', householdIds: hhs.map((h) => h._id), doorCount: hhs.length,
  });

  const ago = (min) => new Date(Date.now() - 3600_000 + min * 60_000);
  await CanvassActivity.insertMany([
    fieldRow(hhNH1, canv._id, 'not_home', pass._id, turf._id, ago(0)),
    fieldRow(hhNH2, canv._id, 'not_home', pass._id, turf._id, ago(10)),
    fieldRow(hhRF, canv._id, 'refused', pass._id, turf._id, ago(20)),
    fieldRow(hhSV, canv._id, 'survey_submitted', pass._id, turf._id, ago(30)),
  ]);

  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, pass, turf, admin, canv, hhU1, hhU2, hhNH1, hhNH2, hhRF, hhSV,
    adminTok: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const restrict = (scope) =>
  call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/restrict-bulk`, { turfIds: [String(ctx.turf._id)], scope });
const unrestrict = () =>
  call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/unrestrict-bulk`, { turfIds: [String(ctx.turf._id)] });
const roundStatus = async (hh) =>
  (await getPassStatusMap(ctx.pass._id, [hh._id], ctx.camp.type)).get(String(hh._id))?.status || 'unknocked';

test("scope 'unknocked' marks only untouched doors; reached doors are left as-is", { skip }, async () => {
  const r = await restrict('unknocked');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.marked, 2, 'only the 2 unknocked doors');
  assert.strictEqual(r.json.skipped.reached, 3, '2 not-home + 1 refused left alone');
  assert.strictEqual(r.json.skipped.completed, 1, 'the surveyed door');

  // The reached doors keep their per-round status and grow NO bulk row.
  assert.strictEqual(await roundStatus(ctx.hhNH1), 'not_home');
  assert.strictEqual(await roundStatus(ctx.hhRF), 'refused');
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: ctx.hhNH1._id, via: 'bulk' }), 0);
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: ctx.hhRF._id, via: 'bulk' }), 0);
  // The untouched doors ARE restricted.
  assert.strictEqual(await roundStatus(ctx.hhU1), 'restricted');
  assert.strictEqual(await roundStatus(ctx.hhU2), 'restricted');
  // The completed door is untouched.
  assert.strictEqual(await roundStatus(ctx.hhSV), 'surveyed');

  await unrestrict(); // reset for the next test
  assert.strictEqual(await roundStatus(ctx.hhU1), 'unknocked');
});

test("default scope 'incomplete' also marks the reached doors (today's behavior)", { skip }, async () => {
  const r = await restrict(); // no scope → default
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.marked, 5, '2 unknocked + 2 not-home + 1 refused');
  assert.strictEqual(r.json.skipped.reached, 0, 'never populated under the default scope');
  assert.strictEqual(r.json.skipped.completed, 1);

  assert.strictEqual(await roundStatus(ctx.hhNH1), 'restricted', 'reached door IS marked under the default');
  assert.strictEqual(await roundStatus(ctx.hhRF), 'restricted');
  assert.strictEqual(await roundStatus(ctx.hhSV), 'surveyed', 'completed still skipped');
});

test('re-running is idempotent — nothing double-marks', { skip }, async () => {
  const r = await restrict('incomplete');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.marked, 0);
  assert.strictEqual(r.json.skipped.alreadyRestricted, 5);
  assert.strictEqual(r.json.skipped.completed, 1);
});
