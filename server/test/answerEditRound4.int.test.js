import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Code review round 4 of Edit answers on Door Outcomes (2026-10-19), each finding pinned against the
// REAL app + a throwaway mongod — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §V. Most are the reviewers' own
// reproductions, asserting what the fix does:
//   npm run test:int -- test/answerEditRound4.int.test.js
//
// Redis points at a dead port, as everywhere here: a create or an undo answers 503 when it can't
// reach the queue, and the tests drive the REAL processors with the job id the run carries.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-r4';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.ANSWER_EDIT_ENQUEUE_TIMEOUT_MS = '300';
process.env.OUTCOME_CONVERT_ENQUEUE_TIMEOUT_MS = '300';

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
const { TurfSnapshot } = await import('../src/models/TurfSnapshot.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyResponseArchive } = await import('../src/models/SurveyResponseArchive.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyConversionRun } = await import('../src/models/SurveyConversionRun.js');
const { ConversionStrike } = await import('../src/models/ConversionStrike.js');
const { UnknockRun } = await import('../src/models/UnknockRun.js');
const { UnknockRunChunk } = await import('../src/models/UnknockRunChunk.js');
const { AnswerEditRun } = await import('../src/models/AnswerEditRun.js');
const { AnswerEditRunChunk } = await import('../src/models/AnswerEditRunChunk.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { processAnswerEditJob, reconcileFailedAnswerEditJob, otherChangeRunning } = await import('../src/services/canvass/answerEditRuns.js');
const { deleteOrganization } = await import('../src/services/platform/deleteOrganization.js');
const { applyChunk } = await import('../src/services/canvass/answerEditWriter.js');
const { processConversionJob, reconcileFailedConversionJob } = await import('../src/services/canvass/conversionProcessor.js');
const { fingerprint } = await import('../src/services/canvass/answerEdit.js');
const { restoreStates } = await import('../src/services/surveys/restoreGuard.js');
const { getQueue, QUEUE_NAMES } = await import('../src/queues/index.js');
const { ReclassifyRun } = await import('../src/models/ReclassifyRun.js');
const { runReclassify } = await import('../src/services/canvass/reclassifyOutcomes.js');
const { processCampaignDeleteJob } = await import('../src/services/campaigns/deleteCampaignProcessor.js');
const { sweepIfDeleting } = await import('../src/services/platform/lateWriteSweep.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const DOORS = 80;
// Doors with a second voter: one canvasser's visit, two people surveyed.
const TWO_VOTER_DOORS = [60, 61, 62, 63];

const QUESTIONS = [
  {
    key: 'candidate_support',
    label: 'Can we count on your support?',
    type: 'single_choice',
    order: 0,
    options: [
      { id: 'strong_support', text: 'Support', tag: 'Supporter', order: 0 },
      { id: 'undecided', text: 'Undecided', order: 1 },
    ],
  },
  {
    key: 'yard_sign',
    label: 'Could you help us by taking a yard sign?',
    type: 'multiple_choice',
    order: 1,
    options: [
      { id: 'yard_sign_delivered', text: 'Yard Sign Delivered', order: 0 },
      { id: 'candidate_follow_up', text: 'Candidate Follow-Up', order: 1 },
      { id: 'volunteer_request', text: 'Volunteer Request', order: 2, tag: 'Volunteer' },
    ],
  },
  { key: 'anything_else', label: 'Anything else?', type: 'text', order: 2 },
];

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI, { monitorCommands: true });
  for (const M of [
    Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, TurfSnapshot, Household,
    Voter, CanvassActivity, SurveyResponse, SurveyResponseArchive, SurveyTemplate, SurveyConversionRun, ConversionStrike,
    UnknockRun, UnknockRunChunk, AnswerEditRun, AnswerEditRunChunk, CampaignChange, Subscription,
  ]) {
    await M.deleteMany({});
  }
  await SurveyResponse.init();
  await SurveyResponseArchive.init();
  await AnswerEditRunChunk.init();

  const org = await Organization.create({ name: 'Edit Org R4', slug: 'edit-org-r4', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'r4a@t.co', passwordHash: 'x', isActive: true });
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'r4b@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'r4c@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'r4o@t.co', passwordHash: 'x', isActive: true });
  for (const u of [admin, bea]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const otherTemplate = await SurveyTemplate.create({ organizationId: org._id, name: 'Other Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit R4', type: 'survey', state: 'FL', isActive: true,
    timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  for (const u of [cara, otto]) await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: u._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const homes = await Household.insertMany(
    Array.from({ length: DOORS }, (_, i) => ({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
      addressLine1: `${i + 1} Elm St`, city: 'Town', state: 'FL', zipCode: '33540',
      normalizedAddress: `ELM${i + 1}`, location: { type: 'Point', coordinates: [-82.1 + i * 0.001, 28.2] },
      isActive: true, status: 'unknocked',
    }))
  );
  const turf = await Turf.create({
    organizationId: org._id, campaignId: campaign._id, passId: pass._id, name: 'Book Elm',
    mode: 'manual', status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  for (const u of [cara, otto]) {
    await TurfAssignment.create({ organizationId: org._id, campaignId: campaign._id, passId: pass._id, turfId: turf._id, userId: u._id });
  }
  const voters = await Voter.insertMany(
    homes.map((h, i) => ({
      organizationId: org._id, campaignId: campaign._id, householdId: h._id,
      stateVoterId: `ELM-${i + 1}`, firstName: 'V', lastName: `${i + 1}`, fullName: `Voter ${i + 1}`,
    }))
  );
  const housemates = {};
  for (const d of TWO_VOTER_DOORS) {
    housemates[d] = await Voter.create({
      organizationId: org._id, campaignId: campaign._id, householdId: homes[d]._id,
      stateVoterId: `ELM-MATE-${d}`, firstName: 'M', lastName: `Mate ${d}`, fullName: `Mate ${d}`,
    });
  }

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, campaign, template, otherTemplate, pass, admin, bea, cara, otto, homes, voters, housemates,
    adminTok: signUserToken(admin), beaTok: signUserToken(bea), caraTok: signUserToken(cara), ottoTok: signUserToken(otto),
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
const asBea = (body) => ({ token: ctx.beaTok, ...(body ? { body } : {}) });
const edits = (suffix = '') => `/admin/campaigns/${ctx.campaign._id}/answer-edits${suffix}`;
const conv = (suffix = '') => `/admin/campaigns/${ctx.campaign._id}/survey-conversions${suffix}`;
const unknocks = (suffix = '') => `/admin/campaigns/${ctx.campaign._id}/unknock-entries${suffix}`;

const near = (i) => ({ lat: 28.2 + 0.00001, lng: -82.1 + i * 0.001 + 0.00001, accuracy: 6 });
let minute = 0;
const nextTs = () => {
  minute += 1;
  return new Date(Date.now() - 20 * 3600_000 + minute * 60_000).toISOString();
};
const TEXT = { yard_sign_delivered: 'Yard Sign Delivered', candidate_follow_up: 'Candidate Follow-Up', volunteer_request: 'Volunteer Request' };
const supportRow = () => ({ questionKey: 'candidate_support', questionLabel: 'Can we count on your support?', answer: 'Support', optionIds: ['strong_support'] });
const signRow = (...ids) => ({ questionKey: 'yard_sign', questionLabel: 'Could you help us by taking a yard sign?', answer: ids.map((i) => TEXT[i]), optionIds: ids });
const textRow = (text) => ({ questionKey: 'anything_else', questionLabel: 'Anything else?', answer: text });
const FAKE = () => [supportRow(), signRow('yard_sign_delivered', 'volunteer_request')];

const survey = (token, voter, door, answers, extra = {}) =>
  call('POST', `/mobile/voters/${voter._id}/survey`, {
    token,
    body: { surveyTemplateId: String(ctx.template._id), answers, location: near(door), timestamp: nextTs(), note: 'note from the door', ...extra },
  });
const liveOf = (voter) => SurveyResponse.collection.findOne({ voterId: voter._id });
const signOf = async (voter) => (await liveOf(voter))?.answers.find((a) => a.questionKey === 'yard_sign')?.optionIds || null;
const entryOf = (voter, userId) => CanvassActivity.findOne({ voterId: voter._id, userId, actionType: { $ne: 'note_added' } }).lean();
const visitEntry = (door, userId) => CanvassActivity.findOne({ householdId: ctx.homes[door]._id, userId, actionType: { $ne: 'note_added' } }).lean();
const scopeFor = (userId, extra = {}) => ({ userId: String(userId), outcomes: ['survey_submitted'], ...extra });
const TAKE_OUT = [{ questionKey: 'yard_sign', op: 'adjust', remove: ['candidate_follow_up', 'volunteer_request'] }];
const copiesOf = (voter, via) => SurveyResponseArchive.collection.find({ voterId: voter._id, ...(via ? { overwrittenVia: via } : {}) }).toArray();
const holdsOriginal = (copies, original) => copies.some((c) => JSON.stringify(c.answers) === JSON.stringify(original.answers));

const deferred = () => {
  let resolve;
  const p = new Promise((r) => { resolve = r; });
  return { p, resolve };
};
// Replace one method of a driver collection (or a model method whose result is awaited as is) for
// ONE call, with the real one in hand. Every hook a test leaves unfired is put back after it, so one
// test's miss can't reach the next.
const pending = [];
afterEach(() => {
  while (pending.length) pending.pop()();
});
const hookOnce = (obj, method, around) => {
  const real = obj[method].bind(obj);
  obj[method] = async (...args) => {
    obj[method] = real;
    return around(real, args);
  };
  const restore = () => { obj[method] = real; };
  pending.push(restore);
  return restore;
};
// Replace a method for every call until restored.
const hookAll = (obj, method, around) => {
  const real = obj[method].bind(obj);
  obj[method] = (...args) => around(real, args);
  const restore = () => { obj[method] = real; };
  pending.push(restore);
  return restore;
};

// The run's own job (the routes write its id before the add; with the queue down they parked it).
const runApply = async (runId) => {
  let run = await AnswerEditRun.findById(runId).lean();
  if (!run.queueJobId) {
    await AnswerEditRun.updateOne(
      { _id: runId },
      { $set: { queueJobId: `t-apply-${runId}-${Date.now()}`, status: run.status === 'failed' ? 'pending' : run.status, error: null } }
    );
    run = await AnswerEditRun.findById(runId).lean();
  }
  return processAnswerEditJob({ id: run.queueJobId, name: 'apply', data: { runId: String(runId) }, opts: { attempts: 3 }, attemptsMade: 0 });
};
const armUndo = async (runId, requestedBy = null) => {
  const jobId = `t-undo-${runId}-${Date.now()}-${Math.random()}`;
  await AnswerEditRun.updateOne(
    { _id: runId },
    { $set: { 'undo.status': 'pending', 'undo.jobId': jobId, 'undo.requestedAt': new Date(), 'undo.requestedBy': requestedBy } }
  );
  return jobId;
};
const undoJob = (runId, jobId) => processAnswerEditJob({ id: jobId, name: 'undo', data: { runId: String(runId) }, opts: { attempts: 3 }, attemptsMade: 0 });
const runUndo = async (runId) => undoJob(runId, await armUndo(runId));

const reviewAndCreate = async (body, as = asAdmin) => {
  const dry = await call('POST', edits(), as({ ...body, dryRun: true }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  const created = await call('POST', edits(), as({
    ...body, dryRun: false, digest: dry.json.digest, asOf: dry.json.asOf, templateVersion: dry.json.template.version,
  }));
  return { dry, created };
};
// A bulk take-out of one door's survey, created (parked by the dead queue) but not applied.
const createTakeOut = async (door, extra = {}) => {
  const e = await entryOf(ctx.voters[door], ctx.cara._id);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: `${door + 1} Elm St` }), actionIds: [String(e._id)], plan: TAKE_OUT, ...extra });
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  return created.json.run.id;
};
const takeOutApplied = async (door) => {
  const runId = await createTakeOut(door);
  const out = await runApply(runId);
  assert.deepStrictEqual(out, { completed: true });
  return runId;
};
const historySince = (field, since) =>
  CampaignChange.find({ campaignId: ctx.campaign._id, field, createdAt: { $gte: since } }).sort({ createdAt: 1 }).lean();
const putBackLogged = (rows) => rows.reduce((n, r) => n + Number((String(r.toValue).match(/^([\d,]+) surveys? put back/) || [0, '0'])[1].replace(/,/g, '')), 0);

// Swap a queue's add for one that "reaches Redis" (the job never runs on its own here).
const stubQueue = (name) => {
  const q = getQueue(name);
  const real = q.add.bind(q);
  q.add = async (jobName, data, opts = {}) => ({ id: opts.jobId || `stub-${Date.now()}`, name: jobName, data });
  return () => { q.add = real; };
};

// More than one door's surveys in one take-out run (created, parked by the dead queue, not applied).
const createTakeOutFor = async (doors, extra = {}) => {
  const ids = [];
  for (const d of doors) ids.push(String((await entryOf(ctx.voters[d], ctx.cara._id))._id));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Elm St' }), actionIds: ids, plan: TAKE_OUT, ...extra });
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  return created.json.run.id;
};
// One chunk per frozen survey, in this voter order (as a run past 500 surveys would be split).
const splitChunks = async (runId, orderVoterIds) => {
  const [c] = await AnswerEditRunChunk.find({ runId }).lean();
  await AnswerEditRunChunk.deleteMany({ runId });
  const items = orderVoterIds.map((vid) => c.items.find((it) => String(it.v) === String(vid)));
  await AnswerEditRunChunk.insertMany(items.map((it, seq) => ({ runId: c.runId, campaignId: c.campaignId, organizationId: c.organizationId, seq, items: [it] })));
};
const armApply = async (runId) => {
  const run = await AnswerEditRun.findById(runId).lean();
  const id = `t-apply-${runId}-${Date.now()}-${Math.random()}`;
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { queueJobId: id, status: run.status === 'failed' ? 'pending' : run.status, error: null } });
  return id;
};
const applyJob = (runId, jobId) => processAnswerEditJob({ id: jobId, name: 'apply', data: { runId: String(runId) }, opts: { attempts: 3 }, attemptsMade: 0 });
const undoPressed = async (runId) => {
  const unstub = stubQueue(QUEUE_NAMES.ANSWER_EDIT);
  try {
    return await call('POST', edits(`/${runId}/revert`), asAdmin());
  } finally {
    unstub();
  }
};
const profileOf = (voter) => call('GET', `/admin/voters/${voter._id}`, asAdmin());
const cardsOf = async (voter) => (await profileOf(voter)).json.overwrittenSurveys;
const restoreCopy = (voter, archiveId) => call('POST', `/admin/voters/${voter._id}/surveys/${archiveId}/restore`, asAdmin());
const profileEdit = async (voter, answers) => {
  const s0 = (await profileOf(voter)).json.surveys[0];
  const r = await call('PATCH', `/admin/voters/${voter._id}/surveys/${s0.id}`, asAdmin({ version: s0.version, answers }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
};
const notHome = (token, door) => call('POST', `/mobile/households/${ctx.homes[door]._id}/not-home`, { token, body: { location: near(door), timestamp: nextTs() } });
const convertDoorFromSurvey = async (entryId) => {
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(entryId)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  assert.strictEqual((await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(entryId) }))).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  return runId;
};

// A strike's request that died stops beating; ten minutes later it reads stopped (unknockLease.js).
const silence = (runId) => {
  const longAgo = new Date(Date.now() - 11 * 60 * 1000);
  return UnknockRun.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(runId)) }, { $set: { heartbeatAt: longAgo, deletingAt: longAgo, createdAt: longAgo } });
};
const listedUnknock = async (runId) => (await call('GET', unknocks(), asAdmin())).json.runs.find((r) => r.id === String(runId));

