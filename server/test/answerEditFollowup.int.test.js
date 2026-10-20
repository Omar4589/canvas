import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The leftovers of Edit answers' code review (2026-10-20), closed after round 9 at the owner's call, each
// pinned against the REAL app + a throwaway mongod — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §V, "After round
// 9". Each test fails on round 9's code:
//   npm run test:int -- test/answerEditFollowup.int.test.js
//
// Redis points at a dead port, as everywhere here: a create or an undo answers 503 when it can't
// reach the queue, and the tests drive the REAL processors with the job id the run carries.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-followup';
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

  const org = await Organization.create({ name: 'Edit Org FU', slug: 'edit-org-fu', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'fua@t.co', passwordHash: 'x', isActive: true });
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'fub@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'fuc@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'fuo@t.co', passwordHash: 'x', isActive: true });
  for (const u of [admin, bea]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const otherTemplate = await SurveyTemplate.create({ organizationId: org._id, name: 'Other Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit FU', type: 'survey', state: 'FL', isActive: true,
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

const { sweepOrphanSnapshots, SNAPSHOT_SWEEP_JOB } = await import('../src/services/turf/snapshotRetention.js');
const { settleStalledConversion, STOPPED_CONVERSION_ERROR, STOPPED_UNDO_ERROR } = await import('../src/services/canvass/surveyConversion.js');
const { MAINTENANCE_JOBS, REPEATABLE_JOBS } = await import('../src/services/retention/scheduler.js');

// ── a deleted round's snapshots go with it (round 9's privacy owner flag) ───────────────────────────

test('a draft round deleted takes its snapshots with it — the cleared knocks too; another round\'s stay', { skip }, async () => {
  const { pass: p } = await freshRound(70);
  const clearing = await discardClearing(p);
  assert.strictEqual((await Pass.findById(p._id).lean()).status, 'draft', 'the cleared round turned draft — Delete is offered');
  const booksOnly = await TurfSnapshot.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: p._id, books: [], assignments: [], clearedKnocks: false });
  const { pass: other } = await freshRound(71);
  const kept = await TurfSnapshot.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: other._id, books: [], assignments: [], clearedKnocks: false });
  assert.ok((await TurfSnapshot.findById(clearing).lean()).responses.length, 'the snapshot holds the round\'s surveys');

  const del = await call('DELETE', `/admin/campaigns/${ctx.campaign._id}/passes/${p._id}`, asAdmin());
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.strictEqual(await TurfSnapshot.countDocuments({ _id: { $in: [clearing, booksOnly._id] } }), 0, 'both of its snapshots are gone');
  assert.ok(await TurfSnapshot.exists({ _id: kept._id }), 'another round\'s snapshot stays');
});

test('a walk list deleted takes its draft rounds\' snapshots with it', { skip }, async () => {
  const ef = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, name: 'Short-lived' });
  const p = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ef._id, roundNumber: 1, name: 'Round 1', status: 'draft' });
  const snap = await TurfSnapshot.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: p._id, books: [], assignments: [], clearedKnocks: true });
  const del = await call('DELETE', `/admin/campaigns/${ctx.campaign._id}/efforts/${ef._id}`, asAdmin());
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.strictEqual(await Pass.countDocuments({ effortId: ef._id }), 0);
  assert.strictEqual(await TurfSnapshot.countDocuments({ _id: snap._id }), 0, 'its round\'s snapshot went with it');
});

