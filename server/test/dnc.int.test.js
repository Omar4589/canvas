import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Do-not-contact core contract, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/dnc_test node --test test/dnc.int.test.js
// Locks: the admin-only role gate (leads/canvassers 403), reason validation + the VoterNote
// trail, the fullyDnc recompute + UNCONDITIONAL Household.updatedAt bump (the Mongoose-8
// bulkWrite-timestamps behavior the mobile /changes delta depends on), the clear transition,
// the mobile survey backstop (403 DO_NOT_CONTACT, zero rows), the boolean-only wire privacy
// contract on /mobile/bootstrap, the directory dnc filter, and the always-on walk-list /
// CSV-export exclusion.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-dnc';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { VoterNote } = await import('../src/models/VoterNote.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { recomputeFullyDnc } = await import('../src/services/dnc/recomputeFullyDnc.js');
const { recomputeHouseholdStatusesByIds } = await import('../src/services/canvass/status.js');
const { resolveWalkList } = await import('../src/services/walklist/resolveWalkList.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const D1 = { lng: -81.4, lat: 28.3 };
const D2 = { lng: -81.39, lat: 28.3 };
// ~5 m north of a pin — a clean GPS fix for the survey-backstop submit.
const near = (pin) => ({ lat: pin.lat + 0.000045, lng: pin.lng, accuracy: 5 });

function hh(orgId, campaignId, effortId, n, pin) {
  return {
    organizationId: orgId,
    campaignId,
    effortId,
    addressLine1: `${n} Dnc St`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${n} DNC ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [pin.lng, pin.lat] },
    isActive: true,
    status: 'unknocked',
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, Voter, VoterNote, SurveyTemplate, SurveyResponse, CanvassActivity, SavedSearch]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'DNC Org', slug: 'dnc-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'da@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'dl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Walker', email: 'dc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'DNC Survey', questions: [], isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'DNC C', type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: template._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });

  // Real turf fixture so the canvasser's mobile submits + bootstrap scope work: an effort,
  // an active round, one published book holding both doors, assigned to the canvasser.
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const [hhA, hhB] = await Household.insertMany([
    hh(org._id, camp._id, effort._id, 1, D1),
    hh(org._id, camp._id, effort._id, 2, D2),
  ]);
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book D', mode: 'geometric',
    status: 'published', householdIds: [hhA._id, hhB._id], doorCount: 2,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  // HH-A houses two voters (V1, V2); HH-B one (V3). Distinct svids, none a substring of another.
  const [v1, v2, v3] = await Voter.insertMany([
    { organizationId: org._id, householdId: hhA._id, stateVoterId: 'DNCV1X', firstName: 'Vera', lastName: 'One', fullName: 'Vera One' },
    { organizationId: org._id, householdId: hhA._id, stateVoterId: 'DNCV2X', firstName: 'Vic', lastName: 'Two', fullName: 'Vic Two' },
    { organizationId: org._id, householdId: hhB._id, stateVoterId: 'DNCV3X', firstName: 'Val', lastName: 'Three', fullName: 'Val Three' },
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, template, admin, lead, canv, hhA, hhB, v1, v2, v3, effort, pass,
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

async function callText(method, path, { token, orgId } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
  });
  return { status: res.status, text: await res.text() };
}

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

// Wipe every flag + recompute both doors, so each test starts from a known state.
async function resetFlags() {
  await Voter.updateMany({}, { $set: { doNotContact: null } });
  await recomputeFullyDnc([ctx.hhA._id, ctx.hhB._id]);
}

test('1. role gate: lead and canvasser 403, admin flags with a reason', { skip }, async () => {
  for (const token of [ctx.leadTok, ctx.canvTok]) {
    const r = await call('POST', `/admin/voters/${ctx.v1._id}/dnc`, {
      token, orgId: ctx.org._id, body: { reason: 'Should never land' },
    });
    assert.strictEqual(r.status, 403, 'non-admin roles cannot set the flag');
    assert.strictEqual(r.json.code, 'FORBIDDEN_ROLE');
  }
  assert.ok(!(await Voter.findById(ctx.v1._id).lean()).doNotContact?.flagged, 'the refused attempts wrote nothing');

  const ok = await call('POST', `/admin/voters/${ctx.v1._id}/dnc`, {
    ...asAdmin(), body: { reason: 'Asked at the door to be left alone' },
  });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.voter.doNotContact.flagged, true, 'profile JSON reflects the flag');
});

