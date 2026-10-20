import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Code review round 6 of Edit answers on Door Outcomes (2026-10-20), each finding pinned against the
// REAL app + a throwaway mongod — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §V. Most are the reviewers' own
// reproductions, asserting what the fix does:
//   npm run test:int -- test/answerEditRound6.int.test.js
//
// Redis points at a dead port, as everywhere here: a create or an undo answers 503 when it can't
// reach the queue, and the tests drive the REAL processors with the job id the run carries.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-r6';
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
const { processAnswerEditJob, reconcileFailedAnswerEditJob } = await import('../src/services/canvass/answerEditRuns.js');
const { restoreStates } = await import('../src/services/surveys/restoreGuard.js');
const { getQueue, QUEUE_NAMES } = await import('../src/queues/index.js');
const { unknockHistoryRowId } = await import('../src/services/canvass/unknockLease.js');
const { doorKey } = await import('../src/services/canvass/doorKey.js');
const { processConversionJob, reconcileFailedConversionJob } = await import('../src/services/canvass/conversionProcessor.js');
const { MongoBulkWriteError, MongoNetworkError } = await import('mongodb');

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

  const org = await Organization.create({ name: 'Edit Org R6', slug: 'edit-org-r6', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'r6a@t.co', passwordHash: 'x', isActive: true });
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'r6b@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'r6c@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'r6o@t.co', passwordHash: 'x', isActive: true });
  for (const u of [admin, bea]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const otherTemplate = await SurveyTemplate.create({ organizationId: org._id, name: 'Other Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit R6', type: 'survey', state: 'FL', isActive: true,
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
const historySince = (field, since) =>
  CampaignChange.find({ campaignId: ctx.campaign._id, field, createdAt: { $gte: since } }).sort({ createdAt: 1 }).lean();

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
const undoPressed = async (runId) => {
  const unstub = stubQueue(QUEUE_NAMES.ANSWER_EDIT);
  try {
    return await call('POST', edits(`/${runId}/revert`), asAdmin());
  } finally {
    unstub();
  }
};
const profileOf = (voter) => call('GET', `/admin/voters/${voter._id}`, asAdmin());
const restoreCopy = (voter, archiveId) => call('POST', `/admin/voters/${voter._id}/surveys/${archiveId}/restore`, asAdmin());
const convertDoorFromSurvey = async (entryId) => {
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(entryId)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  assert.strictEqual((await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(entryId) }))).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  return runId;
};

const notHomeAt = (token, door) => call('POST', `/mobile/households/${ctx.homes[door]._id}/not-home`, { token, body: { location: near(door), timestamp: nextTs() } });
const listedUnknock = async (runId) => (await call('GET', unknocks(), asAdmin())).json.runs.find((r) => r.id === String(runId));


const eraseCopy = (voter, archiveId) => call('DELETE', `/admin/voters/${voter._id}/surveys/archive/${archiveId}`, asAdmin());
// The removal undos' claim on their copies (claimCopiesForWriteBack): the first updateMany that sets
// an undo token.
const isClaim = (args) => !!args[1]?.$set?.undoToken;








const backfill = async (apply) => {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('node', ['src/migrations/backfillRemovalStrikes.js', ...(apply ? ['--apply'] : [])], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, MONGODB_URI: URI },
    encoding: 'utf8',
  });
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
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


// The first build's put-back: the survey reads the copy again and its mark comes off, with no receipt;
// `deleteCopy` false leaves the copy on file, stamped, as a pass that died before deleting it did.
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


// A one-person session over one survey (created; its steps go through the route).
const openSession = async (d) => {
  const e = await entryOf(ctx.voters[d], ctx.cara._id);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: `${d + 1} Elm St` }), actionIds: [String(e._id)], mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  return { runId: created.json.run.id, current: created.json.current };
};
const step = async (runId, rid, answers) => {
  const cur = (await call('GET', edits(`/${runId}/response/${rid}`), asAdmin())).json.current;
  const r = await call('POST', edits(`/${runId}/response`), asAdmin({ responseId: rid, version: cur.version, answers }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.saved, true);
  return r;
};


const GATE_QUESTIONS = [
  {
    key: 'gate', label: 'Will you vote?', type: 'single_choice', order: 0,
    options: [{ id: 'yes', text: 'Yes', tag: 'Voting', order: 0 }, { id: 'maybe', text: 'Maybe', tag: 'Leaning', order: 1 }, { id: 'no', text: 'No', tag: 'Not voting', order: 2 }],
  },
  {
    key: 'follow', label: 'How will you vote?', type: 'multiple_choice', order: 1,
    visibleIf: { logic: 'any', rules: [{ questionKey: 'gate', op: 'any_of', optionIds: ['yes', 'maybe'] }] },
    options: ['mail', 'early', 'day', 'unsure'].map((id, order) => ({ id, text: id, tag: `Votes ${id}`, order })),
  },
];
const gateRow = (id) => ({ questionKey: 'gate', questionLabel: 'Will you vote?', answer: { yes: 'Yes', maybe: 'Maybe', no: 'No' }[id], optionIds: [id] });
const followRow = (...ids) => ({ questionKey: 'follow', questionLabel: 'How will you vote?', answer: ids, optionIds: ids });
const MANY_QUESTIONS = [
  { key: 'pick', label: 'Pick one', type: 'single_choice', order: 0, options: Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, text: `Tag ${i}`, tag: `Tag ${i}`, order: i })) },
];
const templates = {};
// Otto's surveys under one of these surveys at these doors: [[door, answers]] -> their entry ids.
const ottoSurveys = async (name, questions, rows) => {
  templates[name] ||= await SurveyTemplate.create({ organizationId: ctx.org._id, name, version: 1, isActive: true, questions });
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
      passId: ctx.pass._id, surveyTemplateId: templates[name]._id, submittedAt: at, answers, createdAt: at, updatedAt: at,
    });
    ids.push(String(a._id));
  }
  return ids;
};
const reviewBody = (name, ids, plan) => ({ scope: scopeFor(ctx.otto._id), actionIds: ids, surveyTemplateId: String(templates[name]._id), plan, dryRun: true });
// The review's scan of the surveys (answerEditScope.js readBatch).
const isScan = (q) => q.model?.modelName === 'SurveyResponse' && q._fields?.editedBy === 1;
// A tag's campaign-wide "identified" count (answerEditScope.js campaignTagCounts).
const isIdentifiedCount = (agg) => {
  const p = agg.pipeline();
  return agg.model()?.modelName === 'SurveyResponse' && p.length === 3 && p[1]?.$group?._id === '$voterId' && p[2]?.$count === 'n';
};
const hookProto = (proto, method, around) => {
  const real = proto[method];
  proto[method] = function (...args) {
    return around.call(this, (...a) => real.apply(this, a), args);
  };
  const restore = () => { proto[method] = real; };
  pending.push(restore);
  return restore;
};

