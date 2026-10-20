import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Survey answer edits on Door Outcomes, against the REAL app + a throwaway mongod —
// docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §S:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/answer_edit_test node --test test/answerEdit.int.test.js
//
// Redis points at a dead port, as in every suite here: a create or an undo answers 503 when it
// can't reach the queue, and the tests then drive the REAL processor with the job id the route
// wrote onto the run (processAnswerEditJob, the effortClaim.int.test.js pattern).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit';
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
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyResponseArchive } = await import('../src/models/SurveyResponseArchive.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyConversionRun } = await import('../src/models/SurveyConversionRun.js');
const { UnknockRun } = await import('../src/models/UnknockRun.js');
const { UnknockRunChunk } = await import('../src/models/UnknockRunChunk.js');
const { AnswerEditRun } = await import('../src/models/AnswerEditRun.js');
const { AnswerEditRunChunk } = await import('../src/models/AnswerEditRunChunk.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { processAnswerEditJob, reconcileFailedAnswerEditJob } = await import('../src/services/canvass/answerEditRuns.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const DOORS = 140;

const SUPPORT_RULE = { logic: 'any', rules: [{ questionKey: 'candidate_support', op: 'any_of', optionIds: ['strong_support', 'lean_support'] }] };
const QUESTIONS = [
  {
    key: 'candidate_support',
    label: 'Can we count on your support?',
    type: 'single_choice',
    order: 0,
    options: [
      { id: 'strong_support', text: 'Support', tag: 'Supporter', order: 0 },
      { id: 'lean_support', text: 'Likely Support', tag: 'Supporter', order: 1 },
      { id: 'undecided', text: 'Undecided', order: 2 },
      { id: 'opposed', text: 'Opposed', order: 3 },
    ],
  },
  {
    key: 'top_issue',
    label: 'What is your top issue?',
    type: 'multiple_choice',
    order: 1,
    options: [
      { id: 'healthcare', text: 'Healthcare costs', order: 0 },
      { id: 'public_schools', text: 'Public schools & education', order: 1 },
    ],
  },
  {
    key: 'yard_sign',
    label: 'Could you help us by taking a yard sign?',
    type: 'multiple_choice',
    order: 2,
    visibleIf: SUPPORT_RULE,
    options: [
      { id: 'yard_sign_delivered', text: 'Yard Sign Delivered', order: 0 },
      { id: 'candidate_follow_up', text: 'Candidate Follow-Up', order: 1 },
      { id: 'volunteer_request', text: 'Volunteer Request', order: 2, tag: 'Volunteer' },
    ],
  },
];

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household,
    Voter, CanvassActivity, SurveyResponse, SurveyResponseArchive, SurveyTemplate, SurveyConversionRun, UnknockRun,
    UnknockRunChunk, AnswerEditRun, AnswerEditRunChunk, CampaignChange, Subscription,
  ]) {
    await M.deleteMany({});
  }
  await SurveyResponse.init();
  await SurveyResponseArchive.init();
  await AnswerEditRunChunk.init();

  const org = await Organization.create({ name: 'Edit Org', slug: 'edit-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ea@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'ec@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'eo@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit C', type: 'survey', state: 'FL', isActive: true,
    timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  for (const u of [cara, otto]) await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: u._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const homes = await Household.insertMany(
    Array.from({ length: DOORS }, (_, i) => ({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
      addressLine1: `${i + 1} Oak St`, city: 'Town', state: 'FL', zipCode: '33540',
      normalizedAddress: `OAK${i + 1}`, location: { type: 'Point', coordinates: [-82.1 + i * 0.001, 28.2] },
      isActive: true, status: 'unknocked',
    }))
  );
  const turf = await Turf.create({
    organizationId: org._id, campaignId: campaign._id, passId: pass._id, name: 'Book Oak',
    mode: 'manual', status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  for (const u of [cara, otto]) {
    await TurfAssignment.create({ organizationId: org._id, campaignId: campaign._id, passId: pass._id, turfId: turf._id, userId: u._id });
  }
  const voters = await Voter.insertMany(
    homes.map((h, i) => ({
      organizationId: org._id, campaignId: campaign._id, householdId: h._id,
      stateVoterId: `OAK-${i + 1}`, firstName: 'V', lastName: `${i + 1}`, fullName: `Voter ${i + 1}`,
    }))
  );
  // A second voter at door 20: one canvasser's visit, two people surveyed.
  const housemate = await Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: homes[20]._id,
    stateVoterId: 'OAK-MATE', firstName: 'M', lastName: 'Mate', fullName: 'Mate Voter',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, campaign, template, pass, admin, cara, otto, homes, voters, housemate,
    adminTok: signUserToken(admin), caraTok: signUserToken(cara), ottoTok: signUserToken(otto),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Org-Id': String(ctx.org._id),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const asAdmin = (body) => ({ token: ctx.adminTok, ...(body ? { body } : {}) });
const edits = (suffix = '') => `/admin/campaigns/${ctx.campaign._id}/answer-edits${suffix}`;

const near = (i) => ({ lat: 28.2 + 0.00001, lng: -82.1 + i * 0.001 + 0.00001, accuracy: 6 });
let minute = 0;
const nextTs = () => {
  minute += 1;
  return new Date(Date.now() - 20 * 3600_000 + minute * 60_000).toISOString();
};

const TEXT = { yard_sign_delivered: 'Yard Sign Delivered', candidate_follow_up: 'Candidate Follow-Up', volunteer_request: 'Volunteer Request' };
const supportRow = (id = 'strong_support', text = 'Support') => ({ questionKey: 'candidate_support', questionLabel: 'Can we count on your support?', answer: text, optionIds: [id] });
const issueRow = () => ({ questionKey: 'top_issue', questionLabel: 'What is your top issue?', answer: ['Healthcare costs'], optionIds: ['healthcare'] });
const signRow = (...ids) => ({ questionKey: 'yard_sign', questionLabel: 'Could you help us by taking a yard sign?', answer: ids.map((i) => TEXT[i]), optionIds: ids });

const survey = (token, voter, door, answers, extra = {}) =>
  call('POST', `/mobile/voters/${voter._id}/survey`, {
    token,
    body: { surveyTemplateId: String(ctx.template._id), answers, location: near(door), timestamp: nextTs(), note: 'note from the door', ...extra },
  });
const liveOf = (voter) => SurveyResponse.collection.findOne({ voterId: voter._id });
const signOf = async (voter) => (await liveOf(voter)).answers.find((a) => a.questionKey === 'yard_sign');

const fakesFilter = () => ({
  userId: String(ctx.cara._id),
  outcomes: ['survey_submitted'],
  surveyTemplateId: String(ctx.template._id),
  answerFilters: [{ questionKey: 'yard_sign', values: ['candidate_follow_up', 'volunteer_request'] }],
});
const TAKE_OUT = [{ questionKey: 'yard_sign', op: 'adjust', remove: ['candidate_follow_up', 'volunteer_request'] }];

const resultsFor = async (questionKey) => {
  const r = await call('GET', `/admin/reports/survey-results?campaignId=${ctx.campaign._id}&surveyTemplateId=${ctx.template._id}`, asAdmin());
  const q = r.json.questions.find((x) => x.key === questionKey);
  return Object.fromEntries((q?.options || []).map((o) => [o.id || o.option, o.count]));
};

// Drive the real processor with the run's job id. The queue is down in this suite, so a create (or a
// Pick up) answers 503 and PARKS the run with its job id forgotten — a late delivery must never claim a
// change the admin was told didn't happen. Here a fresh id stands in for a Pick up that reached the queue.
const runApply = async (runId) => {
  let run = await AnswerEditRun.findById(runId).lean();
  if (!run.queueJobId) {
    const jobId = `test-apply-${runId}-${Date.now()}`;
    await AnswerEditRun.updateOne(
      { _id: runId, queueJobId: null },
      { $set: { queueJobId: jobId, status: run.status === 'failed' ? 'pending' : run.status, error: null } }
    );
    run = await AnswerEditRun.findById(runId).lean();
  }
  return processAnswerEditJob({ id: run.queueJobId, name: 'apply', data: { runId: String(runId) }, opts: { attempts: 3 }, attemptsMade: 0 });
};
const runUndo = async (runId, requestedBy = null) => {
  const jobId = `test-undo-${runId}-${Date.now()}`;
  await AnswerEditRun.updateOne(
    { _id: runId },
    { $set: { 'undo.status': 'pending', 'undo.jobId': jobId, 'undo.requestedAt': new Date(), 'undo.requestedBy': requestedBy } }
  );
  return processAnswerEditJob({ id: jobId, name: 'undo', data: { runId: String(runId) }, opts: { attempts: 3 }, attemptsMade: 0 });
};

// Review then create, the way the page does: the dry run's digest, asOf and version go back.
const reviewAndCreate = async (body) => {
  const dry = await call('POST', edits(), asAdmin({ ...body, dryRun: true }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  const created = await call('POST', edits(), asAdmin({
    ...body, dryRun: false, digest: dry.json.digest, asOf: dry.json.asOf, templateVersion: dry.json.template.version,
  }));
  return { dry, created };
};

// ── the owner's case ──────────────────────────────────────────────────────────────────────────

test('the yard-sign cleanup end to end: take out only the fake picks, keep everything else', { skip }, async () => {
  const v = ctx.voters;
  const plan = [
    [0, ['volunteer_request']], [1, ['volunteer_request']], [2, ['volunteer_request']],
    [3, ['candidate_follow_up']], [4, ['candidate_follow_up']],
    [5, ['candidate_follow_up', 'volunteer_request']],
    [6, ['yard_sign_delivered', 'volunteer_request']], [7, ['yard_sign_delivered', 'volunteer_request']],
    [8, ['yard_sign_delivered']], // a real sign, never matched
  ];
  for (const [i, ids] of plan) assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), issueRow(), signRow(...ids)])).status, 201);
  assert.strictEqual((await survey(ctx.caraTok, v[9], 9, [supportRow('opposed', 'Opposed'), issueRow()])).status, 201);
  // Otto's genuine volunteers must survive.
  for (const i of [10, 11]) assert.strictEqual((await survey(ctx.ottoTok, v[i], i, [supportRow(), signRow('volunteer_request')])).status, 201);
  // One visit, two people: the voter who matched, and a housemate who didn't.
  assert.strictEqual((await survey(ctx.caraTok, v[20], 20, [supportRow(), signRow('volunteer_request')])).status, 201);
  assert.strictEqual((await survey(ctx.caraTok, ctx.housemate, 20, [supportRow(), signRow('yard_sign_delivered')])).status, 201);

  ctx.before = {};
  for (const i of [0, 6, 8, 10, 20]) ctx.before[i] = await liveOf(v[i]);
  ctx.beforeMate = await liveOf(ctx.housemate);
  ctx.resultsBefore = await resultsFor('yard_sign');
  ctx.activityBefore = await CanvassActivity.countDocuments({ campaignId: ctx.campaign._id });
  ctx.statusesBefore = (await Voter.find({ campaignId: ctx.campaign._id }, { surveyStatus: 1 }).lean()).map((x) => `${x._id}:${x.surveyStatus}`).sort();

  // The form: what the selected surveys hold.
  const form = await call('POST', edits(), asAdmin({ dryRun: true, scope: fakesFilter() }));
  assert.strictEqual(form.status, 200, JSON.stringify(form.json));
  assert.strictEqual(form.json.responses, 9, 'the 9 surveys that matched (8 + the matched voter at the shared visit)');
  assert.strictEqual(form.json.notMatched, 1, 'the housemate at the same visit');
  const sign = form.json.questions.find((q) => q.key === 'yard_sign');
  const picks = Object.fromEntries(sign.picks.map((p) => [p.id, p.count]));
  assert.deepStrictEqual(picks, { volunteer_request: 7, candidate_follow_up: 3, yard_sign_delivered: 2 });

  // The review.
  const { dry, created } = await reviewAndCreate({ scope: fakesFilter(), plan: TAKE_OUT });
  const price = dry.json.price;
  assert.strictEqual(price.surveysChanged, 9);
  const yq = price.byQuestion.find((q) => q.questionKey === 'yard_sign');
  assert.strictEqual(yq.leftBlank, 7, '7 are left with no answer, as if skipped');
  assert.deepStrictEqual(yq.kept.map((k) => [k.id, k.surveys]), [['yard_sign_delivered', 2]], '2 keep the sign');
  assert.strictEqual(yq.multi, 1, '1 had both fake picks');
  const removed = Object.fromEntries(yq.removed.map((r) => [r.id, r.surveys]));
  assert.deepStrictEqual(removed, { volunteer_request: 7, candidate_follow_up: 3 });
  const res = price.results.find((r) => r.questionKey === 'yard_sign');
  const after = Object.fromEntries(res.options.map((o) => [o.id, [o.before, o.after]]));
  assert.deepStrictEqual(after.volunteer_request, [ctx.resultsBefore.volunteer_request, ctx.resultsBefore.volunteer_request - 7]);
  assert.deepStrictEqual(after.candidate_follow_up, [3, 0]);
  assert.deepStrictEqual(after.yard_sign_delivered, [4, 4], 'every real sign stays');
  assert.strictEqual(price.recordedBy[0].name, 'Cara Canvasser');
  assert.strictEqual(price.manifest.length, 9);
  ctx.previewAfter = Object.fromEntries(res.options.map((o) => [o.id, o.after]));
  ctx.tagPreview = price.tags;

  // The create can't reach the queue in this suite: 503, and the run is waiting to be picked up.
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  assert.strictEqual(created.json.code, 'QUEUE_UNAVAILABLE');
  ctx.runId = created.json.run.id;
  assert.strictEqual((await runApply(ctx.runId)).completed, true);
  const run = await AnswerEditRun.findById(ctx.runId).lean();
  assert.strictEqual(run.status, 'completed');
  assert.strictEqual(run.counts.surveysChanged, 9);
});

test('what the edit wrote: blank as if skipped, the sign kept, every other byte as recorded', { skip }, async () => {
  const v = ctx.voters;
  assert.deepStrictEqual(await signOf(v[0]), { questionKey: 'yard_sign', questionLabel: 'Could you help us by taking a yard sign?', answer: [], optionIds: [], otherText: null });
  assert.deepStrictEqual((await signOf(v[6])).optionIds, ['yard_sign_delivered']);
  assert.deepStrictEqual((await signOf(v[6])).answer, ['Yard Sign Delivered']);

  const now0 = await liveOf(v[0]);
  const was0 = ctx.before[0];
  for (const key of ['candidate_support', 'top_issue']) {
    assert.strictEqual(
      JSON.stringify(now0.answers.find((a) => a.questionKey === key)),
      JSON.stringify(was0.answers.find((a) => a.questionKey === key)),
      `${key} byte-identical`
    );
  }
  for (const f of ['_id', 'userId', 'submittedAt', 'location', 'passId', 'turfId', 'effortId', 'coordinatorId', 'note', 'householdId']) {
    assert.strictEqual(JSON.stringify(now0[f]), JSON.stringify(was0[f]), `${f} kept`);
  }
  assert.strictEqual(String(now0.editedBy), String(ctx.admin._id), 'stamped edited by the admin');
  assert.strictEqual(now0.answerEditMarks.length, 1, 'the landing mark');
  assert.strictEqual(now0.noteEditedAt, null, "the note keeps its own stamp: not edited");
  // Untouched: a real sign that never matched, Otto's volunteers, the housemate.
  assert.strictEqual(JSON.stringify(await liveOf(v[8])), JSON.stringify(ctx.before[8]));
  assert.strictEqual(JSON.stringify(await liveOf(v[10])), JSON.stringify(ctx.before[10]));
  assert.strictEqual(JSON.stringify(await liveOf(ctx.housemate)), JSON.stringify(ctx.beforeMate));

  // The earlier answers are kept, one copy per changed survey.
  const copies = await SurveyResponseArchive.find({ answerEditRunId: ctx.runId }).lean();
  assert.strictEqual(copies.length, 9);
  const copy0 = copies.find((c) => String(c.voterId) === String(v[0]._id));
  assert.deepStrictEqual(copy0.answers.find((a) => a.questionKey === 'yard_sign').optionIds, ['volunteer_request']);
  assert.strictEqual(copy0.overwrittenVia, 'answer_edit');
});

test('nothing that counts money moves; the results equal the previewed after', { skip }, async () => {
  assert.strictEqual(await CanvassActivity.countDocuments({ campaignId: ctx.campaign._id }), ctx.activityBefore);
  const statuses = (await Voter.find({ campaignId: ctx.campaign._id }, { surveyStatus: 1 }).lean()).map((x) => `${x._id}:${x.surveyStatus}`).sort();
  assert.deepStrictEqual(statuses, ctx.statusesBefore, 'every voter stays surveyed');
  const after = await resultsFor('yard_sign');
  for (const [id, n] of Object.entries(ctx.previewAfter)) assert.strictEqual(after[id] || 0, n, `${id}: preview == landed`);
  // The tag the change touched: "Volunteer" (on Volunteer Request).
  const tag = ctx.tagPreview.find((t) => t.tag === 'Volunteer');
  assert.ok(tag, 'the tag rollup is priced');
  const r = await call('GET', `/admin/reports/survey-results?campaignId=${ctx.campaign._id}&surveyTemplateId=${ctx.template._id}`, asAdmin());
  const landed = r.json.tags.find((t) => t.tag === 'Volunteer');
  assert.strictEqual(landed?.voterCount ?? 0, tag.identified.after, 'identified: preview == landed');
  assert.strictEqual(landed?.currentVoterCount ?? 0, tag.current.after, 'current: preview == landed');
});

test('the run is listed, its history row says what it did, and Details itemizes it', { skip }, async () => {
  const list = await call('GET', edits(), asAdmin());
  const row = list.json.runs.find((r) => r.id === ctx.runId);
  assert.ok(row);
  assert.strictEqual(row.planSummary, 'Could you help us by taking a yard sign?: took out Candidate Follow-Up, Volunteer Request');
  const hist = await CampaignChange.findOne({ campaignId: ctx.campaign._id, field: 'answerEdit' }).lean();
  assert.strictEqual(hist.toValue, 'Could you help us by taking a yard sign?: took out Candidate Follow-Up, Volunteer Request (9 surveys)');
  assert.strictEqual(hist.source, 'answer_edit');
  const details = await call('GET', edits(`/${ctx.runId}/entries`), asAdmin());
  assert.strictEqual(details.status, 200);
  assert.strictEqual(details.json.total, 9);
  const jane = details.json.entries.find((e) => e.voterId === String(ctx.voters[6]._id));
  assert.deepStrictEqual(jane.changes, [{
    questionKey: 'yard_sign', label: 'Could you help us by taking a yard sign?',
    before: 'Yard Sign Delivered; Volunteer Request', after: 'Yard Sign Delivered', dropped: false,
  }]);
});

test('Pick up is refused for a finished run; a redelivered apply changes nothing', { skip }, async () => {
  const resume = await call('POST', edits(`/${ctx.runId}/resume`), asAdmin());
  assert.strictEqual(resume.status, 409);
  const again = await runApply(ctx.runId);
  assert.strictEqual(again.skipped, 'not-claimable');
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ answerEditRunId: ctx.runId }), 9);
});

