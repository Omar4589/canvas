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

test('a queue session is USABLE from the response that creates it', { skip }, async () => {
  // The shipped bug this pins: the creating POST returned doorsRemaining: null (the runWire
  // default), the walkthrough read null as an empty queue, and its "all done" effect closed the
  // session on first render — a modal flashing for half a second, then a junk
  // "0 answers · 0 entries" run row. One response must carry everything: the doors AND the survey.
  const ids = await idsFor({
    actionType: 'not_home',
    effortId: ctx.effort._id,
    householdId: { $in: [ctx.doors[1]._id, ctx.doors[2]._id] },
  });
  assert.equal(ids.length, 2);

  const opened = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', mode: 'queue', actionIds: ids },
  });
  assert.equal(opened.status, 201);
  assert.equal(opened.json.run.status, 'open');
  assert.ok(Array.isArray(opened.json.run.doorsRemaining), 'the queue itself, not null');
  assert.equal(opened.json.run.doorsRemaining.length, 2, 'every selected door, none done yet');
  assert.deepEqual([...opened.json.run.doorsRemaining].sort(), ids.map(String).sort());
  assert.ok(opened.json.run.template, 'and the survey to answer them with');
  assert.equal(opened.json.run.template.name, 'Support Survey');
  assert.ok(opened.json.run.template.questions.length);

  // Close it untouched: an abandoned session is not a campaign event. It must leave no history
  // row, and must NOT appear in the runs list as "0 answers · 0 entries" with a dead Undo.
  const historyBefore = await CampaignChange.countDocuments({
    campaignId: ctx.campaign._id, source: 'survey_conversion',
  });
  await call('POST', url(`/${opened.json.run.id}/close`), asAdmin());
  const run = await SurveyConversionRun.findById(opened.json.run.id).lean();
  assert.equal(run.status, 'completed');
  assert.equal(run.counts.responsesCreated, 0);
  assert.equal(run.counts.entriesConverted, 0);
  assert.equal(
    await CampaignChange.countDocuments({ campaignId: ctx.campaign._id, source: 'survey_conversion' }),
    historyBefore,
    'an empty session writes no history row'
  );
  const list = await call('GET', url(), asAdmin());
  assert.ok(
    !list.json.runs.some((r) => r.id === opened.json.run.id),
    'an empty completed run is hidden from the list'
  );
  // ...while an OPEN empty session stays listed — it is resumable, which is the difference.
  const opened2 = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', mode: 'queue', actionIds: ids },
  });
  const list2 = await call('GET', url(), asAdmin());
  assert.ok(list2.json.runs.some((r) => r.id === opened2.json.run.id && r.status === 'open'));
  await call('POST', url(`/${opened2.json.run.id}/close`), asAdmin());
});