test('2. reason validation: missing and too-short refused; valid stamps the subdoc + a VoterNote', { skip }, async () => {
  await resetFlags();

  const missing = await call('POST', `/admin/voters/${ctx.v1._id}/dnc`, { ...asAdmin(), body: {} });
  assert.strictEqual(missing.status, 400, 'no reason → 400');
  const short = await call('POST', `/admin/voters/${ctx.v1._id}/dnc`, { ...asAdmin(), body: { reason: 'no' } });
  assert.strictEqual(short.status, 400, 'two-char reason → 400');
  assert.ok(!(await Voter.findById(ctx.v1._id).lean()).doNotContact?.flagged, 'refused attempts wrote nothing');

  const reason = 'Requested removal by certified mail';
  const ok = await call('POST', `/admin/voters/${ctx.v1._id}/dnc`, { ...asAdmin(), body: { reason } });
  assert.strictEqual(ok.status, 200);

  const sub = (await Voter.findById(ctx.v1._id).lean()).doNotContact;
  assert.strictEqual(sub.flagged, true);
  assert.strictEqual(sub.source, 'admin');
  assert.strictEqual(String(sub.byUserId), String(ctx.admin._id));
  assert.strictEqual(sub.uploadId, null);
  assert.strictEqual(sub.reason, reason);
  assert.ok(sub.at instanceof Date || typeof sub.at === 'string', 'transition stamped');

  const note = await VoterNote.findOne({ voterId: ctx.v1._id, body: new RegExp(reason) }).lean();
  assert.ok(note, 'a VoterNote carries the reason (the durable history)');
  assert.strictEqual(String(note.authorId), String(ctx.admin._id));
});

test('3. recompute + updatedAt: fullyDnc flips where warranted; updatedAt bumps UNCONDITIONALLY', { skip }, async () => {
  await resetFlags();

  // Single-voter door: flagging V3 makes HH-B fully DNC, and updatedAt must move — this PINS
  // the Mongoose-8 bulkWrite auto-timestamp behavior the mobile /changes delta keys on.
  const bBefore = (await Household.findById(ctx.hhB._id).lean()).updatedAt;
  const r3 = await call('POST', `/admin/voters/${ctx.v3._id}/dnc`, { ...asAdmin(), body: { reason: 'Household asked us to stop' } });
  assert.strictEqual(r3.status, 200);
  const bAfter = await Household.findById(ctx.hhB._id).lean();
  assert.strictEqual(bAfter.fullyDnc, true, 'sole resident flagged → door fully DNC');
  assert.ok(
    new Date(bAfter.updatedAt).getTime() > new Date(bBefore).getTime(),
    'HH-B.updatedAt strictly bumped (bulkWrite timestamps)'
  );

  // Two-voter door: flagging one of two must NOT flip fullyDnc, but updatedAt STILL bumps —
  // the unconditional-write contract that pushes the voter-level flip to bootstrapped phones.
  const aBefore = (await Household.findById(ctx.hhA._id).lean()).updatedAt;
  const r1 = await call('POST', `/admin/voters/${ctx.v1._id}/dnc`, { ...asAdmin(), body: { reason: 'One resident asked us to stop' } });
  assert.strictEqual(r1.status, 200);
  const aAfter = await Household.findById(ctx.hhA._id).lean();
  assert.strictEqual(aAfter.fullyDnc, false, 'a non-flagged housemate keeps the door open');
  assert.ok(
    new Date(aAfter.updatedAt).getTime() > new Date(aBefore).getTime(),
    'HH-A.updatedAt bumps even though fullyDnc did not change'
  );
});

