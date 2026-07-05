import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The one chokepoint that gates who can be assigned a book (turfAssignments, assign-bulk,
// efforts all call it): partitionAssignable must return only people who are BOTH on the
// campaign (roster or org admin) AND currently activated. A since-deactivated roster member
// must be rejected. Exercised against a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/partition node --test test/partitionAssignable.int.test.js

const { partitionAssignable } = await import('../src/services/campaignRoster.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Assign Org', slug: 'assign-org', isActive: true });
  const campaign = await Campaign.create({ organizationId: org._id, name: 'C', type: 'survey', state: 'KY', isActive: true });

  // helper to make a user + org membership
  async function make({ first, userActive = true, memberActive = true, role = 'canvasser', onRoster = false, superAdmin = false }) {
    const u = await User.create({
      firstName: first, lastName: 'X', email: `${first.toLowerCase()}@a.co`, passwordHash: 'x',
      isActive: userActive, isSuperAdmin: superAdmin,
    });
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: memberActive });
    if (onRoster) {
      await CampaignAssignment.create({ campaignId: campaign._id, userId: u._id, organizationId: org._id });
    }
    return u;
  }

  const activeRoster = await make({ first: 'ActiveRoster', onRoster: true });
  const deactivatedUserRoster = await make({ first: 'DeadUser', onRoster: true, userActive: false });
  const deactivatedMemberRoster = await make({ first: 'DeadMember', onRoster: true, memberActive: false });
  const notOnRoster = await make({ first: 'NotRostered', onRoster: false });
  const adminOffRoster = await make({ first: 'AdminOff', role: 'admin', onRoster: false });
  const adminDeactivated = await make({ first: 'AdminDead', role: 'admin', onRoster: false, userActive: false });
  const superOffRoster = await make({ first: 'Super', role: 'canvasser', onRoster: false, superAdmin: true });

  Object.assign(ctx, {
    campaign, org,
    ids: Object.fromEntries(
      Object.entries({
        activeRoster, deactivatedUserRoster, deactivatedMemberRoster,
        notOnRoster, adminOffRoster, adminDeactivated, superOffRoster,
      }).map(([k, u]) => [k, String(u._id)])
    ),
  });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

async function partition(idKeys) {
  const userIds = idKeys.map((k) => ctx.ids[k]);
  const { allowed, notOnTeam } = await partitionAssignable({
    campaignId: ctx.campaign._id,
    organizationId: ctx.org._id,
    userIds,
  });
  return { allowed: new Set(allowed), notOnTeam: new Set(notOnTeam) };
}

test('active roster member is allowed; deactivated (user OR membership) roster members are rejected', { skip }, async () => {
  const { ids } = ctx;
  const { allowed, notOnTeam } = await partition(['activeRoster', 'deactivatedUserRoster', 'deactivatedMemberRoster']);
  assert.ok(allowed.has(ids.activeRoster), 'active roster canvasser must be allowed');
  assert.ok(notOnTeam.has(ids.deactivatedUserRoster), 'deactivated USER on roster must be rejected');
  assert.ok(notOnTeam.has(ids.deactivatedMemberRoster), 'deactivated MEMBERSHIP on roster must be rejected');
});

test('a canvasser not on the campaign roster is rejected', { skip }, async () => {
  const { ids } = ctx;
  const { notOnTeam } = await partition(['notOnRoster']);
  assert.ok(notOnTeam.has(ids.notOnRoster), 'non-roster canvasser must be rejected');
});

test('active org admin may be assigned on the fly; a deactivated admin may not', { skip }, async () => {
  const { ids } = ctx;
  const { allowed, notOnTeam } = await partition(['adminOffRoster', 'adminDeactivated']);
  assert.ok(allowed.has(ids.adminOffRoster), 'active org admin (self-assign) must be allowed');
  assert.ok(notOnTeam.has(ids.adminDeactivated), 'deactivated admin must be rejected');
});

test('superadmin is always allowed (oversight)', { skip }, async () => {
  const { ids } = ctx;
  const { allowed } = await partition(['superOffRoster']);
  assert.ok(allowed.has(ids.superOffRoster), 'superadmin must be allowed even off-roster');
});
