import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Code review round 3 of Edit answers on Door Outcomes (2026-10-19), each finding pinned against the
// REAL app + a throwaway mongod — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §V. Most are the reviewers' own
// reproductions, asserting what the fix does:
//   npm run test:int -- test/answerEditRound3.int.test.js
//
// Redis points at a dead port, as everywhere here: a create or an undo answers 503 when it can't
// reach the queue, and the tests drive the REAL processors with the job id the run carries.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-r3';
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
  await mongoose.connect(URI);
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

  const org = await Organization.create({ name: 'Edit Org R3', slug: 'edit-org-r3', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'r3a@t.co', passwordHash: 'x', isActive: true });
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'r3b@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'r3c@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'r3o@t.co', passwordHash: 'x', isActive: true });
  for (const u of [admin, bea]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const otherTemplate = await SurveyTemplate.create({ organizationId: org._id, name: 'Other Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit R3', type: 'survey', state: 'FL', isActive: true,
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

// ── the writer and the undo ─────────────────────────────────────────────────────────────────────

test('W1: Undo what landed finds an edit on a survey re-created under a new id, whose landing was never recorded', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [1, 2]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await createTakeOutFor([1, 2]);
  const item1 = (await AnswerEditRunChunk.findOne({ runId }).lean()).items.find((it) => String(it.v) === String(v[1]._id));
  // Before the worker reaches it, door 1's survey is deleted on the profile and Cara surveys the same
  // picks again: a new id, the reviewed fingerprint.
  const old = await liveOf(v[1]);
  assert.strictEqual((await call('DELETE', `/admin/voters/${v[1]._id}/surveys/${old._id}`, asAdmin())).status, 200);
  assert.strictEqual((await survey(ctx.caraTok, v[1], 1, FAKE())).status, 201);
  const recreated = await liveOf(v[1]);
  assert.notStrictEqual(String(recreated._id), String(item1.r));
  assert.strictEqual(fingerprint(recreated), item1.h);
  // The delivery lands door 1, then dies on door 2's write before it records the chunk.
  const jobId = await armApply(runId);
  const landed = deferred();
  hookAll(SurveyResponse.collection, 'updateOne', async (real, args) => {
    const [filter] = args;
    if (String(filter?._id) === String(recreated._id)) {
      const r = await real(...args);
      landed.resolve();
      return r;
    }
    if (filter?.answerEditFence) {
      await landed.p;
      throw new Error('connection dropped mid-chunk');
    }
    return real(...args);
  });
  await assert.rejects(applyJob(runId, jobId), /connection dropped/);
  while (pending.length) pending.pop()();
  await reconcileFailedAnswerEditJob({ id: jobId, name: 'apply', data: { runId }, opts: { attempts: 3 }, attemptsMade: 3, finishedOn: Date.now() }, new Error('connection dropped mid-chunk'));
  assert.deepStrictEqual(await signOf(v[1]), ['yard_sign_delivered'], 'the edit landed on the re-created survey');
  // Read by slot, the undo finds the copy the delivery made and puts it back.
  const undo = await runUndo(runId);
  assert.strictEqual(undo.summary.putBack, 1);
  assert.deepStrictEqual(await signOf(v[1]), ['yard_sign_delivered', 'volunteer_request']);
});

test('W2: a survey an unknock undo re-creates carries the answer-edit undo\'s fence, so a delivery still running can\'t land on it', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [12, 13]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const original = await liveOf(v[12]);
  const runId = await createTakeOutFor([12, 13]);
  await splitChunks(runId, [v[13]._id, v[12]._id]);
  const jobId = await armApply(runId);
  // The delivery: past its check on chunk 1, hung on its first read.
  const held = deferred();
  const release = deferred();
  let reads = 0;
  hookAll(SurveyResponse.collection, 'find', (real, args) => {
    const cur = real(...args);
    reads += 1;
    if (reads !== 2) return cur;
    const toArray = cur.toArray.bind(cur);
    cur.toArray = async () => { held.resolve(); await release.p; return toArray(); };
    return cur;
  });
  const zombie = applyJob(runId, jobId);
  await held.p;
  while (pending.length) pending.pop()();
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'failed', queueJobId: null } });
  // Bea unknocks the visit; Undo what landed fences door 12's empty slot; the unknock is undone.
  const e = await visitEntry(12, ctx.cara._id);
  const struck = await call('POST', unknocks(), asBea({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const pressed = await undoPressed(runId);
  assert.strictEqual(pressed.status, 202, JSON.stringify(pressed.json));
  await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
  assert.strictEqual((await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }))).status, 200);
  const back = await liveOf(v[12]);
  assert.notStrictEqual(String(back._id), String(original._id), 're-created under a new id');
  assert.ok((back.answerEditFence || []).some((f) => String(f) === String(runId)), 'it carries the fence');
  release.resolve();
  await zombie;
  assert.deepStrictEqual(await signOf(v[12]), ['yard_sign_delivered', 'volunteer_request'], 'the delivery never landed after the undo');
});