test('4. clear: fresh stamp, door reopens, second clear is a no-op', { skip }, async () => {
  // Continues from test 3: V1 + V3 flagged, HH-B fullyDnc.
  const setStamp = (await Voter.findById(ctx.v3._id).lean()).doNotContact.at;

  const r = await call('DELETE', `/admin/voters/${ctx.v3._id}/dnc`, asAdmin());
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.voter.doNotContact.flagged, false);

  const sub = (await Voter.findById(ctx.v3._id).lean()).doNotContact;
  assert.strictEqual(sub.flagged, false);
  assert.strictEqual(String(sub.byUserId), String(ctx.admin._id), 'clear stamps who');
  assert.ok(new Date(sub.at).getTime() > new Date(setStamp).getTime(), 'clear stamps a FRESH at');
  assert.strictEqual(sub.reason, null);

  assert.strictEqual((await Household.findById(ctx.hhB._id).lean()).fullyDnc, false, 'door reopens');

  const again = await call('DELETE', `/admin/voters/${ctx.v3._id}/dnc`, asAdmin());
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.json.alreadyClear, true, 'second clear reports alreadyClear');
});

test('5. survey backstop: submit for a flagged voter → 403 DO_NOT_CONTACT, zero rows', { skip }, async () => {
  // V1 is still flagged (test 3); the canvasser has real books/round/assignment fixtures.
  const r = await call('POST', `/mobile/voters/${ctx.v1._id}/survey`, {
    token: ctx.canvTok,
    orgId: ctx.org._id,
    body: {
      surveyTemplateId: String(ctx.template._id),
      answers: [],
      location: near(D1),
      timestamp: new Date().toISOString(),
    },
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.code, 'DO_NOT_CONTACT', 'machine-readable code for the client alert');

  assert.strictEqual(await SurveyResponse.countDocuments({}), 0, 'no survey stored');
  assert.strictEqual(await CanvassActivity.countDocuments({ actionType: 'survey_submitted' }), 0, 'no activity row');
  assert.strictEqual((await Voter.findById(ctx.v1._id).lean()).surveyStatus, 'not_surveyed', 'voter status untouched');
});

test('6. wire privacy: bootstrap drops fully-DNC doors, ships dnc as a bare boolean', { skip }, async () => {
  // Re-flag V3 so HH-B is fully DNC again; V1 stays flagged at the mixed door HH-A.
  const flag = await call('POST', `/admin/voters/${ctx.v3._id}/dnc`, { ...asAdmin(), body: { reason: 'Asked again to be left alone' } });
  assert.strictEqual(flag.status, 200);

  const r = await call('GET', `/mobile/bootstrap?campaignId=${ctx.camp._id}`, {
    token: ctx.canvTok, orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);

  const hhIds = r.json.households.map((h) => String(h._id));
  assert.ok(!hhIds.includes(String(ctx.hhB._id)), 'fully-DNC door never reaches the phone');
  assert.ok(hhIds.includes(String(ctx.hhA._id)), 'the mixed door still ships');

  const wireV1 = r.json.voters.find((v) => String(v._id) === String(ctx.v1._id));
  assert.ok(wireV1, 'the flagged voter at the mixed door still ships');
  assert.strictEqual(wireV1.dnc, true, 'as a bare boolean');
  const wireV2 = r.json.voters.find((v) => String(v._id) === String(ctx.v2._id));
  assert.strictEqual(wireV2.dnc, false);

  // Regression-pin the boolean-only contract: the offline cache must never hold the
  // subdoc — no 'doNotContact' key, and no reason text, on ANY serialized voter.
  for (const v of r.json.voters) {
    const s = JSON.stringify(v);
    assert.ok(!('doNotContact' in v), 'no doNotContact key on the wire');
    assert.ok(!s.includes('reason'), 'no reason substring on the wire');
    assert.ok(!s.includes('left alone'), 'no reason TEXT on the wire');
  }
});

test('7. directory: ?dnc=true returns only flagged voters, ?dnc=false excludes them', { skip }, async () => {
  // Known state: exactly V1 flagged (admin subdoc written directly — the filter under test
  // is the directory query, not the endpoint).
  await resetFlags();
  await Voter.updateOne(
    { _id: ctx.v1._id },
    { $set: { doNotContact: { flagged: true, at: new Date(), byUserId: ctx.admin._id, reason: 'Directory filter fixture', source: 'admin', uploadId: null } } }
  );
  await recomputeFullyDnc([ctx.hhA._id]);

  const flagged = await call('GET', '/admin/voters?dnc=true', asAdmin());
  assert.strictEqual(flagged.status, 200);
  assert.strictEqual(flagged.json.total, 1);
  assert.strictEqual(flagged.json.voters.length, 1);
  assert.strictEqual(flagged.json.voters[0].id, String(ctx.v1._id));
  assert.strictEqual(flagged.json.voters[0].dnc, true, 'row carries the dnc boolean');

  const clear = await call('GET', '/admin/voters?dnc=false', asAdmin());
  assert.strictEqual(clear.status, 200);
  const ids = clear.json.voters.map((v) => v.id);
  assert.ok(!ids.includes(String(ctx.v1._id)), 'flagged voter excluded');
  assert.ok(ids.includes(String(ctx.v2._id)) && ids.includes(String(ctx.v3._id)), 'everyone else present');
});

test('8. walk lists + export: flagged voters drop from CSV and resolution; the DOOR stays', { skip }, async () => {
  // State from test 7: exactly V1 flagged. A frozen list holding all three voters — the
  // export joins LIVE DNC state, so a flag set AFTER the freeze still suppresses the row.
  const saved = await SavedSearch.create({
    organizationId: ctx.org._id,
    campaignId: ctx.camp._id,
    name: 'All doors',
    filter: {},
    householdIds: [ctx.hhA._id, ctx.hhB._id],
    voterIds: [ctx.v1._id, ctx.v2._id, ctx.v3._id],
    householdCount: 2,
    voterCount: 3,
    createdBy: ctx.admin._id,
  });

  const csv = await callText('GET', `/admin/campaigns/${ctx.camp._id}/walklists/${saved._id}/export.csv`, asAdmin());
  assert.strictEqual(csv.status, 200);
  assert.ok(!csv.text.includes('DNCV1X'), 'flagged voter never appears in a contact-list export');
  assert.ok(csv.text.includes('DNCV2X'), 'housemate still exports');
  assert.ok(csv.text.includes('DNCV3X'), 'unrelated voter still exports');

  // Service-level: the always-on exclusion in resolveWalkList — no filter can override it.
  const r = await resolveWalkList(ctx.camp, {});
  const voterIds = r.voterIds.map(String);
  assert.ok(!voterIds.includes(String(ctx.v1._id)), 'flagged voter never enters a walk list voter set');
  assert.ok(voterIds.includes(String(ctx.v2._id)), 'housemate targeted');
  const hhIds = r.householdIds.map(String);
  assert.ok(hhIds.includes(String(ctx.hhA._id)), 'the mixed DOOR stays targetable');
});

// THE COUNTING GUARD. Do-not-contact answers "where may we go NEXT" — it must never rewrite
// "what did we DO". A knocked door that later goes fully-DNC keeps its real coverage bucket and
// stays counted/billed, because coverageBucketExpr's dnc branch is $and-gated on
// status === 'unknocked' (services/reports/aggregations.js). That single conjunct is the only
// thing standing between an admin's privacy action and silently re-writing delivered coverage —
// and because the segments would still sum perfectly, no reconciliation check could ever catch
// it. If this test fails, do not "fix" the test.
test('9. counting guard: flagging a KNOCKED door never moves coverage, homesKnocked, or knocks', { skip }, async () => {
  await resetFlags();

  // Knock HH-B for real: a survey_submitted ledger row + the resolved door status.
  await CanvassActivity.create({
    organizationId: ctx.org._id,
    campaignId: ctx.camp._id,
    effortId: ctx.effort._id,
    passId: ctx.pass._id,
    householdId: ctx.hhB._id,
    voterId: ctx.v3._id,
    userId: ctx.canv._id,
    actionType: 'survey_submitted',
    location: { ...near(D2), accuracy: 5 },
    timestamp: new Date(),
  });
  await recomputeHouseholdStatusesByIds([ctx.hhB._id], ctx.camp.type);
  assert.strictEqual(
    (await Household.findById(ctx.hhB._id).lean()).status,
    'surveyed',
    'precondition: the door really is knocked'
  );

  const q = `?campaignId=${ctx.camp._id}&range=all`;
  const before = await call('GET', `/admin/reports/overview${q}`, asAdmin());
  assert.strictEqual(before.status, 200);

  // Flag its ONLY resident → the door is now fully-DNC and will never be walked again.
  const flag = await call('POST', `/admin/voters/${ctx.v3._id}/dnc`, {
    ...asAdmin(), body: { reason: 'Told the canvasser never to come back' },
  });
  assert.strictEqual(flag.status, 200);
  assert.strictEqual((await Household.findById(ctx.hhB._id).lean()).fullyDnc, true, 'door is suppressed going forward');

  const after = await call('GET', `/admin/reports/overview${q}`, asAdmin());
  assert.strictEqual(after.status, 200);

  // The door keeps its REAL bucket: still 'surveyed', never reclassified as 'dnc'.
  assert.strictEqual(after.json.canvass.surveyed, before.json.canvass.surveyed, 'surveyed coverage is untouched');
  assert.strictEqual(after.json.canvass.dnc, 0, 'a KNOCKED door never enters the dnc segment');
  assert.strictEqual(after.json.canvass.unknocked, before.json.canvass.unknocked, 'unknocked is untouched');

  // The work stays counted and billed.
  assert.strictEqual(after.json.totals.homesKnocked, before.json.totals.homesKnocked, 'homesKnocked unchanged');
  assert.strictEqual(after.json.totals.knocks, before.json.totals.knocks, 'billable knocks unchanged');
  assert.strictEqual(after.json.totals.surveyedKnocks, before.json.totals.surveyedKnocks, 'survey doors unchanged');
  assert.strictEqual(after.json.totals.households, before.json.totals.households, 'the door stays in the universe');
  assert.strictEqual(after.json.totals.surveysSubmitted, before.json.totals.surveysSubmitted, 'the recorded answer stays');

  // And the funnel still sums to the universe — the invariant a bad edit here would preserve
  // while corrupting the buckets, so assert it explicitly rather than trusting it.
  const sum = Object.values(after.json.canvass).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, after.json.totals.households, 'coverage segments sum to Households');

  // The contrast case, in one line: an UNKNOCKED door that goes fully-DNC DOES move — out of
  // `unknocked` into `dnc` (that's the segment's whole purpose), and still bills nothing.
  await call('POST', `/admin/voters/${ctx.v1._id}/dnc`, { ...asAdmin(), body: { reason: 'Whole household asked' } });
  await call('POST', `/admin/voters/${ctx.v2._id}/dnc`, { ...asAdmin(), body: { reason: 'Whole household asked' } });
  const unknockedFlagged = await call('GET', `/admin/reports/overview${q}`, asAdmin());
  assert.strictEqual(unknockedFlagged.json.canvass.dnc, 1, 'the never-knocked door moves to the dnc segment');
  assert.strictEqual(
    unknockedFlagged.json.canvass.unknocked,
    before.json.canvass.unknocked - 1,
    'and leaves unknocked, so suppression never inflates it'
  );
  assert.strictEqual(unknockedFlagged.json.totals.knocks, before.json.totals.knocks, 'still bills nothing');
});
