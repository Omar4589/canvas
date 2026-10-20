import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import mongoose from 'mongoose';

// The scale gate for Edit answers (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §D6 and §S): 20k doors, 36k
// voters, 79k surveys, against the REAL app and a throwaway mongod. The caps ship only if the dry
// run and the create finish under 10 s AT the caps — Cara's whole history here is exactly 25,000
// entries holding exactly 50,000 surveys, the entry cap and the survey cap at once. The job's and
// the undo's times at 50k are reported, not gated (they run on the worker, with a progress bar).
//
// OPT-IN — it seeds ~150k rows and runs a 37,500-survey job, so the marathon skips it:
//   cd server && ANSWER_EDIT_SCALE=1 npm run test:int -- test/answerEditScale.int.test.js
//
// The pattern is the yard-sign cleanup: 75% of Cara's surveys carry a fake Volunteer Request or
// Candidate Follow-Up pick, 25% only a real Yard Sign Delivered; Otto's genuine volunteers must
// survive. Redis points at a dead port, as in answerEdit.int.test.js: the create answers 503 and
// the test drives the real processor with the job id the route wrote onto the run.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-scale';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.ANSWER_EDIT_ENQUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyResponseArchive } = await import('../src/models/SurveyResponseArchive.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { AnswerEditRun } = await import('../src/models/AnswerEditRun.js');
const { AnswerEditRunChunk } = await import('../src/models/AnswerEditRunChunk.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { processAnswerEditJob } = await import('../src/services/canvass/answerEditRuns.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = !URI
  ? 'set MONGODB_URI_TEST to run (needs a throwaway mongod)'
  : process.env.ANSWER_EDIT_SCALE
    ? false
    : 'opt-in: set ANSWER_EDIT_SCALE=1 (seeds 79k surveys)';

const GATE_MS = 10_000;
const DOORS = 20_000;
const TWO_VOTER_DOORS = 16_000; // doors 0..15,999 hold two voters, the rest one: 36,000 voters
const CARA_DOORS = 12_500; // two-voter doors 0..12,499, rounds 1 and 2: 25,000 entries, 50,000 surveys
const BATCH = 10_000;

const SUPPORT_RULE = { logic: 'any', rules: [{ questionKey: 'candidate_support', op: 'any_of', optionIds: ['strong_support', 'lean_support'] }] };
const QUESTIONS = [
  {
    key: 'candidate_support', label: 'Can we count on your support?', type: 'single_choice', order: 0,
    options: [
      { id: 'strong_support', text: 'Support', tag: 'Supporter', order: 0 },
      { id: 'lean_support', text: 'Likely Support', tag: 'Supporter', order: 1 },
      { id: 'opposed', text: 'Opposed', order: 2 },
    ],
  },
  {
    key: 'top_issue', label: 'What is your top issue?', type: 'multiple_choice', order: 1,
    options: [{ id: 'healthcare', text: 'Healthcare costs', order: 0 }, { id: 'public_schools', text: 'Public schools & education', order: 1 }],
  },
  {
    key: 'yard_sign', label: 'Could you help us by taking a yard sign?', type: 'multiple_choice', order: 2, visibleIf: SUPPORT_RULE,
    options: [
      { id: 'yard_sign_delivered', text: 'Yard Sign Delivered', order: 0 },
      { id: 'candidate_follow_up', text: 'Candidate Follow-Up', order: 1 },
      { id: 'volunteer_request', text: 'Volunteer Request', order: 2, tag: 'Volunteer' },
    ],
  },
];
const TEXT = { yard_sign_delivered: 'Yard Sign Delivered', candidate_follow_up: 'Candidate Follow-Up', volunteer_request: 'Volunteer Request' };

// Cara's k-th survey, by k % 20: 6 Volunteer Request, 4 Candidate Follow-Up, 2 both, 3 a real sign
// plus a fake Volunteer Request, 5 only the real sign. 75% hold a fake pick.
const caraSign = (k) => {
  const m = k % 20;
  if (m < 6) return ['volunteer_request'];
  if (m < 10) return ['candidate_follow_up'];
  if (m < 12) return ['candidate_follow_up', 'volunteer_request'];
  if (m < 15) return ['yard_sign_delivered', 'volunteer_request'];
  return ['yard_sign_delivered'];
};
const ottoSign = (k) => (k % 2 ? ['volunteer_request'] : ['yard_sign_delivered']);

let server;
let base;
const ctx = {};
const timings = {};

const timed = async (label, fn) => {
  const t0 = performance.now();
  const out = await fn();
  timings[label] = Math.round(performance.now() - t0);
  return out;
};

before(async () => {
  if (skip) return;
  await mongoose.connect(URI);
  const models = [
    Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Household, Voter, CanvassActivity,
    SurveyResponse, SurveyResponseArchive, SurveyTemplate, AnswerEditRun, AnswerEditRunChunk, CampaignChange, Subscription,
  ];
  for (const M of models) await M.deleteMany({});
  // Indexes BEFORE the timings: production has every one of them.
  for (const M of [Household, Voter, CanvassActivity, SurveyResponse, SurveyResponseArchive, AnswerEditRun, AnswerEditRunChunk]) {
    await M.syncIndexes();
  }

  const org = await Organization.create({ name: 'Scale Org', slug: 'scale-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'sa@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'sc@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'so@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Scale C', type: 'survey', state: 'FL', isActive: true,
    timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  for (const u of [cara, otto]) await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: u._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Main' });
  const rounds = [];
  for (const n of [1, 2, 3]) {
    rounds.push(await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: n, name: `Round ${n}`, status: 'active' }));
  }

  const ids = { org: org._id, campaign: campaign._id, effort: effort._id };
  const lng = (d) => -82.1 + (d % 200) * 0.0005;
  const lat = (d) => 28.2 + Math.floor(d / 200) * 0.0005;
  const homeIds = Array.from({ length: DOORS }, () => new mongoose.Types.ObjectId());
  const homes = homeIds.map((_id, d) => ({
    _id, organizationId: ids.org, campaignId: ids.campaign, effortId: ids.effort,
    addressLine1: `${d + 1} Oak St`, city: 'Town', state: 'FL', zipCode: '33540', normalizedAddress: `OAK${d + 1}`,
    location: { type: 'Point', coordinates: [lng(d), lat(d)] }, isActive: true, status: 'surveyed',
    createdAt: new Date(), updatedAt: new Date(),
  }));
  for (let i = 0; i < homes.length; i += BATCH) await Household.collection.insertMany(homes.slice(i, i + BATCH), { ordered: false });

  // votersAt[d] = the voter ids living at door d.
  const votersAt = [];
  const voterDocs = [];
  for (let d = 0; d < DOORS; d += 1) {
    const n = d < TWO_VOTER_DOORS ? 2 : 1;
    votersAt.push([]);
    for (let j = 0; j < n; j += 1) {
      const _id = new mongoose.Types.ObjectId();
      votersAt[d].push(_id);
      voterDocs.push({
        _id, organizationId: ids.org, campaignId: ids.campaign, householdId: homeIds[d],
        stateVoterId: `OAK-${d + 1}-${j}`, firstName: 'V', lastName: `${d + 1}-${j}`, fullName: `Voter ${d + 1}-${j}`,
        createdAt: new Date(), updatedAt: new Date(),
      });
    }
  }
  for (let i = 0; i < voterDocs.length; i += BATCH) await Voter.collection.insertMany(voterDocs.slice(i, i + BATCH), { ordered: false });

  // One visit per (door, round, canvasser), each with its surveys — the shape both ledgers keep.
  const visits = [];
  for (const r of [0, 1]) for (let d = 0; d < CARA_DOORS; d += 1) visits.push({ d, r, user: cara });
  for (const r of [0, 1]) for (let d = CARA_DOORS; d < DOORS; d += 1) visits.push({ d, r, user: otto });
  for (let d = CARA_DOORS; d < TWO_VOTER_DOORS; d += 1) visits.push({ d, r: 2, user: otto });

  const dayMs = 24 * 3600_000;
  const roundStart = [Date.now() - 12 * dayMs, Date.now() - 7 * dayMs, Date.now() - 2 * dayMs];
  let caraK = 0;
  let ottoK = 0;
  let acts = [];
  let surveys = [];
  const flush = async (force = false) => {
    if (acts.length >= BATCH || (force && acts.length)) {
      await CanvassActivity.collection.insertMany(acts, { ordered: false });
      acts = [];
    }
    if (surveys.length >= BATCH || (force && surveys.length)) {
      await SurveyResponse.collection.insertMany(surveys, { ordered: false });
      surveys = [];
    }
  };
  for (let i = 0; i < visits.length; i += 1) {
    const { d, r, user } = visits[i];
    const at = new Date(roundStart[r] + (i % 40_000) * 6_000);
    const location = { lat: lat(d), lng: lng(d), accuracy: 6 };
    acts.push({
      organizationId: ids.org, campaignId: ids.campaign, householdId: homeIds[d], voterId: null, userId: user._id,
      actionType: 'survey_submitted', note: null, location, distanceFromHouseMeters: 3, replaced: null,
      timestamp: at, wasOfflineSubmission: false, via: null, passId: rounds[r]._id, effortId: ids.effort,
      createdAt: at, updatedAt: at,
    });
    for (const voterId of votersAt[d]) {
      const sign = user === cara ? caraSign(caraK++) : ottoSign(ottoK++);
      surveys.push({
        organizationId: ids.org, campaignId: ids.campaign, voterId, householdId: homeIds[d], userId: user._id,
        surveyTemplateId: template._id, surveyTemplateVersion: 1,
        answers: [
          { questionKey: 'candidate_support', questionLabel: 'Can we count on your support?', answer: 'Support', optionIds: ['strong_support'], otherText: null },
          { questionKey: 'top_issue', questionLabel: 'What is your top issue?', answer: ['Healthcare costs'], optionIds: ['healthcare'], otherText: null },
          { questionKey: 'yard_sign', questionLabel: 'Could you help us by taking a yard sign?', answer: sign.map((s) => TEXT[s]), optionIds: sign, otherText: null },
        ],
        note: null, location, distanceFromHouseMeters: 3, submittedAt: at, syncedAt: at, wasOfflineSubmission: false,
        passId: rounds[r]._id, turfId: null, effortId: ids.effort, coordinatorId: null, editedBy: null, editedAt: null,
        createdAt: at, updatedAt: at,
      });
    }
    await flush();
  }
  await flush(true);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, campaign, template, rounds, admin, cara, otto, adminTok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (!skip) await mongoose.disconnect();
});

const call = async (method, path, body) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const edits = () => `/admin/campaigns/${ctx.campaign._id}/answer-edits`;
const TAKE_OUT = [{ questionKey: 'yard_sign', op: 'adjust', remove: ['candidate_follow_up', 'volunteer_request'] }];
const resultsFor = async (questionKey) => {
  const r = await call('GET', `/admin/reports/survey-results?campaignId=${ctx.campaign._id}&surveyTemplateId=${ctx.template._id}`);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const q = r.json.questions.find((x) => x.key === questionKey);
  return Object.fromEntries((q?.options || []).map((o) => [o.id || o.option, o.count]));
};
const report = (t, label) => t.diagnostic(`${label}: ${timings[label].toLocaleString()} ms`);

test('the seed is the plan’s dataset: 20k doors, 36k voters, 79k surveys', { skip }, async () => {
  assert.strictEqual(await Household.countDocuments({ campaignId: ctx.campaign._id }), 20_000);
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.campaign._id }), 36_000);
  assert.strictEqual(await SurveyResponse.countDocuments({ campaignId: ctx.campaign._id }), 79_000);
  assert.strictEqual(await CanvassActivity.countDocuments({ campaignId: ctx.campaign._id, userId: ctx.cara._id }), 25_000);
});