test('the nightly sweep deletes the snapshots of rounds already gone, and only those — its dry run counts them', { skip }, async () => {
  const goneRound = new mongoose.Types.ObjectId();
  const left = await TurfSnapshot.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: goneRound, books: [], assignments: [], clearedKnocks: true });
  const kept = await TurfSnapshot.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, passId: ctx.pass._id, books: [], assignments: [], clearedKnocks: false });
  const dry = await sweepOrphanSnapshots({ apply: false });
  assert.deepStrictEqual(dry, { rounds: 1, deleted: 1 });
  assert.ok(await TurfSnapshot.exists({ _id: left._id }), 'a dry run deletes nothing');
  const res = await sweepOrphanSnapshots();
  assert.deepStrictEqual(res, { rounds: 1, deleted: 1 });
  assert.strictEqual(await TurfSnapshot.countDocuments({ _id: left._id }), 0);
  assert.ok(await TurfSnapshot.exists({ _id: kept._id }), 'a round on file keeps its snapshot');
  assert.deepStrictEqual(await sweepOrphanSnapshots(), { rounds: 0, deleted: 0 });
  assert.ok(MAINTENANCE_JOBS.some((j) => j.name === SNAPSHOT_SWEEP_JOB && j.cron && j.label), 'scheduled nightly');
  assert.ok(!REPEATABLE_JOBS.some((j) => j.name === SNAPSHOT_SWEEP_JOB), 'as hygiene, never on the retention banner');
  await TurfSnapshot.deleteOne({ _id: kept._id });
});

// ── a round's delete keeps its history and waits for its lock (the follow-up's review) ─────────────

const { acquireRecutLock, releaseRecutLock } = await import('../src/services/turf/recutLock.js');

