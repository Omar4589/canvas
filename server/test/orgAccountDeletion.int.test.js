import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mongoose from 'mongoose';

// An org admin deleting a member's account (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md §H), over the REAL
// Express app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/orgdelete_test node --test test/orgAccountDeletion.int.test.js
//
//   · The deletion: the scrub, the membership off with billing cleared, work released (shared books
//     kept), the crew loses its coordinator, the ledger untouched, the name record (orgs, attribution).
//   · Unused accounts lose their row and their name; accounts older than the sign-in clock never do.
//   · Every refusal, every orgContext case for staff, the paused-org exceptions, the Remove rule.
//   · Forced interleavings: one deletion at a time per account, the round-4 finished-record race, two
//     admins deleting each other, writes landing after the gate.
//   · Crashes on either side of the gate, settled by the sweep; the purge's live-account guard.
//   · The email log: this account's own rows only, and the backfill's dry run and --apply.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-org-account-deletion';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { issuePasswordResetToken } = await import('../src/services/auth/passwordReset.js');
const del = await import('../src/services/users/deleteAccount.js');
const { purgeDeletedIdentities } = await import('../src/services/retention/purgeDeletedIdentities.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { EffortMember } = await import('../src/models/EffortMember.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { DeletedUserRecord } = await import('../src/models/DeletedUserRecord.js');
const { EmailLog } = await import('../src/models/EmailLog.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { RetentionRun } = await import('../src/models/RetentionRun.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let base;
const ctx = {};

let seq = 0;
const PASSWORD = 'Correct-Horse-9';
const mkUser = async (first, { createdAt = null, lastLoginAt = null, superAdmin = false, platformRole = null, deletionLocked = false, password = false } = {}) => {
  seq += 1;
  const u = await User.create({
    firstName: first,
    lastName: 'Test',
    email: `${first.toLowerCase()}${seq}@acme.test`,
    // A real hash only where a test signs in through the self door (bcrypt is slow).
    passwordHash: password ? await User.hashPassword(PASSWORD) : 'x',
    isActive: true,
    isSuperAdmin: superAdmin,
    ...(platformRole ? { platformRole } : {}),
    deletionLocked,
    lastLoginAt,
  });
  if (createdAt) await User.collection.updateOne({ _id: u._id }, { $set: { createdAt } });
  return u;
};
const member = (user, org, { role = 'canvasser', isActive = true, billingAccess = false } = {}) =>
  Membership.create({ userId: user._id, organizationId: org._id, role, isActive, billingAccess });
const tok = (u) => signUserToken(u);

// Raw ledger rows: these tests are about who owns the rows, not the write-side counters.
const knock = (user, org, campaign, extra = {}) =>
  CanvassActivity.collection.insertOne({
    organizationId: org._id, campaignId: campaign._id, householdId: new mongoose.Types.ObjectId(),
    userId: user._id, actionType: 'not_home', timestamp: new Date(), location: { lat: 28.3, lng: -81.4 },
    ...extra,
  });
const survey = (user, org, campaign) =>
  SurveyResponse.collection.insertOne({
    organizationId: org._id, campaignId: campaign._id, householdId: new mongoose.Types.ObjectId(),
    voterId: new mongoose.Types.ObjectId(), userId: user._id, answers: [], submittedAt: new Date(),
  });

const call = async (method, p, { token, orgId, body } = {}) => {
  const res = await fetch(`${base}/api${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
};

const review = (actor, org, target) =>
  call('GET', `/admin/memberships/${target._id}/deletion-check`, { token: tok(actor), orgId: org._id });
const remove = (actor, org, target, body) =>
  call('DELETE', `/admin/memberships/${target._id}/account`, { token: tok(actor), orgId: org._id, body });
// Review, then delete on exactly the terms the review showed.
const reviewAndDelete = async (actor, org, target) => {
  const r = await review(actor, org, target);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.canDelete, true, JSON.stringify(r.json.blockers));
  return remove(actor, org, target, { confirmEmail: r.json.confirmEmail.toUpperCase(), expectKind: r.json.kind });
};
const codes = (r) => (r.json?.blockers || []).map((b) => b.code);

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, Subscription, User, Membership, Campaign, CampaignAssignment, CampaignManager, Effort,
    EffortMember, Pass, Turf, TurfAssignment, Household, CanvassActivity, SurveyResponse, DeletedUserRecord,
    EmailLog, SupportAccessGrant, RetentionRun,
  ]) {
    await M.deleteMany({});
  }

  const mkOrg = async (name, slug, { internal = false, status = 'active' } = {}) => {
    const org = await Organization.create({ name, slug, isActive: true, ...(internal ? { isInternal: true } : {}) });
    await Subscription.create({ organizationId: org._id, status: internal ? 'internal' : status, statusChangedAt: new Date() });
    return org;
  };
  const orgA = await mkOrg('Acme Campaigns', 'acme-del');
  const orgB = await mkOrg('Bright PAC', 'bright-del');
  const demo = await mkOrg('Doorline Demo', 'demo-del', { internal: true });

  const mkCampaign = async (org, name) => {
    const campaign = await Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'FL', isActive: true });
    const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
    const pass = await Pass.create({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Pass 1', status: 'active',
    });
    return { campaign, effort, pass };
  };
  const A1 = await mkCampaign(orgA, 'A1');
  const B1 = await mkCampaign(orgB, 'B1');
  const D1 = await mkCampaign(demo, 'D1');

  const adminA = await mkUser('Ada', { lastLoginAt: new Date() });
  await member(adminA, orgA, { role: 'admin', billingAccess: true });
  const admin2 = await mkUser('Noel', { lastLoginAt: new Date() });
  await member(admin2, orgA, { role: 'admin' });
  const lead = await mkUser('Lee', { lastLoginAt: new Date() });
  await member(lead, orgA, { role: 'lead' });
  await CampaignManager.create({ campaignId: A1.campaign._id, userId: lead._id, organizationId: orgA._id, grantedBy: adminA._id });

  const support = await mkUser('Sue', { superAdmin: true, platformRole: 'support' });
  const breakGlass = await mkUser('Bree', { superAdmin: true, platformRole: 'break_glass' });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { orgA, orgB, demo, A1, B1, D1, adminA, admin2, lead, support, breakGlass });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// A published one-door book in A1 held by `holders`.
const book = async (name, holders) => {
  const { orgA, A1 } = ctx;
  const door = await Household.create({
    organizationId: orgA._id, campaignId: A1.campaign._id, effortId: A1.effort._id,
    addressLine1: `${seq} ${name} St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${seq} ${name.toUpperCase()} ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4, 28.3] }, isActive: true,
  });
  const turf = await Turf.create({
    organizationId: orgA._id, campaignId: A1.campaign._id, passId: A1.pass._id,
    name, mode: 'geometric', status: 'published', householdIds: [door._id], doorCount: 1,
  });
  for (const h of holders) {
    await TurfAssignment.create({ organizationId: orgA._id, campaignId: A1.campaign._id, passId: A1.pass._id, turfId: turf._id, userId: h._id });
  }
  return turf;
};
const roster = (user, { coordinatorId = null } = {}) =>
  CampaignAssignment.create({ organizationId: ctx.orgA._id, campaignId: ctx.A1.campaign._id, userId: user._id, coordinatorId });

