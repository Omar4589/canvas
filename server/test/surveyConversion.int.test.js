import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Converting a door outcome to/from SURVEYED — the Door Outcomes page's Surveyed direction, over
// the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/surveyconv_test node --test test/surveyConversion.int.test.js
//
// This feature deliberately overrides the rule reclassifyOutcomes.js states at its top, so the
// machinery that replaces the integrity it gives up is what this file pins:
//   • PRICING IS HONEST — the previewed after-figures equal the real ones once the run lands, for
//     both knocks/rates AND the response ledger. Asserted field-by-field, because this is the only
//     thing standing between an admin and an invoice that moved without them noticing.
//   • ATTRIBUTION IS THE CANVASSER'S — userId, coordinatorId, GPS, submittedAt and the
//     pass/turf/effort tags come off the ORIGINAL KNOCK, never re-resolved. (resolveAttribution
//     would re-home a months-old knock into today's round; that trap is asserted, not trusted.)
//   • A FIELD ANSWER IS NEVER DESTROYED going in — a voter who already answered that round is
//     skipped and listed; the door still converts.
//   • ANSWERS ARE ARCHIVED, NOT DELETED coming out, scoped to the converting row's own canvasser
//     so a second canvasser's honest work at the same door survives.
//   • REVERT IS EXACT in both directions, including a half-finished run — and it REFUSES to
//     clobber a field answer that refilled the slot afterwards.
//   • IDEMPOTENCY — a redelivered job creates N responses, not 2N, and does not inflate its own
//     skip counts with its own inserts.
//   • Provenance stays ONE LEVEL DEEP: a desk-surveyed row is out of scope for any later run.
//
// Redis points at a dead port ON PURPOSE (before any queue import), so a bulk POST always takes
// the queue-unavailable path deterministically even on a machine running a local Redis — and the
// tests then drive the REAL processor themselves, which is what the worker would have done. Without
// this, an unbounded .add() against an absent Redis hangs the request forever (ioredis buffers
// commands while disconnected), which is exactly the failure the route's queueOp timeout exists for.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-surveyconv';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.OUTCOME_CONVERT_ENQUEUE_TIMEOUT_MS = '300';

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
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyResponseArchive } = await import('../src/models/SurveyResponseArchive.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyConversionRun } = await import('../src/models/SurveyConversionRun.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { recomputeCampaignStats, computeCampaignStats } = await import('../src/services/reports/campaignCounters.js');
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');
const { processConversionJob } = await import('../src/services/canvass/conversionProcessor.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const KNOCK_AT = new Date('2026-07-04T15:00:00Z');
const GPS = { lat: 30.26, lng: -97.74, accuracy: 7, mocked: false, fixTimestamp: KNOCK_AT };

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, CampaignManager,
    CampaignChange, Effort, Pass, Household, Voter, CanvassActivity, SurveyResponse,
    SurveyResponseArchive, SurveyTemplate, SurveyConversionRun, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Conv Org', slug: 'conv-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ca@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lena', lastName: 'Lead', email: 'cl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'cc@t.co', passwordHash: 'x', isActive: true });
  const other = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'co@t.co', passwordHash: 'x', isActive: true });
  const boss = await User.create({ firstName: 'Bo', lastName: 'Boss', email: 'cb@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  for (const u of [canv, other, boss]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  }
  await Subscription.create({ organizationId: org._id, status: 'active' });

  // A template with a conditional child and an Other write-in — both have to survive the trip.
  const template = await SurveyTemplate.create({
    organizationId: org._id,
    name: 'Support Survey',
    version: 3,
    isActive: true,
    questions: [
      {
        key: 'support', label: 'Support?', type: 'single_choice', order: 0, required: true,
        options: [
          { id: 'yes', text: 'Yes', order: 0 },
          { id: 'no', text: 'No', order: 1 },
          { id: 'undecided', text: 'Undecided', order: 2 },
        ],
      },
      {
        key: 'why', label: 'Why not?', type: 'single_choice', order: 1, otherOption: true,
        options: [{ id: 'cost', text: 'Cost', order: 0 }],
        visibleIf: { logic: 'all', rules: [{ questionKey: 'support', op: 'is', optionIds: ['no'] }] },
      },
    ],
  });
  const otherTemplate = await SurveyTemplate.create({
    organizationId: org._id, name: 'Spanish Survey', version: 1, isActive: true,
    questions: [{ key: 'q', label: 'Q', type: 'single_choice', order: 0, options: [{ id: 'a', text: 'A', order: 0 }] }],
  });

  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Conv C', type: 'survey', state: 'TX',
    timeZone: 'America/Chicago', isActive: true, surveyTemplateId: template._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: canv._id });
  await CampaignManager.create({ organizationId: org._id, campaignId: campaign._id, userId: lead._id, isActive: true });

  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Intake' });
  // A second walk list with its OWN survey — the mixed-template refusal needs a real second answer.
  const effortB = await Effort.create({
    organizationId: org._id, campaignId: campaign._id, name: 'Spanish list', surveyTemplateId: otherTemplate._id,
  });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date(),
  });
  const pass2 = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    roundNumber: 2, name: 'R2', status: 'active', activatedAt: new Date(),
  });

  const door = (n, eId = effort._id) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: eId,
    addressLine1: `${n} Convert Ct`, city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: `${n} convert ct austin tx 78701`,
    location: { type: 'Point', coordinates: [-97.74 + n * 0.001, 30.26] },
    status: 'unknocked', isActive: true,
  });
  // 1-3 not_home · 4 restricted · 5 already surveyed in the field · 6 not_home w/ a DNC voter
  // 7 not_home w/ NO voters · 8 not_home on the other walk list (mixed-template probe)
  const doors = await Household.insertMany([1, 2, 3, 4, 5, 6, 7].map((n) => door(n)).concat([door(8, effortB._id)]));

  // Voters: two at door 1, one each at 2-6 and 8, none at 7.
  const mkVoter = (d, n, extra = {}) => ({
    organizationId: org._id, campaignId: campaign._id, householdId: d._id,
    stateVoterId: `SV${n}`, firstName: `V${n}`, lastName: 'Test', fullName: `V${n} Test`,
    surveyStatus: 'not_surveyed', ...extra,
  });
  const voters = await Voter.insertMany([
    mkVoter(doors[0], 1), mkVoter(doors[0], 2),
    mkVoter(doors[1], 3),
    mkVoter(doors[2], 4),
    mkVoter(doors[3], 5),
    mkVoter(doors[4], 6),
    mkVoter(doors[5], 7, { doNotContact: { flagged: true, at: new Date(), source: 'admin' } }),
    mkVoter(doors[7], 8),
  ]);

  const act = (household, actionType, extra = {}) => ({
    organizationId: org._id, campaignId: campaign._id, householdId: household._id,
    userId: canv._id, actionType, effortId: household.effortId, passId: pass._id,
    coordinatorId: boss._id,
    location: GPS, distanceFromHouseMeters: 12, timestamp: KNOCK_AT,
    ...extra,
  });
  await CanvassActivity.insertMany([
    act(doors[0], 'not_home'),
    act(doors[1], 'not_home'),
    act(doors[2], 'not_home'),
    act(doors[3], 'restricted'),
    act(doors[4], 'survey_submitted', { voterId: voters[5]._id }),
    act(doors[5], 'not_home'),
    act(doors[6], 'not_home'),
    act(doors[7], 'not_home'),
  ]);
  // The real field response behind door 5's surveyed row.
  await SurveyResponse.create({
    organizationId: org._id, campaignId: campaign._id, voterId: voters[5]._id,
    householdId: doors[4]._id, userId: canv._id, surveyTemplateId: template._id,
    surveyTemplateVersion: 3, answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'Yes', optionIds: ['yes'] }],
    location: GPS, submittedAt: KNOCK_AT, passId: pass._id, effortId: effort._id, coordinatorId: boss._id,
  });
  await Voter.updateOne({ _id: voters[5]._id }, { $set: { surveyStatus: 'surveyed' } });

  for (const d of doors) {
    const i = doors.indexOf(d);
    const status = { 3: 'restricted', 4: 'surveyed' }[i] || 'not_home';
    await Household.updateOne({ _id: d._id }, { $set: { status } });
  }
  await recomputeCampaignStats(campaign._id);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, canv, other, boss, campaign, effort, effortB, pass, pass2,
    doors, voters, template, otherTemplate,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead),
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
const url = (suffix = '') => `/admin/campaigns/${ctx.campaign._id}/survey-conversions${suffix}`;