test('W3: an Erase of the change\'s copy while the change can still write is refused, and the original stays on file', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[44], 44, FAKE())).status, 201);
  const original = await liveOf(v[44]);
  const runId = await createTakeOutFor([44]);
  const jobId = await armApply(runId);
  const held = deferred();
  const release = deferred();
  hookOnce(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    const r = await real(...args);
    held.resolve();
    await release.p;
    return r;
  });
  const job = applyJob(runId, jobId);
  await held.p;
  const [copy] = await copiesOf(v[44], 'answer_edit');
  const er = await call('DELETE', `/admin/voters/${v[44]._id}/surveys/archive/${copy._id}`, asAdmin());
  assert.strictEqual(er.status, 409, JSON.stringify(er.json));
  assert.strictEqual(er.json.code, 'COPY_IN_USE');
  release.resolve();
  assert.deepStrictEqual(await job, { completed: true });
  assert.ok(holdsOriginal(await copiesOf(v[44]), original), 'the original is kept');
});

test('W4: a delivery that loses the claim of a copy never writes the landed edit out of the run\'s counts', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[3], 3, FAKE())).status, 201);
  const runId = await createTakeOutFor([3]);
  const jobId = await armApply(runId);
  // A dead attempt: its copy is inserted, then the worker dies before the compare-and-swap.
  hookOnce(SurveyResponse.collection, 'updateOne', async () => { throw new Error('worker killed'); });
  await assert.rejects(applyJob(runId, jobId), /worker killed/);
  while (pending.length) pending.pop()();
  // Two deliveries adopt it; the one that loses the claim reaches its chunk write first.
  const twoClaims = deferred();
  const firstClaimDone = deferred();
  let claims = 0;
  hookAll(SurveyResponseArchive.collection, 'updateOne', async (real, args) => {
    if (!args[1]?.$set?.writerToken) return real(...args);
    claims += 1;
    const mine = claims;
    if (claims === 2) twoClaims.resolve();
    await twoClaims.p;
    if (mine === 2) await firstClaimDone.p;
    const r = await real(...args);
    if (mine === 1) firstClaimDone.resolve();
    return r;
  });
  const winnerMayWrite = deferred();
  hookAll(SurveyResponse.collection, 'updateOne', async (real, args) => {
    if (args[0]?.answerEditFence) await winnerMayWrite.p;
    return real(...args);
  });
  const winnerDone = deferred();
  let chunkWrites = 0;
  hookAll(AnswerEditRunChunk, 'updateOne', async (real, args) => {
    if (!args[1]?.$set?.done) return real(...args);
    chunkWrites += 1;
    if (chunkWrites === 1) {
      winnerMayWrite.resolve();
      await winnerDone.p;
    }
    return real(...args);
  });
  const d1 = applyJob(runId, jobId);
  const d2 = applyJob(runId, jobId);
  await Promise.race([d1, d2]);
  // Before the loser writes the chunk, Otto re-surveys the voter: the edit's mark is gone, and only the
  // landed copy the winner recorded still says this run changed the survey.
  assert.strictEqual((await survey(ctx.ottoTok, v[3], 3, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  winnerDone.resolve();
  await Promise.all([d1, d2]);
  while (pending.length) pending.pop()();
  const run = await AnswerEditRun.findById(runId).lean();
  assert.strictEqual(run.counts.surveysChanged, 1, 'the run still counts the survey it edited');
  const chunk = await AnswerEditRunChunk.findOne({ runId }).lean();
  assert.ok(chunk.items[0].a, 'the landed copy stays recorded');
  const undo = await runUndo(runId);
  assert.strictEqual(undo.summary.changedSince, 1, 'the undo finds it, and keeps Otto\'s newer answers');
});

test('W5: a survey a later change held, put back by Undo again, is reported to History', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [5, 6]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await createTakeOutFor([5, 6]);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  const t0 = new Date();
  // A conversion strikes door 6's visit (Surveyed → Not home): its edited survey waits in the copy.
  const e6 = await visitEntry(6, ctx.cara._id);
  const convRun = await convertDoorFromSurvey(e6._id);
  await runUndo(runId);
  // Door 5's survey (put back) is deleted on the profile; the conversion is undone.
  const s5 = await liveOf(v[5]);
  assert.strictEqual((await call('DELETE', `/admin/voters/${v[5]._id}/surveys/${s5._id}`, asAdmin())).status, 200);
  assert.strictEqual((await call('POST', conv(`/${convRun}/revert`), asAdmin())).status, 200);
  await runUndo(runId);
  assert.deepStrictEqual(await signOf(v[6]), ['yard_sign_delivered', 'volunteer_request']);
  assert.strictEqual(putBackLogged(await historySince('answerEditUndo', t0)), 2, 'History reports both put-backs');
});

