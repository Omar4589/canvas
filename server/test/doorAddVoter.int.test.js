import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Walk-up voters ("Add a person at the door") over the real app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/dooradd node --test test/doorAddVoter.int.test.js
//
// The invariants this file exists to protect:
//   • The ONLY voter-create path outside the import pipeline: client-minted _id, synthetic
//     per-row `manual:<id>` stateVoterId, doorAdded provenance stamp, personId null.
//   • IDEMPOTENT on the client id — an offline replay returns 200 with the existing row and
//     never duplicates; a same-id/different-door collision is a 409, never a silent adopt.
//   • The create response speaks the per-round wire ({voter, household}) and the voter half
//     NEVER carries phone/email/dateOfBirth — on the create response, the bootstrap, and the
//     /changes delta (the privacy-verified strict subset).
//   • doorAddPolicy 'leads' refuses a fresh canvasser add (ADD_VOTER_RESTRICTED) but accepts
//     an offline replay recorded before the flip — and the field is lead-editable + audited,
//     exactly like disabledOutcomes.
//   • Admin DELETE is scoped to door-added rows only, erases the person (responses, archives,
//     notes) but KEEPS the door visit (CanvassActivity, voterId nulled) — billing counts
//     distinct visits, and the visit genuinely happened.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-door-add';

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
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { VoterNote } = await import('../src/models/VoterNote.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyResponseArchive } = await import('../src/models/SurveyResponseArchive.js');
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
const hexId = () => new mongoose.Types.ObjectId().toHexString();
const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const asLead = () => ({ token: ctx.leadTok, orgId: ctx.org._id });
const asCanv = () => ({ token: ctx.canvTok, orgId: ctx.org._id });
const addVoter = (hhId, body, who = asCanv) =>
  call('POST', `/mobile/households/${hhId}/voters`, { ...who(), body: { location: LOC, ...body } });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, CampaignManager,
    CampaignChange, Effort, Pass, Turf, TurfAssignment, Household, Voter, VoterNote,
    CanvassActivity, SurveyResponse, SurveyResponseArchive, SurveyTemplate, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'DoorAdd Org', slug: 'dooradd-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'da-a@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lena', lastName: 'Lead', email: 'da-l@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'da-c@t.co', passwordHash: 'x', isActive: true });
  const stranger = await User.create({ firstName: 'Sid', lastName: 'Stranger', email: 'da-s@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  // Org member, but rostered to NO campaign — the assertHouseholdAccess 403 case.
  await Membership.create({ userId: stranger._id, organizationId: org._id, role: 'canvasser', isActive: true });

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
    organizationId: org._id, name: 'DoorAdd C', type: 'survey', state: 'FL', isActive: true,
    surveyTemplateId: template._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: lead._id });
  await CampaignManager.create({ organizationId: org._id, campaignId: camp._id, userId: lead._id, isActive: true });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id,
    roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date(),
  });

  const mk = (n) => ({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id,
    addressLine1: `${n} Walkup Way`, city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: `${n} WALKUP WAY|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.399, 28.3] },
    status: 'unknocked', isActive: true,
  });
  const [door1, door2] = await Household.insertMany([mk(1), mk(2)]);
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book D', mode: 'geometric',
    status: 'published', householdIds: [door1._id, door2._id], doorCount: 2,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  // An IMPORTED voter at door1 — the NOT_DOOR_ADDED delete refusal, and proof the walk-up
  // shares the roster with file rows.
  const importedVoter = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: door1._id,
    stateVoterId: 'FL100', firstName: 'Ivy', lastName: 'Imported', fullName: 'Ivy Imported',
  });

  // A lit-drop campaign (its doors carry no voter roster — adding people is a 400).
  const litCamp = await Campaign.create({
    organizationId: org._id, name: 'Lit C', type: 'lit_drop', state: 'FL', isActive: true,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: litCamp._id, userId: canv._id });
  const litDoor = await Household.create({
    organizationId: org._id, campaignId: litCamp._id,
    addressLine1: '9 Lit Ln', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '9 LIT LN|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.4, 28.3] }, status: 'unknocked', isActive: true,
  });

  // A second org's household — assertHouseholdOrg conceals it as a 404.
  const org2 = await Organization.create({ name: 'Other Org', slug: 'other-org-da', isActive: true });
  const otherDoor = await Household.create({
    organizationId: org2._id, campaignId: new mongoose.Types.ObjectId(),
    addressLine1: '1 Other St', city: 'Town', state: 'FL', zipCode: '34741',
    normalizedAddress: '1 OTHER ST|TOWN|FL|34741',
    location: { type: 'Point', coordinates: [-81.5, 28.3] }, status: 'unknocked', isActive: true,
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, org2, camp, litCamp, effort, pass, turf, template,
    door1, door2, litDoor, otherDoor, importedVoter,
    admin, lead, canv, stranger,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
    canvTok: signUserToken(canv), strangerTok: signUserToken(stranger),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

let walkupId; // the client-minted id of the walk-up voter tests build on
let sincePreCreate;

test('1. create: 201, synthetic svid, doorAdded stamp, canonical phone, lowercased email — and the wire ships none of it', { skip }, async () => {
  sincePreCreate = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5)); // updatedAt must land after `since`
  walkupId = hexId();
  const r = await addVoter(ctx.door1._id, {
    voterId: walkupId,
    firstName: 'Wally', lastName: 'Walkup',
    phone: '727-555-0101', email: ' Wally.W@Example.COM ',
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));

  // The stored row: the schema-required trio + the provenance the admin surfaces read.
  const doc = await Voter.findById(walkupId).lean();
  assert.ok(doc, 'the client-minted id IS the _id');
  assert.equal(doc.stateVoterId, `manual:${walkupId}`, 'per-row synthetic svid — never a shared placeholder');
  assert.equal(String(doc.doorAdded.byUserId), String(ctx.canv._id));
  assert.ok(doc.doorAdded.at);
  assert.equal(doc.phone, '(727) 555-0101', 'phoneSchema stores canonical');
  assert.equal(doc.email, 'wally.w@example.com', 'email stored lowercased');
  assert.equal(doc.personId, null, 'no Person link — pre-backfill rows write straight everywhere');
  assert.equal(doc.fullName, 'Wally Walkup');

  // The response is the per-round wire pair, and the voter half is the strict subset.
  assert.equal(r.json.voter._id, walkupId);
  assert.equal(r.json.voter.surveyStatus, 'not_surveyed');
  assert.equal(r.json.voter.dnc, false);
  assert.equal(r.json.voter.voted, false);
  assert.equal(r.json.voter.age, null);
  for (const k of ['phone', 'email', 'dateOfBirth', 'doNotContact']) {
    assert.ok(!(k in r.json.voter), `${k} must never reach a phone`);
  }
  assert.equal(String(r.json.household._id), String(ctx.door1._id));
  assert.ok('status' in r.json.household, 'per-round door state rides along');
  assert.ok(!('normalizedAddress' in r.json.household), 'minimal wire shape, no raw doc');
});

test('2. replaying the same client id is a 200 with the row, never a duplicate', { skip }, async () => {
  const r = await addVoter(ctx.door1._id, {
    voterId: walkupId, firstName: 'Wally', lastName: 'Walkup', wasOfflineSubmission: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.voter._id, walkupId);
  assert.equal(await Voter.countDocuments({ _id: walkupId }), 1);
  assert.equal(await Voter.countDocuments({ householdId: ctx.door1._id }), 2, 'imported + walk-up, nothing more');
});

test('3. the /changes delta ships the new voter and the bumped door to teammates', { skip }, async () => {
  const r = await call('GET', `/mobile/changes?campaignId=${ctx.camp._id}&since=${encodeURIComponent(sincePreCreate)}`, asCanv());
  assert.equal(r.status, 200);
  const v = r.json.voters.find((x) => String(x._id) === String(walkupId));
  assert.ok(v, 'the walk-up voter rides the delta');
  for (const k of ['phone', 'email', 'dateOfBirth']) assert.ok(!(k in v), `${k} must not ride the delta`);
  const d = r.json.households.find((h) => String(h._id) === String(ctx.door1._id));
  assert.ok(d, 'the recompute bumped the household so track 1 re-ships the door');
});

test('4. the bootstrap carries the voter (strict subset) and the policy flags', { skip }, async () => {
  const r = await call('GET', `/mobile/bootstrap?campaignId=${ctx.camp._id}`, asCanv());
  assert.equal(r.status, 200);
  const v = r.json.voters.find((x) => String(x._id) === String(walkupId));
  assert.ok(v, 'walk-up voters serve exactly like imported ones');
  for (const k of ['phone', 'email', 'dateOfBirth']) assert.ok(!(k in v), `${k} must not reach the phone`);
  assert.equal(r.json.campaign.doorAddPolicy, 'all');
  assert.equal(r.json.campaign.canAddVoters, true);
});

test('5. the survey flow works against the new voter, and a create replay AFTER it reads surveyed', { skip }, async () => {
  const r = await call('POST', `/mobile/voters/${walkupId}/survey`, {
    ...asCanv(),
    body: {
      surveyTemplateId: String(ctx.template._id),
      answers: [{ questionKey: 'support', questionLabel: 'Can we count on your support?', answer: 'Yes', optionIds: ['opt_yes'] }],
      location: LOC,
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal((await Voter.findById(walkupId).lean()).surveyStatus, 'surveyed');
  assert.equal(await SurveyResponse.countDocuments({ voterId: walkupId }), 1);
  assert.equal((await Campaign.findById(ctx.camp._id).lean()).stats.surveyCount, 1);

  // The offline pair replays create-then-survey; a create replay that lands after the
  // survey replay must return the voter as surveyed, or the phone would repaint them fresh.
  const replay = await addVoter(ctx.door1._id, {
    voterId: walkupId, firstName: 'Wally', lastName: 'Walkup', wasOfflineSubmission: true,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.voter.surveyStatus, 'surveyed', 'per-round stamp on the idempotent response');
});

test('6. the same client id at a DIFFERENT door is a 409 collision, never a silent adopt', { skip }, async () => {
  const r = await addVoter(ctx.door2._id, { voterId: walkupId, firstName: 'Not', lastName: 'Wally' });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'VOTER_ID_CONFLICT');
  const doc = await Voter.findById(walkupId).lean();
  assert.equal(String(doc.householdId), String(ctx.door1._id), 'the row is untouched');
});

test('7. validation: location, phone, id shape, name — each refused with nothing written', { skip }, async () => {
  const before7 = await Voter.countDocuments({});
  let r = await call('POST', `/mobile/households/${ctx.door2._id}/voters`, {
    ...asCanv(), body: { voterId: hexId(), firstName: 'A', lastName: 'B' }, // no location
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'LOCATION_REQUIRED');

  r = await addVoter(ctx.door2._id, { voterId: hexId(), firstName: 'A', lastName: 'B', phone: '55' });
  assert.equal(r.status, 400, 'bad phone must be rejected by phoneSchema');

  r = await addVoter(ctx.door2._id, { voterId: 'not-a-hex-id', firstName: 'A', lastName: 'B' });
  assert.equal(r.status, 400, 'the client id must be a 24-hex ObjectId');

  r = await addVoter(ctx.door2._id, { voterId: hexId(), firstName: 'A', lastName: '' });
  assert.equal(r.status, 400, 'nameSchema requires a non-empty last name');

  assert.equal(await Voter.countDocuments({}), before7, 'no refusal writes a row');
});

test('8. access: unrostered member 403; other org\'s door concealed as 404', { skip }, async () => {
  let r = await call('POST', `/mobile/households/${ctx.door1._id}/voters`, {
    token: ctx.strangerTok, orgId: ctx.org._id,
    body: { location: LOC, voterId: hexId(), firstName: 'S', lastName: 'S' },
  });
  assert.equal(r.status, 403);

  r = await addVoter(ctx.otherDoor._id, { voterId: hexId(), firstName: 'S', lastName: 'S' });
  assert.equal(r.status, 404, 'wrong-org household reads as not found, never as forbidden');
});

test('9. lit-drop campaigns take no people; an archived campaign is read-only (409)', { skip }, async () => {
  let r = await addVoter(ctx.litDoor._id, { voterId: hexId(), firstName: 'L', lastName: 'L' });
  assert.equal(r.status, 400, JSON.stringify(r.json));

  await Campaign.updateOne({ _id: ctx.camp._id }, { isActive: false });
  try {
    r = await addVoter(ctx.door2._id, { voterId: hexId(), firstName: 'A', lastName: 'A' });
    assert.equal(r.status, 409, 'archived = read-only, the pin-fix rule');
  } finally {
    await Campaign.updateOne({ _id: ctx.camp._id }, { isActive: true });
  }
});

test('10. doorAddPolicy: lead-editable + audited; fresh canvasser add refused, replay and lead pass', { skip }, async () => {
  // A lead can flip it (the disabledOutcomes class), and the flip is audited.
  let r = await call('PATCH', `/admin/campaigns/${ctx.camp._id}`, { ...asLead(), body: { doorAddPolicy: 'leads' } });
  assert.equal(r.status, 200, `lead must be able to edit doorAddPolicy: ${JSON.stringify(r.json)}`);
  const changes = await CampaignChange.find({ campaignId: ctx.camp._id, field: 'doorAddPolicy' }).lean();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].fromValue, 'all');
  assert.equal(changes[0].toValue, 'leads');

  // Fresh canvasser add → typed 403, nothing written.
  r = await addVoter(ctx.door2._id, { voterId: hexId(), firstName: 'C', lastName: 'C' });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'ADD_VOTER_RESTRICTED');
  assert.equal(await Voter.countDocuments({ householdId: ctx.door2._id }), 0);

  // An offline replay recorded before the flip is real door data — accepted.
  const replayId = hexId();
  r = await addVoter(ctx.door2._id, {
    voterId: replayId, firstName: 'Queued', lastName: 'Add', wasOfflineSubmission: true,
    timestamp: new Date(Date.now() - 3600_000).toISOString(),
  });
  assert.equal(r.status, 201, `a queued add must never be dropped by a policy flip: ${JSON.stringify(r.json)}`);

  // A lead (CampaignManager grant) passes the toggle.
  r = await addVoter(ctx.door2._id, { voterId: hexId(), firstName: 'Lead', lastName: 'Added' }, asLead);
  assert.equal(r.status, 201, JSON.stringify(r.json));

  // The canvasser's bootstrap now says no; the lead's says yes.
  const bootC = await call('GET', `/mobile/bootstrap?campaignId=${ctx.camp._id}`, asCanv());
  assert.equal(bootC.json.campaign.canAddVoters, false);
  const bootL = await call('GET', `/mobile/bootstrap?campaignId=${ctx.camp._id}`, asLead());
  assert.equal(bootL.json.campaign.canAddVoters, true);
});

test('11. admin: email PATCH round-trips, profile carries doorAdded who/when + email', { skip }, async () => {
  let r = await call('PATCH', `/admin/voters/${walkupId}`, { ...asAdmin(), body: { email: 'Corrected@Example.com' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await Voter.findById(walkupId).lean()).email, 'corrected@example.com');

  r = await call('GET', `/admin/voters/${walkupId}`, asAdmin());
  assert.equal(r.status, 200);
  assert.equal(r.json.voter.email, 'corrected@example.com');
  assert.ok(r.json.voter.doorAdded, 'profile carries the provenance');
  assert.equal(r.json.voter.doorAdded.by.name, 'Cara Canvasser');
  assert.ok(r.json.voter.doorAdded.at);

  // Empty string clears it.
  r = await call('PATCH', `/admin/voters/${walkupId}`, { ...asAdmin(), body: { email: '' } });
  assert.equal(r.status, 200);
  assert.equal((await Voter.findById(walkupId).lean()).email, null);
});

test('12. directory: doorAdded=true filters to walk-up rows only', { skip }, async () => {
  const r = await call('GET', '/admin/voters?doorAdded=true', asAdmin());
  assert.equal(r.status, 200);
  assert.ok(r.json.voters.length >= 3, 'the three walk-ups added above');
  for (const v of r.json.voters) {
    assert.ok(v.doorAdded?.at, 'every filtered row carries the badge stamp');
  }
  assert.ok(!r.json.voters.some((v) => v.id === String(ctx.importedVoter._id)), 'imported rows are excluded');
});

test('13. DELETE: admin-only, door-added rows only', { skip }, async () => {
  let r = await call('DELETE', `/admin/voters/${walkupId}`, asCanv());
  assert.equal(r.status, 403, 'the voters router is org-admin-gated');

  r = await call('DELETE', `/admin/voters/${ctx.importedVoter._id}`, asAdmin());
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'NOT_DOOR_ADDED', 'imported voters leave via re-import or campaign delete');
});

test('14. DELETE cascade: person erased, door visit kept (voterId nulled), stats reconciled', { skip }, async () => {
  // Give the walk-up a note and a fabricated archive row so the cascade proves both.
  await VoterNote.create({
    organizationId: ctx.org._id, voterId: walkupId, authorId: ctx.admin._id, body: 'walk-up note',
  });
  await SurveyResponseArchive.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: ctx.door1._id,
    voterId: walkupId, userId: ctx.canv._id, surveyTemplateId: ctx.template._id,
    surveyTemplateVersion: 1, answers: [], location: LOC, submittedAt: new Date(),
    overwrittenBy: ctx.canv._id, overwrittenAt: new Date(), overwrittenVia: 'submit',
  });

  const r = await call('DELETE', `/admin/voters/${walkupId}`, asAdmin());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.responsesDeleted, 1);

  assert.equal(await Voter.countDocuments({ _id: walkupId }), 0, 'the person is gone');
  assert.equal(await SurveyResponse.countDocuments({ voterId: walkupId }), 0);
  assert.equal(await SurveyResponseArchive.countDocuments({ voterId: walkupId }), 0);
  assert.equal(await VoterNote.countDocuments({ voterId: walkupId }), 0);

  // The billable visit survives, anonymized.
  const visits = await CanvassActivity.find({ householdId: ctx.door1._id, actionType: 'survey_submitted' }).lean();
  assert.equal(visits.length, 1, 'the door visit is KEPT — billing counts distinct visits');
  assert.equal(visits[0].voterId, null, 'but no longer names the erased person');

  // surveyCount counts SurveyResponse docs — back to 0 after the cascade.
  assert.equal((await Campaign.findById(ctx.camp._id).lean()).stats.surveyCount, 0);

  // The imported voter still holds the door: it stays active.
  assert.equal((await Household.findById(ctx.door1._id).lean()).isActive, true);
});