// ── The deletion ──────────────────────────────────────────────────────────────────────────────────

test('a used single-org canvasser: the review, the delete, and everything it leaves behind', { skip }, async () => {
  const { orgA, orgB, A1, B1, adminA } = ctx;
  const sam = await mkUser('Sam', { lastLoginAt: new Date() });
  await member(sam, orgA);
  await roster(sam);
  const cal = await mkUser('Cal');
  await member(cal, orgA);
  const crewA = await mkUser('Crewa');
  await member(crewA, orgA);
  await roster(crewA, { coordinatorId: sam._id });
  const crewB = await mkUser('Crewb');
  await member(crewB, orgA);
  await roster(crewB, { coordinatorId: sam._id });
  const solo = await book('Solo', [sam]);
  const shared = await book('Shared', [sam, cal]);
  await EffortMember.create({ organizationId: orgA._id, campaignId: A1.campaign._id, effortId: A1.effort._id, userId: sam._id, addedBy: adminA._id });
  await knock(sam, orgA, A1.campaign, { coordinatorId: sam._id });
  await knock(sam, orgA, A1.campaign);
  await survey(sam, orgA, A1.campaign);
  // A former org: no membership left there, only their own knocks.
  await knock(sam, orgB, B1.campaign);
  await EmailLog.create({ kind: 'inviteSetPassword', to: [sam.email], outcome: 'sent', userId: sam._id, sentAt: new Date(), deliveryDetail: `550 ${sam.email} rejected` });
  // An earlier address on the same account (an email fix): still theirs, still scrubbed.
  await EmailLog.create({ kind: 'passwordReset', to: ['sam.old@acme.test'], outcome: 'sent', userId: sam._id, sentAt: new Date() });
  // A deletion warning that reached them: no userId, kept as evidence.
  await EmailLog.create({ kind: 'windDownWarning', to: [sam.email], outcome: 'sent', sentAt: new Date(), organizationId: orgA._id });
  const ledgerBefore = await CanvassActivity.find({ userId: sam._id }).lean();

  const r = await review(adminA, orgA, sam);
  assert.equal(r.status, 200);
  assert.equal(r.json.canDelete, true);
  assert.equal(r.json.kind, 'used');
  assert.equal(r.json.confirmEmail, sam.email);
  assert.deepEqual(r.json.usage, {
    signedIn: true, fieldRecordsHere: true, fbtimeHours: false, crew: { people: 2, campaigns: 1 }, wasCoordinator: true,
  });
  assert.deepEqual(r.json.holding, {
    campaigns: 1, books: { soleHolder: 1, shared: 1 }, effortCrews: 1, leadGrants: 0, membershipActive: true, retained: { days: 180 },
  });

  const wrong = await remove(adminA, orgA, sam, { confirmEmail: 'nope@acme.test', expectKind: 'used' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.code, 'confirm-email-mismatch');
  const stale = await remove(adminA, orgA, sam, { confirmEmail: sam.email, expectKind: 'unused' });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'USAGE_CHANGED');
  assert.equal(await User.countDocuments({ _id: sam._id, deletedAt: null }), 1, 'neither refusal touched the account');

  const ok = await remove(adminA, orgA, sam, { confirmEmail: ` ${sam.email.toUpperCase()} `, expectKind: 'used' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.kind, 'used');

  const after = await User.findById(sam._id).lean();
  assert.ok(after.deletedAt);
  assert.equal(after.firstName, 'Deleted');
  assert.equal(after.email, del.tombstoneEmail(sam._id));
  assert.equal(after.phone, null);
  assert.equal(after.lastLoginAt, null);
  const m = await Membership.findOne({ userId: sam._id, organizationId: orgA._id }).lean();
  assert.equal(m.isActive, false);
  assert.equal(m.billingAccess, false);
  assert.equal(await TurfAssignment.countDocuments({ userId: sam._id }), 0, 'every book released');
  assert.equal(await TurfAssignment.countDocuments({ turfId: solo._id }), 0, 'the solo book went back to unassigned');
  assert.equal(await TurfAssignment.countDocuments({ turfId: shared._id, userId: cal._id }), 1, 'the shared book stayed with Cal');
  assert.equal(await EffortMember.countDocuments({ userId: sam._id }), 0);
  assert.equal(await CampaignAssignment.countDocuments({ userId: sam._id }), 0);
  assert.equal(await CampaignAssignment.countDocuments({ coordinatorId: sam._id }), 0, 'the crew lost this coordinator');
  assert.deepEqual(await CanvassActivity.find({ userId: sam._id }).lean(), ledgerBefore, 'the ledger is untouched, coordinator stamps included');

  const rec = await DeletedUserRecord.findOne({ userId: sam._id }).lean();
  assert.ok(rec.finishedAt);
  assert.equal(rec.pendingAt, undefined);
  assert.equal(rec.pendingToken, undefined);
  assert.equal(rec.firstName, 'Sam');
  assert.equal(rec.reason, 'org_admin');
  assert.equal(String(rec.deletedBy), String(adminA._id));
  assert.deepEqual(rec.organizationIds.map(String).sort(), [String(orgA._id), String(orgB._id)].sort(), 'this org and the former org where they knocked');
  assert.equal(new Date(rec.deletedAt).getTime(), new Date(after.deletedAt).getTime());

  const mail = await EmailLog.find({ userId: sam._id }).lean();
  assert.equal(mail.length, 2);
  for (const row of mail) {
    assert.deepEqual(row.to, [del.tombstoneEmail(sam._id)]);
    assert.equal(row.deliveryDetail, null);
  }
  assert.deepEqual((await EmailLog.findOne({ kind: 'windDownWarning' }).lean()).to, [sam.email], 'the warning evidence keeps its recipient');

  const list = await call('GET', '/admin/memberships', { token: tok(adminA), orgId: orgA._id });
  const row = list.json.members.find((x) => x.user.id === String(sam._id));
  assert.equal(row.user.isDeleted, true);
  assert.equal(row.deletion.how, 'admin');
  assert.equal(row.deletion.byName, 'Ada Test');

  const again = await remove(adminA, orgA, sam, { confirmEmail: sam.email, expectKind: 'used' });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'ALREADY_DELETED');

  // The address is free again: re-adding it makes a NEW account, and none of its mail is touched.
  const readd = await call('POST', '/admin/memberships', {
    token: tok(adminA), orgId: orgA._id, body: { email: sam.email, firstName: 'Sam', lastName: 'Again', role: 'canvasser' },
  });
  assert.equal(readd.status, 201, JSON.stringify(readd.json));
  const newId = readd.json.membership.user.id;
  assert.notEqual(newId, String(sam._id));
  await EmailLog.create({ kind: 'addedToOrg', to: [sam.email], outcome: 'sent', userId: newId, sentAt: new Date() });
  await del.sweepDeletionLocks();
  const newRows = await EmailLog.find({ userId: newId }).lean();
  assert.ok(newRows.length >= 1);
  assert.ok(newRows.every((x) => x.to[0] === sam.email), "the re-added account's mail is never rewritten");
});