test('W7: Undo again never reports a put-back it didn\'t make — a same-picks re-survey with its copy erased', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[7], 7, FAKE(), { note: 'first visit' })).status, 201);
  const runId = await createTakeOutFor([7]);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  assert.strictEqual((await survey(ctx.caraTok, v[7], 7, FAKE(), { note: 'second visit' })).status, 201);
  await runUndo(runId);
  const [copy] = await copiesOf(v[7], 'answer_edit');
  assert.strictEqual((await call('DELETE', `/admin/voters/${v[7]._id}/surveys/archive/${copy._id}`, asAdmin())).status, 200);
  const again = await runUndo(runId);
  assert.strictEqual(again.summary.putBack, 0);
});

test('W7: a profile Restore of the change\'s copy over a teammate\'s survey reads as restored on the profile, never as put back', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[8], 8, FAKE())).status, 201);
  const runId = await createTakeOutFor([8]);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  assert.strictEqual((await survey(ctx.ottoTok, v[8], 8, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  await runUndo(runId);
  const [copy] = await copiesOf(v[8], 'answer_edit');
  assert.strictEqual((await restoreCopy(v[8], copy._id)).status, 200);
  const again = await runUndo(runId);
  assert.strictEqual(again.summary.restoredOnProfile, 1);
  assert.strictEqual(again.summary.putBack, 0);
});

test('W6: one Undo of a session that saved one survey twice puts the original back', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[11], 11, FAKE())).status, 201);
  const original = await liveOf(v[11]);
  const e = await entryOf(v[11], ctx.cara._id);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: '12 Elm St' }), actionIds: [String(e._id)], mode: 'queue' });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  const cur = created.json.current;
  const signPost = (ids) => [supportRow(), { questionKey: 'yard_sign', optionIds: ids, answer: [] }];
  assert.strictEqual((await call('POST', edits(`/${runId}/response`), asAdmin({ responseId: cur.responseId, version: cur.version, answers: signPost(['yard_sign_delivered']) }))).status, 200);
  // Bea, on the version she opened, is told it changed; she reloads it and clears the yard sign.
  const stale = await call('POST', edits(`/${runId}/response`), asBea({ responseId: cur.responseId, version: cur.version, answers: signPost([]) }));
  assert.strictEqual(stale.status, 409);
  const reread = await call('GET', edits(`/${runId}/response/${cur.responseId}`), asBea());
  assert.strictEqual((await call('POST', edits(`/${runId}/response`), asBea({ responseId: cur.responseId, version: reread.json.current.version, answers: signPost([]) }))).status, 200);
  assert.strictEqual((await call('POST', edits(`/${runId}/close`), asAdmin())).status, 200);
  await runUndo(runId);
  assert.deepStrictEqual((await liveOf(v[11])).answers, original.answers, 'the newest copy first, then the oldest: the original');
});


// ── what the page sends: the reviewed plan, an empty selection ──────────────────────────────────

test('C1: a create carrying another plan than the one its review priced is refused as stale', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[14], 14, FAKE())).status, 201);
  const e = await entryOf(v[14], ctx.cara._id);
  const body = { scope: scopeFor(ctx.cara._id, { search: '15 Elm St' }), actionIds: [String(e._id)] };
  const dry = await call('POST', edits(), asAdmin({ ...body, dryRun: true, plan: TAKE_OUT }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  const other = [{ questionKey: 'candidate_support', op: 'clear' }, ...TAKE_OUT];
  const created = await call('POST', edits(), asAdmin({ ...body, plan: other, digest: dry.json.digest, asOf: dry.json.asOf, templateVersion: dry.json.template.version }));
  assert.strictEqual(created.status, 409, JSON.stringify(created.json));
  assert.strictEqual(created.json.code, 'REVIEW_STALE');
  assert.deepStrictEqual((await liveOf(v[14])).answers, (await liveOf(v[14])).answers);
  assert.strictEqual((await liveOf(v[14])).answers.find((a) => a.questionKey === 'candidate_support')?.optionIds[0], 'strong_support', 'nothing written');
});

test('C2: an empty list of ticked rows selects nothing on every act — never the whole filter', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [15, 16]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const scope = scopeFor(ctx.cara._id);
  const unknocksBefore = await UnknockRun.countDocuments({});
  const answers = [
    await call('POST', edits(), asAdmin({ scope, actionIds: [], dryRun: true })),
    await call('POST', edits(), asAdmin({ scope, actionIds: [], dryRun: true, plan: TAKE_OUT })),
    await call('POST', unknocks(), asAdmin({ scope, actionIds: [], dryRun: true })),
    await call('POST', unknocks(), asAdmin({ scope, actionIds: [] })),
    await call('POST', `/admin/campaigns/${ctx.campaign._id}/reclassify-outcomes`, asAdmin({ to: 'not_home', scope, actionIds: [], dryRun: true })),
    await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'bulk', scope, actionIds: [], dryRun: true })),
  ];
  for (const a of answers) {
    assert.strictEqual(a.status, 400, JSON.stringify(a.json));
    assert.strictEqual(a.json.code, 'EMPTY_SELECTION');
  }
  assert.strictEqual(await UnknockRun.countDocuments({}), unknocksBefore, 'nothing unknocked');
  for (const i of [15, 16]) assert.ok(await liveOf(v[i]), 'every survey still on file');
});