// A failure of a whole insert as the driver reports it: a bulk error with NO write errors (a dropped
// connection, a stepdown, any top-level command error).
const driverFailure = () => new MongoBulkWriteError(new MongoNetworkError('connection 7 to 127.0.0.1:27017 closed'), { insertedCount: 0 });

// ── write-backs that fail (R-B1, R-M1) ───────────────────────────────────────────────────────────

test('R-B1, R-M1: an unknock Undo whose write-back fails outright keeps every copy and lets go of it — Undo again puts the answers back', { skip }, async () => {
  const doors = [1, 2];
  for (const d of doors) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const ids = [];
  for (const d of doors) ids.push(String((await visitEntry(d, ctx.cara._id))._id));
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: ids }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  hookOnce(SurveyResponse.collection, 'insertMany', async () => {
    throw driverFailure();
  });
  const failed = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(failed.status, 500, 'never read as nothing clashed');
  const after = await UnknockRun.findById(struck.json.run.id).lean();
  assert.notStrictEqual(after.status, 'reverted');
  for (const d of doors) {
    const copies = await copiesOf(ctx.voters[d], 'unknock');
    assert.strictEqual(copies.length, 1, 'the copy is kept');
    assert.strictEqual(copies[0].undoStartedAt ?? null, null, 'and let go — no ten-minute hold');
    assert.strictEqual(await liveOf(ctx.voters[d]), null);
  }
  assert.strictEqual((await listedUnknock(struck.json.run.id)).undoStopped, true, 'the row says the undo stopped');
  const again = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(again.status, 200, JSON.stringify(again.json));
  assert.strictEqual(again.json.run.counts.responsesNotRestored, 0);
  for (const d of doors) {
    assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request']);
    assert.strictEqual((await copiesOf(ctx.voters[d])).length, 0);
  }
});

test('R-B1: a write-back that reports success but wrote nothing deletes no copy — each copy goes only once its survey is read back', { skip }, async () => {
  const d = 36;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  hookOnce(SurveyResponse.collection, 'insertMany', async () => ({ acknowledged: true, insertedCount: 1 }));
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 1, 'counted not put back');
  const copies = await copiesOf(ctx.voters[d], 'unknock');
  assert.strictEqual(copies.length, 1, 'the copy is kept — restorable on the profile');
  assert.strictEqual(copies[0].undoStartedAt ?? null, null);
});

test('R-B1: an unknock Undo whose entries insert fails outright stops — it never reads undone with its entries off the record', { skip }, async () => {
  const d = 3;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  hookOnce(CanvassActivity.collection, 'insertMany', async () => {
    throw driverFailure();
  });
  const failed = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(failed.status, 500);
  assert.notStrictEqual((await UnknockRun.findById(struck.json.run.id).lean()).status, 'reverted');
  const again = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(again.status, 200, JSON.stringify(again.json));
  assert.strictEqual(again.json.run.counts.rowsNotRestored, 0);
  assert.ok(await visitEntry(d, ctx.cara._id));
  assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request']);
});