test('the owner’s filter at scale: a whole round of Cara’s fake picks, priced under the gate', { skip }, async (t) => {
  // An answer filter matches at most 20,000 answers (answerScopeCap); one round of Cara's is 18,750.
  const scope = {
    userId: String(ctx.cara._id),
    passId: String(ctx.rounds[0]._id),
    outcomes: ['survey_submitted'],
    surveyTemplateId: String(ctx.template._id),
    answerFilters: [{ questionKey: 'yard_sign', values: ['candidate_follow_up', 'volunteer_request'] }],
  };
  const form = await timed('filtered form dry run', () => call('POST', edits(), { dryRun: true, scope }));
  assert.strictEqual(form.status, 200, JSON.stringify(form.json));
  assert.strictEqual(form.json.responses, 18_750, '75% of the round’s 25,000');
  assert.strictEqual(form.json.entries, 10_000, 'the visits where someone holds a fake pick');
  assert.strictEqual(form.json.notMatched, 1_250, 'their housemates with only a real sign');
  const priced = await timed('filtered priced dry run', () => call('POST', edits(), { dryRun: true, scope, plan: TAKE_OUT }));
  assert.strictEqual(priced.status, 200, JSON.stringify(priced.json));
  assert.strictEqual(priced.json.price.surveysChanged, 18_750);
  report(t, 'filtered form dry run');
  report(t, 'filtered priced dry run');
  assert.ok(timings['filtered form dry run'] < GATE_MS, `form dry run ${timings['filtered form dry run']} ms`);
  assert.ok(timings['filtered priced dry run'] < GATE_MS, `priced dry run ${timings['filtered priced dry run']} ms`);
});

