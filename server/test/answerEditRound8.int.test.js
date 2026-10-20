import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Code review round 8 of Edit answers on Door Outcomes (2026-10-20), each finding pinned against the
// REAL app + a throwaway mongod — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §V. Most are the reviewers' own
// reproductions, asserting what the fix does:
//   npm run test:int -- test/answerEditRound8.int.test.js
//
// Redis points at a dead port, as everywhere here: a create or an undo answers 503 when it can't
// reach the queue, and the tests drive the REAL processors with the job id the run carries.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-r8';
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
const { processAnswerEditJob, reconcileFailedAnswerEditJob, removalBusy } = await import('../src/services/canvass/answerEditRuns.js');
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

  const org = await Organization.create({ name: 'Edit Org R8', slug: 'edit-org-r8', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'r8a@t.co', passwordHash: 'x', isActive: true });
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'r8b@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'r8c@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'r8o@t.co', passwordHash: 'x', isActive: true });
  for (const u of [admin, bea]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const otherTemplate = await SurveyTemplate.create({ organizationId: org._id, name: 'Other Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit R8', type: 'survey', state: 'FL', isActive: true,
    timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  for (const u of [cara, otto]) await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: u._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  // An earlier round, closed: its surveys sit beside round 1's in the same voters' slots (L-M2).
  const pass0 = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 0, name: 'Round 0', status: 'archived' });
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
    org, campaign, template, otherTemplate, pass, pass0, admin, bea, cara, otto, homes, voters, housemates,
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

const oid = (x) => new mongoose.Types.ObjectId(String(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const editOnProfileAs = async (as, voter, answers) => {
  const p = await call('GET', `/admin/voters/${voter._id}`, as());
  const s = p.json.surveys[0];
  const r = await call('PATCH', `/admin/voters/${voter._id}/surveys/${s.id}`, as({ answers, version: s.version }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
};
const itemFor = async (runId, d) => (await AnswerEditRunChunk.findOne({ runId }).lean()).items.find((x) => String(x.v) === String(ctx.voters[d]._id));
const saveIn = async (runId, d, answers) => step(runId, String((await itemFor(runId, d)).r), answers);
const runCopiesOf = async (runId, voter) =>
  (await copiesOf(voter, 'answer_edit')).filter((c) => String(c.answerEditRunId) === String(runId));
const undoNow = async (runId) => {
  assert.strictEqual((await undoPressed(runId)).status, 202);
  const jobId = (await AnswerEditRun.findById(runId).lean()).undo.jobId;
  return { jobId, out: await undoJob(runId, jobId) };
};
const putBackRows = async (since) => (await historySince('answerEditUndo', since)).filter((r) => /put back/.test(r.toValue));

// A first-build one-person session that saved this survey twice, its chunk as that build left it (only
// `a`, its latest copy), closed.
const firstBuildSession = async (d) => {
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow()]);
  await closeSession(runId);
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: { 'items.0.cq': '', 'items.0.as': '' } });
  return { runId, chunk };
};
// ...and the first build's one undo pass over it, as it left things: `summary` stored, `logged` in History.
const firstBuildUndid = async (runId, summary, logged) => {
  await AnswerEditRun.collection.updateOne(
    { _id: oid(runId) },
    {
      $set: {
        'undo.status': 'done', 'undo.jobId': 'old-build-1', 'undo.passes': 1, 'undo.lastRunAt': new Date(Date.now() - 1800_000),
        'undo.summary': { putBack: 0, changedSince: 0, restoredOnProfile: 0, waiting: 0, cleared: 0, erased: 0, gone: 0, names: [], ...summary },
      },
    }
  );
  const at = new Date(Date.now() - 1800_000);
  await CampaignChange.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, field: 'answerEditUndo', fromValue: 'edited', toValue: logged,
    byUserId: ctx.admin._id, source: 'answer_edit', createdAt: at, updatedAt: at,
  });
};

// ── the answer-edit undo's put-back record: provisional until its pass finishes the survey (W-B1, W-M2) ──

test('W-B1: an undo pass that dies after putting back the later of a session\'s two saves goes through the copies again — the survey goes back to the original', { skip }, async () => {
  const d = 1;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow('candidate_follow_up')]);
  await closeSession(runId);
  const since = new Date();
  // The pass dies at its re-read right after its first put-back — the later copy's.
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
  const died = (await AnswerEditRunChunk.findOne({ runId }).lean()).items[0];
  assert.ok(died.u && !died.us, 'a provisional put-back on its item');
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered'], 'the survey at the session\'s first save');
  // Redelivered: the original's copy is still landed on the survey, so it goes back too.
  const out = await undoJob(runId, jobId);
  assert.strictEqual(out.summary.putBack, 1);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], 'back at the original');
  assert.strictEqual((await runCopiesOf(runId, v)).length, 0, 'no copy of this run left');
  assert.strictEqual((await putBackRows(since)).length, 1);
  assert.strictEqual((await AnswerEditRunChunk.findOne({ runId }).lean()).items[0].us, true, 'and settled');
});

test('W-B1: a redelivered pass that can\'t put the older copy back still counts the put-back it already made', { skip }, async () => {
  const d = 8;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow('candidate_follow_up')]);
  await closeSession(runId);
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
  // Redelivered, and a teammate's edit lands just before the older copy's compare-and-swap.
  hookOnce(SurveyResponse.collection, 'updateOne', async (real, args) => {
    await real({ _id: args[0]._id }, { $set: { editedAt: new Date() } });
    return real(...args);
  });
  const out = await undoJob(runId, jobId);
  while (pending.length) pending.pop()();
  assert.strictEqual(out.summary.putBack, 1, 'its later copy went back in the pass that died');
  assert.strictEqual(out.summary.changedSince, 0);
});

