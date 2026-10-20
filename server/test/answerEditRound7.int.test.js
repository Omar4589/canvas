import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Code review round 7 of Edit answers on Door Outcomes (2026-10-20), each finding pinned against the
// REAL app + a throwaway mongod — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §V. Most are the reviewers' own
// reproductions, asserting what the fix does:
//   npm run test:int -- test/answerEditRound7.int.test.js
//
// Redis points at a dead port, as everywhere here: a create or an undo answers 503 when it can't
// reach the queue, and the tests drive the REAL processors with the job id the run carries.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-r7';
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

  const org = await Organization.create({ name: 'Edit Org R7', slug: 'edit-org-r7', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'r7a@t.co', passwordHash: 'x', isActive: true });
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'r7b@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'r7c@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'r7o@t.co', passwordHash: 'x', isActive: true });
  for (const u of [admin, bea]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const otherTemplate = await SurveyTemplate.create({ organizationId: org._id, name: 'Other Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit R7', type: 'survey', state: 'FL', isActive: true,
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
const undecidedRow = () => ({ questionKey: 'candidate_support', questionLabel: 'Can we count on your support?', answer: 'Undecided', optionIds: ['undecided'] });
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
const visitEntries = (door, userId) => CanvassActivity.find({ householdId: ctx.homes[door]._id, userId, actionType: { $ne: 'note_added' } }).lean();
const scopeFor = (userId, extra = {}) => ({ userId: String(userId), outcomes: ['survey_submitted'], ...extra });
const TAKE_OUT = [{ questionKey: 'yard_sign', op: 'adjust', remove: ['candidate_follow_up', 'volunteer_request'] }];
const copiesOf = (voter, via) => SurveyResponseArchive.collection.find({ voterId: voter._id, ...(via ? { overwrittenVia: via } : {}) }).toArray();
const byOtto = async (voter) => String((await liveOf(voter))?.userId) === String(ctx.otto._id);

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

const armUndo = async (runId, requestedBy = null) => {
  const jobId = `t-undo-${runId}-${Date.now()}-${Math.random()}`;
  await AnswerEditRun.updateOne(
    { _id: runId },
    { $set: { 'undo.status': 'pending', 'undo.jobId': jobId, 'undo.requestedAt': new Date(), 'undo.requestedBy': requestedBy } }
  );
  return jobId;
};
const undoJob = (runId, jobId) => processAnswerEditJob({ id: jobId, name: 'undo', data: { runId: String(runId) }, opts: { attempts: 3 }, attemptsMade: 0 });
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
const reviewAndCreate = async (body) => {
  const dry = await call('POST', edits(), asAdmin({ ...body, dryRun: true }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  const created = await call('POST', edits(), asAdmin({
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
const undoPressed = async (runId) => {
  const unstub = stubQueue(QUEUE_NAMES.ANSWER_EDIT);
  try {
    return await call('POST', edits(`/${runId}/revert`), asAdmin());
  } finally {
    unstub();
  }
};
const createTakeOutFor = async (doors) => {
  const ids = [];
  for (const d of doors) ids.push(String((await entryOf(ctx.voters[d], ctx.cara._id))._id));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Elm St' }), actionIds: ids, plan: TAKE_OUT });
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  return created.json.run.id;
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
const closeSession = async (runId) => {
  const closed = await call('POST', edits(`/${runId}/close`), asAdmin());
  assert.strictEqual(closed.status, 200, JSON.stringify(closed.json));
  return closed;
};
const profileOf = (voter) => call('GET', `/admin/voters/${voter._id}`, asAdmin());
const restoreCopy = (voter, archiveId) => call('POST', `/admin/voters/${voter._id}/surveys/${archiveId}/restore`, asAdmin());
const eraseCopy = (voter, archiveId) => call('DELETE', `/admin/voters/${voter._id}/surveys/archive/${archiveId}`, asAdmin());
const editOnProfile = async (voter, answers, note) => {
  const p = await profileOf(voter);
  const s = p.json.surveys[0];
  const r = await call('PATCH', `/admin/voters/${voter._id}/surveys/${s.id}`, asAdmin({ answers, ...(note !== undefined ? { note } : {}), version: s.version }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
};
const stateOf = async (copy) => [...(await restoreStates([copy])).values()][0];
const unknockIds = (ids) => call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: ids.map(String) }));
const undoUnknock = (runId) => call('POST', unknocks('/revert'), asAdmin({ runId: String(runId) }));
const listedUnknock = async (runId) => (await call('GET', unknocks(), asAdmin())).json.runs.find((r) => r.id === String(runId));
const latestUnknock = () => UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
// A strike whose entries' delete fails outright after its answers went: it stops part-way, its entries on file.
const unknockStoppingBeforeEntries = async (ids) => {
  hookOnce(CanvassActivity.collection, 'deleteMany', async () => { throw new Error('connection dropped'); });
  const r = await unknockIds(ids);
  assert.strictEqual(r.status, 500, JSON.stringify(r.json));
  return latestUnknock();
};
const convertDoorFromSurvey = async (entryId) => {
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(entryId)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  assert.strictEqual((await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(entryId) }))).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  return runId;
};
const isClaim = (args) => !!args[1]?.$set?.undoToken;
const claimedBy = (runId) => SurveyResponseArchive.collection.countDocuments({ undoToken: new mongoose.Types.ObjectId(String(runId)) });
const backfill = async (apply) => {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('node', ['src/migrations/backfillRemovalStrikes.js', ...(apply ? ['--apply'] : [])], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, MONGODB_URI: URI },
    encoding: 'utf8',
  });
};
// A first-build unknock (589c1c0's shape: pending, no heartbeat, no stamp), frozen at `at` over these
// entries, with its copies of the answers at their visits.
const firstBuildUnknockAt = async (entries, at, { copies = true } = {}) => {
  const surveys = copies ? await SurveyResponse.collection.find({ householdId: { $in: entries.map((e) => e.householdId) }, userId: ctx.cara._id }).toArray() : [];
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
const markedByBackfill = async (id) => !!(await UnknockRun.findById(id).lean()).deletingAt;

const deferred = () => {
  let resolve;
  const p = new Promise((r) => { resolve = r; });
  return { p, resolve };
};
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
const hookProto = (proto, method, around) => {
  const real = proto[method];
  proto[method] = function (...args) {
    return around.call(this, (...a) => real.apply(this, a), args);
  };
  const restore = () => { proto[method] = real; };
  pending.push(restore);
  return restore;
};
const GATE_QUESTIONS = [
  {
    key: 'gate', label: 'Will you vote?', type: 'single_choice', order: 0,
    options: [{ id: 'yes', text: 'Yes', tag: 'Voting', order: 0 }, { id: 'maybe', text: 'Maybe', tag: 'Leaning', order: 1 }, { id: 'no', text: 'No', tag: 'Not voting', order: 2 }],
  },
];
const gateRow = (id) => ({ questionKey: 'gate', questionLabel: 'Will you vote?', answer: { yes: 'Yes', maybe: 'Maybe', no: 'No' }[id], optionIds: [id] });
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
const reviewBody = (name, ids, plan) => ({ scope: { userId: String(ctx.otto._id), outcomes: ['survey_submitted'] }, actionIds: ids, surveyTemplateId: String(templates[name]._id), plan, dryRun: true });
// The review's scan of the surveys (answerEditScope.js readBatch).
const isScan = (q) => q.model?.modelName === 'SurveyResponse' && q._fields?.editedBy === 1;
// Hold the first review's scan until released: it keeps its place meanwhile.
const parkFirstScan = () => {
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
  return { inside: inside.p, release: release.resolve };
};

// ── Restore lifts a strike only through its own undo (R-B1) ──────────────────────────────────────

test('R-B1: a strike that stopped before deleting its entry holds the struck answers while it stands — a real later survey stays; its Undo lifts the hold', { skip }, async () => {
  const d = 1;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const run = await unknockStoppingBeforeEntries([e._id]);
  assert.ok(await visitEntry(d, ctx.cara._id), 'its entry is still on file');
  const [copy] = await copiesOf(v, 'unknock');
  // Otto surveys the voter for real afterwards.
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [supportRow()])).status, 201);
  assert.deepStrictEqual(await stateOf(copy), { restorable: false, reason: 'unknocked' });
  const r = await restoreCopy(v, copy._id);
  assert.strictEqual(r.status, 409, JSON.stringify(r.json));
  assert.ok(await byOtto(v), 'Otto\'s survey is still the live one');
  // Undone, the strike's answers are history again: the visit reads Surveyed, and Restore is the admin's choice.
  const undone = await undoUnknock(run._id);
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.deepStrictEqual(await stateOf(copy), { restorable: true, reason: null });
});

test('R-B1: a later unknock of a visit\'s newer entry holds its answers while it stands, though an earlier unknock\'s Undo brought the older entry back', { skip }, async () => {
  const d = 2;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e1 = await visitEntry(d, ctx.cara._id);
  const u1 = await unknockIds([e1._id]);
  assert.strictEqual(u1.status, 201, JSON.stringify(u1.json));
  assert.strictEqual((await survey(ctx.caraTok, v, d, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  const e2 = await visitEntry(d, ctx.cara._id);
  assert.notStrictEqual(String(e2._id), String(e1._id));
  const u2 = await unknockIds([e2._id]);
  assert.strictEqual(u2.status, 201, JSON.stringify(u2.json));
  assert.strictEqual((await undoUnknock(u1.json.run.id)).status, 200);
  assert.ok((await visitEntries(d, ctx.cara._id)).some((x) => String(x._id) === String(e1._id)), 'the older entry is back');
  // Otto surveys the voter for real afterwards.
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [undecidedRow()])).status, 201);
  const struck = await SurveyResponseArchive.collection.findOne({ voterId: v._id, unknockRunId: new mongoose.Types.ObjectId(u2.json.run.id) });
  assert.deepStrictEqual(await stateOf(struck), { restorable: false, reason: 'unknocked' });
  assert.strictEqual((await restoreCopy(v, struck._id)).status, 409);
  assert.ok(await byOtto(v), 'Otto\'s survey is still the live one');
});

test('R-B1: an unknock of one of a visit\'s two entries holds the visit\'s answers while it stands, and while its Undo stops before its own entry is back', { skip }, async () => {
  const d = 34;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const ea = await visitEntry(d, ctx.cara._id);
  // An older shape: a second Surveyed entry at the same visit; only it is unknocked.
  const { _id, ...rest } = ea;
  const eb = await CanvassActivity.create({ ...rest, timestamp: new Date(new Date(ea.timestamp).getTime() + 1000) });
  const u = await unknockIds([eb._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  const [copy] = await copiesOf(v, 'unknock');
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [supportRow()])).status, 201);
  assert.deepStrictEqual(await stateOf(copy), { restorable: false, reason: 'unknocked' }, 'Ea, from before it, lifts nothing');
  hookOnce(CanvassActivity.collection, 'insertMany', async () => { throw new MongoNetworkError('connection closed'); });
  assert.strictEqual((await undoUnknock(u.json.run.id)).status, 500);
  assert.deepStrictEqual(await stateOf(copy), { restorable: false, reason: 'unknocked' }, 'its Undo began, but Eb is not back');
  const retried = await undoUnknock(u.json.run.id);
  assert.strictEqual(retried.status, 200, 'Retry undo');
  // Ea is the visit as it stood, not newer work: Eb comes back beside it.
  assert.deepStrictEqual((await visitEntries(d, ctx.cara._id)).map((x) => String(x._id)).sort(), [String(ea._id), String(eb._id)].sort());
  assert.strictEqual(retried.json.run.counts.rowsNotRestored, 0);
  // Otto's survey holds the slot, so the answers stay on the profile — restorable now, as the admin's swap.
  assert.deepStrictEqual(await stateOf(copy), { restorable: true, reason: null });
  assert.ok(await byOtto(v));
});

test('R-B1: a Surveyed → Not home step that died after taking the answers, before the flip, holds them while the conversion stands; its Undo lifts the hold', { skip }, async () => {
  const d = 3;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  hookOnce(CanvassActivity, 'bulkWrite', async () => { throw new Error('primary stepped down'); });
  assert.notStrictEqual((await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e._id) }))).status, 200);
  assert.strictEqual((await CanvassActivity.findById(e._id).lean()).actionType, 'survey_submitted', 'never flipped');
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [supportRow()])).status, 201);
  const [copy] = await copiesOf(v, 'outcome_convert');
  assert.deepStrictEqual(await stateOf(copy), { restorable: false, reason: 'converted' });
  assert.strictEqual((await restoreCopy(v, copy._id)).status, 409);
  assert.ok(await byOtto(v));
  const undone = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.deepStrictEqual(await stateOf(copy), { restorable: true, reason: null });
});

