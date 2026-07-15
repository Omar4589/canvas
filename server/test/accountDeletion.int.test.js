import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Self-serve account deletion (App Store 5.1.1(v) / Google Play account-deletion policy), over
// the REAL Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/acctdel node --test test/accountDeletion.int.test.js
//
// The load-bearing assertions here are the ones that protect the BUSINESS, not just the stores:
//   · the knock ledger survives, so campaign counts and the invoice cannot move;
//   · a canvasser cannot delete their way out of a GPS audit (identity is snapshotted);
//   · a sole admin (or sole bill-payer) cannot delete themselves and brick/suspend their org;
//   · the App Review demo login cannot be destroyed by the reviewer testing the button.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-account-deletion';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Turf } = await import('../src/models/Turf.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Effort } = await import('../src/models/Effort.js');
const { DeletedUserRecord } = await import('../src/models/DeletedUserRecord.js');
const { knocksPipeline } = await import('../src/services/reports/aggregations.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const PW = 'Str0ng!Passw0rd';
let server;
let base;
const ctx = {};

async function makeUser(first, extra = {}) {
  return User.create({
    firstName: first,
    lastName: 'X',
    email: `${first.toLowerCase()}@t.co`,
    passwordHash: await User.hashPassword(PW),
    isActive: true,
    ...extra,
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

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Subscription, Campaign,
    CanvassActivity, TurfAssignment, Turf, Pass, Household, Effort, DeletedUserRecord,
  ]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Acme', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  // Two admins so neither is "the last one" — the sole-admin case gets its own org below.
  const bossA = await makeUser('Boss', { });
  const bossB = await makeUser('Deputy', { });
  const canvasser = await makeUser('Cara');
  const reviewer = await makeUser('Reviewer', { deletionLocked: true });

  await Membership.create({ userId: bossA._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: bossB._id, organizationId: org._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: canvasser._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Membership.create({ userId: reviewer._id, organizationId: org._id, role: 'canvasser', isActive: true });

  // A campaign the canvasser actually worked: two knocks on two doors. This is the ledger the
  // invoice is computed from — deletion must not touch a row of it.
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Fall', type: 'lit_drop', state: 'FL', isActive: true,
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'Round 1', status: 'active',
  });
  const homes = await Household.insertMany([1, 2].map((n) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${n} Acme Ln`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${n} ACME LN|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + n * 0.001, 28.3] },
  })));
  for (const h of homes) {
    await CanvassActivity.create({
      organizationId: org._id, campaignId: campaign._id, passId: pass._id,
      householdId: h._id, userId: canvasser._id, actionType: 'not_home', timestamp: new Date(),
      // The GPS stamp is the audit trail — it is exactly what must survive deletion.
      location: { lat: h.location.coordinates[1], lng: h.location.coordinates[0] },
    });
  }

  // ...and a book assigned to them, which deletion must hand back.
  const turf = await Turf.create({
    organizationId: org._id, campaignId: campaign._id, passId: pass._id, name: 'Book 1',
    mode: 'geometric', status: 'published',
    householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  await TurfAssignment.create({
    organizationId: org._id, campaignId: campaign._id, passId: pass._id,
    turfId: turf._id, userId: canvasser._id,
  });

  // A separate org whose ONLY admin is Solo — the brick-your-org case.
  const org2 = await Organization.create({ name: 'Solo Co', slug: 'solo-co', isActive: true });
  await Subscription.create({ organizationId: org2._id, status: 'active' });
  const solo = await makeUser('Solo');
  await Membership.create({ userId: solo._id, organizationId: org2._id, role: 'admin', isActive: true, billingAccess: true });

  Object.assign(ctx, {
    org, org2, campaign, pass, turf,
    cara: { token: signUserToken(canvasser), orgId: org._id, userId: canvasser._id },
    boss: { token: signUserToken(bossA), orgId: org._id, userId: bossA._id },
    reviewer: { token: signUserToken(reviewer), orgId: org._id, userId: reviewer._id },
    solo: { token: signUserToken(solo), orgId: org2._id, userId: solo._id },
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

// The exact number the invoice is built from: one distinct (household, pass). Note it never
// joins User — which is precisely why scrubbing a canvasser cannot move a bill.
async function billableKnocks(campaignId) {
  const rows = await CanvassActivity.aggregate(knocksPipeline({ campaignId }));
  return rows[0]?.knocks ?? 0;
}

test('the sole admin of an org cannot delete themselves and brick it', { skip }, async () => {
  const check = await call('GET', '/auth/account/deletion-check', ctx.solo);
  assert.strictEqual(check.status, 200);
  assert.strictEqual(check.json.canDelete, false, 'sole admin must be blocked');
  const codes = check.json.blockers.map((b) => b.code);
  assert.ok(codes.includes('LAST_ADMIN'), `expected LAST_ADMIN, got ${codes.join(',')}`);

  const del = await call('DELETE', '/auth/account', { ...ctx.solo, body: { currentPassword: PW } });
  assert.strictEqual(del.status, 409, 'the block is enforced on the write, not just the check');
  assert.strictEqual(del.json.code, 'BLOCKED');

  const still = await User.findById(ctx.solo.userId);
  assert.strictEqual(still.deletedAt, null, 'account survived');
});

test('the App Review demo login cannot be deleted by the reviewer testing the button', { skip }, async () => {
  const check = await call('GET', '/auth/account/deletion-check', ctx.reviewer);
  assert.strictEqual(check.json.canDelete, false);
  assert.ok(check.json.blockers.map((b) => b.code).includes('DELETION_LOCKED'));

  const del = await call('DELETE', '/auth/account', { ...ctx.reviewer, body: { currentPassword: PW } });
  assert.strictEqual(del.status, 409);
  const still = await User.findById(ctx.reviewer.userId);
  assert.strictEqual(still.deletedAt, null, 'demo tenant survives — the next submission is reviewable');
});

test('deletion requires the current password', { skip }, async () => {
  const del = await call('DELETE', '/auth/account', { ...ctx.cara, body: { currentPassword: 'wrong' } });
  assert.strictEqual(del.status, 401);
  const still = await User.findById(ctx.cara.userId);
  assert.strictEqual(still.deletedAt, null);
});

test('a canvasser deletes their account: identity is scrubbed, the ledger is untouched', { skip }, async () => {
  const knocksBefore = await billableKnocks(ctx.campaign._id);
  assert.strictEqual(knocksBefore, 2, 'two billable doors before deletion');

  const check = await call('GET', '/auth/account/deletion-check', ctx.cara);
  assert.strictEqual(check.json.canDelete, true);
  assert.ok(check.json.retained.summary.length > 0, 'the user is TOLD what survives — both stores require it');

  const del = await call('DELETE', '/auth/account', { ...ctx.cara, body: { currentPassword: PW } });
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));

  // --- the account is gone ---
  const u = await User.findById(ctx.cara.userId);
  assert.ok(u, 'the row survives — CanvassActivity.userId is `required`, so it has to');
  assert.ok(u.deletedAt, 'deletedAt set');
  assert.strictEqual(u.isActive, false);
  assert.strictEqual(u.firstName, 'Deleted');
  assert.strictEqual(u.phone, null);
  assert.ok(!u.email.includes('cara@t.co'), 'real email is gone from the User row');
  assert.ok(u.email.includes(String(ctx.cara.userId)), 'tombstone email embeds the id, so a 2nd deletion cannot collide');

  // --- the money did not move ---
  const knocksAfter = await billableKnocks(ctx.campaign._id);
  assert.strictEqual(knocksAfter, 2, 'billable knocks unchanged — the invoice cannot move');
  const rows = await CanvassActivity.countDocuments({ userId: ctx.cara.userId });
  assert.strictEqual(rows, 2, 'the ledger rows still point at the tombstoned id');

  // --- the org can still attribute the work (no fraud-audit escape hatch) ---
  // NAME ONLY: attribution needs a name, not a mailbox. The published deletion promise is
  // that contact details are removed immediately — the snapshot must not contradict it.
  const snap = await DeletedUserRecord.findOne({ userId: ctx.cara.userId }).lean();
  assert.ok(snap, 'identity snapshot exists');
  assert.strictEqual(snap.firstName, 'Cara', 'the org can still say WHO knocked those doors');
  assert.ok(!('email' in snap) || snap.email == null, 'the snapshot holds NO email');
  assert.ok(!('phone' in snap) || snap.phone == null, 'the snapshot holds NO phone');
  assert.ok(snap.retentionUntil > snap.deletedAt, 'retention is bounded, not forever');

  // --- the book was handed back ---
  const held = await TurfAssignment.countDocuments({ userId: ctx.cara.userId });
  assert.strictEqual(held, 0, 'no doors left stranded with a ghost');

  // --- they are off the roster ---
  const m = await Membership.findOne({ userId: ctx.cara.userId, organizationId: ctx.org._id });
  assert.strictEqual(m.isActive, false, 'team headcount stops counting them');
});

test('a deleted account cannot log in, and its existing token is dead', { skip }, async () => {
  const login = await call('POST', '/auth/login', { body: { email: 'cara@t.co', password: PW } });
  assert.strictEqual(login.status, 401, 'the real email no longer authenticates');

  // The JWT is stateless and lives 30d, so this is the assertion that matters: the token Cara
  // was holding when she deleted must stop working IMMEDIATELY, not in a month.
  const me = await call('GET', '/auth/me', ctx.cara);
  assert.strictEqual(me.status, 401, 'the token she already held is refused');
});

test('an admin cannot resurrect a deleted account or rewrite its PII', { skip }, async () => {
  // Apple: "only offering to temporarily deactivate or disable an account is insufficient."
  // If an admin could re-issue a temp password here, this would be a deactivate, not a delete.
  const pw = await call('PATCH', `/admin/memberships/${ctx.cara.userId}/password`, {
    ...ctx.boss, body: { password: 'An0ther!Passw0rd' },
  });
  assert.strictEqual(pw.status, 409, 'temp-password reset refused');
  assert.strictEqual(pw.json.code, 'ACCOUNT_DELETED');

  const edit = await call('PATCH', `/admin/memberships/${ctx.cara.userId}/user`, {
    ...ctx.boss, body: { firstName: 'Cara', lastName: 'Realname', email: 'cara@t.co' },
  });
  assert.strictEqual(edit.status, 409, 'writing the real name/email back onto the tombstone is refused');

  const reactivate = await call('PATCH', `/admin/memberships/${ctx.cara.userId}/reactivate`, ctx.boss);
  assert.strictEqual(reactivate.status, 409, 'cannot be put back on the roster');

  const u = await User.findById(ctx.cara.userId);
  assert.strictEqual(u.firstName, 'Deleted', 'still scrubbed');
});

test('a canvasser cannot delete their way out of a GPS audit', { skip }, async () => {
  // This is the one that matters. The flagged entries and their coordinates survive the scrub,
  // but that is worthless if the admin can no longer say WHOSE they were. Two things have to
  // hold: the deleted canvasser stays selectable on the campaign map (the surface an admin
  // actually investigates flags on), and the org can still resolve them back to a real person.
  const map = await call('GET', `/admin/households/map?campaignId=${ctx.campaign._id}`, ctx.boss);
  assert.strictEqual(map.status, 200);
  const ids = map.json.canvassers.map((c) => String(c.id));
  assert.ok(
    ids.includes(String(ctx.cara.userId)),
    'the deleted canvasser is STILL in the campaign map filter — her pins can be isolated'
  );

  // Her GPS trail is intact and still bound to her id.
  const withGps = await CanvassActivity.find({ userId: ctx.cara.userId }).lean();
  assert.strictEqual(withGps.length, 2);
  assert.ok(withGps.every((a) => a.location?.lat && a.location?.lng), 'coordinates survived');

  // And the org can put a NAME back on them, for as long as the disclosed window lasts —
  // a name only. Contact details died with the account, on every surface including the
  // canvasser CSV (whose Email column must never show the snapshot's or the tombstone's).
  const { resolveDeletedIdentities } = await import('../src/services/users/deleteAccount.js');
  const found = await resolveDeletedIdentities([ctx.cara.userId], { organizationId: ctx.org._id });
  assert.strictEqual(found.get(String(ctx.cara.userId))?.firstName, 'Cara');
  assert.ok(!found.get(String(ctx.cara.userId))?.email, 'the resolver carries no email');

  const { hydrateCanvassers } = await import('../src/services/reports/canvasserIdentity.js');
  const hydrated = await hydrateCanvassers([ctx.cara.userId], ctx.org._id);
  const row = hydrated.get(String(ctx.cara.userId));
  assert.strictEqual(row.firstName, 'Cara', 'reports still show the name during the window');
  assert.strictEqual(row.email, '', 'reports and the CSV show NO email for a deleted user');
  assert.strictEqual(row.phone, null);
  assert.strictEqual(row.status, 'deleted');
});

test('the freed email can be used for a brand-new account', { skip }, async () => {
  // Re-hiring someone gives them a NEW user id on purpose: their old knocks stay bound to the
  // tombstone, so nobody comes back to a laundered flag history.
  const fresh = await makeUser('Cara');
  assert.ok(fresh._id, 'the released email is reusable');
  assert.notStrictEqual(String(fresh._id), String(ctx.cara.userId), 'new identity, not the old one');
  const oldRows = await CanvassActivity.countDocuments({ userId: fresh._id });
  assert.strictEqual(oldRows, 0, 'the returning person does NOT inherit the deleted account’s history');
});