test('R-B1, R-M1: a Surveyed → Not home Undo whose write-back fails, or whose claim read fails, keeps and lets go of its copies — Retry undo puts them back', { skip }, async () => {
  const [d1, d2] = [4, 5];
  for (const d of [d1, d2]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  for (const [d, hook] of [
    [d1, () => hookOnce(SurveyResponse.collection, 'insertMany', async () => { throw driverFailure(); })],
    // The claim stamped, then its read of what it holds failed: the retry takes back its own claim.
    [d2, () => {
      let stamped = false;
      hookAll(SurveyResponseArchive.collection, 'updateMany', async (real, args) => {
        const out = await real(...args);
        if (isClaim(args)) stamped = true;
        return out;
      });
      hookAll(SurveyResponseArchive.collection, 'find', (real, args) => {
        if (stamped && args[0]?.undoToken) {
          stamped = false;
          throw new Error('connection dropped');
        }
        return real(...args);
      });
    }],
  ]) {
    const runId = await convertDoorFromSurvey((await visitEntry(d, ctx.cara._id))._id);
    hook();
    const failed = await call('POST', conv(`/${runId}/revert`), asAdmin());
    while (pending.length) pending.pop()();
    assert.strictEqual(failed.status, 500, `door ${d}`);
    assert.strictEqual((await SurveyConversionRun.findById(runId).lean()).status, 'revert_failed');
    assert.strictEqual(await liveOf(ctx.voters[d]), null);
    const retried = await call('POST', conv(`/${runId}/revert`), asAdmin());
    assert.strictEqual(retried.status, 200, JSON.stringify(retried.json));
    assert.strictEqual(retried.json.run.counts.responsesNotRestored, 0, `door ${d}: none stranded by its own claim`);
    assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request']);
    assert.strictEqual((await copiesOf(ctx.voters[d])).length, 0);
  }
});

test('R-B1: a Not home → Surveyed conversion whose desk answers fail to insert outright stops — no entry stamped Surveyed over answers never written', { skip }, async () => {
  const d = 6;
  assert.strictEqual((await notHomeAt(ctx.caraTok, d)).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({
    direction: 'to_survey', to: 'survey_submitted', mode: 'bulk', actionIds: [String(e._id)], answers: [supportRow()],
  }));
  assert.strictEqual(opened.status, 503, JSON.stringify(opened.json));
  const run = await SurveyConversionRun.findById(opened.json.run.id).lean();
  const jobId = `outcome-convert-r6-${run._id}`;
  await SurveyConversionRun.updateOne({ _id: run._id }, { $set: { status: 'pending', queueJobId: jobId, error: null } });
  hookOnce(SurveyResponse, 'insertMany', async () => {
    throw driverFailure();
  });
  const job = { id: jobId, name: 'convert', data: { runId: String(run._id) }, opts: { attempts: 1 }, attemptsMade: 0 };
  const err = await processConversionJob(job).then(() => null, (e) => e);
  assert.ok(err, 'the job fails');
  assert.strictEqual((await visitEntry(d, ctx.cara._id)).actionType, 'not_home', 'the entry is not stamped Surveyed');
  assert.strictEqual(await liveOf(ctx.voters[d]), null);
  assert.strictEqual((await SurveyConversionRun.findById(run._id).lean()).counts.responsesCreated || 0, 0);
  // Its last attempt failed: the worker's listener marks it failed (Pick up is the remedy), freeing the
  // campaign for the other removals.
  await reconcileFailedConversionJob({ ...job, attemptsMade: 1, finishedOn: Date.now() }, err);
  assert.strictEqual((await SurveyConversionRun.findById(run._id).lean()).status, 'failed');
});

// ── a strike that failed in process (R-B2) ──────────────────────────────────────────────────────

test('R-B2: a strike that failed after its deletes keeps holding the struck visit — a teammate\'s earlier copy can\'t be swapped over a real later survey', { skip }, async () => {
  const d = 7;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201); // Cara's fake
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [supportRow()])).status, 201); // Otto's: Cara's -> a copy
  const c1 = (await copiesOf(v, 'submit')).find((c) => String(c.userId) === String(ctx.cara._id));
  const e = await visitEntry(d, ctx.cara._id);
  hookAll(UnknockRun.collection, 'updateOne', async (real, args) => {
    if (args[1]?.$set?.status === 'completed') throw new Error('connection dropped');
    return real(...args);
  });
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  while (pending.length) pending.pop()();
  assert.strictEqual(struck.status, 500);
  const run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  assert.ok(run.stoppedAt, 'stopped, with the moment');
  assert.ok(run.heartbeatAt.getTime() > Date.now() - 60_000, 'its heartbeat is its last real beat');
  assert.strictEqual((await listedUnknock(run._id)).stoppedPartWay, true, 'Stopped part-way at once');
  // Cara surveys the voter for real at that visit.
  assert.strictEqual((await survey(ctx.caraTok, v, d, [supportRow(), signRow('yard_sign_delivered')])).status, 201);
  const refused = await restoreCopy(v, c1._id);
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
  assert.strictEqual(refused.json.reason, 'unknocked');
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered'], 'the real survey stays');
});

test('R-B2: an unknock undone after it stopped part-way holds the visit it couldn\'t put back up to the moment it stopped — not its freeze', { skip }, async () => {
  const d = 8;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  hookAll(UnknockRun.collection, 'updateOne', async (real, args) => {
    if (args[1]?.$set?.status === 'completed') throw new Error('connection dropped');
    return real(...args);
  });
  assert.strictEqual((await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }))).status, 500);
  while (pending.length) pending.pop()();
  const run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  // Cara records the visit again: the undo can't put the struck entry back there.
  assert.strictEqual((await notHomeAt(ctx.caraTok, d)).status, 201);
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  // A copy of the visit's answers made while the strike removed — after its freeze, before it stopped.
  const chunk = await UnknockRunChunk.findOne({ runId: run._id }).lean();
  const madeAt = new Date((chunk.frozenAt.getTime() + new Date((await UnknockRun.findById(run._id).lean()).stoppedAt).getTime()) / 2);
  const [own] = await copiesOf(v, 'unknock');
  const { _id, ...rest } = own;
  const teammate = await SurveyResponseArchive.collection.insertOne({
    ...rest, _id: new mongoose.Types.ObjectId(), overwrittenVia: 'submit', unknockRunId: undefined, overwrittenBy: ctx.otto._id, overwrittenAt: madeAt,
  });
  const [state] = [...(await restoreStates([await SurveyResponseArchive.collection.findOne({ _id: teammate.insertedId })])).values()];
  assert.deepStrictEqual(state, { restorable: false, reason: 'kept_after_undo' });
});