test('an abandoned door-by-door session can be resumed from a cold load', { skip }, async () => {
  // The failure this pins is a real one that shipped: the server derived the remaining doors
  // correctly all along, but a session closed mid-way was strandable because the poll response
  // carried no template to re-open the composer with. A resume must need exactly ONE call.
  const ids = await idsFor({
    actionType: 'not_home',
    effortId: ctx.effort._id,
    householdId: { $in: [ctx.doors[1]._id, ctx.doors[2]._id] },
  });
  assert.equal(ids.length, 2);

  const opened = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', mode: 'queue', actionIds: ids },
  });
  const runId = opened.json.run.id;
  const first = (await CanvassActivity.findOne({ _id: { $in: ids }, householdId: ctx.doors[1]._id }).lean())._id;

  await call('POST', url(`/${runId}/door`), {
    ...asAdmin(),
    body: { actionId: String(first), voterPlans: { [String(ctx.voters[2]._id)]: { answers: YES } } },
  });

  // ...the admin closes the tab. Everything a fresh page load needs comes back in one GET.
  const cold = await call('GET', url(`/${runId}`), asAdmin());
  assert.equal(cold.status, 200);
  assert.equal(cold.json.run.status, 'open', 'the session is still resumable');
  assert.equal(cold.json.run.doorsRemaining.length, 1, 'exactly the door not yet done');
  assert.ok(cold.json.run.template, 'the survey comes back too — without it the composer is blank');
  assert.equal(cold.json.run.template.name, 'Support Survey');
  assert.ok(cold.json.run.template.questions.length, 'with its questions');
  // Frozen at creation: re-resolving would let a re-pointed walk list change the questions
  // half a session in.
  assert.equal(cold.json.run.template.id, String(ctx.template._id));

  // Finishing from the resumed state works and closes cleanly.
  const second = cold.json.run.doorsRemaining[0];
  await call('POST', url(`/${runId}/door`), {
    ...asAdmin(),
    body: { actionId: second, voterPlans: { [String(ctx.voters[3]._id)]: { answers: UNDECIDED } } },
  });
  const after = await call('GET', url(`/${runId}`), asAdmin());
  assert.equal(after.json.run.doorsRemaining.length, 0, 'nothing left to walk');
  await call('POST', url(`/${runId}/close`), asAdmin());
  assert.equal((await SurveyConversionRun.findById(runId).lean()).status, 'completed');
  await call('POST', url(`/${runId}/revert`), asAdmin());
});

test('one door, two voters, DIFFERENT answers each — recorded in one pass', { skip }, async () => {
  // The per-voter mode's wire contract: voterPlans keyed by voter, each with its own answers.
  // One pass matters because the door stamps on save — a voter skipped "for now" has no second
  // chance through this tool.
  const row = await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.doors[0]._id,
    userId: ctx.canv._id, actionType: 'not_home', effortId: ctx.effort._id, passId: ctx.pass2._id,
    location: GPS, timestamp: new Date('2026-07-06T15:00:00Z'), coordinatorId: ctx.boss._id,
  });
  const opened = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'to_survey', to: 'survey_submitted', mode: 'queue', actionIds: [String(row._id)] },
  });
  const runId = opened.json.run.id;
  const [v1, v2] = [ctx.voters[0]._id, ctx.voters[1]._id]; // the two voters at door 1

  const step = await call('POST', url(`/${runId}/door`), {
    ...asAdmin(),
    body: {
      actionId: String(row._id),
      voterPlans: {
        [String(v1)]: { answers: YES },
        [String(v2)]: { answers: UNDECIDED },
      },
    },
  });
  assert.equal(step.status, 200);
  assert.equal(step.json.applied, true);

  const a1 = await SurveyResponse.findOne({ voterId: v1, passId: ctx.pass2._id }).lean();
  const a2 = await SurveyResponse.findOne({ voterId: v2, passId: ctx.pass2._id }).lean();
  assert.deepEqual(a1.answers[0].optionIds, ['yes'], 'first voter keeps their own answer');
  assert.deepEqual(a2.answers[0].optionIds, ['undecided'], 'second voter keeps theirs');
  assert.equal(String(a1.userId), String(ctx.canv._id), 'both credited to the knocking canvasser');
  assert.equal(String(a2.userId), String(ctx.canv._id));

  await call('POST', url(`/${runId}/close`), asAdmin());
  await call('POST', url(`/${runId}/revert`), asAdmin());
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

