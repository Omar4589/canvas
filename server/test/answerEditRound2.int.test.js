import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Code review round 2 of Edit answers on Door Outcomes (2026-10-19), each finding pinned against the
// REAL app + a throwaway mongod — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §V:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/answer_edit_r2 node --test --test-force-exit test/answerEditRound2.int.test.js
//
// Redis points at a dead port, as everywhere here: a create or an undo answers 503 when it can't
// reach the queue, and the tests drive the REAL processors with the job id the run carries.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-r2';
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
const { processAnswerEditJob } = await import('../src/services/canvass/answerEditRuns.js');
const { applyChunk } = await import('../src/services/canvass/answerEditWriter.js');
const { processConversionJob } = await import('../src/services/canvass/conversionProcessor.js');
const { getQueue, QUEUE_NAMES } = await import('../src/queues/index.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const DOORS = 60;
// Doors with a second voter: one canvasser's visit, two people surveyed.
const TWO_VOTER_DOORS = [40, 41, 42, 43];

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
    Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household,
    Voter, CanvassActivity, SurveyResponse, SurveyResponseArchive, SurveyTemplate, SurveyConversionRun, ConversionStrike,
    UnknockRun, UnknockRunChunk, AnswerEditRun, AnswerEditRunChunk, CampaignChange, Subscription,
  ]) {
    await M.deleteMany({});
  }
  await SurveyResponse.init();
  await SurveyResponseArchive.init();
  await AnswerEditRunChunk.init();

  const org = await Organization.create({ name: 'Edit Org R2', slug: 'edit-org-r2', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ra@t.co', passwordHash: 'x', isActive: true });
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'rb@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'rc@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'ro@t.co', passwordHash: 'x', isActive: true });
  for (const u of [admin, bea]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const otherTemplate = await SurveyTemplate.create({ organizationId: org._id, name: 'Other Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit R2', type: 'survey', state: 'FL', isActive: true,
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

// ── the writer: two deliveries, a zombie, the undo's fence ──────────────────────────────────────

test('W1: a delivery never deletes its own copy after another delivery adopted it and landed it', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[1], 1, FAKE())).status, 201);
  const original = await liveOf(v[1]);
  const runId = await createTakeOut(1);
  const run = await AnswerEditRun.findById(runId).lean();
  const chunk = await AnswerEditRunChunk.findOne({ runId: run._id }).lean();
  // Delivery B inserts its copy and stalls before its compare-and-swap...
  const inserted = deferred();
  const release = deferred();
  hookOnce(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    const r = await real(...args);
    inserted.resolve();
    await release.p;
    return r;
  });
  const bP = applyChunk({ run, chunk });
  await inserted.p;
  // ...delivery A adopts that copy and lands the edit through it...
  const a = await applyChunk({ run, chunk });
  assert.strictEqual(a.counts.changed, 1);
  // ...then B wakes, misses, and must leave the copy A landed with.
  release.resolve();
  const b = await bP;
  assert.strictEqual(b.counts.changed, 1, 'B counts the edit another delivery landed');
  assert.deepStrictEqual(await signOf(v[1]), ['yard_sign_delivered']);
  assert.ok(holdsOriginal(await copiesOf(v[1], 'answer_edit'), original), 'the copy of the original is still on file');
  // The undo can put it back.
  await AnswerEditRunChunk.updateOne({ _id: chunk._id }, { $set: { done: true, counts: a.counts, items: a.items } });
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'completed', 'counts.surveysChanged': 1 } });
  const undo = await runUndo(runId);
  assert.strictEqual(undo.summary.putBack, 1);
  assert.deepStrictEqual(await signOf(v[1]), ['yard_sign_delivered', 'volunteer_request']);
});