const idsFor = async (filter) =>
  (await CanvassActivity.find({ campaignId: ctx.campaign._id, ...filter }, '_id').lean()).map((r) => String(r._id));

const YES = [{ questionKey: 'support', questionLabel: 'Support?', optionIds: ['yes'] }];
const UNDECIDED = [{ questionKey: 'support', questionLabel: 'Support?', optionIds: ['undecided'] }];

// The reported figures, read the way the product reads them.
async function moneyShot() {
  const rollup = await call('GET', `/admin/reports/campaign-rollup?campaignId=${ctx.campaign._id}`, asAdmin());
  const t = rollup.json?.cumulative || {};
  return {
    knocks: t.knocks ?? t.homesKnocked ?? null,
    contactRate: t.contactRate ?? null,
    connectionRate: t.connectionRate ?? null,
    billableDoors: t.billableDoors ?? null,
  };
}

// Drive the REAL processor, exactly as the worker would. (With Redis dead the route hands back a
// 503 carrying the created run — the run doc exists either way, which is the whole point of
// creating it BEFORE enqueueing.)
const runJob = (runId, name = 'convert') =>
  processConversionJob({ id: `t-${runId}-${name}`, name, data: { runId: String(runId) }, updateProgress: async () => {} });

// Create a bulk run and execute it, asserting the run doc came back whichever status the enqueue
// produced. Returns the run id.
async function bulkRun(body) {
  const res = await call('POST', url(), { ...asAdmin(), body: { mode: 'bulk', ...body } });
  assert.ok([201, 503].includes(res.status), `unexpected ${res.status}: ${JSON.stringify(res.json)}`);
  const id = res.json.run.id;
  // A queue-unavailable create parks the run at `failed`; the worker path would find it `pending`.
  await SurveyConversionRun.updateOne({ _id: id }, { $set: { status: 'pending', error: null } });
  await runJob(id);
  return id;
}

