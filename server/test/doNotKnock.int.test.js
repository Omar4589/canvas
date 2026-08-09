import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Address-level DO NOT KNOCK, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/dnk_test node --test test/doNotKnock.int.test.js
//
// The contract this locks, in the order the design turns on it:
//   - the role gate: canvassers never, leads only inside a campaign they manage, admins anywhere
//   - SIBLING FAN-OUT — one address, three campaigns, one request suppresses all three. This is
//     the reason DoNotKnockAddress exists instead of a Household boolean.
//   - it OUTLIVES a campaign delete, and a re-import re-suppresses the door
//   - it NEVER auto-reopens for a new resident — asserted side by side with the fullyDnc case
//     that DOES reopen, so the divergence is deliberate and stays visible
//   - independence from person-level DNC in both directions
//   - the unconditional Household.updatedAt bump the mobile /changes delta depends on
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-dnk';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { DoNotKnockAddress } = await import('../src/models/DoNotKnockAddress.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { recomputeFullyDnc } = await import('../src/services/dnc/recomputeFullyDnc.js');
const {
  recomputeDoNotKnock,
} = await import('../src/services/dnc/recomputeDoNotKnock.js');
const {
  reapplyDoNotKnock, suppressedAddressSet, setDoNotKnock, clearDoNotKnock,
} = await import('../src/services/dnc/doNotKnock.js');
const { resolveWalkList } = await import('../src/services/walklist/resolveWalkList.js');
const { coverageBucketExpr } = await import('../src/services/reports/aggregations.js');
const { KNOCKABLE_DOOR_FILTER } = await import('../src/services/canvass/knockableDoorFilter.js');
const { deleteOrganization } = await import('../src/services/platform/deleteOrganization.js');
const { runImport } = await import('../src/services/import/csvImporter.js');
const { normalizeAddress, looseAddressKey } = await import('../src/utils/normalizeAddress.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const D1 = { lng: -81.4, lat: 28.3 };
const D2 = { lng: -81.39, lat: 28.3 };

// SHARED across campaigns on purpose — this exact string is the sibling key.
const SHARED_ADDR = { addressLine1: '1 Knock St', city: 'Town', state: 'FL', zipCode: '34741' };
const SHARED_NORM = '1 KNOCK ST||TOWN|FL|34741';

function hh(orgId, campaignId, effortId, addr, norm, pin) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    ...addr,
    normalizedAddress: norm,
    location: { type: 'Point', coordinates: [pin.lng, pin.lat] },
    isActive: true,
    status: 'unknocked',
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Subscription, Campaign, CampaignAssignment, CampaignManager,
    Effort, Pass, Turf, TurfAssignment, Household, Voter, DoNotKnockAddress, SurveyTemplate,
  ]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'DNK Org', slug: 'dnk-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ka@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'kl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Walker', email: 'kc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'T', questions: [], isActive: true });

  // TWO campaigns holding the SAME address — the sibling fixture the whole model exists for.
  const campA = await Campaign.create({
    organizationId: org._id, name: 'Camp A', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: template._id,
  });
  const campB = await Campaign.create({
    organizationId: org._id, name: 'Camp B', type: 'survey', state: 'FL', isActive: true, surveyTemplateId: template._id,
  });
  // The lead manages A only — so the same request is allowed on A's door and refused on B's.
  await CampaignManager.create({ organizationId: org._id, campaignId: campA._id, userId: lead._id });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campA._id, userId: canv._id });

  const effortA = await Effort.create({ organizationId: org._id, campaignId: campA._id, name: 'North' });
  const effortB = await Effort.create({ organizationId: org._id, campaignId: campB._id, name: 'North' });
  const passA = await Pass.create({
    organizationId: org._id, campaignId: campA._id, effortId: effortA._id, roundNumber: 1, name: 'R1', status: 'active',
  });

  // hhA1 (campaign A) and hhB1 (campaign B) are the SAME address; hhA2 is a control door.
  const [hhA1, hhA2] = await Household.insertMany([
    hh(org._id, campA._id, effortA._id, SHARED_ADDR, SHARED_NORM, D1),
    hh(org._id, campA._id, effortA._id, { addressLine1: '2 Knock St', city: 'Town', state: 'FL', zipCode: '34741' }, '2 KNOCK ST||TOWN|FL|34741', D2),
  ]);
  const hhB1 = await Household.create(hh(org._id, campB._id, effortB._id, SHARED_ADDR, SHARED_NORM, D1));

  const turf = await Turf.create({
    organizationId: org._id, campaignId: campA._id, passId: passA._id, name: 'Book K', mode: 'geometric',
    status: 'published', householdIds: [hhA1._id, hhA2._id], doorCount: 2,
  });
  await TurfAssignment.create({
    organizationId: org._id, campaignId: campA._id, passId: passA._id, turfId: turf._id, userId: canv._id,
  });

  const [v1, v2, v3] = await Voter.insertMany([
    { organizationId: org._id, campaignId: campA._id, householdId: hhA1._id, stateVoterId: 'KV1X', firstName: 'Vera', lastName: 'One', fullName: 'Vera One' },
    { organizationId: org._id, campaignId: campA._id, householdId: hhA1._id, stateVoterId: 'KV2X', firstName: 'Vic', lastName: 'Two', fullName: 'Vic Two' },
    { organizationId: org._id, campaignId: campA._id, householdId: hhA2._id, stateVoterId: 'KV3X', firstName: 'Val', lastName: 'Three', fullName: 'Val Three' },
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, campA, campB, admin, lead, canv, hhA1, hhA2, hhB1, v1, v2, v3, effortA, passA, template,
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
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

// Back to a known state: no requests anywhere, no person-level flags, every door recomputed.
async function reset() {
  await DoNotKnockAddress.deleteMany({});
  await Voter.updateMany({}, { $set: { doNotContact: null } });
  const ids = await Household.find({ organizationId: ctx.org._id }, { _id: 1 }).lean();
  await recomputeDoNotKnock(ids.map((h) => h._id));
  await recomputeFullyDnc(ids.map((h) => h._id));
}

test('1. role gate: canvasser never; lead only in a campaign they manage; admin anywhere', { skip }, async () => {
  await reset();

  const canvasser = await call('POST', `/admin/households/${ctx.hhA1._id}/do-not-knock`, {
    token: ctx.canvTok, orgId: ctx.org._id, body: { reason: 'Should never land' },
  });
  assert.strictEqual(canvasser.status, 403, 'a canvasser cannot suppress an address (owner ruling)');

  // The lead manages campaign A but NOT B — same address, opposite answers.
  const leadOnB = await call('POST', `/admin/households/${ctx.hhB1._id}/do-not-knock`, {
    token: ctx.leadTok, orgId: ctx.org._id, body: { reason: 'Outside my campaigns' },
  });
  assert.strictEqual(leadOnB.status, 403, "a lead cannot reach a door in a campaign they don't manage");
  assert.strictEqual(await DoNotKnockAddress.countDocuments({}), 0, 'the refused attempts wrote nothing');

  const short = await call('POST', `/admin/households/${ctx.hhA1._id}/do-not-knock`, {
    ...asAdmin(), body: { reason: 'no' },
  });
  assert.strictEqual(short.status, 400, 'a reason under 3 chars is refused');

  const leadOnA = await call('POST', `/admin/households/${ctx.hhA1._id}/do-not-knock`, {
    token: ctx.leadTok, orgId: ctx.org._id, body: { reason: 'Resident asked us never to return' },
  });
  assert.strictEqual(leadOnA.status, 201);
  const rec = await DoNotKnockAddress.findOne({ normalizedAddress: SHARED_NORM }).lean();
  assert.strictEqual(rec.source, 'lead', 'the acting role is recorded');
  assert.strictEqual(String(rec.byUserId), String(ctx.lead._id));
});

test('2. sibling fan-out: one request suppresses the address in EVERY campaign', { skip }, async () => {
  await reset();
  const r = await call('POST', `/admin/households/${ctx.hhA1._id}/do-not-knock`, {
    ...asAdmin(), body: { reason: 'Asked never to return' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.doorsAffected, 2, 'both campaigns had their row for this address touched');

  assert.strictEqual((await Household.findById(ctx.hhA1._id).lean()).doNotKnock, true);
  assert.strictEqual(
    (await Household.findById(ctx.hhB1._id).lean()).doNotKnock, true,
    'the door in the OTHER campaign is suppressed too — the whole reason the record is org-level'
  );
  assert.strictEqual((await Household.findById(ctx.hhA2._id).lean()).doNotKnock, false, 'the control door is untouched');

  // ...and lifting it releases every sibling.
  const cleared = await call('DELETE', `/admin/households/${ctx.hhA1._id}/do-not-knock`, asAdmin());
  assert.strictEqual(cleared.status, 200);
  assert.strictEqual((await Household.findById(ctx.hhA1._id).lean()).doNotKnock, false);
  assert.strictEqual((await Household.findById(ctx.hhB1._id).lean()).doNotKnock, false);
});

test('3. independent of person-level DNC in BOTH directions', { skip }, async () => {
  await reset();

  // Suppressing the door leaves every resident's own flag alone.
  await setDoNotKnock({
    organizationId: ctx.org._id,
    household: await Household.findById(ctx.hhA1._id).lean(),
    reason: 'Door-level request',
    source: 'admin',
    byUserId: ctx.admin._id,
  });
  for (const id of [ctx.v1._id, ctx.v2._id]) {
    const v = await Voter.findById(id).lean();
    assert.ok(!v.doNotContact?.flagged, 'a door request never flags the people behind it');
  }

  // And flagging every resident sets fullyDnc — but never doNotKnock.
  await reset();
  await Voter.updateMany(
    { householdId: ctx.hhA1._id },
    { $set: { doNotContact: { flagged: true, at: new Date(), source: 'admin', reason: 'r' } } }
  );
  await recomputeFullyDnc([ctx.hhA1._id]);
  const h = await Household.findById(ctx.hhA1._id).lean();
  assert.strictEqual(h.fullyDnc, true);
  assert.strictEqual(h.doNotKnock, false, 'an all-DNC door is not a do-not-knock address');
});

test('4. suppressed doors leave cutting, books and the walk list; stay on the admin map', { skip }, async () => {
  await reset();
  await setDoNotKnock({
    organizationId: ctx.org._id,
    household: await Household.findById(ctx.hhA1._id).lean(),
    reason: 'Asked never to return',
    source: 'admin',
    byUserId: ctx.admin._id,
  });

  const knockable = await Household.find({ campaignId: ctx.campA._id, ...KNOCKABLE_DOOR_FILTER }, { _id: 1 }).lean();
  const knockableIds = knockable.map((x) => String(x._id));
  assert.ok(!knockableIds.includes(String(ctx.hhA1._id)), 'the shared KNOCKABLE_DOOR_FILTER excludes it');
  assert.ok(knockableIds.includes(String(ctx.hhA2._id)), 'the control door still cuts');

  // Ruling (Aug 2026): the walk-list PREVIEW must match what actually cuts, so the suppression
  // is applied in resolveWalkList's base set, not only later in generateTurf.
  const resolved = await resolveWalkList(await Campaign.findById(ctx.campA._id).lean(), {});
  const ids = resolved.householdIds.map(String);
  assert.ok(!ids.includes(String(ctx.hhA1._id)), 'walk-list resolution excludes it');
  assert.strictEqual(resolved.householdCount, 1, 'householdCount reports what would really cut');

  // The admin map deliberately still shows it — that map is the record of work performed.
  const map = await call('GET', `/admin/households/map?campaignId=${ctx.campA._id}`, asAdmin());
  assert.strictEqual(map.status, 200);
  const onMap = map.json.households.find((x) => x.id === String(ctx.hhA1._id));
  assert.ok(onMap, 'the suppressed door is still on the admin map');
  assert.strictEqual(onMap.doNotKnock, true, 'and it is flagged so the panel can badge it');
});

test('5. an unknocked suppressed door gets its own coverage bucket, outranking dnc and voted', { skip }, async () => {
  await reset();
  // Make the door BOTH all-DNC and do-not-knock: the strongest bucket must win exactly once.
  await Voter.updateMany(
    { householdId: ctx.hhA1._id },
    { $set: { doNotContact: { flagged: true, at: new Date(), source: 'admin', reason: 'r' } } }
  );
  await recomputeFullyDnc([ctx.hhA1._id]);
  await setDoNotKnock({
    organizationId: ctx.org._id,
    household: await Household.findById(ctx.hhA1._id).lean(),
    reason: 'Asked never to return',
    source: 'admin',
    byUserId: ctx.admin._id,
  });

  const rows = await Household.aggregate([
    { $match: { campaignId: ctx.campA._id } },
    { $group: { _id: coverageBucketExpr, n: { $sum: 1 } } },
  ]);
  const byBucket = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  assert.strictEqual(byBucket.doNotKnock, 1, 'it lands in doNotKnock');
  assert.ok(!byBucket.dnc, 'and NOT also in dnc — buckets are disjoint so segments sum to the universe');
  assert.strictEqual(byBucket.unknocked, 1, 'the control door is still plain unknocked');
});

test('6. every recompute bumps updatedAt, even when the value did not change', { skip }, async () => {
  await reset();
  const before = await Household.findById(ctx.hhA2._id).lean();
  await new Promise((r) => setTimeout(r, 10));
  // hhA2 is NOT suppressed — this recompute writes false over false.
  await recomputeDoNotKnock([ctx.hhA2._id]);
  const after = await Household.findById(ctx.hhA2._id).lean();
  assert.ok(
    after.updatedAt > before.updatedAt,
    'the unconditional $set must bump updatedAt — the mobile /changes delta keys on it'
  );
});

test('7. setting twice never restamps the original request', { skip }, async () => {
  await reset();
  const door = await Household.findById(ctx.hhA1._id).lean();
  await setDoNotKnock({
    organizationId: ctx.org._id, household: door, reason: 'First reason', source: 'admin', byUserId: ctx.admin._id,
  });
  const first = await DoNotKnockAddress.findOne({ normalizedAddress: SHARED_NORM }).lean();

  const again = await setDoNotKnock({
    organizationId: ctx.org._id, household: door, reason: 'Second reason', source: 'lead', byUserId: ctx.lead._id,
  });
  assert.strictEqual(again.created, false, 'the second set reports it already existed');
  const now = await DoNotKnockAddress.findOne({ normalizedAddress: SHARED_NORM }).lean();
  assert.strictEqual(now.reason, 'First reason', 'the ORIGINAL reason survives');
  assert.strictEqual(String(now.byUserId), String(first.byUserId), 'and the original author');
  assert.strictEqual(await DoNotKnockAddress.countDocuments({ normalizedAddress: SHARED_NORM }), 1);
});

test('8. survives a campaign delete, and a re-import re-suppresses the door', { skip }, async () => {
  await reset();
  await setDoNotKnock({
    organizationId: ctx.org._id,
    household: await Household.findById(ctx.hhA1._id).lean(),
    reason: 'Asked never to return',
    source: 'admin',
    byUserId: ctx.admin._id,
  });

  // Simulate the campaign-delete cascade for this address: its Household rows go away. The
  // request must NOT — there is no parking step for it, by design.
  await Household.deleteMany({ normalizedAddress: SHARED_NORM });
  const survived = await DoNotKnockAddress.findOne({ organizationId: ctx.org._id, normalizedAddress: SHARED_NORM }).lean();
  assert.ok(survived, 'the request outlives every door that carried it');
  assert.strictEqual(survived.addressLine1, '1 Knock St', 'and still names the address it is about');

  // csvImporter asks this exact question to decide its $setOnInsert.
  const seed = await suppressedAddressSet(ctx.org._id, [SHARED_NORM, '2 KNOCK ST||TOWN|FL|34741']);
  assert.ok(seed.has(SHARED_NORM), 'a re-import of this address inserts the door already suppressed');
  assert.ok(!seed.has('2 KNOCK ST||TOWN|FL|34741'));

  // A door that arrives WITHOUT the seed (e.g. it already existed) is caught by the reapply hook.
  const reimported = await Household.create(
    hh(ctx.org._id, ctx.campA._id, ctx.effortA._id, SHARED_ADDR, SHARED_NORM, D1)
  );
  assert.strictEqual(reimported.doNotKnock, false, 'precondition: it came back knockable');
  await reapplyDoNotKnock(ctx.org._id, ctx.campA._id);
  assert.strictEqual((await Household.findById(reimported._id).lean()).doNotKnock, true);

  ctx.hhA1 = reimported; // later tests address the live row
});

test('9. NEVER auto-reopens for a new resident — the deliberate inverse of fullyDnc', { skip }, async () => {
  await reset();
  const door = await Household.findById(ctx.hhA1._id).lean();

  // Give the door its own residents rather than relying on earlier tests' — the re-import in
  // test 8 replaced this row with a voter-less one, and recomputeFullyDnc's >=1-voter guard would
  // then make the baseline below vacuously false.
  await Voter.deleteMany({ householdId: door._id });
  await Voter.insertMany([
    { organizationId: ctx.org._id, campaignId: ctx.campA._id, householdId: door._id, stateVoterId: 'KR1', firstName: 'Res', lastName: 'One', fullName: 'Res One' },
    { organizationId: ctx.org._id, campaignId: ctx.campA._id, householdId: door._id, stateVoterId: 'KR2', firstName: 'Res', lastName: 'Two', fullName: 'Res Two' },
  ]);

  // Baseline: an all-DNC door DOES reopen when an unflagged resident appears.
  await Voter.updateMany(
    { householdId: door._id },
    { $set: { doNotContact: { flagged: true, at: new Date(), source: 'admin', reason: 'r' } } }
  );
  await recomputeFullyDnc([door._id]);
  assert.strictEqual((await Household.findById(door._id).lean()).fullyDnc, true);
  const newcomer = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.campA._id, householdId: door._id,
    stateVoterId: 'KNEW1', firstName: 'New', lastName: 'Resident', fullName: 'New Resident',
  });
  await recomputeFullyDnc([door._id]);
  assert.strictEqual(
    (await Household.findById(door._id).lean()).fullyDnc, false,
    'fullyDnc reopens for someone who asked for nothing'
  );

  // Do-not-knock does NOT. The request was about the address; new names are not consent.
  await setDoNotKnock({
    organizationId: ctx.org._id, household: door, reason: 'Asked never to return',
    source: 'admin', byUserId: ctx.admin._id,
  });
  await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.campA._id, householdId: door._id,
    stateVoterId: 'KNEW2', firstName: 'Later', lastName: 'Arrival', fullName: 'Later Arrival',
  });
  await reapplyDoNotKnock(ctx.org._id, ctx.campA._id);
  await recomputeDoNotKnock([door._id]);
  assert.strictEqual(
    (await Household.findById(door._id).lean()).doNotKnock, true,
    'a new resident must NOT reopen a do-not-knock address'
  );

  await Voter.deleteMany({ stateVoterId: { $in: ['KNEW1', 'KNEW2', 'KR1', 'KR2'] } });
  await newcomer.deleteOne().catch(() => {});
});