test('desk entries are disclosed to the OPERATOR and never to the client', { skip }, async () => {
  // The asymmetry is the point: a desk-entered answer is a real answer and counts identically, so
  // annotating the published figures would misrepresent them the other way — but whoever signs off
  // on a report should not find out afterwards that part of it was typed at a desk.
  const { computeWindowStats } = await import('../src/services/reports/computeReport.js');
  const { shapeReportForClient } = await import('../src/services/reports/clientReportView.js');

  const row = await CanvassActivity.findOne({
    campaignId: ctx.campaign._id, actionType: 'not_home', effortId: ctx.effort._id,
  }).lean();
  const runId = await bulkRun({ direction: 'to_survey', to: 'survey_submitted', actionIds: [String(row._id)], answers: YES });

  const stats = await computeWindowStats({
    orgId: ctx.org._id,
    campaignId: ctx.campaign._id,
    effortId: null,
    range: { $lt: new Date('2030-01-01') },
    campaignType: 'survey',
    template: ctx.template,
  });

  assert.ok(stats.provenance, 'the internal figure exists');
  assert.ok(stats.provenance.deskEnteredResponses > 0, 'and counts the desk entries');
  assert.ok(
    stats.provenance.totalResponses >= stats.provenance.deskEnteredResponses,
    'as a fraction of all responses'
  );

  // ...and the client-facing shaper is a strict whitelist, so it cannot escape.
  const shaped = shapeReportForClient({
    _id: new mongoose.Types.ObjectId(),
    campaignId: ctx.campaign._id,
    stats: { cumulative: stats, period: stats },
    visibility: {},
  });
  assert.ok(
    !JSON.stringify(shaped).includes('provenance'),
    'provenance must never reach the published page'
  );
  assert.ok(
    !JSON.stringify(shaped).includes('deskEntered'),
    'nor any desk-entry figure under another name'
  );

  await call('POST', url(`/${runId}/revert`), asAdmin());
});

test('run detail itemizes both ledgers, and says so honestly once undone', { skip }, async () => {
  // A fresh, self-contained run: one not_home door converted with an answer.
  const row = await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.doors[2]._id,
    userId: ctx.canv._id, actionType: 'not_home', effortId: ctx.effort._id, passId: ctx.pass2._id,
    location: GPS, timestamp: new Date('2026-07-07T15:00:00Z'), coordinatorId: ctx.boss._id,
  });
  const runId = await bulkRun({ direction: 'to_survey', to: 'survey_submitted', actionIds: [String(row._id)], answers: YES });

  // ?kind=doors — the flipped activity rows, was → now, with the door/canvasser/round treatment.
  const doors = await call('GET', url(`/${runId}/entries?kind=doors`), asAdmin());
  assert.equal(doors.status, 200);
  assert.equal(doors.json.total, 1);
  assert.equal(doors.json.entries[0].from, 'not_home');
  assert.equal(doors.json.entries[0].to, 'survey_submitted');
  assert.match(doors.json.entries[0].address, /Convert Ct/);
  assert.equal(doors.json.entries[0].canvasser, 'Cara Canvasser');
  assert.equal(doors.json.entries[0].round, 'R2');

  // ?kind=answers — who got an answer and what it says.
  const answers = await call('GET', url(`/${runId}/entries?kind=answers`), asAdmin());
  assert.equal(answers.json.total, 1);
  assert.equal(answers.json.entries[0].voterName, 'V4 Test');
  assert.deepEqual(answers.json.entries[0].answers[0], {
    questionLabel: 'Support?', answer: 'Yes', otherText: null,
  });

  // Leads never see the itemization (it is the same org-admin gate as everything here).
  assert.equal((await call('GET', url(`/${runId}/entries?kind=doors`), asLead())).status, 403);

  // Undone: the stamps are consumed — that is what makes revert exact — so the itemization is
  // honestly gone, flagged as reverted rather than rendered as a mysteriously empty list.
  await call('POST', url(`/${runId}/revert`), asAdmin());
  const after = await call('GET', url(`/${runId}/entries?kind=doors`), asAdmin());
  assert.equal(after.json.reverted, true);
  assert.equal(after.json.total, 0);
  const afterAnswers = await call('GET', url(`/${runId}/entries?kind=answers`), asAdmin());
  assert.equal(afterAnswers.json.reverted, true);
  assert.equal(afterAnswers.json.total, 0, 'forward-run responses were deleted by the revert');
  await CanvassActivity.deleteOne({ _id: row._id });
});