// ── an unknock's Undo and the strike that stopped at its archive (R-m2) ──────────────────────────

test('R-m2: an Undo of a strike that stopped before deleting the answers it copied counts them back, and leaves no duplicate copy', { skip }, async () => {
  const doors = [9, 10];
  for (const d of doors) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const ids = [];
  for (const d of doors) ids.push(String((await visitEntry(d, ctx.cara._id))._id));
  // The strike copies the answers and fails at their delete: they never left.
  hookOnce(SurveyResponse.collection, 'bulkWrite', async () => {
    throw new Error('connection dropped');
  });
  assert.strictEqual((await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: ids }))).status, 500);
  const run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 0, 'they are on file, never "not restored"');
  for (const d of doors) {
    assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request']);
    assert.strictEqual((await copiesOf(ctx.voters[d])).length, 0, 'no duplicate copy left on the profile');
  }
});

// ── unknocks and conversions wait for each other, and a later unknock keeps what it struck (G-M2, C-M1) ──

test('G-M2: the Undo of an unknock that stopped part-way leaves the answers a later unknock removed to it — that one\'s Undo brings them back', { skip }, async () => {
  const d = 11;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  // U1 copies the answers and fails at their delete.
  hookOnce(SurveyResponse.collection, 'bulkWrite', async () => {
    throw new Error('connection dropped');
  });
  assert.strictEqual((await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }))).status, 500);
  const u1 = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  // U2 unknocks the same entry: it takes the answers and fails at the entries' delete.
  hookOnce(CanvassActivity.collection, 'deleteMany', async () => {
    throw new Error('connection dropped');
  });
  assert.strictEqual((await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }))).status, 500);
  const u2 = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  assert.notStrictEqual(String(u2._id), String(u1._id));
  assert.strictEqual(await liveOf(v), null);
  const undone1 = await call('POST', unknocks('/revert'), asAdmin({ runId: String(u1._id) }));
  assert.strictEqual(undone1.status, 200, JSON.stringify(undone1.json));
  assert.strictEqual(await liveOf(v), null, 'U2 removed them and still stands');
  assert.strictEqual((await UnknockRun.findById(u2._id).lean()).revertedAt, null);
  assert.ok((await copiesOf(v, 'unknock')).every((c) => String(c.unknockRunId) === String(u2._id)), 'U1\'s copy is U2\'s now');
  const undone2 = await call('POST', unknocks('/revert'), asAdmin({ runId: String(u2._id) }));
  assert.strictEqual(undone2.status, 200, JSON.stringify(undone2.json));
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], 'U2\'s Undo puts them back');
  assert.strictEqual((await copiesOf(v)).length, 0);
});

test('C-M1: two overlapping unknocks undone earlier first put every survey back', { skip }, async () => {
  const doors = [12, 13, 14];
  for (const d of doors) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const ids = [];
  for (const d of doors) ids.push(String((await visitEntry(d, ctx.cara._id))._id));
  // U1 archives and deletes the answers, then fails at the entries' delete.
  hookOnce(CanvassActivity.collection, 'deleteMany', async () => {
    throw new Error('connection dropped');
  });
  assert.strictEqual((await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: ids }))).status, 500);
  const u1 = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  // The admin unknocks the rows still listed: U2 removes the entries.
  const u2 = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: ids }));
  assert.strictEqual(u2.status, 201, JSON.stringify(u2.json));
  assert.strictEqual((await call('POST', unknocks('/revert'), asAdmin({ runId: String(u1._id) }))).status, 200);
  // U1's copies are U2's to hold now — undoing U2 lifts them, so the refusal says so.
  const [held] = await copiesOf(ctx.voters[doors[0]], 'unknock');
  assert.strictEqual(String(held.unknockRunId), u2.json.run.id);
  const [state] = [...(await restoreStates([held])).values()];
  assert.deepStrictEqual(state, { restorable: false, reason: 'unknocked' });
  const undone2 = await call('POST', unknocks('/revert'), asAdmin({ runId: u2.json.run.id }));
  assert.strictEqual(undone2.status, 200, JSON.stringify(undone2.json));
  for (const d of doors) {
    assert.ok(await visitEntry(d, ctx.cara._id), `door ${d}: entry back`);
    assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request'], `door ${d}: survey back`);
  }
});