test('at the caps — 25,000 entries, 50,000 surveys: dry run and create under 10 s; the job lands the reviewed numbers', { skip }, async (t) => {
  const scope = { userId: String(ctx.cara._id), outcomes: ['survey_submitted'] };
  const before = await resultsFor('yard_sign');

  const form = await timed('form dry run at the caps', () => call('POST', edits(), { dryRun: true, scope }));
  assert.strictEqual(form.status, 200, JSON.stringify(form.json));
  assert.strictEqual(form.json.entries, 25_000);
  assert.strictEqual(form.json.responses, 50_000);
  assert.strictEqual(form.json.limits.tooMany, false, 'exactly at the cap is allowed');

  const dry = await timed('priced dry run at the caps', () => call('POST', edits(), { dryRun: true, scope, plan: TAKE_OUT }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  const price = dry.json.price;
  assert.strictEqual(price.surveysChanged, 37_500, 'every survey holding a fake pick');
  const yq = price.byQuestion.find((q) => q.questionKey === 'yard_sign');
  assert.deepStrictEqual(Object.fromEntries(yq.removed.map((r) => [r.id, r.surveys])), { volunteer_request: 27_500, candidate_follow_up: 15_000 });
  assert.strictEqual(yq.leftBlank, 30_000);
  assert.strictEqual(yq.multi, 5_000);
  assert.deepStrictEqual(yq.kept.map((k) => [k.id, k.surveys]), [['yard_sign_delivered', 7_500]]);
  assert.strictEqual(price.tagsUnavailable, false, 'the tag pass ran at this size');
  const previewAfter = Object.fromEntries(price.results.find((r) => r.questionKey === 'yard_sign').options.map((o) => [o.id, o.after]));

  const created = await timed('create at the caps', () =>
    call('POST', edits(), { scope, plan: TAKE_OUT, dryRun: false, digest: dry.json.digest, asOf: dry.json.asOf, templateVersion: dry.json.template.version })
  );
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  assert.strictEqual(created.json.code, 'QUEUE_UNAVAILABLE');
  const runId = created.json.run.id;
  assert.strictEqual(await AnswerEditRunChunk.countDocuments({ runId }), 100, '50,000 frozen items, 500 a chunk');

  for (const label of ['form dry run at the caps', 'priced dry run at the caps', 'create at the caps']) {
    report(t, label);
    assert.ok(timings[label] < GATE_MS, `${label}: ${timings[label]} ms — over the ${GATE_MS} ms gate`);
  }

  // The job, reported: every frozen survey, on the worker. The dead queue parked the run with its job
  // id forgotten (a late delivery must never claim it), so a fresh id stands in for a Pick up that
  // reached the queue — the answerEdit.int.test.js pattern.
  const jobId = `scale-apply-${runId}`;
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { queueJobId: jobId, status: 'pending', error: null } });
  const out = await timed('apply job, 50,000 surveys', () =>
    processAnswerEditJob({ id: jobId, name: 'apply', data: { runId }, opts: { attempts: 3 }, attemptsMade: 0 })
  );
  report(t, 'apply job, 50,000 surveys');
  assert.strictEqual(out.completed, true);
  const run = await AnswerEditRun.findById(runId).lean();
  assert.strictEqual(run.status, 'completed');
  assert.strictEqual(run.counts.surveysChanged, 37_500);
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ answerEditRunId: run._id }), 37_500, 'one earlier copy per changed survey');

  // What landed is what was reviewed, to the pick — and Otto's genuine volunteers are all still there.
  const landed = await resultsFor('yard_sign');
  for (const [id, n] of Object.entries(previewAfter)) assert.strictEqual(landed[id] || 0, n, `${id}: preview == landed`);
  assert.strictEqual(
    await SurveyResponse.countDocuments({ campaignId: ctx.campaign._id, userId: ctx.otto._id, 'answers.optionIds': 'volunteer_request' }),
    14_500,
    'Otto’s 29,000 surveys, half of them genuine volunteers'
  );
  assert.strictEqual(await SurveyResponse.countDocuments({ campaignId: ctx.campaign._id }), 79_000, 'nobody stops being surveyed');

  // The undo, reported: every survey put back.
  const undoJob = `scale-undo-${runId}`;
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { 'undo.status': 'pending', 'undo.jobId': undoJob, 'undo.requestedAt': new Date() } });
  await timed('undo job, 37,500 surveys', () =>
    processAnswerEditJob({ id: undoJob, name: 'undo', data: { runId }, opts: { attempts: 3 }, attemptsMade: 0 })
  );
  report(t, 'undo job, 37,500 surveys');
  const undone = await AnswerEditRun.findById(runId).lean();
  assert.strictEqual(undone.undo.status, 'done');
  assert.strictEqual(undone.undo.summary.putBack, 37_500);
  assert.deepStrictEqual(await resultsFor('yard_sign'), before, 'every pick back where it was');
});