test('W-M2: a settled put-back never reads erased later — another survey put back on Undo again still gets its History row', { skip }, async () => {
  const [x, y] = [2, 3];
  for (const d of [x, y]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const ids = [];
  for (const d of [x, y]) ids.push(String((await entryOf(ctx.voters[d], ctx.cara._id))._id));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Elm St' }), actionIds: ids, mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  // X saved twice, a teammate's profile edit in between; Y once.
  await saveIn(runId, x, [supportRow(), signRow('yard_sign_delivered')]);
  await editOnProfileAs(asBea, ctx.voters[x], [supportRow(), signRow('volunteer_request')]);
  await saveIn(runId, x, [supportRow(), signRow('candidate_follow_up')]);
  await saveIn(runId, y, [supportRow(), signRow('yard_sign_delivered')]);
  await closeSession(runId);
  // Y's visit unknocked: the first Undo waits on it there.
  const u = await unknockIds([(await visitEntry(y, ctx.cara._id))._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  const first = (await undoNow(runId)).out.summary;
  assert.strictEqual(first.putBack, 1, 'X, by its later copy');
  assert.strictEqual(first.waiting, 1, 'Y');
  // X's older copy — the original's — erased; the unknock undone; Undo again puts Y back.
  const [c1] = (await runCopiesOf(runId, ctx.voters[x])).sort((a, b) => a.overwrittenAt - b.overwrittenAt);
  assert.strictEqual((await eraseCopy(ctx.voters[x], c1._id)).status, 200);
  assert.strictEqual((await undoUnknock(u.json.run.id)).status, 200);
  const since = new Date();
  const again = (await undoNow(runId)).out.summary;
  assert.strictEqual(again.putBack, 2, 'X still put back, and Y');
  assert.strictEqual(again.erased, 0);
  assert.deepStrictEqual(await signOf(ctx.voters[y]), ['yard_sign_delivered', 'volunteer_request']);
  assert.strictEqual((await putBackRows(since)).length, 1, 'Y\'s put-back is in History');
});

// ── the first build's credit (W-m3, W-m6) and a session's own copies (W-m5) ──────────────────────

test('W-m3: a first-build put-back credit rides the put-back\'s own record — a pass that dies right after it logs nothing twice', { skip }, async () => {
  const d = 4;
  const v = ctx.voters[d];
  const { runId, chunk } = await firstBuildSession(d);
  // The first build's pass put back the later copy (the survey reads the first save, its mark off, no
  // receipt), kept the earlier one, and logged one survey put back.
  const latest = await SurveyResponseArchive.collection.findOne({ _id: chunk.items[0].a });
  const live = await liveOf(v);
  await SurveyResponse.collection.updateOne(
    { _id: live._id },
    { $set: { answers: latest.answers, editedBy: latest.editedBy ?? null, editedAt: latest.editedAt ?? null }, $pull: { answerEditMarks: latest._id } }
  );
  await SurveyResponseArchive.collection.deleteOne({ _id: latest._id });
  await firstBuildUndid(runId, { putBack: 1, changedSince: 1 }, '1 survey put back, 1 kept newer answers');
  const since = new Date();
  // This build's pass puts back the earlier copy and dies at the item's own `l` write that follows.
  hookAll(AnswerEditRunChunk, 'updateOne', (real, args) => {
    const keys = Object.keys(args[1]?.$set || {});
    if (keys.length === 1 && /^items\.\d+\.l$/.test(keys[0])) return Promise.reject(new MongoNetworkError('connection closed'));
    return real(...args);
  });
  assert.strictEqual((await undoPressed(runId)).status, 202);
  const jobId = (await AnswerEditRun.findById(runId).lean()).undo.jobId;
  await assert.rejects(undoJob(runId, jobId));
  while (pending.length) pending.pop()();
  const out = await undoJob(runId, jobId);
  assert.strictEqual(out.summary.putBack, 1);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], 'back at the original');
  assert.strictEqual((await putBackRows(since)).length, 0, 'the first build already logged it');
});

test('W-m6: no first-build credit where a profile Restore swapped answers in since — this build\'s put-back is logged', { skip }, async () => {
  const [a, b] = [5, 7];
  for (const d of [a, b]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const ids = [];
  for (const d of [a, b]) ids.push(String((await entryOf(ctx.voters[d], ctx.cara._id))._id));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Elm St' }), actionIds: ids, mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  for (const d of [a, b]) {
    await saveIn(runId, d, [supportRow(), signRow('yard_sign_delivered')]);
    await saveIn(runId, d, [supportRow(), signRow()]);
  }
  await closeSession(runId);
  // As the first build left the chunk: each item's latest copy only.
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: Object.fromEntries(chunk.items.flatMap((_, i) => [[`items.${i}.cq`, ''], [`items.${i}.as`, '']])) });
  const itemA = await itemFor(runId, a);
  const itemB = await itemFor(runId, b);
  // Otto re-surveys A; the first build's one pass keeps his newer answers there, puts B back by its latest
  // copy (B reads the first save, its mark off, no receipt), and logs one survey put back.
  assert.strictEqual((await survey(ctx.ottoTok, ctx.voters[a], a, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  const latestB = await SurveyResponseArchive.collection.findOne({ _id: itemB.a });
  const liveB = await liveOf(ctx.voters[b]);
  await SurveyResponse.collection.updateOne(
    { _id: liveB._id },
    { $set: { answers: latestB.answers, editedBy: latestB.editedBy ?? null, editedAt: latestB.editedAt ?? null }, $pull: { answerEditMarks: latestB._id } }
  );
  await SurveyResponseArchive.collection.deleteOne({ _id: latestB._id });
  await firstBuildUndid(runId, { putBack: 1, changedSince: 1 }, '1 survey put back, 1 kept newer answers');
  // Then Otto re-surveys B, and an admin restores A's latest copy on the profile: a full swap over Otto's.
  assert.strictEqual((await survey(ctx.ottoTok, ctx.voters[b], b, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  assert.strictEqual((await restoreCopy(ctx.voters[a], itemA.a)).status, 200);
  const since = new Date();
  const out = (await undoNow(runId)).out;
  assert.strictEqual(out.summary.putBack, 1, 'A, by its earliest copy');
  assert.deepStrictEqual(await signOf(ctx.voters[a]), ['yard_sign_delivered', 'volunteer_request'], 'back at the original');
  assert.strictEqual((await putBackRows(since)).length, 1, 'A\'s put-back was never logged by the first build');
});

test('W-m5: a first-build copy erased before this build\'s first save is still the session\'s — the Undo reads erased, not put back', { skip }, async () => {
  const d = 6;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow('candidate_follow_up')]);
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: { 'items.0.cq': '', 'items.0.as': '' } });
  // The original's copy erased, then this build saves the survey once more.
  const original = (await copiesOf(v, 'answer_edit')).find((c) => c.answers.find((a) => a.questionKey === 'yard_sign')?.optionIds.length === 2);
  assert.strictEqual((await eraseCopy(v, original._id)).status, 200);
  await step(runId, current.responseId, [supportRow(), signRow()]);
  await closeSession(runId);
  const out = (await undoNow(runId)).out;
  assert.strictEqual(out.summary.putBack, 0);
  assert.strictEqual(out.summary.erased, 1);
});

// ── an unknock's Undo never doubles a visit's entry (R-M1) ───────────────────────────────────────

const unknockedTwice = async (d) => {
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e1 = await visitEntry(d, ctx.cara._id);
  const u1 = await unknockIds([e1._id]);
  assert.strictEqual(u1.status, 201, JSON.stringify(u1.json));
  // Cara surveys the door again, and that is unknocked too.
  assert.strictEqual((await survey(ctx.caraTok, v, d, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  const e2 = await visitEntry(d, ctx.cara._id);
  const u2 = await unknockIds([e2._id]);
  assert.strictEqual(u2.status, 201, JSON.stringify(u2.json));
  return { v, e1, e2, u1: u1.json.run.id, u2: u2.json.run.id };
};

test('R-M1: two unknocks of one visit undone oldest first leave one entry — the later one\'s answers stay on the profile, restorable as a swap', { skip }, async () => {
  const d = 10;
  const { v, e1, u1, u2 } = await unknockedTwice(d);
  assert.strictEqual((await undoUnknock(u1)).status, 200);
  const later = await undoUnknock(u2);
  assert.strictEqual(later.status, 200, JSON.stringify(later.json));
  assert.strictEqual(later.json.run.counts.rowsNotRestored, 1);
  const left = await visitEntries(d, ctx.cara._id);
  assert.deepStrictEqual(left.map((x) => String(x._id)), [String(e1._id)], 'one entry, never two');
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request']);
  const copy = (await copiesOf(v, 'unknock')).find((c) => String(c.unknockRunId) === String(u2));
  assert.deepStrictEqual(await stateOf(copy), { restorable: true, reason: null });
});

test('R-M1: undone newest first, the newer survey stays current and the older entry stays off beside it', { skip }, async () => {
  const d = 11;
  const { v, e2, u1, u2 } = await unknockedTwice(d);
  assert.strictEqual((await undoUnknock(u2)).status, 200);
  const older = await undoUnknock(u1);
  assert.strictEqual(older.status, 200, JSON.stringify(older.json));
  assert.strictEqual(older.json.run.counts.rowsNotRestored, 1);
  assert.deepStrictEqual((await visitEntries(d, ctx.cara._id)).map((x) => String(x._id)), [String(e2._id)]);
  assert.deepStrictEqual(await signOf(v), ['candidate_follow_up']);
  const copy = (await copiesOf(v, 'unknock')).find((c) => String(c.unknockRunId) === String(u1));
  assert.deepStrictEqual(await stateOf(copy), { restorable: false, reason: 'kept_after_undo' });
});

test('R-M1: an Undo puts one of a visit\'s two entries back beside the other its strike recorded; a run from before that record leaves it off', { skip }, async () => {
  for (const [d, legacy] of [[12, false], [13, true]]) {
    assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
    const ea = await visitEntry(d, ctx.cara._id);
    // An older shape: a second entry at the same visit.
    const { _id, ...rest } = ea;
    const eb = await CanvassActivity.create({ ...rest, actionType: 'not_home', timestamp: new Date(new Date(ea.timestamp).getTime() + 1000) });
    const u = await unknockIds([ea._id]);
    assert.strictEqual(u.status, 201, JSON.stringify(u.json));
    const chunk = await UnknockRunChunk.findOne({ runId: u.json.run.id }).lean();
    assert.deepStrictEqual((chunk.coEntryIds || []).map(String), [String(eb._id)], 'the strike recorded the other entry');
    if (legacy) await UnknockRunChunk.collection.updateOne({ _id: chunk._id }, { $unset: { coEntryIds: '' } });
    const undone = await undoUnknock(u.json.run.id);
    assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
    assert.strictEqual(undone.json.run.counts.rowsNotRestored, legacy ? 1 : 0, `legacy ${legacy}`);
    assert.strictEqual((await visitEntries(d, ctx.cara._id)).length, legacy ? 1 : 2, `legacy ${legacy}`);
  }
});

test('R-M1: an entry recorded at a struck visit while the strike reads its entries is newer work to its Undo', { skip }, async () => {
  const d = 14;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e1 = await visitEntry(d, ctx.cara._id);
  const e2Id = new mongoose.Types.ObjectId();
  let fired = false;
  // Right after the strike's read of the full entries (no projection), an entry lands at the visit.
  hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
    const fields = this._fields;
    if (!fired && this.model?.modelName === 'CanvassActivity' && this.op === 'find' && this.getFilter()?._id?.$in && (!fields || !Object.keys(fields).length)) {
      fired = true;
      return real(...args).then(async (rows) => {
        await sleep(5);
        const { _id, ...rest } = e1;
        const now = new Date();
        await CanvassActivity.collection.insertOne({ ...rest, _id: e2Id, actionType: 'not_home', timestamp: now, createdAt: now, updatedAt: now });
        await sleep(5);
        return rows;
      });
    }
    return real(...args);
  });
  const u = await unknockIds([e1._id]);
  while (pending.length) pending.pop()();
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  assert.ok(fired);
  const undone = await undoUnknock(u.json.run.id);
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.rowsNotRestored, 1);
  assert.deepStrictEqual((await visitEntries(d, ctx.cara._id)).map((x) => String(x._id)), [String(e2Id)]);
});

// ── a conversion whose Undo has only claimed holds its answers (R-m2) ────────────────────────────

test('R-m2: a Surveyed → Not home conversion whose Undo has only claimed holds its answers — Restore can\'t swap them over a real later survey', { skip }, async () => {
  const d = 15;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  // Its door step stops after taking the answers, before its flip.
  hookOnce(CanvassActivity, 'bulkWrite', async () => { throw new MongoNetworkError('connection closed'); });
  await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e._id) }));
  while (pending.length) pending.pop()();
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [undecidedRow()])).status, 201);
  const copy = await SurveyResponseArchive.collection.findOne({ voterId: v._id, conversionRunId: oid(runId) });
  assert.ok(copy, 'the step took the answers');
  const was = (await SurveyConversionRun.findById(runId).lean()).status;
  // Its Undo's claim, before its checks and its enqueue.
  await SurveyConversionRun.collection.updateOne({ _id: oid(runId) }, { $set: { status: 'reverting' } });
  try {
    assert.strictEqual((await stateOf(copy)).restorable, false);
    const refused = await restoreCopy(v, copy._id);
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
    assert.ok(await byOtto(v), 'Otto\'s survey stays');
  } finally {
    // Given back (a refusal, a failed enqueue) — and never left Undoing for the tests after this one.
    await SurveyConversionRun.collection.updateOne({ _id: oid(runId) }, { $set: { status: was } });
  }
  // Still standing, still held.
  assert.strictEqual((await stateOf(copy)).restorable, false);
});