test('G-M2, C-M1: an unknock, its Undo, a conversion step and a conversion each wait while another removal still writes', { skip }, async () => {
  const [d1, d2, d3] = [15, 16, 17];
  for (const d of [d1, d2, d3]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e1 = await visitEntry(d1, ctx.cara._id);
  const e2 = await visitEntry(d2, ctx.cara._id);
  const e3 = await visitEntry(d3, ctx.cara._id);
  // A completed unknock of d3, to undo later.
  const done3 = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e3._id)] }));
  assert.strictEqual(done3.status, 201);
  // A door-by-door session on d2, open.
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e2._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  // An unknock of d1, held while it removes.
  const inside = deferred();
  const release = deferred();
  hookOnce(CanvassActivity.collection, 'deleteMany', async (real, args) => {
    inside.resolve();
    await release.p;
    return real(...args);
  });
  const strike = call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e1._id)] }));
  await inside.p;
  let second;
  let undo;
  let stepped;
  let created;
  try {
    second = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e1._id)] }));
    undo = await call('POST', unknocks('/revert'), asAdmin({ runId: done3.json.run.id }));
    stepped = await call('POST', conv(`/${opened.json.run.id}/door`), asAdmin({ actionId: String(e2._id) }));
    created = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e2._id)] }));
  } finally {
    release.resolve();
  }
  for (const [name, r] of [['a second unknock', second], ['an Undo', undo], ['a conversion step', stepped], ['a conversion', created]]) {
    assert.strictEqual(r.status, 409, `${name}: ${JSON.stringify(r.json)}`);
    assert.strictEqual(r.json.code, 'ANOTHER_CHANGE_RUNNING', name);
  }
  assert.strictEqual((await strike).status, 201);
  // Once it has landed, each goes ahead.
  assert.strictEqual((await call('POST', conv(`/${opened.json.run.id}/door`), asAdmin({ actionId: String(e2._id) }))).status, 200);
  assert.strictEqual((await call('POST', conv(`/${opened.json.run.id}/close`), asAdmin())).status, 200);
  assert.strictEqual((await call('POST', unknocks('/revert'), asAdmin({ runId: done3.json.run.id }))).status, 200);
});

test('G-M2: an unknock\'s Undo waits while a Surveyed → Not home step is still converting the same visit', { skip }, async () => {
  const d = 18;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  hookOnce(SurveyResponse.collection, 'bulkWrite', async () => {
    throw new Error('connection dropped');
  });
  assert.strictEqual((await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }))).status, 500);
  const u1 = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const inside = deferred();
  const release = deferred();
  hookOnce(CanvassActivity, 'bulkWrite', async (real, args) => {
    inside.resolve();
    await release.p;
    return real(...args);
  });
  const stepping = call('POST', conv(`/${opened.json.run.id}/door`), asAdmin({ actionId: String(e._id) }));
  await inside.p;
  let undo;
  try {
    undo = await call('POST', unknocks('/revert'), asAdmin({ runId: String(u1._id) }));
  } finally {
    release.resolve();
  }
  assert.strictEqual(undo.status, 409, JSON.stringify(undo.json));
  assert.strictEqual((await stepping).status, 200);
  assert.strictEqual((await call('POST', conv(`/${opened.json.run.id}/close`), asAdmin())).status, 200);
  const after = await call('POST', unknocks('/revert'), asAdmin({ runId: String(u1._id) }));
  assert.strictEqual(after.status, 200, JSON.stringify(after.json));
  assert.strictEqual(await liveOf(v), null, 'no answers under the Not home entry');
  assert.strictEqual((await visitEntry(d, ctx.cara._id)).actionType, 'not_home');
});

// ── an Undo that stopped part-way says so (C-M2) ─────────────────────────────────────────────────

test('C-M2: an unknock Undo that stopped part-way reads Undo stopped part-way, and Retry undo finishes it — doors settled, History once', { skip }, async () => {
  const d = 19;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  // It puts everything back and fails at its record of what it couldn't.
  hookOnce(UnknockRunChunk, 'updateOne', async () => {
    throw new Error('connection dropped');
  });
  const failed = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(failed.status, 500);
  const row = await listedUnknock(struck.json.run.id);
  assert.strictEqual(row.undoStopped, true);
  assert.strictEqual(row.undoing, false);
  assert.strictEqual(row.status, 'completed');
  const again = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(again.status, 200, JSON.stringify(again.json));
  const done = await listedUnknock(struck.json.run.id);
  assert.strictEqual(done.undoStopped, false);
  assert.strictEqual(done.status, 'reverted');
  assert.strictEqual((await Household.findById(ctx.homes[d]._id).lean()).status, 'surveyed');
  const rows = await CampaignChange.find({ campaignId: ctx.campaign._id, field: 'unknock', createdAt: { $gte: new Date(done.createdAt) } }).lean();
  assert.deepStrictEqual(rows.map((h) => h.toValue).sort(), ['recorded', 'unknocked']);
});

// ── an answer edit's undo (W-M1, W-M3, W-m4, W-m5) ────────────────────────────────────────────────