test('C3: a stopped change with nothing on file says so on the wire; one that landed copies keeps Undo what landed', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [17, 18]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const neverStarted = await createTakeOutFor([17]); // its queue timed out: parked, never taken
  const wire1 = (await call('GET', edits(`/${neverStarted}`), asAdmin())).json.run;
  assert.strictEqual(wire1.status, 'failed');
  assert.strictEqual(wire1.nothingOnFile, true);
  // A first-build run that died inside its first chunk after landing a survey: no start time, no counts.
  const landed = await createTakeOutFor([18]);
  assert.deepStrictEqual(await runApply(landed), { completed: true });
  await AnswerEditRunChunk.updateMany({ runId: landed }, { $set: { done: false, counts: null } });
  await AnswerEditRun.updateOne({ _id: landed }, { $set: { status: 'failed', startedAt: null, completedAt: null, 'counts.surveysChanged': 0, 'progress.done': 0 } });
  const wire2 = (await call('GET', edits(`/${landed}`), asAdmin())).json.run;
  assert.strictEqual(wire2.nothingOnFile, false, 'its copy is on file');
  const undo = await undoPressed(landed);
  assert.strictEqual(undo.status, 202, JSON.stringify(undo.json));
  await undoJob(landed, (await AnswerEditRun.findById(landed).lean()).undo.jobId);
  assert.deepStrictEqual(await signOf(v[18]), ['yard_sign_delivered', 'volunteer_request']);
});

// ── Restore after a removal and its undo ────────────────────────────────────────────────────────

test('P6: a copy held after its unknock was undone is refused as kept after the undo — never "undo that unknock"', { skip }, async () => {
  const v = ctx.voters[20];
  assert.strictEqual((await survey(ctx.caraTok, v, 20, FAKE())).status, 201);
  await profileEdit(v, [supportRow(), signRow('yard_sign_delivered')]); // a copy holding the original
  const e = await visitEntry(20, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  assert.strictEqual((await survey(ctx.caraTok, v, 20, [supportRow(), signRow('candidate_follow_up')])).status, 201); // she comes back
  assert.strictEqual((await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }))).status, 200);
  const card = (await cardsOf(v)).find((c) => c.overwrittenVia === 'answer_edit');
  assert.strictEqual(card.restorable, false);
  assert.strictEqual(card.restoreBlockedReason, 'kept_after_undo');
  const r = await restoreCopy(v, card.id);
  assert.strictEqual(r.status, 409, JSON.stringify(r.json));
  assert.doesNotMatch(r.json.error, /Undo that unknock/);
});

test('P7: undoing Surveyed → Not home where the canvasser recorded Not home herself puts no survey under that door', { skip }, async () => {
  const v = ctx.voters[21];
  assert.strictEqual((await survey(ctx.caraTok, v, 21, FAKE())).status, 201);
  const e = await visitEntry(21, ctx.cara._id);
  const runId = await convertDoorFromSurvey(e._id);
  assert.strictEqual((await notHome(ctx.caraTok, 21)).status, 201); // she knocks again: nobody home
  const undone = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(await liveOf(v), null, 'no counted survey at a door that reads Not home');
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 1);
  const strikes = await ConversionStrike.find({ runId }).lean();
  assert.deepStrictEqual(strikes.flatMap((s) => s.notRestoredKeys), [`${ctx.homes[21]._id}|${ctx.pass._id}|${ctx.cara._id}`]);
  // The struck answers stay held there.
  const card = (await cardsOf(v)).find((c) => c.overwrittenVia === 'outcome_convert');
  assert.strictEqual(card.restorable, false);
});

