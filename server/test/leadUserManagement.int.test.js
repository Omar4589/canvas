import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The team-lead user-management boundary, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/lead_users_test node --test test/leadUserManagement.int.test.js
//
// The contract (owner decisions, 2026-07-23):
//   1. /admin/memberships is lead-VISIBLE but lead-SCOPED: a lead's list is exactly the people
//      rostered (CampaignAssignment) on campaigns they hold a CampaignManager grant for. A lead
//      with zero grants sees an empty list, never the org.
//   2. A lead's write set is temp password + deactivate/reactivate, for CANVASSER targets on
//      their campaigns ONLY — never a fellow lead, never an admin (privilege escalation), never
//      a canvasser from an unmanaged campaign.
//   3. Role changes, creation, deletion, identity edits stay admin-only (403 ADMIN_ONLY).
//   4. Per-user read drills (/stats, /campaigns, /crews, /recent-activity) follow the same
//      visibility: in-scope target → 200, out-of-scope → 403.
//   5. Admin behavior is unchanged by all of the above.
//   6. Campaign-scoped create (leadCrew POST) accepts coordinatorId — the mobile create sheet's
//      coordinator picker (item D7) rides on it.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-lead-users';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignManager, CampaignAssignment, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Lead Org', slug: 'lead-org', isActive: true });
  const mk = (first, last, email) =>
    User.create({ firstName: first, lastName: last, email, passwordHash: 'x', isActive: true });
  const admin = await mk('Ada', 'Admin', 'lu-admin@t.co');
  const lead = await mk('Lee', 'Lead', 'lu-lead@t.co'); // manages campaign A only
  const lead2 = await mk('Lou', 'Lead2', 'lu-lead2@t.co'); // rostered on A as a LEAD (not manageable)
  const canvA = await mk('Cal', 'OnA', 'lu-canva@t.co'); // canvasser rostered on A → manageable
  const canvB = await mk('Bea', 'OnB', 'lu-canvb@t.co'); // canvasser rostered on B → invisible
  const role = (u, r) => Membership.create({ userId: u._id, organizationId: org._id, role: r, isActive: true });
  await role(admin, 'admin');
  await role(lead, 'lead');
  await role(lead2, 'lead');
  await role(canvA, 'canvasser');
  await role(canvB, 'canvasser');
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const campA = await Campaign.create({ organizationId: org._id, name: 'Camp A', type: 'survey', state: 'TX', isActive: true });
  const campB = await Campaign.create({ organizationId: org._id, name: 'Camp B', type: 'survey', state: 'TX', isActive: true });
  await CampaignManager.create({ campaignId: campA._id, userId: lead._id, organizationId: org._id, grantedBy: admin._id });

  const assign = (u, c) => CampaignAssignment.create({ userId: u._id, campaignId: c._id, organizationId: org._id });
  await assign(canvA, campA);
  await assign(lead2, campA); // a fellow lead ON the managed campaign — visible, not manageable
  await assign(canvB, campB);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, campA, campB, admin, lead, lead2, canvA, canvB,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
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
const asLead = () => ({ token: ctx.leadTok, orgId: ctx.org._id });
const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

test('the lead list is exactly their campaigns\' rosters — never the org', { skip }, async () => {
  const r = await call('GET', '/api/admin/memberships', asLead());
  assert.strictEqual(r.status, 200);
  const emails = r.json.members.map((m) => m.user.email).sort();
  // canvA + lead2 are rostered on managed Camp A. canvB (Camp B), the admin, and the lead
  // themself (no CampaignAssignment) are not.
  assert.deepStrictEqual(emails, ['lu-canva@t.co', 'lu-lead2@t.co']);
});

test('admin list is unchanged — the whole org', { skip }, async () => {
  const r = await call('GET', '/api/admin/memberships', asAdmin());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.members.length, 5);
});

test('campaignIds ship on the list, and a lead only ever sees campaigns they manage', { skip }, async () => {
  // The block this mirrors (managedCampaignIds) is attached UNFILTERED. Copying
  // that shape verbatim would hand a lead the full assignment set of every
  // canvasser in their scope — including campaigns the lead holds no grant for.
  // canvA is on BOTH campaigns; the lead manages only Camp A.
  await CampaignAssignment.create({
    userId: ctx.canvA._id, campaignId: ctx.campB._id, organizationId: ctx.org._id,
  });

  const asAdminRes = await call('GET', '/api/admin/memberships', asAdmin());
  const adminRow = asAdminRes.json.members.find((m) => m.user.email === 'lu-canva@t.co');
  assert.deepStrictEqual(
    [...adminRow.campaignIds].sort(),
    [String(ctx.campA._id), String(ctx.campB._id)].sort(),
    'an admin sees the whole assignment set'
  );

  const asLeadRes = await call('GET', '/api/admin/memberships', asLead());
  const leadRow = asLeadRes.json.members.find((m) => m.user.email === 'lu-canva@t.co');
  assert.deepStrictEqual(
    leadRow.campaignIds,
    [String(ctx.campA._id)],
    'a lead sees only the campaigns they manage — Camp B never leaks'
  );

  // Never undefined: the client maps over this field on every row.
  const adminSelf = asAdminRes.json.members.find((m) => m.user.email === 'lu-admin@t.co');
  assert.deepStrictEqual(adminSelf.campaignIds, [], 'somebody on no campaign gets an empty array');

  await CampaignAssignment.deleteOne({ userId: ctx.canvA._id, campaignId: ctx.campB._id });
});

