import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// THE ANCHOR TEST for org-scoped identity.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/orgiso node --test test/orgIsolation.int.test.js
//
// One organization must never be able to write into another's data. That sounds obvious; it was not
// true. `Person` was a GLOBAL record — one per real human, shared by every customer that had imported
// them — and propagateIdentity fanned the 10 identity fields into EVERY Voter row in EVERY org linked
// to that Person. The trigger was not platform staff: `PATCH /admin/voters/:id` is gated on
// requireOrgRole('admin'), so a CUSTOMER's own admin correcting a phone number rewrote that field in a
// DIFFERENT customer's database. So did a CSV import.
//
// That made us a controller of a cross-customer identity graph, when our entire legal posture — and
// our privacy policy's "it is not shared with other customer organizations" — depends on being a
// processor holding each customer's data separately.
//
// The first test below is the done-criteria for the fix. It FAILED before it: Org B's phone came back
// as Org A's new value.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-org-isolation';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { Person } = await import('../src/models/Person.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { resolvePerson } = await import('../src/services/person/resolvePerson.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

// The SAME real human, in both orgs' voter files — same state voter ID. This is the ordinary case
// (two firms buy the same state file), not an exotic one.
const SVID = 'FL-8675309';
const STATE = 'FL';

let server;
let base;
const ctx = {};

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
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function seedOrg(name, slug, phone, party) {
  const org = await Organization.create({ name, slug, isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const admin = await User.create({
    firstName: name, lastName: 'Admin', email: `${slug}@t.co`,
    passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  const camp = await Campaign.create({
    organizationId: org._id, name: `${name} Campaign`, type: 'survey', state: STATE, isActive: true,
  });
  const hh = await Household.create({
    organizationId: org._id, campaignId: camp._id,
    addressLine1: '412 Elm St', city: 'Town', state: STATE, zipCode: '34741',
    normalizedAddress: `412 ELM ST|TOWN|${STATE}|34741|${slug}`,
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
  });

  // Resolve through the REAL matching engine — the thing that used to link two orgs to one Person.
  const { person } = await resolvePerson(
    { registeredState: STATE, stateVoterId: SVID },
    { firstName: 'Vi', lastName: 'Voter', phone, party },
    { orgId: org._id, source: 'import' }
  );

  // Ownership is LOAD-BEARING for this test, and getting it wrong made the anchor pass for the wrong
  // reason. routes/admin/voters.js only calls propagateIdentity when the editing org OWNS the Person
  // (`identityOwnerOrgId`); a non-owner files a review proposal instead. Without an owner, the
  // propagation path is never taken and "Org B is unchanged" is true trivially — the test would go
  // green against the broken code.
  //
  // So mimic a real first import: the org that creates a Person provisionally owns it, and a later
  // org matching an existing Person does NOT seize ownership. Under the fix, each org owns its own
  // Person and propagation stays home. Under the bug, both orgs share ONE Person owned by whoever
  // imported first — and that owner's edit reaches into the other's database.
  await Person.updateOne(
    { _id: person._id, identityOwnerOrgId: null },
    { $set: { identityOwnerOrgId: org._id, ownerProvisional: true } }
  );
  const owned = await Person.findById(person._id).lean();

  const voter = await Voter.create({
    organizationId: org._id, householdId: hh._id,
    stateVoterId: SVID, registeredState: STATE,
    firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter',
    phone, party, gender: 'F',
    personId: person._id,
  });

  return { org, admin: { token: signUserToken(admin), orgId: org._id }, voter, person: owned, camp };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Household, Voter, Person, Subscription]) {
    await M.deleteMany({});
  }
  // Mongoose only builds indexes lazily; the org-scoped unique index must exist or this test would
  // pass for the wrong reason (no index = no dedup = no sharing).
  await Person.syncIndexes();

  const A = await seedOrg('Alpha Consulting', 'alpha', '555-0001', 'DEM');
  const B = await seedOrg('Beta Field Group', 'beta', '555-0002', 'REP');
  Object.assign(ctx, { A, B });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('ANCHOR: Org A edits a voter phone — Org B\'s row is unchanged', { skip }, async () => {
  const before = await Voter.findById(ctx.B.voter._id).lean();
  assert.strictEqual(before.phone, '555-0002', 'Org B starts with its own value');

  // Org A's admin corrects the phone through the real route. This is the exact call that used to
  // reach into Org B's database.
  const res = await call('PATCH', `/admin/voters/${ctx.A.voter._id}`, {
    ...ctx.A.admin,
    body: { phone: '555-9999', party: 'IND' },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));

  const a = await Voter.findById(ctx.A.voter._id).lean();
  assert.strictEqual(a.phone, '555-9999', 'Org A sees its own edit');

  const b = await Voter.findById(ctx.B.voter._id).lean();
  assert.strictEqual(b.phone, '555-0002', '*** Org B\'s phone MUST be untouched ***');
  assert.strictEqual(b.party, 'REP', '*** Org B\'s party MUST be untouched ***');
});

test('the two orgs hold SEPARATE Person records for the same human', { skip }, async () => {
  // Same state voter ID, same person in real life — but one Person document per org. This is what
  // makes the fan-out incapable of crossing a boundary: there is no shared record to fan from.
  assert.notStrictEqual(
    String(ctx.A.person._id), String(ctx.B.person._id),
    'the same human in two orgs must resolve to two DIFFERENT Person records'
  );
  assert.strictEqual(String(ctx.A.person.organizationId), String(ctx.A.org._id));
  assert.strictEqual(String(ctx.B.person.organizationId), String(ctx.B.org._id));

  const shared = await Voter.aggregate([
    { $match: { personId: { $ne: null } } },
    { $group: { _id: '$personId', orgs: { $addToSet: '$organizationId' } } },
    { $project: { n: { $size: '$orgs' } } },
    { $match: { n: { $gte: 2 } } },
  ]);
  assert.strictEqual(shared.length, 0, 'no Person may be linked from two organizations');
});

test('dedup still works INSIDE an org', { skip }, async () => {
  // Scoping must not have broken the thing the Person layer is for: the same human appearing twice
  // in one org's file resolves to one Person.
  const again = await resolvePerson(
    { registeredState: STATE, stateVoterId: SVID },
    { firstName: 'Vi', lastName: 'Voter' },
    { orgId: ctx.A.org._id, source: 'import' }
  );
  assert.strictEqual(
    String(again.person._id), String(ctx.A.person._id),
    'a second row for the same human in the same org reuses that org\'s Person'
  );
  assert.strictEqual(again.matched, true);
});

test('resolvePerson refuses to run without an org', { skip }, async () => {
  // A missing orgId used to be harmless (Persons were global). Now it would create an org-less
  // record, so it must fail loudly at the call site rather than write a broken row.
  await assert.rejects(
    () => resolvePerson({ registeredState: STATE, stateVoterId: 'FL-999' }, {}, { source: 'import' }),
    /orgId is required/
  );
});

test('the voter page never names another organization', { skip }, async () => {
  // It used to render "This person's identity is managed by {Other Customer Ltd}" — disclosing one
  // customer's name to another.
  const res = await call('GET', `/admin/voters/${ctx.B.voter._id}`, ctx.B.admin);
  assert.strictEqual(res.status, 200);
  const blob = JSON.stringify(res.json);
  assert.ok(!blob.includes('ownerOrgName'), 'no ownerOrgName field may be returned');
  assert.ok(!blob.includes('Alpha Consulting'), 'the OTHER org\'s name must not appear anywhere in the payload');
});