// A note-only Edit on the profile: same answers, a new note — it keeps its own copy, with its own mark.
const noteOnlyEdit = async (voter, note) => {
  const s0 = (await profileOf(voter)).json.surveys[0];
  const r = await call('PATCH', `/admin/voters/${voter._id}/surveys/${s0.id}`, asAdmin({ version: s0.version, answers: [], note }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
};
const noteCopyOf = async (voter, runId, { newest = false } = {}) => {
  const others = (await copiesOf(voter, 'answer_edit')).filter((c) => !c.answerEditRunId || String(c.answerEditRunId) !== String(runId));
  return newest ? others.sort((a, b) => b.overwrittenAt - a.overwrittenAt)[0] : others[0];
};

test('W-M1: an Undo puts a survey back even when a note-only profile edit\'s copy was erased since — Same change for everyone and one person at a time', { skip }, async () => {
  // Same change for everyone.
  const d1 = 20;
  const v1 = ctx.voters[d1];
  assert.strictEqual((await survey(ctx.caraTok, v1, d1, FAKE())).status, 201);
  const bulk = await createTakeOutFor([d1]);
  assert.deepStrictEqual(await runApply(bulk), { completed: true });
  await noteOnlyEdit(v1, 'called back, all good');
  assert.strictEqual((await eraseCopy(v1, (await noteCopyOf(v1, bulk))._id)).status, 200, 'the voter asked: the note edit\'s copy erased');
  const out1 = await runUndo(bulk);
  assert.strictEqual(out1.summary.putBack, 1);
  assert.strictEqual(out1.summary.erased, 0);
  assert.deepStrictEqual(await signOf(v1), ['yard_sign_delivered', 'volunteer_request']);
  // One person at a time.
  const d2 = 21;
  const v2 = ctx.voters[d2];
  assert.strictEqual((await survey(ctx.caraTok, v2, d2, FAKE())).status, 201);
  const { runId, current } = await openSession(d2);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  assert.strictEqual((await call('POST', edits(`/${runId}/close`), asAdmin())).status, 200);
  await noteOnlyEdit(v2, 'called back');
  assert.strictEqual((await eraseCopy(v2, (await noteCopyOf(v2, runId))._id)).status, 200);
  const out2 = await runUndo(runId);
  assert.strictEqual(out2.summary.putBack, 1);
  assert.strictEqual(out2.summary.erased, 0);
  assert.deepStrictEqual(await signOf(v2), ['yard_sign_delivered', 'volunteer_request']);
});

test('W-M1: a survey changed on the profile before the session\'s first save, put back to that, reads put back — a note-only edit\'s erased copy is not this run\'s', { skip }, async () => {
  const d = 39;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  // Before the session's first save, an admin changes the answers on the profile.
  const s0 = (await profileOf(v)).json.surveys[0];
  const edited = await call('PATCH', `/admin/voters/${v._id}/surveys/${s0.id}`, asAdmin({ version: s0.version, answers: [supportRow(), signRow('yard_sign_delivered', 'candidate_follow_up')] }));
  assert.strictEqual(edited.status, 200, JSON.stringify(edited.json));
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  assert.strictEqual((await call('POST', edits(`/${runId}/close`), asAdmin())).status, 200);
  await noteOnlyEdit(v, 'called back');
  assert.strictEqual((await eraseCopy(v, (await noteCopyOf(v, runId, { newest: true }))._id)).status, 200);
  const out = await runUndo(runId);
  assert.strictEqual(out.summary.putBack, 1);
  assert.strictEqual(out.summary.erased, 0);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'candidate_follow_up'], 'back to what the session found');
});

test('W-M1: a one-person session from before each save\'s copy was recorded still reads a survey back at its reviewed answers as put back', { skip }, async () => {
  const d = 37;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  assert.strictEqual((await call('POST', edits(`/${runId}/close`), asAdmin())).status, 200);
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: { 'items.0.as': '' } });
  await noteOnlyEdit(v, 'called back');
  assert.strictEqual((await eraseCopy(v, (await noteCopyOf(v, runId))._id)).status, 200);
  const out = await runUndo(runId);
  assert.strictEqual(out.summary.putBack, 1);
  assert.strictEqual(out.summary.erased, 0);
});

test('W-M1: a survey saved twice in one session whose ORIGINAL\'s copy was erased still reads erased', { skip }, async () => {
  const d = 22;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow()]);
  assert.strictEqual((await call('POST', edits(`/${runId}/close`), asAdmin())).status, 200);
  const item = (await AnswerEditRunChunk.findOne({ runId }).lean()).items[0];
  assert.strictEqual(item.as.length, 2, 'each save\'s copy is on the item');
  const copies = (await SurveyResponseArchive.collection.find({ answerEditRunId: new mongoose.Types.ObjectId(runId) }).toArray()).sort((a, b) => a.overwrittenAt - b.overwrittenAt);
  assert.strictEqual((await eraseCopy(v, copies[0]._id)).status, 200);
  const out = await runUndo(runId);
  assert.strictEqual(out.summary.erased, 1);
  assert.strictEqual(out.summary.putBack, 0);
});

test('W-M3: after one whole first-build undo pass, a put-back of this build is logged even when one of the first build\'s has changed since', { skip }, async () => {
  const v = ctx.voters;
  const doors = [23, 24, 25, 26];
  for (const i of doors) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await createTakeOutFor(doors);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  // The first build's one pass put doors 23–25 back (copies deleted, no receipts) and logged 3; door 26
  // waited on another change.
  for (const i of [23, 24, 25]) await firstBuildPutBack(v[i], true);
  await AnswerEditRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    {
      $set: {
        'undo.status': 'done', 'undo.jobId': 'old-build-1', 'undo.passes': 1, 'undo.lastRunAt': new Date(Date.now() - 1800_000),
        'undo.summary': { putBack: 3, changedSince: 0, restoredOnProfile: 0, waiting: 1, cleared: 0, erased: 0, gone: 0, names: [] },
      },
    }
  );
  // A teammate re-surveys door 23 since: that put-back can't be proven any more.
  assert.strictEqual((await survey(ctx.ottoTok, v[23], 23, [supportRow()])).status, 201);
  const since = new Date();
  const pressed = await undoPressed(runId);
  assert.strictEqual(pressed.status, 202, JSON.stringify(pressed.json));
  const out = await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
  assert.deepStrictEqual(await signOf(v[26]), ['yard_sign_delivered', 'volunteer_request'], 'door 26 is put back now');
  assert.deepStrictEqual((await historySince('answerEditUndo', since)).map((r) => r.toValue).filter((t) => /put back/.test(t)).length, 1, 'and logged');
  assert.ok(out.summary.putBack >= 3);
});