// ── The survey-answer filter ────────────────────────────────────────────────
// Fresh rows at a date no earlier test touches (Sep 15; the fixture lives on Jul 4), so the date
// window doubles as both the gate narrowing and the isolation — whatever state the tests above
// left the July ledger in, these see only their own.
const SEP_AT = new Date('2026-09-15T15:00:00Z'); // 10:00 America/Chicago
const SEP_SCOPE = { dateFrom: '2026-09-15', dateTo: '2026-09-15' };
const probe = {}; // shared by the answer-filter tests below, seeded once

test('an answer filter selects by the VISIT — the triple, never the row voter or the door', { skip }, async () => {
  const { org, campaign, effort, effortB, pass, canv, other, boss, template, otherTemplate } = ctx;
  const mkDoor = (n, eId) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: eId,
    addressLine1: `${n} Answer Av`, city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: `${n} answer av austin tx 78701`,
    location: { type: 'Point', coordinates: [-97.7 + n * 0.001, 30.3] },
    status: 'surveyed', isActive: true,
  });
  const [dA, dB, dC] = await Household.insertMany([mkDoor(101, effort._id), mkDoor(102, effort._id), mkDoor(103, effortB._id)]);
  const mkV = (d, n) => ({
    organizationId: org._id, campaignId: campaign._id, householdId: d._id,
    stateVoterId: `SVA${n}`, firstName: `A${n}`, lastName: 'Probe', fullName: `A${n} Probe`, surveyStatus: 'surveyed',
  });
  const [pA1, pA2, pA3, pB1, pC1] = await Voter.insertMany([mkV(dA, 1), mkV(dA, 2), mkV(dA, 3), mkV(dB, 4), mkV(dC, 5)]);

  const mkAct = (d, userId, voterId) => ({
    organizationId: org._id, campaignId: campaign._id, householdId: d._id, userId,
    actionType: 'survey_submitted', voterId, effortId: d.effortId, passId: pass._id,
    coordinatorId: boss._id, location: GPS, distanceFromHouseMeters: 9, timestamp: SEP_AT,
  });
  // Cara's visit to dA names pA2 on the row — while pA1 is the voter who gave the matching
  // answer. A voterId join would MISS this door; the triple join must find it.
  const acts = await CanvassActivity.insertMany([
    mkAct(dA, canv._id, pA2._id),
    mkAct(dA, other._id, pA3._id), // Otto's own honest visit to the same door, same round
    mkAct(dB, canv._id, pB1._id),
    mkAct(dC, canv._id, pC1._id),
  ]);
  const mkResp = (voter, d, userId, tmpl, optionId) => ({
    organizationId: org._id, campaignId: campaign._id, voterId: voter._id, householdId: d._id,
    userId, surveyTemplateId: tmpl._id, surveyTemplateVersion: tmpl.version || 1,
    answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: optionId, optionIds: [optionId] }],
    location: GPS, submittedAt: SEP_AT, passId: pass._id, effortId: d.effortId, coordinatorId: boss._id,
  });
  await SurveyResponse.insertMany([
    mkResp(pA1, dA, canv._id, template, 'undecided'), // THE match
    mkResp(pA2, dA, canv._id, template, 'yes'),
    mkResp(pA3, dA, other._id, template, 'yes'),      // Otto's voter answered differently
    mkResp(pB1, dB, canv._id, template, 'yes'),
    // Same questionKey AND same option id, but recorded under the OTHER template — the
    // cross-template slug collision the template scope exists to keep out.
    mkResp(pC1, dC, canv._id, otherTemplate, 'undecided'),
  ]);
  Object.assign(probe, { dA, dB, dC, pA1, pA2, pA3, canvRowA: acts[0], ottoRowA: acts[1] });

  const qsFor = (extra = {}) => {
    const sp = new URLSearchParams({ ...SEP_SCOPE, ...extra });
    return `/admin/campaigns/${campaign._id}/outcome-entries?${sp}`;
  };
  const FILTER = JSON.stringify([{ questionKey: 'support', values: ['undecided'], texts: [] }]);

  const hit = await call('GET', qsFor({ answerFilters: FILTER }), asAdmin());
  assert.equal(hit.status, 200);
  // Exactly Cara's visit to dA: not Otto's row at the SAME door (his voter answered yes — a
  // door-level join would sweep his honest work into her cleanup), not dB (no match), not dC
  // (matches only under the other template), and not the row voter's answer (pA2 said yes).
  assert.equal(hit.json.total, 1);
  assert.equal(hit.json.entries[0].id, String(acts[0]._id));
  assert.deepEqual(hit.json.facets, { survey_submitted: 1 });
  assert.deepEqual(hit.json.sources, ['survey_submitted']);

  // The row carries its own evidence: who answered at THIS visit, who matched, and who is
  // merely at the same door — the fact the removal preview will price.
  const ev = hit.json.entries[0].survey;
  assert.equal(ev.voters, 2);
  assert.equal(ev.answers, 2);
  assert.equal(ev.matchedVoters, 1);
  assert.equal(ev.matched.length, 1);
  assert.equal(ev.matched[0].voterName, 'A1 Probe');
  assert.deepEqual(ev.matched[0].answers.map((a) => a.text), ['undecided']);
  assert.deepEqual(ev.otherNames, ['A2 Probe']);
  assert.equal(hit.json.answerScope.responses, 1);
  assert.equal(hit.json.answerScope.truncated, false);
  assert.equal(hit.json.totalIsLowerBound, undefined);

  // A non-matching option selects nothing — {_id: null}, never an open filter.
  const miss = await call('GET', qsFor({ answerFilters: JSON.stringify([{ questionKey: 'support', values: ['no'], texts: [] }]) }), asAdmin());
  assert.equal(miss.json.total, 0);

  // The SAME filter scoped to the other template finds ONLY the collision row.
  const crossed = await call('GET', qsFor({ answerFilters: FILTER, surveyTemplateId: String(otherTemplate._id) }), asAdmin());
  assert.equal(crossed.json.total, 1);
  assert.equal(crossed.json.entries[0].id, String(acts[3]._id));
});