test('org admins only — a lead can never author survey answers', { skip }, async () => {
  assert.equal((await call('GET', url(), asLead())).status, 403);
  assert.equal(
    (await call('POST', url(), { ...asLead(), body: { direction: 'to_survey', to: 'survey_submitted', dryRun: true } })).status,
    403
  );
});

test('a mixed-template selection is refused, and filtering by walk list fixes it', { skip }, async () => {
  const all = await idsFor({ actionType: 'not_home' });
  const mixed = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', dryRun: true, actionIds: all },
  });
  assert.equal(mixed.status, 400);
  assert.equal(mixed.json.code, 'MIXED_SURVEY_TEMPLATES');
  assert.match(mixed.json.error, /Spanish Survey|Support Survey/);

  // Same selection, narrowed to one walk list — the one-click fix the error tells them about.
  const narrowed = await call('POST', url(), {
    ...asAdmin(),
    body: {
      direction: 'to_survey', to: 'survey_submitted', dryRun: true,
      scope: { effortId: String(ctx.effort._id) }, actionIds: all,
    },
  });
  assert.equal(narrowed.status, 200);
  assert.equal(narrowed.json.template.name, 'Support Survey');
});

test('preview prices BOTH ledgers, and names every voter it will not touch', { skip }, async () => {
  const ids = await idsFor({ actionType: 'not_home', effortId: ctx.effort._id });
  const prev = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', dryRun: true, actionIds: ids, answers: YES },
  });
  assert.equal(prev.status, 200);
  assert.equal(prev.json.rateNeutral, false, 'a completion action is never rate-neutral');

  const s = prev.json.survey;
  // Doors 1(×2 voters), 2, 3, 6(DNC) and 7(no voters) — 5 rows on this walk list.
  assert.equal(s.responsesToCreate, 4, 'two at door 1, one each at doors 2 and 3');
  assert.equal(s.votersDncExcluded, 1, 'door 6 voter is do-not-contact');
  assert.equal(s.doorsNoVoters, 1, 'only door 7 has nobody on file');
  assert.equal(s.doorsAllAlreadyAnswered, 1, "door 6's only voter is DNC — not the same fact as 'nobody on file'");
  assert.equal(s.votersAlreadyAnswered, 0);
  // Nothing was written.
  assert.equal(await SurveyResponse.countDocuments({ 'deskEntry.runId': { $exists: true } }), 0);
  assert.equal(await SurveyConversionRun.countDocuments({}), 0);
});