test('W-m4: an Undo of this build whose job failed before its first claim is never read the first build\'s way', { skip }, async () => {
  const [d, other] = [27, 35];
  const v = ctx.voters[d];
  for (const i of [d, other]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[i], i, FAKE())).status, 201);
  const runId = await createTakeOutFor([d, other]);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  // One edit's copy restored on the profile: its mark goes, so an undo reads it "restored on the profile".
  const [copy] = await copiesOf(v, 'answer_edit');
  assert.strictEqual((await restoreCopy(v, copy._id)).status, 200);
  // Undo pressed on this build; its job failed every attempt before it could claim the run.
  assert.strictEqual((await undoPressed(runId)).status, 202);
  await AnswerEditRun.collection.updateOne({ _id: new mongoose.Types.ObjectId(runId) }, { $set: { 'undo.status': 'failed', 'undo.error': 'worker restarted' }, $unset: { 'undo.lastRunAt': '' } });
  assert.strictEqual((await undoPressed(runId)).status, 202, 'Retry undo');
  const run = await AnswerEditRun.findById(runId).lean();
  assert.notStrictEqual(run.undo.legacy, true);
  // ...nor its job handed to a worker again with nothing pressed (failed, no heartbeat).
  await AnswerEditRun.collection.updateOne({ _id: new mongoose.Types.ObjectId(runId) }, { $set: { 'undo.status': 'failed' }, $unset: { 'undo.lastRunAt': '' } });
  const out = await undoJob(runId, run.undo.jobId);
  assert.notStrictEqual((await AnswerEditRun.findById(runId).lean()).undo.legacy, true);
  assert.strictEqual(out.summary.putBack, 1, 'only the one this undo put back');
  assert.strictEqual(out.summary.restoredOnProfile, 1);
});

test('W-m5: a survey a first-build step saved, saved again on this build, counts once and each question once', { skip }, async () => {
  const d = 28;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  // As the first build's step left the item: its copy, no record of what it counted.
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: { 'items.0.cq': '', 'items.0.as': '' } });
  await step(runId, current.responseId, [supportRow(), signRow()]);
  const closed = await call('POST', edits(`/${runId}/close`), asAdmin());
  assert.strictEqual(closed.status, 200, JSON.stringify(closed.json));
  assert.strictEqual(closed.json.run.counts.surveysChanged, 1);
  const byQ = (await AnswerEditRunChunk.findOne({ runId }).lean()).counts.byQuestion;
  assert.strictEqual(byQ.yard_sign.surveys, 1);
});

// ── what a review leaves running, and how many run at once (P-m1, P-m2) ──────────────────────────

test('P-m1: a review whose change moves nothing leaves no count running after it answers', { skip }, async () => {
  const rows = Array.from({ length: 9 }, (_, i) => [44 + i, [{ questionKey: 'pick', questionLabel: 'Pick one', answer: 'Tag 0', optionIds: ['t0'] }]]);
  const ids = await ottoSurveys('Many Tags R6', MANY_QUESTIONS, rows);
  const launches = [];
  hookProto(mongoose.Aggregate.prototype, 'exec', function (real, args) {
    if (!isIdentifiedCount(this)) return real(...args);
    launches.push(Date.now());
    return pause(250).then(() => real(...args));
  });
  // Every survey already holds Tag 0: setting it moves nothing.
  const r = await call('POST', edits(), asAdmin(reviewBody('Many Tags R6', ids, [{ questionKey: 'pick', op: 'set', optionIds: ['t0'] }])));
  const answeredAt = Date.now();
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.price.surveysChanged, 0);
  await pause(1500);
  assert.deepStrictEqual(launches.filter((t) => t > answeredAt), [], 'no count started after the answer');
});

test('P-m2: past two different priced reviews at once a server refuses the next at once — a press joining one is not another', { skip }, async () => {
  const ids = await ottoSurveys('Gate Survey R6', GATE_QUESTIONS, [[53, [gateRow('yes'), followRow('mail')]], [54, [gateRow('maybe'), followRow('early')]]]);
  const a = reviewBody('Gate Survey R6', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  const b = { ...a, plan: [{ questionKey: 'gate', op: 'set', optionIds: ['maybe'] }] };
  const inside = deferred();
  const release = deferred();
  let held = false;
  hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
    if (!held && isScan(this)) {
      held = true;
      inside.resolve();
      return release.p.then(() => real(...args));
    }
    return real(...args);
  });
  const first = call('POST', edits(), asAdmin(a));
  await inside.p;
  let other;
  let joined;
  try {
    [other, joined] = await withEnv({ ANSWER_EDIT_REVIEWS_AT_ONCE: '1' }, async () => [
      await call('POST', edits(), asBea(b)),
      call('POST', edits(), asBea(a)),
    ]);
  } finally {
    release.resolve();
  }
  assert.strictEqual(other.status, 503, JSON.stringify(other.json));
  assert.strictEqual(other.json.code, 'REVIEW_BUSY');
  const [ra, rj] = await Promise.all([first, joined]);
  assert.deepStrictEqual([ra.status, rj.status], [200, 200]);
  assert.strictEqual(ra.json.digest, rj.json.digest);
});

// ── the one-time console step (G-m4) ─────────────────────────────────────────────────────────────