test('the answer filter refuses rather than guessing — gate, template, chip conflict', { skip }, async () => {
  const FILTER = JSON.stringify([{ questionKey: 'support', values: ['undecided'], texts: [] }]);
  const base = `/admin/campaigns/${ctx.campaign._id}/outcome-entries`;

  // No other narrowing: the response scan would be campaign-wide, twice per page load.
  const ungated = await call('GET', `${base}?answerFilters=${encodeURIComponent(FILTER)}`, asAdmin());
  assert.equal(ungated.status, 400);
  assert.equal(ungated.json.code, 'ANSWER_FILTER_NEEDS_NARROWING');
  // ...and identically on a write body, since all four routes resolve through one function.
  const ungatedWrite = await call('POST', url(), {
    ...asAdmin(),
    body: {
      direction: 'from_survey', to: 'not_home', dryRun: true,
      scope: { answerFilters: [{ questionKey: 'support', values: ['undecided'] }] },
    },
  });
  assert.equal(ungatedWrite.status, 400);
  assert.equal(ungatedWrite.json.code, 'ANSWER_FILTER_NEEDS_NARROWING');

  // A non-Surveyed chip beside an answer filter is a contradiction, not a combination.
  const conflicted = await call('GET', `${base}?outcomes=not_home&dateFrom=2026-09-15&dateTo=2026-09-15&answerFilters=${encodeURIComponent(FILTER)}`, asAdmin());
  assert.equal(conflicted.status, 400);
  assert.equal(conflicted.json.code, 'ANSWER_FILTER_REQUIRES_SURVEYED');

  // A template id that resolves to nothing refuses — it must never fall back to matching
  // another survey's same-named slugs.
  const ghost = new mongoose.Types.ObjectId();
  const noTemplate = await call('GET', `${base}?dateFrom=2026-09-15&dateTo=2026-09-15&surveyTemplateId=${ghost}&answerFilters=${encodeURIComponent(FILTER)}`, asAdmin());
  assert.equal(noTemplate.status, 400);
  assert.equal(noTemplate.json.code, 'ANSWER_FILTER_NEEDS_TEMPLATE');

  // Unreadable JSON refuses too — a parse failure must never become "no filter".
  const garbled = await call('GET', `${base}?dateFrom=2026-09-15&answerFilters=%7Bnot-json`, asAdmin());
  assert.equal(garbled.status, 400);
  assert.equal(garbled.json.code, 'INVALID_SCOPE');
});