test('undo puts every answer back exactly; the run reads Undone and can never be applied again', { skip }, async () => {
  // The route can't reach the queue here: 503, and the undo status is left as it was.
  const r = await call('POST', edits(`/${ctx.runId}/revert`), asAdmin());
  assert.strictEqual(r.status, 503, JSON.stringify(r.json));
  assert.strictEqual((await AnswerEditRun.findById(ctx.runId).lean()).undo.status, null);

  // Another admin presses Undo: History names them, not the change's author.
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'eb@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: bea._id, organizationId: ctx.org._id, role: 'admin', isActive: true });
  const res = await runUndo(ctx.runId, bea._id);
  assert.strictEqual(res.summary.putBack, 9);
  for (const i of [0, 6, 20]) {
    const now = await liveOf(ctx.voters[i]);
    const was = ctx.before[i];
    assert.strictEqual(JSON.stringify(now.answers), JSON.stringify(was.answers), `voter ${i}: answers back byte for byte`);
    assert.strictEqual(now.editedBy, null);
    assert.deepStrictEqual(now.answerEditMarks, [], 'the mark is pulled');
  }
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ answerEditRunId: ctx.runId }), 0, 'the copies are consumed');
  const after = await resultsFor('yard_sign');
  assert.deepStrictEqual(after, ctx.resultsBefore, 'results exactly as before');
  const run = await AnswerEditRun.findById(ctx.runId).lean();
  assert.strictEqual(run.undo.status, 'done');
  const resume = await call('POST', edits(`/${ctx.runId}/resume`), asAdmin());
  assert.strictEqual(resume.status, 409, 'once an undo started the change can never be applied again');
  const hist = await CampaignChange.findOne({ campaignId: ctx.campaign._id, field: 'answerEditUndo' }).lean();
  assert.strictEqual(hist.toValue, '9 surveys put back');
  assert.strictEqual(String(hist.byUserId), String(bea._id), 'History names whoever pressed Undo');
  const edit = await CampaignChange.findOne({ campaignId: ctx.campaign._id, field: 'answerEdit' }).lean();
  assert.strictEqual(String(edit.byUserId), String(ctx.admin._id), 'and the edit row still names its author');
});

// ── shared helpers for the groups below ────────────────────────────────────────────────────────

const entryOf = (voter, userId) => CanvassActivity.findOne({ voterId: voter._id, userId, actionType: { $ne: 'note_added' } }).lean();
const scopeFor = (userId, extra = {}) => ({ userId: String(userId), outcomes: ['survey_submitted'], ...extra });
const profileOf = (voter) => call('GET', `/admin/voters/${voter._id}`, asAdmin());
// Create a bulk run and drive its apply; returns the run id.
const editAndApply = async (body) => {
  const { dry, created } = await reviewAndCreate(body);
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  await runApply(created.json.run.id);
  return { runId: created.json.run.id, dry };
};

