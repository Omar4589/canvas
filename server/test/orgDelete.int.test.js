import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Org hard-delete cascade, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/orgdel_test node --test test/orgDelete.int.test.js
// Asserts: slug confirmation is required; every org-scoped row dies; USER
// ACCOUNTS survive (decision, Jul 2026) while their memberships don't; a
// sibling org is untouched; orphaned Persons are purged while shared Persons
// survive with ownership released to null.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-org-delete';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { Person } = await import('../src/models/Person.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { PersonEditProposal } = await import('../src/models/PersonEditProposal.js');
const { ORG_SCOPED } = await import('../src/services/platform/deleteOrganization.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Household, Voter, Person, CanvassActivity, Subscription]) {
    await M.deleteMany({});
  }

  const doomed = await Organization.create({ name: 'Doomed Org', slug: 'doomed-org', isActive: true });
  const survivor = await Organization.create({ name: 'Survivor Org', slug: 'survivor-org', isActive: true });
  const superU = await User.create({ firstName: 'Sue', lastName: 'Super', email: 'su@t.co', passwordHash: 'x', isActive: true, isSuperAdmin: true });
  const onlyHere = await User.create({ firstName: 'Olive', lastName: 'Only', email: 'only@t.co', passwordHash: 'x', isActive: true });
  const shared = await User.create({ firstName: 'Sam', lastName: 'Shared', email: 'shared@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: onlyHere._id, organizationId: doomed._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: shared._id, organizationId: doomed._id, role: 'admin', isActive: true });
  await Membership.create({ userId: shared._id, organizationId: survivor._id, role: 'admin', isActive: true });

  const camp = await Campaign.create({ organizationId: doomed._id, name: 'C', type: 'survey', state: 'KY', isActive: true });
  const hh = await Household.create({
    organizationId: doomed._id,
    campaignId: camp._id,
    addressLine1: '9 Doom St',
    city: 'Town',
    state: 'KY',
    zipCode: '40009',
    normalizedAddress: '9 DOOM ST|TOWN|KY|40009',
    location: { type: 'Point', coordinates: [-84.5, 38.0] },
  });
  // Person only linked in the doomed org → should be purged.
  const orphanPerson = await Person.create({ identityOwnerOrgId: doomed._id });
  // Person shared with the survivor org, but OWNED by the doomed org → survives, ownership released.
  const sharedPerson = await Person.create({ identityOwnerOrgId: doomed._id });
  await Voter.create({
    organizationId: doomed._id,
    campaignId: camp._id,
    householdId: hh._id,
    stateVoterId: 'D1',
    firstName: 'A',
    lastName: 'B',
    fullName: 'A B',
    personId: orphanPerson._id,
  });
  await Voter.create({
    organizationId: doomed._id,
    campaignId: camp._id,
    householdId: hh._id,
    stateVoterId: 'D2',
    firstName: 'C',
    lastName: 'D',
    fullName: 'C D',
    personId: sharedPerson._id,
  });
  const survivorHh = await Household.create({
    organizationId: survivor._id,
    campaignId: camp._id, // cross-org campaign ref is fine for this fixture
    addressLine1: '1 Safe St',
    city: 'Town',
    state: 'KY',
    zipCode: '40010',
    normalizedAddress: '1 SAFE ST|TOWN|KY|40010',
    location: { type: 'Point', coordinates: [-84.4, 38.1] },
  });
  await Voter.create({
    organizationId: survivor._id,
    campaignId: camp._id,
    householdId: survivorHh._id,
    stateVoterId: 'S1',
    firstName: 'E',
    lastName: 'F',
    fullName: 'E F',
    personId: sharedPerson._id,
  });
  await CanvassActivity.create({
    organizationId: doomed._id,
    campaignId: camp._id,
    householdId: hh._id,
    userId: onlyHere._id,
    actionType: 'not_home',
    timestamp: new Date(),
    location: { lat: 38.0, lng: -84.5 },
  });
  await Subscription.create({ organizationId: doomed._id, status: 'active' });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { doomed, survivor, onlyHere, shared, orphanPerson, sharedPerson, superTok: signUserToken(superU) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

test('wrong or missing confirmSlug is refused', { skip }, async () => {
  const missing = await call('DELETE', `/super-admin/organizations/${ctx.doomed._id}`, { token: ctx.superTok, body: {} });
  assert.strictEqual(missing.status, 400);
  const wrong = await call('DELETE', `/super-admin/organizations/${ctx.doomed._id}`, {
    token: ctx.superTok,
    body: { confirmSlug: 'not-it' },
  });
  assert.strictEqual(wrong.status, 400);
  assert.strictEqual(wrong.json.code, 'confirm-slug-mismatch');
  assert.ok(await Organization.findById(ctx.doomed._id), 'org must still exist after refused attempts');
});

test('cascade delete: org-scoped rows die, users/survivor org/shared person live', { skip }, async () => {
  const r = await call('DELETE', `/super-admin/organizations/${ctx.doomed._id}`, {
    token: ctx.superTok,
    body: { confirmSlug: 'doomed-org' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.organization.slug, 'doomed-org');
  assert.strictEqual(r.json.personsPurged, 1);

  // Everything org-scoped is gone.
  assert.strictEqual(await Organization.countDocuments({ _id: ctx.doomed._id }), 0);
  for (const M of [Campaign, Household, Voter, CanvassActivity, Membership, Subscription]) {
    assert.strictEqual(await M.countDocuments({ organizationId: ctx.doomed._id }), 0, `${M.modelName} not fully deleted`);
  }

  // User accounts survive (decision) — only memberships die; the shared user's
  // other-org membership is untouched.
  assert.ok(await User.findById(ctx.onlyHere._id), 'single-org user account must survive');
  assert.ok(await User.findById(ctx.shared._id));
  assert.strictEqual(await Membership.countDocuments({ userId: ctx.shared._id, organizationId: ctx.survivor._id }), 1);

  // Person hygiene: orphan purged; shared person survives with ownership released.
  assert.strictEqual(await Person.countDocuments({ _id: ctx.orphanPerson._id }), 0);
  const sharedP = await Person.findById(ctx.sharedPerson._id).lean();
  assert.ok(sharedP, 'shared person must survive');
  assert.strictEqual(sharedP.identityOwnerOrgId, null, 'ownership must be released to null');

  // The survivor org is untouched.
  assert.strictEqual(await Voter.countDocuments({ organizationId: ctx.survivor._id }), 1);
  assert.ok(await Organization.findById(ctx.survivor._id));
});

// The confirm card enumerates "campaigns, doors, voters, canvass history,
// surveys, books, imports, reports, and share links" — prove the cascade is
// EXHAUSTIVE, not just those: seed a stub row in every org-scoped collection
// (raw inserts bypass validation), delete the org, then sweep EVERY collection
// in the database for anything still referencing it. This also catches a future
// model that gains organizationId without being added to ORG_SCOPED — the stub
// would survive and this test would fail.
test('exhaustive sweep: every org-scoped collection empties; no reference survives anywhere', { skip }, async () => {
  const org2 = await Organization.create({ name: 'Sweep Org', slug: 'sweep-org', isActive: true });
  for (const M of ORG_SCOPED) {
    await M.collection.insertOne({ organizationId: org2._id, sweepStub: true });
  }
  await PersonEditProposal.collection.insertOne({ orgId: org2._id, sweepStub: true });

  const r = await call('DELETE', `/super-admin/organizations/${org2._id}`, {
    token: ctx.superTok,
    body: { confirmSlug: 'sweep-org' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(Object.keys(r.json.counts).length >= ORG_SCOPED.length, true, 'every seeded collection must report a deletion');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  for (const c of collections) {
    const leftovers = await db
      .collection(c.name)
      .countDocuments({ $or: [{ organizationId: org2._id }, { orgId: org2._id }] });
    assert.strictEqual(leftovers, 0, `collection '${c.name}' still references the deleted org`);
  }
  assert.strictEqual(await Organization.countDocuments({ _id: org2._id }), 0);
});

test('org admins cannot delete orgs', { skip }, async () => {
  const adminTok = signUserToken(ctx.shared);
  const r = await call('DELETE', `/super-admin/organizations/${ctx.survivor._id}`, {
    token: adminTok,
    body: { confirmSlug: 'survivor-org' },
  });
  assert.strictEqual(r.status, 403);
  assert.ok(await Organization.findById(ctx.survivor._id));
});