test('10. the register lists it, flags turnover, and lifts by record id when no doors remain', { skip }, async () => {
  await reset();
  await setDoNotKnock({
    organizationId: ctx.org._id,
    household: await Household.findById(ctx.hhA1._id).lean(),
    reason: 'Asked never to return',
    source: 'admin',
    byUserId: ctx.admin._id,
  });

  // A voter imported AFTER the request is the re-review prompt (nothing reopens on its own).
  await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.campA._id, householdId: ctx.hhA1._id,
    stateVoterId: 'KTURN1', firstName: 'Turn', lastName: 'Over', fullName: 'Turn Over',
  });

  const list = await call('GET', '/admin/do-not-knock', asAdmin());
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.json.total, 1);
  const row = list.json.records[0];
  assert.strictEqual(row.reason, 'Asked never to return');
  assert.ok(row.doors >= 1, 'live doors are counted');
  assert.strictEqual(row.newResidents, 1, 'turnover since the request is surfaced for a human');

  // Leads must not read the org-wide register.
  const asLead = await call('GET', '/admin/do-not-knock', { token: ctx.leadTok, orgId: ctx.org._id });
  assert.strictEqual(asLead.status, 403, 'the register is admin-only — it spans campaigns a lead cannot see');

  // Delete every door, then lift by record id: the only path once no householdId exists.
  await Household.deleteMany({ normalizedAddress: SHARED_NORM });
  const del = await call('DELETE', `/admin/do-not-knock/${row.id}`, asAdmin());
  assert.strictEqual(del.status, 200);
  assert.strictEqual(await DoNotKnockAddress.countDocuments({}), 0);

  await Voter.deleteMany({ stateVoterId: 'KTURN1' });
  ctx.hhA1 = await Household.create(hh(ctx.org._id, ctx.campA._id, ctx.effortA._id, SHARED_ADDR, SHARED_NORM, D1));
});