// ── follow-ups, who changes, the date window ──────────────────────────────────────────────────

test('ruling 2: an answer the edit hides is dropped, counted in the review, and comes back with undo', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [30, 31]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  const before = await liveOf(v[30]);
  const body = {
    scope: scopeFor(ctx.cara._id, { search: '31 Oak St' }),
    plan: [{ questionKey: 'candidate_support', op: 'set', optionIds: ['opposed'] }],
  };
  // Address search narrows to door 30 only ("31 Oak St" is index 30).
  const { runId, dry } = await editAndApply(body);
  assert.deepStrictEqual(dry.json.price.dropped.map((d) => [d.questionKey, d.answers]), [['yard_sign', 1]]);
  const after = await liveOf(v[30]);
  assert.deepStrictEqual(after.answers.map((a) => a.questionKey), ['candidate_support'], 'the yard-sign answer the phone would never have posted is gone');
  assert.deepStrictEqual(after.answers[0].optionIds, ['opposed']);
  assert.ok((await liveOf(v[31])).answers.some((a) => a.questionKey === 'yard_sign'), 'only the selected survey changes');
  await runUndo(runId);
  assert.strictEqual(JSON.stringify((await liveOf(v[30])).answers), JSON.stringify(before.answers), 'the dropped answer is back');
});

test('ruling 1: with no answer filter every survey at the selected visits changes; blanks stay blank', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.ottoTok, v[32], 32, [supportRow('undecided', 'Undecided'), issueRow()])).status, 201);
  assert.strictEqual((await survey(ctx.ottoTok, v[33], 33, [supportRow('undecided', 'Undecided')])).status, 201);
  const body = {
    scope: scopeFor(ctx.otto._id, { search: 'Oak St', dateFrom: undefined }),
    actionIds: [String((await entryOf(v[32], ctx.otto._id))._id), String((await entryOf(v[33], ctx.otto._id))._id)],
    plan: [{ questionKey: 'top_issue', op: 'clear' }],
  };
  const { dry } = await editAndApply(body);
  assert.strictEqual(dry.json.responses, 2);
  assert.strictEqual(dry.json.price.surveysChanged, 1, 'the one with an answer');
  assert.deepStrictEqual(dry.json.price.unchanged, { already_blank: 1 }, 'a blank stays blank');
  assert.deepStrictEqual((await liveOf(v[32])).answers.find((a) => a.questionKey === 'top_issue').optionIds, []);
});

test('a date window applies to the surveys themselves, and the review counts what it left out', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[34], 34, [supportRow(), signRow('volunteer_request')], { timestamp: '2026-01-05T15:00:00.000Z' })).status, 201);
  assert.strictEqual((await survey(ctx.caraTok, v[35], 35, [supportRow(), signRow('volunteer_request')], { timestamp: '2026-01-20T15:00:00.000Z' })).status, 201);
  const dry = await call('POST', edits(), asAdmin({
    dryRun: true,
    scope: { ...fakesFilter(), dateFrom: '2026-01-01', dateTo: '2026-01-10' },
    plan: TAKE_OUT,
  }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  assert.strictEqual(dry.json.responses, 1, 'only the survey inside the dates');
  assert.strictEqual(dry.json.price.surveysChanged, 1);
});

test('the create refuses REVIEW_STALE when a reviewed survey changed, and writes nothing', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[40], 40, [supportRow(), signRow('volunteer_request')])).status, 201);
  const body = { scope: scopeFor(ctx.cara._id, { search: '41 Oak St' }), plan: [{ questionKey: 'yard_sign', op: 'clear' }] };
  const dry = await call('POST', edits(), asAdmin({ ...body, dryRun: true }));
  assert.strictEqual(dry.json.responses, 1);
  // Re-surveyed between the review and the confirm.
  assert.strictEqual((await survey(ctx.caraTok, v[40], 40, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  const runsBefore = await AnswerEditRun.countDocuments({});
  const created = await call('POST', edits(), asAdmin({ ...body, digest: dry.json.digest, asOf: dry.json.asOf, templateVersion: dry.json.template.version }));
  assert.strictEqual(created.status, 409);
  assert.strictEqual(created.json.code, 'REVIEW_STALE');
  assert.strictEqual(await AnswerEditRun.countDocuments({}), runsBefore, 'nothing written');
  // A survey recorded after the review is simply not included — never a refusal.
  const dry2 = await call('POST', edits(), asAdmin({ ...body, dryRun: true }));
  assert.strictEqual((await survey(ctx.caraTok, v[41], 41, [supportRow(), signRow('volunteer_request')])).status, 201);
  const ok = await call('POST', edits(), asAdmin({ ...body, digest: dry2.json.digest, asOf: dry2.json.asOf, templateVersion: dry2.json.template.version }));
  assert.strictEqual(ok.status, 503, 'accepted (the queue is down in this suite)');
  await runApply(ok.json.run.id);
});

test('entries an earlier change converted are held: counted, never edited', { skip }, async () => {
  const v = ctx.voters;
  // A desk entry: door 42 recorded Not home, then converted to Surveyed with typed answers.
  assert.strictEqual((await call('POST', `/mobile/households/${ctx.homes[42]._id}/not-home`, {
    token: ctx.caraTok, body: { location: near(42), timestamp: nextTs() },
  })).status, 201);
  const entry = await CanvassActivity.findOne({ householdId: ctx.homes[42]._id }).lean();
  const conv = `/admin/campaigns/${ctx.campaign._id}/survey-conversions`;
  const opened = await call('POST', conv, asAdmin({ direction: 'to_survey', to: 'survey_submitted', mode: 'queue', actionIds: [String(entry._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  await call('POST', `${conv}/${opened.json.run.id}/door`, asAdmin({ actionId: String(entry._id), voterPlans: { [String(v[42]._id)]: { answers: [supportRow(), signRow('volunteer_request')] } } }));
  await call('POST', `${conv}/${opened.json.run.id}/close`, asAdmin());
  const dry = await call('POST', edits(), asAdmin({ dryRun: true, scope: scopeFor(ctx.cara._id, { search: '43 Oak St' }) }));
  assert.strictEqual(dry.status, 400, 'the only entry here is held, so nothing is selected');
  const held = await call('POST', edits(), asAdmin({ dryRun: true, scope: scopeFor(ctx.cara._id, { search: 'Oak St' }) }));
  assert.ok(held.json.heldByRuns >= 1, 'and the wider filter says so');
});

// ── review rounds 2 and 3: races and crashes ─────────────────────────────────────────────────────

test('B1: two deliveries of one chunk at once never lose the original, and count it once', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [80, 81, 82]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), signRow('volunteer_request')])).status, 201);
  const originals = await Promise.all([80, 81, 82].map((i) => liveOf(v[i])));
  const body = { scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: await Promise.all([80, 81, 82].map(async (i) => String((await entryOf(v[i], ctx.cara._id))._id))), plan: TAKE_OUT };
  const { created } = await reviewAndCreate(body);
  const runId = created.json.run.id;
  const run = await AnswerEditRun.findById(runId).lean();
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  // Two deliveries apply the same chunk concurrently (Start again beside a late original job).
  const { applyChunk } = await import('../src/services/canvass/answerEditWriter.js');
  const [a, b] = await Promise.all([applyChunk({ run, chunk }), applyChunk({ run, chunk })]);
  assert.strictEqual(a.counts.changed + b.counts.changedSinceReview >= 3 || b.counts.changed + a.counts.changedSinceReview >= 3, true);
  for (const [k, i] of [80, 81, 82].entries()) {
    const live = await liveOf(v[i]);
    assert.deepStrictEqual((live.answers.find((x) => x.questionKey === 'yard_sign')).optionIds, [], 'edited');
    const copies = await SurveyResponseArchive.find({ answerEditRunId: runId, voterId: v[i]._id }).lean();
    assert.ok(copies.length >= 1, 'the original survives in a copy');
    assert.ok(copies.some((c) => JSON.stringify(c.answers) === JSON.stringify(originals[k].answers)), 'verbatim');
    assert.strictEqual(live.answerEditMarks.filter((m) => copies.some((c) => String(c._id) === String(m))).length, 1, 'exactly one landed');
  }
  // The undo puts every one back and clears every copy, landed or not.
  await AnswerEditRunChunk.updateOne({ _id: chunk._id }, { $set: { done: true } });
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'completed' } });
  const undone = await runUndo(runId);
  assert.strictEqual(undone.summary.putBack, 3);
  for (const [k, i] of [80, 81, 82].entries()) {
    assert.strictEqual(JSON.stringify((await liveOf(v[i])).answers), JSON.stringify(originals[k].answers));
  }
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ answerEditRunId: runId }), 0);
});

test('a survey changed after the edit is never overwritten by the undo; it is named, and its copy stays', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [83, 84]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), signRow('volunteer_request')])).status, 201);
  const ids = await Promise.all([83, 84].map(async (i) => String((await entryOf(v[i], ctx.cara._id))._id)));
  const { runId } = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT });
  // Voter 84 is edited again on the profile afterwards.
  const prof = await profileOf(v[84]);
  const s84 = prof.json.surveys[0];
  const patched = await call('PATCH', `/admin/voters/${v[84]._id}/surveys/${s84.id}`, asAdmin({
    version: s84.version, answers: [supportRow('undecided', 'Undecided')],
  }));
  assert.strictEqual(patched.status, 200, JSON.stringify(patched.json));
  const res = await runUndo(runId);
  assert.strictEqual(res.summary.putBack, 1);
  assert.strictEqual(res.summary.changedSince, 1);
  const run = await AnswerEditRun.findById(runId).lean();
  assert.strictEqual(run.undo.summary.names[0].reason, 'changed_since');
  // Stored as ids (a deleted account must read as a removed user); the words are written on read.
  assert.strictEqual(String(run.undo.summary.names[0].detail.by), String(ctx.admin._id));
  const polled = await call('GET', edits(`/${runId}`), asAdmin());
  assert.match(polled.json.run.undo.summary.names[0].detail, /edited by Ada Admin/);
  assert.deepStrictEqual((await liveOf(v[84])).answers[0].optionIds, ['undecided'], 'the newer edit is kept');
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ answerEditRunId: runId }), 1, 'its copy stays as history');
  // Undo again after the newer change is undone on the profile finishes it.
  const later = await SurveyResponseArchive.findOne({ voterId: v[84]._id, overwrittenVia: 'answer_edit', answerEditRunId: { $exists: false } }).lean();
  const back = await call('POST', `/admin/voters/${v[84]._id}/surveys/${later._id}/restore`, asAdmin());
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
});