test('P5: two Undo presses on one unknock at once: one runs, the other is told it is already being undone', { skip }, async () => {
  const v = ctx.voters[22];
  assert.strictEqual((await survey(ctx.caraTok, v, 22, FAKE())).status, 201);
  const e = await visitEntry(22, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const since = new Date();
  // The first press is slow once it has claimed the run (at the driver, so its query chain holds) — at the
  // undo's own read of the chunks, not the check for a round cleared since, which reads them before the
  // claim and again after (round 8).
  const inside = deferred();
  const release = deferred();
  let held = false;
  const clearedCheck = (args) => { const p = args[1]?.projection; return !!p && Object.keys(p).length === 1 && p.visitKeys === 1; };
  hookAll(UnknockRunChunk.collection, 'find', (real, args) => {
    const cur = real(...args);
    if (held || clearedCheck(args)) return cur;
    held = true;
    const toArray = cur.toArray.bind(cur);
    cur.toArray = async () => { inside.resolve(); await release.p; return toArray(); };
    return cur;
  });
  const first = call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  await inside.p;
  let second;
  try {
    second = await call('POST', unknocks('/revert'), asBea({ runId: struck.json.run.id }));
  } finally {
    release.resolve();
  }
  assert.strictEqual((await first).status, 200);
  assert.strictEqual(second.status, 409, JSON.stringify(second.json));
  assert.strictEqual(second.json.code, 'RUN_BUSY');
  const rows = await CampaignChange.find({ campaignId: ctx.campaign._id, field: 'unknock', createdAt: { $gte: since } }).lean();
  assert.strictEqual(rows.length, 1, 'one History row for the undo');
  assert.ok(await liveOf(v), 'the survey is back');
});

// A strike's request that died stops beating; ten minutes later it reads stopped (round 4).
const silence = (runId) => {
  const longAgo = new Date(Date.now() - 11 * 60 * 1000);
  return UnknockRun.collection.updateOne({ _id: new mongoose.Types.ObjectId(String(runId)) }, { $set: { heartbeatAt: longAgo, deletingAt: longAgo, createdAt: longAgo } });
};

test('P8: an unknock that stopped after it removed the entries reads stopped part-way, holds what it removed, and can be undone', { skip }, async () => {
  const v = ctx.voters[23];
  assert.strictEqual((await survey(ctx.caraTok, v, 23, FAKE())).status, 201);
  const e = await visitEntry(23, ctx.cara._id);
  // The entries are deleted, then the process dies before the run is saved completed.
  hookAll(UnknockRun.collection, 'updateOne', async (real, args) => {
    if (args[1]?.$set?.status === 'completed') throw new Error('dyno restarted');
    return real(...args);
  });
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  while (pending.length) pending.pop()();
  assert.strictEqual(struck.status, 500);
  const run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  try {
    assert.strictEqual(run.status, 'pending');
    assert.ok(run.deletingAt, 'marked before its first removal');
    assert.strictEqual(await visitEntry(23, ctx.cara._id), null, 'its entry was removed');
    // Its failure was seen in-process, so it reads stopped at once (round 5) — a dyno that dies outright
    // reads Removing… until its heartbeat is ten minutes old (answerEditRound4's C1).
    await silence(run._id);
    const listed = (await call('GET', unknocks(), asAdmin())).json.runs.find((r) => r.id === String(run._id));
    assert.strictEqual(listed.stoppedPartWay, true);
    assert.strictEqual(listed.removing, false);
    const card = (await cardsOf(v)).find((c) => c.overwrittenVia === 'unknock');
    assert.strictEqual(card.restorable, false, 'what it removed stays held');
  } finally {
    const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
    assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
    assert.strictEqual(undone.json.run.counts.rowsNotRestored, 0);
  }
  assert.ok(await visitEntry(23, ctx.cara._id), 'the entry is back');
  assert.ok(await liveOf(v), 'and its answers');
});

test('P8: an unknock that stopped before it removed the entries is undone without calling them "not restored"', { skip }, async () => {
  const v = ctx.voters[27];
  assert.strictEqual((await survey(ctx.caraTok, v, 27, FAKE())).status, 201);
  const e = await visitEntry(27, ctx.cara._id);
  hookOnce(CanvassActivity.collection, 'deleteMany', async () => { throw new Error('dyno restarted'); });
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 500);
  const run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  assert.ok(run.deletingAt);
  assert.strictEqual(await liveOf(v), null, 'its answers were removed');
  assert.ok(await visitEntry(27, ctx.cara._id), 'its entry never was');
  await silence(run._id);
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.rowsNotRestored, 0, 'an entry it never removed is not "not restored"');
  assert.ok(await liveOf(v), 'the answers are back');
});

// ── the one-time console step ───────────────────────────────────────────────────────────────────

