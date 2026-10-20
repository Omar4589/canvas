import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Code review round 9 of Edit answers on Door Outcomes (2026-10-20), each finding pinned against the
// REAL app + a throwaway mongod — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §V. Most are the reviewers' own
// reproductions, asserting what the fix does:
//   npm run test:int -- test/answerEditRound9.int.test.js
//
// Redis points at a dead port, as everywhere here: a create or an undo answers 503 when it can't
// reach the queue, and the tests drive the REAL processors with the job id the run carries.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-r9';
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
const { ReclassifyRun } = await import('../src/models/ReclassifyRun.js');
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
    UnknockRun, UnknockRunChunk, ReclassifyRun, AnswerEditRun, AnswerEditRunChunk, CampaignChange, Subscription,
  ]) {
    await M.deleteMany({});
  }
  await SurveyResponse.init();
  await SurveyResponseArchive.init();
  await AnswerEditRunChunk.init();

  const org = await Organization.create({ name: 'Edit Org R9', slug: 'edit-org-r9', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'r9a@t.co', passwordHash: 'x', isActive: true });
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'r9b@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'r9c@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'r9o@t.co', passwordHash: 'x', isActive: true });
  for (const u of [admin, bea]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const otherTemplate = await SurveyTemplate.create({ organizationId: org._id, name: 'Other Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit R9', type: 'survey', state: 'FL', isActive: true,
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
    org, campaign, template, otherTemplate, pass, pass0, effort, admin, bea, cara, otto, homes, voters, housemates,
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
const undoNow = async (runId) => {
  assert.strictEqual((await undoPressed(runId)).status, 202);
  const jobId = (await AnswerEditRun.findById(runId).lean()).undo.jobId;
  return { jobId, out: await undoJob(runId, jobId) };
};
const putBackRows = async (since) => (await historySince('answerEditUndo', since)).filter((r) => /put back/.test(r.toValue));
// Hold the first call to any of these methods until released (a removal's survey delete was a deleteMany
// before round 9 and is a bulkWrite since, so a pin holds either).
const holdFirst = (obj, methods) => {
  const inside = deferred();
  const release = deferred();
  let held = false;
  for (const m of methods) {
    hookOnce(obj, m, async (real, args) => {
      if (!held) {
        held = true;
        inside.resolve();
        await release.p;
      }
      return real(...args);
    });
  }
  return { inside: inside.p, release: release.resolve };
};
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${what} never happened`); })]);

// A round of its own at door `d`, with one book and Cara's entry (and survey) there.
let roundNo = 100;
const freshRound = async (d, { actionType = 'survey_submitted' } = {}) => {
  roundNo += 1;
  const p = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.effort._id, roundNumber: roundNo, name: `Round ${roundNo}`, status: 'active' });
  await Turf.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: p._id, name: `Book ${roundNo}`, mode: 'manual', status: 'published', householdIds: [ctx.homes[d]._id], doorCount: 1 });
  const at = new Date(Date.now() - 3600_000);
  const e = await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[d]._id, voterId: ctx.voters[d]._id, userId: ctx.cara._id,
    actionType, location: { lat: 28.2, lng: -82.1 + d * 0.001, accuracy: 6 }, timestamp: at, passId: p._id,
  });
  if (actionType === 'survey_submitted') {
    await SurveyResponse.collection.insertOne({
      organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[d]._id, voterId: ctx.voters[d]._id, userId: ctx.cara._id,
      passId: p._id, surveyTemplateId: ctx.template._id, submittedAt: at, answers: FAKE(), createdAt: at, updatedAt: at,
    });
  }
  return { pass: p, entry: e };
};
const discardClearing = async (p) => {
  const r = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/discard`, asAdmin({ passId: String(p._id), clearKnocks: true, confirmActive: true }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return r.json.snapshotId;
};
const restoreSnap = (id) => call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/restore-snapshot`, asAdmin({ snapshotId: String(id) }));
const knockAgain = (p, d) =>
  CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[d]._id, voterId: ctx.voters[d]._id, userId: ctx.otto._id,
    actionType: 'not_home', location: { lat: 28.2, lng: -82.1 + d * 0.001, accuracy: 6 }, timestamp: new Date(), passId: p._id,
  });
const caraIn = (p) => CanvassActivity.exists({ passId: p._id, userId: ctx.cara._id });

// ── a removal never deletes a survey a profile Restore swapped in meanwhile (R-M2) ───────────────

// Cara surveys the person, then Otto does: his answers hold the slot, Cara's are a card.
const teammateCard = async (d) => {
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [undecidedRow()])).status, 201);
  const card = (await copiesOf(v)).find((c) => String(c.userId) === String(ctx.cara._id));
  assert.ok(card, "Cara's answers are a card");
  return { v, card, ottoEntry: await visitEntry(d, ctx.otto._id) };
};
const caraBack = async (v) => {
  const live = await liveOf(v);
  assert.ok(live, 'the restored survey is on file');
  assert.strictEqual(String(live.userId), String(ctx.cara._id));
  assert.deepStrictEqual(live.answers.find((a) => a.questionKey === 'yard_sign').optionIds, ['yard_sign_delivered', 'volunteer_request']);
};

test('R-M2: a profile Restore that swaps a teammate\'s card into the slot while an unknock removes the survey there keeps its answers', { skip }, async () => {
  const { v, card, ottoEntry } = await teammateCard(1);
  const held = holdFirst(SurveyResponse.collection, ['bulkWrite', 'deleteMany']);
  const strike = call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.otto._id) }, actionIds: [String(ottoEntry._id)] }));
  let restored;
  try {
    await within(held.inside, 10000, "the strike's survey delete");
    restored = await restoreCopy(v, card._id);
  } finally {
    held.release();
  }
  while (pending.length) pending.pop()();
  assert.strictEqual(restored.status, 200, JSON.stringify(restored.json));
  assert.strictEqual((await strike).status, 201);
  await caraBack(v);
  assert.ok((await copiesOf(v, 'unknock')).some((c) => String(c.userId) === String(ctx.otto._id)), "Otto's struck answers are kept");
});

test('R-M2: the same Restore during a Surveyed → Not home door step keeps its answers', { skip }, async () => {
  const { v, card, ottoEntry } = await teammateCard(2);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(ottoEntry._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  const held = holdFirst(SurveyResponse.collection, ['bulkWrite', 'deleteMany']);
  const stepped = call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(ottoEntry._id) }));
  let restored;
  try {
    await within(held.inside, 10000, "the step's survey delete");
    restored = await restoreCopy(v, card._id);
  } finally {
    held.release();
  }
  while (pending.length) pending.pop()();
  assert.strictEqual(restored.status, 200, JSON.stringify(restored.json));
  assert.strictEqual((await stepped).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  await caraBack(v);
});

// ── an undo never settles a put-back while its survey is off file (W9-M1), and a receipt counts (W9-m2) ─

test('W9-M1: Retry undo on a survey a later change took reads waiting — and once that change is undone, Undo again puts the original back', { skip }, async () => {
  const d = 3;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow('candidate_follow_up')]);
  await closeSession(runId);
  // The pass dies right after putting back the later save's copy; its retries run out.
  let reads = 0;
  hookAll(SurveyResponse.collection, 'findOne', (real, args) => {
    reads += 1;
    if (reads === 1) return Promise.reject(new MongoNetworkError('connection closed'));
    return real(...args);
  });
  assert.strictEqual((await undoPressed(runId)).status, 202);
  await assert.rejects(undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId));
  while (pending.length) pending.pop()();
  await AnswerEditRun.collection.updateOne({ _id: oid(runId) }, { $set: { 'undo.status': 'failed' } });
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered'], 'at the session\'s first save');
  // The visit is unknocked meanwhile: the survey goes, the original's copy still landed on it.
  const u = await unknockIds([(await visitEntry(d, ctx.cara._id))._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  const retry = (await undoNow(runId)).out.summary;
  assert.strictEqual(retry.waiting, 1, 'waiting on the unknock');
  assert.strictEqual(retry.putBack, 0, 'not put back yet');
  assert.ok(!(await AnswerEditRunChunk.findOne({ runId }).lean()).items[0].us, 'never settled');
  assert.strictEqual((await undoUnknock(u.json.run.id)).status, 200);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered'], 'back, still at the first save');
  const again = (await undoNow(runId)).out.summary;
  assert.strictEqual(again.putBack, 1);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], 'back at the original');
});

test('W9-M1: Retry undo on a survey a clear-knocks discard took, with the session\'s earlier copy, reads cleared — never put back', { skip }, async () => {
  const d = 20;
  const { pass: p, entry: e } = await freshRound(d);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: `${d + 1} Elm St` }), actionIds: [String(e._id)], mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  const rid = created.json.current.responseId;
  await step(runId, rid, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, rid, [supportRow(), signRow('candidate_follow_up')]);
  await closeSession(runId);
  let reads = 0;
  hookAll(SurveyResponse.collection, 'findOne', (real, args) => {
    reads += 1;
    if (reads === 1) return Promise.reject(new MongoNetworkError('connection closed'));
    return real(...args);
  });
  assert.strictEqual((await undoPressed(runId)).status, 202);
  await assert.rejects(undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId));
  while (pending.length) pending.pop()();
  await AnswerEditRun.collection.updateOne({ _id: oid(runId) }, { $set: { 'undo.status': 'failed' } });
  // The round's knocks are cleared: the survey and the original's copy go into its snapshot.
  await discardClearing(p);
  const retry = (await undoNow(runId)).out.summary;
  assert.strictEqual(retry.cleared, 1, 'cleared with its round');
  assert.strictEqual(retry.putBack, 0);
  assert.ok(!(await AnswerEditRunChunk.findOne({ runId }).lean()).items[0].us, 'never settled');
});

test('W9-m2: a put-back proven only by its receipt counts — its record failed and its copy went', { skip }, async () => {
  const d = 4;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await editOnProfileAs(asBea, v, [supportRow(), signRow('volunteer_request')]);
  await step(runId, current.responseId, [supportRow(), signRow('candidate_follow_up')]);
  await closeSession(runId);
  const since = new Date();
  // The put-back's record fails; the copy's delete, sent with it, lands.
  let failed = false;
  hookAll(AnswerEditRunChunk, 'updateOne', (real, args) => {
    const keys = Object.keys(args[1]?.$set || {});
    if (!failed && keys.some((k) => /^items\.\d+\.u$/.test(k)) && !keys.some((k) => /\.us$/.test(k))) {
      failed = true;
      return Promise.reject(new MongoNetworkError('connection closed'));
    }
    return real(...args);
  });
  assert.strictEqual((await undoPressed(runId)).status, 202);
  const jobId = (await AnswerEditRun.findById(runId).lean()).undo.jobId;
  await assert.rejects(undoJob(runId, jobId));
  while (pending.length) pending.pop()();
  assert.ok(failed);
  const out = await undoJob(runId, jobId);
  assert.strictEqual(out.summary.putBack, 1, 'the later save is put back');
  assert.deepStrictEqual(await signOf(v), ['volunteer_request'], "back at Bea's answers, the original kept as history");
  assert.strictEqual((await putBackRows(since)).length, 1);
});

// ── a cleared round holds an Undo only while it can take its snapshot back (L9-M1, L9-M2) ────────

test('L9-M1: once the round was knocked again, an unknock Undo goes ahead and leaves it alone — and the snapshot can\'t be restored over the new knocks', { skip }, async () => {
  const d = 5;
  const { pass: p, entry: e } = await freshRound(d);
  const u = await unknockIds([e._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  const snapId = await discardClearing(p);
  await knockAgain(p, d);
  const undone = await undoUnknock(u.json.run.id);
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.rowsNotRestored, 1);
  assert.strictEqual(await caraIn(p), null, 'nothing put back into the re-worked round');
  const restored = await restoreSnap(snapId);
  assert.strictEqual(restored.status, 409, JSON.stringify(restored.json));
  assert.strictEqual(restored.json.code, 'SNAPSHOT_ROUND_KNOCKED');
});

test('L9-M1: an unknock Undo goes ahead past a round deleted, or archived, since its knocks were cleared', { skip }, async () => {
  for (const [d, end] of [[6, 'deleted'], [7, 'archived']]) {
    const { pass: p, entry: e } = await freshRound(d);
    const u = await unknockIds([e._id]);
    assert.strictEqual(u.status, 201, JSON.stringify(u.json));
    await discardClearing(p);
    if (end === 'deleted') await Pass.deleteOne({ _id: p._id });
    else await Pass.updateOne({ _id: p._id }, { $set: { status: 'archived' } });
    const undone = await undoUnknock(u.json.run.id);
    assert.strictEqual(undone.status, 200, `${end}: ${JSON.stringify(undone.json)}`);
    assert.strictEqual(await caraIn(p), null, `${end}: no entry put back into it`);
  }
});

test('L9-M1: a cleared snapshot holding a change undone after it can\'t be restored', { skip }, async () => {
  const d = 8;
  const { pass: p, entry: e } = await freshRound(d);
  const u = await unknockIds([e._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  const snapId = await discardClearing(p);
  // Knocked again, so the Undo goes ahead; then that round is emptied again.
  await knockAgain(p, d);
  assert.strictEqual((await undoUnknock(u.json.run.id)).status, 200);
  await CanvassActivity.deleteMany({ passId: p._id });
  const restored = await restoreSnap(snapId);
  assert.strictEqual(restored.status, 409, JSON.stringify(restored.json));
  assert.strictEqual(restored.json.code, 'SNAPSHOT_HOLDS_UNDONE_CHANGE');
});

test('L9-M2: a relabel\'s Undo waits while a round holding its entries sits cleared with a snapshot it can take back', { skip }, async () => {
  const d = 9;
  const { pass: p, entry: e } = await freshRound(d, { actionType: 'not_home' });
  const rc = await call('POST', `/admin/campaigns/${ctx.campaign._id}/reclassify-outcomes`, asAdmin({ to: 'refused', scope: { outcomes: ['not_home'] }, actionIds: [String(e._id)] }));
  assert.strictEqual(rc.status, 201, JSON.stringify(rc.json));
  const run = await ReclassifyRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  const snapId = await discardClearing(p);
  const revert = () => call('POST', `/admin/campaigns/${ctx.campaign._id}/reclassify-outcomes/revert`, asAdmin({ runId: String(run._id) }));
  const refused = await revert();
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
  assert.strictEqual(refused.json.code, 'ROUND_CLEARED_SINCE');
  assert.match(refused.json.error, new RegExp(`North · Round ${roundNo}`));
  assert.strictEqual((await restoreSnap(snapId)).status, 200);
  assert.strictEqual((await revert()).status, 200);
  assert.strictEqual((await CanvassActivity.findById(e._id).lean()).actionType, 'not_home', 'relabel undone');
});

// ── the undos read their copies a page of voters at a time (L9-M3) ───────────────────────────────

test('L9-M3: an unknock Undo and a Surveyed → Not home Undo put every survey back a page of voters at a time', { skip }, async () => {
  const unk = [10, 11, 12];
  const cv = [13, 14, 15];
  for (const d of [...unk, ...cv]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const u = await unknockIds(await Promise.all(unk.map(async (d) => (await visitEntry(d, ctx.cara._id))._id)));
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  const ids = await Promise.all(cv.map(async (d) => String((await visitEntry(d, ctx.cara._id))._id)));
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: ids }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  for (const id of ids) assert.strictEqual((await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: id }))).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  await withEnv({ UNDO_VOTER_PAGE: '1' }, async () => {
    const undone = await undoUnknock(u.json.run.id);
    assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
    assert.strictEqual(undone.json.run.counts.responsesNotRestored, 0);
    const reverted = await call('POST', conv(`/${runId}/revert`), asAdmin());
    assert.strictEqual(reverted.status, 200, JSON.stringify(reverted.json));
    assert.strictEqual(reverted.json.run.counts.responsesNotRestored, 0);
  });
  for (const d of [...unk, ...cv]) assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request'], `door ${d}`);
});

// ── the wire and the waits (C9-m1, C9-m2, C9-m3, C9-m4, L9-m4, R-m3) ────────────────────────────

test('C9-m1: an unknock Undo that stops part-way answers with the moment it stopped', { skip }, async () => {
  const d = 16;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const u = await unknockIds([(await visitEntry(d, ctx.cara._id))._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  let failedAt = null;
  hookOnce(SurveyResponse.collection, 'insertMany', async () => {
    failedAt = new Date();
    throw new MongoNetworkError('connection closed');
  });
  const r = await undoUnknock(u.json.run.id);
  while (pending.length) pending.pop()();
  assert.strictEqual(r.status, 500, JSON.stringify(r.json));
  assert.strictEqual(r.json.code, 'UNDO_STOPPED');
  assert.ok(failedAt && new Date(r.json.run.updatedAt) >= failedAt, `${r.json.run.updatedAt} is when it stopped, not when it began`);
});

test('C9-m2: a priced review of a big campaign takes both places as it arrives — beside another review, refused before it reads a survey', { skip }, async () => {
  const ids = await ottoSurveys('Gate R9 Big', GATE_QUESTIONS, [[50, [gateRow('yes')]], [51, [gateRow('maybe')]]]);
  const priced = reviewBody('Gate R9 Big', [ids[0]], [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  const form = { scope: priced.scope, actionIds: [ids[1]], dryRun: true };
  const was = (await Campaign.findById(ctx.campaign._id).lean()).stats?.surveyCount ?? 0;
  await Campaign.collection.updateOne({ _id: ctx.campaign._id }, { $set: { 'stats.surveyCount': 50000 } });
  try {
    const parked = parkFirstScan();
    const first = call('POST', edits(), asAdmin(form));
    await parked.inside;
    let reads = 0;
    hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
      if (this.model?.modelName === 'SurveyResponse' || this.model?.modelName === 'CanvassActivity') reads += 1;
      return real(...args);
    });
    let refused;
    try {
      refused = await call('POST', edits(), asBea(priced));
    } finally {
      while (pending.length) pending.pop()();
      parked.release();
    }
    assert.strictEqual(refused.status, 503, JSON.stringify(refused.json));
    assert.strictEqual(reads, 0, 'nothing read for it');
    assert.strictEqual((await first).status, 200);
  } finally {
    await Campaign.collection.updateOne({ _id: ctx.campaign._id }, { $set: { 'stats.surveyCount': was } });
  }
});

test('C9-m3: Turf Cutting lists an unrestored snapshot that cleared knocks, however many re-cuts came after', { skip }, async () => {
  const p = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.effort._id, roundNumber: 90, name: 'Round 90', status: 'draft' });
  const base = { organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: p._id, books: [], assignments: [] };
  const clearing = await TurfSnapshot.create({ ...base, clearedKnocks: true });
  await TurfSnapshot.collection.updateOne({ _id: clearing._id }, { $set: { createdAt: new Date(Date.now() - 3600_000) } });
  for (let i = 0; i < 10; i += 1) await TurfSnapshot.create({ ...base, clearedKnocks: false });
  const listed = await call('GET', `/admin/campaigns/${ctx.campaign._id}/turfs/snapshots?passId=${p._id}`, asAdmin());
  assert.strictEqual(listed.status, 200, JSON.stringify(listed.json));
  assert.ok(listed.json.snapshots.some((x) => String(x._id) === String(clearing._id)), 'the knock-clearing snapshot is listed');
  assert.strictEqual(listed.json.snapshots.length, 11);
  await TurfSnapshot.deleteMany({ passId: p._id });
  await Pass.deleteOne({ _id: p._id });
});

test('C9-m4: a strike whose busy check fails and whose own delete fails too reads stopped at once — nothing waits ten minutes', { skip }, async () => {
  const d = 17;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  let calls = 0;
  hookAll(AnswerEditRun, 'exists', async (real, args) => {
    calls += 1;
    if (calls === 2) throw new MongoNetworkError('connection closed');
    return real(...args);
  });
  hookOnce(UnknockRun, 'deleteOne', async () => { throw new MongoNetworkError('connection closed'); });
  const r = await unknockIds([(await visitEntry(d, ctx.cara._id))._id]);
  while (pending.length) pending.pop()();
  assert.strictEqual(r.status, 503, JSON.stringify(r.json));
  assert.strictEqual(r.json.code, 'UNKNOCK_NOT_STARTED');
  const run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  assert.ok(run?.stoppedAt, 'stamped stopped');
  assert.strictEqual(await removalBusy(ctx.campaign._id), null, 'nothing waits on it');
  await UnknockRun.deleteOne({ _id: run._id });
});

test('L9-m4: a books-only snapshot restores beside a one-person answer-edit session left open', { skip }, async () => {
  const d = 18;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const { runId } = await openSession(d);
  const p = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.effort._id, roundNumber: 91, name: 'Round 91', status: 'draft' });
  const snap = await TurfSnapshot.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: p._id, books: [], assignments: [], clearedKnocks: false });
  const restored = await restoreSnap(snap._id);
  await closeSession(runId);
  assert.strictEqual(restored.status, 200, JSON.stringify(restored.json));
  await TurfSnapshot.deleteMany({ passId: p._id });
  await Pass.deleteOne({ _id: p._id });
});

test('R-m3: a conversion\'s Retry undo counts as begun once its job has claimed it — what its first attempt freed stays restorable', { skip }, async () => {
  const d = 19;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  // Its door step stops after taking the answers, before its flip: the entry still reads Surveyed.
  hookOnce(CanvassActivity, 'bulkWrite', async () => { throw new MongoNetworkError('connection closed'); });
  await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e._id) }));
  while (pending.length) pending.pop()();
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  const copy = await SurveyResponseArchive.collection.findOne({ voterId: v._id, conversionRunId: oid(runId) });
  assert.ok(copy, 'the step took the answers');
  const set = (fields) => SurveyConversionRun.collection.updateOne({ _id: oid(runId) }, { $set: fields });
  try {
    // A first undo that stopped part-way: its own entry reads Surveyed, so the copy is free.
    await set({ status: 'revert_failed', revertClaimedAt: null });
    assert.strictEqual((await stateOf(copy)).restorable, true, 'freed by the stopped undo');
    // Retry undo, claimed by the route — its checks and enqueue still ahead: held.
    await set({ status: 'reverting', revertClaimedAt: null });
    assert.strictEqual((await stateOf(copy)).restorable, false, 'held while the claim may still be given back');
    // ...and once its job has claimed it: begun.
    await set({ revertClaimedAt: new Date() });
    assert.strictEqual((await stateOf(copy)).restorable, true, 'freed again once the job runs');
  } finally {
    await set({ status: 'revert_failed', revertClaimedAt: null });
  }
});

// Since the follow-up to round 9 the same review pressed while another press of it is answering joins
// that answer on arrival (answerEditFollowup.int.test.js) — when that press named its survey. One that
// named none is known only once it prices, so a press of the same review can still find it running, read
// beside it, and find it finished: this pins that path.
test('P9-m3: a heavy review that found its twin finished takes both places itself — a light review pressed meanwhile waits', { skip }, async () => {
  const ids = await ottoSurveys('Gate R9 Twin', GATE_QUESTIONS, [[52, [gateRow('yes')]], [53, [gateRow('maybe')]]]);
  const heavy = reviewBody('Gate R9 Twin', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  const light = { ...heavy, actionIds: [ids[0]], plan: [{ questionKey: 'gate', op: 'set', optionIds: ['maybe'] }] };
  await withEnv({ ANSWER_EDIT_HEAVY_REVIEW: '1' }, async () => {
    // A runs, naming no survey (the review picks the one its surveys were taken under), held at its scan.
    const parkedA = parkFirstScan();
    const a = call('POST', edits(), asAdmin({ ...heavy, surveyTemplateId: undefined }));
    await parkedA.inside;
    // B, the same review, is held after its heavy check — at its read of the surveys' names.
    const atNames = deferred();
    const releaseNames = deferred();
    let heldB = false;
    hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
      if (!heldB && this.model?.modelName === 'SurveyTemplate' && this.op === 'find' && this._fields?.name === 1) {
        heldB = true;
        atNames.resolve();
        return releaseNames.p.then(() => real(...args));
      }
      return real(...args);
    });
    const b = call('POST', edits(), asBea(heavy));
    await atNames.p;
    // A finishes; B now runs on its own.
    parkedA.release();
    assert.strictEqual((await a).status, 200);
    const parkedB = parkFirstScan();
    releaseNames.resolve();
    await parkedB.inside;
    let c;
    try {
      c = await call('POST', edits(), asAdmin(light));
    } finally {
      parkedB.release();
    }
    while (pending.length) pending.pop()();
    assert.strictEqual(c.status, 503, `B holds both places: ${JSON.stringify(c.json)}`);
    assert.strictEqual((await b).status, 200);
  });
});