test('R-B1: a removal copy whose run is not on file is read as before — its visit\'s entry from before it, reading Surveyed', { skip }, async () => {
  const d = 4;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const live = await liveOf(v);
  const { _id, __v, createdAt, updatedAt, ...snap } = live;
  const at = new Date();
  const ins = await SurveyResponseArchive.collection.insertOne({
    ...snap, overwrittenBy: ctx.admin._id, overwrittenVia: 'unknock', overwrittenAt: at, unknockRunId: new mongoose.Types.ObjectId(), conversionRunId: null, createdAt: at, updatedAt: at,
  });
  const copy = await SurveyResponseArchive.collection.findOne({ _id: ins.insertedId });
  assert.deepStrictEqual(await stateOf(copy), { restorable: true, reason: null });
});

// ── the unknock undo: what it hands on, what it counts, what it lets go (R-m4, R-m5, R-M2) ────────

test('R-m4: an Undo that brings back one of a visit\'s two entries puts that visit\'s answers back, though a later unknock struck the other', { skip }, async () => {
  const d = 5;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const ea = await visitEntry(d, ctx.cara._id);
  // An older shape: a second Surveyed entry at the same visit.
  const { _id, ...rest } = ea;
  const eb = await CanvassActivity.create({ ...rest, timestamp: new Date(new Date(ea.timestamp).getTime() + 1000) });
  // U1 freezes both and stops after deleting Ea alone.
  const real = CanvassActivity.collection.deleteMany.bind(CanvassActivity.collection);
  hookOnce(CanvassActivity.collection, 'deleteMany', async () => {
    await real({ _id: ea._id });
    throw new Error('connection reset');
  });
  assert.strictEqual((await unknockIds([ea._id, eb._id])).status, 500);
  const u1 = await latestUnknock();
  const u2 = await unknockIds([eb._id]);
  assert.strictEqual(u2.status, 201, JSON.stringify(u2.json));
  const undone = await undoUnknock(u1._id);
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.ok((await visitEntries(d, ctx.cara._id)).some((x) => String(x._id) === String(ea._id)), 'Ea is back');
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], 'and the visit\'s answers with it');
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 0);
  assert.strictEqual((await UnknockRun.findById(u2.json.run.id).lean()).counts.responsesArchived, 0, 'nothing handed to the later run');
  // ...and the later run's Undo finds Ea, put back since its freeze, where it froze Eb alone: it can't tell
  // that from a re-survey, so Eb stays off and counts not put back — never two entries doubled (round 8).
  const undone2 = await undoUnknock(u2.json.run.id);
  assert.strictEqual(undone2.status, 200, JSON.stringify(undone2.json));
  assert.strictEqual(undone2.json.run.counts.rowsNotRestored, 1);
  assert.strictEqual((await visitEntries(d, ctx.cara._id)).length, 1);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request']);
});