// ── the unknock's lease (C1) ─────────────────────────────────────────────────────────────────────

test('C1: an unknock still removing reads Removing with no Undo, and its Undo waits until it finishes', { skip }, async () => {
  const v = ctx.voters[1];
  assert.strictEqual((await survey(ctx.caraTok, v, 1, FAKE())).status, 201);
  const e = await visitEntry(1, ctx.cara._id);
  // The strike is held at its answers' delete — past its mark, before it finished.
  const inside = deferred();
  const release = deferred();
  hookOnce(SurveyResponse.collection, 'bulkWrite', async (real, args) => {
    inside.resolve();
    await release.p;
    return real(...args);
  });
  const strike = call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  await inside.p;
  let listed;
  let pressed;
  let run;
  try {
    run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
    assert.ok(run.deletingAt, 'past its mark');
    listed = await listedUnknock(run._id);
    pressed = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  } finally {
    release.resolve();
  }
  assert.strictEqual(listed.removing, true);
  assert.strictEqual(listed.stoppedPartWay, false, 'never "Stopped part-way" while it runs');
  assert.strictEqual(pressed.status, 409);
  assert.strictEqual(pressed.json.code, 'RUN_BUSY');
  const done = await strike;
  assert.strictEqual(done.status, 201, JSON.stringify(done.json));
  const after = await UnknockRun.findById(run._id).lean();
  assert.strictEqual(after.status, 'completed');
  assert.strictEqual(after.revertedAt, null);
  assert.strictEqual(await visitEntry(1, ctx.cara._id), null);
  assert.strictEqual(await liveOf(v), null);
  assert.strictEqual((await listedUnknock(run._id)).removing, false);
  // Now its Undo puts it all back.
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.ok(await visitEntry(1, ctx.cara._id));
  assert.ok(await liveOf(v));
});