test('an unused account loses its row and its name; its invite link stops working', { skip }, async () => {
  const { orgA, adminA } = ctx;
  const jordan = await mkUser('Jordan');
  await member(jordan, orgA);
  await roster(jordan);
  await book('JordanBook', [jordan]);
  const { rawToken } = await issuePasswordResetToken(jordan._id, { hours: 72 });

  const r = await review(adminA, orgA, jordan);
  assert.equal(r.json.kind, 'unused');
  const ok = await remove(adminA, orgA, jordan, { confirmEmail: jordan.email, expectKind: 'unused' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.kind, 'unused');
  assert.equal(await Membership.countDocuments({ userId: jordan._id, organizationId: orgA._id }), 0, 'gone from the Users list');
  const rec = await DeletedUserRecord.findOne({ userId: jordan._id }).lean();
  assert.equal(rec.firstName, '');
  assert.equal(rec.lastName, '');
  assert.equal(rec.unusedOrgId, undefined);
  assert.ok(rec.finishedAt);

  const reset = await call('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'NewPassword123!' } });
  assert.equal(reset.status, 400);
  assert.equal(reset.json.code, 'RESET_INVALID');
});

test('an account created before the sign-in clock was reliable always reads as used', { skip }, async () => {
  const { orgA, adminA } = ctx;
  const old = await mkUser('Olden', { createdAt: new Date('2026-04-01T00:00:00Z') });
  await member(old, orgA);
  const r = await review(adminA, orgA, old);
  assert.equal(r.json.kind, 'used');
});

// ── Refusals ──────────────────────────────────────────────────────────────────────────────────────

test('an unknown id and a member of another org get the identical 404', { skip }, async () => {
  const { orgA, orgB, adminA } = ctx;
  const elsewhere = await mkUser('Elsewhere', { lastLoginAt: new Date() });
  await member(elsewhere, orgB, { role: 'admin' });
  const a = await review(adminA, orgA, elsewhere);
  const b = await review(adminA, orgA, { _id: new mongoose.Types.ObjectId() });
  assert.equal(a.status, 404);
  assert.deepEqual(a.json, b.json);
  const c = await remove(adminA, orgA, elsewhere, { confirmEmail: elsewhere.email, expectKind: 'used' });
  assert.equal(c.status, 404);
  assert.deepEqual(c.json, b.json);
});

test('another organization, active or switched off, refuses — and nothing of it crosses', { skip }, async () => {
  const { orgA, orgB, adminA } = ctx;
  for (const isActive of [true, false]) {
    const both = await mkUser(isActive ? 'Both' : 'Bothoff', { lastLoginAt: new Date() });
    await member(both, orgA);
    // Org B's SOLE admin: even that must not leak as LAST_ADMIN or by name.
    await member(both, orgB, { role: 'admin', isActive });
    const r = await review(adminA, orgA, both);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ['blockers', 'canDelete']);
    assert.deepEqual(codes(r), ['OTHER_ORGANIZATION']);
    const text = JSON.stringify(r.json);
    assert.ok(!text.includes('Bright') && !text.includes(String(orgB._id)), 'no name or id of the other org');
    const d = await remove(adminA, orgA, both, { confirmEmail: both.email, expectKind: 'used' });
    assert.equal(d.status, 409);
    assert.equal(d.json.code, 'BLOCKED');
    assert.equal(await User.countDocuments({ _id: both._id, deletedAt: null }), 1);
  }
});

test('billing access protects its holder from deletion AND from Remove-then-re-add', { skip }, async () => {
  const { orgA, adminA, admin2 } = ctx;
  const payer = await mkUser('Payer', { lastLoginAt: new Date() });
  await member(payer, orgA, { role: 'admin', billingAccess: true });
  let r = await review(admin2, orgA, payer);
  assert.deepEqual(codes(r), ['BILLING_TARGET']);
  // Demoted, the flag still protects them.
  await Membership.updateOne({ userId: payer._id, organizationId: orgA._id }, { $set: { role: 'canvasser' } });
  r = await review(admin2, orgA, payer);
  assert.deepEqual(codes(r), ['BILLING_TARGET']);
  const rm = await call('DELETE', `/admin/memberships/${payer._id}`, { token: tok(admin2), orgId: orgA._id });
  assert.equal(rm.status, 403);
  assert.equal(rm.json.code, 'BILLING_ACCESS_REQUIRED');
  assert.equal(await Membership.countDocuments({ userId: payer._id, organizationId: orgA._id }), 1);
  // An admin WITH billing access may do both.
  r = await review(adminA, orgA, payer);
  assert.equal(r.json.canDelete, true, JSON.stringify(r.json.blockers));
  const rm2 = await call('DELETE', `/admin/memberships/${payer._id}`, { token: tok(adminA), orgId: orgA._id });
  assert.equal(rm2.status, 200, JSON.stringify(rm2.json));
});

test('a deleted account’s row can be tidied away by any admin, billing flag or not', { skip }, async () => {
  const { orgA, admin2 } = ctx;
  const ghost = await mkUser('Ghost');
  await member(ghost, orgA, { role: 'admin', billingAccess: true, isActive: false });
  await User.updateOne({ _id: ghost._id }, { $set: { deletedAt: new Date(), isActive: false } });
  const rm = await call('DELETE', `/admin/memberships/${ghost._id}`, { token: tok(admin2), orgId: orgA._id });
  assert.equal(rm.status, 200, JSON.stringify(rm.json));
});

test('billing-less orgs: deleting an admin without billing access is not refused as the last billing admin', { skip }, async () => {
  const org = await Organization.create({ name: 'No Bill Co', slug: 'nobill-del', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const one = await mkUser('Onebill', { lastLoginAt: new Date() });
  const two = await mkUser('Twobill', { lastLoginAt: new Date() });
  const three = await mkUser('Threebill', { lastLoginAt: new Date(), password: true });
  await member(one, org, { role: 'admin' });
  await member(two, org, { role: 'admin' });
  await member(three, org, { role: 'admin' });
  const ok = await reviewAndDelete(one, org, two);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // …and by self-deletion, the other door through the same model.
  const self = await call('DELETE', '/auth/account', { token: tok(three), body: { currentPassword: PASSWORD } });
  assert.equal(self.status, 200, JSON.stringify(self.json));
  assert.ok((await User.findById(three._id).lean()).deletedAt);
});

test('leads never; review logins never; never yourself, never staff, never a locked review account', { skip }, async () => {
  const { orgA, adminA, lead } = ctx;
  const target = await mkUser('Plain', { lastLoginAt: new Date() });
  await member(target, orgA);
  const byLead = await review(lead, orgA, target);
  assert.equal(byLead.status, 403);
  assert.equal(byLead.json.code, 'ADMIN_ONLY');

  const reviewer = await mkUser('Reviewer', { deletionLocked: true, lastLoginAt: new Date() });
  await member(reviewer, orgA, { role: 'admin' });
  assert.deepEqual(codes(await review(reviewer, orgA, target)), ['REVIEW_LOGIN']);

  assert.deepEqual(codes(await review(adminA, orgA, adminA)), ['SELF']);

  const staffer = await mkUser('Staffy', { superAdmin: true, lastLoginAt: new Date() });
  await member(staffer, orgA);
  assert.deepEqual(codes(await review(adminA, orgA, staffer)), ['STAFF_ACCOUNT']);

  const locked = await mkUser('Locked', { deletionLocked: true, lastLoginAt: new Date() });
  await member(locked, orgA);
  assert.deepEqual(codes(await review(adminA, orgA, locked)), ['DELETION_LOCKED']);
});

test('staff, in every orgContext case', { skip }, async () => {
  const { orgA, demo, D1, support, breakGlass } = ctx;
  const usedTarget = await mkUser('Usedone', { lastLoginAt: new Date() });
  await member(usedTarget, orgA);
  const unusedTarget = await mkUser('Unusedone');
  await member(unusedTarget, orgA);

  // A staffer who is this org's own admin: like any admin, attributed as one.
  const staffAdmin = await mkUser('Stadmin', { superAdmin: true, platformRole: 'support' });
  await member(staffAdmin, orgA, { role: 'admin' });
  assert.equal((await review(staffAdmin, orgA, usedTarget)).json.canDelete, true);
  // …in another role: refused, as a blocker. A grant on top changes nothing (membership wins).
  const staffCanvasser = await mkUser('Stcanv', { superAdmin: true, platformRole: 'break_glass' });
  await member(staffCanvasser, orgA);
  await SupportAccessGrant.create({ actorUserId: staffCanvasser._id, organizationId: orgA._id, reason: 'test', expiresAt: new Date(Date.now() + 3_600_000) });
  assert.deepEqual(codes(await review(staffCanvasser, orgA, usedTarget)), ['ADMIN_ONLY']);

  // Support tier under a grant: unused accounts only. Break-glass under a grant: any.
  await SupportAccessGrant.create({ actorUserId: support._id, organizationId: orgA._id, reason: 'test', expiresAt: new Date(Date.now() + 3_600_000) });
  assert.deepEqual(codes(await review(support, orgA, usedTarget)), ['BREAK_GLASS_REQUIRED']);
  const okUnused = await reviewAndDelete(support, orgA, unusedTarget);
  assert.equal(okUnused.status, 200, JSON.stringify(okUnused.json));
  assert.equal((await DeletedUserRecord.findOne({ userId: unusedTarget._id }).lean()).reason, 'super_admin');
  await SupportAccessGrant.create({ actorUserId: breakGlass._id, organizationId: orgA._id, reason: 'test', expiresAt: new Date(Date.now() + 3_600_000) });
  const okUsed = await reviewAndDelete(breakGlass, orgA, usedTarget);
  assert.equal(okUsed.status, 200, JSON.stringify(okUsed.json));

  // A grant-holder may not touch a staff account at all (the vendor rule).
  const staffTarget = await mkUser('Sttarget', { superAdmin: true });
  await member(staffTarget, orgA);
  const mint = await review(breakGlass, orgA, staffTarget);
  assert.equal(mint.status, 403);
  assert.equal(mint.json.code, 'STAFF_SELF_MINT');

  // An internal org, entered without a membership: like any admin.
  const demoAdmin = await mkUser('Demoadm', { lastLoginAt: new Date() });
  await member(demoAdmin, demo, { role: 'admin' });
  const demoPerson = await mkUser('Demoperson', { lastLoginAt: new Date() });
  await member(demoPerson, demo);
  await CampaignAssignment.create({ organizationId: demo._id, campaignId: D1.campaign._id, userId: demoPerson._id });
  const okDemo = await reviewAndDelete(support, demo, demoPerson);
  assert.equal(okDemo.status, 200, JSON.stringify(okDemo.json));
  assert.equal((await DeletedUserRecord.findOne({ userId: demoPerson._id }).lean()).reason, 'super_admin');
  // …but a canvasser membership in an internal org is still a canvasser.
  const demoStaffCanv = await mkUser('Demostcanv', { superAdmin: true, platformRole: 'break_glass' });
  await member(demoStaffCanv, demo);
  assert.deepEqual(codes(await review(demoStaffCanv, demo, demoAdmin)), ['ADMIN_ONLY']);
});

test('the last live admin and the last billing admin are protected', { skip }, async () => {
  const { breakGlass } = ctx;
  const org = await Organization.create({ name: 'Solo Co', slug: 'solo-del', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const solo = await mkUser('Soloadm', { lastLoginAt: new Date() });
  await member(solo, org, { role: 'admin', billingAccess: true });
  const nobill = await mkUser('Nobilladm', { lastLoginAt: new Date() });
  await SupportAccessGrant.create({ actorUserId: breakGlass._id, organizationId: org._id, reason: 'test', expiresAt: new Date(Date.now() + 3_600_000) });
  assert.deepEqual(codes(await review(breakGlass, org, solo)), ['LAST_ADMIN']);
  await member(nobill, org, { role: 'admin' });
  assert.deepEqual(codes(await review(breakGlass, org, solo)), ['LAST_BILLING_ADMIN']);
  // A DELETED co-admin doesn't count as a live one.
  const deadAdmin = await mkUser('Deadadm');
  await member(deadAdmin, org, { role: 'admin', billingAccess: true });
  await User.updateOne({ _id: deadAdmin._id }, { $set: { deletedAt: new Date(), isActive: false } });
  assert.deepEqual(codes(await review(breakGlass, org, solo)), ['LAST_BILLING_ADMIN']);
});

test('one deletion at a time: a held lock answers DELETION_IN_PROGRESS on the org door and the self door', { skip }, async () => {
  const { orgA, adminA } = ctx;
  const held = await mkUser('Held', { lastLoginAt: new Date(), password: true });
  await member(held, orgA);
  await DeletedUserRecord.create({
    userId: held._id, pendingAt: new Date(), pendingToken: 'someone-else', firstName: 'Held', lastName: 'Test',
    reason: 'org_admin', deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000),
  });
  const r = await reviewAndDelete(adminA, orgA, held);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'DELETION_IN_PROGRESS');
  assert.equal(r.json.error, del.DELETION_IN_PROGRESS_MESSAGE);
  const self = await call('DELETE', '/auth/account', { token: tok(held), body: { currentPassword: PASSWORD } });
  assert.equal(self.status, 409, JSON.stringify(self.json));
  assert.equal(self.json.code, 'DELETION_IN_PROGRESS');
  const m = await Membership.findOne({ userId: held._id }).lean();
  assert.equal(m.isActive, true, 'the refused attempt switched nothing off');
  assert.equal((await DeletedUserRecord.findOne({ userId: held._id }).lean()).pendingToken, 'someone-else', 'and left the other lock alone');
});

// ── Races, forced ─────────────────────────────────────────────────────────────────────────────────

test('the same account twice at once: exactly one deletion wins', { skip }, async () => {
  const { orgA } = ctx;
  const target = await mkUser('Twice', { lastLoginAt: new Date() });
  await member(target, orgA);
  const results = await Promise.allSettled([
    del.deleteAccount(target._id, { reason: 'self' }),
    del.deleteAccount(target._id, { reason: 'super_admin' }),
    del.deleteAccount(target._id, { reason: 'operator' }),
  ]);
  const wins = results.filter((x) => x.status === 'fulfilled');
  assert.equal(wins.length, 1, JSON.stringify(results.map((x) => x.reason?.code || 'ok')));
  for (const lost of results.filter((x) => x.status === 'rejected')) {
    assert.ok(['DELETION_IN_PROGRESS', 'ALREADY_DELETED'].includes(lost.reason.code), lost.reason.code);
  }
  assert.ok((await DeletedUserRecord.findOne({ userId: target._id }).lean()).finishedAt);
});

test('round 4: an attempt that read the account before another FINISHED can never take over its record', { skip }, async () => {
  const { orgA } = ctx;
  const target = await mkUser('Raced', { lastLoginAt: new Date() });
  await member(target, orgA);
  const liveRead = (await User.findById(target._id).lean()); // attempt B read it here…
  await del.deleteAccount(target._id, { reason: 'operator' }); // …attempt A ran to the end…
  await assert.rejects(
    del.claimDeletionLock({ user: liveRead, pendingToken: 'b', reason: 'self', deletedBy: null, unusedOrgId: null, now: new Date() }),
    (err) => err.code === 'ALREADY_DELETED'
  );
  const rec = await DeletedUserRecord.findOne({ userId: target._id }).lean();
  assert.ok(rec.finishedAt);
  assert.equal(rec.firstName, 'Raced');
  assert.equal(rec.reason, 'operator', "A's attribution survives");
});

test('two admins deleting each other never leave the org without a live admin', { skip }, async () => {
  for (let i = 0; i < 8; i += 1) {
    const org = await Organization.create({ name: `Pair ${i}`, slug: `pair-del-${i}`, isActive: true });
    await Subscription.create({ organizationId: org._id, status: 'active' });
    const p = await mkUser(`Pairp${i}`, { lastLoginAt: new Date() });
    const q = await mkUser(`Pairq${i}`, { lastLoginAt: new Date() });
    await member(p, org, { role: 'admin', billingAccess: true });
    await member(q, org, { role: 'admin', billingAccess: true });
    await Promise.allSettled([
      del.deleteAccount(q._id, { reason: 'org_admin', deletedBy: p._id, org: { organizationId: org._id, unused: false }, reviewed: true }),
      del.deleteAccount(p._id, { reason: 'org_admin', deletedBy: q._id, org: { organizationId: org._id, unused: false }, reviewed: true }),
      del.deleteAccount(p._id, { reason: 'org_admin', deletedBy: q._id, org: { organizationId: org._id, unused: false }, reviewed: true }),
    ]);
    const { countLiveAdmins, countLiveBillingAdmins } = await import('../src/services/memberships/billingGuards.js');
    assert.ok((await countLiveAdmins(org._id)) >= 1, `round ${i}: an admin is left`);
    assert.ok((await countLiveBillingAdmins(org._id)) >= 1, `round ${i}: a billing admin is left`);
    assert.equal(await DeletedUserRecord.countDocuments({ userId: { $in: [p._id, q._id] }, finishedAt: null }), 0, 'no lock left behind');
  }
});

test('a membership elsewhere that appears after the review refuses the deletion and undoes everything', { skip }, async () => {
  const { orgA, orgB, adminA } = ctx;
  const target = await mkUser('Linked', { lastLoginAt: new Date() });
  await member(target, orgA);
  await member(target, orgB); // the racing link, landed after the route's review
  await assert.rejects(
    del.deleteAccount(target._id, { reason: 'org_admin', deletedBy: adminA._id, org: { organizationId: orgA._id, unused: false }, reviewed: true }),
    (err) => err.code === 'BLOCKED' && err.details.blockers[0].code === 'OTHER_ORGANIZATION'
  );
  assert.equal(await Membership.countDocuments({ userId: target._id, isActive: true }), 2, 'both memberships switched back on');
  assert.equal(await DeletedUserRecord.countDocuments({ userId: target._id }), 0, 'the lock released');
  assert.equal(await User.countDocuments({ _id: target._id, deletedAt: null }), 1);
});

test('a racing link that makes them another org’s ONLY admin still refuses with that one blocker alone', { skip }, async () => {
  const { orgA, adminA } = ctx;
  const other = await Organization.create({ name: 'Other Co', slug: 'other-del', isActive: true });
  const target = await mkUser('Soleelsewhere', { lastLoginAt: new Date() });
  await member(target, orgA);
  await member(target, other, { role: 'admin', billingAccess: true }); // landed after the review
  await assert.rejects(
    del.deleteAccount(target._id, { reason: 'org_admin', deletedBy: adminA._id, org: { organizationId: orgA._id, unused: false }, reviewed: true }),
    (err) => err.code === 'BLOCKED' && err.details.blockers.length === 1 && err.details.blockers[0].code === 'OTHER_ORGANIZATION'
  );
  assert.equal(await Membership.countDocuments({ userId: target._id, isActive: true }), 2);
});

test('an unused deletion whose target signs in mid-flight is refused at the gate (USAGE_CHANGED)', { skip }, async () => {
  const { orgA, support } = ctx;
  const target = await mkUser('Signsin');
  await member(target, orgA);
  await User.updateOne({ _id: target._id }, { $set: { lastLoginAt: new Date() } }); // after the review said 'unused'
  await assert.rejects(
    del.deleteAccount(target._id, { reason: 'super_admin', deletedBy: support._id, org: { organizationId: orgA._id, unused: true }, reviewed: true }),
    (err) => err.code === 'USAGE_CHANGED'
  );
  assert.equal(await Membership.countDocuments({ userId: target._id, isActive: true }), 1);
  assert.equal(await DeletedUserRecord.countDocuments({ userId: target._id }), 0);
});

test('nothing lands on a deleted account: every writer refuses or converges', { skip }, async () => {
  const { orgA, adminA } = ctx;
  const target = await mkUser('Writer', { lastLoginAt: new Date() });
  await member(target, orgA, { role: 'admin', billingAccess: true });
  const t = tok(target); // their token, minted before the deletion
  await reviewAndDelete(adminA, orgA, target);

  const asAdmin = { token: tok(adminA), orgId: orgA._id };
  const patch = await call('PATCH', `/admin/memberships/${target._id}`, { ...asAdmin, body: { role: 'admin', isActive: true, billingAccess: true } });
  assert.equal(patch.status, 409);
  assert.equal(patch.json.code, 'ACCOUNT_DELETED');
  for (const [m, p, body] of [
    ['PATCH', `/admin/memberships/${target._id}/reactivate`],
    ['PATCH', `/admin/memberships/${target._id}/user`, { firstName: 'Back' }],
    ['PATCH', `/admin/memberships/${target._id}/password`, { password: 'Temporary123!' }],
  ]) {
    const r = await call(m, p, { ...asAdmin, body });
    assert.equal(r.status, 409, `${p}: ${JSON.stringify(r.json)}`);
  }
  for (const [m, p, body] of [
    ['PATCH', '/auth/me', { firstName: 'Back', lastName: 'Again' }],
    ['POST', '/auth/change-password', { currentPassword: 'x', newPassword: 'Another123!' }],
  ]) {
    const r = await call(m, p, { token: t, body });
    assert.equal(r.status, 401, p);
    assert.equal(r.json.reason, 'deleted');
  }
  const { rawToken, url } = await issuePasswordResetToken(target._id);
  assert.equal(url, null, 'no reset link is ever minted for a tombstone');
  assert.equal(rawToken, null);
  const { stampSessionClock } = await import('../src/services/auth/sessionStamps.js');
  await stampSessionClock(target._id, 'lastLoginAt');
  await stampSessionClock(target._id, 'lastSeenAt', { timestamps: false });
  const u = await User.findById(target._id).lean();
  assert.equal(u.firstName, 'Deleted');
  assert.equal(u.lastLoginAt, null);
  assert.equal(u.lastSeenAt, null);
  assert.equal(u.passwordResetToken, null);

  // A PATCH that saved AFTER the deletion (paused past its own pre-check): it converges to off, no
  // billing, no grants — never to a restored snapshot.
  const m = await Membership.findOne({ userId: target._id, organizationId: orgA._id });
  await Membership.updateOne({ _id: m._id }, { $set: { isActive: true, billingAccess: true, role: 'lead' } });
  await CampaignManager.create({ campaignId: ctx.A1.campaign._id, userId: target._id, organizationId: orgA._id });
  assert.equal(await del.convergeIfDeleted({ userId: target._id, organizationId: orgA._id, membershipId: m._id }), true);
  const after = await Membership.findById(m._id).lean();
  assert.equal(after.isActive, false);
  assert.equal(after.billingAccess, false);
  assert.equal(await CampaignManager.countDocuments({ userId: target._id }), 0);
});

// ── Crashes and the sweep ─────────────────────────────────────────────────────────────────────────

const STALE = () => new Date(Date.now() - del.LOCK_STALE_MS - 60_000);

test('a crash BEFORE the gate: the sweep switches the memberships back on and frees the lock', { skip }, async () => {
  const { orgA, orgB } = ctx;
  const target = await mkUser('Crashpre', { lastLoginAt: new Date() });
  const m1 = await member(target, orgA, { role: 'admin' });
  const m2 = await member(target, orgB);
  await Membership.updateMany({ _id: { $in: [m1._id, m2._id] } }, { $set: { isActive: false } });
  await DeletedUserRecord.create({
    userId: target._id, pendingAt: STALE(), pendingToken: 'crashed', firstName: 'Crashpre', lastName: 'Test',
    touchedMemberships: [m1._id, m2._id], reason: 'org_admin', deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000),
  });
  const dry = await del.sweepDeletionLocks({ apply: false });
  assert.ok(dry.released >= 1);
  assert.equal(await Membership.countDocuments({ userId: target._id, isActive: true }), 0, 'the dry run wrote nothing');
  const res = await del.sweepDeletionLocks();
  assert.ok(res.released >= 1);
  assert.equal(await Membership.countDocuments({ userId: target._id, isActive: true }), 2);
  assert.equal(await DeletedUserRecord.countDocuments({ userId: target._id }), 0);
});

test('a crash AFTER the gate: the sweep finishes it, keeping the name, attribution and unused-org removal', { skip }, async () => {
  const { orgA, adminA } = ctx;
  for (const unused of [false, true]) {
    const target = await mkUser(unused ? 'Crashunused' : 'Crashpost', { lastLoginAt: unused ? null : new Date() });
    await member(target, orgA);
    await roster(target);
    await DeletedUserRecord.create({
      userId: target._id, pendingAt: STALE(), pendingToken: 'crashed', firstName: unused ? '' : 'Crashpost', lastName: unused ? '' : 'Test',
      reason: 'org_admin', deletedBy: adminA._id, unusedOrgId: unused ? orgA._id : null, deletedAt: new Date(),
      retentionUntil: new Date(Date.now() + 86_400_000),
    });
    await User.updateOne({ _id: target._id }, { $set: { deletedAt: new Date(), isActive: false, firstName: 'Deleted', lastName: 'user', email: del.tombstoneEmail(target._id) } });
    const res = await del.sweepDeletionLocks();
    assert.ok(res.finished >= 1);
    const rec = await DeletedUserRecord.findOne({ userId: target._id }).lean();
    assert.ok(rec.finishedAt);
    assert.equal(rec.firstName, unused ? '' : 'Crashpost');
    assert.equal(rec.reason, 'org_admin');
    assert.equal(String(rec.deletedBy), String(adminA._id));
    assert.equal(rec.pendingAt, undefined);
    assert.equal(await CampaignAssignment.countDocuments({ userId: target._id }), 0, 'work released');
    assert.equal(
      await Membership.countDocuments({ userId: target._id, organizationId: orgA._id }),
      unused ? 0 : 1,
      unused ? 'the unused row removed' : 'the used row kept, off'
    );
  }
});

test('an error between the lock and the gate gives everything back, so a retry is not locked out', { skip }, async () => {
  const { orgA } = ctx;
  const target = await mkUser('Blip', { lastLoginAt: new Date() });
  await member(target, orgA);
  const original = User.findOneAndUpdate;
  User.findOneAndUpdate = () => {
    throw new Error('transient');
  };
  try {
    await assert.rejects(del.deleteAccount(target._id, { reason: 'self' }), /transient/);
  } finally {
    User.findOneAndUpdate = original;
  }
  assert.equal(await Membership.countDocuments({ userId: target._id, isActive: true }), 1);
  assert.equal(await DeletedUserRecord.countDocuments({ userId: target._id }), 0);
  const retry = await del.deleteAccount(target._id, { reason: 'self' });
  assert.ok(retry.deletedAt);
});

test('a gate write that LANDS but errors, then a failed re-read, still ends in a finished deletion', { skip }, async () => {
  const { orgA } = ctx;
  const target = await mkUser('Lostack', { lastLoginAt: new Date() });
  await member(target, orgA);
  await roster(target);
  const realUpdate = User.findOneAndUpdate;
  const realFind = User.findById;
  let failNextRead = false;
  User.findOneAndUpdate = function (...args) {
    const q = realUpdate.apply(this, args);
    return { lean: async () => { await q.lean(); failNextRead = true; throw new Error('lost acknowledgement'); } };
  };
  User.findById = function (...args) {
    if (failNextRead) {
      failNextRead = false;
      return { select: () => ({ lean: async () => { throw new Error('read blip'); } }) };
    }
    return realFind.apply(this, args);
  };
  try {
    await assert.rejects(del.deleteAccount(target._id, { reason: 'self' }), /read blip/);
  } finally {
    User.findOneAndUpdate = realUpdate;
    User.findById = realFind;
  }
  assert.ok((await User.findById(target._id).lean()).deletedAt, 'the scrub landed');
  const rec = await DeletedUserRecord.findOne({ userId: target._id }).lean();
  assert.ok(rec?.finishedAt, 'and the deletion was finished, not stranded without its record');
  assert.equal(rec.firstName, 'Lostack');
  assert.equal(await CampaignAssignment.countDocuments({ userId: target._id }), 0, 'work released');
  assert.equal(await Membership.countDocuments({ userId: target._id, isActive: true }), 0);
});

test('a takeover that dies before switching a crashed attempt’s memberships back on leaves the list for the sweep', { skip }, async () => {
  const { orgA } = ctx;
  const target = await mkUser('Takeover', { lastLoginAt: new Date() });
  const m = await member(target, orgA);
  await Membership.updateOne({ _id: m._id }, { $set: { isActive: false } }); // the crashed attempt's work
  await DeletedUserRecord.create({
    userId: target._id, pendingAt: STALE(), pendingToken: 'crashed', firstName: 'Takeover', touchedMemberships: [m._id],
    reason: 'self', deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000),
  });
  const realMany = Membership.updateMany;
  Membership.updateMany = () => { throw new Error('died mid-takeover'); };
  try {
    await assert.rejects(
      del.claimDeletionLock({ user: await User.findById(target._id).lean(), pendingToken: 'retry', reason: 'self', deletedBy: null, unusedOrgId: null, now: new Date() }),
      /died mid-takeover/
    );
  } finally {
    Membership.updateMany = realMany;
  }
  const rec = await DeletedUserRecord.findOne({ userId: target._id }).lean();
  assert.deepEqual(rec.touchedMemberships.map(String), [String(m._id)], 'the crashed attempt’s list survived the takeover');
  await DeletedUserRecord.updateOne({ userId: target._id }, { $set: { pendingAt: STALE() } }); // the retry died too
  await del.sweepDeletionLocks();
  assert.equal((await Membership.findById(m._id).lean()).isActive, true, 'the sweep switched them back on');
  assert.equal(await DeletedUserRecord.countDocuments({ userId: target._id }), 0);
});

test('the sweep never acts on a stale snapshot of a lock a fresh attempt has since claimed', { skip }, async () => {
  const { orgA } = ctx;
  const target = await mkUser('Snapshot', { lastLoginAt: new Date() });
  const m = await member(target, orgA);
  await DeletedUserRecord.create({
    userId: target._id, pendingAt: STALE(), pendingToken: 'crashed', firstName: 'Snapshot', touchedMemberships: [m._id],
    reason: 'self', deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000),
  });
  // The sweep reads the stale lock, and then the account, while it is still LIVE…
  const snapshot = await DeletedUserRecord.find({ userId: target._id }).lean();
  const liveRead = { _id: target._id, deletedAt: null };
  // …a retry claims the stale lock and finishes the deletion…
  await del.deleteAccount(target._id, { reason: 'self' });
  // …and only then does the sweep act on what it read.
  const realFindRecords = DeletedUserRecord.find;
  const realFindUser = User.findById;
  let servedRecords = false;
  let servedUser = false;
  DeletedUserRecord.find = function (...args) {
    if (!servedRecords) {
      servedRecords = true;
      return { select: () => ({ lean: async () => snapshot }) };
    }
    return realFindRecords.apply(this, args);
  };
  User.findById = function (...args) {
    if (!servedUser) {
      servedUser = true;
      return { select: () => ({ lean: async () => liveRead }) };
    }
    return realFindUser.apply(this, args);
  };
  try {
    const res = await del.sweepDeletionLocks();
    assert.equal(res.released, 0, 'nothing released: the lock was no longer the one it read');
  } finally {
    DeletedUserRecord.find = realFindRecords;
    User.findById = realFindUser;
  }
  assert.equal((await Membership.findById(m._id).lean()).isActive, false, 'the deleted account stays switched off');
  assert.ok((await DeletedUserRecord.findOne({ userId: target._id }).lean()).finishedAt);
});