test('R-m5: Retry undo after a hand-off still counts the answers it handed on as not put back', { skip }, async () => {
  const [d0, d1] = [6, 7];
  for (const d of [d0, d1]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e0 = await visitEntry(d0, ctx.cara._id);
  const e1 = await visitEntry(d1, ctx.cara._id);
  const u1 = await unknockStoppingBeforeEntries([e0._id, e1._id]);
  assert.strictEqual((await unknockIds([e0._id])).status, 201);
  // U1's undo hands door 6's answers on, then its write-back of door 7 fails outright.
  hookOnce(SurveyResponse.collection, 'insertMany', async () => { throw new MongoNetworkError('connection closed'); });
  assert.strictEqual((await undoUnknock(u1._id)).status, 500);
  const retried = await undoUnknock(u1._id);
  assert.strictEqual(retried.status, 200, JSON.stringify(retried.json));
  assert.strictEqual(retried.json.run.counts.responsesNotRestored, 1, 'door 6\'s answers, handed on');
  assert.deepStrictEqual(await signOf(ctx.voters[d1]), ['yard_sign_delivered', 'volunteer_request']);
});

test('R-M2: an unknock Undo whose claim read, or whose delete of the landed copies, fails lets go of every copy it claimed — Retry undo finishes', { skip }, async () => {
  for (const [d, fail] of [[8, 'claim read'], [9, 'delete']]) {
    const v = ctx.voters[d];
    assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
    const e = await visitEntry(d, ctx.cara._id);
    const u = await unknockIds([e._id]);
    assert.strictEqual(u.status, 201, JSON.stringify(u.json));
    const runId = u.json.run.id;
    if (fail === 'claim read') {
      // The claim's own read of what it holds, after its update landed.
      const realFind = SurveyResponseArchive.collection.find.bind(SurveyResponseArchive.collection);
      hookAll(SurveyResponseArchive.collection, 'find', (realFn, args) => {
        if (args[0]?.undoToken) throw new MongoNetworkError('connection closed');
        return realFind(...args);
      });
    } else {
      hookOnce(SurveyResponseArchive, 'deleteMany', async () => { throw new MongoNetworkError('connection closed'); });
    }
    const first = await undoUnknock(runId);
    while (pending.length) pending.pop()();
    assert.strictEqual(first.status, 500, `${fail}: ${JSON.stringify(first.json)}`);
    assert.strictEqual(await claimedBy(runId), 0, `${fail}: no copy left held`);
    const again = await undoUnknock(runId);
    assert.strictEqual(again.status, 200, `${fail}: ${JSON.stringify(again.json)}`);
    assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], fail);
    assert.strictEqual((await copiesOf(v, 'unknock')).length, 0, `${fail}: one survey, no copy left`);
  }
});