// ── every claim is let go however the checks after it end (C-m2, L-M1) ───────────────────────────

// Fail the Nth one-change-at-a-time read of the answer edits (answerEditBusy) outright.
const failEditBusyCall = (n) => {
  let calls = 0;
  hookAll(AnswerEditRun, 'exists', async (real, args) => {
    calls += 1;
    if (calls === n) throw new MongoNetworkError('connection closed');
    return real(...args);
  });
};

test('C-m2: an unknock Undo whose checks after its claim fail outright lets the claim go — the row never reads Undoing… for ten minutes', { skip }, async () => {
  const d = 16;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const u = await unknockIds([(await visitEntry(d, ctx.cara._id))._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  failEditBusyCall(2);
  const r = await undoUnknock(u.json.run.id);
  while (pending.length) pending.pop()();
  assert.strictEqual(r.status, 500, JSON.stringify(r.json));
  const run = await UnknockRun.findById(u.json.run.id).lean();
  assert.strictEqual(run.revertingAt ?? null, null, 'the claim let go');
  assert.strictEqual(run.undoBegunAt ?? null, null, 'never begun');
  assert.strictEqual(await removalBusy(ctx.campaign._id), null, 'nothing waits on it');
  assert.strictEqual((await undoUnknock(u.json.run.id)).status, 200, 'and Undo works once the database does');
});

test('L-M1: a conversion whose create, Pick up or Undo hits a database error after its claim gives the claim back', { skip }, async () => {
  // The create: its run goes with it.
  const d0 = 17;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d0], d0, FAKE())).status, 201);
  const e0 = await visitEntry(d0, ctx.cara._id);
  const before = await SurveyConversionRun.countDocuments({ campaignId: ctx.campaign._id });
  failEditBusyCall(2);
  const created = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'bulk', actionIds: [String(e0._id)] }));
  while (pending.length) pending.pop()();
  assert.strictEqual(created.status, 500, JSON.stringify(created.json));
  assert.strictEqual(await SurveyConversionRun.countDocuments({ campaignId: ctx.campaign._id }), before, 'no run left pending');
  // Pick up: a run whose enqueue failed goes back to failed.
  const parked = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'bulk', actionIds: [String(e0._id)] }));
  assert.strictEqual(parked.status, 503, JSON.stringify(parked.json));
  const failedId = parked.json.run.id;
  failEditBusyCall(2);
  const resumed = await call('POST', conv(`/${failedId}/resume`), asAdmin());
  while (pending.length) pending.pop()();
  assert.strictEqual(resumed.status, 500, JSON.stringify(resumed.json));
  assert.strictEqual((await SurveyConversionRun.findById(failedId).lean()).status, 'failed', 'parked back');
  await SurveyConversionRun.deleteOne({ _id: failedId });
  // Undo: a finished conversion goes back to completed.
  const d1 = 18;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d1], d1, FAKE())).status, 201);
  const runId = await convertDoorFromSurvey((await visitEntry(d1, ctx.cara._id))._id);
  const was = (await SurveyConversionRun.findById(runId).lean()).status;
  failEditBusyCall(2);
  const undo = await call('POST', conv(`/${runId}/revert`), asAdmin());
  while (pending.length) pending.pop()();
  assert.strictEqual(undo.status, 500, JSON.stringify(undo.json));
  assert.strictEqual((await SurveyConversionRun.findById(runId).lean()).status, was, 'parked back');
  assert.strictEqual(await removalBusy(ctx.campaign._id), null, 'nothing waits on it');
  assert.strictEqual((await call('POST', conv(`/${runId}/revert`), asAdmin())).status, 200, 'and Undo works once the database does');
});