test('fbtime link state is admin-only, and absent entirely without a connection', { skip }, async () => {
  // The whole /admin/integrations router is admin-gated; the one lead-visible
  // disclosure is deliberately per-user (GET /:userId/stats), never an org roll-up.
  const asAdminRes = await call('GET', '/api/admin/memberships', asAdmin());
  for (const m of asAdminRes.json.members) {
    assert.strictEqual(m.fbtime, null, 'no FbTime connection in this org — the column never renders');
  }
  const asLeadRes = await call('GET', '/api/admin/memberships', asLead());
  for (const m of asLeadRes.json.members) {
    assert.strictEqual(m.fbtime, null, 'and a lead is never told either way');
  }
});

test('user.isDeleted rides the list so clients stop sniffing the tombstone email', { skip }, async () => {
  const r = await call('GET', '/api/admin/memberships', asAdmin());
  assert.ok(r.json.members.every((m) => m.user.isDeleted === false), 'a live account is explicitly false, not undefined');
});

test('lead temp-password: canvasser on their campaign 200; everyone else 403', { skip }, async () => {
  const pw = { password: 'TempPass99!' };
  const ok = await call('PATCH', `/api/admin/memberships/${ctx.canvA._id}/password`, { ...asLead(), body: pw });
  assert.strictEqual(ok.status, 200);

  const offCampaign = await call('PATCH', `/api/admin/memberships/${ctx.canvB._id}/password`, { ...asLead(), body: pw });
  assert.strictEqual(offCampaign.status, 403, 'a canvasser on an unmanaged campaign is out of reach');

  const fellowLead = await call('PATCH', `/api/admin/memberships/${ctx.lead2._id}/password`, { ...asLead(), body: pw });
  assert.strictEqual(fellowLead.status, 403, 'a fellow lead is never manageable, even when rostered');

  const theAdmin = await call('PATCH', `/api/admin/memberships/${ctx.admin._id}/password`, { ...asLead(), body: pw });
  assert.strictEqual(theAdmin.status, 403, 'an admin is never manageable by a lead');
});

test('lead deactivate/reactivate: same boundary', { skip }, async () => {
  const deact = await call('PATCH', `/api/admin/memberships/${ctx.canvA._id}/deactivate`, { ...asLead(), body: {} });
  assert.strictEqual(deact.status, 200);
  assert.strictEqual(deact.json.membership.isActive, false);
  const react = await call('PATCH', `/api/admin/memberships/${ctx.canvA._id}/reactivate`, { ...asLead(), body: {} });
  assert.strictEqual(react.status, 200);
  assert.strictEqual(react.json.membership.isActive, true);

  const offCampaign = await call('PATCH', `/api/admin/memberships/${ctx.canvB._id}/deactivate`, { ...asLead(), body: {} });
  assert.strictEqual(offCampaign.status, 403);
  const theAdmin = await call('PATCH', `/api/admin/memberships/${ctx.admin._id}/deactivate`, { ...asLead(), body: {} });
  assert.strictEqual(theAdmin.status, 403);
});

test('role change / create / delete stay admin-only for leads', { skip }, async () => {
  const roleChange = await call('PATCH', `/api/admin/memberships/${ctx.canvA._id}`, { ...asLead(), body: { role: 'admin' } });
  assert.strictEqual(roleChange.status, 403);
  assert.strictEqual(roleChange.json.code, 'ADMIN_ONLY');

  const create = await call('POST', '/api/admin/memberships', {
    ...asLead(),
    body: { firstName: 'New', lastName: 'Person', email: 'lu-new@t.co', role: 'canvasser' },
  });
  assert.strictEqual(create.status, 403);

  const del = await call('DELETE', `/api/admin/memberships/${ctx.canvA._id}`, asLead());
  assert.strictEqual(del.status, 403);
});