test('R-M2: a Surveyed → Not home Undo whose claim read, or whose delete of the landed copies, fails lets go of every copy it claimed', { skip }, async () => {
  for (const [d, fail] of [[10, 'claim read'], [11, 'delete']]) {
    const v = ctx.voters[d];
    assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
    const runId = await convertDoorFromSurvey((await visitEntry(d, ctx.cara._id))._id);
    if (fail === 'claim read') {
      const realFind = SurveyResponseArchive.collection.find.bind(SurveyResponseArchive.collection);
      hookAll(SurveyResponseArchive.collection, 'find', (realFn, args) => {
        if (args[0]?.undoToken) throw new MongoNetworkError('connection closed');
        return realFind(...args);
      });
    } else {
      hookOnce(SurveyResponseArchive, 'deleteMany', async () => { throw new MongoNetworkError('connection closed'); });
    }
    const first = await call('POST', conv(`/${runId}/revert`), asAdmin());
    while (pending.length) pending.pop()();
    assert.notStrictEqual(first.status, 200, fail);
    assert.strictEqual(await claimedBy(runId), 0, `${fail}: no copy left held`);
    const again = await call('POST', conv(`/${runId}/revert`), asAdmin());
    assert.strictEqual(again.status, 200, `${fail}: ${JSON.stringify(again.json)}`);
    assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], fail);
  }
});

test('R-m8: a Surveyed → Not home Undo with two copies of one survey (a batch archived twice) puts it back once and lists no one', { skip }, async () => {
  const d = 12;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const runId = await convertDoorFromSurvey((await visitEntry(d, ctx.cara._id))._id);
  const [copy] = await copiesOf(v, 'outcome_convert');
  const { _id, ...twin } = copy;
  await SurveyResponseArchive.collection.insertOne({ ...twin, overwrittenAt: new Date(new Date(copy.overwrittenAt).getTime() + 5) });
  const undone = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  const run = await SurveyConversionRun.findById(runId).lean();
  assert.strictEqual(run.counts.responsesNotRestored || 0, 0);
  assert.strictEqual((run.samples || []).filter((s) => s.reason === 'not_restored').length, 0, 'no one listed');
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request']);
  assert.strictEqual((await copiesOf(v, 'outcome_convert')).length, 0, 'the duplicate went too');
});

// ── the unknock routes: a refused Undo, a check that fails, the numbers, the wire (R-m3, R-m6, R-m7, R-m10, C-m5) ──