test('W1: a teammate re-survey between the other delivery landing and this one reading back keeps the original', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[2], 2, FAKE())).status, 201);
  const original = await liveOf(v[2]);
  const runId = await createTakeOut(2);
  const run = await AnswerEditRun.findById(runId).lean();
  const chunk = await AnswerEditRunChunk.findOne({ runId: run._id }).lean();
  const inserted = deferred();
  const release = deferred();
  hookOnce(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    const r = await real(...args);
    inserted.resolve();
    await release.p;
    return r;
  });
  const bP = applyChunk({ run, chunk });
  await inserted.p;
  await applyChunk({ run, chunk });
  // Otto re-surveys the voter: the phone keeps the edited version as a copy and $unsets the marks.
  assert.strictEqual((await survey(ctx.ottoTok, v[2], 2, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  release.resolve();
  await bP;
  assert.ok(holdsOriginal(await copiesOf(v[2]), original), "Cara's original answers are still on file");
});

test('W1: a delivery still running when its change is undone can never land afterwards', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[3], 3, FAKE())).status, 201);
  const runId = await createTakeOut(3);
  const run = await AnswerEditRun.findById(runId).lean();
  const chunk = await AnswerEditRunChunk.findOne({ runId: run._id }).lean();
  // The zombie reads the survey and inserts its copy, then stalls (a hung connection beside Start again).
  const inserted = deferred();
  const release = deferred();
  hookOnce(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    const r = await real(...args);
    inserted.resolve();
    await release.p;
    return r;
  });
  const zombie = applyChunk({ run, chunk });
  await inserted.p;
  // Meanwhile the change completes through another delivery and is undone.
  const a = await applyChunk({ run, chunk });
  await AnswerEditRunChunk.updateOne({ _id: chunk._id }, { $set: { done: true, counts: a.counts, items: a.items } });
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'completed', 'counts.surveysChanged': 1 } });
  const undo = await runUndo(runId);
  assert.strictEqual(undo.summary.putBack, 1);
  assert.deepStrictEqual(await signOf(v[3]), ['yard_sign_delivered', 'volunteer_request']);
  // The zombie wakes with the put-back's bytes matching what it read: the fence turns it away.
  release.resolve();
  const z = await zombie;
  assert.strictEqual(z.counts.changed, 0);
  assert.deepStrictEqual(await signOf(v[3]), ['yard_sign_delivered', 'volunteer_request'], 'the edit is not written back over the undo');
  assert.strictEqual((await liveOf(v[3])).answerEditMarks?.length || 0, 0);
});

test('W1: an undo that runs while a delivery is between its copy and its write deletes the copy, and the write never lands', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[4], 4, FAKE())).status, 201);
  const original = await liveOf(v[4]);
  const runId = await createTakeOut(4);
  const run = await AnswerEditRun.findById(runId).lean();
  const chunk = await AnswerEditRunChunk.findOne({ runId: run._id }).lean();
  const inserted = deferred();
  const release = deferred();
  hookOnce(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    const r = await real(...args);
    inserted.resolve();
    await release.p;
    return r;
  });
  const zombie = applyChunk({ run, chunk });
  await inserted.p;
  // Parked (a Start again that timed out), and the admin presses Undo what landed.
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'failed' } });
  const undo = await runUndo(runId);
  assert.strictEqual(undo.summary.putBack, 0);
  assert.strictEqual((await copiesOf(v[4], 'answer_edit')).length, 0, 'the never-landed copy is redundant and removed');
  release.resolve();
  await zombie;
  assert.deepStrictEqual(await signOf(v[4]), ['yard_sign_delivered', 'volunteer_request'], 'the write never lands after the undo');
  assert.deepStrictEqual((await liveOf(v[4])).answers, original.answers);
});

// ── the undo ────────────────────────────────────────────────────────────────────────────────────

test('W4: an Erase before the undo stamps the copy is honoured — the erased answers are not written back', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[5], 5, FAKE())).status, 201);
  const runId = await takeOutApplied(5);
  const [copy] = await copiesOf(v[5], 'answer_edit');
  let erase;
  // The undo has read the chunk's copies; an admin erases this one before the undo reaches it.
  hookOnce(SurveyResponseArchive.collection, 'updateOne', async (real, args) => {
    erase = await call('DELETE', `/admin/voters/${v[5]._id}/surveys/archive/${copy._id}`, asAdmin());
    return real(...args);
  });
  const undo = await runUndo(runId);
  assert.strictEqual(erase.status, 200, JSON.stringify(erase.json));
  assert.strictEqual(undo.summary.erased, 1);
  assert.strictEqual(undo.summary.putBack, 0);
  assert.deepStrictEqual(await signOf(v[5]), ['yard_sign_delivered'], 'the erased answers stay off the survey');
});