test('two runs: newest-first undo is exact; oldest-first waits, and Undo again finishes after the newer one', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[100], 100, [supportRow(), issueRow(), signRow('volunteer_request')])).status, 201);
  const original = await liveOf(v[100]);
  const ids = [String((await entryOf(v[100], ctx.cara._id))._id)];
  const first = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT });
  const second = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: [{ questionKey: 'top_issue', op: 'clear' }] });
  // Oldest first: the survey changed since (the second run), so it waits.
  const r1 = await runUndo(first.runId);
  assert.strictEqual(r1.summary.changedSince, 1);
  const r2 = await runUndo(second.runId);
  assert.strictEqual(r2.summary.putBack, 1);
  const r1again = await runUndo(first.runId);
  assert.strictEqual(r1again.summary.putBack, 1, 'Undo again finishes it');
  assert.strictEqual(JSON.stringify((await liveOf(v[100])).answers), JSON.stringify(original.answers), 'exactly as recorded');
});

test('M2: an unknock in between holds the survey; its revert re-creates it under a new id, and Undo again finds it by slot', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[90], 90, [supportRow(), signRow('volunteer_request')])).status, 201);
  const original = await liveOf(v[90]);
  const entry = await entryOf(v[90], ctx.cara._id);
  const { runId } = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String(entry._id)], plan: TAKE_OUT });
  const struck = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries`, asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(entry._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const waiting = await runUndo(runId);
  assert.strictEqual(waiting.summary.waiting, 1, 'held by the unknock, not gone');
  const polled = await call('GET', edits(`/${runId}`), asAdmin());
  assert.match(polled.json.run.undo.summary.names[0].detail, /^Unknock, /);
  const reverted = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries/revert`, asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(reverted.status, 200, JSON.stringify(reverted.json));
  const recreated = await liveOf(v[90]);
  assert.notStrictEqual(String(recreated._id), String(original._id), 'a new _id');
  const again = await runUndo(runId);
  assert.strictEqual(again.summary.putBack, 1, 'found by slot and put back');
  assert.strictEqual(JSON.stringify((await liveOf(v[90])).answers), JSON.stringify(original.answers));
});