test('P1/P2: migrate:removal-strikes records each visit missing from a conversion\'s records with its own time, and an older unknock undo\'s', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [24, 25, 26]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  // A door-by-door session across the deploy: door 24 converted before it (no record), door 25 after.
  const e24 = await visitEntry(24, ctx.cara._id);
  const e25 = await visitEntry(25, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e24._id), String(e25._id)] }));
  const sessionId = opened.json.run.id;
  assert.strictEqual((await call('POST', conv(`/${sessionId}/door`), asAdmin({ actionId: String(e24._id) }))).status, 200);
  assert.strictEqual((await call('POST', conv(`/${sessionId}/door`), asAdmin({ actionId: String(e25._id) }))).status, 200);
  await call('POST', conv(`/${sessionId}/close`), asAdmin());
  const key24 = `${ctx.homes[24]._id}|${ctx.pass._id}|${ctx.cara._id}`;
  const key25 = `${ctx.homes[25]._id}|${ctx.pass._id}|${ctx.cara._id}`;
  await ConversionStrike.deleteMany({ runId: sessionId, visitKeys: key24 });
  // An unknock undone before its undo wrote what it couldn't put back (it put everything back).
  const e26 = await visitEntry(26, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e26._id)] }));
  assert.strictEqual((await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }))).status, 200);
  await UnknockRunChunk.updateMany({ runId: struck.json.run.id }, { $unset: { notRestoredKeys: '' } });

  const { execFileSync } = await import('node:child_process');
  const run = (apply) =>
    execFileSync('node', ['src/migrations/backfillRemovalStrikes.js', ...(apply ? ['--apply'] : [])], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, MONGODB_URI: URI },
      encoding: 'utf8',
    });
  run(false);
  assert.strictEqual(await ConversionStrike.countDocuments({ runId: sessionId, visitKeys: key24 }), 0, 'a dry run writes nothing');
  run(true);
  const records = await ConversionStrike.find({ runId: sessionId }).lean();
  assert.strictEqual(records.filter((r) => r.visitKeys.includes(key24)).length, 1, 'the missing visit is recorded');
  assert.strictEqual(records.filter((r) => r.visitKeys.includes(key25)).length, 1, 'the recorded one is not doubled');
  const entry24 = await CanvassActivity.findById(e24._id).lean();
  const rec24 = records.find((r) => r.visitKeys.includes(key24));
  assert.ok(rec24.at <= entry24.reclassified.at && rec24.doneAt >= entry24.reclassified.at, 'its own time');
  const chunks = await UnknockRunChunk.find({ runId: struck.json.run.id }).lean();
  assert.ok(chunks.every((c) => Array.isArray(c.notRestoredKeys) && c.notRestoredKeys.length === 0));
  run(true);
  assert.strictEqual(await ConversionStrike.countDocuments({ runId: sessionId }), records.length, 'running it again adds nothing');
});

// ── one change at a time: counters and the deploy window ───────────────────────────────────────

test('G5: a door-by-door step counts itself in while it writes and out after, whatever else happens', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[34], 34, FAKE())).status, 201);
  const e = await visitEntry(34, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
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
  let busy;
  try {
    // Another admin presses Close mid-step: refused while the door saves (round 4 — a Close and an
    // Undo landing mid-step left the door converted under the reverted run), and the step still
    // counts as running.
    closed = await call('POST', conv(`/${runId}/close`), asBea());
    busy = await otherChangeRunning(ctx.campaign._id);
  } finally {
    release.resolve();
  }
  assert.strictEqual(closed.status, 409);
  assert.strictEqual(closed.json.code, 'RUN_BUSY');
  assert.ok(busy, 'a step in flight keeps the campaign busy');
  assert.strictEqual((await step).status, 200);
  assert.strictEqual((await SurveyConversionRun.findById(runId).lean()).stepping || 0, 0);
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asBea())).status, 200, 'and closes once it has saved');
  assert.strictEqual(await otherChangeRunning(ctx.campaign._id), null);
});

test('G8: a job the previous build queued runs — a conversion before its id was saved, and its undo', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[36], 36, FAKE())).status, 201);
  const e = await visitEntry(36, ctx.cara._id);
  const unstub = stubQueue(QUEUE_NAMES.OUTCOME_CONVERT);
  const created = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'bulk', actionIds: [String(e._id)] }));
  unstub();
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const runId = created.json.run.id;
  // The previous build: BullMQ's own id, saved only after the add — the worker took it before.
  await SurveyConversionRun.updateOne({ _id: runId }, { $set: { queueJobId: null } });
  const forward = await processConversionJob({ id: '41', name: 'convert', data: { runId }, updateProgress: async () => {} });
  assert.strictEqual(forward.status, 'completed');
  await SurveyConversionRun.updateOne({ _id: runId }, { $set: { status: 'reverting', 'counts.entriesConverted': 501 } });
  const back = await processConversionJob({ id: '42', name: 'revert', data: { runId }, updateProgress: async () => {} });
  assert.strictEqual(back.status, 'reverted');
  assert.ok(await liveOf(v[36]), 'the survey is back');
  // A job of this build that isn't the run's own is never taken.
  await SurveyConversionRun.updateOne({ _id: runId }, { $set: { status: 'reverting', revertedAt: null, revertClaimedAt: null, queueJobId: 'outcome-convert-x-revert-1' } });
  const stray = await processConversionJob({ id: 'outcome-convert-y-revert-2', name: 'revert', data: { runId }, updateProgress: async () => {} });
  assert.deepStrictEqual(stray, { skipped: 'not-claimable' });
  await SurveyConversionRun.updateOne({ _id: runId }, { $set: { status: 'reverted', revertedAt: new Date() } });
});