// ── only a lock that clears or restores knocks holds a removal (C-m5, L-m4) ──────────────────────

test('C-m5: only a lock taken for a round\'s knocks holds a removal — a plain re-cut doesn\'t, and a books-only restore doesn\'t wait for an unknock', { skip }, async () => {
  await Pass.collection.updateOne({ _id: ctx.pass._id }, { $set: { recutLock: { lockedAt: new Date(), lockedBy: ctx.admin._id, token: 'x' } } });
  assert.strictEqual(await removalBusy(ctx.campaign._id), null, 'a plain re-cut');
  await Pass.collection.updateOne({ _id: ctx.pass._id }, { $set: { 'recutLock.knocks': true } });
  assert.strictEqual((await removalBusy(ctx.campaign._id))?.code, 'ANOTHER_CHANGE_RUNNING', 'clearing knocks');
  await Pass.collection.updateOne({ _id: ctx.pass._id }, { $unset: { recutLock: '' } });
  // A round with no books, and two snapshots of it: books only, and one that cleared knocks.
  const empty = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.pass.effortId, roundNumber: 5, name: 'Round 5', status: 'draft' });
  const snap = (clearedKnocks) => TurfSnapshot.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: empty._id, books: [], assignments: [], clearedKnocks });
  const booksOnly = await snap(false);
  const withKnocks = await snap(true);
  const removing = new mongoose.Types.ObjectId();
  await UnknockRun.collection.insertOne({
    _id: removing, organizationId: ctx.org._id, campaignId: ctx.campaign._id, status: 'pending', frozenRows: 1, counts: {}, heartbeatAt: new Date(),
    deletingAt: new Date(), stoppedAt: null, revertedAt: null, createdAt: new Date(), updatedAt: new Date(), __v: 0,
  });
  const restore = (s) => call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/restore-snapshot`, asAdmin({ snapshotId: String(s._id) }));
  const knocksRefused = await restore(withKnocks);
  const booksRestored = await restore(booksOnly);
  await UnknockRun.collection.deleteOne({ _id: removing });
  assert.strictEqual(knocksRefused.status, 409, JSON.stringify(knocksRefused.json));
  assert.strictEqual(booksRestored.status, 200, JSON.stringify(booksRestored.json));
  await TurfSnapshot.deleteMany({ passId: empty._id });
  await Pass.deleteOne({ _id: empty._id });
});

// ── the slots an undo writes into are read in the copies' own rounds (L-M2) ──────────────────────

// The undo's reads of the slots it writes into (by voter, the holder's fields) while `fn` runs: the filters.
const holderReadsDuring = async (fn) => {
  const filters = [];
  hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
    const f = this._fields || {};
    if (this.model?.modelName === 'SurveyResponse' && this.op === 'find' && this.getFilter()?.voterId?.$in && f.submittedAt && f.note) filters.push(this.getFilter());
    return real(...args);
  });
  const out = await fn();
  while (pending.length) pending.pop()();
  return { out, filters };
};
// The same voter surveyed in the earlier round too.
const roundZeroSurvey = async (d) => {
  const at = new Date(Date.now() - 40 * 3600_000);
  await SurveyResponse.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[d]._id, voterId: ctx.voters[d]._id, userId: ctx.otto._id,
    passId: ctx.pass0._id, surveyTemplateId: ctx.template._id, submittedAt: at, answers: [undecidedRow()], createdAt: at, updatedAt: at,
  });
};
const roundZeroOf = (d) => SurveyResponse.collection.findOne({ voterId: ctx.voters[d]._id, passId: ctx.pass0._id });

test('L-M2: a conversion Undo and an unknock Undo read the slots they write into in their copies\' own rounds — never every round\'s surveys', { skip }, async () => {
  const [dc, du] = [19, 20];
  for (const d of [dc, du]) {
    await roundZeroSurvey(d);
    assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  }
  const runId = await convertDoorFromSurvey((await visitEntry(dc, ctx.cara._id))._id);
  const convUndo = await holderReadsDuring(() => call('POST', conv(`/${runId}/revert`), asAdmin()));
  assert.strictEqual(convUndo.out.status, 200, JSON.stringify(convUndo.out.json));
  const u = await unknockIds([(await visitEntry(du, ctx.cara._id))._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  const unknockUndo = await holderReadsDuring(() => undoUnknock(u.json.run.id));
  assert.strictEqual(unknockUndo.out.status, 200, JSON.stringify(unknockUndo.out.json));
  for (const [name, { filters }] of [['conversion', convUndo], ['unknock', unknockUndo]]) {
    assert.ok(filters.length > 0, `${name}: read the slots`);
    for (const f of filters) assert.ok(f.passId, `${name}: by round ${JSON.stringify(f)}`);
  }
  for (const d of [dc, du]) {
    const back = await SurveyResponse.collection.findOne({ voterId: ctx.voters[d]._id, passId: ctx.pass._id });
    assert.deepStrictEqual(back.answers.find((a) => a.questionKey === 'yard_sign').optionIds, ['yard_sign_delivered', 'volunteer_request'], `door ${d}: put back`);
    assert.deepStrictEqual((await roundZeroOf(d)).answers, [undecidedRow()], `door ${d}: the earlier round untouched`);
  }
});

// ── an Undo waits while a round it touched sits cleared (L-M3) ───────────────────────────────────

// A round of its own at door `d`, with one book and Cara's surveyed entry there: a clear-knocks discard
// leaves its round with no entries, and only such a round's snapshot holds an Undo (round 9).
let clearedRoundNo = 200;
const roundOfItsOwn = async (d) => {
  clearedRoundNo += 1;
  const p = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.pass.effortId, roundNumber: clearedRoundNo, name: `Round ${clearedRoundNo}`, status: 'active' });
  await Turf.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: p._id, name: `Book ${clearedRoundNo}`, mode: 'manual', status: 'published', householdIds: [ctx.homes[d]._id], doorCount: 1 });
  const at = new Date(Date.now() - 3600_000);
  const e = await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[d]._id, voterId: ctx.voters[d]._id, userId: ctx.cara._id,
    actionType: 'survey_submitted', location: { lat: 28.2, lng: -82.1 + d * 0.001, accuracy: 6 }, timestamp: at, passId: p._id,
  });
  await SurveyResponse.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[d]._id, voterId: ctx.voters[d]._id, userId: ctx.cara._id,
    passId: p._id, surveyTemplateId: ctx.template._id, submittedAt: at, answers: FAKE(), createdAt: at, updatedAt: at,
  });
  return { pass: p, entry: e };
};
const discardClearing = async (p) => {
  const r = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/discard`, asAdmin({ passId: String(p._id), clearKnocks: true, confirmActive: true }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return r.json.snapshotId;
};
const restoreSnap = (id) => call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/restore-snapshot`, asAdmin({ snapshotId: String(id) }));

test('L-M3: an unknock Undo waits while a round it struck had its knocks cleared after it, until that snapshot is restored', { skip }, async () => {
  const d = 21;
  const { pass: p, entry: e } = await roundOfItsOwn(d);
  const u = await unknockIds([e._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  const snapId = await discardClearing(p);
  const refused = await undoUnknock(u.json.run.id);
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
  assert.strictEqual(refused.json.code, 'ROUND_CLEARED_SINCE');
  assert.match(refused.json.error, new RegExp(`Round ${clearedRoundNo}`), 'it names the round');
  const run = await UnknockRun.findById(u.json.run.id).lean();
  assert.strictEqual(run.revertedAt ?? null, null);
  assert.strictEqual(run.revertingAt ?? null, null, 'nothing claimed');
  assert.strictEqual(await visitEntry(d, ctx.cara._id), null, 'nothing put back');
  assert.strictEqual((await restoreSnap(snapId)).status, 200);
  assert.strictEqual((await undoUnknock(u.json.run.id)).status, 200);
  assert.ok(await CanvassActivity.exists({ _id: e._id }), 'the entry is back');
});

test('L-M3: a conversion Undo waits while a cleared, unrestored snapshot holds its work — and only its own', { skip }, async () => {
  const d = 22;
  const { pass: p, entry: e } = await roundOfItsOwn(d);
  const runId = await convertDoorFromSurvey(e._id);
  const was = (await SurveyConversionRun.findById(runId).lean()).status;
  // A cleared snapshot of another round, holding another run's copy, is no reason.
  const other = await TurfSnapshot.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: ctx.pass0._id, books: [], assignments: [], clearedKnocks: true,
    responseArchives: [{ conversionRunId: new mongoose.Types.ObjectId() }],
  });
  const snapId = await discardClearing(p);
  const refused = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
  assert.strictEqual(refused.json.code, 'ROUND_CLEARED_SINCE');
  assert.strictEqual((await SurveyConversionRun.findById(runId).lean()).status, was, 'nothing claimed');
  assert.strictEqual((await restoreSnap(snapId)).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/revert`), asAdmin())).status, 200);
  await TurfSnapshot.deleteOne({ _id: other._id });
});