test('a name record with no userId never scrubs the evidence rows that have none', { skip }, async () => {
  const warning = await EmailLog.create({ kind: 'windDownWarning', to: ['payer@acme.test'], outcome: 'sent', sentAt: new Date() });
  const notice = await EmailLog.create({ kind: 'supportGrantNotice', to: ['payer@acme.test'], outcome: 'sent', sentAt: new Date() });
  // userId is unique, so the two malformed shapes go in one at a time: a FINISHED record (it would
  // reach the late-mail re-scrub) and a pre-lock one (the legacy pass would stamp it).
  for (const shape of [{ finishedAt: new Date() }, {}]) {
    await DeletedUserRecord.collection.insertOne({ ...shape, deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000), organizationIds: [] });
    await del.sweepDeletionLocks();
    assert.deepEqual((await EmailLog.findById(warning._id).lean()).to, ['payer@acme.test'], JSON.stringify(shape));
    assert.deepEqual((await EmailLog.findById(notice._id).lean()).to, ['payer@acme.test'], JSON.stringify(shape));
    await DeletedUserRecord.collection.deleteMany({ userId: { $exists: false } });
  }
  await DeletedUserRecord.collection.insertOne({ deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000), organizationIds: [] });
  assert.ok((await del.sweepDeletionLocks()).failed >= 1, 'the malformed record is reported');
  await DeletedUserRecord.collection.deleteMany({ userId: { $exists: false } });
  assert.equal(await del.scrubAccountEmailLog(undefined), 0);
});

