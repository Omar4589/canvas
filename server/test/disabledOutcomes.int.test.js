import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Per-campaign door-outcome toggles (Campaign.disabledOutcomes) over the REAL Express app +
// throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/disabledoutcomes_test node --test test/disabledOutcomes.int.test.js
//
// The invariants this file exists to protect:
//   • Only TOGGLEABLE_OUTCOMES can be disabled — not_home and the completion actions are
//     enum-rejected, so no config state can ever make canvassing pointless.
//   • A FRESH submission of a disabled outcome is refused (OUTCOME_DISABLED) and writes
//     nothing; an OFFLINE REPLAY (wasOfflineSubmission) recorded before the toggle flipped
//     is accepted — a policy flip must never destroy real door data.
//   • A team lead can edit it (deliberately absent from the org-admin-only field list).
//   • The audit trail stores a SORTED join, so a reorder is a no-op, not a phantom change.
//   • The admin bulk-restrict desk path is deliberately UNAFFECTED by the toggle.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-disabled-outcomes';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const makeHousehold = (orgId, campaignId, effortId, n) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: `${n} Toggle Ter`,
  city: 'Austin',
  state: 'TX',
  zipCode: '78701',
  normalizedAddress: `${n} toggle ter austin tx 78701`,
  location: { type: 'Point', coordinates: [-97.74 + n * 0.001, 30.26] },
  status: 'unknocked',
  isActive: true,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, CampaignManager, CampaignChange, Effort, Pass, Turf, Household, CanvassActivity, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Toggle Org', slug: 'toggle-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'toa@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lena', lastName: 'Lead', email: 'tol@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'toc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Toggle C', type: 'survey', state: 'TX', timeZone: 'America/Chicago', isActive: true,
  });
  // The mobile write path gates on CampaignAssignment; the lead's PATCH on a manager grant.
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: canv._id });
  await CampaignManager.create({ organizationId: org._id, campaignId: campaign._id, userId: lead._id, isActive: true });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Intake' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date(),
  });

  const doors = await Household.insertMany([1, 2, 3, 4].map((n) => makeHousehold(org._id, campaign._id, effort._id, n)));
  // A published book so the bulk-restrict desk path has something to mark.
  const turf = await Turf.create({
    organizationId: org._id, campaignId: campaign._id, passId: pass._id, name: 'Book T', mode: 'geometric',
    status: 'published', householdIds: [doors[3]._id], doorCount: 1,
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, canv, campaign, effort, pass, turf, doors,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead), canvTok: signUserToken(canv),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

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
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const asLead = () => ({ token: ctx.leadTok, orgId: ctx.org._id });
const knock = (id, path, extra = {}) =>
  call('POST', `/mobile/households/${id}/${path}`, {
    token: ctx.canvTok, orgId: ctx.org._id,
    body: { location: { lat: 30.26, lng: -97.74, accuracy: 5 }, ...extra },
  });

test('zod rejects always-on and junk keys — no config state can gut canvassing', { skip }, async () => {
  for (const bad of [['not_home'], ['survey_submitted'], ['lit_dropped'], ['door_slammed']]) {
    const r = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, { ...asAdmin(), body: { disabledOutcomes: bad } });
    assert.equal(r.status, 400, `'${bad}' must be rejected`);
  }
});

test('admin PATCH sets it (deduped), the list carries it, and the audit row is a sorted join', { skip }, async () => {
  // Deliberately unsorted + duplicated input: storage dedupes, the audit sorts.
  const r = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
    ...asAdmin(), body: { disabledOutcomes: ['restricted', 'refused', 'refused'] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));

  const list = await call('GET', '/admin/campaigns', asAdmin());
  const row = list.json.campaigns.find((c) => String(c._id) === String(ctx.campaign._id));
  assert.deepEqual([...row.disabledOutcomes].sort(), ['refused', 'restricted']);

  const changes = await CampaignChange.find({ campaignId: ctx.campaign._id, field: 'disabledOutcomes' }).lean();
  assert.equal(changes.length, 1, 'exactly one audit row for the flip');
  assert.equal(changes[0].fromValue, null, 'legacy/empty must normalize to null, not ""');
  assert.equal(changes[0].toValue, 'refused,restricted', 'sorted join, whatever order the client sent');
});