test('R-m3: an Undo refused after its claim — another removal started meanwhile — never reads "Undo stopped part-way"', { skip }, async () => {
  const d = 13;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const u = await unknockIds([(await visitEntry(d, ctx.cara._id))._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  // Another admin's conversion lands right after the claim.
  let other = null;
  const real = UnknockRun.updateOne.bind(UnknockRun);
  hookAll(UnknockRun, 'updateOne', async (realFn, args) => {
    const out = await real(...args);
    if (!other && args[1]?.$set?.revertingAt) {
      other = await SurveyConversionRun.collection.insertOne({
        organizationId: ctx.org._id, campaignId: ctx.campaign._id, status: 'running', direction: 'from_survey', mode: 'bulk', createdAt: new Date(), updatedAt: new Date(),
      });
    }
    return out;
  });
  const refused = await undoUnknock(u.json.run.id);
  while (pending.length) pending.pop()();
  await SurveyConversionRun.collection.deleteOne({ _id: other.insertedId });
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
  assert.strictEqual((await UnknockRun.findById(u.json.run.id).lean()).undoBegunAt ?? null, null);
  const row = await listedUnknock(u.json.run.id);
  assert.strictEqual(row.undoStopped, false);
  assert.strictEqual(row.status, 'completed');
});

test('R-m6: a busy check that fails outright once the run is on file takes the run with it — nothing reads Removing… for ten minutes', { skip }, async () => {
  const d = 14;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const before = await UnknockRun.countDocuments({ campaignId: ctx.campaign._id });
  // The route's own check passes; the strike's, once its run is on file, fails.
  let calls = 0;
  const real = AnswerEditRun.exists.bind(AnswerEditRun);
  hookAll(AnswerEditRun, 'exists', async (realFn, args) => {
    calls += 1;
    if (calls === 2) throw new MongoNetworkError('connection closed');
    return real(...args);
  });
  const r = await unknockIds([(await visitEntry(d, ctx.cara._id))._id]);
  while (pending.length) pending.pop()();
  // Worded as nothing removed (round 8: a plain 500 pointed at a row that wasn't there).
  assert.strictEqual(r.status, 503, JSON.stringify(r.json));
  assert.strictEqual(r.json.code, 'UNKNOCK_NOT_STARTED');
  assert.strictEqual(await UnknockRun.countDocuments({ campaignId: ctx.campaign._id }), before, 'no run left behind');
  assert.ok(await visitEntry(d, ctx.cara._id), 'nothing removed');
});

test('R-m7: a campaign-numbers refresh that fails after the strike finished still answers with the finished run', { skip }, async () => {
  const d = 15;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const real = Campaign.updateOne.bind(Campaign);
  hookAll(Campaign, 'updateOne', async (realFn, args) => {
    if (args[1]?.$set?.stats) throw new MongoNetworkError('connection closed');
    return real(...args);
  });
  const r = await unknockIds([(await visitEntry(d, ctx.cara._id))._id]);
  while (pending.length) pending.pop()();
  assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  assert.strictEqual(r.json.run.status, 'completed');
});

test('R-m10: an undone unknock reads whether its strike finished — this build\'s by completedAt, the first build\'s (which undid only finished runs) by its shape', { skip }, async () => {
  const d = 16;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const stopped = await unknockStoppingBeforeEntries([(await visitEntry(d, ctx.cara._id))._id]);
  assert.strictEqual((await undoUnknock(stopped._id)).status, 200);
  assert.strictEqual((await listedUnknock(stopped._id)).strikeFinished, false);
  // A first-build run that finished and was undone there: no completedAt, no stamp, no beat.
  const old = new mongoose.Types.ObjectId();
  const at = new Date(Date.now() - 5 * 86400_000);
  await UnknockRun.collection.insertOne({
    _id: old, organizationId: ctx.org._id, campaignId: ctx.campaign._id, byUserId: ctx.admin._id, status: 'reverted', frozenRows: 3,
    selection: { scope: {}, byIds: true }, counts: { entriesRemoved: 3, doorsAffected: 3 }, revertedAt: at, createdAt: at, updatedAt: at, __v: 0,
  });
  assert.strictEqual((await listedUnknock(old)).strikeFinished, true);
  await UnknockRun.collection.deleteOne({ _id: old });
});

test('C-m5: a strike or an Undo that stops part-way answers with its own code and the run — any other server error is not called stopped part-way', { skip }, async () => {
  const d = 17;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  hookOnce(CanvassActivity.collection, 'deleteMany', async () => { throw new Error('connection dropped'); });
  const struck = await unknockIds([(await visitEntry(d, ctx.cara._id))._id]);
  assert.strictEqual(struck.status, 500);
  assert.strictEqual(struck.json.code, 'UNKNOCK_STOPPED');
  assert.strictEqual(struck.json.run.stoppedPartWay, true);
  hookOnce(SurveyResponse.collection, 'insertMany', async () => { throw new MongoNetworkError('connection closed'); });
  const undo = await undoUnknock(struck.json.run.id);
  assert.strictEqual(undo.status, 500);
  assert.strictEqual(undo.json.code, 'UNDO_STOPPED');
  assert.strictEqual(undo.json.run.undoStopped, true);
  assert.strictEqual((await undoUnknock(struck.json.run.id)).status, 200, 'Retry undo finishes it');
});

// ── a review's moment (C-m1) ──────────────────────────────────────────────────────────────────────

test('C-m1: an unknock review is stamped when it began, not when it answered', { skip }, async () => {
  const d = 18;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  // Its reads take a while.
  const real = CanvassActivity.countDocuments.bind(CanvassActivity);
  hookOnce(CanvassActivity, 'countDocuments', async (realFn, args) => {
    await new Promise((r) => setTimeout(r, 400));
    return real(...args);
  });
  const t0 = Date.now();
  const dry = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)], dryRun: true }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  assert.ok(Date.parse(dry.json.asOf) < t0 + 300, `asOf ${dry.json.asOf} is from before the slow read`);
});

// ── the profile's cards act on their own voter row (C-M2) ────────────────────────────────────────

test('C-M2: a card from the same person\'s row in another campaign carries that row, and its Restore and Erase go through', { skip }, async () => {
  const d = 19;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const other = await Campaign.create({
    organizationId: ctx.org._id, name: 'Edit R7 Other', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York', surveyTemplateId: ctx.template._id,
  });
  const sibling = await Voter.create({
    organizationId: ctx.org._id, campaignId: other._id, householdId: ctx.homes[d]._id, stateVoterId: v.stateVoterId, firstName: 'V', lastName: 'Sib', fullName: 'Voter Sibling',
  });
  const at = new Date();
  const base0 = { organizationId: ctx.org._id, campaignId: other._id, householdId: ctx.homes[d]._id, voterId: sibling._id, userId: ctx.otto._id, passId: null, surveyTemplateId: ctx.template._id, submittedAt: at };
  for (const n of [1, 2]) {
    await SurveyResponseArchive.collection.insertOne({
      ...base0, answers: [supportRow()], overwrittenBy: ctx.admin._id, overwrittenVia: 'edit', overwrittenAt: new Date(at.getTime() + n), createdAt: at, updatedAt: at,
    });
  }
  await SurveyResponse.collection.insertOne({ ...base0, answers: [undecidedRow()], createdAt: at, updatedAt: at });
  // Otto's visit there reads Surveyed.
  await CanvassActivity.collection.insertOne({
    organizationId: ctx.org._id, campaignId: other._id, householdId: ctx.homes[d]._id, voterId: sibling._id, userId: ctx.otto._id, passId: null,
    actionType: 'survey_submitted', location: { lat: 28.2, lng: -82.1 }, timestamp: at, createdAt: at, updatedAt: at,
  });
  const p = await profileOf(v);
  const cards = p.json.overwrittenSurveys.filter((c) => c.voterId === String(sibling._id));
  assert.strictEqual(cards.length, 2, 'the sibling row\'s cards, each naming its row');
  assert.ok(p.json.surveys.every((s) => s.voterId), 'every survey names its row');
  assert.strictEqual((await call('DELETE', `/admin/voters/${sibling._id}/surveys/archive/${cards[0].id}`, asAdmin())).status, 200, 'Erase');
  assert.strictEqual((await call('POST', `/admin/voters/${sibling._id}/surveys/${cards[1].id}/restore`, asAdmin())).status, 200, 'Restore');
  await Promise.all([
    CanvassActivity.collection.deleteMany({ campaignId: other._id }),
    SurveyResponse.collection.deleteMany({ voterId: sibling._id }),
    SurveyResponseArchive.collection.deleteMany({ voterId: sibling._id }),
    Voter.deleteOne({ _id: sibling._id }),
    Campaign.deleteOne({ _id: other._id }),
  ]);
});