// ── the console step's evidence (L-m5) ───────────────────────────────────────────────────────────

test('L-m5: the console step marks an older unknock that deleted the answers when a later one froze and removed its entries — though that one never stood', { skip }, async () => {
  const d = 23;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  // The older run copied and deleted the answers, and died before deleting its entries.
  const older = await firstBuildUnknockAt([e], new Date(Date.now() - 3 * 3600_000));
  await SurveyResponse.collection.deleteMany({ voterId: v._id, passId: ctx.pass._id });
  // A later one froze the same entry, found no answers to copy, removed the entry and died.
  const later = await firstBuildUnknockAt([e], new Date(Date.now() - 2 * 3600_000), { copies: false });
  await CanvassActivity.collection.deleteOne({ _id: e._id });
  const dry = await backfill(false);
  await backfill(true);
  assert.strictEqual(await markedByBackfill(older), true, dry);
  assert.strictEqual(await markedByBackfill(later), false, 'it left no copy: the residual');
});

// ── a clear-knocks discard and its restore take the lock for the knocks (C-m5) ───────────────────

test('C-m5: a discard that clears a round\'s knocks, and the restore that brings them back, hold removals while they write — a books-only discard doesn\'t', { skip }, async () => {
  const d = 45;
  const round = async (n) => {
    const p = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.pass.effortId, roundNumber: n, name: `Round ${n}`, status: 'active' });
    await Turf.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: p._id, name: `Book ${n}`, mode: 'manual', status: 'published', householdIds: [ctx.homes[d]._id], doorCount: 1 });
    await CanvassActivity.create({
      organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[d]._id, voterId: ctx.voters[d]._id, userId: ctx.otto._id,
      actionType: 'not_home', location: { lat: 28.2, lng: -82.1 + d * 0.001, accuracy: 6 }, timestamp: new Date(), passId: p._id,
    });
    return p;
  };
  const probe = [];
  const busyNow = async () => probe.push((await removalBusy(ctx.campaign._id))?.code ?? null);
  const discard = (p, clearKnocks) => call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/discard`, asAdmin({ passId: String(p._id), clearKnocks, confirmActive: true }));
  const cleared = await round(6);
  const booksOnly = await round(7);
  hookAll(TurfSnapshot, 'create', async (real, args) => { await busyNow(); return real(...args); });
  const c = await discard(cleared, true);
  const b = await discard(booksOnly, false);
  while (pending.length) pending.pop()();
  assert.strictEqual(c.status, 200, JSON.stringify(c.json));
  assert.strictEqual(b.status, 200, JSON.stringify(b.json));
  assert.deepStrictEqual(probe, ['ANOTHER_CHANGE_RUNNING', null], 'only the knock-clearing discard holds removals');
  probe.length = 0;
  hookAll(CanvassActivity.collection, 'insertMany', async (real, args) => { await busyNow(); return real(...args); });
  const restored = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/restore-snapshot`, asAdmin({ snapshotId: c.json.snapshotId }));
  while (pending.length) pending.pop()();
  assert.strictEqual(restored.status, 200, JSON.stringify(restored.json));
  assert.deepStrictEqual(probe, ['ANOTHER_CHANGE_RUNNING'], 'and so does the restore that brings them back');
  assert.strictEqual(await removalBusy(ctx.campaign._id), null, 'until it lets go');
});