test('a re-survey carries no marks, so unknocking it never reads as "waiting" for an edit it isn\'t', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[91], 91, [supportRow(), signRow('volunteer_request')])).status, 201);
  const { runId } = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[91], ctx.cara._id))._id)], plan: TAKE_OUT });
  // Otto re-surveys the same voter in the same round: the phone keeps the _id and $unsets the marks.
  assert.strictEqual((await survey(ctx.ottoTok, v[91], 91, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  assert.strictEqual((await liveOf(v[91])).answerEditMarks, undefined);
  const ottoEntry = await entryOf(v[91], ctx.otto._id);
  const struck = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries`, asAdmin({ scope: { userId: String(ctx.otto._id) }, actionIds: [String(ottoEntry._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const res = await runUndo(runId);
  assert.strictEqual(res.summary.waiting, 0);
  assert.strictEqual(res.summary.gone, 1);
});

test('C6: a put-back that landed in a pass that died before deleting its copy is finished, never "kept newer answers"', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[85], 85, [supportRow(), signRow('volunteer_request')])).status, 201);
  const original = await liveOf(v[85]);
  const { runId } = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[85], ctx.cara._id))._id)], plan: TAKE_OUT });
  const copy = await SurveyResponseArchive.findOne({ answerEditRunId: runId }).lean();
  // The dead pass: stamped, put back, then died before deleting the row.
  await SurveyResponseArchive.collection.updateOne({ _id: copy._id }, { $set: { undoStartedAt: new Date() } });
  await SurveyResponse.collection.updateOne(
    { _id: original._id },
    // Exactly the put-back's own write: the answers back, the mark off, the undo receipt on.
    { $set: { answers: original.answers, editedBy: null, editedAt: null }, $pull: { answerEditMarks: copy._id }, $addToSet: { answerEditUndone: copy._id } }
  );
  // Then a re-survey, so the snapshot no longer matches what's on file either.
  assert.strictEqual((await survey(ctx.caraTok, v[85], 85, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  const res = await runUndo(runId);
  assert.strictEqual(res.summary.putBack, 1);
  assert.strictEqual(res.summary.changedSince, 0);
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ answerEditRunId: runId }), 0);
});

test('N1: a note-only profile save landing between the read and the write keeps its new note stamp', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[86], 86, [supportRow(), signRow('volunteer_request')])).status, 201);
  // A survey from before note stamps existed: no noteEdited* fields at all.
  await SurveyResponse.collection.updateOne({ voterId: v[86]._id }, { $unset: { noteEditedBy: '', noteEditedAt: '' } });
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[86], ctx.cara._id))._id)], plan: TAKE_OUT });
  const coll = SurveyResponse.collection;
  const real = coll.updateOne.bind(coll);
  const stampAt = new Date('2026-10-01T12:00:00Z');
  // The writer's first per-survey compare-and-swap: the note save lands just before it.
  coll.updateOne = async (...args) => {
    coll.updateOne = real;
    await real({ voterId: v[86]._id }, { $set: { note: 'fixed note', noteEditedBy: ctx.admin._id, noteEditedAt: stampAt } });
    return real(...args);
  };
  try {
    await runApply(created.json.run.id);
  } finally {
    coll.updateOne = real;
  }
  const live = await liveOf(v[86]);
  assert.deepStrictEqual(live.answers.find((a) => a.questionKey === 'yard_sign').optionIds, [], 'the edit still landed (retried)');
  assert.strictEqual(new Date(live.noteEditedAt).getTime(), stampAt.getTime(), "the note's new stamp survived");
  assert.strictEqual(live.note, 'fixed note');
});

test('N2: restoring a copy made before note stamps existed clears the displaced survey\'s stamp and marks', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[87], 87, [supportRow(), signRow('volunteer_request')])).status, 201);
  assert.strictEqual((await survey(ctx.ottoTok, v[87], 87, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  const copy = await SurveyResponseArchive.findOne({ voterId: v[87]._id, overwrittenVia: 'submit' }).lean();
  await SurveyResponseArchive.collection.updateOne({ _id: copy._id }, { $unset: { noteEditedBy: '', noteEditedAt: '', answerEditMarks: '' } });
  await SurveyResponse.collection.updateOne({ voterId: v[87]._id }, { $set: { noteEditedBy: ctx.admin._id, noteEditedAt: new Date(), answerEditMarks: [new mongoose.Types.ObjectId()] } });
  const r = await call('POST', `/admin/voters/${v[87]._id}/surveys/${copy._id}/restore`, asAdmin());
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const live = await liveOf(v[87]);
  assert.strictEqual(String(live.userId), String(ctx.cara._id));
  assert.strictEqual(live.noteEditedAt, undefined);
  assert.strictEqual(live.answerEditMarks, undefined);
});

// ── jobs, phases, one change at a time ───────────────────────────────────────────────────────────

test('the failed listener marks the right phase, and only for the run\'s own job', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[110], 110, [supportRow(), signRow('volunteer_request')])).status, 201);
  const ids = [String((await entryOf(v[110], ctx.cara._id))._id)];
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT });
  const runId = created.json.run.id;
  // Running under its own job (the 503 above forgot the queued one, so give it the id a real enqueue would).
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'running', queueJobId: `test-job-${runId}` } });
  const run = await AnswerEditRun.findById(runId).lean();
  await reconcileFailedAnswerEditJob({ id: 'someone-else', name: 'apply', data: { runId }, opts: { attempts: 1 }, attemptsMade: 1, finishedOn: 1 }, new Error('x'));
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).status, 'running', 'a superseded job changes nothing');
  await reconcileFailedAnswerEditJob({ id: run.queueJobId, name: 'apply', data: { runId }, opts: { attempts: 3 }, attemptsMade: 1 }, new Error('x'));
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).status, 'running', 'a retry is coming');
  await reconcileFailedAnswerEditJob({ id: run.queueJobId, name: 'apply', data: { runId }, opts: { attempts: 3 }, attemptsMade: 3, finishedOn: 1 }, new Error('worker died'));
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).status, 'failed');
  // Pick up: back to pending (the queue is down here, so it reads failed again) — then the job finishes it.
  const resume = await call('POST', edits(`/${runId}/resume`), asAdmin());
  assert.strictEqual(resume.status, 503, JSON.stringify(resume.json));
  await runApply(runId);
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).status, 'completed');
  // A stopped UNDO: Retry undo only, never Pick up.
  const jobId = 'undo-job-1';
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { 'undo.status': 'running', 'undo.jobId': jobId } });
  await reconcileFailedAnswerEditJob({ id: jobId, name: 'undo', data: { runId }, opts: { attempts: 1 }, attemptsMade: 1, finishedOn: 1 }, new Error('died'));
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).undo.status, 'failed');
  assert.strictEqual((await call('POST', edits(`/${runId}/resume`), asAdmin())).status, 409, 'an undo started: never applied again');
  const retry = await runUndo(runId);
  assert.strictEqual(retry.summary.putBack, 1);
});

test('History logs a run that stops part-way when it stops, and the rest when Pick up finishes it', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [135, 136]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), signRow('volunteer_request')])).status, 201);
  const ids = [];
  for (const i of [135, 136]) ids.push(String((await entryOf(v[i], ctx.cara._id))._id));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT });
  const runId = created.json.run.id;
  const rows = () => CampaignChange.find({ campaignId: ctx.campaign._id, field: 'answerEdit' }).sort({ createdAt: 1 }).lean();
  const before = (await rows()).length;
  // The worker dies after one survey landed (its chunk rolled up): the stop is logged with that one.
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'running', queueJobId: `test-job-${runId}`, 'counts.surveysChanged': 1 } });
  const run = await AnswerEditRun.findById(runId).lean();
  await reconcileFailedAnswerEditJob({ id: run.queueJobId, name: 'apply', data: { runId }, opts: { attempts: 1 }, attemptsMade: 1, finishedOn: 1 }, new Error('worker died'));
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).status, 'failed');
  let logged = (await rows()).slice(before);
  assert.deepStrictEqual(logged.map((r) => r.toValue.match(/\(([^)]*)\)$/)[1]), ['1 survey'], 'logged when it stopped');
  // A redelivered failure reports nothing twice.
  await reconcileFailedAnswerEditJob({ id: run.queueJobId, name: 'apply', data: { runId }, opts: { attempts: 1 }, attemptsMade: 1, finishedOn: 1 }, new Error('again'));
  assert.strictEqual((await rows()).length, before + 1);
  // Pick up finishes it: one more row for the rest, never the first one again.
  assert.strictEqual((await call('POST', edits(`/${runId}/resume`), asAdmin())).status, 503);
  await runApply(runId);
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).counts.surveysChanged, 2);
  logged = (await rows()).slice(before);
  assert.deepStrictEqual(logged.map((r) => r.toValue.match(/\(([^)]*)\)$/)[1]), ['1 survey', '1 more survey']);
});

test('Start again: a run or an undo still waiting for the worker after ten minutes can be re-queued; a fresh one cannot', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[111], 111, [supportRow(), signRow('volunteer_request')])).status, 201);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[111], ctx.cara._id))._id)], plan: TAKE_OUT });
  const runId = created.json.run.id;
  await AnswerEditRun.collection.updateOne({ _id: new mongoose.Types.ObjectId(runId) }, { $set: { status: 'pending', updatedAt: new Date(Date.now() - 11 * 60_000) } });
  const polled = await call('GET', edits(`/${runId}`), asAdmin());
  assert.strictEqual(polled.json.run.waitingForWorker, true);
  assert.strictEqual((await call('POST', edits(`/${runId}/resume`), asAdmin())).status, 503, 'Start again accepted (queue down here)');
  await runApply(runId);
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { 'undo.status': 'pending', 'undo.requestedAt': new Date() } });
  assert.strictEqual((await call('POST', edits(`/${runId}/revert`), asAdmin())).status, 409, 'a fresh pending undo is still running');
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { 'undo.requestedAt': new Date(Date.now() - 11 * 60_000) } });
  const restart = await call('POST', edits(`/${runId}/revert`), asAdmin());
  assert.strictEqual(restart.status, 503);
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).undo.status, 'pending', 'left as it was when the queue is unreachable');
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { 'undo.status': null } });
  await runUndo(runId);
});

test('one change at a time: an open session blocks a conversion and another edit; a running conversion blocks an edit', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[112], 112, [supportRow(), signRow('volunteer_request')])).status, 201);
  const ids = [String((await entryOf(v[112], ctx.cara._id))._id)];
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const sessionId = created.json.run.id;
  const conv = await call('POST', `/admin/campaigns/${ctx.campaign._id}/survey-conversions`, asAdmin({
    direction: 'from_survey', to: 'not_home', mode: 'bulk', actionIds: ids,
  }));
  assert.strictEqual(conv.status, 409);
  assert.strictEqual(conv.json.code, 'ANOTHER_CHANGE_RUNNING');
  const another = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT });
  assert.strictEqual(another.created.status, 409);
  assert.strictEqual((await call('POST', edits(`/${sessionId}/close`), asAdmin())).status, 200);
  // A conversion running blocks an edit.
  const fake = await SurveyConversionRun.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, direction: 'from_survey', mode: 'bulk', to: 'not_home', status: 'running' });
  const blocked = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT });
  assert.strictEqual(blocked.created.status, 409);
  await SurveyConversionRun.deleteOne({ _id: fake._id });
});

test('chunk items record the landed copy, which "N of M done" and the undo read', { skip }, async () => {
  const run = await AnswerEditRun.findById(ctx.runId).lean();
  const chunk = await AnswerEditRunChunk.findOne({ runId: run._id }).lean();
  // The owner's-case run was undone; its items still name the copies it landed.
  assert.ok(chunk.items.filter((it) => it.a).length >= 9);
});

// ── one person at a time ──────────────────────────────────────────────────────────────────────

test('one person at a time: step, skip, a double-submit no-op, a stale version, cold resume, close, undo as one', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [70, 71, 72]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), signRow('volunteer_request')])).status, 201);
  // Voter 72 said Opposed later in the session's life: their yard-sign question is off their path.
  const ids = await Promise.all([70, 71, 72].map(async (i) => String((await entryOf(v[i], ctx.cara._id))._id)));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  let cur = created.json.current;
  assert.strictEqual(cur.position, 0);
  assert.strictEqual(cur.total, 3);
  assert.ok(cur.version);
  const signPost = (ids2) => [supportRow(), { questionKey: 'yard_sign', optionIds: ids2, answer: [] }];

  // Save & next with a change.
  const first = cur;
  const saved = await call('POST', edits(`/${runId}/response`), asAdmin({ responseId: cur.responseId, version: cur.version, answers: signPost([]) }));
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
  assert.strictEqual(saved.json.saved, true);
  assert.strictEqual(saved.json.run.counts.surveysChanged, 1);
  // The same Save & next again (a double tap): a no-op, not a conflict.
  const twice = await call('POST', edits(`/${runId}/response`), asAdmin({ responseId: first.responseId, version: first.version, answers: signPost([]) }));
  assert.strictEqual(twice.status, 200, JSON.stringify(twice.json));
  assert.strictEqual(twice.json.already, true);
  cur = saved.json.current;
  assert.strictEqual(cur.position, 1);

  // A stale version: the survey changed under the editor.
  assert.strictEqual((await survey(ctx.caraTok, v[71], 71, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  const stale = await call('POST', edits(`/${runId}/response`), asAdmin({ responseId: cur.responseId, version: cur.version, answers: signPost([]) }));
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.json.code, 'RESPONSE_CHANGED');
  assert.deepStrictEqual(stale.json.current.answers.find((a) => a.questionKey === 'yard_sign').optionIds, ['candidate_follow_up'], 'reloaded with the latest');
  // Skip it.
  const skipped = await call('POST', edits(`/${runId}/skip`), asAdmin({ responseId: cur.responseId }));
  assert.strictEqual(skipped.status, 200);
  assert.strictEqual(skipped.json.current.position, 2);

  // Cold resume: the poll brings the session back at its cursor.
  const polled = await call('GET', edits(`/${runId}`), asAdmin());
  assert.strictEqual(polled.json.run.status, 'open');
  assert.strictEqual(polled.json.run.current.position, 2);
  // The ghost guard: filling the sign on a path that hides it changes nothing (a skip).
  await SurveyResponse.collection.updateOne({ voterId: v[72]._id }, { $set: { answers: [supportRow('opposed', 'Opposed')] } });
  const fresh72 = (await call('GET', edits(`/${runId}`), asAdmin())).json.run.current;
  const ghost = await call('POST', edits(`/${runId}/response`), asAdmin({ responseId: fresh72.responseId, version: fresh72.version, answers: [supportRow('opposed', 'Opposed'), { questionKey: 'yard_sign', optionIds: ['yard_sign_delivered'] }] }));
  assert.strictEqual(ghost.status, 200);
  assert.strictEqual(ghost.json.skipped, true);
  assert.strictEqual(ghost.json.current, null, 'the end of the session');

  // Stop here: completed, its summary built from the steps, one history row.
  const closed = await call('POST', edits(`/${runId}/close`), asAdmin());
  assert.strictEqual(closed.status, 200);
  assert.strictEqual(closed.json.run.status, 'completed');
  assert.match(closed.json.run.planSummary, /^One at a time: Could you help us by taking a yard sign\? \(1 survey\)$/);
  // Undo as one change.
  const undone = await runUndo(runId);
  assert.strictEqual(undone.summary.putBack, 1);
  assert.deepStrictEqual((await signOf(v[70])).optionIds, ['volunteer_request']);
});

// ── the profile ───────────────────────────────────────────────────────────────────────────────

test('profile Edit: keeps the earlier answers, writes nothing on a no-op save, and refuses a stale editor in place', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[50], 50, [supportRow(), issueRow(), signRow('volunteer_request')])).status, 201);
  let prof = await profileOf(v[50]);
  let s = prof.json.surveys[0];
  assert.ok(s.version);
  assert.strictEqual(s.editedEarlier, null);
  assert.ok(s.questions.every((q) => 'retired' in q && 'visibleIf' in q));
  // A save with nothing changed writes nothing.
  const same = await call('PATCH', `/admin/voters/${v[50]._id}/surveys/${s.id}`, asAdmin({ version: s.version, answers: s.answers, note: s.note }));
  assert.strictEqual(same.status, 200);
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ voterId: v[50]._id }), 0);
  assert.strictEqual((await liveOf(v[50])).editedAt, null);
  // A real edit keeps the version it replaced.
  const edit = await call('PATCH', `/admin/voters/${v[50]._id}/surveys/${s.id}`, asAdmin({
    version: s.version, answers: [supportRow(), issueRow(), { ...signRow(), optionIds: [], answer: [] }],
  }));
  assert.strictEqual(edit.status, 200, JSON.stringify(edit.json));
  s = edit.json.surveys[0];
  assert.ok(s.editedEarlier, 'the earlier answers are kept below');
  assert.strictEqual(s.edited.by.name, 'Ada Admin');
  assert.strictEqual(s.noteEdited, null, 'an answers-only edit never marks the note');
  const card = edit.json.overwrittenSurveys.find((o) => o.id === s.editedEarlier.overwriteId);
  assert.strictEqual(card.overwrittenVia, 'answer_edit');
  assert.strictEqual(card.restorable, true);
  assert.deepStrictEqual(card.answers.find((a) => a.questionKey === 'yard_sign').optionIds, ['volunteer_request']);
  // The editor that opened before this edit is stale now: 409 with the fresh profile to re-seed from.
  const stale = await call('PATCH', `/admin/voters/${v[50]._id}/surveys/${s.id}`, asAdmin({ version: prof.json.surveys[0].version, note: 'x' }));
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.json.code, 'RESPONSE_CHANGED');
  assert.ok(stale.json.profile.surveys[0].version);
  // A note-only change stamps the note, not the answers.
  const note = await call('PATCH', `/admin/voters/${v[50]._id}/surveys/${s.id}`, asAdmin({ version: s.version, note: 'Called back, wants a sign' }));
  assert.strictEqual(note.status, 200, JSON.stringify(note.json));
  const after = note.json.surveys[0];
  assert.strictEqual(after.note, 'Called back, wants a sign');
  assert.strictEqual(after.noteEdited.by.name, 'Ada Admin');
  assert.strictEqual(new Date(after.edited.at).getTime(), new Date(s.edited.at).getTime(), 'the answers stamp did not move');
  ctx.profileVoter = v[50];
});

test('Restore of an edit copy: its own visit through the writer, a teammate\'s survey by the full swap, the void by re-creating', { skip }, async () => {
  const v = ctx.voters;
  // Own visit: restore the copy the first profile edit kept.
  let prof = await profileOf(ctx.profileVoter);
  const earliest = prof.json.overwrittenSurveys.filter((o) => o.overwrittenVia === 'answer_edit').pop();
  const own = await call('POST', `/admin/voters/${ctx.profileVoter._id}/surveys/${earliest.id}/restore`, asAdmin());
  assert.strictEqual(own.status, 200, JSON.stringify(own.json));
  const live = await liveOf(ctx.profileVoter);
  assert.deepStrictEqual(live.answers.find((a) => a.questionKey === 'yard_sign').optionIds, ['volunteer_request']);
  assert.strictEqual(String(live.editedBy), String(ctx.admin._id), 'the restore is itself an audited edit');
  assert.strictEqual(String(live.userId), String(ctx.cara._id), 'still her survey');
  assert.ok(!(await SurveyResponseArchive.findById(earliest.id).lean()), 'the restored copy is consumed');

  // A teammate re-surveyed: the full swap, the teammate's survey preserved.
  assert.strictEqual((await survey(ctx.caraTok, v[60], 60, [supportRow(), signRow('volunteer_request')])).status, 201);
  prof = await profileOf(v[60]);
  const s60 = prof.json.surveys[0];
  await call('PATCH', `/admin/voters/${v[60]._id}/surveys/${s60.id}`, asAdmin({ version: s60.version, answers: [supportRow(), signRow()] }));
  assert.strictEqual((await survey(ctx.ottoTok, v[60], 60, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  const copy60 = await SurveyResponseArchive.findOne({ voterId: v[60]._id, overwrittenVia: 'answer_edit' }).lean();
  const swap = await call('POST', `/admin/voters/${v[60]._id}/surveys/${copy60._id}/restore`, asAdmin());
  assert.strictEqual(swap.status, 200, JSON.stringify(swap.json));
  assert.strictEqual(String((await liveOf(v[60])).userId), String(ctx.cara._id), "Cara's answers are current again");
  assert.ok(await SurveyResponseArchive.findOne({ voterId: v[60]._id, overwrittenVia: 'restore' }).lean(), "Otto's survey is preserved, not overwritten in place");

  // Into the void: delete the current survey, restore the copy.
  assert.strictEqual((await survey(ctx.caraTok, v[61], 61, [supportRow(), signRow('volunteer_request')])).status, 201);
  prof = await profileOf(v[61]);
  const s61 = prof.json.surveys[0];
  await call('PATCH', `/admin/voters/${v[61]._id}/surveys/${s61.id}`, asAdmin({ version: s61.version, answers: [supportRow(), signRow()] }));
  const copy61 = await SurveyResponseArchive.findOne({ voterId: v[61]._id, overwrittenVia: 'answer_edit' }).lean();
  assert.strictEqual((await call('DELETE', `/admin/voters/${v[61]._id}/surveys/${s61.id}`, asAdmin())).status, 200);
  const back = await call('POST', `/admin/voters/${v[61]._id}/surveys/${copy61._id}/restore`, asAdmin());
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  assert.deepStrictEqual((await signOf(v[61])).optionIds, ['volunteer_request']);
  // Erase removes a copy for good.
  prof = await profileOf(v[61]);
  for (const o of prof.json.overwrittenSurveys) {
    assert.strictEqual((await call('DELETE', `/admin/voters/${v[61]._id}/surveys/archive/${o.id}`, asAdmin())).status, 200);
  }
  assert.strictEqual((await profileOf(v[61])).json.overwrittenSurveys.length, 0);
});

// ── notes ─────────────────────────────────────────────────────────────────────────────────────

test('notes: a bulk edit never marks a note; an older note mark survives it; a phone re-survey resets both', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [55, 56]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), signRow('volunteer_request')])).status, 201);
  // Voter 56's note was edited the OLD way, before note stamps: editedBy/editedAt only.
  const old = new Date('2026-09-01T12:00:00Z');
  await SurveyResponse.collection.updateOne({ voterId: v[56]._id }, { $set: { editedBy: ctx.admin._id, editedAt: old }, $unset: { noteEditedBy: '', noteEditedAt: '' } });
  const ids = await Promise.all([55, 56].map(async (i) => String((await entryOf(v[i], ctx.cara._id))._id)));
  await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT });
  const hub = await call('GET', `/admin/reports/notes?campaignId=${ctx.campaign._id}&type=survey`, asAdmin());
  assert.strictEqual(hub.status, 200, JSON.stringify(hub.json));
  const byVoter = (vv) => hub.json.notes.find((it) => it.voter?.id === String(vv._id));
  assert.strictEqual(byVoter(v[55]).edited, null, 'the answers changed; the note did not');
  assert.ok(byVoter(v[56]).edited, 'the older mark carried across');
  assert.strictEqual(new Date(byVoter(v[56]).edited.at).getTime(), old.getTime());
  // A phone re-survey resets both stamps.
  assert.strictEqual((await survey(ctx.caraTok, v[56], 56, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  const live = await liveOf(v[56]);
  assert.strictEqual(live.editedAt, null);
  assert.strictEqual(live.noteEditedAt, null);
});

// ── readers ───────────────────────────────────────────────────────────────────────────────────

test('readers: an edit copy never reads as a duplicate or a replacement; the edited stamp shows on every survey payload', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[120], 120, [supportRow(), signRow('volunteer_request')])).status, 201);
  await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[120], ctx.cara._id))._id)], plan: TAKE_OUT });
  const dupes = await call('GET', `/admin/reports/duplicate-surveys?campaignId=${ctx.campaign._id}`, asAdmin());
  assert.ok(!(dupes.json.duplicates || []).some((d) => String(d.voter?.id || d.voterId) === String(v[120]._id)), 'not on Duplicate Surveys');
  const live = await liveOf(v[120]);
  const detail = await call('GET', `/admin/reports/responses/${live._id}?campaignId=${ctx.campaign._id}`, asAdmin());
  assert.strictEqual(detail.json.response.replacedEarlier, null);
  assert.ok(detail.json.response.editedEarlier, 'the response detail points at the earlier answers');
  assert.ok(detail.json.response.editedBy);
  const entry = await entryOf(v[120], ctx.cara._id);
  const act = await call('GET', `/admin/activities/${entry._id}`, asAdmin());
  assert.strictEqual(act.status, 200, JSON.stringify(act.json));
  assert.strictEqual(act.json.surveyResponse.edited.by.firstName, 'Ada');
  const door = await call('GET', `/admin/households/${ctx.homes[120]._id}/surveys`, asAdmin());
  assert.strictEqual(door.status, 200, JSON.stringify(door.json));
  assert.ok(door.json.surveys[0].edited);
  // A foreign run id is a 404 by construction.
  assert.strictEqual((await call('GET', edits(`/${new mongoose.Types.ObjectId()}`), asAdmin())).status, 404);
  // A lead can't reach any of it.
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'el@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: ctx.org._id, role: 'lead', isActive: true });
  const asLead = { token: signUserToken(lead) };
  const leadTry = await call('GET', edits(), asLead);
  assert.ok([403, 404].includes(leadTry.status), `lead refused (${leadTry.status})`);
});

// ── tag pricing ships answers as data ─────────────────────────────────────────────────────────

test('the tag preview reads an answer text that starts with "$" as text, and equals what lands', { skip }, async () => {
  // $documents EVALUATES its documents: a bare "$50 or more" is a field path and vanishes (measured
  // on MongoDB 7.0.2). Old text-only rows are exactly where the tag stages read the text.
  const template = await SurveyTemplate.create({
    organizationId: ctx.org._id, name: 'Donor Survey', version: 1, isActive: true,
    questions: [{
      key: 'donate', label: 'Would you chip in?', type: 'multiple_choice', order: 0,
      options: [{ id: 'donate_50', text: '$50 or more', tag: 'Donor', order: 0 }, { id: 'donate_small', text: 'Under $50', order: 1 }],
    }],
  });
  const campaign = await Campaign.create({
    organizationId: ctx.org._id, name: 'Donor C', type: 'survey', state: 'FL', isActive: true,
    timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  const effort = await Effort.create({ organizationId: ctx.org._id, campaignId: campaign._id, name: 'Donors' });
  const pass = await Pass.create({ organizationId: ctx.org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const at = new Date(Date.now() - 3600_000);
  const rows = [
    { answer: ['$50 or more'], optionIds: [] }, // two old text-only rows
    { answer: ['$50 or more'], optionIds: [] },
    { answer: ['$50 or more'], optionIds: ['donate_50'] },
  ];
  for (const [i, row] of rows.entries()) {
    const home = await Household.create({
      organizationId: ctx.org._id, campaignId: campaign._id, effortId: effort._id, addressLine1: `${i + 1} Elm St`, city: 'Town',
      state: 'FL', zipCode: '33540', normalizedAddress: `ELM${i + 1}`, location: { type: 'Point', coordinates: [-82.2, 28.3 + i * 0.001] },
      isActive: true, status: 'surveyed',
    });
    const voter = await Voter.create({
      organizationId: ctx.org._id, campaignId: campaign._id, householdId: home._id, stateVoterId: `ELM-${i + 1}`,
      firstName: 'D', lastName: `${i + 1}`, fullName: `Donor ${i + 1}`,
    });
    const location = { lat: 28.3 + i * 0.001, lng: -82.2, accuracy: 5 };
    await CanvassActivity.collection.insertOne({
      organizationId: ctx.org._id, campaignId: campaign._id, householdId: home._id, voterId: null, userId: ctx.cara._id,
      actionType: 'survey_submitted', note: null, location, replaced: null, timestamp: at, wasOfflineSubmission: false, via: null,
      passId: pass._id, effortId: effort._id, createdAt: at, updatedAt: at,
    });
    await SurveyResponse.collection.insertOne({
      organizationId: ctx.org._id, campaignId: campaign._id, voterId: voter._id, householdId: home._id, userId: ctx.cara._id,
      surveyTemplateId: template._id, surveyTemplateVersion: 1,
      answers: [{ questionKey: 'donate', questionLabel: 'Would you chip in?', ...row, otherText: null }],
      note: null, location, submittedAt: at, syncedAt: at, wasOfflineSubmission: false, passId: pass._id, turfId: null,
      effortId: effort._id, coordinatorId: null, editedBy: null, editedAt: null, createdAt: at, updatedAt: at,
    });
  }
  const path = `/admin/campaigns/${campaign._id}/answer-edits`;
  const body = { scope: { userId: String(ctx.cara._id), outcomes: ['survey_submitted'] }, plan: [{ questionKey: 'donate', op: 'clear' }] };
  const dry = await call('POST', path, asAdmin({ ...body, dryRun: true }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  assert.strictEqual(dry.json.price.surveysChanged, 3);
  assert.strictEqual(dry.json.price.tagsUnavailable, false);
  const donor = dry.json.price.tags.find((t) => t.tag === 'Donor');
  assert.deepStrictEqual(donor.identified, { before: 3, after: 0 }, 'all three were identified, the old text rows included');
  assert.deepStrictEqual(donor.current, { before: 3, after: 0 });

  const created = await call('POST', path, asAdmin({ ...body, dryRun: false, digest: dry.json.digest, asOf: dry.json.asOf, templateVersion: dry.json.template.version }));
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  assert.strictEqual((await runApply(created.json.run.id)).completed, true);
  const r = await call('GET', `/admin/reports/survey-results?campaignId=${campaign._id}&surveyTemplateId=${template._id}`, asAdmin());
  const landed = r.json.tags.find((t) => t.tag === 'Donor');
  assert.strictEqual(landed?.voterCount ?? 0, donor.identified.after, 'identified: preview == landed');
  assert.strictEqual(landed?.currentVoterCount ?? 0, donor.current.after, 'current: preview == landed');
});

// ── the client report builder's internal note ─────────────────────────────────────────────────

test('the client report builder counts edited answers for the operator, and the client page never carries them', { skip }, async () => {
  // Through the routes, the way the builder reads it: computed on create, SAVED, read back by the
  // preview. The count once vanished at the save (the report's stats schema didn't declare it).
  const day = (offset) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
  const created = await call('POST', '/admin/client-reports', asAdmin({ campaignId: String(ctx.campaign._id), weekStart: day(-7), weekEnd: day(1) }));
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const id = created.json.report._id;
  const preview = await call('GET', `/admin/client-reports/${id}/preview`, asAdmin());
  assert.strictEqual(preview.status, 200, JSON.stringify(preview.json));
  const edited = await SurveyResponse.countDocuments({ campaignId: ctx.campaign._id, editedAt: { $ne: null } });
  assert.ok(edited > 0, 'the suite has edited surveys by now');
  const cumulative = preview.json.provenance.cumulative;
  assert.ok(cumulative, 'the builder gets the internal counts');
  assert.strictEqual(cumulative.editedResponses, edited);
  assert.strictEqual(cumulative.totalResponses, await SurveyResponse.countDocuments({ campaignId: ctx.campaign._id }));
  assert.strictEqual(cumulative.deskEnteredResponses, await SurveyResponse.countDocuments({ campaignId: ctx.campaign._id, deskEntry: { $exists: true } }));
  // Recompute keeps them, and the client-shaped report (what the share link serves) never has them.
  const again = await call('POST', `/admin/client-reports/${id}/recompute`, asAdmin());
  assert.strictEqual(again.status, 200, JSON.stringify(again.json));
  assert.strictEqual((await call('GET', `/admin/client-reports/${id}/preview`, asAdmin())).json.provenance.cumulative.editedResponses, edited);
  assert.ok(!JSON.stringify(preview.json.report).includes('editedResponses'), 'never in the client view');
  assert.ok(!JSON.stringify(preview.json.report).includes('deskEnteredResponses'), 'never in the client view');
});

// ── code review 2026-10-19, round 1: each finding pinned ─────────────────────────────────────────

// Replace one method of a collection/model for ONE call, with the real one in hand.
const hookOnce = (obj, method, around) => {
  const real = obj[method].bind(obj);
  obj[method] = async (...args) => {
    obj[method] = real;
    return around(real, args);
  };
  return () => {
    obj[method] = real;
  };
};
const editRunsOf = (voter) => SurveyResponseArchive.find({ voterId: voter._id, overwrittenVia: 'answer_edit' }).lean();

test('R1-B1: a write that landed is kept, even when a re-survey or a Delete strips its mark before the writer looks', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [121, 122]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), signRow('volunteer_request')])).status, 201);
  const coll = SurveyResponse.collection;

  // A teammate re-surveys between the edit's compare-and-swap and anything else (the phone $unsets marks).
  const a = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[121], ctx.cara._id))._id)], plan: TAKE_OUT });
  let restore = hookOnce(coll, 'updateOne', async (real, args) => {
    const r = await real(...args);
    assert.strictEqual((await survey(ctx.ottoTok, v[121], 121, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
    return r;
  });
  try { await runApply(a.created.json.run.id); } finally { restore(); }
  let run = await AnswerEditRun.findById(a.created.json.run.id).lean();
  assert.strictEqual(run.counts.surveysChanged, 1, 'it landed, so it counts');
  assert.strictEqual(run.counts.changedSinceReview, 0);
  let copies = await editRunsOf(v[121]);
  assert.strictEqual(copies.length, 1, "the edit's copy of the original survives");
  assert.deepStrictEqual(copies[0].answers.find((x) => x.questionKey === 'yard_sign').optionIds, ['volunteer_request']);

  // An admin deletes the survey on the profile in the same window: earlier copies are kept on purpose.
  const b = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[122], ctx.cara._id))._id)], plan: TAKE_OUT });
  restore = hookOnce(coll, 'updateOne', async (real, args) => {
    const r = await real(...args);
    const live = await liveOf(v[122]);
    assert.strictEqual((await call('DELETE', `/admin/voters/${v[122]._id}/surveys/${live._id}`, asAdmin())).status, 200);
    return r;
  });
  try { await runApply(b.created.json.run.id); } finally { restore(); }
  run = await AnswerEditRun.findById(b.created.json.run.id).lean();
  assert.strictEqual(run.counts.surveysChanged, 1);
  copies = await editRunsOf(v[122]);
  assert.strictEqual(copies.length, 1, 'the original is still kept after the Delete');
});

test('R1-B2: a put-back that misses leaves no stamp, so Undo again never deletes the original as "put back"', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[123], 123, [supportRow(), signRow('volunteer_request')])).status, 201);
  const { runId } = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[123], ctx.cara._id))._id)], plan: TAKE_OUT });
  const copy = (await editRunsOf(v[123]))[0];
  // The undo read the survey; a teammate re-surveys before its put-back lands.
  const restore = hookOnce(SurveyResponse.collection, 'updateOne', async (real, args) => {
    assert.strictEqual((await survey(ctx.ottoTok, v[123], 123, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
    return real(...args);
  });
  let first;
  try { first = await runUndo(runId); } finally { restore(); }
  assert.strictEqual(first.summary.putBack, 0);
  assert.strictEqual(first.summary.changedSince, 1);
  assert.ok(!(await SurveyResponseArchive.findById(copy._id).lean()).undoStartedAt, 'the stamp came off the missed put-back');
  const second = await runUndo(runId);
  assert.strictEqual(second.summary.putBack, 0, 'never counted as put back');
  assert.strictEqual(second.summary.changedSince, 1);
  assert.ok(await SurveyResponseArchive.exists({ _id: copy._id }), 'the original is still kept');
});

test('R1-M3: Undo again keeps the running total — never "0 put back", never "restored on the profile"', { skip }, async () => {
  const v = ctx.voters;
  const ids = [];
  for (const i of [124, 125]) {
    assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), signRow('volunteer_request')])).status, 201);
    ids.push(String((await entryOf(v[i], ctx.cara._id))._id));
  }
  const { runId } = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT });
  const historyRows = () => CampaignChange.countDocuments({ campaignId: ctx.campaign._id, field: 'answerEditUndo' });
  const first = await runUndo(runId);
  assert.strictEqual(first.summary.putBack, 2);
  const rowsAfterFirst = await historyRows();
  const again = await runUndo(runId);
  assert.strictEqual(again.summary.putBack, 2, 'the total, not this pass');
  assert.strictEqual(again.summary.restoredOnProfile, 0);
  assert.strictEqual(await historyRows(), rowsAfterFirst, 'a pass that put nothing new back logs nothing');
});

test('R1-M4: restoring a run\'s copy on its own visit reads "restored on the profile" to that run\'s Undo, never "erased"', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[126], 126, [supportRow(), signRow('volunteer_request')])).status, 201);
  const { runId } = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[126], ctx.cara._id))._id)], plan: TAKE_OUT });
  const copy = (await editRunsOf(v[126]))[0];
  const restored = await call('POST', `/admin/voters/${v[126]._id}/surveys/${copy._id}/restore`, asAdmin());
  assert.strictEqual(restored.status, 200, JSON.stringify(restored.json));
  assert.ok(!((await liveOf(v[126])).answerEditMarks || []).some((m) => String(m) === String(copy._id)), 'the used-up copy\'s mark came off');
  const res = await runUndo(runId);
  assert.strictEqual(res.summary.restoredOnProfile, 1);
  assert.strictEqual(res.summary.erased, 0);
});

test('R1-M5: a change stopped by a deletion reads Stopped, and a run silent for ten minutes can be started again', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[127], 127, [supportRow(), signRow('volunteer_request')])).status, 201);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[127], ctx.cara._id))._id)], plan: TAKE_OUT });
  const runId = created.json.run.id;
  await Campaign.updateOne({ _id: ctx.campaign._id }, { $set: { 'deletion.requestedAt': new Date() } });
  let out;
  try { out = await runApply(runId); } finally { await Campaign.updateOne({ _id: ctx.campaign._id }, { $unset: { deletion: '' } }); }
  assert.strictEqual(out.stopped, 'tenant-deleting');
  const stopped = await AnswerEditRun.findById(runId).lean();
  assert.strictEqual(stopped.status, 'failed', 'never left "running" with no button');
  // A run "running" whose job is gone: no heartbeat for ten minutes → stalled, and Start again works.
  await AnswerEditRun.collection.updateOne({ _id: stopped._id }, { $set: { status: 'running', updatedAt: new Date(Date.now() - 11 * 60_000) } });
  const polled = await call('GET', edits(`/${runId}`), asAdmin());
  assert.strictEqual(polled.json.run.stalled, true);
  const again = await call('POST', edits(`/${runId}/resume`), asAdmin());
  assert.notStrictEqual(again.json.code, 'NOT_RESUMABLE', JSON.stringify(again.json));
  assert.strictEqual((await runApply(runId)).completed, true);
});

test('R1-M6: a phone re-survey over a survey that changed after it read it archives the version it actually replaces', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[128], 128, [supportRow(), signRow('volunteer_request')])).status, 201);
  const before = await liveOf(v[128]);
  // Just after the phone copies what it read, another writer changes the survey (an undo putting the
  // original back, say).
  const restore = hookOnce(SurveyResponseArchive.collection, 'insertOne', async (real, args) => {
    const r = await real(...args);
    await SurveyResponse.collection.updateOne(
      { _id: before._id },
      { $set: { answers: [supportRow(), signRow('candidate_follow_up')], updatedAt: new Date(Date.now() + 1000) } }
    );
    return r;
  });
  try {
    assert.strictEqual((await survey(ctx.ottoTok, v[128], 128, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  } finally {
    restore();
  }
  const copies = await SurveyResponseArchive.find({ voterId: v[128]._id, overwrittenVia: 'submit' }).lean();
  assert.strictEqual(copies.length, 1, 'one copy: the stale read\'s copy was removed');
  assert.deepStrictEqual(copies[0].answers.find((x) => x.questionKey === 'yard_sign').optionIds, ['candidate_follow_up'], 'the version actually replaced');
  assert.deepStrictEqual((await liveOf(v[128])).answers.find((x) => x.questionKey === 'yard_sign').optionIds, ['yard_sign_delivered']);
});

test('R3-B1: one change at a time holds against a racing create, both ways', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[129], 129, [supportRow(), signRow('volunteer_request')])).status, 201);
  const ids = [String((await entryOf(v[129], ctx.cara._id))._id)];
  // A conversion that passed its own check lands while the edit's create is between check and insert.
  const restore = hookOnce(AnswerEditRunChunk, 'insertMany', async (real, args) => {
    await SurveyConversionRun.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, direction: 'from_survey', mode: 'bulk', to: 'not_home', status: 'pending' });
    return real(...args);
  });
  let raced;
  try { raced = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT }); } finally { restore(); }
  assert.strictEqual(raced.created.status, 409);
  assert.strictEqual(raced.created.json.code, 'ANOTHER_CHANGE_RUNNING');
  assert.strictEqual(await AnswerEditRun.countDocuments({ campaignId: ctx.campaign._id, status: { $in: ['pending', 'running', 'open'] } }), 0, 'the edit stepped back, leaving nothing');
  await SurveyConversionRun.deleteMany({ campaignId: ctx.campaign._id, status: 'pending' });
  // The other way: an edit lands while a conversion's create is between check and insert.
  const back = hookOnce(SurveyConversionRun, 'create', async (real, args) => {
    const doc = await real(...args);
    await AnswerEditRun.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, mode: 'bulk', status: 'pending', createdAt: new Date(), updatedAt: new Date() });
    return doc;
  });
  let conv;
  try {
    conv = await call('POST', `/admin/campaigns/${ctx.campaign._id}/survey-conversions`, asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'bulk', actionIds: ids }));
  } finally {
    back();
  }
  assert.strictEqual(conv.status, 409, JSON.stringify(conv.json));
  assert.strictEqual(await SurveyConversionRun.countDocuments({ campaignId: ctx.campaign._id, status: 'pending' }), 0, 'the conversion stepped back');
  await AnswerEditRun.deleteMany({ campaignId: ctx.campaign._id, status: 'pending', plan: { $exists: false } });
});

test('R3-M2: a change parked after a queue timeout can never be applied by its late job', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[130], 130, [supportRow(), signRow('volunteer_request')])).status, 201);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[130], ctx.cara._id))._id)], plan: TAKE_OUT });
  assert.strictEqual(created.status, 503);
  const parked = await AnswerEditRun.findById(created.json.run.id).lean();
  assert.strictEqual(parked.status, 'failed');
  assert.strictEqual(parked.queueJobId, null, 'the job id is forgotten');
  const late = await processAnswerEditJob({ id: `answer-edit-${parked._id}-apply-late`, name: 'apply', data: { runId: String(parked._id) }, opts: { attempts: 3 }, attemptsMade: 0 });
  assert.strictEqual(late.skipped, 'not-claimable');
  assert.deepStrictEqual((await signOf(v[130])).optionIds, ['volunteer_request'], 'nothing changed, as the admin was told');
});

test('R3-M3: a session never writes one survey\'s answers over a voter re-surveyed with another survey', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[131], 131, [supportRow(), signRow('volunteer_request')])).status, 201);
  const ids = [String((await entryOf(v[131], ctx.cara._id))._id)];
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  // Re-surveyed since, under a different survey.
  const other = await SurveyTemplate.create({ organizationId: ctx.org._id, name: 'Other Survey', version: 1, isActive: true, questions: [{ key: 'q', label: 'Q?', type: 'text', order: 0 }] });
  const live = await liveOf(v[131]);
  await SurveyResponse.collection.updateOne({ _id: live._id }, { $set: { surveyTemplateId: other._id, answers: [{ questionKey: 'q', questionLabel: 'Q?', answer: 'kept', optionIds: [], otherText: null }] } });
  const step = await call('GET', edits(`/${runId}/response/${created.json.current.responseId}`), asAdmin());
  assert.strictEqual(step.json.current.missing, true);
  assert.strictEqual(step.json.current.reason, 'other_survey');
  const saved = await call('POST', edits(`/${runId}/response`), asAdmin({ responseId: created.json.current.responseId, version: created.json.current.version, answers: [signRow()] }));
  assert.strictEqual(saved.json.reason, 'other_survey');
  assert.deepStrictEqual((await liveOf(v[131])).answers.map((x) => x.questionKey), ['q'], 'untouched');
  assert.strictEqual((await call('POST', edits(`/${runId}/close`), asAdmin())).status, 200);
});

test('R2-B1: an older answer the change brings back into force moves its tag, and the review prices it', { skip }, async () => {
  const v = ctx.voters;
  // Round 0, recorded earlier: a genuine Volunteer Request. Round 1 (Cara): a fake Candidate Follow-Up.
  const round0 = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.pass.effortId, roundNumber: 0, name: 'Round 0', status: 'archived' });
  const home = ctx.homes[132];
  const at = new Date(Date.now() - 5 * 86400_000);
  await SurveyResponse.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, voterId: v[132]._id, householdId: home._id, userId: ctx.otto._id,
    surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1, answers: [supportRow(), signRow('volunteer_request')], note: null,
    location: { lat: 28.2, lng: -82.1 }, submittedAt: at, syncedAt: at, wasOfflineSubmission: false, passId: round0._id,
    turfId: null, effortId: ctx.pass.effortId, coordinatorId: null, editedBy: null, editedAt: null, createdAt: at, updatedAt: at,
  });
  assert.strictEqual((await survey(ctx.caraTok, v[132], 132, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  const plan = [{ questionKey: 'yard_sign', op: 'adjust', remove: ['candidate_follow_up'] }];
  const { dry, created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: [String((await entryOf(v[132], ctx.cara._id))._id)], plan });
  const vol = dry.json.price.tags.find((t) => t.tag === 'Volunteer');
  assert.ok(vol, 'Volunteer is priced though no Volunteer pick moved');
  assert.strictEqual(vol.current.after, vol.current.before + 1, 'round 0\'s answer is the latest again');
  await runApply(created.json.run.id);
  const r = await call('GET', `/admin/reports/survey-results?campaignId=${ctx.campaign._id}&surveyTemplateId=${ctx.template._id}`, asAdmin());
  const landed = r.json.tags.find((t) => t.tag === 'Volunteer');
  assert.strictEqual(landed.currentVoterCount, vol.current.after, 'current: preview == landed');
  assert.strictEqual(landed.voterCount, vol.identified.after, 'identified: preview == landed');
  await runUndo(created.json.run.id);
});

test('R2-M2: with Replace them with, only surveys that kept an original pick "keep" it', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[133], 133, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  assert.strictEqual((await survey(ctx.caraTok, v[134], 134, [supportRow(), signRow('yard_sign_delivered', 'candidate_follow_up')])).status, 201);
  const ids = [];
  for (const i of [133, 134]) ids.push(String((await entryOf(v[i], ctx.cara._id))._id));
  const dry = await call('POST', edits(), asAdmin({
    dryRun: true, scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids,
    plan: [{ questionKey: 'yard_sign', op: 'adjust', remove: ['candidate_follow_up'], replaceWith: ['volunteer_request'] }],
  }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  const q = dry.json.price.byQuestion.find((x) => x.questionKey === 'yard_sign');
  assert.strictEqual(q.surveys, 2);
  assert.strictEqual(q.keptAny, 1, 'only the one that had Yard Sign Delivered keeps a pick of its own');
});

test('R5-M1: every copy of a struck visit\'s answers stays blocked after the canvasser surveys someone else at the door', { skip }, async () => {
  const v = ctx.voters;
  const home = ctx.homes[137];
  const mate = await Voter.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: home._id, stateVoterId: 'OAK-137-MATE', firstName: 'H', lastName: 'Mate', fullName: 'House Mate' });
  assert.strictEqual((await survey(ctx.caraTok, v[137], 137, [supportRow(), signRow('volunteer_request')])).status, 201);
  // An admin edits it on the profile: an earlier-answers copy of the struck visit's answers.
  const prof = await profileOf(v[137]);
  const s0 = prof.json.surveys[0];
  assert.strictEqual((await call('PATCH', `/admin/voters/${v[137]._id}/surveys/${s0.id}`, asAdmin({ version: s0.version, answers: [signRow()] }))).status, 200);
  const entry = await entryOf(v[137], ctx.cara._id);
  const struck = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries`, asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(entry._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  // Cara surveys the housemate: a new Surveyed entry at the same visit.
  assert.strictEqual((await survey(ctx.caraTok, mate, 137, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  const after = await profileOf(v[137]);
  const editCard = after.json.overwrittenSurveys.find((o) => o.overwrittenVia === 'answer_edit');
  assert.ok(editCard);
  assert.strictEqual(editCard.restorable, false, 'the earlier answers of a struck visit stay blocked');
  const tried = await call('POST', `/admin/voters/${v[137]._id}/surveys/${editCard.id}/restore`, asAdmin());
  assert.strictEqual(tried.status, 409);
  assert.strictEqual(await SurveyResponse.countDocuments({ voterId: v[137]._id }), 0, 'never brought back as a counted survey');
});

test('round 1 server minors: blocked up front, nothing to undo, no template, the note stamp, Erase during an undo, Details paging', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[138], 138, [supportRow(), signRow('volunteer_request')])).status, 201);
  const ids = [String((await entryOf(v[138], ctx.cara._id))._id)];
  // An open session blocks: the form hears it from the dry run.
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, mode: 'queue' });
  const blocked = await call('POST', edits(), asAdmin({ dryRun: true, scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids }));
  assert.strictEqual(blocked.json.blocked?.code, 'ANOTHER_CHANGE_RUNNING');
  // Closed having changed nothing: nothing to undo.
  assert.strictEqual((await call('POST', edits(`/${created.json.run.id}/close`), asAdmin())).status, 200);
  const nothing = await call('POST', edits(`/${created.json.run.id}/revert`), asAdmin());
  assert.strictEqual(nothing.json.code, 'NOTHING_TO_UNDO');
  // A survey whose questions are gone: its answers can't be edited (its note still can).
  const live = await liveOf(v[138]);
  await SurveyResponse.collection.updateOne({ _id: live._id }, { $set: { surveyTemplateId: new mongoose.Types.ObjectId() } });
  const noTpl = await call('PATCH', `/admin/voters/${v[138]._id}/surveys/${live._id}`, asAdmin({ answers: [signRow()] }));
  assert.strictEqual(noTpl.json.code, 'TEMPLATE_MISSING');
  await SurveyResponse.collection.updateOne({ _id: live._id }, { $set: { surveyTemplateId: ctx.template._id } });
  // An edit from before note stamps, on a survey with no note: no "Note edited" line.
  await SurveyResponse.collection.updateOne({ _id: live._id }, { $set: { note: null, editedBy: ctx.admin._id, editedAt: new Date() }, $unset: { noteEditedBy: '', noteEditedAt: '' } });
  const prof = await profileOf(v[138]);
  assert.strictEqual(prof.json.surveys[0].noteEdited, null);
  // Erase waits for an undo that is putting this copy back.
  const copy = await SurveyResponseArchive.collection.insertOne({ ...live, _id: new mongoose.Types.ObjectId(), overwrittenVia: 'answer_edit', overwrittenAt: new Date(), undoStartedAt: new Date() });
  const erase = await call('DELETE', `/admin/voters/${v[138]._id}/surveys/archive/${copy.insertedId}`, asAdmin());
  assert.strictEqual(erase.json.code, 'COPY_IN_USE');
  await SurveyResponseArchive.collection.deleteOne({ _id: copy.insertedId });
  // Details after an undo pages over the names it stored, and says how many weren't put back in all.
  const { runId } = await editAndApply({ scope: scopeFor(ctx.cara._id, { search: 'Oak St' }), actionIds: ids, plan: TAKE_OUT });
  await runUndo(runId);
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { 'undo.summary.names': [{ voterId: v[138]._id, voterName: 'X', reason: 'changed_since', detail: null }], 'undo.summary.namesTotal': 250 } });
  const page = await call('GET', edits(`/${runId}/entries?skip=0&limit=50`), asAdmin());
  assert.strictEqual(page.json.total, 1);
  assert.strictEqual(page.json.namesTotal, 250);
  assert.strictEqual(page.json.truncated, true);
});