test('THE PRICING ORACLE — previewed after-figures equal reality once the run lands', { skip }, async () => {
  const ids = await idsFor({ actionType: 'not_home', effortId: ctx.effort._id });
  const prev = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', dryRun: true, actionIds: ids, answers: YES },
  });
  const predicted = prev.json.impact.after;
  const predictedResponses = prev.json.survey.responsesToCreate;

  ctx.forwardRunId = await bulkRun({ direction: 'to_survey', to: 'survey_submitted', actionIds: ids, answers: YES });

  const real = await moneyShot();
  assert.equal(real.knocks, predicted.knocks, 'knocks');
  assert.equal(real.contactRate, predicted.contactRate, 'contact rate');
  assert.equal(real.connectionRate, predicted.connectionRate, 'survey rate');
  assert.equal(real.billableDoors, predicted.billableDoors, 'billable doors');

  // And the counters agree with an INDEPENDENT recompute, not just with themselves.
  const stats = (await Campaign.findById(ctx.campaign._id).lean()).stats;
  const oracle = await computeCampaignStats(ctx.campaign._id);
  assert.equal(stats.surveyedKnockCount, oracle.surveyedKnockCount);
  assert.equal(stats.surveyCount, oracle.surveyCount);

  const run = await SurveyConversionRun.findById(ctx.forwardRunId).lean();
  assert.equal(run.status, 'completed');
  assert.equal(run.counts.responsesCreated, predictedResponses, 'preview promised exactly this many answers');
  assert.equal(run.counts.votersSkippedDnc, 1);
  assert.equal(run.counts.doorsNoVoters, 1);
});

test('attribution is the CANVASSER\'S — nothing is re-resolved to today', { skip }, async () => {
  const resp = await SurveyResponse.findOne({
    householdId: ctx.doors[1]._id,
    'deskEntry.runId': { $exists: true },
  }).lean();
  assert.ok(resp, 'door 2 got a desk-entered response');

  assert.equal(String(resp.userId), String(ctx.canv._id), 'the canvasser owns it, not the admin');
  assert.equal(String(resp.coordinatorId), String(ctx.boss._id), 'the team is copied, never restamped');
  assert.equal(String(resp.passId), String(ctx.pass._id), 'the ROW\'s round — resolveAttribution would have re-homed it');
  assert.equal(String(resp.effortId), String(ctx.effort._id));
  assert.equal(resp.submittedAt.getTime(), KNOCK_AT.getTime(), 'the conversation happened when the knock did');
  assert.equal(resp.location.lat, GPS.lat);
  assert.equal(resp.location.accuracy, GPS.accuracy);
  assert.equal(resp.distanceFromHouseMeters, 12);
  assert.equal(resp.editedBy, null, 'authored, not edited');
  assert.equal(resp.editedAt, null);
  assert.equal(String(resp.deskEntry.byUserId), String(ctx.admin._id), 'the ADMIN typed it');
  assert.equal(resp.deskEntry.source, 'converted_outcome');
  assert.equal(resp.surveyTemplateVersion, 3);

  // The paired activity row names a voter, or admin/activities.js renders a surveyed knock with
  // no answers at all.
  const act = await CanvassActivity.findOne({ householdId: ctx.doors[1]._id }).lean();
  assert.equal(act.actionType, 'survey_submitted');
  assert.ok(act.voterId, 'voterId is set on the converted row');
  assert.equal(act.reclassified.kind, 'to_survey');
  assert.equal(act.reclassified.from, 'not_home');
  assert.equal(act.timestamp.getTime(), KNOCK_AT.getTime(), 'the knock keeps its time');
  assert.equal(String(act.userId), String(ctx.canv._id));
});