// ── what the writer counts ──────────────────────────────────────────────────────────────────────

test('S2: a survey re-recorded under another survey before the change reached it is left as it is', { skip }, async () => {
  const v = ctx.voters[38];
  assert.strictEqual((await survey(ctx.caraTok, v, 38, FAKE())).status, 201);
  const runId = await createTakeOutFor([38]);
  // Re-recorded under the other survey (the campaign switched surveys and the door was surveyed again):
  // same slot, same answers, another template.
  const live = await liveOf(v);
  await SurveyResponse.collection.deleteOne({ _id: live._id });
  const { _id, ...rest } = live;
  await SurveyResponse.collection.insertOne({ ...rest, surveyTemplateId: ctx.otherTemplate._id, createdAt: new Date(), updatedAt: new Date() });
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  const run = await AnswerEditRun.findById(runId).lean();
  assert.strictEqual(run.counts.surveysChanged, 0);
  assert.strictEqual(run.counts.changedSinceReview, 1);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], 'the other survey is untouched');
});

test('S3: pick counts are per pick — an id stored twice is one, two old texts no option matches are two', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [39, 40]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  await SurveyResponse.collection.updateOne(
    { voterId: v[39]._id },
    { $set: { 'answers.$[r].optionIds': ['volunteer_request', 'volunteer_request'], 'answers.$[r].answer': ['Volunteer Request', 'Volunteer Request'] } },
    { arrayFilters: [{ 'r.questionKey': 'yard_sign' }] }
  );
  await SurveyResponse.collection.updateOne(
    { voterId: v[40]._id },
    { $set: { 'answers.$[r].optionIds': [], 'answers.$[r].answer': ['an old sign label', 'another old label'] } },
    { arrayFilters: [{ 'r.questionKey': 'yard_sign' }] }
  );
  const runId = await createTakeOutFor([39, 40], { plan: [{ questionKey: 'yard_sign', op: 'clear' }] });
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  const byKey = Object.fromEntries((await AnswerEditRun.findById(runId).lean()).counts.byOption.map((o) => [o.key, o.removed]));
  assert.strictEqual(byKey.volunteer_request, 1);
  assert.strictEqual(byKey.__unlisted__, 2);
  assert.ok(!('an old sign label' in byKey), 'never keyed by a voter\'s words');
});