test('lead identity edits: their canvassers only, and the multi-org email lock holds (2026-08-09 ruling)', { skip }, async () => {
  // The same leadMayManageTarget wall as passwords — which is the MORE dangerous power, so
  // identity following it is a coherent widening, not a new kind of hole.
  const ok = await call('PATCH', `/api/admin/memberships/${ctx.canvA._id}/user`, {
    ...asLead(),
    body: { firstName: 'Canvy', phone: '(555) 200-0001' },
  });
  assert.strictEqual(ok.status, 200, 'canvasser on their campaign: editable');
  assert.strictEqual(ok.json.user.firstName, 'Canvy');

  // Email too — for a SINGLE-org canvasser it is just a typo fix.
  const mail = await call('PATCH', `/api/admin/memberships/${ctx.canvA._id}/user`, {
    ...asLead(),
    body: { email: 'canva.fixed@t.co' },
  });
  assert.strictEqual(mail.status, 200, 'single-org email edit allowed');

  const offCampaign = await call('PATCH', `/api/admin/memberships/${ctx.canvB._id}/user`, { ...asLead(), body: { firstName: 'Hax' } });
  assert.strictEqual(offCampaign.status, 403, 'a canvasser on an unmanaged campaign is out of reach');
  const fellowLead = await call('PATCH', `/api/admin/memberships/${ctx.lead2._id}/user`, { ...asLead(), body: { firstName: 'Hax' } });
  assert.strictEqual(fellowLead.status, 403, 'a fellow lead is never editable');
  const theAdmin = await call('PATCH', `/api/admin/memberships/${ctx.admin._id}/user`, { ...asLead(), body: { firstName: 'Hax' } });
  assert.strictEqual(theAdmin.status, 403, 'an admin is never editable by a lead');

  // The multi-org email lock is what makes this widening safe to a shared account: give canvA a
  // second active org and their LOGIN EMAIL goes out of everyone's reach — lead and admin alike —
  // while name/phone stay editable.
  const otherOrg = await Organization.create({ name: 'Second Org', slug: 'lu-second-org', isActive: true });
  await Membership.create({ userId: ctx.canvA._id, organizationId: otherOrg._id, role: 'canvasser', isActive: true });
  const locked = await call('PATCH', `/api/admin/memberships/${ctx.canvA._id}/user`, {
    ...asLead(),
    body: { email: 'steal@t.co' },
  });
  assert.strictEqual(locked.status, 403, 'multi-org email edit refused');
  assert.strictEqual(locked.json.code, 'MULTI_ORG_EMAIL_LOCKED');
  const nameStill = await call('PATCH', `/api/admin/memberships/${ctx.canvA._id}/user`, {
    ...asLead(),
    body: { lastName: 'Renamed' },
  });
  assert.strictEqual(nameStill.status, 200, 'name/phone stay editable under the lock');
  // Restore the single-org world for any test after us.
  await Membership.deleteOne({ userId: ctx.canvA._id, organizationId: otherOrg._id });
});

test('per-user read drills follow visibility: in-scope 200, out-of-scope 403', { skip }, async () => {
  const inScope = await call('GET', `/api/admin/memberships/${ctx.canvA._id}/stats`, asLead());
  assert.strictEqual(inScope.status, 200);
  // An org that never connected FbTime reports connected:false, which is what collapses the
  // profile modal's whole hours row to nothing — no org grows a row about a product it
  // does not use. A lead gets the same field an admin does; only the CTA differs, client-side.
  assert.strictEqual(inScope.json.fbtime.connected, false);
  assert.strictEqual(inScope.json.fbtime.linked, false);
  const inScopeCamps = await call('GET', `/api/admin/memberships/${ctx.canvA._id}/campaigns`, asLead());
  assert.strictEqual(inScopeCamps.status, 200);

  const outScope = await call('GET', `/api/admin/memberships/${ctx.canvB._id}/stats`, asLead());
  assert.strictEqual(outScope.status, 403);
  const outScopeCrews = await call('GET', `/api/admin/memberships/${ctx.canvB._id}/crews`, asLead());
  assert.strictEqual(outScopeCrews.status, 403);
});

test('admin writes are untouched by the new guards', { skip }, async () => {
  const pw = await call('PATCH', `/api/admin/memberships/${ctx.canvB._id}/password`, { ...asAdmin(), body: { password: 'TempPass99!' } });
  assert.strictEqual(pw.status, 200);
  const stats = await call('GET', `/api/admin/memberships/${ctx.canvB._id}/stats`, asAdmin());
  assert.strictEqual(stats.status, 200);
});

test('campaign-scoped create accepts coordinatorId (the mobile picker, item D7)', { skip }, async () => {
  // The lead creates a canvasser straight onto Camp A with lead2 as coordinator.
  const r = await call('POST', `/api/admin/campaigns/${ctx.campA._id}/crew`, {
    ...asLead(),
    body: { firstName: 'Coo', lastName: 'Rdinated', email: 'lu-coord@t.co', linkExisting: false, coordinatorId: String(ctx.lead2._id) },
  });
  assert.ok(r.status === 200 || r.status === 201, `create failed: ${r.status} ${JSON.stringify(r.json)}`);
  const created = await User.findOne({ email: 'lu-coord@t.co' }).lean();
  assert.ok(created, 'user created');
  const asg = await CampaignAssignment.findOne({ userId: created._id, campaignId: ctx.campA._id }).lean();
  assert.ok(asg, 'auto-assigned to the campaign');
  assert.strictEqual(String(asg.coordinatorId), String(ctx.lead2._id), 'born onto the coordinator\'s crew');

  // ...and the new canvasser is now in the lead's Users list (item A3's promise).
  const list = await call('GET', '/api/admin/memberships', asLead());
  assert.ok(list.json.members.some((m) => m.user.email === 'lu-coord@t.co'));
});