test('P3: a survey re-surveyed with the same picks keeps its copy as history — Undo never deletes what it did not put back', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[6], 6, FAKE(), { note: 'ORIGINAL NOTE from the door' })).status, 201);
  const runId = await takeOutApplied(6);
  // Cara surveys again with the very picks she had, and a new note.
  assert.strictEqual((await survey(ctx.caraTok, v[6], 6, FAKE(), { note: 'a later note' })).status, 201);
  const undo = await runUndo(runId);
  assert.strictEqual(undo.summary.putBack, 0);
  assert.strictEqual(undo.summary.changedSince, 1, 'named as changed since, not silently dropped');
  const kept = await copiesOf(v[6], 'answer_edit');
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0].note, 'ORIGINAL NOTE from the door');
});

test('W5: an undo the first build left running (no heartbeat) can be started again', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[7], 7, FAKE())).status, 201);
  const runId = await takeOutApplied(7);
  const old = new Date(Date.now() - 11 * 60 * 1000);
  await AnswerEditRun.updateOne(
    { _id: runId },
    { $set: { 'undo.status': 'running', 'undo.jobId': 'lost-589c1c0-job', 'undo.lastRunAt': null, 'undo.startedAt': old, 'undo.requestedAt': old } }
  );
  const wire = await call('GET', edits(`/${runId}`), asAdmin());
  assert.strictEqual(wire.json.run.undo.stalled, true);
  const again = await call('POST', edits(`/${runId}/revert`), asAdmin());
  assert.notStrictEqual(again.json?.code, 'RUN_BUSY', 'Start again is not refused forever');
  assert.strictEqual(again.status, 503, 'claimed; only the dead queue stops it');
  const undo = await runUndo(runId);
  assert.strictEqual(undo.summary.putBack, 1);
});

test('W6: Undo again on a run the first build undid counts its put-backs, not "restored on the profile"', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [8, 9]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const e8 = await entryOf(v[8], ctx.cara._id);
  const e9 = await entryOf(v[9], ctx.cara._id);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Elm St' }), actionIds: [String(e8._id), String(e9._id)], plan: TAKE_OUT });
  const runId = created.json.run.id;
  await runApply(runId);
  assert.strictEqual((await runUndo(runId)).summary.putBack, 2);
  // What 589c1c0's undo left: the same put-backs, with no receipts.
  await SurveyResponse.collection.updateMany({ voterId: { $in: [v[8]._id, v[9]._id] } }, { $unset: { answerEditUndone: '' } });
  const again = await runUndo(runId);
  assert.strictEqual(again.summary.putBack, 2);
  assert.strictEqual(again.summary.restoredOnProfile, 0);
});

// ── History ─────────────────────────────────────────────────────────────────────────────────────

test('W2: a History row whose write fails is written by the redelivery, once', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[10], 10, FAKE())).status, 201);
  const runId = await createTakeOut(10);
  const t0 = new Date();
  hookOnce(CampaignChange, 'updateOne', async () => {
    throw new Error('the database dropped the History write');
  });
  await assert.rejects(runApply(runId), /dropped the History write/);
  assert.deepStrictEqual(await runApply(runId), { completed: true }, 'the redelivery finishes the run');
  const rows = await historySince('answerEdit', t0);
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0].toValue, /\(1 survey\)$/);
  // And again changes nothing.
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { status: 'running' } });
  await runApply(runId);
  assert.strictEqual((await historySince('answerEdit', t0)).length, 1);
});

test('W3: an undo cut off part-way is logged once, with every survey it put back', { skip }, async () => {
  const v = ctx.voters;
  const idx = [11, 12, 13];
  for (const i of idx) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const ids = [];
  for (const i of idx) ids.push(String((await entryOf(v[i], ctx.cara._id))._id));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Elm St' }), actionIds: ids, plan: TAKE_OUT });
  const runId = created.json.run.id;
  await runApply(runId);
  const t0 = new Date();
  const jobId = await armUndo(runId);
  // The pass dies after its second put-back.
  let putBacks = 0;
  const restore = hookAll(SurveyResponse.collection, 'updateOne', async (real, args) => {
    const r = await real(...args);
    if (args[1]?.$addToSet?.answerEditUndone && ++putBacks === 2) throw new Error('worker restarted mid-undo');
    return r;
  });
  try {
    await assert.rejects(undoJob(runId, jobId), /worker restarted/);
  } finally {
    restore();
  }
  // BullMQ redelivers the same job; it finishes.
  const done = await undoJob(runId, jobId);
  assert.strictEqual(done.summary.putBack, 3);
  let rows = await historySince('answerEditUndo', t0);
  assert.strictEqual(putBackLogged(rows), 3, 'History reports every survey the undo put back');
  assert.strictEqual(rows.length, 1);
  // A redelivery after the pass finished logs nothing more.
  await AnswerEditRun.updateOne({ _id: runId }, { $set: { 'undo.status': 'running' } });
  await undoJob(runId, jobId);
  rows = await historySince('answerEditUndo', t0);
  assert.strictEqual(rows.length, 1);
});

