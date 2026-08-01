import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The ACTION-RESPONSE wire contract, over the real app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/actionresp node --test test/actionResponsePerRound.int.test.js
//
// The action responses (dispositions + survey) are the FOURTH per-round wire,
// alongside bootstrap, /changes, and me.js. The client's reconcile reads
// response.household.status and re-arms its optimistic overlay with it — so this
// response must speak the ROUND's truth, never the stored campaign-global status,
// which is completion-STICKY across rounds. The field bug this pins: recording
// not_home on a door surveyed in a PRIOR round returned the sticky global
// 'surveyed', the phone repainted the pin, and the overlay then defended the lie
// against correct per-round deltas for its whole TTL ("not home flips back to
// surveyed"; restart fixed it; reoccurred on the next not-home).
//
// Also pinned: the responses are the MINIMAL wire shape. The old bodies shipped
// raw Mongoose docs — the survey response included the voter's dateOfBirth,
// phone, and doNotContact subdoc, bypassing the toWireVoter privacy shaping
// (PRIVACY_VERIFICATION.md). No shipped client ever read those fields.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-action-resp';

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
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

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

const LOC = { lat: 28.3001, lng: -81.399, accuracy: 8 };

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass,
    Turf, TurfAssignment, Household, Voter, CanvassActivity, SurveyResponse, SurveyTemplate, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Resp Org', slug: 'resp-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'ar-c@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });

  const template = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Support ask',
    version: 1,
    questions: [{
      key: 'support', label: 'Can we count on your support?', type: 'single_choice', order: 0,
      options: [{ id: 'opt_yes', text: 'Yes', order: 0 }, { id: 'opt_no', text: 'No', order: 1 }],
    }],
  });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Resp C', type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: template._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const priorPass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Pass 1', status: 'archived',
  });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 2, name: 'Pass 2', status: 'active',
  });

  const mk = (n) => ({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id,
    addressLine1: `${n} Wire St`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${n} WIRE ST|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.399, 28.3] },
    isActive: true,
  });
  const [hhPriorSurveyed, hhFresh, hhUnbooked] = await Household.insertMany([mk(1), mk(2), mk(3)]);

  // The voters carry exactly the PII the old survey response leaked, so the
  // shape assertions below prove something.
  const mkVoter = (hh, n) => Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: hh._id,
    stateVoterId: `AR${n}`, firstName: `V${n}`, lastName: 'Test', fullName: `V${n} Test`,
    dateOfBirth: new Date('1962-08-30'), phone: '7275550101', phoneType: 'landline',
    doNotContact: { flagged: false, reason: null },
  });
  const voterPrior = await mkVoter(hhPriorSurveyed, 1);
  const voterFresh = await mkVoter(hhFresh, 2);

  // hhPriorSurveyed: surveyed in ROUND 1 → stored global status is the STICKY
  // 'surveyed' the response used to echo back.
  const p1At = new Date(Date.now() - 86400_000);
  await CanvassActivity.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, passId: priorPass._id,
    householdId: hhPriorSurveyed._id, userId: canv._id, actionType: 'survey_submitted',
    timestamp: p1At, location: { lat: 28.3, lng: -81.399 },
  });
  await SurveyResponse.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, passId: priorPass._id,
    householdId: hhPriorSurveyed._id, voterId: voterPrior._id, userId: canv._id,
    surveyTemplateId: template._id, surveyTemplateVersion: 1,
    location: { lat: 28.3, lng: -81.399 }, submittedAt: p1At,
    answers: [{ questionKey: 'support', questionLabel: 'Can we count on your support?', answer: 'Yes', optionIds: ['opt_yes'] }],
  });
  await Household.updateOne({ _id: hhPriorSurveyed._id }, { status: 'surveyed', lastActionAt: p1At });
  await Voter.updateOne({ _id: voterPrior._id }, { surveyStatus: 'surveyed' });

  // The active round's published book holds the first two doors; hhUnbooked is in
  // NO book (the legacy/unbooked null-passId fallback case).
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book W', mode: 'geometric',
    status: 'published', householdIds: [hhPriorSurveyed._id, hhFresh._id], doorCount: 2,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, effort, pass, priorPass, turf, canv, template,
    hhPriorSurveyed, hhFresh, hhUnbooked, voterPrior, voterFresh,
    canvTok: signUserToken(canv),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

let sincePreAction;
let notHomeAt;