test('door-unit semantics are PRICED out loud: one matching answer, two archived', { skip }, async () => {
  // The filter selects doors where SOMEONE answered undecided; the conversion archives every
  // response at that visit's triple — pA2's yes goes with pA1's undecided, and the preview must
  // say so by name. Otto's voter at the same door is untouched (his triple, his work).
  const scope = { ...SEP_SCOPE, answerFilters: [{ questionKey: 'support', values: ['undecided'] }] };
  const dry = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'from_survey', to: 'not_home', dryRun: true, scope },
  });
  assert.equal(dry.status, 200);
  assert.equal(dry.json.entries, 1);
  assert.equal(dry.json.doors, 1);
  assert.equal(dry.json.survey.responsesToArchive, 2);
  assert.equal(dry.json.survey.votersAffected, 2);
  // The widening is stated in numbers AND in names: one answer matched, two go, and the
  // manifest is sorted matched-first with each row flagged — so a truncated manifest can never
  // show only the swept-along voters.
  assert.equal(dry.json.survey.matchedResponses, 1);
  assert.equal(dry.json.survey.matchedVoters, 1);
  assert.deepEqual(
    dry.json.survey.manifest.map((m) => [m.voterName, m.matchedFilter]),
    [['A1 Probe', true], ['A2 Probe', false]]
  );
});

test('select-all under an answer filter writes EXACTLY the listed rows', { skip }, async () => {
  const scope = { ...SEP_SCOPE, answerFilters: [{ questionKey: 'support', values: ['undecided'] }] };
  const runId = await bulkRun({ direction: 'from_survey', to: 'not_home', scope });
  const run = await SurveyConversionRun.findById(runId).lean();
  assert.equal(run.status, 'completed');
  assert.equal(run.counts.entriesConverted, 1);
  assert.equal(run.counts.responsesArchived, 2);

  // Cara's row converted and stamped; Otto's row at the same door untouched; his voter's
  // answer intact.
  const caraRow = await CanvassActivity.findById(probe.canvRowA._id).lean();
  assert.equal(caraRow.actionType, 'not_home');
  assert.equal(String(caraRow.reclassified.runId), String(runId));
  const ottoRow = await CanvassActivity.findById(probe.ottoRowA._id).lean();
  assert.equal(ottoRow.actionType, 'survey_submitted');
  assert.equal(ottoRow.reclassified, undefined);
  assert.ok(await SurveyResponse.exists({ voterId: probe.pA3._id }), "Otto's voter keeps her answer");
  assert.equal(await SurveyResponse.exists({ voterId: probe.pA1._id }), null, 'the matching answer is archived');
});