test('W7: two deliveries of one undo at once put every survey back once, count it once and log one row', { skip }, async () => {
  const v = ctx.voters;
  const idx = [14, 15, 16, 17, 18, 19];
  for (const i of idx) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const ids = [];
  for (const i of idx) ids.push(String((await entryOf(v[i], ctx.cara._id))._id));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Elm St' }), actionIds: ids, plan: TAKE_OUT });
  const runId = created.json.run.id;
  await runApply(runId);
  const t0 = new Date();
  const jobId = await armUndo(runId);
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const restore = hookAll(SurveyResponse.collection, 'updateOne', async (real, args) => {
    await sleep(Math.floor(rand() * 12));
    return real(...args);
  });
  try {
    await Promise.all([undoJob(runId, jobId), (async () => { await sleep(4); return undoJob(runId, jobId); })()]);
  } finally {
    restore();
  }
  const run = await AnswerEditRun.findById(runId).lean();
  for (const i of idx) assert.deepStrictEqual(await signOf(v[i]), ['yard_sign_delivered', 'volunteer_request']);
  assert.strictEqual(run.undo.summary.putBack, idx.length);
  assert.strictEqual(run.undo.summary.changedSince, 0);
  assert.strictEqual(run.undo.summary.erased, 0);
  const rows = await historySince('answerEditUndo', t0);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(putBackLogged(rows), idx.length);
});

// ── one change at a time: every start is a claim ────────────────────────────────────────────────

test('G2: an Undo pressed while an unknock is mid-run is refused, and the original survives', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[20], 20, FAKE())).status, 201);
  const original = await liveOf(v[20]);
  const runId = await takeOutApplied(20);
  const e = await visitEntry(20, ctx.cara._id);
  let undo;
  // Bea's unknock has read the (edited) survey; the Undo arrives before it archives and deletes.
  hookOnce(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    undo = await call('POST', edits(`/${runId}/revert`), asAdmin());
    return real(...args);
  });
  const unk = await call('POST', unknocks(), asBea({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(unk.status, 201, JSON.stringify(unk.json));
  assert.strictEqual(undo.status, 409, JSON.stringify(undo.json));
  assert.strictEqual(undo.json.code, 'ANOTHER_CHANGE_RUNNING');
  assert.ok(holdsOriginal(await copiesOf(v[20]), original), 'the original is still on file');
});

test('G2: an unknock undo is refused when an answer edit started between its check and its stamp', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [21, 22]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const e21 = await visitEntry(21, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e21._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const e22 = await entryOf(v[22], ctx.cara._id);
  let session;
  hookOnce(UnknockRun, 'updateOne', async (real, args) => {
    // A one-person session opens on another door in between (it holds the campaign while open).
    session = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: '23 Elm St' }), actionIds: [String(e22._id)], mode: 'queue' }, asBea);
    return real(...args);
  });
  const rv = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(session.created.status, 201, JSON.stringify(session.created.json));
  assert.strictEqual(rv.status, 409, JSON.stringify(rv.json));
  assert.strictEqual(rv.json.code, 'ANOTHER_CHANGE_RUNNING');
  assert.strictEqual((await UnknockRun.findById(struck.json.run.id).lean()).revertingAt, null, 'its stamp is cleared');
  await call('POST', edits(`/${session.created.json.run.id}/close`), asBea());
  const later = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(later.status, 200, JSON.stringify(later.json));
});

test('G2: an Undo pressed while a door-by-door conversion step is writing is refused', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [23, 24]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await takeOutApplied(23);
  const e24 = await visitEntry(24, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e24._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  let undo;
  hookOnce(SurveyResponseArchive.collection, 'insertMany', async (real, args) => {
    undo = await call('POST', edits(`/${runId}/revert`), asBea());
    return real(...args);
  });
  const step = await call('POST', conv(`/${opened.json.run.id}/door`), asAdmin({ actionId: String(e24._id) }));
  assert.strictEqual(step.status, 200, JSON.stringify(step.json));
  assert.strictEqual(undo.status, 409, JSON.stringify(undo.json));
  assert.strictEqual(undo.json.code, 'ANOTHER_CHANGE_RUNNING');
  // After the step, the session holds nothing: the undo goes ahead (the dead queue answers 503).
  const after = await call('POST', edits(`/${runId}/revert`), asBea());
  assert.strictEqual(after.status, 503, JSON.stringify(after.json));
  await call('POST', conv(`/${opened.json.run.id}/close`), asAdmin());
});