test('one malformed record fails the run but never stops the purge of healthy ones', { skip }, async () => {
  const healthy = await mkUser('Healthypurge');
  await User.updateOne({ _id: healthy._id }, { $set: { deletedAt: new Date(Date.now() - 200 * 86_400_000) } });
  await DeletedUserRecord.create({
    userId: healthy._id, finishedAt: new Date(), firstName: 'Healthy', reason: 'self',
    deletedAt: new Date(Date.now() - 200 * 86_400_000), retentionUntil: new Date(Date.now() - 1000),
  });
  await DeletedUserRecord.collection.insertOne({
    userId: 'not-an-object-id', firstName: 'Broken', deletedAt: new Date(), retentionUntil: new Date(Date.now() - 1000), purgedAt: null,
  });
  const res = await purgeDeletedIdentities({ apply: true });
  assert.equal(res.ok, false, 'the malformed record is reported');
  const rec = await DeletedUserRecord.findOne({ userId: healthy._id }).lean();
  assert.ok(rec.purgedAt, 'the healthy record was purged anyway');
  assert.equal(rec.firstName, '');
  await DeletedUserRecord.collection.deleteMany({ userId: 'not-an-object-id' });
});

test('Remove, demotion and Deactivate re-count live admins: an org never ends up with none', { skip }, async () => {
  const { breakGlass } = ctx;
  const org = await Organization.create({ name: 'Last Admin Co', slug: 'lastadmin-del', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const only = await mkUser('Onlyadmin', { lastLoginAt: new Date() });
  await member(only, org, { role: 'admin' });
  await SupportAccessGrant.create({ actorUserId: breakGlass._id, organizationId: org._id, reason: 'test', expiresAt: new Date(Date.now() + 3_600_000) });
  const asStaff = { token: tok(breakGlass), orgId: org._id };
  for (const [method, p, body] of [
    ['DELETE', `/admin/memberships/${only._id}`],
    ['PATCH', `/admin/memberships/${only._id}`, { role: 'canvasser' }],
    ['PATCH', `/admin/memberships/${only._id}`, { isActive: false }],
    ['PATCH', `/admin/memberships/${only._id}/deactivate`],
  ]) {
    const r = await call(method, p, { ...asStaff, body });
    assert.equal(r.status, 409, `${method} ${p}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, 'LAST_ADMIN');
    const m = await Membership.findOne({ userId: only._id, organizationId: org._id }).lean();
    assert.equal(m?.role, 'admin');
    assert.equal(m?.isActive, true);
  }
  // With a second live admin, each of them goes through as before.
  const second = await mkUser('Secondadmin', { lastLoginAt: new Date() });
  await member(second, org, { role: 'admin' });
  const demote = await call('PATCH', `/admin/memberships/${only._id}`, { ...asStaff, body: { role: 'canvasser' } });
  assert.equal(demote.status, 200, JSON.stringify(demote.json));
});

test('the sweep leaves fresh locks, finished and purged records alone, and stamps pre-lock records', { skip }, async () => {
  const fresh = await mkUser('Freshlock');
  await DeletedUserRecord.create({ userId: fresh._id, pendingAt: new Date(), pendingToken: 'live', reason: 'self', deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000) });
  const done = await mkUser('Donerec');
  await User.updateOne({ _id: done._id }, { $set: { deletedAt: new Date() } });
  const finishedAt = new Date(Date.now() - 86_400_000);
  await DeletedUserRecord.create({ userId: done._id, finishedAt, firstName: 'Done', reason: 'self', deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000) });
  const purgedUser = await mkUser('Purgedrec');
  await User.updateOne({ _id: purgedUser._id }, { $set: { deletedAt: new Date() } });
  await DeletedUserRecord.create({ userId: purgedUser._id, finishedAt, purgedAt: new Date(), reason: 'self', deletedAt: new Date(), retentionUntil: new Date() });
  // A pre-lock record of a deleted account (no pendingAt, no finishedAt), and one on a LIVE account.
  const legacy = await mkUser('Legacyrec');
  await User.updateOne({ _id: legacy._id }, { $set: { deletedAt: new Date() } });
  await DeletedUserRecord.collection.insertOne({ userId: legacy._id, firstName: 'Legacy', deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000), organizationIds: [] });
  const anomaly = await mkUser('Anomalyrec');
  await DeletedUserRecord.collection.insertOne({ userId: anomaly._id, firstName: 'Anomaly', deletedAt: new Date(), retentionUntil: new Date(Date.now() + 86_400_000), organizationIds: [] });

  await del.sweepDeletionLocks();
  assert.equal((await DeletedUserRecord.findOne({ userId: fresh._id }).lean()).pendingToken, 'live');
  assert.equal(new Date((await DeletedUserRecord.findOne({ userId: done._id }).lean()).finishedAt).getTime(), finishedAt.getTime());
  assert.ok((await DeletedUserRecord.findOne({ userId: purgedUser._id }).lean()).purgedAt);
  assert.ok((await DeletedUserRecord.findOne({ userId: legacy._id }).lean()).finishedAt, 'a pre-lock record of a deleted account is stamped finished');
  assert.equal(await DeletedUserRecord.countDocuments({ userId: anomaly._id }), 0, 'a pre-lock record on a live account is removed');
  await DeletedUserRecord.deleteOne({ userId: fresh._id });
});

test('the purge never touches a live account’s record, and records the sweep on its run', { skip }, async () => {
  const live = await mkUser('Livepurge');
  await DeletedUserRecord.create({
    userId: live._id, pendingAt: new Date(), pendingToken: 'mid-flight', firstName: 'Livepurge', reason: 'self',
    deletedAt: new Date(), retentionUntil: new Date(Date.now() - 1000),
  });
  const res = await purgeDeletedIdentities({ apply: true });
  assert.ok(res.skippedLive >= 1);
  const rec = await DeletedUserRecord.findOne({ userId: live._id }).lean();
  assert.equal(rec.purgedAt, null, 'not purged');
  assert.equal(rec.firstName, 'Livepurge');
  const run = await RetentionRun.findOne({ job: 'purge-deleted-identities' }).sort({ startedAt: -1 }).lean();
  for (const k of ['deletionsFinished', 'deletionsReleased', 'liveRecordsDeleted', 'legacyRecordsFinished', 'emailRowsRescrubbed', 'skippedLive']) {
    assert.equal(typeof run[k], 'number', `${k} is recorded on the run`);
  }
  assert.ok(run.skippedLive >= 1);
  await DeletedUserRecord.deleteOne({ userId: live._id });
});

// ── Other routes ──────────────────────────────────────────────────────────────────────────────────

test('a paused org: exactly the four writes that END access pass', { skip }, async () => {
  const org = await Organization.create({ name: 'Paused Co', slug: 'paused-del', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'suspended', statusChangedAt: new Date() });
  const admin = await mkUser('Pausedadmin', { lastLoginAt: new Date() });
  await member(admin, org, { role: 'admin', billingAccess: true });
  const asAdmin = { token: tok(admin), orgId: org._id };
  const campaign = await Campaign.create({ organizationId: org._id, name: 'P1', type: 'survey', state: 'FL', isActive: true });

  const a = await mkUser('Pauseda', { lastLoginAt: new Date() });
  await member(a, org);
  const b = await mkUser('Pausedb');
  await member(b, org);
  const c = await mkUser('Pausedc');
  await member(c, org);
  const d = await mkUser('Pausedd');
  await member(d, org);
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: d._id });

  const r = await call('GET', `/admin/memberships/${a._id}/deletion-check`, asAdmin);
  assert.equal(r.status, 200);
  const passes = [
    await call('DELETE', `/admin/memberships/${a._id}/account`, { ...asAdmin, body: { confirmEmail: a.email, expectKind: r.json.kind } }),
    await call('DELETE', `/admin/memberships/${b._id}`, asAdmin),
    await call('PATCH', `/admin/memberships/${c._id}/deactivate`, asAdmin),
    await call('PATCH', `/admin/campaigns/${campaign._id}/crew/${d._id}/deactivate`, asAdmin),
  ];
  for (const res of passes) assert.notEqual(res.status, 402, JSON.stringify(res.json));
  assert.equal(passes[0].status, 200, JSON.stringify(passes[0].json));
  const blocked = [
    await call('PATCH', `/admin/memberships/${c._id}/reactivate`, asAdmin),
    await call('PATCH', `/admin/memberships/${c._id}`, { ...asAdmin, body: { role: 'lead' } }),
    await call('POST', '/admin/memberships', { ...asAdmin, body: { email: 'new@paused.test', firstName: 'N', lastName: 'Ew', role: 'canvasser' } }),
    await call('PATCH', `/admin/campaigns/${campaign._id}/crew/${d._id}/reactivate`, asAdmin),
  ];
  for (const res of blocked) assert.equal(res.status, 402, JSON.stringify(res.json));
});

test('the backfill: a dry run counts, --apply scrubs only deleted accounts’ own rows', { skip }, async () => {
  const gone = await mkUser('Backfilled');
  await User.updateOne({ _id: gone._id }, { $set: { deletedAt: new Date(), email: del.tombstoneEmail(gone._id) } });
  await EmailLog.create({ kind: 'passwordReset', to: ['backfilled@old.test'], outcome: 'sent', userId: gone._id, sentAt: new Date() });
  const liveOne = await mkUser('Livemail');
  await EmailLog.create({ kind: 'passwordReset', to: ['backfilled@old.test'], outcome: 'sent', userId: liveOne._id, sentAt: new Date() });

  const run = (args) =>
    spawnSync(process.execPath, ['src/migrations/scrubDeletedEmailLog.js', ...args], {
      cwd: SERVER_DIR, env: { ...process.env, MONGODB_URI: URI }, encoding: 'utf8',
    });
  const dry = run([]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DRY RUN/);
  assert.match(dry.stdout, /Email log rows to scrub: [1-9]/);
  assert.deepEqual((await EmailLog.findOne({ userId: gone._id }).lean()).to, ['backfilled@old.test'], 'the dry run wrote nothing');
  const applied = run(['--apply']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual((await EmailLog.findOne({ userId: gone._id }).lean()).to, [del.tombstoneEmail(gone._id)]);
  assert.deepEqual((await EmailLog.findOne({ userId: liveOne._id }).lean()).to, ['backfilled@old.test'], 'a live account at the same address is untouched');
});