test('answers are normalized like a field submission — text rebuilt, hidden answers dropped', { skip }, async () => {
  const resp = await SurveyResponse.findOne({ householdId: ctx.doors[1]._id, 'deskEntry.runId': { $exists: true } }).lean();
  const a = resp.answers.find((x) => x.questionKey === 'support');
  assert.deepEqual(a.optionIds, ['yes']);
  assert.equal(a.answer, 'Yes', 'the text snapshot is derived server-side from the option id');
  assert.equal(a.questionLabel, 'Support?');
  assert.ok(!resp.answers.some((x) => x.questionKey === 'why'), 'the conditional child stayed hidden');
});

test('doors and voters both move so /mobile/changes resyncs the phones', { skip }, async () => {
  const door = await Household.findById(ctx.doors[1]._id).lean();
  assert.equal(door.status, 'surveyed');
  const voter = await Voter.findById(ctx.voters[2]._id).lean();
  assert.equal(voter.surveyStatus, 'surveyed');
  // The delta poll finds recolored doors by updatedAt and voters by their own updatedAt.
  assert.ok(door.updatedAt > KNOCK_AT, 'household.updatedAt moved');
  assert.ok(voter.updatedAt > KNOCK_AT, 'voter.updatedAt moved — updateMany must keep timestamps on');
});

test('a desk-surveyed row is out of scope for any later run — provenance stays one level deep', { skip }, async () => {
  const converted = await CanvassActivity.findOne({ householdId: ctx.doors[1]._id }).lean();
  const again = await call('POST', url(), {
    ...asAdmin(),
    body: {
      direction: 'from_survey', to: 'not_home', dryRun: true,
      actionIds: [String(converted._id)],
    },
  });
  assert.equal(again.status, 400);
  assert.equal(again.json.code, 'EMPTY_SELECTION', 'a stamped row cannot be converted again');

  // ...and the plain reclassify tool can't see it either.
  const table = await call(
    'GET',
    `/admin/campaigns/${ctx.campaign._id}/outcome-entries?outcomes=survey_submitted`,
    asAdmin()
  );
  const listed = table.json.entries.map((e) => e.id);
  assert.ok(!listed.includes(String(converted._id)), 'stamped rows are excluded from the entries table');
});

test('a voter who already answered in the field is SKIPPED, byte for byte', { skip }, async () => {
  // Door 1 got two desk answers in the run above. Re-run the SAME selection against door 1's
  // second round: the round-1 answers must be untouched and the voters listed as skipped.
  const before = await SurveyResponse.find({ householdId: ctx.doors[0]._id }).sort({ voterId: 1 }).lean();
  assert.equal(before.length, 2);

  const row = await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.doors[0]._id,
    userId: ctx.canv._id, actionType: 'not_home', effortId: ctx.effort._id, passId: ctx.pass._id,
    location: GPS, timestamp: new Date('2026-07-05T15:00:00Z'), coordinatorId: ctx.boss._id,
  });
  const runId = await bulkRun({ direction: 'to_survey', to: 'survey_submitted', actionIds: [String(row._id)], answers: UNDECIDED });

  const after = await SurveyResponse.find({ householdId: ctx.doors[0]._id, passId: ctx.pass._id })
    .sort({ voterId: 1 })
    .lean();
  assert.equal(after.length, 2, 'no second answer for the same voter+round');
  assert.deepEqual(
    after.map((r) => r.answers[0].optionIds),
    before.map((r) => r.answers[0].optionIds),
    'the existing answers are unchanged'
  );

  const run = await SurveyConversionRun.findById(runId).lean();
  assert.equal(run.counts.responsesCreated, 0);
  assert.equal(run.counts.votersSkippedAlreadyAnswered, 2);
  assert.equal(run.counts.doorsAllAlreadyAnswered, 1);
  assert.ok(run.samples.some((s) => s.reason === 'already_answered' && s.voterName), 'skipped voters are NAMED');
  // The door still converted — that was the point of the correction.
  assert.equal((await CanvassActivity.findById(row._id).lean()).actionType, 'survey_submitted');
  ctx.skipRunId = runId;
});