test('a truncated answer scope caps the browse and refuses the filter-scoped write', { skip }, async () => {
  // Cap forced to 1 via the call-time env override; 'yes' still matches at least two Sep
  // responses (Otto's voter at dA, and dB), so the resolution truncates. The invariant being
  // pinned: never write a row the admin did not see — a truncated resolution is an arbitrary
  // cap-sized subset of what they described, so scope-only writes refuse while id-scoped ones
  // (rows they explicitly ticked, by construction inside the resolved set) do not trip it.
  const scope = { ...SEP_SCOPE, answerFilters: [{ questionKey: 'support', values: ['yes'] }] };
  process.env.ANSWER_SCOPE_MAX_RESPONSES = '1';
  try {
    const sp = new URLSearchParams({ ...SEP_SCOPE, answerFilters: JSON.stringify(scope.answerFilters) });
    const browse = await call('GET', `/admin/campaigns/${ctx.campaign._id}/outcome-entries?${sp}`, asAdmin());
    assert.equal(browse.status, 200);
    assert.equal(browse.json.answerScope.truncated, true);
    assert.equal(browse.json.answerScope.cap, 1);
    assert.equal(browse.json.totalIsLowerBound, true);

    const scopeOnly = await call('POST', url(), {
      ...asAdmin(),
      body: { direction: 'from_survey', to: 'not_home', dryRun: true, scope },
    });
    assert.equal(scopeOnly.status, 409);
    assert.equal(scopeOnly.json.code, 'ANSWER_SCOPE_TRUNCATED');

    const byIds = await call('POST', url(), {
      ...asAdmin(),
      body: { direction: 'from_survey', to: 'not_home', dryRun: true, scope, actionIds: [String(probe.ottoRowA._id)] },
    });
    assert.notEqual(byIds.json.code, 'ANSWER_SCOPE_TRUNCATED');
    assert.notEqual(byIds.status, 409);
  } finally {
    delete process.env.ANSWER_SCOPE_MAX_RESPONSES;
  }
});

// Sep 16 — its own isolation window, one day past the answer-filter probes.
const SEP2_AT = new Date('2026-09-16T15:00:00Z');

test('the activity detail pane shows THIS round\'s answers, not whichever came first', { skip }, async () => {
  const { org, campaign, effort, pass, pass2, canv, boss, template } = ctx;
  const [dX] = await Household.insertMany([{
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: '201 Detail Dr', city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: '201 detail dr austin tx 78701',
    location: { type: 'Point', coordinates: [-97.69, 30.31] }, status: 'surveyed', isActive: true,
  }]);
  const [vX, vY] = await Voter.insertMany([
    { organizationId: org._id, campaignId: campaign._id, householdId: dX._id, stateVoterId: 'SVD1', firstName: 'D1', lastName: 'Probe', fullName: 'D1 Probe', surveyStatus: 'surveyed' },
    { organizationId: org._id, campaignId: campaign._id, householdId: dX._id, stateVoterId: 'SVD2', firstName: 'D2', lastName: 'Probe', fullName: 'D2 Probe', surveyStatus: 'surveyed' },
  ]);
  const mkResp = (voter, passId, optionId) => ({
    organizationId: org._id, campaignId: campaign._id, voterId: voter._id, householdId: dX._id,
    userId: canv._id, surveyTemplateId: template._id, surveyTemplateVersion: template.version || 1,
    answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: optionId, optionIds: [optionId] }],
    location: GPS, submittedAt: SEP2_AT, passId, effortId: effort._id, coordinatorId: boss._id,
  });
  // Round 1 says yes, round 2 says undecided — the voter changed their mind between rounds,
  // which is exactly when a voterId-only lookup shows the wrong conversation.
  await SurveyResponse.insertMany([mkResp(vX, pass._id, 'yes'), mkResp(vX, pass2._id, 'undecided'), mkResp(vY, pass._id, 'no')]);
  const mkAct = (passId) => ({
    organizationId: org._id, campaignId: campaign._id, householdId: dX._id, userId: canv._id,
    actionType: 'survey_submitted', voterId: vX._id, effortId: effort._id, passId,
    coordinatorId: boss._id, location: GPS, distanceFromHouseMeters: 4, timestamp: SEP2_AT,
  });
  const [a1, a2] = await CanvassActivity.insertMany([mkAct(pass._id), mkAct(pass2._id)]);
  Object.assign(probe, { detailDoor: dX, detailActs: [a1, a2] });

  const r1 = await call('GET', `/admin/activities/${a1._id}`, asAdmin());
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.json.surveyResponse.answers[0].optionIds, ['yes']);
  const r2 = await call('GET', `/admin/activities/${a2._id}`, asAdmin());
  assert.deepEqual(r2.json.surveyResponse.answers[0].optionIds, ['undecided']);
});

