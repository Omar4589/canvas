import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The one chokepoint that gates who can be assigned a book (turfAssignments, assign-bulk,
// efforts all call it): partitionAssignable must return only people who are BOTH on the
// campaign (roster or org admin) AND currently activated. A since-deactivated roster member
// must be rejected. Doorline staff skip that only in an internal org; in a customer org they
// are held to the same rule (PRIVACY_VERIFICATION item 36), and departedMemberIdSet, the
// snapshot-restore gate, agrees. Exercised against a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/partition node --test test/partitionAssignable.int.test.js

const { partitionAssignable, departedMemberIdSet } = await import('../src/services/campaignRoster.js');
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
  // Staff the customer made an admin: a real membership, so they are assignable as that admin.
  const superAdminMember = await make({ first: 'SuperAdm', role: 'admin', onRoster: false, superAdmin: true });
  // Staff with NO membership here: a customer org reaches them only through a support grant.
  const staff = (first, isActive) => User.create({
    firstName: first, lastName: 'X', email: `${first.toLowerCase()}@doorline.app`, passwordHash: 'x',
    isActive, isSuperAdmin: true,
  });
  const staffNoMember = await staff('Staff', true);
  const staffDisabled = await staff('StaffOff', false);

  // A Doorline-owned internal org, where orgContext seats staff as members without a row.
  const internalOrg = await Organization.create({ name: 'Demo', slug: 'assign-demo', isActive: true, isInternal: true });
  const internalCampaign = await Campaign.create({ organizationId: internalOrg._id, name: 'D', type: 'survey', state: 'KY', isActive: true });

  Object.assign(ctx, {
    campaign, org, internalOrg, internalCampaign,
    ids: Object.fromEntries(
      Object.entries({
        activeRoster, deactivatedUserRoster, deactivatedMemberRoster,
        notOnRoster, adminOffRoster, adminDeactivated, superOffRoster,
        superAdminMember, staffNoMember, staffDisabled,
      }).map(([k, u]) => [k, String(u._id)])
    ),
  });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

async function partition(idKeys, { internal = false } = {}) {
  const userIds = idKeys.map((k) => ctx.ids[k]);
  const { allowed, notOnTeam } = await partitionAssignable({
    campaignId: internal ? ctx.internalCampaign._id : ctx.campaign._id,
    organizationId: internal ? ctx.internalOrg._id : ctx.org._id,
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

test('in a customer org, Doorline staff are held to the member rule', { skip }, async () => {
  const { ids } = ctx;
  const { allowed, notOnTeam } = await partition(['staffNoMember', 'superOffRoster', 'superAdminMember']);
  assert.ok(notOnTeam.has(ids.staffNoMember), 'staff with no membership here must be refused, like any outsider');
  assert.ok(notOnTeam.has(ids.superOffRoster), 'staff holding a canvasser membership need the roster, like any canvasser');
  assert.ok(allowed.has(ids.superAdminMember), 'staff the customer made an admin are assignable as that admin');
});

test('in an internal org, live staff are assignable with no membership; a disabled staff account is not', { skip }, async () => {
  const { ids } = ctx;
  const { allowed, notOnTeam } = await partition(['staffNoMember', 'staffDisabled'], { internal: true });
  assert.ok(allowed.has(ids.staffNoMember), 'staff self-assign in an internal org must keep working');
  assert.ok(notOnTeam.has(ids.staffDisabled), 'a switched-off staff account must be refused even there');
});

test('departedMemberIdSet exempts staff only in an internal org', { skip }, async () => {
  const { ids, org, internalOrg } = ctx;
  const customer = await departedMemberIdSet(org._id, [ids.staffNoMember, ids.superAdminMember]);
  assert.ok(customer.has(ids.staffNoMember), 'customer org: staff with no membership count as gone, so a restore cannot hand their book back');
  assert.ok(!customer.has(ids.superAdminMember), 'customer org: staff with a live membership stay');
  const internal = await departedMemberIdSet(internalOrg._id, [ids.staffNoMember, ids.staffDisabled]);
  assert.ok(!internal.has(ids.staffNoMember), 'internal org: live staff stay with no membership');
  assert.ok(internal.has(ids.staffDisabled), 'internal org: a switched-off staff account counts as gone');
});