test('11. clearing a request that does not exist is a 404, not a silent success', { skip }, async () => {
  await reset();
  const r = await call('DELETE', `/admin/households/${ctx.hhA2._id}/do-not-knock`, asAdmin());
  assert.strictEqual(r.status, 404);
  const direct = await clearDoNotKnock({ organizationId: ctx.org._id, normalizedAddress: 'NOPE|||' });
  assert.strictEqual(direct.cleared, false);
});

// Tests 8 and 9 call suppressedAddressSet / reapplyDoNotKnock DIRECTLY. That proves the services
// work but NOT that csvImporter is actually wired to them — the seeding lives in a $setOnInsert
// deep inside the household bulkWrite, which a service-level test never touches. This one drives
// a REAL import end to end so the wiring itself is under test.
test('12. a REAL import inserts an already-suppressed door (csvImporter $setOnInsert wiring)', { skip }, async () => {
  await reset();
  const addr = { addressLine1: '77 Import Rd', city: 'Town', state: 'FL', zipCode: '34741' };
  // Build the request key with the REAL normalizer, never a hand-written string — the exact key
  // is the entire sibling mechanism, and a fixture that merely looks right proves nothing.
  const norm = normalizeAddress(addr);

  await DoNotKnockAddress.create({
    organizationId: ctx.org._id,
    normalizedAddress: norm,
    looseKey: looseAddressKey(addr),
    ...addr,
    reason: 'Asked never to return, before this file was ever imported',
    source: 'admin',
    byUserId: ctx.admin._id,
    at: new Date(),
  });
  assert.strictEqual(
    await Household.countDocuments({ campaignId: ctx.campA._id, normalizedAddress: norm }), 0,
    'precondition: the door does not exist yet'
  );

  const csv = [
    'State Voter ID,First Name,Last Name,Address,City,Registered State,Zip Code,p_Latitude,p_Longitude',
    `IMP001,Ida,Import,${addr.addressLine1},${addr.city},${addr.state},${addr.zipCode},28.3,-81.4`,
  ].join('\n');
  await runImport({
    buffer: Buffer.from(csv, 'utf8'),
    filename: 'dnk-seed.csv',
    userId: ctx.admin._id,
    campaignId: ctx.campA._id,
    organizationId: ctx.org._id,
  });

  const door = await Household.findOne({ campaignId: ctx.campA._id, normalizedAddress: norm }).lean();
  assert.ok(door, 'the import created the door');
  assert.strictEqual(
    door.doNotKnock, true,
    'it must arrive suppressed — not knockable until some later recompute'
  );
  // And it is genuinely out of the knockable set, not merely flagged.
  const knockable = await Household.countDocuments({ _id: door._id, ...KNOCKABLE_DOOR_FILTER });
  assert.strictEqual(knockable, 0);
});

test('13. org deletion sweeps the register', { skip }, async () => {
  await reset();
  await setDoNotKnock({
    organizationId: ctx.org._id,
    household: await Household.findById(ctx.hhA1._id).lean(),
    reason: 'Asked never to return',
    source: 'admin',
    byUserId: ctx.admin._id,
  });
  assert.strictEqual(await DoNotKnockAddress.countDocuments({ organizationId: ctx.org._id }), 1);

  await deleteOrganization(ctx.org._id);
  assert.strictEqual(
    await DoNotKnockAddress.countDocuments({ organizationId: ctx.org._id }), 0,
    'DoNotKnockAddress must be in ORG_SCOPED — the gap that was missed for DncPendingId once'
  );
});