test('G2: a door-by-door step is refused when an answer edit started between its check and its stamp', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [33, 34]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const e33 = await visitEntry(33, ctx.cara._id);
  const e34 = await entryOf(v[34], ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e33._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  let session;
  // The step's stamp is its first write to the run: a one-person session opens just before it.
  hookOnce(SurveyConversionRun, 'updateOne', async (real, args) => {
    session = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: '35 Elm St' }), actionIds: [String(e34._id)], mode: 'queue' }, asBea);
    return real(...args);
  });
  const step = await call('POST', conv(`/${opened.json.run.id}/door`), asAdmin({ actionId: String(e33._id) }));
  assert.strictEqual(session.created.status, 201, JSON.stringify(session.created.json));
  assert.strictEqual(step.status, 409, JSON.stringify(step.json));
  assert.strictEqual(step.json.code, 'ANOTHER_CHANGE_RUNNING');
  assert.ok(await liveOf(v[33]), 'the door was not converted');
  // Round 3: the stamp is a counter, so two steps at once can't clear each other's — it counted back out.
  assert.strictEqual((await SurveyConversionRun.findById(opened.json.run.id).lean()).stepping || 0, 0, 'its step counted itself out');
  await call('POST', edits(`/${session.created.json.run.id}/close`), asBea());
  await call('POST', conv(`/${opened.json.run.id}/close`), asAdmin());
});

test('G2: Pick up is refused when a conversion was created between its check and its claim', { skip }, async () => {
  const v = ctx.voters;
  for (const i of [25, 26]) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await createTakeOut(25); // parked by the dead queue: Pick up is its button
  const e26 = await visitEntry(26, ctx.cara._id);
  const unstub = stubQueue(QUEUE_NAMES.OUTCOME_CONVERT);
  let c;
  try {
    // At the driver, so the route's query chain stays intact: the first findOneAndUpdate is the claim.
    hookOnce(AnswerEditRun.collection, 'findOneAndUpdate', async (real, args) => {
      c = await call('POST', conv(), asBea({ direction: 'from_survey', to: 'not_home', mode: 'bulk', actionIds: [String(e26._id)] }));
      return real(...args);
    });
    const resume = await call('POST', edits(`/${runId}/resume`), asAdmin());
    assert.ok(c, `the claim was reached: ${resume.status} ${JSON.stringify(resume.json)}`);
    assert.strictEqual(c.status, 201, JSON.stringify(c.json));
    assert.strictEqual(resume.status, 409, JSON.stringify(resume.json));
    assert.strictEqual(resume.json.code, 'ANOTHER_CHANGE_RUNNING');
    assert.strictEqual((await AnswerEditRun.findById(runId).lean()).status, 'failed', 'back to where it was');
  } finally {
    unstub();
  }
  await SurveyConversionRun.updateOne({ _id: c.json.run.id }, { $set: { status: 'failed', queueJobId: null } });
});

test('G3: a conversion whose enqueue timed out never runs when its job arrives late', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[27], 27, FAKE())).status, 201);
  const e = await visitEntry(27, ctx.cara._id);
  const created = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'bulk', actionIds: [String(e._id)] }));
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  const parked = await SurveyConversionRun.findById(created.json.run.id).lean();
  assert.strictEqual(parked.status, 'failed');
  assert.strictEqual(parked.queueJobId, null, 'the job id is forgotten');
  const late = await processConversionJob({ id: 'late-delivery', name: 'convert', data: { runId: created.json.run.id }, updateProgress: async () => {} });
  assert.deepStrictEqual(late, { skipped: 'not-claimable' });
  assert.ok(await liveOf(v[27]), 'the survey is untouched');
  assert.strictEqual((await visitEntry(27, ctx.cara._id)).actionType, 'survey_submitted');
});

// ── privacy: what the runs keep ─────────────────────────────────────────────────────────────────