test('the REVERSE direction is volume-guarded too — a capped preview refuses, never lies', { skip }, async () => {
  // The forward direction always refused past the cap; the reverse read silently truncated, so
  // responsesToArchive and the manifest total presented lower bounds as totals. Cap forced to 1
  // via the call-time env override; the Sep-16 visit holds two responses.
  const scope = { dateFrom: '2026-09-16', dateTo: '2026-09-16', passId: String(ctx.pass._id) };
  process.env.SURVEY_CONVERT_MAX_RESPONSES = '1';
  try {
    const dry = await call('POST', url(), {
      ...asAdmin(),
      body: { direction: 'from_survey', to: 'not_home', dryRun: true, scope },
    });
    assert.equal(dry.status, 409);
    assert.equal(dry.json.code, 'TOO_MANY_RESPONSES');
  } finally {
    delete process.env.SURVEY_CONVERT_MAX_RESPONSES;
  }
  // With the cap back at its default the same preview renders, and its numbers are exact.
  const ok = await call('POST', url(), {
    ...asAdmin(),
    body: { direction: 'from_survey', to: 'not_home', dryRun: true, scope },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.survey.responsesToArchive, 2);
});

test('the CSV export is the TABLE as a file — same scope machinery, evidence included', { skip }, async () => {
  // The Sep-16 seed: vX answered yes in round 1 and undecided in round 2; vY answered no in
  // round 1. An undecided filter therefore matches exactly the round-2 visit.
  const sp = new URLSearchParams({
    dateFrom: '2026-09-16',
    dateTo: '2026-09-16',
    answerFilters: JSON.stringify([{ questionKey: 'support', values: ['undecided'] }]),
  });
  const json = await call('GET', `/admin/campaigns/${ctx.campaign._id}/outcome-entries?${sp}`, asAdmin());
  assert.equal(json.json.total, 1);

  const res = await fetch(`${base}/api/admin/campaigns/${ctx.campaign._id}/outcome-entries.csv?${sp}`, {
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const bodyText = await res.text();
  const lines = bodyText.trim().split('\r\n');
  // Header plus exactly the rows the JSON table showed — one scope resolver, one filter builder,
  // so the file cannot disagree with the table that previewed it.
  assert.equal(lines.length - 1, json.json.total);
  assert.match(lines[0], /Matched voters/);
  const row = lines[1];
  assert.match(row, /201 Detail Dr/);
  assert.match(row, /D1 Probe/);   // the matched voter, by name
  assert.match(row, /undecided/);  // and the answer that matched

  // The same route refuses the same things the table does — one resolver, one set of refusals.
  const ungated = await fetch(
    `${base}/api/admin/campaigns/${ctx.campaign._id}/outcome-entries.csv?answerFilters=${encodeURIComponent(
      JSON.stringify([{ questionKey: 'support', values: ['undecided'] }])
    )}`,
    { headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) } }
  );
  assert.equal(ungated.status, 400);
  assert.equal((await ungated.json()).code, 'ANSWER_FILTER_NEEDS_NARROWING');

  // Leads cannot pull the file any more than they can see the page.
  const lead = await fetch(`${base}/api/admin/campaigns/${ctx.campaign._id}/outcome-entries.csv?${sp}`, {
    headers: { Authorization: `Bearer ${ctx.leadTok}`, 'X-Org-Id': String(ctx.org._id) },
  });
  assert.equal(lead.status, 403);
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
