import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The mobile app must NEVER receive a voter's date of birth.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/voterpriv node --test test/voterPrivacy.int.test.js
//
// Why this test exists: the app caches a canvasser's whole book in AsyncStorage so the doors keep
// working in a dead zone. For a long time that cache included every voter's full `dateOfBirth` — the
// most identity-theft-useful field in a voter file — sitting on the phone of every volunteer with the
// app installed. The only thing the app ever did with it was derive an integer age for the
// "Party · Age · Gender" line at a door.
//
// So the server now derives the age and drops the date (see toWireVoter in routes/mobile/bootstrap.js).
// This test guards BOTH paths that ship voters to a phone — the bootstrap and the /changes delta —
// because a well-meaning "just add the field back to the projection" would silently undo it and
// nothing else would fail.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-voter-privacy';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
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
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const DOB = '1978-04-02T00:00:00.000Z';

let server;
let base;
const ctx = {};

async function call(method, path, { token, orgId } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass,
    Turf, TurfAssignment, Household, Voter, SurveyTemplate, Subscription,
  ]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Acme', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'ada@t.co',
    passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true,
  });
  const canv = await User.create({
    firstName: 'Cara', lastName: 'Canvasser', email: 'cara@t.co',
    passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });

  // Voters only reach the phone on a SURVEY campaign, so this has to be one.
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Doors', isActive: true, questions: [],
  });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Fall', type: 'survey', state: 'FL',
    isActive: true, surveyTemplateId: template._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });

  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'active',
  });
  const hh = await Household.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id,
    addressLine1: '1 Elm St', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '1 ELM ST|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] },
    isActive: true,
  });
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book 1',
    mode: 'geometric', status: 'published', householdIds: [hh._id], doorCount: 1,
  });
  await TurfAssignment.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id,
    turfId: turf._id, userId: canv._id,
  });

  await Voter.create({
    organizationId: org._id, householdId: hh._id, stateVoterId: 'FL-1',
    firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter',
    party: 'DEM', gender: 'F', dateOfBirth: new Date(DOB),
  });

  Object.assign(ctx, {
    org, camp, hh,
    canv: { token: signUserToken(canv), orgId: org._id },
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

test('the DOB is in the database (so the test below is proving something)', { skip }, async () => {
  const v = await Voter.findOne({ stateVoterId: 'FL-1' }).lean();
  assert.ok(v.dateOfBirth, 'the voter really does have a DOB stored server-side');
});

test('GET /mobile/bootstrap sends age, never dateOfBirth', { skip }, async () => {
  const r = await call('GET', `/mobile/bootstrap?campaignId=${ctx.camp._id}`, ctx.canv);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));

  const voters = r.json.voters || [];
  assert.strictEqual(voters.length, 1, 'the canvasser gets the voter at their assigned door');
  const v = voters[0];

  assert.ok(!('dateOfBirth' in v), 'dateOfBirth must NOT be on the wire — it would land in the phone cache');
  assert.strictEqual(v.age, 48, 'age is derived server-side for the Party · Age · Gender line');
  assert.strictEqual(v.party, 'DEM', 'the fields the door screen actually needs still arrive');
  assert.strictEqual(v.gender, 'F');

  // Belt and braces: nothing anywhere in the serialized payload looks like the DOB.
  assert.ok(
    !JSON.stringify(r.json).includes('1978-04-02'),
    'the raw date must not appear ANYWHERE in the bootstrap payload'
  );
});

test('GET /mobile/changes (the delta poll) sends age, never dateOfBirth', { skip }, async () => {
  // The delta re-sends voters whenever their household changes. It has its own projection, so it is
  // its own chance to leak — touch the door, then poll from before that.
  await Household.updateOne({ _id: ctx.hh._id }, { $set: { status: 'not_home' } });

  const since = new Date(Date.now() - 60_000).toISOString();
  const r = await call('GET', `/mobile/changes?campaignId=${ctx.camp._id}&since=${since}`, ctx.canv);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));

  const voters = r.json.voters || [];
  assert.ok(voters.length >= 1, 'the changed household re-sends its voters');
  for (const v of voters) {
    assert.ok(!('dateOfBirth' in v), 'dateOfBirth must NOT be on the wire in the delta either');
    assert.strictEqual(v.age, 48);
  }
  assert.ok(
    !JSON.stringify(r.json).includes('1978-04-02'),
    'the raw date must not appear ANYWHERE in the delta payload'
  );
});