// ── removals and a re-cut wait for each other (L-M2) ─────────────────────────────────────────────

test('L-M2: an unknock and its Undo wait while a round is being re-cut, and a clear-knocks discard waits while an unknock is removing', { skip }, async () => {
  const d = 20;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  // A lock taken to clear the round's knocks (round 8: only that kind holds a removal).
  await Pass.collection.updateOne({ _id: ctx.pass._id }, { $set: { recutLock: { lockedAt: new Date(), lockedBy: ctx.admin._id, token: 'x', knocks: true } } });
  const refused = await unknockIds([e._id]);
  await Pass.collection.updateOne({ _id: ctx.pass._id }, { $unset: { recutLock: '' } });
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
  assert.match(refused.json.error, /knocks cleared or restored/);
  // An unknock still removing: the discard that clears the round's knocks waits for it.
  const removing = new mongoose.Types.ObjectId();
  await UnknockRun.collection.insertOne({
    _id: removing, organizationId: ctx.org._id, campaignId: ctx.campaign._id, status: 'pending', frozenRows: 1, counts: {}, heartbeatAt: new Date(),
    deletingAt: new Date(), stoppedAt: null, revertedAt: null, createdAt: new Date(), updatedAt: new Date(), __v: 0,
  });
  const discard = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/discard`, asAdmin({ passId: String(ctx.pass._id), clearKnocks: true, confirmActive: true }));
  await UnknockRun.collection.deleteOne({ _id: removing });
  assert.strictEqual(discard.status, 409, JSON.stringify(discard.json));
  assert.ok(await visitEntry(d, ctx.cara._id), 'nothing cleared');
  assert.strictEqual((await Pass.findById(ctx.pass._id).lean()).recutLock?.lockedAt ?? null, null, 'and the lock let go');
});

// ── the console step's evidence (R-m9, L-m4, L-m5) ───────────────────────────────────────────────

test('R-m9: the console step marks an older unknock that deleted the answers though a profile edit from before it kept a copy of the same submission', { skip }, async () => {
  const d = 21;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  // An admin's profile edit, before the unknock: its copy is the same submission, made earlier.
  await editOnProfile(v, [supportRow(), signRow('yard_sign_delivered')]);
  const [edited] = await copiesOf(v);
  await SurveyResponseArchive.collection.updateOne({ _id: edited._id }, { $set: { overwrittenAt: new Date(Date.now() - 3 * 3600_000) } });
  const e = await visitEntry(d, ctx.cara._id);
  const u = await firstBuildUnknockAt([e], new Date(Date.now() - 2 * 3600_000));
  await SurveyResponse.collection.deleteMany({ voterId: v._id }); // its answers' delete
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [supportRow()])).status, 201);
  await backfill(true);
  assert.strictEqual(await markedByBackfill(u), true);
});

test('L-m4: the console step marks an older unknock that deleted the answers when a later unknock struck its entries again — that one\'s Undo brings back entries and surveys', { skip }, async () => {
  const doors = [22, 23];
  for (const d of doors) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const entries = [];
  for (const d of doors) entries.push(await visitEntry(d, ctx.cara._id));
  // U copied and deleted the answers, and died before deleting its entries.
  const u = await firstBuildUnknockAt(entries, new Date(Date.now() - 2 * 3600_000));
  await SurveyResponse.collection.deleteMany({ householdId: { $in: entries.map((e) => e.householdId) } });
  // The admin unknocked the same entries again, on this build.
  const u2 = await unknockIds(entries.map((e) => e._id));
  assert.strictEqual(u2.status, 201, JSON.stringify(u2.json));
  await backfill(true);
  assert.strictEqual(await markedByBackfill(u), true);
  assert.strictEqual((await undoUnknock(u)).status, 200, 'its Undo hands the answers to the later run');
  assert.strictEqual((await undoUnknock(u2.json.run.id)).status, 200);
  for (const d of doors) {
    assert.ok(await visitEntry(d, ctx.cara._id), `door ${d}'s entry is back`);
    assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request'], `and its survey`);
  }
});

test('L-m5: the console step never marks an older unknock for an entry a later unknock that removed it froze — whatever became of that one', { skip }, async () => {
  const [dn, ds] = [24, 25];
  // Door 24 was not home (no answers); door 25 surveyed.
  const nh = await call('POST', `/mobile/households/${ctx.homes[dn]._id}/not-home`, { token: ctx.caraTok, body: { location: near(dn), timestamp: nextTs() } });
  assert.strictEqual(nh.status, 201, JSON.stringify(nh.json));
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[ds], ds, FAKE())).status, 201);
  const en = await visitEntry(dn, ctx.cara._id);
  const es = await visitEntry(ds, ctx.cara._id);
  // U1 copied door 25's answers and died before deleting anything; U3, later, froze door 24's entry,
  // deleted it and died — no answers there, so no copy, never marked.
  const u1 = await firstBuildUnknockAt([en, es], new Date(Date.now() - 3 * 3600_000));
  await firstBuildUnknockAt([en], new Date(Date.now() - 2 * 3600_000), { copies: false });
  await CanvassActivity.deleteOne({ _id: en._id });
  await backfill(true);
  assert.strictEqual(await markedByBackfill(u1), false, 'it removed nothing');
  assert.strictEqual(await CampaignChange.exists({ _id: unknockHistoryRowId(u1, 'strike') }), null);
});

// ── the answer-edit undo's readings (W-M1, W-m1, W-m2, W-m3, W-m4) ───────────────────────────────