// ── reviews: one read per batch whatever the crew, and places on arrival (P-M1, P-m2, P-m3, P-m4) ─

// A filter in tripleClause's shape: one branch per round and canvasser, its doors an `$in`.
const perCanvasser = (f) => Array.isArray(f?.$or) && f.$or.some((b) => b && 'userId' in b && b.householdId?.$in);
const visitReadsDuring = async (fn) => {
  const filters = [];
  hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
    if (['SurveyResponse', 'CanvassActivity'].includes(this.model?.modelName)) filters.push(this.getFilter());
    return real(...args);
  });
  const out = await fn();
  while (pending.length) pending.pop()();
  return { out, filters };
};

test('P-M1: the reviews read a batch of visits with one clause, whatever the crew — and another canvasser\'s survey at a selected door stays out', { skip }, async () => {
  const [d1, d2] = [60, 61];
  // Cara and Otto each survey one person at the same two doors, in the same round.
  for (const d of [d1, d2]) {
    assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
    assert.strictEqual((await survey(ctx.ottoTok, ctx.housemates[d], d, FAKE())).status, 201);
  }
  const cara1 = await visitEntry(d1, ctx.cara._id);
  const otto2 = await visitEntry(d2, ctx.otto._id);
  // The answer-edit form and its priced review, for Cara's visit at one door and Otto's at the other.
  const scope = { search: 'Elm St', outcomes: ['survey_submitted'] };
  const ids = [String(cara1._id), String(otto2._id)];
  const form = await visitReadsDuring(() => call('POST', edits(), asAdmin({ scope, actionIds: ids, dryRun: true })));
  assert.strictEqual(form.out.status, 200, JSON.stringify(form.out.json));
  assert.strictEqual(form.out.json.surveys[0].responses, 2, 'one survey a visit: the other canvasser\'s at each door stays out');
  const priced = await visitReadsDuring(() => call('POST', edits(), asAdmin({
    scope, actionIds: ids, surveyTemplateId: String(ctx.template._id), plan: TAKE_OUT, dryRun: true,
  })));
  assert.strictEqual(priced.out.status, 200, JSON.stringify(priced.out.json));
  assert.strictEqual(priced.out.json.responses, 2);
  // A Surveyed → Not home review and an unknock review of the same two visits.
  const convDry = await visitReadsDuring(() => call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'bulk', actionIds: ids, dryRun: true })));
  assert.strictEqual(convDry.out.status, 200, JSON.stringify(convDry.out.json));
  assert.strictEqual(convDry.out.json.survey.responsesToArchive, 2);
  const unknockDry = await visitReadsDuring(() => call('POST', unknocks(), asAdmin({ scope: {}, actionIds: ids, dryRun: true })));
  assert.strictEqual(unknockDry.out.status, 200, JSON.stringify(unknockDry.out.json));
  assert.strictEqual(unknockDry.out.json.survey.responsesToArchive, 2);
  for (const [name, { filters }] of [['form', form], ['priced', priced], ['conversion', convDry], ['unknock', unknockDry]]) {
    assert.ok(!filters.some(perCanvasser), `${name}: no branch per round and canvasser`);
  }
});