test('the Duplicate Surveys report names a Restore\'s admin as who set the answers aside, not as a survey\'s author', { skip }, async () => {
  const v = ctx.voters[41];
  assert.strictEqual((await survey(ctx.caraTok, v, 41, FAKE())).status, 201);
  assert.strictEqual((await survey(ctx.ottoTok, v, 41, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  const caraCopy = (await cardsOf(v)).find((c) => c.overwrittenVia === 'submit');
  assert.strictEqual((await restoreCopy(v, caraCopy.id)).status, 200);
  const report = await call('GET', `/admin/reports/duplicate-surveys?campaignId=${ctx.campaign._id}&limit=100`, asAdmin());
  assert.strictEqual(report.status, 200, JSON.stringify(report.json));
  const rows = (report.json.duplicates || report.json.voters || report.json.items || []).flatMap((d) => d.responses || []);
  const setAside = rows.find((r) => r.overwritten && r.overwrittenVia === 'restore');
  assert.ok(setAside, 'the restore-displaced copy carries how it was set aside');
});


// ── deletion: a batch still writing when its organization is deleted ────────────────────────────

test('G3: a conversion batch that stalls past the delete cascade leaves nothing of the deleted organization behind', { skip }, async () => {
  // Its own organization: the cascade deletes all of it.
  const org = await Organization.create({ name: 'Doomed Org', slug: 'doomed-org-r3', isActive: true });
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Doomed Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({ organizationId: org._id, name: 'Doomed C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York', surveyTemplateId: template._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'E' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const entryIds = [];
  for (let i = 0; i < 3; i += 1) {
    const home = await Household.create({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id, addressLine1: `${i + 1} Doom St`, city: 'T', state: 'FL',
      zipCode: '33540', normalizedAddress: `DOOM${i + 1}`, location: { type: 'Point', coordinates: [-82, 28] }, isActive: true, status: 'not_home',
    });
    await Voter.create({ organizationId: org._id, campaignId: campaign._id, householdId: home._id, stateVoterId: `DOOM-${i}`, firstName: 'D', lastName: `${i}`, fullName: `Doom ${i}` });
    const at = new Date(Date.now() - 3600_000 + i * 60_000);
    const a = await CanvassActivity.create({
      organizationId: org._id, campaignId: campaign._id, householdId: home._id, userId: ctx.cara._id, actionType: 'not_home',
      location: { lat: 28, lng: -82, accuracy: 6 }, timestamp: at, passId: pass._id, effortId: effort._id,
    });
    entryIds.push(a._id);
  }
  const run = await SurveyConversionRun.create({
    organizationId: org._id, campaignId: campaign._id, byUserId: ctx.admin._id, direction: 'to_survey', mode: 'bulk', to: 'survey_submitted',
    sources: ['not_home'], status: 'pending', queueJobId: 'doomed-job', surveyTemplateId: template._id, surveyTemplateVersion: 1,
    answers: [supportRow(), signRow('yard_sign_delivered')], note: 'desk', selection: { actionIds: entryIds }, counts: { entriesTargeted: 3, doorsTargeted: 3 },
  });
  // The batch has read its voters; its survey insert stalls until the whole cascade is done.
  const reached = deferred();
  const release = deferred();
  hookOnce(SurveyResponse, 'insertMany', async (real, args) => {
    reached.resolve();
    await release.p;
    return real(...args);
  });
  const job = processConversionJob({ id: 'doomed-job', name: 'convert', data: { runId: String(run._id) }, updateProgress: async () => {} }).catch((e) => e);
  await reached.p;
  await Organization.updateOne({ _id: org._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'running' } });
  const prevWait = process.env.DOOR_OUTCOMES_DELETE_WAIT_MS;
  process.env.DOOR_OUTCOMES_DELETE_WAIT_MS = '300';
  try {
    await deleteOrganization(org._id);
  } finally {
    if (prevWait === undefined) delete process.env.DOOR_OUTCOMES_DELETE_WAIT_MS;
    else process.env.DOOR_OUTCOMES_DELETE_WAIT_MS = prevWait;
  }
  release.resolve();
  await job;
  for (const M of [SurveyResponse, SurveyResponseArchive, CanvassActivity, SurveyConversionRun, ConversionStrike, CampaignChange]) {
    assert.strictEqual(await M.countDocuments({ organizationId: org._id }), 0, `${M.modelName} of the deleted organization`);
  }
});

test('G3: a deletion asked for but never started (its job couldn\'t be queued) sweeps nothing', { skip }, async () => {
  const v = ctx.voters[42];
  assert.strictEqual((await survey(ctx.caraTok, v, 42, FAKE())).status, 201);
  const runId = await createTakeOutFor([42]);
  // The org stamp of a delete whose enqueue then fails (the route clears it again).
  await Organization.updateOne({ _id: ctx.org._id }, { $set: { 'deletion.requestedAt': new Date(), 'deletion.status': 'pending' } });
  let out;
  try {
    out = await runApply(runId);
  } finally {
    await Organization.updateOne({ _id: ctx.org._id }, { $unset: { deletion: '' } });
  }
  assert.strictEqual(out.stopped, 'tenant-deleting', 'the change stops');
  assert.ok(await AnswerEditRun.findById(runId).lean(), 'its run is kept');
  assert.ok(await liveOf(v), 'and every survey');
  assert.ok(await CanvassActivity.countDocuments({ organizationId: ctx.org._id }) > 0);
});

// Last: it clears the whole round and puts it back.
test('W2: a round restored from its re-cut snapshot comes back with the undo\'s fence, so a delivery still running can\'t land', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [30, 31]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await createTakeOutFor([30, 31]);
  await splitChunks(runId, [v[31]._id, v[30]._id]);
  const jobId = await armApply(runId);
  // The delivery lands door 31, then hangs in door 30's batch after its copy, before its write.
  let inserts = 0;
  const held = deferred();
  const release = deferred();
  hookAll(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    const r = await real(...args);
    inserts += 1;
    if (inserts === 2) { held.resolve(); await release.p; }
    return r;
  });
  const zombie = applyJob(runId, jobId);
  await held.p;
  while (pending.length) pending.pop()();
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'failed', queueJobId: null } });
  const disc = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/discard`, asAdmin({ passId: String(ctx.pass._id), confirmActive: true, clearKnocks: true }));
  assert.strictEqual(disc.status, 200, JSON.stringify(disc.json));
  // Every copy is in the snapshot now, so the page refuses (nothing on file); with any on file it would
  // go ahead — the undo job runs as it would then.
  assert.strictEqual((await undoPressed(runId)).json.code, 'NOTHING_TO_UNDO');
  const undoId = await armUndo(runId);
  await undoJob(runId, undoId);
  const rs = await call('POST', `/admin/campaigns/${ctx.campaign._id}/turfs/restore-snapshot`, asAdmin({ snapshotId: disc.json.snapshotId }));
  assert.strictEqual(rs.status, 200, JSON.stringify(rs.json));
  assert.ok(((await liveOf(v[30])).answerEditFence || []).some((f) => String(f) === String(runId)), 'restored with the fence');
  release.resolve();
  await zombie;
  assert.deepStrictEqual(await signOf(v[30]), ['yard_sign_delivered', 'volunteer_request'], 'the delivery never landed after the undo');
});