test('C1: a strike silent long enough to read stopped, and undone meanwhile, stops before its next removal', { skip }, async () => {
  const v = ctx.voters[2];
  assert.strictEqual((await survey(ctx.caraTok, v, 2, FAKE())).status, 201);
  const e = await visitEntry(2, ctx.cara._id);
  // Held at the beat before it deletes the entries (the second after its mark — the first comes
  // between archiving the answers and deleting them): its answers are archived and gone.
  const inside = deferred();
  const release = deferred();
  let marked = false;
  let beatsSinceMark = 0;
  hookAll(UnknockRun.collection, 'updateOne', async (real, args) => {
    const set = args[1]?.$set || {};
    if (set.deletingAt) marked = true;
    else if (marked && set.heartbeatAt && !set.status && set.heartbeatAt.getTime() > 0) {
      beatsSinceMark += 1;
      if (beatsSinceMark === 2) {
        inside.resolve();
        await release.p;
      }
    }
    return real(...args);
  });
  const strike = call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  await inside.p;
  let undone;
  let run;
  try {
    run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
    assert.strictEqual(await liveOf(v), null, 'its answers went');
    await silence(run._id);
    assert.strictEqual((await listedUnknock(run._id)).stoppedPartWay, true);
    undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  } finally {
    release.resolve();
  }
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  const out = await strike;
  while (pending.length) pending.pop()();
  assert.strictEqual(out.status, 500, 'the strike stopped instead of removing what the undo put back');
  const after = await UnknockRun.findById(run._id).lean();
  assert.strictEqual(after.status, 'reverted', 'never "completed" over its undo');
  assert.ok(after.revertedAt);
  assert.ok(await visitEntry(2, ctx.cara._id), 'its entry was never removed');
  assert.ok(await liveOf(v), 'and its answers are back');
  const history = await CampaignChange.find({ campaignId: ctx.campaign._id, field: 'unknock', createdAt: { $gte: run.createdAt } }).sort({ createdAt: 1 }).lean();
  assert.deepStrictEqual(history.map((h) => h.toValue), ['unknocked', 'recorded'], 'the strike (logged when it began removing), then its undo — once each');
});

test('C1: an unknock of thousands of entries finishes in seconds — its reads go by round and canvasser, never one clause per visit', { skip }, async () => {
  // 3,000 entries across the campaign's doors in one round is enough to show the read: one $or clause
  // per visit took about 17 s at this size before round 4.
  const n = 3000;
  const doors = await Household.insertMany(
    Array.from({ length: n }, (_, i) => ({
      organizationId: ctx.org._id, campaignId: ctx.campaign._id, addressLine1: `${i} Bulk Rd`, city: 'Town', state: 'FL', zipCode: '33540',
      normalizedAddress: `BULK${i}`, location: { type: 'Point', coordinates: [-82.3, 28.4] }, isActive: true, status: 'surveyed',
    })),
    { lean: true }
  );
  const voters = await Voter.insertMany(
    doors.map((h, i) => ({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: h._id, stateVoterId: `BULK-${i}`, firstName: 'B', lastName: `${i}`, fullName: `Bulk ${i}` })),
    { lean: true }
  );
  const ts = new Date(Date.now() - 30 * 3600_000);
  const base = { organizationId: ctx.org._id, campaignId: ctx.campaign._id, userId: ctx.otto._id, passId: ctx.pass._id };
  await CanvassActivity.collection.insertMany(doors.map((h, i) => ({ ...base, householdId: h._id, voterId: voters[i]._id, actionType: 'survey_submitted', timestamp: ts, createdAt: ts, updatedAt: ts })));
  await SurveyResponse.collection.insertMany(doors.map((h, i) => ({ ...base, householdId: h._id, voterId: voters[i]._id, surveyTemplateId: ctx.template._id, submittedAt: ts, answers: FAKE(), createdAt: ts, updatedAt: ts })));
  const ids = (await CanvassActivity.find({ householdId: { $in: doors.map((d) => d._id) } }, { _id: 1 }).lean()).map((r) => String(r._id));
  const t0 = Date.now();
  const preview = await call('POST', unknocks(), asAdmin({ dryRun: true, scope: { userId: String(ctx.otto._id) }, actionIds: ids }));
  const previewMs = Date.now() - t0;
  assert.strictEqual(preview.status, 200, JSON.stringify(preview.json));
  assert.strictEqual(preview.json.survey.responsesToArchive, n);
  const t1 = Date.now();
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.otto._id) }, actionIds: ids }));
  const strikeMs = Date.now() - t1;
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  assert.strictEqual(struck.json.run.counts.responsesArchived, n);
  assert.strictEqual(await SurveyResponse.countDocuments({ householdId: { $in: doors.map((d) => d._id) } }), 0);
  console.log(`[round 4] unknock of ${n} entries: preview ${previewMs} ms, strike ${strikeMs} ms`);
  assert.ok(previewMs < 10_000 && strikeMs < 20_000, `preview ${previewMs} ms, strike ${strikeMs} ms`);
  const t2 = Date.now();
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  console.log(`[round 4] its undo: ${Date.now() - t2} ms`);
  assert.strictEqual(await SurveyResponse.countDocuments({ householdId: { $in: doors.map((d) => d._id) } }), n);
  // Leave the campaign as the other tests expect it.
  const doorIds = doors.map((d) => d._id);
  await Promise.all([
    CanvassActivity.deleteMany({ householdId: { $in: doorIds } }),
    SurveyResponse.deleteMany({ householdId: { $in: doorIds } }),
    Voter.deleteMany({ householdId: { $in: doorIds } }),
    Household.deleteMany({ _id: { $in: doorIds } }),
    UnknockRun.deleteOne({ _id: struck.json.run.id }),
    UnknockRunChunk.deleteMany({ runId: struck.json.run.id }),
  ]);
});

test('R-m6: a strike that stopped part-way holds a copy of its struck answers made while it removed', { skip }, async () => {
  const v = ctx.voters[3];
  assert.strictEqual((await survey(ctx.caraTok, v, 3, FAKE())).status, 201);
  const e = await visitEntry(3, ctx.cara._id);
  // It removed the entries, then its request died before it was marked completed.
  hookAll(UnknockRun.collection, 'updateOne', async (real, args) => {
    if (args[1]?.$set?.status === 'completed') throw new Error('dyno restarted');
    return real(...args);
  });
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  while (pending.length) pending.pop()();
  assert.strictEqual(struck.status, 500);
  assert.strictEqual(await visitEntry(3, ctx.cara._id), null);
  const run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  const chunk = await UnknockRunChunk.findOne({ runId: run._id }).lean();
  // Stopped: its last beat was a minute after its freeze; a teammate's copy of the struck answers was
  // made in between (the visit's survey overwritten as the strike ran).
  const frozenAt = new Date(Date.now() - 20 * 60_000);
  const lastBeat = new Date(Date.now() - 19 * 60_000);
  await UnknockRunChunk.collection.updateOne({ _id: chunk._id }, { $set: { frozenAt } });
  await UnknockRun.collection.updateOne({ _id: run._id }, { $set: { createdAt: frozenAt, deletingAt: frozenAt, heartbeatAt: lastBeat } });
  const copy = (await copiesOf(v, 'unknock'))[0];
  // Its own copy was made as it removed, before the teammate's.
  await SurveyResponseArchive.collection.updateOne({ _id: copy._id }, { $set: { overwrittenAt: new Date(frozenAt.getTime() + 10_000) } });
  const { _id: copyId, ...rest } = copy;
  const teammate = await SurveyResponseArchive.collection.insertOne({
    ...rest, _id: new mongoose.Types.ObjectId(), overwrittenVia: 'submit', unknockRunId: undefined, overwrittenBy: ctx.otto._id,
    overwrittenAt: new Date(frozenAt.getTime() + 30_000),
  });
  // Cara records the visit again for real.
  assert.strictEqual((await survey(ctx.caraTok, v, 3, [supportRow()])).status, 201);
  const [state] = [...(await restoreStates([await SurveyResponseArchive.collection.findOne({ _id: teammate.insertedId })])).values()];
  assert.deepStrictEqual(state, { restorable: false, reason: 'unknocked' }, 'held until that unknock is undone');
});

// ── a step and the Close and Undo beside it (G1, G6, G7, W2) ───────────────────────────────────────

test('G1: Close waits out a door still saving, Undo waits for Close, and then the door comes back whole', { skip }, async () => {
  const v = ctx.voters[5];
  assert.strictEqual((await survey(ctx.caraTok, v, 5, FAKE())).status, 201);
  const e = await visitEntry(5, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  const inside = deferred();
  const release = deferred();
  hookOnce(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    inside.resolve();
    await release.p;
    return real(...args);
  });
  const step = call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e._id) }));
  await inside.p;
  let closed;
  let undo;
  try {
    closed = await call('POST', conv(`/${runId}/close`), asBea());
    undo = await call('POST', conv(`/${runId}/revert`), asBea());
  } finally {
    release.resolve();
  }
  assert.strictEqual(closed.status, 409);
  assert.strictEqual(closed.json.code, 'RUN_BUSY');
  assert.strictEqual(undo.status, 409);
  assert.strictEqual(undo.json.code, 'RUN_OPEN');
  assert.strictEqual((await step).status, 200);
  assert.strictEqual((await visitEntry(5, ctx.cara._id)).actionType, 'not_home');
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asBea())).status, 200);
  const undone = await call('POST', conv(`/${runId}/revert`), asBea());
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  const entry = await visitEntry(5, ctx.cara._id);
  assert.strictEqual(entry.actionType, 'survey_submitted');
  assert.strictEqual(entry.reclassified, undefined, 'no stamp of a reverted run left on it');
  assert.ok(await liveOf(v), 'its answers are back');
});