test('re-running the same job is a no-op, and does not inflate its own skip counts', { skip }, async () => {
  const beforeCount = await SurveyResponse.countDocuments({ 'deskEntry.runId': ctx.forwardRunId });
  const run = await SurveyConversionRun.findById(ctx.forwardRunId);
  const beforeSkips = run.counts.votersSkippedAlreadyAnswered;

  // Force the re-run the way a stall redelivery would.
  run.status = 'running';
  await run.save();
  await runJob(ctx.forwardRunId);

  assert.equal(
    await SurveyResponse.countDocuments({ 'deskEntry.runId': ctx.forwardRunId }),
    beforeCount,
    'N responses, not 2N'
  );
  const after = await SurveyConversionRun.findById(ctx.forwardRunId).lean();
  assert.equal(
    after.counts.votersSkippedAlreadyAnswered,
    beforeSkips,
    "a redelivery must not count its OWN inserts as somebody else's field answers"
  );
});

test('restricted → surveyed ADDS a knock and drops a restricted door — previewed and real', { skip }, async () => {
  const ids = await idsFor({ actionType: 'restricted' });
  const prev = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', dryRun: true, actionIds: ids, answers: YES },
  });
  const { before, after } = prev.json.impact;
  assert.equal(after.knocks, before.knocks + 1, 'restricted is not a knock; survey_submitted is');
  assert.equal(after.restrictedDoors, before.restrictedDoors - 1);

  await bulkRun({ direction: 'to_survey', to: 'survey_submitted', actionIds: ids, answers: YES });

  const real = await moneyShot();
  assert.equal(real.knocks, after.knocks, 'the previewed knock count is what the invoice now shows');
  assert.equal(real.billableDoors, after.billableDoors);
});

test('reverse: answers are ARCHIVED, not deleted, and only that canvasser\'s', { skip }, async () => {
  // A second canvasser's honest answer at the SAME door and round must survive.
  const otherVoter = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.doors[4]._id,
    stateVoterId: 'SV99', firstName: 'V99', lastName: 'Test', fullName: 'V99 Test', surveyStatus: 'surveyed',
  });
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, voterId: otherVoter._id,
    householdId: ctx.doors[4]._id, userId: ctx.other._id, surveyTemplateId: ctx.template._id,
    surveyTemplateVersion: 3, answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'No', optionIds: ['no'] }],
    location: GPS, submittedAt: KNOCK_AT, passId: ctx.pass._id, effortId: ctx.effort._id,
  });

  const row = await CanvassActivity.findOne({
    householdId: ctx.doors[4]._id, actionType: 'survey_submitted', userId: ctx.canv._id,
  }).lean();

  const prev = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'from_survey', to: 'not_home', dryRun: true, actionIds: [String(row._id)] },
  });
  assert.equal(prev.status, 200);
  assert.equal(prev.json.survey.responsesToArchive, 1, "only the converting row's own canvasser");
  assert.equal(prev.json.survey.manifest.length, 1);
  assert.ok(prev.json.survey.manifest[0].voterName, 'the manifest names who loses an answer');

  ctx.reverseRunId = await bulkRun({ direction: 'from_survey', to: 'not_home', actionIds: [String(row._id)] });

  const archived = await SurveyResponseArchive.find({ conversionRunId: ctx.reverseRunId }).lean();
  assert.equal(archived.length, 1);
  assert.equal(archived[0].overwrittenVia, 'outcome_convert');
  assert.deepEqual(archived[0].answers[0].optionIds, ['yes'], 'the answers are preserved verbatim');
  assert.equal(String(archived[0].userId), String(ctx.canv._id));

  // The other canvasser's response is still live.
  const survivor = await SurveyResponse.findOne({ voterId: otherVoter._id }).lean();
  assert.ok(survivor, "a second canvasser's real answer at the same door survives");
  assert.deepEqual(survivor.answers[0].optionIds, ['no']);

  assert.equal((await CanvassActivity.findById(row._id).lean()).actionType, 'not_home');
  assert.equal((await Voter.findById(ctx.voters[5]._id).lean()).surveyStatus, 'not_surveyed');
  ctx.otherVoterId = otherVoter._id;
});