test('P2: clearing a written answer never stores the voter\'s words in the run or its chunks', { skip }, async () => {
  const v = ctx.voters;
  const secrets = ['my son is in rehab, call after 6', 'I am undocumented, do not share'];
  for (const [k, i] of [28, 29].entries()) {
    assert.strictEqual((await survey(ctx.caraTok, v[i], i, [supportRow(), textRow(secrets[k])])).status, 201);
  }
  const ids = [];
  for (const i of [28, 29]) ids.push(String((await entryOf(v[i], ctx.cara._id))._id));
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id, { search: 'Elm St' }), actionIds: ids, plan: [{ questionKey: 'anything_else', op: 'clear' }] });
  await runApply(created.json.run.id);
  const run = await AnswerEditRun.findById(created.json.run.id).lean();
  assert.strictEqual(run.counts.surveysChanged, 2);
  const chunks = await AnswerEditRunChunk.find({ runId: run._id }).lean();
  const stored = JSON.stringify([run.counts, run.samples, run.planSummary, run.scopeSummary, chunks.map((c) => c.counts)]);
  for (const t of secrets) assert.ok(!stored.includes(t), `the run keeps no "${t}"`);
  assert.strictEqual(run.counts.byQuestion.anything_else.surveys, 2, 'counted per question');
  const wire = await call('GET', edits(`/${run._id}`), asAdmin());
  for (const t of secrets) assert.ok(!JSON.stringify(wire.json).includes(t));
});

// ── Restore: strikes are facts about removal runs ───────────────────────────────────────────────