// A first-build one-person session that saved this survey twice, and the first build's one undo pass: it
// put back the later copy (the survey reads the first save again, its mark off, no receipt), held the
// earlier one as "kept newer answers", and logged one survey put back.
const firstBuildSessionUndone = async (d) => {
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow()]);
  await closeSession(runId);
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: { 'items.0.cq': '', 'items.0.as': '' } });
  const latest = await SurveyResponseArchive.collection.findOne({ _id: chunk.items[0].a });
  const live = await liveOf(v);
  await SurveyResponse.collection.updateOne(
    { _id: live._id },
    { $set: { answers: latest.answers, editedBy: latest.editedBy ?? null, editedAt: latest.editedAt ?? null }, $pull: { answerEditMarks: latest._id } }
  );
  await SurveyResponseArchive.collection.deleteOne({ _id: latest._id });
  await AnswerEditRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    {
      $set: {
        'undo.status': 'done', 'undo.jobId': 'old-build-1', 'undo.passes': 1, 'undo.lastRunAt': new Date(Date.now() - 1800_000),
        'undo.summary': { putBack: 1, changedSince: 1, restoredOnProfile: 0, waiting: 0, cleared: 0, erased: 0, gone: 0, names: [] },
      },
    }
  );
  const loggedAt = new Date(Date.now() - 1800_000);
  await CampaignChange.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, field: 'answerEditUndo', fromValue: 'edited', toValue: '1 survey put back, 1 kept newer answers',
    byUserId: ctx.admin._id, source: 'answer_edit', createdAt: loggedAt, updatedAt: loggedAt,
  });
  return runId;
};

test('W-M1: Undo again on a first-build session whose one pass put back a survey\'s later copy puts back the earlier one and logs no second put-back', { skip }, async () => {
  const d = 26;
  const runId = await firstBuildSessionUndone(d);
  const since = new Date();
  const pressed = await undoPressed(runId);
  assert.strictEqual(pressed.status, 202, JSON.stringify(pressed.json));
  const out = await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
  assert.strictEqual(out.summary.putBack, 1);
  assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request'], 'back at the original');
  const rows = (await historySince('answerEditUndo', since)).filter((r) => /put back/.test(r.toValue));
  assert.strictEqual(rows.length, 0, 'the survey was already logged put back');
});

test('W-m1: an Erase of the original\'s copy that lands while the undo works reads erased — not put back to the session\'s first save', { skip }, async () => {
  const d = 27;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow()]);
  await closeSession(runId);
  const original = (await copiesOf(v, 'answer_edit')).find((c) => c.answers.find((a) => a.questionKey === 'yard_sign')?.optionIds.length === 2);
  // The Erase lands after the undo read its copies, before it stamps the original's.
  const real = SurveyResponseArchive.collection.updateOne.bind(SurveyResponseArchive.collection);
  hookAll(SurveyResponseArchive.collection, 'updateOne', async (realFn, args) => {
    if (String(args[0]?._id) === String(original._id) && args[1]?.$set?.undoStartedAt) {
      await SurveyResponseArchive.collection.deleteOne({ _id: original._id });
    }
    return real(...args);
  });
  const pressed = await undoPressed(runId);
  assert.strictEqual(pressed.status, 202);
  const out = await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
  while (pending.length) pending.pop()();
  assert.strictEqual(out.summary.putBack, 0);
  assert.strictEqual(out.summary.erased, 1);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered'], 'it holds the session\'s first save');
  assert.ok(!(await AnswerEditRunChunk.findOne({ runId }).lean()).items[0].u, 'never recorded put back');
});

test('W-m2: a put-back is recorded on its item before its copy goes — an undo pass that dies right after, then a Delete on the profile, still counts it', { skip }, async () => {
  const doors = [28, 29];
  for (const d of doors) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const runId = await createTakeOutFor(doors);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  // The pass dies at its re-read of the first survey it put back — that survey's copy already gone.
  let reads = 0;
  hookAll(SurveyResponse.collection, 'findOne', (real, args) => {
    reads += 1;
    if (reads === 1) return Promise.reject(new MongoNetworkError('connection closed'));
    return real(...args);
  });
  assert.strictEqual((await undoPressed(runId)).status, 202);
  const jobId = (await AnswerEditRun.findById(runId).lean()).undo.jobId;
  await assert.rejects(undoJob(runId, jobId));
  while (pending.length) pending.pop()();
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  const done = chunk.items.find((it) => it.u);
  assert.ok(done, 'the put-back is on its item already');
  // An admin deletes that survey on the profile before the retry.
  await SurveyResponse.collection.deleteOne({ voterId: done.v, passId: done.p ?? null });
  await AnswerEditRun.collection.updateOne({ _id: new mongoose.Types.ObjectId(runId) }, { $set: { 'undo.status': 'failed' } });
  const out = await undoJob(runId, jobId);
  assert.strictEqual(out.summary.putBack, 2, 'both counted');
});

test('W-m3: erasing a session\'s later copy reads erased on every pass — never "kept newer answers" by the session\'s own admin', { skip }, async () => {
  const d = 30;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow()]);
  await closeSession(runId);
  // The later copy holds the session's first save; erased, the survey can't go back past the second.
  const later = (await copiesOf(v, 'answer_edit')).find((c) => c.answers.find((a) => a.questionKey === 'yard_sign')?.optionIds.length === 1);
  assert.strictEqual((await eraseCopy(v, later._id)).status, 200);
  assert.strictEqual((await undoPressed(runId)).status, 202);
  for (const pass of [1, 2]) {
    const jobId = pass === 1 ? (await AnswerEditRun.findById(runId).lean()).undo.jobId : await armUndo(runId);
    const out = await undoJob(runId, jobId);
    assert.strictEqual(out.summary.erased, 1, `pass ${pass}`);
    assert.strictEqual(out.summary.changedSince, 0, `pass ${pass}`);
  }
});