test('revert is exact in both directions', { skip }, async () => {
  // Reverse first: the archived answers come back, the row returns to survey_submitted.
  const rev = await call('POST', url(`/${ctx.reverseRunId}/revert`), asAdmin());
  assert.equal(rev.status, 200);
  const back = await SurveyResponse.findOne({ voterId: ctx.voters[5]._id, passId: ctx.pass._id }).lean();
  assert.ok(back, 'the archived response was restored');
  assert.deepEqual(back.answers[0].optionIds, ['yes']);
  assert.equal(await SurveyResponseArchive.countDocuments({ conversionRunId: ctx.reverseRunId }), 0, 'promoted rows are consumed');
  const row = await CanvassActivity.findOne({ householdId: ctx.doors[4]._id, userId: ctx.canv._id }).lean();
  assert.equal(row.actionType, 'survey_submitted');
  assert.equal(row.reclassified, undefined, 'the stamp is dropped');
  assert.equal((await Voter.findById(ctx.voters[5]._id).lean()).surveyStatus, 'surveyed');

  // Forward: the created responses are deleted and the doors go back to not_home.
  const fwd = await call('POST', url(`/${ctx.forwardRunId}/revert`), asAdmin());
  assert.equal(fwd.status, 200);
  assert.equal(await SurveyResponse.countDocuments({ 'deskEntry.runId': ctx.forwardRunId }), 0);
  const door2 = await CanvassActivity.findOne({ householdId: ctx.doors[1]._id }).lean();
  assert.equal(door2.actionType, 'not_home');
  assert.equal(door2.voterId, null, 'voterId is restored from voterIdWas');
  assert.equal((await Household.findById(ctx.doors[1]._id).lean()).status, 'not_home');

  assert.equal((await call('POST', url(`/${ctx.forwardRunId}/revert`), asAdmin())).status, 409);
});

test('revert REFUSES to clobber a field answer that refilled the slot', { skip }, async () => {
  const row = await CanvassActivity.findOne({
    householdId: ctx.doors[4]._id, actionType: 'survey_submitted', userId: ctx.canv._id,
  }).lean();
  const cleanupRunId = await bulkRun({ direction: 'from_survey', to: 'not_home', actionIds: [String(row._id)] });
  assert.equal(await SurveyResponseArchive.countDocuments({ conversionRunId: cleanupRunId }), 1);

  // A canvasser answers that voter again, for real, after the cleanup.
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, voterId: ctx.voters[5]._id,
    householdId: ctx.doors[4]._id, userId: ctx.other._id, surveyTemplateId: ctx.template._id,
    surveyTemplateVersion: 3, answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'No', optionIds: ['no'] }],
    location: GPS, submittedAt: new Date(), passId: ctx.pass._id,
  });

  const rev = await call('POST', url(`/${cleanupRunId}/revert`), asAdmin());
  assert.equal(rev.status, 200);
  const live = await SurveyResponse.findOne({ voterId: ctx.voters[5]._id, passId: ctx.pass._id }).lean();
  assert.deepEqual(live.answers[0].optionIds, ['no'], 'the NEWER field answer wins');
  assert.equal(String(live.userId), String(ctx.other._id));
  const run = await SurveyConversionRun.findById(cleanupRunId).lean();
  assert.equal(run.counts.responsesNotRestored, 1, 'and the un-restorable row is counted');
  assert.equal(await SurveyResponseArchive.countDocuments({ conversionRunId: cleanupRunId }), 1, 'it stays archived');
});