test('P-m2: with no place free, opening the form is refused before it reads a single survey', { skip }, async () => {
  const ids = await ottoSurveys('Gate R8', GATE_QUESTIONS, [[50, [gateRow('yes')]], [51, [gateRow('maybe')]]]);
  const a = reviewBody('Gate R8', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  // The form's first open names no survey.
  const form = { scope: a.scope, actionIds: [ids[1]], dryRun: true };
  await withEnv({ ANSWER_EDIT_REVIEWS_AT_ONCE: '1' }, async () => {
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
      refused = await call('POST', edits(), asBea(form));
    } finally {
      while (pending.length) pending.pop()();
      parked.release();
    }
    assert.strictEqual(refused.status, 503, JSON.stringify(refused.json));
    assert.strictEqual(refused.json.code, 'REVIEW_BUSY');
    assert.strictEqual(reads, 0, 'nothing read for it');
    assert.strictEqual((await first).status, 200);
  });
});

test('P-m3: a priced review of a campaign over the heavy line runs alone, whatever its selection; opening the form doesn\'t', { skip }, async () => {
  const ids = await ottoSurveys('Gate R8 Campaign', GATE_QUESTIONS, [[52, [gateRow('yes')]], [53, [gateRow('maybe')]]]);
  const one = reviewBody('Gate R8 Campaign', [ids[0]], [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  const other = { ...one, actionIds: [ids[1]] };
  const form = { scope: one.scope, actionIds: [ids[1]], dryRun: true };
  // A campaign of 50,000 surveys, by its numbers — over the 25,000 line.
  const was = (await Campaign.findById(ctx.campaign._id).lean()).stats?.surveyCount ?? 0;
  await Campaign.collection.updateOne({ _id: ctx.campaign._id }, { $set: { 'stats.surveyCount': 50000 } });
  try {
    const parked = parkFirstScan();
    const first = call('POST', edits(), asAdmin(form));
    await parked.inside;
    let second;
    let opened;
    try {
      second = await call('POST', edits(), asBea(one));
    } finally {
      parked.release();
    }
    assert.strictEqual(second.status, 503, `a priced review of this campaign needs both places: ${JSON.stringify(second.json)}`);
    assert.strictEqual((await first).status, 200);
    // Unpriced, it isn't heavy: two form opens side by side.
    const parked2 = parkFirstScan();
    const first2 = call('POST', edits(), asAdmin(form));
    await parked2.inside;
    try {
      opened = await call('POST', edits(), asBea({ ...form, actionIds: [ids[0]] }));
    } finally {
      parked2.release();
    }
    assert.strictEqual(opened.status, 200, JSON.stringify(opened.json));
    assert.strictEqual((await first2).status, 200);
    assert.strictEqual((await call('POST', edits(), asAdmin(other))).status, 200, 'alone, it runs');
  } finally {
    await Campaign.collection.updateOne({ _id: ctx.campaign._id }, { $set: { 'stats.surveyCount': was } });
  }
});

test('P-m4: a priced review never joins One person at a time\'s review of the same selection — it answers with its price', { skip }, async () => {
  const ids = await ottoSurveys('Gate R8 Mode', GATE_QUESTIONS, [[54, [gateRow('yes')]], [55, [gateRow('maybe')]]]);
  const bulk = reviewBody('Gate R8 Mode', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  const queue = { ...bulk, mode: 'queue' };
  const parked = parkFirstScan();
  const first = call('POST', edits(), asAdmin(queue));
  await parked.inside;
  let priced;
  try {
    priced = call('POST', edits(), asBea({ ...bulk, mode: 'bulk' }));
    await sleep(200);
  } finally {
    parked.release();
  }
  assert.strictEqual((await first).status, 200);
  const r = await priced;
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.price, 'its own review, priced');
});

test('P-m2: a press that joins the same review already running gives its place back — another review then has room', { skip }, async () => {
  const ids = await ottoSurveys('Gate R8 Join', GATE_QUESTIONS, [[56, [gateRow('yes')]], [57, [gateRow('maybe')]]]);
  const a = reviewBody('Gate R8 Join', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  // The same review pressed without its survey named: it takes a place on arrival, then finds A running.
  const { surveyTemplateId, ...unnamed } = a;
  const c = { ...a, plan: [{ questionKey: 'gate', op: 'set', optionIds: ['maybe'] }] };
  const parked = parkFirstScan();
  const first = call('POST', edits(), asAdmin(a));
  await parked.inside;
  let joined;
  let other;
  try {
    let presentReads = 0;
    hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
      if (this.model?.modelName === 'SurveyResponse' && this._fields?.surveyTemplateId === 1 && !this._fields?.answers) presentReads += 1;
      return real(...args);
    });
    joined = call('POST', edits(), asBea(unnamed));
    for (let i = 0; i < 100 && !presentReads; i += 1) await sleep(20);
    while (pending.length) pending.pop()();
    await sleep(300);
    other = await call('POST', edits(), asBea(c));
  } finally {
    parked.release();
  }
  assert.strictEqual(other.status, 200, `room for another review: ${JSON.stringify(other.json)}`);
  assert.strictEqual((await first).status, 200);
  const j = await joined;
  assert.strictEqual(j.status, 200, JSON.stringify(j.json));
  assert.strictEqual(j.json.digest, (await first).json.digest, 'it joined the running review');
});
