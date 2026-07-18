import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The /mobile/changes voter-identity union, over the REAL Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/mobile_identity_delta_test node --test test/mobileIdentityDelta.int.test.js
// A pure identity edit (admin PATCH, Person propagation) touches only the Voter doc —
// never its household — so the old household-only delta stranded it until a cold
// re-bootstrap. The route now ALSO emits voters whose OWN updatedAt moved. Proves: an
// admin PATCH surfaces the voter with the fresh field while households[] stays EMPTY;
// propagateIdentity's Voter.bulkWrite bumps updatedAt (both Person-linked siblings ride
// the delta); a voter OUTSIDE the canvasser's book scope edited in the same window never
// appears; and `since` after the edit returns an empty delta.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-identity-delta';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { propagateIdentity } = await import('../src/services/person/propagateIdentity.js');
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
const { Voter } = await import('../src/models/Voter.js');
const { Person } = await import('../src/models/Person.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

function hh(orgId, campaignId, effortId, n) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Delta Dr`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} DELTA DR|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
    isActive: true,
    status: 'unknocked',
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, Voter, Person, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Delta Org', slug: 'delta-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'da@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'dc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const camp = await Campaign.create({
    organizationId: org._id, name: 'Delta C', type: 'survey', state: 'FL', isActive: true,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active',
  });

  // H1..H3 are in the canvasser's book; hOut is the same campaign but UNASSIGNED turf —
  // its voter is the out-of-scope control.
  const [h1, h2, h3, hOut] = await Household.insertMany([1, 2, 3, 4].map((n) => hh(org._id, camp._id, effort._id, n)));
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book D', mode: 'geometric',
    status: 'published', householdIds: [h1._id, h2._id, h3._id], doorCount: 3,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  // vPlain has NO personId — the admin PATCH takes the direct-write branch. vSib1/vSib2
  // are two rows of ONE Person (a legit in-org dup registration), so a single
  // propagation must reach both via the fan-out bulkWrite.
  const person = await Person.create({
    organizationId: org._id, firstName: 'Pat', lastName: 'Shared', fullName: 'Pat Shared', party: 'I',
  });
  const vPlain = await Voter.create({
    organizationId: org._id, householdId: h1._id, stateVoterId: 'FLD1',
    firstName: 'Vera', lastName: 'Voter', fullName: 'Vera Voter', party: 'D',
  });
  const vSib1 = await Voter.create({
    organizationId: org._id, householdId: h2._id, stateVoterId: 'FLD2', personId: person._id,
    firstName: 'Pat', lastName: 'Shared', fullName: 'Pat Shared', party: 'I',
  });
  const vSib2 = await Voter.create({
    organizationId: org._id, householdId: h3._id, stateVoterId: 'FLD3', personId: person._id,
    firstName: 'Pat', lastName: 'Shared', fullName: 'Pat Shared', party: 'I',
  });
  const vOut = await Voter.create({
    organizationId: org._id, householdId: hOut._id, stateVoterId: 'FLD4',
    firstName: 'Oscar', lastName: 'Outside', fullName: 'Oscar Outside', party: 'R',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, effort, pass, turf, person,
    h1, h2, h3, hOut, vPlain, vSib1, vSib2, vOut,
    adminTok: signUserToken(admin), canvTok: signUserToken(canv),
  });
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

function changes(sinceIso) {
  return call('GET', `/api/mobile/changes?campaignId=${ctx.camp._id}&since=${encodeURIComponent(sinceIso)}`, {
    token: ctx.canvTok,
    orgId: ctx.org._id,
  });
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('an admin identity edit rides the delta: fresh voter, EMPTY households, out-of-scope never leaks', { skip }, async () => {
  const { adminTok, org, vPlain, vOut } = ctx;
  await tick();
  const since = new Date().toISOString();
  await tick();

  // In-scope edit (the voter the canvasser's book contains) + the same edit on a voter
  // whose household is NOT in their book — both in the same window.
  const ok = await call('PATCH', `/api/admin/voters/${vPlain._id}`, {
    token: adminTok, orgId: org._id, body: { party: 'R', phone: '(555) 867-5309' },
  });
  assert.strictEqual(ok.status, 200, 'admin PATCH in-scope voter');
  const okOut = await call('PATCH', `/api/admin/voters/${vOut._id}`, {
    token: adminTok, orgId: org._id, body: { party: 'G' },
  });
  assert.strictEqual(okOut.status, 200, 'admin PATCH out-of-scope voter');

  const r = await changes(since);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.households, [], 'a pure identity edit moves NO household');
  const ids = r.json.voters.map((v) => String(v._id));
  assert.ok(ids.includes(String(vPlain._id)), 'the edited in-scope voter is in the delta');
  assert.ok(!ids.includes(String(vOut._id)), 'the out-of-scope voter edited in the SAME window stays out');

  const wire = r.json.voters.find((v) => String(v._id) === String(vPlain._id));
  assert.strictEqual(wire.party, 'R', 'the delta carries the fresh party');
  assert.ok(!('dateOfBirth' in wire), 'wire shape unchanged: DOB never leaves the server');
  assert.ok(Array.isArray(r.json.activePassIds) && r.json.activePassIds.includes(String(ctx.pass._id)), 'response shape unchanged');
});

test('Person propagation (fan-out bulkWrite) bumps updatedAt — both sibling rows reach the delta', { skip }, async () => {
  const { org, camp, person, vSib1, vSib2, vPlain } = ctx;
  await tick();
  const since = new Date().toISOString();
  await tick();

  // The real chokepoint, invoked directly (the admin PATCH owner-path and the import
  // reconcile both end up here): canonical write + Voter.bulkWrite fan-out.
  await propagateIdentity(person._id, { party: 'L' }, { orgId: org._id, source: 'admin_edit', userId: null });

  // The bulkWrite must have bumped BOTH cache rows' updatedAt — that timestamp IS the
  // delta's membership test.
  const sib1 = await Voter.findById(vSib1._id, { updatedAt: 1, party: 1 }).lean();
  assert.ok(sib1.updatedAt > new Date(since), 'bulkWrite bumped the voter updatedAt');
  assert.strictEqual(sib1.party, 'L', 'the fan-out wrote the field');

  const r = await changes(since);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.households, [], 'propagation touches voters only');
  const byId = new Map(r.json.voters.map((v) => [String(v._id), v]));
  assert.strictEqual(byId.get(String(vSib1._id))?.party, 'L', 'sibling 1 rides the delta with the propagated party');
  assert.strictEqual(byId.get(String(vSib2._id))?.party, 'L', 'sibling 2 (same Person, other household) too');
  assert.ok(!byId.has(String(vPlain._id)), 'the PREVIOUS test\'s edit predates this window');
});

test('since after the edits → an empty delta', { skip }, async () => {
  await tick();
  const since = new Date().toISOString();
  const r = await changes(since);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.voters, [], 'no voter moved after `since`');
  assert.deepStrictEqual(r.json.households, [], 'no household either');
});