// A second first-build unknock of the same entries `secondsLater`, with copies of whatever is live then.
const firstBuildUnknockAt = async (entries, at) => {
  const surveys = await SurveyResponse.collection.find({ householdId: { $in: entries.map((e) => e.householdId) } }).toArray();
  const runId = new mongoose.Types.ObjectId();
  await UnknockRun.collection.insertOne({
    _id: runId, organizationId: ctx.org._id, campaignId: ctx.campaign._id, byUserId: ctx.admin._id, status: 'pending', frozenRows: entries.length,
    selection: { scope: {}, byIds: true }, scopeSummary: null, counts: { entriesRemoved: entries.length, doorsAffected: entries.length },
    revertedAt: null, createdAt: at, updatedAt: at, __v: 0,
  });
  await UnknockRunChunk.collection.insertOne({
    runId, campaignId: ctx.campaign._id, organizationId: ctx.org._id, seq: 0, rows: entries,
    visitKeys: [...new Set(entries.map((x) => doorKey(x)))], frozenAt: at, createdAt: at, updatedAt: at,
  });
  const copyAt = new Date(at.getTime() + 1000);
  if (surveys.length) {
    await SurveyResponseArchive.collection.insertMany(
      surveys.map(({ _id, __v, createdAt, updatedAt, ...snap }) => ({
        ...snap, overwrittenBy: ctx.admin._id, overwrittenVia: 'unknock', overwrittenAt: copyAt, conversionRunId: null, unknockRunId: runId, createdAt: copyAt, updatedAt: copyAt,
      }))
    );
  }
  return runId;
};

test('G-m4: the console step judges older unknocks newest first — the one that removed the answers is marked, the one that removed nothing isn\'t, and the dry run counts what the apply marks', { skip }, async () => {
  const doors = [29, 30];
  for (const d of doors) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const entries = [];
  for (const d of doors) entries.push(await visitEntry(d, ctx.cara._id));
  // Ub copied the answers and died before deleting anything; Ua, later, copied them again, deleted them,
  // and died before deleting the entries.
  const ub = await firstBuildUnknockAt(entries, new Date(Date.now() - 3 * 3600_000));
  const ua = await firstBuildUnknockAt(entries, new Date(Date.now() - 2 * 3600_000));
  await SurveyResponse.collection.deleteMany({ householdId: { $in: entries.map((e) => e.householdId) } });
  const count = (out) => Number(out.split('\n').find((l) => /Unknocks that stopped part-way/.test(l)).match(/: (\d+) of/)[1]);
  const dry = count(await backfill(false));
  const applied = count(await backfill(true));
  assert.strictEqual(dry, applied, 'the dry run counts what the apply marks');
  const marked = async (id) => !!(await UnknockRun.findById(id).lean()).deletingAt;
  assert.strictEqual(await marked(ua), true, 'the one that removed the answers');
  assert.strictEqual(await marked(ub), false, 'not the older one — the later one removed them');
  assert.strictEqual(await CampaignChange.exists({ _id: unknockHistoryRowId(ub, 'strike') }), null, 'nor a History row for it');
  // Ub's Undo isn't offered; Ua's puts the answers back.
  assert.notStrictEqual((await call('POST', unknocks('/revert'), asAdmin({ runId: String(ub) }))).status, 200);
  assert.strictEqual((await call('POST', unknocks('/revert'), asAdmin({ runId: String(ua) }))).status, 200);
  for (const d of doors) assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request']);
});

test('G-m4: the console step marks no older unknock whose visit\'s answers a later conversion took — and writes a missing History row for one it marked', { skip }, async () => {
  const [d1, d2] = [31, 32];
  for (const d of [d1, d2]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e1 = await visitEntry(d1, ctx.cara._id);
  // U copied the answers and died before deleting anything; a conversion later took them, its copy was
  // erased on the profile, and it was undone — the slot is empty, but U removed nothing.
  const u = await firstBuildUnknockAt([e1], new Date(Date.now() - 2 * 3600_000));
  const runId = await convertDoorFromSurvey(e1._id);
  const [cc] = await copiesOf(ctx.voters[d1], 'outcome_convert');
  assert.strictEqual((await eraseCopy(ctx.voters[d1], cc._id)).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/revert`), asAdmin())).status, 200);
  assert.strictEqual(await liveOf(ctx.voters[d1]), null);
  // A run marked by an earlier console run whose History row a crash left out.
  const e2 = await visitEntry(d2, ctx.cara._id);
  const m = await firstBuildUnknockAt([e2], new Date(Date.now() - 2 * 3600_000));
  await UnknockRun.collection.updateOne({ _id: m }, { $set: { deletingAt: new Date(Date.now() - 2 * 3600_000 + 1000) } });
  await backfill(true);
  assert.strictEqual((await UnknockRun.findById(u).lean()).deletingAt ?? null, null, 'not marked');
  assert.ok(await CampaignChange.exists({ _id: unknockHistoryRowId(m, 'strike') }), 'its History row written');
});

test('G-m4: an older unknock that deleted the answers is marked even when a teammate surveyed the voter since', { skip }, async () => {
  const d = 38;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const u = await firstBuildUnknockAt([e], new Date(Date.now() - 2 * 3600_000));
  await SurveyResponse.collection.deleteMany({ householdId: ctx.homes[d]._id }); // its answers' delete
  // Otto surveys the voter later: the slot holds his survey, and no overwrite kept Cara's.
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [supportRow()])).status, 201);
  await backfill(true);
  assert.ok((await UnknockRun.findById(u).lean()).deletingAt, 'marked: it removed Cara\'s answers');
});