test('a draft round still holding knocks is refused delete — archive it instead', { skip }, async () => {
  const { pass: p, entry } = await freshRound(77);
  // A discard that keeps the knocks turns a live round back to draft.
  const kept = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/discard`, asAdmin({ passId: String(p._id), clearKnocks: false, confirmActive: true }));
  assert.strictEqual(kept.status, 200, JSON.stringify(kept.json));
  assert.strictEqual((await Pass.findById(p._id).lean()).status, 'draft');
  const del = await call('DELETE', `/admin/campaigns/${ctx.campaign._id}/passes/${p._id}`, asAdmin());
  assert.strictEqual(del.status, 400, JSON.stringify(del.json));
  assert.strictEqual(del.json.code, 'has-history');
  assert.ok(await Pass.exists({ _id: p._id }), 'the round stays');
  assert.ok(await CanvassActivity.exists({ _id: entry._id }), 'its entry stays under it');
  assert.strictEqual(await TurfSnapshot.countDocuments({ passId: p._id }), 1, 'and so does its snapshot');
  const archived = await call('POST', `/admin/campaigns/${ctx.campaign._id}/passes/${p._id}/archive`, asAdmin({ confirmArchive: true }));
  assert.strictEqual(archived.status, 200, JSON.stringify(archived.json));
});

test('a round delete waits for the round\'s re-cut lock — a restore or a discard in flight', { skip }, async () => {
  const p = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ctx.effort._id, roundNumber: 120, name: 'Round 120', status: 'draft' });
  assert.ok(await acquireRecutLock(p._id, ctx.admin._id, null, { knocks: true }));
  const refused = await call('DELETE', `/admin/campaigns/${ctx.campaign._id}/passes/${p._id}`, asAdmin());
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
  assert.strictEqual(refused.json.code, 'recut-locked');
  assert.ok(await Pass.exists({ _id: p._id }));
  await releaseRecutLock(p._id);
  const del = await call('DELETE', `/admin/campaigns/${ctx.campaign._id}/passes/${p._id}`, asAdmin());
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
});

test('a walk list delete waits for its rounds\' locks, and keeps kept copies of answers as history', { skip }, async () => {
  const ef = await Effort.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, name: 'Guarded' });
  const p = await Pass.create({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, effortId: ef._id, roundNumber: 1, name: 'Round 1', status: 'draft' });
  const del = () => call('DELETE', `/admin/campaigns/${ctx.campaign._id}/efforts/${ef._id}`, asAdmin());
  assert.ok(await acquireRecutLock(p._id, ctx.admin._id));
  const locked = await del();
  assert.strictEqual(locked.status, 409, JSON.stringify(locked.json));
  assert.strictEqual(locked.json.code, 'recut-locked');
  await releaseRecutLock(p._id);
  const copyId = new mongoose.Types.ObjectId();
  await SurveyResponseArchive.collection.insertOne({
    _id: copyId, organizationId: ctx.org._id, campaignId: ctx.campaign._id, voterId: ctx.voters[78]._id, householdId: ctx.homes[78]._id,
    userId: ctx.cara._id, passId: p._id, effortId: ef._id, surveyTemplateId: ctx.template._id, answers: FAKE(), overwrittenVia: 'unknock',
    overwrittenAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  });
  const kept = await del();
  assert.strictEqual(kept.status, 400, JSON.stringify(kept.json));
  assert.strictEqual(kept.json.code, 'has-history');
  await SurveyResponseArchive.collection.deleteOne({ _id: copyId });
  const gone = await del();
  assert.strictEqual(gone.status, 200, JSON.stringify(gone.json));
  assert.strictEqual(await Pass.countDocuments({ _id: p._id }), 0);
});

// ── a conversion left busy with nobody on it is settled when read (L9-m5) ──────────────────────────

const ELEVEN_MIN = 11 * 60_000;
const stuckConversion = async (fields) => {
  const at = new Date(Date.now() - ELEVEN_MIN);
  const _id = new mongoose.Types.ObjectId();
  await SurveyConversionRun.collection.insertOne({
    _id, organizationId: ctx.org._id, campaignId: ctx.campaign._id, byUserId: ctx.admin._id, direction: 'from_survey', mode: 'bulk',
    sources: ['survey_submitted'], to: 'not_home', answers: [], selection: { scope: {}, actionIds: [], byIds: true },
    progress: { phase: null, pct: 0, doorsDone: 0, doorsTotal: 1 }, counts: { entriesTargeted: 1, doorsTargeted: 1, entriesConverted: 0 },
    error: null, revertClaimedAt: null, revertedAt: null, startedAt: null, completedAt: null, createdAt: at, updatedAt: at, ...fields,
  });
  return _id;
};
// The conversion queue's answer for a job id: null (no such job), a state, or a throw.
const jobLookup = (answer) =>
  hookAll(getQueue(QUEUE_NAMES.OUTCOME_CONVERT), 'getJob', async () => {
    if (answer instanceof Error) throw answer;
    return answer ? { getState: async () => answer } : null;
  });
const statusOf = async (id) => (await SurveyConversionRun.findById(id).lean()).status;

test('L9-m5: a conversion pending with no job, long after its last write, is settled — the campaign takes changes again', { skip }, async () => {
  const id = await stuckConversion({ status: 'pending', queueJobId: 'gone-job' });
  const restore = jobLookup(null);
  try {
    assert.strictEqual(await removalBusy(ctx.campaign._id), null, 'nothing holds the campaign');
    const run = await SurveyConversionRun.findById(id).lean();
    assert.strictEqual(run.status, 'failed', 'Pick up or Undo, as any stopped conversion');
    assert.strictEqual(run.error, STOPPED_CONVERSION_ERROR);
    assert.strictEqual(run.queueJobId, null, 'a job turning up late can no longer claim it');
  } finally {
    restore();
    await SurveyConversionRun.deleteOne({ _id: id });
  }
});

test('L9-m5: a conversion whose job is still queued, or whose queue can\'t be asked, is left busy however long it waits', { skip }, async () => {
  for (const answer of ['waiting', 'active', 'delayed', new Error('redis down')]) {
    const id = await stuckConversion({ status: 'pending', queueJobId: 'queued-job' });
    const restore = jobLookup(answer);
    try {
      const busy = await removalBusy(ctx.campaign._id);
      assert.strictEqual(busy?.code, 'ANOTHER_CHANGE_RUNNING', `job ${answer}`);
      assert.strictEqual(await statusOf(id), 'pending', `job ${answer}`);
    } finally {
      restore();
      await SurveyConversionRun.deleteOne({ _id: id });
    }
  }
  // ...and one written lately is never asked about: its request may still be working.
  const fresh = await stuckConversion({ status: 'pending', queueJobId: null, updatedAt: new Date() });
  const restore = jobLookup(null);
  try {
    assert.strictEqual((await removalBusy(ctx.campaign._id))?.code, 'ANOTHER_CHANGE_RUNNING');
    assert.strictEqual(await statusOf(fresh), 'pending');
  } finally {
    restore();
    await SurveyConversionRun.deleteOne({ _id: fresh });
  }
});

test('L9-m5: an undo claimed and never begun goes back to what the run was; one its job began reads a stopped undo', { skip }, async () => {
  const restore = jobLookup(null);
  let made = [];
  try {
    // Queued-size runs: the queue is asked, and has no job.
    const neverBegun = await stuckConversion({
      status: 'reverting', queueJobId: 'undo-job', counts: { entriesConverted: 900 }, completedAt: new Date(Date.now() - 3600_000),
      revertFrom: { status: 'completed', error: null },
    });
    const begun = await stuckConversion({ status: 'reverting', queueJobId: 'undo-job-2', counts: { entriesConverted: 900 }, revertClaimedAt: new Date(Date.now() - ELEVEN_MIN), revertFrom: { status: 'completed', error: null } });
    const failedBefore = await stuckConversion({ status: 'reverting', queueJobId: 'undo-job-3', counts: { entriesConverted: 900 }, revertFrom: { status: 'failed', error: 'Lost the database mid-run.' } });
    made = [neverBegun, begun, failedBefore];
    assert.strictEqual(await removalBusy(ctx.campaign._id), null);
    const a = await SurveyConversionRun.findById(neverBegun).lean();
    assert.deepStrictEqual([a.status, a.error], ['completed', null], 'the change the admin kept stands — never an undo begun');
    const b = await SurveyConversionRun.findById(begun).lean();
    assert.deepStrictEqual([b.status, b.error], ['revert_failed', STOPPED_UNDO_ERROR], 'Retry undo finishes it');
    const c = await SurveyConversionRun.findById(failedBefore).lean();
    assert.deepStrictEqual([c.status, c.error], ['failed', 'Lost the database mid-run.'], 'back to exactly what it read');
  } finally {
    restore();
    await SurveyConversionRun.deleteMany({ _id: { $in: made } });
  }
});

test('L9-m5: an Undo whose checks and give-back both fail is settled back to the change it was, from the run\'s own page', { skip }, async () => {
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[72], 72, FAKE())).status, 201);
  const runId = await convertDoorFromSurvey((await visitEntry(72, ctx.cara._id))._id);
  assert.strictEqual(await statusOf(runId), 'completed');
  // The second answer-edit check (after the claim) fails, and so does the give-back.
  let checks = 0;
  hookAll(AnswerEditRun, 'exists', (real, args) => {
    checks += 1;
    return checks === 2 ? Promise.reject(new MongoNetworkError('connection reset')) : real(...args);
  });
  let writes = 0;
  hookAll(SurveyConversionRun, 'findOneAndUpdate', (real, args) => {
    writes += 1;
    if (writes === 2) return { lean: () => Promise.reject(new MongoNetworkError('connection reset')) };
    return real(...args);
  });
  const undo = await call('POST', conv(`/${runId}/revert`), asAdmin());
  while (pending.length) pending.pop()();
  try {
    assert.strictEqual(undo.status, 500, JSON.stringify(undo.json));
    const stuck = await SurveyConversionRun.findById(runId).lean();
    assert.strictEqual(stuck.status, 'reverting', 'left busy with nobody on it');
    assert.deepStrictEqual(stuck.revertFrom, { status: 'completed', error: null }, 'the claim wrote what it was');
    assert.strictEqual((await removalBusy(ctx.campaign._id))?.code, 'ANOTHER_CHANGE_RUNNING', 'busy while its request may still be working');

    await SurveyConversionRun.collection.updateOne({ _id: oid(runId) }, { $set: { updatedAt: new Date(Date.now() - ELEVEN_MIN) } });
    const page = await call('GET', conv(`/${runId}`), asAdmin());
    assert.strictEqual(page.status, 200, JSON.stringify(page.json));
    assert.strictEqual(page.json.run.status, 'completed', 'settled back — Undo is offered again');
    assert.strictEqual(await removalBusy(ctx.campaign._id), null);
    const again = await call('POST', conv(`/${runId}/revert`), asAdmin());
    assert.strictEqual(again.status, 200, JSON.stringify(again.json));
    assert.strictEqual(await statusOf(runId), 'reverted');
  } finally {
    // Whatever this test finds, the campaign is left free for the tests after it.
    await SurveyConversionRun.collection.updateOne({ _id: oid(runId), status: 'reverting' }, { $set: { status: 'completed' } });
  }
});

test('L9-m5: an inline undo marks itself begun before it writes', { skip }, async () => {
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[73], 73, FAKE())).status, 201);
  const runId = await convertDoorFromSurvey((await visitEntry(73, ctx.cara._id))._id);
  let seen = null;
  hookOnce(SurveyConversionRun.collection, 'bulkWrite', async (real, args) => {
    seen = (await SurveyConversionRun.findById(runId).lean()).revertClaimedAt;
    return real(...args);
  });
  hookAll(SurveyResponse.collection, 'insertMany', async (real, args) => {
    seen ??= (await SurveyConversionRun.findById(runId).lean()).revertClaimedAt;
    return real(...args);
  });
  const undo = await call('POST', conv(`/${runId}/revert`), asAdmin());
  while (pending.length) pending.pop()();
  assert.strictEqual(undo.status, 200, JSON.stringify(undo.json));
  assert.ok(seen instanceof Date, 'begun before its first write');
  // ...so one that died with its request settles as a stopped undo, never as the change it was.
  const dead = await stuckConversion({ status: 'reverting', queueJobId: null, counts: { entriesConverted: 3 }, revertClaimedAt: new Date(Date.now() - ELEVEN_MIN), revertFrom: { status: 'completed', error: null } });
  try {
    const settled = await settleStalledConversion(await SurveyConversionRun.findById(dead).lean());
    assert.deepStrictEqual([settled.status, settled.error], ['revert_failed', STOPPED_UNDO_ERROR]);
  } finally {
    await SurveyConversionRun.deleteOne({ _id: dead });
  }
});

// ── the same priced review pressed twice at once joins (P9-m2) ──────────────────────────────────────

test('P9-m2: the same priced review pressed twice at the same moment answers both — the second joins the first, even with one place', { skip }, async () => {
  const ids = await ottoSurveys('Gate FU Twin', GATE_QUESTIONS, [[52, [gateRow('yes')]], [53, [gateRow('maybe')]]]);
  const body = reviewBody('Gate FU Twin', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  await withEnv({ ANSWER_EDIT_REVIEWS_AT_ONCE: '1' }, async () => {
    // The first press holds its place and is stopped at its first read of the entries — before it
    // reaches anything a later press could join (round 9's twin found nothing running, and was refused).
    const inside = deferred();
    const release = deferred();
    let held = false;
    hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
      if (!held && this.model?.modelName === 'CanvassActivity') {
        held = true;
        inside.resolve();
        return release.p.then(() => real(...args));
      }
      return real(...args);
    });
    const parked = { inside: inside.p, release: release.resolve };
    const first = call('POST', edits(), asAdmin(body));
    await parked.inside;
    let reads = 0;
    hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
      if (this.model?.modelName === 'SurveyResponse' || this.model?.modelName === 'CanvassActivity') reads += 1;
      return real(...args);
    });
    let twin;
    let other;
    try {
      twin = call('POST', edits(), asBea(body));
      await sleep(50);
      // A different review still waits its turn.
      other = await call('POST', edits(), asBea({ ...body, plan: [{ questionKey: 'gate', op: 'set', optionIds: ['maybe'] }] }));
    } finally {
      while (pending.length) pending.pop()();
      parked.release();
    }
    const [a, b] = await Promise.all([first, twin]);
    assert.strictEqual(other.status, 503, JSON.stringify(other.json));
    assert.strictEqual(other.json.code, 'REVIEW_BUSY');
    assert.strictEqual(a.status, 200, JSON.stringify(a.json));
    assert.strictEqual(b.status, 200, JSON.stringify(b.json));
    assert.strictEqual(b.json.digest, a.json.digest, 'one answer');
    assert.strictEqual(b.json.asOf, a.json.asOf);
    assert.strictEqual(reads, 0, 'the twin read nothing of its own');
  });
  // ...and the next one runs on its own again.
  const later = await call('POST', edits(), asAdmin(body));
  assert.strictEqual(later.status, 200, JSON.stringify(later.json));
});

test('P9-m2: a twin that joins a press which then fails gets the same failure', { skip }, async () => {
  const ids = await ottoSurveys('Gate FU Fail', GATE_QUESTIONS, [[54, [gateRow('yes')]]]);
  const body = reviewBody('Gate FU Fail', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  const inside = deferred();
  const release = deferred();
  let held = false;
  hookProto(mongoose.Query.prototype, 'exec', function (real, args) {
    if (!held && isScan(this)) {
      held = true;
      inside.resolve();
      return release.p.then(() => Promise.reject(new MongoNetworkError('connection reset')));
    }
    return real(...args);
  });
  const first = call('POST', edits(), asAdmin(body));
  await inside.p;
  const twin = call('POST', edits(), asBea(body));
  await sleep(50);
  release.resolve();
  const [a, b] = await Promise.all([first, twin]);
  while (pending.length) pending.pop()();
  assert.strictEqual(a.status, 500);
  assert.strictEqual(b.status, a.status, 'the same answer');
  const after = await call('POST', edits(), asAdmin(body));
  assert.strictEqual(after.status, 200, 'and nothing is left behind it');
});

// ── an older unknock's Undo never doubles a visit (round 8's residual, kept) ─────────────────────────

// A first try at round 8's residual read an older entry as standing there all along unless a record of
// another unknock's undo or of a restored snapshot named it — and the follow-up review found the record
// can go: a restored snapshot deleted on Turf Cutting, a restore that stopped before its stamp, an undo
// that stopped twice. Then the Undo put its own entry back beside one put back since: two Surveyed
// entries, one visit, the canvasser counted twice. Nothing on file proves an older entry stood there when
// a run from before `coEntryIds` froze, so such a run keeps reading every older entry as put back since:
// its entry stays off, counted not put back, its answers restorable. This pins the case the review found.
const reknock = async (p, d) => {
  await Pass.updateOne({ _id: p._id }, { $set: { status: 'active' } });
  const at = new Date(Date.now() - 60_000);
  const e = await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[d]._id, voterId: ctx.voters[d]._id, userId: ctx.cara._id,
    actionType: 'survey_submitted', location: { lat: 28.2, lng: -82.1 + d * 0.001, accuracy: 6 }, timestamp: at, passId: p._id,
  });
  await SurveyResponse.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: ctx.homes[d]._id, voterId: ctx.voters[d]._id, userId: ctx.cara._id,
    passId: p._id, surveyTemplateId: ctx.template._id, submittedAt: at, answers: [undecidedRow()], createdAt: at, updatedAt: at,
  });
  return e;
};
const caraEntriesAt = async (p, d) =>
  (await CanvassActivity.find({ passId: p._id, householdId: ctx.homes[d]._id, userId: ctx.cara._id, actionType: { $ne: 'note_added' } }).lean()).map((x) => String(x._id)).sort();

test('an older unknock\'s Undo never puts its entry back beside one a snapshot restore put back since, even once that snapshot is deleted', { skip }, async () => {
  const d = 74;
  // Round p cleared (its snapshot holds E0), worked again (E1, the same visit), E1 unknocked by the build
  // before `coEntryIds`, the snapshot restored (E0 back, after the unknock froze) and then deleted.
  const { pass: p, entry: e0 } = await freshRound(d);
  const snapId = await discardClearing(p);
  const e1 = await reknock(p, d);
  const u = await unknockIds([e1._id]);
  assert.strictEqual(u.status, 201, JSON.stringify(u.json));
  await UnknockRunChunk.collection.updateMany({ runId: oid(u.json.run.id) }, { $unset: { coEntryIds: '' } });
  assert.strictEqual((await restoreSnap(snapId)).status, 200);
  assert.deepStrictEqual(await caraEntriesAt(p, d), [String(e0._id)], 'E0 back by the restore');
  const del = await call('DELETE', `/admin/campaigns/${ctx.campaign._id}/turfs/snapshots/${snapId}`, asAdmin());
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  const undone = await undoUnknock(u.json.run.id);
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.deepStrictEqual(await caraEntriesAt(p, d), [String(e0._id)], 'one entry at the visit, never two');
  assert.strictEqual(undone.json.run.counts.rowsNotRestored, 1, 'its own entry counted not put back');
});