test('G1: an Undo pressed while a closed session\'s last step still saves waits for it', { skip }, async () => {
  const v = ctx.voters[6];
  assert.strictEqual((await survey(ctx.caraTok, v, 6, FAKE())).status, 201);
  const e = await visitEntry(6, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  const runId = opened.json.run.id;
  // A step counted in (a crash or a stall elsewhere) on a session someone closed: the claim was open.
  await SurveyConversionRun.updateOne({ _id: runId }, { $set: { status: 'completed', completedAt: new Date(), stepping: 1, steppingAt: new Date() } });
  const pressed = await call('POST', conv(`/${runId}/revert`), asBea());
  assert.strictEqual(pressed.status, 409);
  assert.strictEqual(pressed.json.code, 'RUN_BUSY');
  assert.match(pressed.json.error, /still saving/);
  await SurveyConversionRun.updateOne({ _id: runId }, { $set: { stepping: 0 } });
  assert.strictEqual((await call('POST', conv(`/${runId}/revert`), asBea())).status, 200);
});

test('G6: a step count a crash left behind is re-based, so the campaign is free once the next step ends', { skip }, async () => {
  const v = ctx.voters[7];
  assert.strictEqual((await survey(ctx.caraTok, v, 7, FAKE())).status, 201);
  const e = await visitEntry(7, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  const runId = opened.json.run.id;
  await SurveyConversionRun.updateOne({ _id: runId }, { $set: { stepping: 1, steppingAt: new Date(Date.now() - 3 * 60_000) } });
  let during;
  hookOnce(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    during = (await SurveyConversionRun.findById(runId).lean()).stepping;
    return real(...args);
  });
  assert.strictEqual((await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e._id) }))).status, 200);
  assert.strictEqual(during, 1, 'counted as the one step running, not on top of the stale count');
  assert.strictEqual((await SurveyConversionRun.findById(runId).lean()).stepping, 0);
  assert.strictEqual(await otherChangeRunning(ctx.campaign._id), null, 'nothing holds the campaign after it');
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/revert`), asAdmin())).status, 200);
});

test('G7: two Closes at once write one History row', { skip }, async () => {
  const v = ctx.voters[8];
  assert.strictEqual((await survey(ctx.caraTok, v, 8, FAKE())).status, 201);
  const e = await visitEntry(8, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  const runId = opened.json.run.id;
  assert.strictEqual((await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e._id) }))).status, 200);
  const since = new Date();
  const [a, b] = await Promise.all([call('POST', conv(`/${runId}/close`), asAdmin()), call('POST', conv(`/${runId}/close`), asBea())]);
  assert.deepStrictEqual([a.status, b.status], [200, 200]);
  assert.strictEqual(a.json.run.status, 'completed');
  assert.strictEqual(b.json.run.status, 'completed');
  assert.strictEqual((await historySince('surveyConversion', since)).length, 1);
  assert.strictEqual((await call('POST', conv(`/${runId}/revert`), asAdmin())).status, 200);
});

test('R-m2: an Undo puts answers back only under an entry still its own — never one a later conversion owns', { skip }, async () => {
  const v = ctx.voters[9];
  assert.strictEqual((await survey(ctx.caraTok, v, 9, FAKE())).status, 201);
  const e = await visitEntry(9, ctx.cara._id);
  // R1's step takes the answers, then stops before it flips the entry.
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  const r1 = opened.json.run.id;
  hookOnce(CanvassActivity, 'bulkWrite', async () => { throw new Error('connection dropped'); });
  assert.strictEqual((await call('POST', conv(`/${r1}/door`), asAdmin({ actionId: String(e._id) }))).status, 500);
  assert.strictEqual((await visitEntry(9, ctx.cara._id)).actionType, 'survey_submitted');
  assert.strictEqual(await liveOf(v), null);
  assert.strictEqual((await call('POST', conv(`/${r1}/close`), asAdmin())).status, 200);
  // R2 converts the same entry (its answers were already gone).
  const r2 = await convertDoorFromSurvey(e._id);
  assert.strictEqual(String((await visitEntry(9, ctx.cara._id)).reclassified.runId), String(r2));
  const undone = await call('POST', conv(`/${r1}/revert`), asAdmin());
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 1);
  assert.strictEqual(await liveOf(v), null, 'no survey under a door R2 says was Not home');
  assert.strictEqual((await Household.findById(ctx.homes[9]._id).lean()).status, 'not_home');
  assert.notStrictEqual((await Voter.findById(v._id).lean()).surveyStatus, 'surveyed', 'and the voter no longer reads surveyed');
  assert.strictEqual((await call('POST', conv(`/${r2}/revert`), asAdmin())).status, 200);
});

test('W2: an Undo pressed while the session\'s own step saves waits for it — the step\'s record stays, History stays in order', { skip }, async () => {
  const v = ctx.voters;
  const doors = [10, 11];
  for (const i of doors) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const ids = [];
  for (const d of doors) ids.push(String((await entryOf(v[d], ctx.cara._id))._id));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Elm St' }), actionIds: ids, mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  const post = (cur) => call('POST', edits(`/${runId}/response`), asAdmin({ responseId: cur.responseId, version: cur.version, answers: [supportRow(), signRow('yard_sign_delivered')] }));
  const s1 = await post(created.json.current);
  assert.strictEqual(s1.status, 200, JSON.stringify(s1.json));
  const inside = deferred();
  const release = deferred();
  hookAll(AnswerEditRunChunk.collection, 'updateOne', async (real, args) => {
    if (args[1]?.$inc?.stepRev) {
      inside.resolve();
      await release.p;
    }
    return real(...args);
  });
  const since = new Date();
  const s2 = post(s1.json.current);
  await inside.p;
  let closed;
  let pressed;
  try {
    closed = await call('POST', edits(`/${runId}/close`), asBea());
    pressed = await undoPressed(runId);
  } finally {
    release.resolve();
  }
  assert.strictEqual(closed.status, 200);
  assert.strictEqual(pressed.status, 409);
  assert.strictEqual(pressed.json.code, 'RUN_BUSY');
  assert.strictEqual((await s2).status, 200);
  while (pending.length) pending.pop()();
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  assert.ok(chunk.items.every((it) => it.a), 'both steps recorded their copies');
  // Pressed again once the step has saved: both surveys go back.
  const again = await undoPressed(runId);
  assert.strictEqual(again.status, 202, JSON.stringify(again.json));
  const out = await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
  assert.strictEqual(out.summary.putBack, 2);
  for (const d of doors) assert.deepStrictEqual(await signOf(v[d]), ['yard_sign_delivered', 'volunteer_request']);
  const rows = await CampaignChange.find({ campaignId: ctx.campaign._id, field: { $in: ['answerEdit', 'answerEditUndo'] }, createdAt: { $gte: since } }).sort({ createdAt: 1, _id: 1 }).lean();
  assert.deepStrictEqual(rows.map((r) => r.field), ['answerEdit', 'answerEdit', 'answerEditUndo'], 'the late step is logged before the undo');
});

// ── the writer and the undo (W1, W3, W4, W6, W7) ───────────────────────────────────────────────────

test('W1: two copies of one original at one moment — the one that never landed is read after the landed one, and goes', { skip }, async () => {
  const v = ctx.voters[13];
  assert.strictEqual((await survey(ctx.caraTok, v, 13, FAKE())).status, 201);
  // Edited by an admin before notes had their own stamp: the edit gives the note one (noteCarry), and
  // the survey put back carries it — read as the same as none.
  await SurveyResponse.collection.updateOne(
    { voterId: v._id },
    { $set: { editedBy: ctx.bea._id, editedAt: new Date(Date.now() - 5 * 3600_000) }, $unset: { noteEditedBy: '', noteEditedAt: '' } }
  );
  const original = await liveOf(v);
  const runId = await createTakeOutFor([13]);
  const jobId = await armApply(runId);
  // D2 builds its copy first and is held at its insert; D1 then inserts its own and dies at its write.
  const atInsert = deferred();
  const go = deferred();
  let inserts = 0;
  hookAll(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    inserts += 1;
    if (inserts === 1) {
      atInsert.resolve();
      await go.p;
    }
    return real(...args);
  });
  const d2 = applyJob(runId, jobId);
  await atInsert.p;
  let killed = false;
  hookAll(SurveyResponse.collection, 'updateOne', async (real, args) => {
    if (args[0]?.answerEditFence && !killed) {
      killed = true;
      throw new Error('worker killed');
    }
    return real(...args);
  });
  await assert.rejects(applyJob(runId, jobId), /worker killed/);
  go.resolve();
  await d2;
  while (pending.length) pending.pop()();
  const copies = await SurveyResponseArchive.collection.find({ answerEditRunId: new mongoose.Types.ObjectId(runId) }).toArray();
  assert.strictEqual(copies.length, 2, 'the landed copy and its never-landed twin');
  assert.strictEqual(copies[0].overwrittenAt.getTime(), copies[1].overwrittenAt.getTime());
  const since = new Date();
  const out = await runUndo(runId);
  assert.strictEqual(out.summary.putBack, 1);
  assert.strictEqual(out.summary.changedSince, 0);
  assert.deepStrictEqual((await liveOf(v)).answers, original.answers);
  assert.ok((await AnswerEditRunChunk.findOne({ runId }).lean()).items[0].u, 'the put-back is recorded');
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ answerEditRunId: runId }), 0, 'and the twin went with it');
  assert.deepStrictEqual((await historySince('answerEditUndo', since)).map((r) => r.toValue), ['1 survey put back']);
});

test('W3: Erase of a change\'s copy is no longer refused for good while that change has stopped responding', { skip }, async () => {
  const v = ctx.voters[14];
  assert.strictEqual((await survey(ctx.caraTok, v, 14, FAKE())).status, 201);
  const runId = await takeOutApplied(14);
  const [copy] = await copiesOf(v, 'answer_edit');
  // Still running, last heard from 30 minutes ago (its job is gone): the card says Stopped responding.
  await AnswerEditRun.collection.updateOne({ _id: new mongoose.Types.ObjectId(runId) }, { $set: { status: 'running', updatedAt: new Date(Date.now() - 30 * 60_000) } });
  const erased = await call('DELETE', `/admin/voters/${v._id}/surveys/archive/${copy._id}`, asAdmin());
  assert.strictEqual(erased.status, 200, JSON.stringify(erased.json));
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'completed' } });
  // One heard from a minute ago still holds its copies.
  await survey(ctx.caraTok, v, 14, FAKE());
  const runId2 = await takeOutApplied(14);
  const [copy2] = await SurveyResponseArchive.collection.find({ answerEditRunId: new mongoose.Types.ObjectId(runId2) }).toArray();
  await AnswerEditRun.collection.updateOne({ _id: new mongoose.Types.ObjectId(runId2) }, { $set: { status: 'running', updatedAt: new Date(Date.now() - 60_000) } });
  const refused = await call('DELETE', `/admin/voters/${v._id}/surveys/archive/${copy2._id}`, asAdmin());
  assert.strictEqual(refused.status, 409);
  assert.strictEqual(refused.json.code, 'COPY_IN_USE');
  await AnswerEditRun.updateMany({ _id: { $in: [runId, runId2] } }, { $set: { status: 'completed' } });
});

test('W4: an undo the first build began and that stopped inside its first pass is finished as one — its put-backs counted', { skip }, async () => {
  const v = ctx.voters;
  const doors = [15, 16, 17];
  for (const i of doors) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await createTakeOutFor(doors);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  // The first build put door 15 back (no receipt, copy deleted) and door 16 back (copy still on
  // file, stamped), then its pass died: no pass counted, no History row, no lastRunAt.
  const firstBuildPutBack = async (voter, deleteCopy) => {
    const live = await liveOf(voter);
    const [copy] = await copiesOf(voter, 'answer_edit');
    await SurveyResponseArchive.collection.updateOne({ _id: copy._id }, { $set: { undoStartedAt: new Date(Date.now() - 3600_000) } });
    await SurveyResponse.collection.updateOne(
      { _id: live._id },
      { $set: { answers: copy.answers, editedBy: copy.editedBy ?? null, editedAt: copy.editedAt ?? null, updatedAt: new Date() }, $pull: { answerEditMarks: copy._id } }
    );
    if (deleteCopy) await SurveyResponseArchive.collection.deleteOne({ _id: copy._id });
  };
  await firstBuildPutBack(v[15], true);
  await firstBuildPutBack(v[16], false);
  await AnswerEditRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    { $set: { 'undo.status': 'failed', 'undo.jobId': 'old-build-job', 'undo.startedAt': new Date(Date.now() - 3600_000), 'undo.passes': 0, 'undo.error': 'worker restarted' }, $unset: { 'undo.lastRunAt': '' } }
  );
  const since = new Date();
  // Retry undo through the route — it overwrites the status the first build left, and keeps the
  // reading on the run (round 5).
  const pressed = await undoPressed(runId);
  assert.strictEqual(pressed.status, 202, JSON.stringify(pressed.json));
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).undo.legacy, true);
  const out = await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
  assert.strictEqual(out.summary.putBack, 3);
  assert.strictEqual(out.summary.restoredOnProfile, 0);
  assert.deepStrictEqual((await historySince('answerEditUndo', since)).map((r) => r.toValue), ['3 surveys put back']);
  for (const i of doors) assert.deepStrictEqual(await signOf(v[i]), ['yard_sign_delivered', 'volunteer_request']);
});

test('W6: a survey put back counts as put back even when an older copy of the same change still holds', { skip }, async () => {
  const v = ctx.voters[18];
  assert.strictEqual((await survey(ctx.caraTok, v, 18, FAKE())).status, 201);
  const e = await entryOf(v, ctx.cara._id);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: '19 Elm St' }), actionIds: [String(e._id)], mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  const cur = created.json.current;
  // Saved once (A), changed on the profile meanwhile (A'), saved again from A' (B).
  const s1 = await call('POST', edits(`/${runId}/response`), asAdmin({ responseId: cur.responseId, version: cur.version, answers: [supportRow(), signRow('yard_sign_delivered')] }));
  assert.strictEqual(s1.status, 200, JSON.stringify(s1.json));
  await profileEdit(v, [supportRow(), signRow('yard_sign_delivered', 'candidate_follow_up')]);
  const now = (await profileOf(v)).json.surveys[0];
  const s2 = await call('POST', edits(`/${runId}/response`), asAdmin({ responseId: cur.responseId, version: now.version, answers: [supportRow(), signRow()] }));
  assert.strictEqual(s2.status, 200, JSON.stringify(s2.json));
  assert.strictEqual(s2.json.saved, true);
  assert.strictEqual((await call('POST', edits(`/${runId}/close`), asAdmin())).status, 200);
  const out = await runUndo(runId);
  assert.strictEqual(out.summary.putBack, 1, 'its last save was put back');
  assert.strictEqual(out.summary.changedSince, 0);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'candidate_follow_up'], 'back to the profile\'s answers');
  assert.ok((await AnswerEditRunChunk.findOne({ runId }).lean()).items[0].u);
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ answerEditRunId: runId }), 1, 'the older copy stays on the profile as history');
});

test('W7: a put-back whose copy and survey both left before it reads gone, never restored on the profile', { skip }, async () => {
  const v = ctx.voters[19];
  assert.strictEqual((await survey(ctx.caraTok, v, 19, FAKE())).status, 201);
  const runId = await takeOutApplied(19);
  hookOnce(SurveyResponseArchive.collection, 'updateOne', async (real, args) => {
    if (args[1]?.$set?.undoStartedAt) {
      await SurveyResponseArchive.collection.deleteOne({ _id: args[0]._id });
      await SurveyResponse.collection.deleteOne({ voterId: v._id });
    }
    return real(...args);
  });
  const out = await runUndo(runId);
  assert.strictEqual(out.summary.gone, 1);
  assert.strictEqual(out.summary.restoredOnProfile, 0);
});

// ── deletion (G2, G3) ───────────────────────────────────────────────────────────────────────────────

// An organization of its own, with its own admin, for a cascade to delete whole.
const doomedOrg = async (slug) => {
  const org = await Organization.create({ name: `Doomed ${slug}`, slug, isActive: true });
  const dora = await User.create({ firstName: 'Dora', lastName: `Doomed ${slug}`, email: `${slug}@t.co`, passwordHash: 'x', isActive: true });
  await Membership.create({ userId: dora._id, organizationId: org._id, role: 'admin', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Doomed Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({ organizationId: org._id, name: 'Doomed C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York', surveyTemplateId: template._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'E' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const entryIds = [];
  for (let i = 0; i < 3; i += 1) {
    const home = await Household.create({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id, addressLine1: `${i + 1} Doom St`, city: 'T', state: 'FL',
      zipCode: '33540', normalizedAddress: `DOOM${slug}${i}`, location: { type: 'Point', coordinates: [-82, 28] }, isActive: true, status: 'surveyed',
    });
    const voter = await Voter.create({ organizationId: org._id, campaignId: campaign._id, householdId: home._id, stateVoterId: `DOOM-${slug}-${i}`, firstName: 'D', lastName: `${i}`, fullName: `Doom ${i}` });
    const at = new Date(Date.now() - 3600_000 + i * 60_000);
    const a = await CanvassActivity.create({
      organizationId: org._id, campaignId: campaign._id, householdId: home._id, voterId: voter._id, userId: ctx.cara._id, actionType: 'survey_submitted',
      location: { lat: 28, lng: -82, accuracy: 6 }, timestamp: at, passId: pass._id, effortId: effort._id,
    });
    await SurveyResponse.collection.insertOne({
      organizationId: org._id, campaignId: campaign._id, householdId: home._id, voterId: voter._id, userId: ctx.cara._id, passId: pass._id,
      surveyTemplateId: template._id, submittedAt: at, answers: FAKE(), createdAt: at, updatedAt: at,
    });
    entryIds.push(String(a._id));
  }
  return { org, campaign, entryIds, token: signUserToken(dora) };
};
const callIn = async (orgId, token, method, path, body) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Org-Id': String(orgId) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const { processOrgDeleteJob } = await import('../src/services/platform/deleteOrgProcessor.js');
const leftOf = async (org) => ({
  conversions: await SurveyConversionRun.countDocuments({ organizationId: org._id }),
  edits: await AnswerEditRun.countDocuments({ organizationId: org._id }),
  chunks: await AnswerEditRunChunk.countDocuments({ organizationId: org._id }),
});
// Delete the organization while `request` is held at `holdAt`; then let the request finish.
const deleteWhileInFlight = async (org, holdAt, request) => {
  const reached = deferred();
  const release = deferred();
  holdAt(reached, release);
  const answer = request();
  await reached.p;
  await Organization.updateOne({ _id: org._id }, { $set: { deletion: { requestedAt: new Date(), requestedBy: ctx.admin._id, source: 'break_glass', status: 'pending' } } });
  const prevWait = process.env.DOOR_OUTCOMES_DELETE_WAIT_MS;
  process.env.DOOR_OUTCOMES_DELETE_WAIT_MS = '300';
  try {
    await processOrgDeleteJob({ data: { organizationId: String(org._id), source: 'break_glass' } });
  } finally {
    if (prevWait === undefined) delete process.env.DOOR_OUTCOMES_DELETE_WAIT_MS;
    else process.env.DOOR_OUTCOMES_DELETE_WAIT_MS = prevWait;
    release.resolve();
  }
  assert.strictEqual(await Organization.findById(org._id).lean(), null, 'the organization is gone');
  return answer;
};
// The create's read of the organization's billing setting comes after its checks and before its run.
const holdOrgRead = (reached, release) =>
  hookAll(Organization, 'findById', (real, args) => {
    if (args[1] && args[1].billRestrictedDoors === 1) {
      return { lean: () => (async () => { reached.resolve(); await release.p; return real(...args).lean(); })() };
    }
    return real(...args);
  });

for (const mode of ['bulk', 'queue']) {
  test(`G2: a ${mode} conversion created while its organization is deleted leaves nothing behind`, { skip }, async () => {
    const d = await doomedOrg(`r4-g2-conv-${mode}`);
    const created = await deleteWhileInFlight(d.org, holdOrgRead, () =>
      callIn(d.org._id, d.token, 'POST', `/admin/campaigns/${d.campaign._id}/survey-conversions`, { direction: 'from_survey', to: 'not_home', mode, actionIds: d.entryIds })
    );
    while (pending.length) pending.pop()();
    assert.strictEqual(created.status, 409, JSON.stringify(created.json));
    assert.strictEqual(created.json.code, 'campaign-deleting');
    assert.deepStrictEqual(await leftOf(d.org), { conversions: 0, edits: 0, chunks: 0 });
  });
}

test('G2: a one-person answer edit started while its organization is deleted leaves no run, no chunk, no canvasser name', { skip }, async () => {
  const d = await doomedOrg('r4-g2-edit');
  const body = { mode: 'queue', scope: scopeFor(ctx.cara._id) };
  const dry = await callIn(d.org._id, d.token, 'POST', `/admin/campaigns/${d.campaign._id}/answer-edits`, { ...body, dryRun: true });
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  // describeScope's look-up of the canvasser's name comes before the run goes in.
  const holdNameRead = (reached, release) =>
    hookAll(User, 'findById', (real, args) => {
      const p = real(...args);
      if (args[1] && args[1].firstName === 1 && String(args[0]) === String(ctx.cara._id)) {
        return { lean: () => (async () => { reached.resolve(); await release.p; return p.lean(); })() };
      }
      return p;
    });
  const created = await deleteWhileInFlight(d.org, holdNameRead, () =>
    callIn(d.org._id, d.token, 'POST', `/admin/campaigns/${d.campaign._id}/answer-edits`, {
      ...body, dryRun: false, digest: dry.json.digest, asOf: dry.json.asOf, templateVersion: dry.json.template.version,
    })
  );
  while (pending.length) pending.pop()();
  assert.strictEqual(created.status, 409, JSON.stringify(created.json));
  assert.deepStrictEqual(await leftOf(d.org), { conversions: 0, edits: 0, chunks: 0 });
});

test('G2: a conversion job whose campaign is gone takes its run with it', { skip }, async () => {
  const goneCampaign = new mongoose.Types.ObjectId();
  const run = await SurveyConversionRun.create({
    organizationId: ctx.org._id, campaignId: goneCampaign, byUserId: ctx.admin._id, direction: 'from_survey', mode: 'bulk', to: 'not_home',
    sources: ['survey_submitted'], status: 'pending', queueJobId: 'outcome-convert-gone', selection: { actionIds: [] }, counts: { entriesTargeted: 0 },
  });
  await assert.rejects(processConversionJob({ id: 'outcome-convert-gone', name: 'convert', data: { runId: String(run._id) }, updateProgress: async () => {} }), /Campaign no longer exists/);
  assert.strictEqual(await SurveyConversionRun.findById(run._id).lean(), null);
});

test('G2: a relabel that writes while its organization is being deleted is swept with it', { skip }, async () => {
  const d = await doomedOrg('r4-g2-relabel');
  const campaign = await Campaign.findById(d.campaign._id).lean();
  // Its cascade has begun: running, and its capture has banked the org's lifetime numbers — the mark
  // the late sweep waits for (lateWriteSweep.js).
  await Organization.updateOne({ _id: d.org._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'running', platformStatsCaptured: true } });
  await CanvassActivity.updateMany({ campaignId: campaign._id }, { $set: { actionType: 'not_home', voterId: null } });
  await runReclassify({ campaign, from: 'not_home', to: 'wrong_address', byUserId: ctx.admin._id });
  assert.strictEqual(await ReclassifyRun.countDocuments({ organizationId: d.org._id }), 0);
  assert.strictEqual(await CampaignChange.countDocuments({ organizationId: d.org._id }), 0);
  await Organization.deleteOne({ _id: d.org._id });
});

test('G3: a campaign delete claimed but refused (canvassing started) sweeps nothing — writers sweep only once its cascade began', { skip }, async () => {
  const campaign = await Campaign.create({ organizationId: ctx.org._id, name: 'Refused delete', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' });
  const home = await Household.create({
    organizationId: ctx.org._id, campaignId: campaign._id, addressLine1: '1 Kept Rd', city: 'T', state: 'FL', zipCode: '33540',
    normalizedAddress: 'KEPT1', location: { type: 'Point', coordinates: [-82, 28] }, isActive: true, status: 'not_home',
  });
  await CanvassActivity.create({ organizationId: ctx.org._id, campaignId: campaign._id, householdId: home._id, userId: ctx.cara._id, actionType: 'not_home', location: { lat: 28, lng: -82, accuracy: 6 }, timestamp: new Date() });
  const kept = await CampaignChange.create({ organizationId: ctx.org._id, campaignId: campaign._id, field: 'unknock', fromValue: 'recorded', toValue: 'unknocked', source: 'unknock' });
  await Campaign.updateOne({ _id: campaign._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'pending' } });
  await assert.rejects(processCampaignDeleteJob({ data: { campaignId: String(campaign._id) } }), /Canvassing started/);
  const after = await Campaign.findById(campaign._id).lean();
  assert.strictEqual(after.deletion.cascadeAt, null, 'its cascade never began');
  // A writer finishing in the gap while the processor still read `running`:
  await Campaign.updateOne({ _id: campaign._id }, { $set: { 'deletion.status': 'running' } });
  assert.strictEqual(await sweepIfDeleting({ campaignId: campaign._id, organizationId: ctx.org._id }), false);
  assert.ok(await CampaignChange.findById(kept._id).lean(), 'its Door Outcomes history stays');
  // Once the cascade has begun, a late write is swept.
  await Campaign.updateOne({ _id: campaign._id }, { $set: { 'deletion.cascadeAt': new Date() } });
  assert.strictEqual(await sweepIfDeleting({ campaignId: campaign._id, organizationId: ctx.org._id }), true);
  assert.strictEqual(await CampaignChange.findById(kept._id).lean(), null);
  await Promise.all([Campaign.deleteOne({ _id: campaign._id }), Household.deleteOne({ _id: home._id })]);
});

// ── the deploy window (G4) ─────────────────────────────────────────────────────────────────────────

test('G4: a Pick up the previous build queued runs — its run still held the stopped job\'s id', { skip }, async () => {
  const v = ctx.voters[20];
  assert.strictEqual((await survey(ctx.caraTok, v, 20, FAKE())).status, 201);
  const e = await visitEntry(20, ctx.cara._id);
  const unstub = stubQueue(QUEUE_NAMES.OUTCOME_CONVERT);
  const created = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'bulk', actionIds: [String(e._id)] }));
  unstub();
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  // The previous build's Pick up: pending again, still under the stopped job's BullMQ id until its save.
  await SurveyConversionRun.updateOne({ _id: runId }, { $set: { status: 'pending', queueJobId: '40' } });
  const stale = await processConversionJob({ id: 'outcome-convert-not-this-one', name: 'convert', data: { runId }, updateProgress: async () => {} });
  assert.strictEqual(stale.skipped, 'not-claimable', 'a job of this build runs only under its own id');
  const out = await processConversionJob({ id: '41', name: 'convert', data: { runId }, updateProgress: async () => {} });
  assert.strictEqual(out.status, 'completed');
  assert.strictEqual((await visitEntry(20, ctx.cara._id)).actionType, 'not_home');
  assert.strictEqual((await call('POST', conv(`/${runId}/revert`), asAdmin())).status, 200);
});

// ── Restore (R-m1) ────────────────────────────────────────────────────────────────────────────────

test('R-m1: a copy two removals hold stays held while either does — a later one\'s undo stopping after its flip unlocks nothing', { skip }, async () => {
  const d = 21;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201); // Cara's fake
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [supportRow()])).status, 201); // Otto's: Cara's -> a copy
  const c1 = (await copiesOf(v, 'submit')).find((c) => String(c.userId) === String(ctx.cara._id));
  assert.ok(c1);
  const e1 = await visitEntry(d, ctx.cara._id);
  const s1 = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e1._id)] }));
  assert.strictEqual(s1.status, 201, JSON.stringify(s1.json));
  const real = [supportRow(), signRow('yard_sign_delivered')];
  assert.strictEqual((await survey(ctx.caraTok, v, d, real)).status, 201); // Cara back, for real
  const e2 = await visitEntry(d, ctx.cara._id);
  const s2 = await convertDoorFromSurvey(e2._id);
  // S2's undo stops after it flipped the entry back: at its record of what it couldn't put back (the
  // second read of its strike records' visits — the first finds the doors to settle).
  let reads = 0;
  hookAll(ConversionStrike, 'find', (realFind, args) => {
    if (args[1]?.visitKeys && ++reads === 2) throw new Error('connection dropped');
    return realFind(...args);
  });
  const u = await call('POST', conv(`/${s2}/revert`), asAdmin());
  while (pending.length) pending.pop()();
  assert.strictEqual(u.status, 500);
  assert.strictEqual((await visitEntry(d, ctx.cara._id)).actionType, 'survey_submitted');
  const restore = await restoreCopy(v, c1._id);
  assert.strictEqual(restore.status, 409, JSON.stringify(restore.json));
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered'], 'the real survey stays');
  assert.strictEqual((await call('POST', conv(`/${s2}/revert`), asAdmin())).status, 200, 'Retry undo finishes it');
});

// ── the one-time console step (G5, R-m3, R-m5) ──────────────────────────────────────────────────

const backfill = async (apply) => {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('node', ['src/migrations/backfillRemovalStrikes.js', ...(apply ? ['--apply'] : [])], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, MONGODB_URI: URI },
    encoding: 'utf8',
  });
};

test('G5: an older unknock undo that DID put a visit back, re-recorded since, is not held as "kept after undo"', { skip }, async () => {
  const [d1, d2] = [24, 25];
  const v1 = ctx.voters[d1];
  assert.strictEqual((await survey(ctx.caraTok, v1, d1, FAKE())).status, 201);
  assert.strictEqual((await survey(ctx.ottoTok, v1, d1, [supportRow()])).status, 201); // C1 = Cara's, at her d1 visit
  const c1 = (await copiesOf(v1, 'submit')).find((c) => String(c.userId) === String(ctx.cara._id));
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d2], d2, FAKE())).status, 201);
  const ids = [String((await visitEntry(d1, ctx.cara._id))._id), String((await visitEntry(d2, ctx.cara._id))._id)];
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: ids }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  assert.strictEqual((await notHome(ctx.caraTok, d2)).status, 201); // newer work holds d2
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(undone.json.run.counts.rowsNotRestored, 1);
  // An undo from before the record of what it couldn't put back...
  await UnknockRunChunk.collection.updateMany({ runId: new mongoose.Types.ObjectId(struck.json.run.id) }, { $unset: { notRestoredKeys: '' } });
  // ...and weeks later Cara records d1 again: the entry the undo put back is replaced.
  assert.strictEqual((await notHome(ctx.caraTok, d1)).status, 201);
  assert.strictEqual((await survey(ctx.caraTok, v1, d1, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  await backfill(true);
  const keys = (await UnknockRunChunk.find({ runId: struck.json.run.id }).lean()).flatMap((c) => c.notRestoredKeys);
  assert.deepStrictEqual(keys, [`${ctx.homes[d2]._id}|${ctx.pass._id}|${ctx.cara._id}`], 'only the visit newer work held');
  const [state] = [...(await restoreStates([await SurveyResponseArchive.collection.findOne({ _id: c1._id })])).values()];
  assert.notStrictEqual(state.reason, 'kept_after_undo');
});

test('R-m3: an older undone conversion\'s visit whose entry came back (its slot held by a teammate) is not marked not put back', { skip }, async () => {
  const [d1, d2] = [26, 27];
  for (const d of [d1, d2]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e1 = await visitEntry(d1, ctx.cara._id);
  const e2 = await visitEntry(d2, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e1._id), String(e2._id)] }));
  const runId = opened.json.run.id;
  for (const e of [e1, e2]) assert.strictEqual((await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e._id) }))).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  // Otto surveys d1's voter meanwhile: the undo brings d1's entry back but can't put its answers back.
  assert.strictEqual((await survey(ctx.ottoTok, ctx.voters[d1], d1, [supportRow()])).status, 201);
  const undone = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 1);
  // d1's visit converted before strike records existed (the deploy window): its record is gone.
  const key1 = `${ctx.homes[d1]._id}|${ctx.pass._id}|${ctx.cara._id}`;
  await ConversionStrike.deleteMany({ runId, visitKeys: key1 });
  await backfill(true);
  const records = await ConversionStrike.find({ runId }).lean();
  assert.ok(!records.some((r) => (r.notRestoredKeys || []).includes(key1)), 'its entry came back: the strike there was lifted');
});

test('R-m5: an unknock that stopped part-way before the stamp existed is marked as one — Restore holds it and its Undo is offered', { skip }, async () => {
  const d = 28;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  hookAll(UnknockRun.collection, 'updateOne', async (real, args) => {
    if (args[1]?.$set?.status === 'completed') throw new Error('dyno restarted');
    return real(...args);
  });
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  while (pending.length) pending.pop()();
  assert.strictEqual(struck.status, 500);
  const run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  // As the first build left it: no mark, no beat, long ago.
  const longAgo = new Date(Date.now() - 3 * 3600_000);
  await UnknockRun.collection.updateOne({ _id: run._id }, { $set: { createdAt: longAgo }, $unset: { deletingAt: '', heartbeatAt: '' } });
  await SurveyResponseArchive.collection.updateMany({ unknockRunId: run._id }, { $set: { overwrittenAt: new Date(longAgo.getTime() + 1000) } });
  assert.strictEqual((await listedUnknock(run._id)).stoppedPartWay, false);
  const dry = await backfill(false);
  assert.match(dry, /stopped part-way before the stamp existed: 1 of 1 unfinished — would mark/);
  await backfill(true);
  assert.ok((await UnknockRun.findById(run._id).lean()).deletingAt);
  assert.strictEqual((await listedUnknock(run._id)).stoppedPartWay, true);
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.ok(await visitEntry(d, ctx.cara._id));
  assert.ok(await liveOf(v));
});

// ── what a review prices, and how long it may take (P-M1, P-M2, P-m3, P-m4) ─────────────────────────

// A gate question and its follow-up — asked only after Yes or Maybe, as a Script flow's routes compile.
const GATE_QUESTIONS = [
  {
    key: 'gate', label: 'Will you vote?', type: 'single_choice', order: 0,
    options: [{ id: 'yes', text: 'Yes', tag: 'Voting', order: 0 }, { id: 'maybe', text: 'Maybe', order: 1 }, { id: 'no', text: 'No', order: 2 }],
  },
  {
    key: 'follow', label: 'How will you vote?', type: 'multiple_choice', order: 1,
    visibleIf: { logic: 'any', rules: [{ questionKey: 'gate', op: 'any_of', optionIds: ['yes', 'maybe'] }] },
    options: [{ id: 'mail', text: 'By mail', tag: 'Mail voter', order: 0 }, { id: 'early', text: 'Early', order: 1 }],
  },
];
const GATE_TEXT = { yes: 'Yes', maybe: 'Maybe', no: 'No', mail: 'By mail', early: 'Early' };
const gateRow = (id) => ({ questionKey: 'gate', questionLabel: 'Will you vote?', answer: GATE_TEXT[id], optionIds: [id] });
const followRow = (...ids) => ({ questionKey: 'follow', questionLabel: 'How will you vote?', answer: ids.map((i) => GATE_TEXT[i]), optionIds: ids });
let gateTemplate = null;
// Otto's surveys under the gate survey at these doors: [[door, answers]] -> their entry ids.
const gateSurveys = async (rows) => {
  if (!gateTemplate) gateTemplate = await SurveyTemplate.create({ organizationId: ctx.org._id, name: 'Gate Survey', version: 1, isActive: true, questions: GATE_QUESTIONS });
  const ids = [];
  for (const [door, answers] of rows) {
    const at = new Date(Date.now() - 10 * 3600_000 + door * 60_000);
    const voter = ctx.voters[door];
    const a = await CanvassActivity.create({
      organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[door]._id, voterId: voter._id, userId: ctx.otto._id,
      actionType: 'survey_submitted', location: { lat: 28.2, lng: -82.1 + door * 0.001, accuracy: 6 }, timestamp: at, passId: ctx.pass._id,
    });
    await SurveyResponse.collection.insertOne({
      organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[door]._id, voterId: voter._id, userId: ctx.otto._id,
      passId: ctx.pass._id, surveyTemplateId: gateTemplate._id, submittedAt: at, answers, createdAt: at, updatedAt: at,
    });
    ids.push(String(a._id));
  }
  return ids;
};
const gateResults = async () => {
  const r = await call('GET', `/admin/reports/survey-results?campaignId=${ctx.campaign._id}&surveyTemplateId=${gateTemplate._id}`, asAdmin());
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const questions = Object.fromEntries(r.json.questions.map((q) => [q.key, Object.fromEntries((q.options || []).map((o) => [o.id || o.option, o.count]))]));
  const tags = Object.fromEntries((r.json.tags || []).map((t) => [t.tag, { identified: t.voterCount, current: t.currentVoterCount }]));
  return { questions, tags };
};
const gateBody = (ids, plan) => ({ scope: scopeFor(ctx.otto._id), actionIds: ids, surveyTemplateId: String(gateTemplate._id), plan });
// The review's after, against what lands.
const assertPreviewLands = async (price, runId) => {
  await runApply(runId);
  const landed = await gateResults();
  for (const q of price.results) {
    for (const o of q.options) assert.strictEqual(landed.questions[q.questionKey]?.[o.id] || 0, o.after, `${q.questionKey}/${o.id}: preview == landed`);
  }
  for (const t of price.tags) {
    assert.strictEqual(landed.tags[t.tag]?.identified || 0, t.identified.after, `${t.tag} identified: preview == landed`);
    assert.strictEqual(landed.tags[t.tag]?.current || 0, t.current.after, `${t.tag} current: preview == landed`);
  }
};

test('P-M1, P-m4: a gate answer changed so its follow-up drops — the follow-up and its tag priced after the scan, every row of it, exactly as it lands', { skip }, async () => {
  const ids = await gateSurveys([
    [40, [gateRow('yes'), followRow('mail')]],
    [41, [gateRow('yes'), followRow('mail'), followRow('mail')]], // the follow-up held twice (an old shape)
    [42, [gateRow('maybe'), followRow('early')]],
    [43, [gateRow('no')]],
  ]);
  const before = await gateResults();
  assert.strictEqual(before.questions.follow.mail, 3);
  const plan = [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }];
  const { dry, created } = await reviewAndCreate(gateBody(ids, plan));
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  const { price } = dry.json;
  assert.strictEqual(price.surveysChanged, 3);
  assert.strictEqual(price.tagsUnavailable, false);
  const follow = price.results.find((r) => r.questionKey === 'follow');
  assert.deepStrictEqual(follow.options.map((o) => [o.id, o.before, o.after]), [['mail', 3, 0], ['early', 1, 0]], 'both of the doubled rows priced out');
  const mail = price.tags.find((t) => t.tag === 'Mail voter');
  assert.deepStrictEqual([mail.identified.before, mail.identified.after], [2, 0], 'the follow-up\'s tag, never priced up front, is priced');
  await assertPreviewLands(price, created.json.run.id);
  await runUndo(created.json.run.id);
});

test('P-M1: a gate answer changed so its follow-up stays asked prices only what moved, and lands as previewed', { skip }, async () => {
  const ids = await gateSurveys([
    [44, [gateRow('yes'), followRow('mail')]],
    [45, [gateRow('yes'), followRow('early')]],
  ]);
  const plan = [{ questionKey: 'gate', op: 'set', optionIds: ['maybe'] }];
  const { dry, created } = await reviewAndCreate(gateBody(ids, plan));
  const { price } = dry.json;
  assert.deepStrictEqual(price.results.map((r) => r.questionKey), ['gate']);
  assert.deepStrictEqual(price.dropped, []);
  assert.deepStrictEqual(price.tags.map((t) => t.tag), ['Voting']);
  await assertPreviewLands(price, created.json.run.id);
  await runUndo(created.json.run.id);
});

test('P-m3: a pick stored twice in one row counts as one survey that had it', { skip }, async () => {
  const ids = await gateSurveys([[46, [gateRow('yes'), { questionKey: 'follow', questionLabel: 'How will you vote?', answer: ['By mail', 'By mail'] }]]]);
  const plan = [{ questionKey: 'follow', op: 'adjust', remove: ['mail'] }];
  const { dry, created } = await reviewAndCreate(gateBody(ids, plan));
  const follow = dry.json.price.byQuestion.find((q) => q.questionKey === 'follow');
  assert.deepStrictEqual(follow.removed.map((r) => [r.label, r.surveys]), [['By mail', 1]]);
  assert.strictEqual(follow.multi, 0, 'one pick, not "more than one"');
  await assertPreviewLands(dry.json.price, created.json.run.id);
  await runUndo(created.json.run.id);
});

const withEnv = async (vars, fn) => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('P-M2: past its tag budget a review says the tags can\'t be previewed; past its whole budget it refuses — never a guess', { skip }, async () => {
  const ids = await gateSurveys([[47, [gateRow('yes'), followRow('mail')]]]);
  const body = { ...gateBody(ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]), dryRun: true };
  const noTagTime = await withEnv({ ANSWER_EDIT_TAG_BUDGET_MS: '1' }, () => call('POST', edits(), asAdmin(body)));
  assert.strictEqual(noTagTime.status, 200, JSON.stringify(noTagTime.json));
  assert.strictEqual(noTagTime.json.price.tagsUnavailable, true);
  assert.deepStrictEqual(noTagTime.json.price.tags, []);
  assert.ok(noTagTime.json.price.results.length, 'the results are still priced');
  const noTime = await withEnv({ ANSWER_EDIT_REVIEW_BUDGET_MS: '1' }, () => call('POST', edits(), asAdmin(body)));
  assert.strictEqual(noTime.status, 503, JSON.stringify(noTime.json));
  assert.strictEqual(noTime.json.code, 'REVIEW_TOO_SLOW');
});

test('P-M2: every read a review sends the database carries the time it has left, so the database stops when the review does', { skip }, async () => {
  const ids = await gateSurveys([[48, [gateRow('yes'), followRow('mail')]], [49, [gateRow('yes'), followRow('early')]]]);
  const body = { ...gateBody(ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]), dryRun: true };
  const seen = [];
  const client = mongoose.connection.getClient();
  const listen = (ev) => {
    const c = ev.command;
    if (c.find === 'surveyresponses' || c.aggregate === 'surveyresponses' || (c.aggregate === 1 && c.pipeline?.[0]?.$documents)) seen.push(c);
  };
  client.on('commandStarted', listen);
  let r;
  try {
    r = await call('POST', edits(), asAdmin(body));
  } finally {
    client.off('commandStarted', listen);
  }
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.ok(seen.length >= 5, `the review's reads were seen (${seen.length})`);
  const untimed = seen.filter((c) => !(c.maxTimeMS > 0 && c.maxTimeMS <= 25_000));
  assert.deepStrictEqual(untimed.map((c) => c.find || c.aggregate), [], 'every one carries maxTimeMS');
});