test('1. not_home on a prior-round-surveyed door: response says NOT_HOME, stored global stays surveyed', { skip }, async () => {
  sincePreAction = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5)); // updatedAt must land after `since`
  notHomeAt = new Date();

  const r = await call('POST', `/mobile/households/${ctx.hhPriorSurveyed._id}/not-home`, {
    token: ctx.canvTok, orgId: ctx.org._id,
    body: { location: LOC, timestamp: notHomeAt.toISOString() },
  });
  assert.strictEqual(r.status, 201);
  // THE bug: this returned the sticky global 'surveyed' and the phone repainted.
  assert.strictEqual(r.json.household.status, 'not_home', 'the response speaks the ROUND, not the sticky global');
  assert.ok(r.json.household.lastActionAt, 'per-round last visit rides along');

  // Coverage semantics untouched: the STORED status stays sticky for admin/reports.
  const stored = await Household.findById(ctx.hhPriorSurveyed._id).lean();
  assert.strictEqual(stored.status, 'surveyed', 'global stays surveyed — ever-reached is coverage, not round state');

  // Minimal wire shape — the raw doc used to over-ship.
  assert.ok(!('normalizedAddress' in r.json.household), 'no raw-doc fields');
  assert.ok(!('cutConflicts' in r.json.household));
  assert.ok(!('activity' in r.json), 'activity never shipped — nothing reads it');
});

test('2. the /changes delta agrees with the response (the pair that used to fight the overlay)', { skip }, async () => {
  const r = await call('GET', `/mobile/changes?campaignId=${ctx.camp._id}&since=${encodeURIComponent(sincePreAction)}`, {
    token: ctx.canvTok, orgId: ctx.org._id,
  });
  assert.strictEqual(r.status, 200);
  const door = r.json.households.find((h) => String(h._id) === String(ctx.hhPriorSurveyed._id));
  assert.ok(door, 'the knocked door rides the delta');
  assert.strictEqual(door.status, 'not_home', 'delta and action response now say the same thing');
});

test('3. a superseded disposition replay returns the round\'s truth, not the sticky global', { skip }, async () => {
  const stale = new Date(notHomeAt.getTime() - 60_000).toISOString();
  const r = await call('POST', `/mobile/households/${ctx.hhPriorSurveyed._id}/not-home`, {
    token: ctx.canvTok, orgId: ctx.org._id,
    body: { location: LOC, timestamp: stale, wasOfflineSubmission: true },
  });
  assert.strictEqual(r.status, 200, 'a superseded replay is a 200 no-op');
  assert.strictEqual(r.json.superseded, true);
  assert.strictEqual(r.json.household.status, 'not_home', 'per-round truth even on the pre-write early return');
});

test('4. survey response: per-round household only — the raw Voter (DOB/phone/DNC) leak is gone', { skip }, async () => {
  const r = await call('POST', `/mobile/voters/${ctx.voterFresh._id}/survey`, {
    token: ctx.canvTok, orgId: ctx.org._id,
    body: {
      surveyTemplateId: String(ctx.template._id),
      answers: [{ questionKey: 'support', questionLabel: 'Can we count on your support?', answer: 'Yes', optionIds: ['opt_yes'] }],
      location: LOC,
    },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.household.status, 'surveyed', 'per-round: they just surveyed it this round');
  assert.ok(!('voter' in r.json), 'raw Voter doc no longer ships');
  assert.ok(!('surveyResponse' in r.json) && !('activity' in r.json), 'nothing unread ships');
  const body = JSON.stringify(r.json);
  assert.ok(!body.includes('dateOfBirth') && !body.includes('7275550101'),
    'no DOB, no phone — the toWireVoter principle now holds on the action wire too');
});

test('5. a superseded survey replay also speaks per-round (and stays leak-free)', { skip }, async () => {
  // The voter at hhPriorSurveyed: newest same-pass row is test 1's not_home. A
  // stale survey replay must be refused AND report the round's not_home — not the
  // sticky global 'surveyed', and not the replayed survey either.
  const stale = new Date(notHomeAt.getTime() - 120_000).toISOString();
  const r = await call('POST', `/mobile/voters/${ctx.voterPrior._id}/survey`, {
    token: ctx.canvTok, orgId: ctx.org._id,
    body: {
      surveyTemplateId: String(ctx.template._id),
      answers: [{ questionKey: 'support', questionLabel: 'Can we count on your support?', answer: 'Yes', optionIds: ['opt_yes'] }],
      location: LOC, timestamp: stale, wasOfflineSubmission: true,
    },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.superseded, true);
  assert.strictEqual(r.json.household.status, 'not_home', 'the round\'s newer disposition wins the wire');
  assert.ok(!('voter' in r.json), 'superseded survey path is leak-free too');
});

test('6. unbooked door (null passId): global fallback, matching the bootstrap\'s doorPass behavior', { skip }, async () => {
  const r = await call('POST', `/mobile/households/${ctx.hhUnbooked._id}/not-home`, {
    token: ctx.canvTok, orgId: ctx.org._id,
    body: { location: LOC },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.household.status, 'not_home',
    'no book → no round → global value (which this fresh door\'s recompute makes not_home)');
});
