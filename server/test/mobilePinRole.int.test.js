import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Who may move a house pin, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/pinrole node --test test/mobilePinRole.int.test.js
//
// Moving a pin is a data change with an audit trail, and it used to be open to any canvasser
// working the book. That let a faked knock be laundered: record from home, collect a "far from
// house" flag, then drag the pin onto your own house to soften it. It is now leads/admins/supers
// only, on BOTH write paths, with identical policy (canManageCampaign).
//
// This drives the real routes to assert: (1) a canvasser is refused even for a door in their own
// assigned book — the case that used to pass; (2) a lead is admitted for a campaign they manage
// EVEN WITHOUT a roster row (the ordering trap: assertHouseholdAccess's roster check would have
// 403'd them first); (3) a lead is refused elsewhere; (4) cross-org is 404, not 403; (5) the web
// endpoint agrees. Plus the first coverage `updateHouseholdLocation` has ever had: building-scope
// fan-out and the state-bounds guardrail.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-pin-role';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { HouseholdLocationChange } = await import('../src/models/HouseholdLocationChange.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

// The exact strings mobile/lib/api.js coerces into code:'ORG_CONTEXT'. The pin refusal must not
// collide with them, or the app would route a role problem into org-context recovery.
const ORG_CONTEXT_ERRORS = new Set([
  'Active organization required (X-Org-Id header)',
  'Organization not found',
  'Not a member of this organization',
  'Invalid X-Org-Id',
]);

let server;
let base;
const ctx = {};

const PIN = { lng: -84.5, lat: 38.0 }; // Kentucky, so inStateBounds passes for state 'KY'
const NUDGE = { lat: PIN.lat + 0.0002, lng: PIN.lng };