test('P1: an unknock that archived nothing at the visit still holds a teammate\'s copy of its answers', { skip }, async () => {
  const v = ctx.voters;
  const d = 40;
  assert.strictEqual((await survey(ctx.caraTok, v[d], d, FAKE())).status, 201);
  // Otto surveys the same voter in the round: Cara's answers are kept as a copy, his hold the slot.
  assert.strictEqual((await survey(ctx.ottoTok, v[d], d, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  const caraCopy = (await copiesOf(v[d], 'submit'))[0];
  assert.ok(caraCopy);
  const e = await visitEntry(d, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  assert.strictEqual(struck.json.run.counts.responsesArchived, 0, 'nothing of Cara\'s was live at her visit');
  // Cara comes back to the door and surveys the housemate: her visit reads Surveyed again.
  assert.strictEqual((await survey(ctx.caraTok, ctx.housemates[d], d, [supportRow()])).status, 201);
  const r = await call('POST', `/admin/voters/${v[d]._id}/surveys/${caraCopy._id}/restore`, asAdmin());
  assert.strictEqual(r.status, 409, JSON.stringify(r.json));
  assert.strictEqual(r.json.reason, 'unknocked');
  assert.strictEqual(String((await liveOf(v[d])).userId), String(ctx.otto._id), "Otto's real survey keeps the slot");
});

test('P1: a conversion\'s strike holds after the canvasser re-records the door and its trace is gone', { skip }, async () => {
  const v = ctx.voters;
  const d = 41;
  assert.strictEqual((await survey(ctx.caraTok, v[d], d, FAKE())).status, 201);
  assert.strictEqual((await survey(ctx.ottoTok, v[d], d, [supportRow(), signRow('candidate_follow_up')])).status, 201);
  const caraCopy = (await copiesOf(v[d], 'submit'))[0];
  const e = await visitEntry(d, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  assert.strictEqual((await call('POST', conv(`/${opened.json.run.id}/door`), asAdmin({ actionId: String(e._id) }))).status, 200);
  await call('POST', conv(`/${opened.json.run.id}/close`), asAdmin());
  assert.ok(await ConversionStrike.exists({ runId: opened.json.run.id }), 'the conversion recorded the visit it struck');
  // Cara re-records the door (the housemate's survey): her converted entry is replaced.
  assert.strictEqual((await survey(ctx.caraTok, ctx.housemates[d], d, [supportRow()])).status, 201);
  assert.strictEqual(await CanvassActivity.exists({ 'reclassified.runId': new mongoose.Types.ObjectId(opened.json.run.id) }), null);
  const r = await call('POST', `/admin/voters/${v[d]._id}/surveys/${caraCopy._id}/restore`, asAdmin());
  assert.strictEqual(r.status, 409, JSON.stringify(r.json));
  assert.strictEqual(r.json.reason, 'converted');
});

test('P6: once an unknock is undone, the visit\'s earlier copies follow the plain rule again — never refused forever', { skip }, async () => {
  const v = ctx.voters;
  const d = 42;
  assert.strictEqual((await survey(ctx.caraTok, v[d], d, FAKE())).status, 201);
  const runId = await takeOutApplied(d); // keeps the earlier version as an answer-edit copy
  const [earlier] = await copiesOf(v[d], 'answer_edit');
  const e = await visitEntry(d, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.rowsNotRestored, 0);
  // Cara surveys the housemate: her restored entry at the door is replaced by a newer one.
  assert.strictEqual((await survey(ctx.caraTok, ctx.housemates[d], d, [supportRow()])).status, 201);
  const r = await call('POST', `/admin/voters/${v[d]._id}/surveys/${earlier._id}/restore`, asAdmin());
  assert.notStrictEqual(r.json?.code, 'RESTORE_VISIT_NOT_SURVEYED', JSON.stringify(r.json));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.ok(runId);
});

test('P8: a converted entry matches only its own voter — a housemate surveyed in the same millisecond is stored', { skip }, async () => {
  const v = ctx.voters;
  const d = 43;
  const ts = nextTs();
  assert.strictEqual((await survey(ctx.caraTok, v[d], d, FAKE(), { timestamp: ts })).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  assert.strictEqual((await call('POST', conv(`/${opened.json.run.id}/door`), asAdmin({ actionId: String(e._id) }))).status, 200);
  await call('POST', conv(`/${opened.json.run.id}/close`), asAdmin());
  // A duplicate of the converted survey itself is the same delivery: answered as superseded, and
  // the answers the admin took off stay off.
  const dup = await survey(ctx.caraTok, v[d], d, FAKE(), { timestamp: ts, wasOfflineSubmission: true });
  assert.strictEqual(dup.json?.superseded, true, JSON.stringify(dup.json));
  assert.strictEqual(await liveOf(v[d]), null);
  // A queued replay of the HOUSEMATE's survey from the same tap instant is new work.
  const mate = await survey(ctx.caraTok, ctx.housemates[d], d, [supportRow()], { timestamp: ts, wasOfflineSubmission: true });
  assert.ok([200, 201].includes(mate.status), JSON.stringify(mate.json));
  assert.notStrictEqual(mate.json?.superseded, true, JSON.stringify(mate.json));
  assert.ok(await liveOf(ctx.housemates[d]), "the housemate's survey is on file");
});

// ── the rest ────────────────────────────────────────────────────────────────────────────────────

test('C9: a change whose queue timed out before it ever started has nothing to undo', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[30], 30, FAKE())).status, 201);
  const runId = await createTakeOut(30);
  const r = await call('POST', edits(`/${runId}/revert`), asAdmin());
  assert.strictEqual(r.status, 409, JSON.stringify(r.json));
  assert.strictEqual(r.json.code, 'NOTHING_TO_UNDO');
  const wire = await call('GET', edits(`/${runId}`), asAdmin());
  assert.strictEqual(wire.json.run.startedAt, null);
});

test('C8: a note-only save on a survey whose questions are gone is accepted', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[31], 31, FAKE())).status, 201);
  const live = await liveOf(v[31]);
  await SurveyResponse.collection.updateOne({ _id: live._id }, { $set: { surveyTemplateId: new mongoose.Types.ObjectId() } });
  const r = await call('PATCH', `/admin/voters/${v[31]._id}/surveys/${live._id}`, asAdmin({ answers: [], note: 'called back, all good' }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual((await liveOf(v[31])).note, 'called back, all good');
  const refused = await call('PATCH', `/admin/voters/${v[31]._id}/surveys/${live._id}`, asAdmin({ answers: [signRow()] }));
  assert.strictEqual(refused.status, 409);
  assert.strictEqual(refused.json.code, 'TEMPLATE_MISSING');
});

test('S3: "matched but not selected" is counted only against the answer filter\'s own survey', { skip }, async () => {
  const v = ctx.voters;
  assert.strictEqual((await survey(ctx.caraTok, v[32], 32, FAKE())).status, 201);
  const scope = scopeFor(ctx.cara._id, {
    surveyTemplateId: String(ctx.template._id),
    answerFilters: [{ questionKey: 'yard_sign', values: ['volunteer_request'] }],
  });
  const dry = await call('POST', edits(), asAdmin({ scope, dryRun: true, surveyTemplateId: String(ctx.otherTemplate._id) }));
  assert.strictEqual(dry.status, 200, JSON.stringify(dry.json));
  assert.strictEqual(dry.json.matchedNotSelected || 0, 0);
});
