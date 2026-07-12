import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Removing a canvasser from a CAMPAIGN, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/camprem node --test test/campaignRemoval.int.test.js
//
// The bug this locks down: DELETE /admin/campaigns/:id/assignments/:userId used to drop the
// CampaignAssignment ONLY, leaving the removed person still holding every book (TurfAssignment)
// and effort-crew row on that campaign — so their books stayed assigned to somebody off the
// roster, those doors never resurfaced as unassigned, and readiness still counted them as crew.
//
// The load-bearing assertions protect the BUSINESS, not just the stores:
//   · the knock ledger survives untouched, so campaign counts and the invoice cannot move;
//   · the release is scoped to ONE campaign — books in a sibling campaign are not collateral;
//   · books are many-to-many, so a co-assigned canvasser keeps theirs;
//   · a lead's CampaignManager grant is NOT revoked from a walker-roster button;
//   · an org-level coordinator link is not severed by a campaign-scoped removal;
//   · remove-from-ORG still cascades fully (regression guard on the shared helper).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-campaign-removal';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { EffortMember } = await import('../src/models/EffortMember.js');
const { Turf } = await import('../src/models/Turf.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Effort } = await import('../src/models/Effort.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const PW = 'Str0ng!Passw0rd';
let server;
let base;
const ctx = {};

async function makeUser(first) {
  return User.create({
    firstName: first,
    lastName: 'X',
    email: `${first.toLowerCase()}@t.co`,
    passwordHash: await User.hashPassword(PW),
    isActive: true,
  });
}

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

// One campaign with a book, an effort crew row, and a walked door. Returns the pieces the
// assertions need. `extraPassStatus` seeds a SECOND, archived round so we can prove the
// release is not silently limited to active rounds.
async function seedCampaign(org, name, { walkers, archivedRoundFor = null }) {
  const campaign = await Campaign.create({
    organizationId: org._id, name, type: 'lit_drop', state: 'FL', isActive: true,
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

  for (const u of walkers) {
    await CampaignAssignment.create({
      organizationId: org._id, campaignId: campaign._id, userId: u._id,
    });
    // Books are many-to-many: every walker gets their OWN row on the SAME turf.
    await TurfAssignment.create({
      organizationId: org._id, campaignId: campaign._id, passId: pass._id,
      turfId: turf._id, userId: u._id,
    });
    await EffortMember.create({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id, userId: u._id,
    });
    // The knock ledger — this is what the invoice is computed from.
    await CanvassActivity.create({
      organizationId: org._id, campaignId: campaign._id, passId: pass._id,
      effortId: effort._id, turfId: turf._id, householdId: home._id, userId: u._id,
      actionType: 'lit_dropped', timestamp: new Date(),
      location: { lat: 28.3, lng: -81.4 },
    });
  }

  // A finished round the user also held a book on. Readiness rollups count assignments on
  // passes of ANY status, so leaving this behind would keep the campaign reading as "staffed".
  if (archivedRoundFor) {
    const oldPass = await Pass.create({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
      roundNumber: 0, name: 'Round 0', status: 'archived',
    });
    const oldTurf = await Turf.create({
      organizationId: org._id, campaignId: campaign._id, passId: oldPass._id, name: 'Book 0',
      mode: 'geometric', status: 'published', householdIds: [home._id], doorCount: 1,
    });
    await TurfAssignment.create({
      organizationId: org._id, campaignId: campaign._id, passId: oldPass._id,
      turfId: oldTurf._id, userId: archivedRoundFor._id,
    });
  }

  return { campaign, effort, pass, turf, home };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Subscription, Campaign, CanvassActivity,
    CampaignAssignment, CampaignManager, TurfAssignment, EffortMember, Turf, Pass,
    Household, Effort,
  ]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Acme', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const boss = await makeUser('Boss');       // org admin, does the removing
  const quitter = await makeUser('Quitter'); // knocked, then left  <-- the user under test
  const stayer = await makeUser('Stayer');   // co-assigned to the SAME book, must keep it
  const rookie = await makeUser('Rookie');   // quitter's coordinatee (org-level link)

  await Membership.create({ userId: boss._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: quitter._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: stayer._id, organizationId: org._id, role: 'canvasser', isActive: true });
  // Quitter supervises Rookie at the ORG level. A campaign-scoped removal must not sever this.
  await Membership.create({
    userId: rookie._id, organizationId: org._id, role: 'canvasser', isActive: true,
    coordinatorId: quitter._id,
  });

  // Campaign A — the one Quitter is removed from. Both walkers share Book 1.
  const A = await seedCampaign(org, 'Alpha', { walkers: [quitter, stayer], archivedRoundFor: quitter });
  // Campaign B — same org, Quitter is NOT removed from it. Must be untouched collateral.
  const B = await seedCampaign(org, 'Bravo', { walkers: [quitter] });

  // Quitter also holds a lead grant on campaign A. A walker-roster removal must NOT revoke it.
  await CampaignManager.create({
    organizationId: org._id, campaignId: A.campaign._id, userId: quitter._id,
  });

  Object.assign(ctx, { org, boss, quitter, stayer, rookie, A, B });

  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.bossToken = signUserToken(boss);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('removing a canvasser from a campaign releases their books IN THAT CAMPAIGN', { skip }, async () => {
  const { org, boss, quitter, A } = ctx;

  const before = await TurfAssignment.countDocuments({ userId: quitter._id, campaignId: A.campaign._id });
  assert.equal(before, 2, 'seeded: a book on the active round AND one on the archived round');

  const res = await call('DELETE', `/admin/campaigns/${A.campaign._id}/assignments/${quitter._id}`, {
    token: ctx.bossToken, orgId: org._id,
  });
  assert.equal(res.status, 200);
  // The handler reports what it handed back, so the UI can say "this releases N books".
  assert.equal(res.json.released.turfAssignments, 2, 'both rounds released, not just the active one');
  assert.equal(res.json.released.effortMemberships, 1);
  assert.equal(res.json.released.campaignAssignments, 1);

  assert.equal(
    await TurfAssignment.countDocuments({ userId: quitter._id, campaignId: A.campaign._id }), 0,
    'no book in campaign A is still held by the removed user — including the archived round'
  );
  assert.equal(
    await EffortMember.countDocuments({ userId: quitter._id, campaignId: A.campaign._id }), 0,
    'and they are off the effort crew, so readiness stops counting them'
  );
  assert.equal(
    await CampaignAssignment.countDocuments({ userId: quitter._id, campaignId: A.campaign._id }), 0
  );
});

test('a co-assigned canvasser KEEPS the shared book', { skip }, async () => {
  const { stayer, A } = ctx;
  // Books are many-to-many (unique index {turfId,userId}); releasing one walker must not
  // disturb another's row on the same turf. This is the whole point of the per-user model.
  assert.equal(
    await TurfAssignment.countDocuments({ userId: stayer._id, turfId: A.turf._id }), 1,
    'Stayer still holds Book 1 after Quitter was released from it'
  );
  assert.equal(await EffortMember.countDocuments({ userId: stayer._id, campaignId: A.campaign._id }), 1);
  assert.equal(await CampaignAssignment.countDocuments({ userId: stayer._id, campaignId: A.campaign._id }), 1);
});

test('a sibling campaign is NOT collateral damage', { skip }, async () => {
  const { quitter, B } = ctx;
  // releaseAssignedWork's ORG scope would have wiped these too. Campaign scope must not.
  assert.equal(
    await TurfAssignment.countDocuments({ userId: quitter._id, campaignId: B.campaign._id }), 1,
    'Quitter still holds their book in campaign Bravo'
  );
  assert.equal(await EffortMember.countDocuments({ userId: quitter._id, campaignId: B.campaign._id }), 1);
  assert.equal(await CampaignAssignment.countDocuments({ userId: quitter._id, campaignId: B.campaign._id }), 1);
});

test('the knock ledger is untouched — counts and the invoice cannot move', { skip }, async () => {
  const { quitter, A, B } = ctx;
  // THE reason this whole feature exists. A knock is a historical fact; releasing the work a
  // person was holding must never rewrite what they already did.
  assert.equal(
    await CanvassActivity.countDocuments({ userId: quitter._id, campaignId: A.campaign._id }), 1,
    'their knock in the campaign they were REMOVED from still counts'
  );
  assert.equal(await CanvassActivity.countDocuments({ userId: quitter._id, campaignId: B.campaign._id }), 1);
  assert.equal(
    await CanvassActivity.countDocuments({ userId: quitter._id }), 2,
    'every knock they ever recorded survives'
  );
});

test('a lead grant is NOT revoked by a walker-roster removal', { skip }, async () => {
  const { quitter, A } = ctx;
  // This route is mounted behind requireCampaignManager, which passes for ANY lead holding a
  // grant on the campaign — cascading to CampaignManager would let one lead revoke another's
  // grant (or their own) from this button. Revoking stays admin-only, on the Users page.
  assert.equal(
    await CampaignManager.countDocuments({ userId: quitter._id, campaignId: A.campaign._id }), 1,
    'the CampaignManager grant survives'
  );
});

test('an org-level coordinator link is NOT severed by a campaign removal', { skip }, async () => {
  const { quitter, rookie } = ctx;
  // Membership has no campaignId, so the coordinator reset is inherently org-level and must be
  // skipped in campaign scope — clearing it would break a supervision link that has nothing to
  // do with this campaign.
  const m = await Membership.findOne({ userId: rookie._id }).lean();
  assert.equal(String(m.coordinatorId), String(quitter._id), 'Rookie is still coordinated by Quitter');
});

test('remove-from-ORG still cascades everything (regression on the shared helper)', { skip }, async () => {
  const { org, quitter } = ctx;
  // The signature grew a campaignId option; the two pre-existing callers must be unchanged.
  const res = await call('DELETE', `/admin/memberships/${quitter._id}`, {
    token: ctx.bossToken, orgId: org._id,
  });
  assert.equal(res.status, 200);

  assert.equal(await Membership.countDocuments({ userId: quitter._id, organizationId: org._id }), 0);
  assert.equal(await TurfAssignment.countDocuments({ userId: quitter._id }), 0, 'campaign B books released too');
  assert.equal(await EffortMember.countDocuments({ userId: quitter._id }), 0);
  assert.equal(await CampaignAssignment.countDocuments({ userId: quitter._id }), 0);
  assert.equal(await CampaignManager.countDocuments({ userId: quitter._id }), 0, 'org removal DOES revoke grants');

  const rookie = await Membership.findOne({ userId: ctx.rookie._id }).lean();
  assert.equal(rookie.coordinatorId, null, 'org removal DOES clear the coordinator link');

  assert.equal(
    await CanvassActivity.countDocuments({ userId: quitter._id }), 2,
    'and even a full org removal never touches the knock ledger'
  );
});