function hh(orgId, campaignId, effortId, n, pin, state = 'KY') {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Pin Way`,
    city: 'Town',
    state,
    zipCode: '40202',
    normalizedAddress: `${n} PIN WAY|TOWN|${state}|40202`,
    location: { type: 'Point', coordinates: [pin.lng, pin.lat] },
    isActive: true,
    status: 'unknocked',
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, CampaignManager,
    Effort, Pass, Turf, TurfAssignment, Household, HouseholdLocationChange, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Pin Org', slug: 'pin-org', isActive: true });
  const other = await Organization.create({ name: 'Other Org', slug: 'other-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  await Subscription.create({ organizationId: other._id, status: 'internal' });

  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'pa@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'pl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Walker', email: 'pc@t.co', passwordHash: 'x', isActive: true });
  const supe = await User.create({ firstName: 'Sue', lastName: 'Super', email: 'ps@t.co', passwordHash: 'x', isActive: true, isSuperAdmin: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });

  // A = the lead's managed campaign, B = one they don't manage.
  const A = await Campaign.create({ organizationId: org._id, name: 'Campaign A', type: 'survey', state: 'KY', isActive: true });
  const B = await Campaign.create({ organizationId: org._id, name: 'Campaign B', type: 'survey', state: 'KY', isActive: true });
  await CampaignManager.create({ campaignId: A._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });
  // The canvasser is rostered on A and holds the book containing every A door — so the ONLY thing
  // refusing them below is the role gate, not scope.
  await CampaignAssignment.create({ organizationId: org._id, campaignId: A._id, userId: canv._id });
  // The lead is deliberately NOT rostered onto A: managing it is the whole authority.

  const effortA = await Effort.create({ organizationId: org._id, campaignId: A._id, name: 'A' });
  const effortB = await Effort.create({ organizationId: org._id, campaignId: B._id, name: 'B' });
  const passA = await Pass.create({ organizationId: org._id, campaignId: A._id, effortId: effortA._id, roundNumber: 1, name: 'R1', status: 'active' });

  // Doors 1-5 on A (one per mutating test, since each asserts on its own pin), 6 on B.
  // Doors 4 and 5 deliberately SHARE a coordinate — the building-scope fan-out case.
  const homes = await Household.insertMany([
    hh(org._id, A._id, effortA._id, 1, PIN),
    hh(org._id, A._id, effortA._id, 2, PIN),
    hh(org._id, A._id, effortA._id, 3, PIN),
    hh(org._id, A._id, effortA._id, 4, PIN),
    hh(org._id, A._id, effortA._id, 5, PIN),
    hh(org._id, B._id, effortB._id, 6, PIN),
  ]);
  const foreign = await Household.create(hh(other._id, A._id, effortA._id, 9, PIN));

  const turf = await Turf.create({
    organizationId: org._id, campaignId: A._id, passId: passA._id, name: 'Book A', mode: 'geometric',
    status: 'published', householdIds: homes.slice(0, 5).map((h) => h._id), doorCount: 5,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: A._id, passId: passA._id, turfId: turf._id, userId: canv._id });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, other, A, B, admin, lead, canv, supe, foreign,
    d1: homes[0], d2: homes[1], d3: homes[2], d4: homes[3], d5: homes[4], dB: homes[5],
    adminTok: signUserToken(admin),
    leadTok: signUserToken(lead),
    canvTok: signUserToken(canv),
    supeTok: signUserToken(supe),
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
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const movePin = (householdId, token, orgId, extra = {}) =>
  call('POST', `/mobile/households/${householdId}/location`, {
    token,
    orgId,
    body: { ...NUDGE, source: 'drag', accuracy: 5, ...extra },
  });

test('a canvasser is refused — even for a door in the book they are actively working', { skip }, async () => {
  const res = await movePin(ctx.d1._id, ctx.canvTok, ctx.org._id);
  assert.strictEqual(res.status, 403, JSON.stringify(res.json));
  assert.strictEqual(res.json.code, 'FORBIDDEN_ROLE');
  // Copy is shown verbatim in the app's alert, so it has to be actionable, not "Forbidden".
  assert.match(res.json.error, /team leads and admins/i);
  assert.ok(
    !ORG_CONTEXT_ERRORS.has(res.json.error),
    'must not collide with the strings mobile/lib/api.js coerces into ORG_CONTEXT'
  );
  const after = await Household.findById(ctx.d1._id).lean();
  assert.strictEqual(after.coordSource ?? null, null, 'nothing moved');
  assert.strictEqual(await HouseholdLocationChange.countDocuments({ householdId: ctx.d1._id }), 0);
});

test('a lead who MANAGES the campaign is admitted — with no roster row at all', { skip }, async () => {
  // The ordering trap: assertHouseholdAccess's CampaignAssignment check would refuse this lead
  // before the role gate ever ran, with the wrong reason and a policy the web path doesn't have.
  assert.strictEqual(
    await CampaignAssignment.countDocuments({ campaignId: ctx.A._id, userId: ctx.lead._id }),
    0,
    'fixture guard: the lead must NOT be rostered for this test to mean anything'
  );
  const res = await movePin(ctx.d2._id, ctx.leadTok, ctx.org._id);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));

  const after = await Household.findById(ctx.d2._id).lean();
  assert.strictEqual(after.coordSource, 'corrected');
  assert.strictEqual(String(after.correctedBy), String(ctx.lead._id));
  assert.ok(after.correctedAt, 'correctedAt is stamped — the far downgrade keys off it');
  assert.ok(after.previousLocation, 'the pre-correction point is kept');
  const log = await HouseholdLocationChange.find({ householdId: ctx.d2._id }).lean();
  assert.strictEqual(log.length, 1, 'exactly one audit row per move');
  assert.strictEqual(String(log[0].userId), String(ctx.lead._id));
});

test('a lead is refused on a campaign they do NOT manage', { skip }, async () => {
  const res = await movePin(ctx.dB._id, ctx.leadTok, ctx.org._id);
  assert.strictEqual(res.status, 403, JSON.stringify(res.json));
  assert.strictEqual(res.json.code, 'FORBIDDEN_ROLE');
});

test('an org admin is admitted, on any campaign', { skip }, async () => {
  const res = await movePin(ctx.d3._id, ctx.adminTok, ctx.org._id);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const after = await Household.findById(ctx.d3._id).lean();
  assert.strictEqual(String(after.correctedBy), String(ctx.admin._id));
});

test('a super admin does NOT bypass the support-grant model to move a pin', { skip }, async () => {
  // Widening the pin gate to leads/admins must not accidentally hand staff a way into a customer
  // org: orgContext still demands a time-limited SupportAccessGrant first. canManageCampaign
  // would happily return true for a super — it never gets the chance.
  const res = await movePin(ctx.dB._id, ctx.supeTok, ctx.org._id);
  assert.strictEqual(res.status, 403, JSON.stringify(res.json));
  assert.strictEqual(res.json.code, 'SUPPORT_ACCESS_REQUIRED');
  const after = await Household.findById(ctx.dB._id).lean();
  assert.strictEqual(after.coordSource ?? null, null, 'nothing moved');
});

test('a household in another org is 404, not 403 — existence never leaks', { skip }, async () => {
  const res = await movePin(ctx.foreign._id, ctx.adminTok, ctx.org._id);
  assert.strictEqual(res.status, 404, JSON.stringify(res.json));
});

test('the WEB pin endpoint applies the identical policy', { skip }, async () => {
  const path = `/admin/campaigns/${ctx.A._id}/households/${ctx.d1._id}/location`;
  const asCanv = await call('PATCH', path, { token: ctx.canvTok, orgId: ctx.org._id, body: NUDGE });
  assert.strictEqual(asCanv.status, 403, 'same refusal on the web path');

  const asLead = await call('PATCH', path, { token: ctx.leadTok, orgId: ctx.org._id, body: NUDGE });
  assert.strictEqual(asLead.status, 200, JSON.stringify(asLead.json));
});

test('scope:building moves every unit sharing the pin, each with its own audit row', { skip }, async () => {
  // d4 and d5 were seeded on the same coordinate.
  const res = await movePin(ctx.d4._id, ctx.adminTok, ctx.org._id, { scope: 'building' });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.ok(res.json.moved >= 2, `expected the sibling to move too, got ${res.json.moved}`);

  const sibling = await Household.findById(ctx.d5._id).lean();
  assert.strictEqual(sibling.coordSource, 'corrected', 'the co-located unit moved as well');
  assert.strictEqual(await HouseholdLocationChange.countDocuments({ householdId: ctx.d5._id }), 1);
});

test('a drag outside the door\'s state is refused by the bounds guardrail', { skip }, async () => {
  const res = await call('POST', `/mobile/households/${ctx.d3._id}/location`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { lat: 47.6, lng: -122.3, source: 'drag' }, // Seattle, on a KY door
  });
  assert.strictEqual(res.status, 400, JSON.stringify(res.json));
  assert.strictEqual(res.json.code, 'out_of_bounds');
});