test('a team lead can edit it, and a reordered no-op PATCH writes no phantom audit row', { skip }, async () => {
  const r = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, {
    ...asLead(), body: { disabledOutcomes: ['refused', 'restricted'] }, // same set, other order
  });
  assert.equal(r.status, 200, `a lead must be able to edit disabledOutcomes: ${JSON.stringify(r.json)}`);
  const changes = await CampaignChange.countDocuments({ campaignId: ctx.campaign._id, field: 'disabledOutcomes' });
  assert.equal(changes, 1, 'a reorder is not a change — still the single row from the admin flip');
});

test('a FRESH submission of a disabled outcome is refused and writes nothing', { skip }, async () => {
  const door = ctx.doors[0];
  const r = await knock(door._id, 'refused');
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'OUTCOME_DISABLED', JSON.stringify(r.json));
  assert.equal(await CanvassActivity.countDocuments({ householdId: door._id }), 0, 'the refusal must write no row');
  const doc = await Household.findById(door._id).lean();
  assert.equal(doc.status, 'unknocked', 'and must not touch the door');
});

test('an OFFLINE REPLAY recorded before the toggle flipped is accepted', { skip }, async () => {
  const door = ctx.doors[0];
  const r = await knock(door._id, 'refused', {
    wasOfflineSubmission: true,
    timestamp: new Date(Date.now() - 3600_000).toISOString(),
  });
  assert.equal(r.status, 201, `a queued knock must never be dropped by a policy flip: ${JSON.stringify(r.json)}`);
  assert.equal(await CanvassActivity.countDocuments({ householdId: door._id, actionType: 'refused' }), 1);
});

test('always-on outcomes are untouched while others are disabled', { skip }, async () => {
  const r = await knock(ctx.doors[1]._id, 'not-home');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  // And a toggleable outcome that is NOT disabled still records.
  const r2 = await knock(ctx.doors[2]._id, 'no-soliciting');
  assert.equal(r2.status, 201, JSON.stringify(r2.json));
});

test('both mobile wires carry the field', { skip }, async () => {
  const boot = await call('GET', `/mobile/bootstrap?campaignId=${ctx.campaign._id}`, { token: ctx.canvTok, orgId: ctx.org._id });
  assert.equal(boot.status, 200);
  assert.deepEqual([...boot.json.campaign.disabledOutcomes].sort(), ['refused', 'restricted']);

  const picker = await call('GET', '/mobile/campaigns', { token: ctx.canvTok, orgId: ctx.org._id });
  assert.equal(picker.status, 200);
  const row = picker.json.campaigns.find((c) => c.id === String(ctx.campaign._id));
  assert.deepEqual([...row.disabledOutcomes].sort(), ['refused', 'restricted']);
});

test('the admin bulk-restrict desk path is deliberately unaffected by the toggle', { skip }, async () => {
  // `restricted` is disabled right now — the desk path belongs to the same roles that own the
  // toggle, and its via:'bulk' rows never count as field work, so it stays open.
  const r = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/restrict-bulk`, {
    ...asAdmin(), body: { turfIds: [String(ctx.turf._id)] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.marked, 1);
  const bulkRows = await CanvassActivity.find({ householdId: ctx.doors[3]._id }).lean();
  assert.equal(bulkRows.length, 1);
  assert.equal(bulkRows[0].actionType, 'restricted');
  assert.equal(bulkRows[0].via, 'bulk');
});

test('re-enabling everything clears the block', { skip }, async () => {
  const r = await call('PATCH', `/admin/campaigns/${ctx.campaign._id}`, { ...asAdmin(), body: { disabledOutcomes: [] } });
  assert.equal(r.status, 200);
  // Audit: the clear is its own row, back to null.
  const changes = await CampaignChange.find({ campaignId: ctx.campaign._id, field: 'disabledOutcomes' }).sort({ createdAt: 1 }).lean();
  assert.equal(changes.length, 2);
  assert.equal(changes[1].fromValue, 'refused,restricted');
  assert.equal(changes[1].toValue, null);

  const rf = await knock(ctx.doors[1]._id, 'refused');
  assert.equal(rf.status, 201, `refused must record again once re-enabled: ${JSON.stringify(rf.json)}`);
});