test('W-m4: a first-build save\'s earlier copies are this session\'s once this build saves the survey — erased, the Undo reads erased', { skip }, async () => {
  const d = 31;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow('candidate_follow_up')]);
  // As the first build left the item: its latest copy only.
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: { 'items.0.cq': '', 'items.0.as': '' } });
  await step(runId, current.responseId, [supportRow(), signRow()]);
  await closeSession(runId);
  const item = (await AnswerEditRunChunk.findOne({ runId }).lean()).items[0];
  assert.strictEqual(item.as.length, 3, 'every copy of the survey this run made');
  // The original's copy erased: the survey can't go back to it.
  const original = (await copiesOf(v, 'answer_edit')).find((c) => c.answers.find((a) => a.questionKey === 'yard_sign')?.optionIds.length === 2);
  assert.strictEqual((await eraseCopy(v, original._id)).status, 200);
  assert.strictEqual((await undoPressed(runId)).status, 202);
  const out = await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
  assert.strictEqual(out.summary.putBack, 0);
  assert.strictEqual(out.summary.erased, 1);
});

test('W-m4: a session from before each save\'s copy was recorded reads only the marks made while it was open — a profile edit\'s copy erased after Close is not its own', { skip }, async () => {
  const d = 32;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  // The survey changed on the profile after the session opened, before its save.
  const { runId, current } = await openSession(d);
  await editOnProfile(v, [supportRow(), signRow('yard_sign_delivered', 'volunteer_request', 'candidate_follow_up')]);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await closeSession(runId);
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: { 'items.0.cq': '', 'items.0.as': '' } });
  // After Close (copy ids keep whole seconds): a note-only profile edit, and its copy erased.
  await new Promise((r) => setTimeout(r, 2100));
  await editOnProfile(v, undefined, 'a new note');
  const noteCopy = (await copiesOf(v)).sort((a, b) => new Date(b.overwrittenAt) - new Date(a.overwrittenAt))[0];
  assert.strictEqual((await eraseCopy(v, noteCopy._id)).status, 200);
  assert.strictEqual((await undoPressed(runId)).status, 202);
  const out = await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
  assert.strictEqual(out.summary.putBack, 1);
  assert.strictEqual(out.summary.erased, 0);
});

test('W-m5: a first-build save\'s counted questions are read against the survey just after it — a teammate\'s edit in between still counts this build\'s change', { skip }, async () => {
  const d = 33;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: { 'items.0.cq': '', 'items.0.as': '' } });
  // Someone changes the support answer on the profile meanwhile; this build's save changes it again.
  await editOnProfile(v, [undecidedRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await closeSession(runId);
  const byQ = (await AnswerEditRunChunk.findOne({ runId }).lean()).counts.byQuestion;
  assert.strictEqual(byQ.yard_sign.surveys, 1, 'the yard sign once');
  assert.strictEqual(byQ.candidate_support?.surveys, 1, 'and the support answer this build changed');
});

// ── a review's place on the server (P-m3, P-m4) ──────────────────────────────────────────────────

test('P-m3: with no place left, a different review is refused before it reads a single survey', { skip }, async () => {
  const ids = await ottoSurveys('Gate R7', GATE_QUESTIONS, [[64, [gateRow('yes')]], [65, [gateRow('maybe')]]]);
  const a = reviewBody('Gate R7', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  const b = { ...a, plan: [{ questionKey: 'gate', op: 'set', optionIds: ['maybe'] }] };
  const parked = parkFirstScan();
  const first = call('POST', edits(), asAdmin(a));
  await parked.inside;
  let reads = 0;
  hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
    if (this.model?.modelName === 'SurveyResponse' || this.model?.modelName === 'CanvassActivity') reads += 1;
    return real(...args);
  });
  let refused;
  try {
    refused = await withEnv({ ANSWER_EDIT_REVIEWS_AT_ONCE: '1' }, () => call('POST', edits(), asBea(b)));
  } finally {
    parked.release();
  }
  assert.strictEqual(refused.status, 503, JSON.stringify(refused.json));
  assert.strictEqual(refused.json.code, 'REVIEW_BUSY');
  assert.strictEqual(reads, 0, 'nothing read for it');
  assert.strictEqual((await first).status, 200);
});

test('P-m4: a review over the heavy line runs alone, and the form\'s own reads take a place too', { skip }, async () => {
  const ids = await ottoSurveys('Gate R7 Heavy', GATE_QUESTIONS, [[66, [gateRow('yes')]], [67, [gateRow('maybe')]]]);
  const heavy = reviewBody('Gate R7 Heavy', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  const light = { ...heavy, actionIds: [ids[0]], plan: [{ questionKey: 'gate', op: 'set', optionIds: ['maybe'] }] };
  // Opening the form names no survey: it is admitted only where its reads get a place.
  const form = { scope: heavy.scope, actionIds: [ids[1]], dryRun: true };
  await withEnv({ ANSWER_EDIT_HEAVY_REVIEW: '1' }, async () => {
    const parked = parkFirstScan();
    const first = call('POST', edits(), asAdmin(heavy));
    await parked.inside;
    let second;
    try {
      second = await call('POST', edits(), asBea(light));
    } finally {
      parked.release();
    }
    assert.strictEqual(second.status, 503, `a heavy review takes both places: ${JSON.stringify(second.json)}`);
    assert.strictEqual((await first).status, 200);
  });
  await withEnv({ ANSWER_EDIT_REVIEWS_AT_ONCE: '1' }, async () => {
    const parked = parkFirstScan();
    const first = call('POST', edits(), asAdmin(light));
    await parked.inside;
    let opened;
    try {
      opened = await call('POST', edits(), asBea(form));
    } finally {
      parked.release();
    }
    assert.strictEqual(opened.status, 503, `the form's reads wait their turn: ${JSON.stringify(opened.json)}`);
    assert.strictEqual((await first).status, 200);
  });
});