test('a door-by-door queue session applies per-door answers and reverts as one', { skip }, async () => {
  const ids = await idsFor({ actionType: 'not_home', effortId: ctx.effort._id, householdId: { $in: [ctx.doors[1]._id, ctx.doors[2]._id] } });
  assert.equal(ids.length, 2);

  const opened = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', mode: 'queue', actionIds: ids },
  });
  assert.equal(opened.status, 201);
  assert.equal(opened.json.run.status, 'open', 'a queue session stays open between steps');
  const runId = opened.json.run.id;

  const v3 = ctx.voters[2]._id; // door 2
  const v4 = ctx.voters[3]._id; // door 3
  const d2Row = (await CanvassActivity.findOne({ _id: { $in: ids }, householdId: ctx.doors[1]._id }).lean())._id;
  const d3Row = (await CanvassActivity.findOne({ _id: { $in: ids }, householdId: ctx.doors[2]._id }).lean())._id;

  const step1 = await call('POST', url(`/${runId}/door`), {
    ...asAdmin(),
    body: { actionId: String(d2Row), voterPlans: { [String(v3)]: { answers: YES } } },
  });
  assert.equal(step1.status, 200);
  assert.equal(step1.json.applied, true);

  // The remaining queue is DERIVED, so it is correct even after a reload.
  const poll = await call('GET', url(`/${runId}`), asAdmin());
  assert.deepEqual(poll.json.run.doorsRemaining, [String(d3Row)]);
  assert.equal(poll.json.run.progress.doorsDone, 1);

  await call('POST', url(`/${runId}/door`), {
    ...asAdmin(),
    body: { actionId: String(d3Row), voterPlans: { [String(v4)]: { answers: UNDECIDED } } },
  });
  await call('POST', url(`/${runId}/close`), asAdmin());

  const a3 = await SurveyResponse.findOne({ voterId: v3, 'deskEntry.runId': runId }).lean();
  const a4 = await SurveyResponse.findOne({ voterId: v4, 'deskEntry.runId': runId }).lean();
  assert.deepEqual(a3.answers[0].optionIds, ['yes'], 'each door kept its OWN answers');
  assert.deepEqual(a4.answers[0].optionIds, ['undecided']);

  const rev = await call('POST', url(`/${runId}/revert`), asAdmin());
  assert.equal(rev.status, 200);
  assert.equal(await SurveyResponse.countDocuments({ 'deskEntry.runId': runId }), 0, 'the whole session undoes at once');
});

test('partial answers are allowed — an empty set records a response with no answers', { skip }, async () => {
  const row = await CanvassActivity.findOne({ householdId: ctx.doors[2]._id, actionType: 'not_home' }).lean();
  const partialRunId = await bulkRun({ direction: 'to_survey', to: 'survey_submitted', actionIds: [String(row._id)], answers: [] });
  const resp = await SurveyResponse.findOne({ 'deskEntry.runId': partialRunId }).lean();
  assert.ok(resp, 'a required question does NOT block the write');
  assert.deepEqual(resp.answers, []);
  await call('POST', url(`/${partialRunId}/revert`), asAdmin());
});

test('a lit-drop campaign has nothing to convert', { skip }, async () => {
  const lit = await Campaign.create({
    organizationId: ctx.org._id, name: 'Lit C', type: 'lit_drop', state: 'TX', isActive: true,
  });
  const r = await call('POST', `/admin/campaigns/${lit._id}/survey-conversions`, {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', dryRun: true },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'NOT_A_SURVEY_CAMPAIGN');
  await Campaign.deleteOne({ _id: lit._id });
});

test('a foreign run id reads as missing, never as something to undo here', { skip }, async () => {
  const orphan = new mongoose.Types.ObjectId();
  assert.equal((await call('GET', url(`/${orphan}`), asAdmin())).status, 404);
  assert.equal((await call('POST', url(`/${orphan}/revert`), asAdmin())).status, 404);
  assert.equal((await call('GET', url('/not-an-id'), asAdmin())).status, 404);
});

test('the run and its revert both land in the campaign history feed', { skip }, async () => {
  const rows = await CampaignChange.find({ campaignId: ctx.campaign._id, source: 'survey_conversion' }).lean();
  assert.ok(rows.length >= 2, 'runs are audited');
  assert.ok(rows.some((r) => r.toValue === 'survey_submitted'), 'a forward run reads left-to-right');
  assert.ok(rows.some((r) => r.fromValue === 'survey_submitted'), 'a revert reads back the other way');
  assert.ok(rows.every((r) => String(r.byUserId) === String(ctx.admin._id)));
});

test('the campaign delete cascade takes SurveyConversionRun with it', { skip }, async () => {
  const doomed = await Campaign.create({
    organizationId: ctx.org._id, name: 'Doomed', type: 'survey', state: 'TX', isActive: true,
  });
  await SurveyConversionRun.create({
    organizationId: ctx.org._id, campaignId: doomed._id, direction: 'to_survey',
    mode: 'bulk', to: 'survey_submitted', sources: ['not_home'],
  });
  assert.equal(await SurveyConversionRun.countDocuments({ campaignId: doomed._id }), 1);
  await deleteCampaignCascade(doomed._id);
  assert.equal(await SurveyConversionRun.countDocuments({ campaignId: doomed._id }), 0);
});