// The heavy shape (code review round 3): a branching first answer whose Clear drops eight tagged
// follow-ups on every survey, 16 tags across them, at the 50,000-survey cap — so the review prices 9
// questions and every tag. It took 28 s before round 3 (the router cuts a request at 30 s); the gate
// is the same 10 s, with every tag priced, and what lands is what the review said.
test('heavy review — a Clear that drops 8 tagged follow-ups, 16 tags, 50,000 surveys: priced under 10 s with every tag; preview == landed', { skip }, async (t) => {
  const FOLLOW = 8;
  const TAGS = 16;
  const rule = { logic: 'any', rules: [{ questionKey: 'q0', op: 'any_of', optionIds: ['yes'] }] };
  const questions = [
    { key: 'q0', label: 'Support?', type: 'single_choice', order: 0, options: [{ id: 'yes', text: 'Yes', tag: 'Tag0', order: 0 }, { id: 'no', text: 'No', order: 1 }] },
    ...Array.from({ length: FOLLOW }, (_, f) => ({
      key: `f${f}`, label: `Follow ${f}?`, type: 'multiple_choice', order: f + 1, visibleIf: rule,
      options: Array.from({ length: 4 }, (_, k) => ({ id: `f${f}o${k}`, text: `F${f} option ${k}`, tag: `Tag${(f * 4 + k) % TAGS}`, order: k })),
    })),
  ];
  const { org, cara } = ctx;
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Deep Survey', version: 1, isActive: true, questions });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Deep C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: cara._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Main' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const at0 = Date.now() - 2 * 24 * 3600_000;
  for (let s0 = 0; s0 < 50_000; s0 += BATCH) {
    const homes = [];
    const voters = [];
    const surveys = [];
    const acts = [];
    for (let i = s0; i < s0 + BATCH; i += 1) {
      if (i % 2 === 0) {
        homes.push({
          _id: new mongoose.Types.ObjectId(), organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
          addressLine1: `${i + 1} Elm St`, city: 'Town', state: 'FL', zipCode: '33540', normalizedAddress: `ELM${i + 1}`,
          location: { type: 'Point', coordinates: [-82, 28] }, isActive: true, status: 'surveyed', createdAt: new Date(), updatedAt: new Date(),
        });
      }
      const householdId = homes[homes.length - 1]._id;
      const voterId = new mongoose.Types.ObjectId();
      const at = new Date(at0 + i * 1000);
      voters.push({ _id: voterId, organizationId: org._id, campaignId: campaign._id, householdId, stateVoterId: `ELM-${i}`, firstName: 'V', lastName: `${i}`, fullName: `Elm Voter ${i}`, createdAt: at, updatedAt: at });
      const answers = [{ questionKey: 'q0', questionLabel: 'Support?', answer: 'Yes', optionIds: ['yes'], otherText: null }];
      for (let f = 0; f < FOLLOW; f += 1) {
        const ids = [`f${f}o${i % 4}`, `f${f}o${(i + 1) % 4}`];
        answers.push({ questionKey: `f${f}`, questionLabel: `Follow ${f}?`, answer: ids.map((id) => `F${f} option ${id.slice(-1)}`), optionIds: ids, otherText: null });
      }
      surveys.push({
        organizationId: org._id, campaignId: campaign._id, voterId, householdId, userId: cara._id, surveyTemplateId: template._id, surveyTemplateVersion: 1,
        answers, note: null, location: { lat: 28, lng: -82, accuracy: 6 }, distanceFromHouseMeters: 3, submittedAt: at, syncedAt: at, wasOfflineSubmission: false,
        passId: pass._id, turfId: null, effortId: effort._id, coordinatorId: null, editedBy: null, editedAt: null, createdAt: at, updatedAt: at,
      });
      if (i % 2 === 1) {
        acts.push({
          organizationId: org._id, campaignId: campaign._id, householdId, voterId, userId: cara._id, actionType: 'survey_submitted', note: null,
          location: { lat: 28, lng: -82, accuracy: 6 }, distanceFromHouseMeters: 3, replaced: null, timestamp: at, wasOfflineSubmission: false, via: null,
          passId: pass._id, effortId: effort._id, createdAt: at, updatedAt: at,
        });
      }
    }
    await Household.collection.insertMany(homes, { ordered: false });
    await Voter.collection.insertMany(voters, { ordered: false });
    await SurveyResponse.collection.insertMany(surveys, { ordered: false });
    await CanvassActivity.collection.insertMany(acts, { ordered: false });
  }

  const deepEdits = `/admin/campaigns/${campaign._id}/answer-edits`;
  const scope = { userId: String(cara._id), outcomes: ['survey_submitted'] };
  const plan = [{ questionKey: 'q0', op: 'clear' }];
  const dry = await timed('heavy priced dry run', () => call('POST', deepEdits, { dryRun: true, scope, plan }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json).slice(0, 500));
  const price = dry.json.price;
  assert.strictEqual(price.surveysChanged, 50_000);
  assert.strictEqual(price.tagsUnavailable, false, 'every tag priced, inside the time budget');
  assert.strictEqual(price.tags.length, TAGS);
  assert.strictEqual(price.results.length, 1 + FOLLOW);
  report(t, 'heavy priced dry run');
  assert.ok(timings['heavy priced dry run'] < GATE_MS, `heavy priced dry run ${timings['heavy priced dry run']} ms — over the ${GATE_MS} ms gate`);

  const created = await call('POST', deepEdits, { scope, plan, dryRun: false, digest: dry.json.digest, asOf: dry.json.asOf, templateVersion: dry.json.template.version });
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  const runId = created.json.run.id;
  const jobId = `scale-heavy-${runId}`;
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { queueJobId: jobId, status: 'pending', error: null } });
  await timed('heavy apply job, 50,000 surveys', () =>
    processAnswerEditJob({ id: jobId, name: 'apply', data: { runId }, opts: { attempts: 3 }, attemptsMade: 0 })
  );
  report(t, 'heavy apply job, 50,000 surveys');

  const landed = await call('GET', `/admin/reports/survey-results?campaignId=${campaign._id}&surveyTemplateId=${template._id}`);
  assert.strictEqual(landed.status, 200, JSON.stringify(landed.json));
  for (const tag of price.tags) {
    const row = landed.json.tags.find((x) => x.tag === tag.tag);
    assert.strictEqual(row?.voterCount || 0, tag.identified.after, `${tag.tag} identified: preview == landed`);
    assert.strictEqual(row?.currentVoterCount || 0, tag.current.after, `${tag.tag} current: preview == landed`);
  }
  for (const r of price.results) {
    const q = landed.json.questions.find((x) => x.key === r.questionKey);
    const counts = Object.fromEntries((q?.options || []).map((o) => [o.id || o.option, o.count]));
    for (const o of r.options) assert.strictEqual(counts[o.id] || 0, o.after, `${r.questionKey}/${o.id}: preview == landed`);
  }
});