test('P-M2: the same review pressed twice at once is worked out once, and both presses get its answer', { skip }, async () => {
  const ids = await gateSurveys([[50, [gateRow('yes'), followRow('mail')]], [51, [gateRow('maybe'), followRow('early')]]]);
  const body = { ...gateBody(ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]), dryRun: true };
  let scans = 0;
  const client = mongoose.connection.getClient();
  const listen = (ev) => {
    if (ev.command.find === 'surveyresponses' && ev.command.projection?.editedBy === 1) scans += 1;
  };
  client.on('commandStarted', listen);
  let a;
  let b;
  try {
    [a, b] = await Promise.all([call('POST', edits(), asAdmin(body)), call('POST', edits(), asBea(body))]);
  } finally {
    client.off('commandStarted', listen);
  }
  assert.deepStrictEqual([a.status, b.status], [200, 200]);
  assert.strictEqual(scans, 1, 'one scan of the surveys for both presses');
  assert.strictEqual(a.json.digest, b.json.digest);
  assert.strictEqual(a.json.asOf, b.json.asOf, 'the joined press answers with the review it joined');
  // A different review afterwards runs on its own.
  const other = await call('POST', edits(), asAdmin({ ...body, plan: [{ questionKey: 'gate', op: 'set', optionIds: ['maybe'] }] }));
  assert.strictEqual(other.status, 200);
  assert.notStrictEqual(other.json.digest, a.json.digest);
});

test('W5: a survey an unknock that stopped part-way still holds reads waiting on that unknock, with Undo again to finish', { skip }, async () => {
  const d = 29;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const runId = await takeOutApplied(d);
  const e = await visitEntry(d, ctx.cara._id);
  hookAll(UnknockRun.collection, 'updateOne', async (real, args) => {
    if (args[1]?.$set?.status === 'completed') throw new Error('dyno restarted');
    return real(...args);
  });
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  while (pending.length) pending.pop()();
  assert.strictEqual(struck.status, 500);
  const unk = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  await silence(unk._id);
  const out = await runUndo(runId);
  assert.strictEqual(out.summary.waiting, 1, 'held by the unknock, not gone');
  assert.strictEqual(out.summary.gone, 0);
  // That unknock's Undo brings the edited survey back; the edit's Undo again then finishes.
  assert.strictEqual((await call('POST', unknocks('/revert'), asAdmin({ runId: String(unk._id) }))).status, 200);
  const again = await runUndo(runId);
  assert.strictEqual(again.summary.putBack, 1);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request']);
});
