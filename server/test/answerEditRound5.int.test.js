import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Code review round 5 of Edit answers on Door Outcomes (2026-10-20), each finding pinned against the
// REAL app + a throwaway mongod — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §V. Most are the reviewers' own
// reproductions, asserting what the fix does:
//   npm run test:int -- test/answerEditRound5.int.test.js
//
// Redis points at a dead port, as everywhere here: a create or an undo answers 503 when it can't
// reach the queue, and the tests drive the REAL processors with the job id the run carries.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-answer-edit-r5';
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
const { computeUnknockAnswers } = await import('../src/services/canvass/unknock.js');
const { unknockHistoryRowId } = await import('../src/services/canvass/unknockLease.js');
const { doorKey } = await import('../src/services/canvass/doorKey.js');
const { currentVoterSetsByTag } = await import('../src/services/surveys/currentTags.js');

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

  const org = await Organization.create({ name: 'Edit Org R5', slug: 'edit-org-r5', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'r5a@t.co', passwordHash: 'x', isActive: true });
  const bea = await User.create({ firstName: 'Bea', lastName: 'Backup', email: 'r5b@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'r5c@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'r5o@t.co', passwordHash: 'x', isActive: true });
  for (const u of [admin, bea]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Support Survey', version: 1, isActive: true, questions: QUESTIONS });
  const otherTemplate = await SurveyTemplate.create({ organizationId: org._id, name: 'Other Survey', version: 1, isActive: true, questions: QUESTIONS });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Edit R5', type: 'survey', state: 'FL', isActive: true,
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
const cardsOf = async (voter) => (await profileOf(voter)).json.overwrittenSurveys;
const restoreCopy = (voter, archiveId) => call('POST', `/admin/voters/${voter._id}/surveys/${archiveId}/restore`, asAdmin());
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

// ── an Erase while a removal's Undo writes the copy back (R-M1) ──────────────────────────────────

const eraseCopy = (voter, archiveId) => call('DELETE', `/admin/voters/${voter._id}/surveys/archive/${archiveId}`, asAdmin());
// The removal undos' claim on their copies (claimCopiesForWriteBack): the first updateMany that sets
// an undo token.
const isClaim = (args) => !!args[1]?.$set?.undoToken;

test('R-M1: an Erase or a Restore pressed while an unknock\'s Undo writes the copy back waits — the survey comes back once, from the copy', { skip }, async () => {
  const d = 1;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const [copy] = await copiesOf(v, 'unknock');
  // Held at its write-back, past its claim.
  let erased;
  let restored;
  hookOnce(SurveyResponse.collection, 'insertMany', async (real, args) => {
    erased = await eraseCopy(v, copy._id);
    restored = await restoreCopy(v, copy._id);
    return real(...args);
  });
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(erased.status, 409, JSON.stringify(erased.json));
  assert.strictEqual(erased.json.code, 'COPY_IN_USE');
  assert.strictEqual(restored.status, 409, JSON.stringify(restored.json));
  assert.strictEqual(restored.json.code, 'COPY_IN_USE');
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], 'put back from the copy');
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 0);
  assert.strictEqual((await copiesOf(v)).length, 0, 'the copy it wrote back is gone');
});

test('R-M1: an Erase that lands before an unknock\'s Undo claims the copy stays erased — the answers are not put back', { skip }, async () => {
  const d = 2;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const [copy] = await copiesOf(v, 'unknock');
  // The Erase lands between the undo's read of its copies and its claim.
  let erased;
  hookAll(SurveyResponseArchive.collection, 'updateMany', async (real, args) => {
    if (isClaim(args) && !erased) erased = await eraseCopy(v, copy._id);
    return real(...args);
  });
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  while (pending.length) pending.pop()();
  assert.strictEqual(erased.status, 200, JSON.stringify(erased.json));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 1, 'counted not put back');
  assert.strictEqual(await liveOf(v), null, 'the erased answers never come back');
  assert.ok(await visitEntry(d, ctx.cara._id), 'the entry does');
});

test('R-M1: the same for a Surveyed → Not home Undo — an Erase while it writes the copy back waits; one before its claim stays erased', { skip }, async () => {
  const [d1, d2] = [3, 4];
  for (const d of [d1, d2]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  // While it writes back.
  const run1 = await convertDoorFromSurvey((await visitEntry(d1, ctx.cara._id))._id);
  const [copy1] = await copiesOf(ctx.voters[d1], 'outcome_convert');
  let erased1;
  hookOnce(SurveyResponse.collection, 'insertMany', async (real, args) => {
    erased1 = await eraseCopy(ctx.voters[d1], copy1._id);
    return real(...args);
  });
  const undone1 = await call('POST', conv(`/${run1}/revert`), asAdmin());
  assert.strictEqual(undone1.status, 200, JSON.stringify(undone1.json));
  assert.strictEqual(erased1.status, 409, JSON.stringify(erased1.json));
  assert.strictEqual(erased1.json.code, 'COPY_IN_USE');
  assert.deepStrictEqual(await signOf(ctx.voters[d1]), ['yard_sign_delivered', 'volunteer_request']);
  assert.strictEqual((await copiesOf(ctx.voters[d1])).length, 0);
  // Before its claim.
  const run2 = await convertDoorFromSurvey((await visitEntry(d2, ctx.cara._id))._id);
  const [copy2] = await copiesOf(ctx.voters[d2], 'outcome_convert');
  let erased2;
  hookAll(SurveyResponseArchive.collection, 'updateMany', async (real, args) => {
    if (isClaim(args) && !erased2) erased2 = await eraseCopy(ctx.voters[d2], copy2._id);
    return real(...args);
  });
  const undone2 = await call('POST', conv(`/${run2}/revert`), asAdmin());
  while (pending.length) pending.pop()();
  assert.strictEqual(erased2.status, 200, JSON.stringify(erased2.json));
  assert.strictEqual(undone2.status, 200, JSON.stringify(undone2.json));
  assert.strictEqual(undone2.json.run.counts.responsesNotRestored, 1);
  assert.strictEqual(await liveOf(ctx.voters[d2]), null, 'the erased answers never come back');
  assert.strictEqual((await visitEntry(d2, ctx.cara._id)).actionType, 'survey_submitted', 'the entry does');
});

// ── Restore while a removal is still writing (R-M2) ─────────────────────────────────────────────

test('R-M2: Restore is refused while an unknock is still removing — between its answers\' and its entries\' delete', { skip }, async () => {
  const d = 5;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const inside = deferred();
  const release = deferred();
  hookOnce(CanvassActivity.collection, 'deleteMany', async (real, args) => {
    inside.resolve();
    await release.p;
    return real(...args);
  });
  const strike = call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  await inside.p;
  let card;
  let restored;
  try {
    const [copy] = await copiesOf(v, 'unknock');
    card = (await cardsOf(v)).find((c) => String(c.id) === String(copy._id));
    restored = await restoreCopy(v, copy._id);
  } finally {
    release.resolve();
  }
  assert.strictEqual(card.restorable, false);
  assert.strictEqual(card.restoreBlockedReason, 'unknocked');
  assert.strictEqual(restored.status, 409, JSON.stringify(restored.json));
  assert.strictEqual(restored.json.reason, 'unknocked');
  assert.strictEqual((await strike).status, 201);
  assert.strictEqual(await liveOf(v), null, 'no struck answers came back under the unknocked door');
  assert.strictEqual((await Household.findById(ctx.homes[d]._id).lean()).status, 'unknocked');
});

test('R-M2: Restore is refused between an unknock\'s copy and its answers\' delete — the strike can\'t then delete what Restore put back', { skip }, async () => {
  const d = 6;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const inside = deferred();
  const release = deferred();
  hookOnce(SurveyResponse.collection, 'bulkWrite', async (real, args) => {
    inside.resolve();
    await release.p;
    return real(...args);
  });
  const strike = call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  await inside.p;
  let restored;
  try {
    const [copy] = await copiesOf(v, 'unknock');
    restored = await restoreCopy(v, copy._id);
  } finally {
    release.resolve();
  }
  assert.strictEqual(restored.status, 409, JSON.stringify(restored.json));
  const struck = await strike;
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  assert.strictEqual((await copiesOf(v, 'unknock')).length, 1, 'the copy is still on file');
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 0);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request'], 'and its Undo puts it back');
});

test('R-M2: Restore is refused while a Surveyed → Not home step is still saving — between its answers\' delete and its entry\'s flip', { skip }, async () => {
  const d = 7;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  const inside = deferred();
  const release = deferred();
  hookOnce(CanvassActivity, 'bulkWrite', async (real, args) => {
    inside.resolve();
    await release.p;
    return real(...args);
  });
  const step = call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e._id) }));
  await inside.p;
  let restored;
  try {
    const [copy] = await copiesOf(v, 'outcome_convert');
    restored = await restoreCopy(v, copy._id);
  } finally {
    release.resolve();
  }
  assert.strictEqual(restored.status, 409, JSON.stringify(restored.json));
  assert.strictEqual(restored.json.reason, 'converted');
  assert.strictEqual((await step).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  assert.strictEqual(await liveOf(v), null, 'no answers came back under the Not home entry');
  assert.strictEqual((await visitEntry(d, ctx.cara._id)).actionType, 'not_home');
});

test('R-M2: another kept copy of a visit an unknock is still removing is held too — a teammate\'s earlier copy of it', { skip }, async () => {
  const d = 34;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201); // Cara's
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [supportRow()])).status, 201); // Otto's: Cara's -> a copy
  const c1 = (await copiesOf(v, 'submit')).find((c) => String(c.userId) === String(ctx.cara._id));
  assert.ok(c1);
  const e = await visitEntry(d, ctx.cara._id);
  const inside = deferred();
  const release = deferred();
  hookOnce(CanvassActivity.collection, 'deleteMany', async (real, args) => {
    inside.resolve();
    await release.p;
    return real(...args);
  });
  const strike = call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  await inside.p;
  let restored;
  try {
    restored = await restoreCopy(v, c1._id);
  } finally {
    release.resolve();
  }
  assert.strictEqual(restored.status, 409, JSON.stringify(restored.json));
  assert.strictEqual(restored.json.reason, 'unknocked');
  assert.strictEqual((await strike).status, 201);
  assert.deepStrictEqual(await signOf(v), null, 'Otto\'s survey stays — no struck answers swapped over it');
  assert.strictEqual(String((await liveOf(v)).userId), String(ctx.otto._id));
});

test('R-M2: another kept copy of a visit a Surveyed → Not home step is still converting is held too', { skip }, async () => {
  const d = 35;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  assert.strictEqual((await survey(ctx.ottoTok, v, d, [supportRow()])).status, 201);
  const c1 = (await copiesOf(v, 'submit')).find((c) => String(c.userId) === String(ctx.cara._id));
  assert.ok(c1);
  const e = await visitEntry(d, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e._id)] }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const runId = opened.json.run.id;
  const inside = deferred();
  const release = deferred();
  hookOnce(CanvassActivity, 'bulkWrite', async (real, args) => {
    inside.resolve();
    await release.p;
    return real(...args);
  });
  const stepping = call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e._id) }));
  await inside.p;
  let restored;
  try {
    restored = await restoreCopy(v, c1._id);
  } finally {
    release.resolve();
  }
  assert.strictEqual(restored.status, 409, JSON.stringify(restored.json));
  assert.strictEqual(restored.json.reason, 'converted');
  assert.strictEqual((await stepping).status, 200);
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  assert.strictEqual(String((await liveOf(v)).userId), String(ctx.otto._id), 'Otto\'s survey stays');
  assert.strictEqual((await visitEntry(d, ctx.cara._id)).actionType, 'not_home');
});

// ── the strike, a failed undo, and what a stopped strike leaves (R-m3, R-m4, R-m6, C-m7) ─────────

test('R-m3: a strike that stalled past its lease, undone by an undo that FAILED, still stops before its next removal', { skip }, async () => {
  const d = 8;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  // Held at the beat before its entries' delete (the second after its mark).
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
  let failed;
  let run;
  try {
    run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
    await silence(run._id);
    // Its undo puts the answers back, then fails before it finishes — and clears its revertingAt.
    hookOnce(UnknockRunChunk, 'updateOne', async () => {
      throw new Error('connection dropped');
    });
    failed = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  } finally {
    release.resolve();
  }
  assert.strictEqual(failed.status, 500);
  assert.strictEqual((await UnknockRun.findById(run._id).lean()).revertingAt, null, 'the failed undo let go');
  const out = await strike;
  while (pending.length) pending.pop()();
  assert.strictEqual(out.status, 500, 'the strike stopped');
  const after = await UnknockRun.findById(run._id).lean();
  assert.strictEqual(after.status, 'pending', 'never completed over the partial undo');
  assert.ok(await visitEntry(d, ctx.cara._id), 'its entry was never removed');
  assert.ok(await liveOf(v), 'the answers the undo put back stay');
  const retried = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  assert.strictEqual(retried.status, 200, JSON.stringify(retried.json));
  assert.strictEqual((await UnknockRun.findById(run._id).lean()).status, 'reverted');
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request']);
});

test('R-m4, C-m7: a strike that failed reads stopped at once; its Undo puts no answers back under an entry another admin converted since', { skip }, async () => {
  const d = 9;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  // The strike fails right after taking the answers (its entries' delete throws).
  hookOnce(CanvassActivity.collection, 'deleteMany', async () => {
    throw new Error('connection dropped');
  });
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 500);
  const run = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  const listed = await listedUnknock(run._id);
  assert.strictEqual(listed.removing, false, 'not Removing… for ten minutes');
  assert.strictEqual(listed.stoppedPartWay, true, 'Stopped part-way, with its Undo, at once');
  assert.strictEqual(await liveOf(v), null);
  // Another admin converts the still-Surveyed entry to Not home.
  await convertDoorFromSurvey(e._id);
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 1);
  assert.strictEqual(await liveOf(v), null, 'no answers under the Not home entry');
  assert.strictEqual((await visitEntry(d, ctx.cara._id)).actionType, 'not_home');
});

test('R-m6: a strike that stopped after its deletes is in History and settled; its Undo logs the other half', { skip }, async () => {
  const d = 11;
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
  const history = () => CampaignChange.find({ campaignId: ctx.campaign._id, field: 'unknock', createdAt: { $gte: run.createdAt } }).sort({ createdAt: 1 }).lean();
  assert.deepStrictEqual((await history()).map((h) => h.toValue), ['unknocked'], 'listed though it never finished');
  assert.strictEqual((await Household.findById(ctx.homes[d]._id).lean()).status, 'unknocked', 'its door settled as it went');
  assert.notStrictEqual((await Voter.findById(v._id).lean()).surveyStatus, 'surveyed', 'and its voter');
  assert.strictEqual((await listedUnknock(run._id)).stoppedPartWay, true);
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(run._id) }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.deepStrictEqual((await history()).map((h) => h.toValue), ['unknocked', 'recorded']);
  assert.strictEqual((await Household.findById(ctx.homes[d]._id).lean()).status, 'surveyed');
});

test('R-m6: an Undo that dies after its History and settle, before it reads undone, is finished by Undo again — logged once', { skip }, async () => {
  const d = 12;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  let thrown = false;
  hookAll(UnknockRun.collection, 'updateOne', async (real, args) => {
    if (args[1]?.$set?.status === 'reverted' && !thrown) {
      thrown = true;
      throw new Error('dyno restarted');
    }
    return real(...args);
  });
  const first = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  while (pending.length) pending.pop()();
  assert.strictEqual(first.status, 500);
  assert.strictEqual((await Household.findById(ctx.homes[d]._id).lean()).status, 'surveyed', 'settled before it died');
  const since = new Date((await UnknockRun.findById(struck.json.run.id).lean()).createdAt);
  const again = await call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  assert.strictEqual(again.status, 200, JSON.stringify(again.json));
  const rows = await CampaignChange.find({ campaignId: ctx.campaign._id, field: 'unknock', createdAt: { $gte: since } }).sort({ createdAt: 1 }).lean();
  assert.deepStrictEqual(rows.map((h) => h.toValue), ['unknocked', 'recorded'], 'its undo logged once');
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request']);
});

// ── which removal a refusal names (R-m5) ─────────────────────────────────────────────────────────

test('R-m5: a copy an undone unknock holds for good, and a later standing one too, names the one that can never lift', { skip }, async () => {
  const d = 10;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e1 = await visitEntry(d, ctx.cara._id);
  const u1 = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e1._id)] }));
  assert.strictEqual(u1.status, 201, JSON.stringify(u1.json));
  const [x] = await copiesOf(v, 'unknock');
  // Cara records the visit again: U1's undo can't put its entry back there.
  assert.strictEqual((await survey(ctx.caraTok, v, d, [supportRow()])).status, 201);
  const r1 = await call('POST', unknocks('/revert'), asAdmin({ runId: u1.json.run.id }));
  assert.strictEqual(r1.json.run.counts.rowsNotRestored, 1);
  // ...and the new visit is unknocked too.
  const n1 = await visitEntry(d, ctx.cara._id);
  const u2 = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(n1._id)] }));
  assert.strictEqual(u2.status, 201, JSON.stringify(u2.json));
  const refused = await restoreCopy(v, x._id);
  assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
  assert.strictEqual(refused.json.reason, 'kept_after_undo', 'never "undo that unknock" — undoing it wouldn\'t lift the other');
});

// ── the unknock preview (R-m7) ───────────────────────────────────────────────────────────────────

test('R-m7: the unknock preview counts a survey once when two Surveyed entries at its visit fall in different batches', { skip }, async () => {
  const n = 598;
  const doors = await Household.insertMany(
    Array.from({ length: n }, (_, i) => ({
      organizationId: ctx.org._id, campaignId: ctx.campaign._id, addressLine1: `${i} Preview Rd`, city: 'Town', state: 'FL', zipCode: '33540',
      normalizedAddress: `PREVIEW${i}`, location: { type: 'Point', coordinates: [-82.3, 28.4] }, isActive: true, status: 'surveyed',
    })),
    { lean: true }
  );
  const voters = await Voter.insertMany(
    doors.map((h, i) => ({ organizationId: ctx.org._id, campaignId: ctx.campaign._id, householdId: h._id, stateVoterId: `PREVIEW-${i}`, firstName: 'P', lastName: `${i}`, fullName: `Preview ${i}` })),
    { lean: true }
  );
  const ts = new Date(Date.now() - 30 * 3600_000);
  const base = { organizationId: ctx.org._id, campaignId: ctx.campaign._id, userId: ctx.otto._id, passId: ctx.pass._id };
  await SurveyResponse.collection.insertMany(doors.map((h, i) => ({ ...base, householdId: h._id, voterId: voters[i]._id, surveyTemplateId: ctx.template._id, submittedAt: ts, answers: FAKE(), createdAt: ts, updatedAt: ts })));
  const shared = { householdId: ctx.homes[79]._id, passId: ctx.pass._id, userId: ctx.otto._id, actionType: 'survey_submitted' };
  await SurveyResponse.collection.insertOne({ ...base, householdId: ctx.homes[79]._id, voterId: ctx.voters[79]._id, surveyTemplateId: ctx.template._id, submittedAt: ts, answers: FAKE(), createdAt: ts, updatedAt: ts });
  // Two entries of one visit, first and last: 500 visits a batch puts them in different batches.
  const rows = [shared, ...doors.map((h) => ({ householdId: h._id, passId: ctx.pass._id, userId: ctx.otto._id, actionType: 'survey_submitted' })), shared];
  const preview = await computeUnknockAnswers({ rows });
  assert.strictEqual(preview.responsesToArchive, n + 1);
  await Promise.all([
    SurveyResponse.deleteMany({ $or: [{ householdId: { $in: doors.map((d) => d._id) } }, { voterId: ctx.voters[79]._id }] }),
    Voter.deleteMany({ householdId: { $in: doors.map((d) => d._id) } }),
    Household.deleteMany({ _id: { $in: doors.map((d) => d._id) } }),
  ]);
});

// ── an unknock's list row while its Undo runs (C-M1) ─────────────────────────────────────────────

test('C-M1: an unknock being undone reads Undoing… (its row counts what it set out to remove), and reads Undone once it lands', { skip }, async () => {
  const d = 33;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  const struck = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const before = await listedUnknock(struck.json.run.id);
  assert.strictEqual(before.frozenRows, 1);
  assert.strictEqual(before.undoing, false);
  const inside = deferred();
  const release = deferred();
  let held = false;
  hookAll(SurveyResponseArchive.collection, 'updateMany', async (real, args) => {
    if (isClaim(args) && !held) {
      held = true;
      inside.resolve();
      await release.p;
    }
    return real(...args);
  });
  const undo = call('POST', unknocks('/revert'), asAdmin({ runId: struck.json.run.id }));
  await inside.p;
  let during;
  try {
    during = await listedUnknock(struck.json.run.id);
  } finally {
    release.resolve();
  }
  assert.strictEqual(during.undoing, true);
  assert.strictEqual(during.removing, false);
  assert.strictEqual((await undo).status, 200);
  const after = await listedUnknock(struck.json.run.id);
  assert.strictEqual(after.undoing, false);
  assert.strictEqual(after.status, 'reverted');
});

// ── an unknock's Undo beside a later unknock (G-M2) ─────────────────────────────────────────────

test('G-M2: the Undo of an unknock that stopped part-way leaves alone what a later unknock removed since', { skip }, async () => {
  const d = 15;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const e = await visitEntry(d, ctx.cara._id);
  // U1 takes the answers and stops before the entries.
  hookOnce(CanvassActivity.collection, 'deleteMany', async () => {
    throw new Error('dyno restarted');
  });
  assert.strictEqual((await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }))).status, 500);
  const u1 = await UnknockRun.findOne({ campaignId: ctx.campaign._id }).sort({ createdAt: -1 }).lean();
  // The admin unknocks the entry again: U2 removes it.
  const u2 = await call('POST', unknocks(), asAdmin({ scope: { userId: String(ctx.cara._id) }, actionIds: [String(e._id)] }));
  assert.strictEqual(u2.status, 201, JSON.stringify(u2.json));
  assert.strictEqual(await visitEntry(d, ctx.cara._id), null);
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(u1._id) }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.strictEqual(undone.json.run.counts.rowsNotRestored, 1);
  assert.strictEqual(undone.json.run.counts.responsesNotRestored, 1);
  assert.strictEqual(await visitEntry(d, ctx.cara._id), null, 'U2\'s removal stands — the fake knock is not billed again');
  assert.strictEqual(await liveOf(v), null);
  const u2now = await UnknockRun.findById(u2.json.run.id).lean();
  assert.strictEqual(u2now.status, 'completed');
  assert.strictEqual(u2now.revertedAt, null);
  assert.strictEqual((await Household.findById(ctx.homes[d]._id).lean()).status, 'unknocked');
});

// ── the one-time console step (G-M1, G-M2, G-m3) ───────────────────────────────────────────────

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
// An unknock as the first build left one that died in its strike: pending, no mark, no beat, its
// chunk and its copies of the answers written — and, with `answersDeleted`, the answers' delete too.
const firstBuildUnknock = async (doors, { answersDeleted = false } = {}) => {
  const entries = [];
  for (const d of doors) entries.push(await visitEntry(d, ctx.cara._id));
  const surveys = await SurveyResponse.collection.find({ householdId: { $in: doors.map((d) => ctx.homes[d]._id) } }).toArray();
  const t1 = new Date(Date.now() - 2 * 3600_000);
  const runId = new mongoose.Types.ObjectId();
  await UnknockRun.collection.insertOne({
    _id: runId, organizationId: ctx.org._id, campaignId: ctx.campaign._id, byUserId: ctx.admin._id, status: 'pending', frozenRows: entries.length,
    selection: { scope: {}, byIds: true }, scopeSummary: null, counts: { entriesRemoved: entries.length, doorsAffected: entries.length },
    revertedAt: null, createdAt: t1, updatedAt: t1, __v: 0,
  });
  await UnknockRunChunk.collection.insertOne({
    runId, campaignId: ctx.campaign._id, organizationId: ctx.org._id, seq: 0, rows: entries,
    visitKeys: [...new Set(entries.map((x) => doorKey(x)))], frozenAt: t1, createdAt: t1, updatedAt: t1,
  });
  const at1 = new Date(t1.getTime() + 1000);
  await SurveyResponseArchive.collection.insertMany(
    surveys.map(({ _id, __v, createdAt, updatedAt, ...snap }) => ({
      ...snap, overwrittenBy: ctx.admin._id, overwrittenVia: 'unknock', overwrittenAt: at1, conversionRunId: null, unknockRunId: runId, createdAt: at1, updatedAt: at1,
    }))
  );
  if (answersDeleted) await SurveyResponse.collection.deleteMany({ _id: { $in: surveys.map((s) => s._id) } });
  return { runId, entries, at1 };
};

test('G-M1: the console step keeps a door-by-door session\'s visits to their own moments — a copy of a real later survey stays restorable', { skip }, async () => {
  const [d1, d2] = [13, 14];
  for (const d of [d1, d2]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const e1 = await visitEntry(d1, ctx.cara._id);
  const e2 = await visitEntry(d2, ctx.cara._id);
  // A session converts door 13...
  const opened = await call('POST', conv(), asAdmin({ direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(e1._id), String(e2._id)] }));
  const runId = opened.json.run.id;
  assert.strictEqual((await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(e1._id) }))).status, 200);
  await pause(60);
  // ...Cara really surveys it later, and an answer edit takes Volunteer out of that real survey...
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d1], d1, FAKE(), { note: 'real visit' })).status, 201);
  await pause(60);
  const real = await visitEntry(d1, ctx.cara._id);
  const { created } = await reviewAndCreate({ scope: scopeFor(ctx.cara._id), actionIds: [String(real._id)], plan: TAKE_OUT });
  assert.strictEqual(created.status, 503, JSON.stringify(created.json));
  assert.deepStrictEqual(await runApply(created.json.run.id), { completed: true });
  const [editCopy] = await copiesOf(ctx.voters[d1], 'answer_edit');
  await pause(60);
  // ...and the session closes; the first build kept no strike records.
  assert.strictEqual((await call('POST', conv(`/${runId}/close`), asAdmin())).status, 200);
  await ConversionStrike.deleteMany({ runId });
  const stateOf = async () => (await restoreStates([await SurveyResponseArchive.collection.findOne({ _id: editCopy._id })])).get(String(editCopy._id));
  const before = await stateOf();
  assert.strictEqual(before.restorable, true);
  await backfill(true);
  assert.deepStrictEqual(await stateOf(), before, 'the session\'s Close is not that visit\'s moment');
});

test('G-M2, G-m3: the console step marks no first-build unknock whose removals a later unknock made, nor one that removed nothing', { skip }, async () => {
  const [a1, a2, b1, b2] = [16, 17, 19, 20];
  for (const d of [a1, a2, b1, b2]) assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  // U1 copied the answers and died before deleting anything; the admin then unknocked the same
  // entries again (U2), which removed them.
  const restruck = await firstBuildUnknock([a1, a2]);
  const u2 = await call('POST', unknocks(), asAdmin({ actionIds: restruck.entries.map((x) => String(x._id)) }));
  assert.strictEqual(u2.status, 201, JSON.stringify(u2.json));
  // Another copied the answers and died before deleting anything; nothing since.
  const plain = await firstBuildUnknock([b1, b2]);
  await backfill(true);
  for (const { runId } of [restruck, plain]) {
    assert.strictEqual((await UnknockRun.findById(runId).lean()).deletingAt ?? null, null, 'not marked stopped part-way');
    assert.strictEqual((await listedUnknock(runId)).stoppedPartWay, false);
    assert.notStrictEqual((await call('POST', unknocks('/revert'), asAdmin({ runId: String(runId) }))).status, 200, 'no Undo offered');
  }
  assert.strictEqual(await CanvassActivity.countDocuments({ householdId: { $in: [a1, a2].map((d) => ctx.homes[d]._id) } }), 0, 'U2\'s removals stand');
  assert.strictEqual((await UnknockRun.findById(u2.json.run.id).lean()).status, 'completed');
  for (const d of [b1, b2]) assert.deepStrictEqual(await signOf(ctx.voters[d]), ['yard_sign_delivered', 'volunteer_request'], 'nothing was removed there');
});

test('G-m3: a first-build unknock that died between deleting the answers and deleting the entries is marked — and listed in History — so its Undo puts them back', { skip }, async () => {
  const d = 21;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, at1 } = await firstBuildUnknock([d], { answersDeleted: true });
  assert.match(await backfill(false), /Unknocks that stopped part-way before the stamp existed: 1 of \d+ unfinished — would mark/);
  await backfill(true);
  assert.strictEqual((await UnknockRun.findById(runId).lean()).deletingAt.getTime(), at1.getTime());
  const logged = await CampaignChange.findById(unknockHistoryRowId(runId, 'strike')).lean();
  assert.strictEqual(logged.toValue, 'unknocked');
  assert.strictEqual(logged.createdAt.getTime(), at1.getTime(), 'listed at the moment it began removing');
  await backfill(true);
  assert.strictEqual(await CampaignChange.countDocuments({ _id: unknockHistoryRowId(runId, 'strike') }), 1, 'once, however often the step runs');
  assert.strictEqual((await listedUnknock(runId)).stoppedPartWay, true);
  const undone = await call('POST', unknocks('/revert'), asAdmin({ runId: String(runId) }));
  assert.strictEqual(undone.status, 200, JSON.stringify(undone.json));
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request']);
  assert.ok(await CampaignChange.exists({ _id: unknockHistoryRowId(runId, 'undo') }));
});

// ── an answer edit's undo (W-M1, W-m2, W-m3, W-m4, W-m5) ───────────────────────────────────────

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

test('W-M1: a first-build undo that died inside its first pass and is handed to this build as the same job counts its put-backs', { skip }, async () => {
  const v = ctx.voters;
  const doors = [23, 24, 25];
  for (const i of doors) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await createTakeOutFor(doors);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  await firstBuildPutBack(v[23], true);
  await firstBuildPutBack(v[24], false);
  // As the first build's claim left it: running, no start ($min over null), no lastRunAt, no pass.
  await AnswerEditRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    { $set: { 'undo.status': 'running', 'undo.jobId': 'old-build-job', 'undo.startedAt': null, 'undo.passes': 0, 'undo.requestedAt': new Date() }, $unset: { 'undo.lastRunAt': '' } }
  );
  const since = new Date();
  const out = await undoJob(runId, 'old-build-job');
  assert.strictEqual(out.summary.putBack, 3);
  assert.strictEqual(out.summary.restoredOnProfile, 0);
  assert.strictEqual((await AnswerEditRun.findById(runId).lean()).undo.legacy, true);
  assert.deepStrictEqual((await historySince('answerEditUndo', since)).map((r) => r.toValue), ['3 surveys put back']);
  for (const i of doors) assert.deepStrictEqual(await signOf(v[i]), ['yard_sign_delivered', 'volunteer_request']);
  assert.strictEqual(await SurveyResponseArchive.countDocuments({ answerEditRunId: runId }), 0);
});

// A whole first-build pass put two of these doors back and logged them; its Undo again then died right
// after putting the third back (`keepCopy`: before deleting that one's copy).
const firstBuildPassThenDeadPass = async (doors, { keepCopy }) => {
  const v = ctx.voters;
  for (const i of doors) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await createTakeOutFor(doors);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  await firstBuildPutBack(v[doors[0]], true);
  await firstBuildPutBack(v[doors[1]], true);
  await AnswerEditRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    {
      $set: {
        'undo.status': 'done', 'undo.jobId': 'old-build-1', 'undo.passes': 1, 'undo.lastRunAt': new Date(Date.now() - 1800_000),
        'undo.summary': { putBack: 2, changedSince: 0, restoredOnProfile: 0, waiting: 1, cleared: 0, erased: 0, gone: 0, names: [] },
      },
    }
  );
  await firstBuildPutBack(v[doors[2]], !keepCopy);
  await AnswerEditRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    { $set: { 'undo.status': 'failed', 'undo.jobId': 'old-build-2', 'undo.error': 'worker restarted' } }
  );
  return runId;
};

test('W-M1: a put-back the first build\'s dying pass made after a whole pass is logged — copy deleted or not', { skip }, async () => {
  for (const [doors, keepCopy] of [[[36, 37, 38], false], [[39, 59, 64], true]]) {
    const runId = await firstBuildPassThenDeadPass(doors, { keepCopy });
    const since = new Date();
    const pressed = await undoPressed(runId);
    assert.strictEqual(pressed.status, 202, JSON.stringify(pressed.json));
    const out = await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
    assert.strictEqual(out.summary.putBack, 3);
    assert.deepStrictEqual((await historySince('answerEditUndo', since)).map((r) => r.toValue), ['1 survey put back'], `the one the dead pass never logged (copy ${keepCopy ? 'kept' : 'deleted'})`);
  }
});

test('W-M1: after two whole first-build passes, a put-back its dying third pass left its copy beside is logged', { skip }, async () => {
  const v = ctx.voters;
  const doors = [26, 27, 28];
  for (const i of doors) assert.strictEqual((await survey(ctx.caraTok, v[i], i, FAKE())).status, 201);
  const runId = await createTakeOutFor(doors);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  // Two whole first-build passes put doors 26 and 27 back, one each, and logged them (its stored
  // summary is the last pass's)...
  await firstBuildPutBack(v[26], true);
  await firstBuildPutBack(v[27], true);
  await AnswerEditRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    {
      $set: {
        'undo.status': 'done', 'undo.jobId': 'old-build-2', 'undo.passes': 2, 'undo.lastRunAt': new Date(Date.now() - 1800_000),
        'undo.summary': { putBack: 1, changedSince: 0, restoredOnProfile: 0, waiting: 1, cleared: 0, erased: 0, gone: 0, names: [] },
      },
    }
  );
  // ...and its third died right after putting door 28 back, the copy still on file.
  await firstBuildPutBack(v[28], false);
  await AnswerEditRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    { $set: { 'undo.status': 'failed', 'undo.jobId': 'old-build-3', 'undo.error': 'worker restarted' } }
  );
  const since = new Date();
  const pressed = await undoPressed(runId);
  assert.strictEqual(pressed.status, 202, JSON.stringify(pressed.json));
  const out = await undoJob(runId, (await AnswerEditRun.findById(runId).lean()).undo.jobId);
  assert.strictEqual(out.summary.putBack, 3);
  assert.deepStrictEqual((await historySince('answerEditUndo', since)).map((r) => r.toValue), ['1 survey put back'], 'the one the dead pass never logged');
});

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

test('W-m2: a survey saved twice whose original\'s copy was erased reads erased after Undo — never put back', { skip }, async () => {
  const d = 29;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE())).status, 201);
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow()]);
  assert.strictEqual((await call('POST', edits(`/${runId}/close`), asAdmin())).status, 200);
  const copies = (await SurveyResponseArchive.collection.find({ answerEditRunId: new mongoose.Types.ObjectId(runId) }).toArray()).sort((a, b) => a.overwrittenAt - b.overwrittenAt);
  assert.strictEqual(copies.length, 2);
  assert.strictEqual((await eraseCopy(v, copies[0]._id)).status, 200, 'the copy holding the original');
  const out = await runUndo(runId);
  assert.strictEqual(out.summary.erased, 1);
  assert.strictEqual(out.summary.putBack, 0);
  assert.deepStrictEqual((await AnswerEditRun.findById(runId).lean()).undo.summary.names.map((n) => n.reason), ['erased']);
  const again = await runUndo(runId);
  assert.strictEqual(again.summary.erased, 1, 'and on Undo again');
  assert.strictEqual(again.summary.putBack, 0);
});

test('W-m3: a survey with no note, edited before notes had their own stamp, reads no note edit after an answer edit and its Undo', { skip }, async () => {
  const d = 30;
  const v = ctx.voters[d];
  assert.strictEqual((await survey(ctx.caraTok, v, d, FAKE(), { note: null })).status, 201);
  await SurveyResponse.collection.updateOne(
    { voterId: v._id },
    { $set: { editedBy: ctx.bea._id, editedAt: new Date(Date.now() - 7 * 86400_000) }, $unset: { noteEditedBy: '', noteEditedAt: '' } }
  );
  const before = (await profileOf(v)).json.surveys[0];
  const runId = await createTakeOutFor([d]);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  await runUndo(runId);
  const after = (await profileOf(v)).json.surveys[0];
  assert.deepStrictEqual(after.noteEdited ?? null, before.noteEdited ?? null, 'no phantom Note edited');
  assert.deepStrictEqual(after.edited, before.edited);
  assert.deepStrictEqual(await signOf(v), ['yard_sign_delivered', 'volunteer_request']);
});

test('W-m4: an Undo a re-cut outlasted says to press Retry undo — never Pick up, which refuses it', { skip }, async () => {
  const d = 31;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const runId = await createTakeOutFor([d]);
  assert.deepStrictEqual(await runApply(runId), { completed: true });
  await Pass.updateOne({ _id: ctx.pass._id }, { $set: { recutLock: { lockedAt: new Date(), lockedBy: null, token: 'turf-job-r5' } } });
  try {
    const jobId = await armUndo(runId, ctx.bea._id);
    let err = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      err = await processAnswerEditJob({ id: jobId, name: 'undo', data: { runId: String(runId) }, opts: { attempts: 3 }, attemptsMade: attempt - 1 }).then(() => null, (e) => e);
    }
    await reconcileFailedAnswerEditJob({ id: jobId, name: 'undo', data: { runId: String(runId) }, opts: { attempts: 3 }, attemptsMade: 3 }, err);
    const card = (await call('GET', edits(`/${runId}`), asAdmin())).json.run;
    assert.strictEqual(card.undo.status, 'failed');
    assert.match(card.undo.error, /Retry undo/);
    assert.doesNotMatch(card.undo.error, /Pick up/);
  } finally {
    await Pass.updateOne({ _id: ctx.pass._id }, { $set: { recutLock: { lockedAt: null, lockedBy: null, token: null } } });
  }
});

test('W-m5: a survey saved twice in a one-person session counts as one survey changed — card, History and undo agree', { skip }, async () => {
  const d = 32;
  assert.strictEqual((await survey(ctx.caraTok, ctx.voters[d], d, FAKE())).status, 201);
  const since = new Date();
  const { runId, current } = await openSession(d);
  await step(runId, current.responseId, [supportRow(), signRow('yard_sign_delivered')]);
  await step(runId, current.responseId, [supportRow(), signRow()]);
  const closed = await call('POST', edits(`/${runId}/close`), asAdmin());
  assert.strictEqual(closed.status, 200, JSON.stringify(closed.json));
  assert.strictEqual(closed.json.run.counts.surveysChanged, 1);
  const [row] = await historySince('answerEdit', since);
  assert.match(row.toValue, /\(1 survey\)/);
  assert.doesNotMatch(row.toValue, /2 surveys/);
  const out = await runUndo(runId);
  assert.strictEqual(out.summary.putBack, 1);
});

// ── reviews pressed side by side, and what a review leaves running (P-M1, P-m2, P-m4) ──────────

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

test('P-M1: a different review runs at once — it never waits inside its own budget behind one still working', { skip }, async () => {
  const ids = await ottoSurveys('Gate Survey', GATE_QUESTIONS, [[40, [gateRow('yes'), followRow('mail')]], [41, [gateRow('maybe'), followRow('early')]]]);
  const a = reviewBody('Gate Survey', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
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
  let aDone = false;
  const first = call('POST', edits(), asAdmin(a)).then((r) => { aDone = true; return r; });
  await inside.p;
  let second;
  let aDoneThen;
  try {
    second = await Promise.race([call('POST', edits(), asBea(b)), pause(5000).then(() => 'waited')]);
    aDoneThen = aDone;
  } finally {
    release.resolve();
  }
  assert.notStrictEqual(second, 'waited', 'the other review answered while the first still worked');
  assert.strictEqual(second.status, 200, JSON.stringify(second.json));
  assert.strictEqual(aDoneThen, false);
  assert.strictEqual((await first).status, 200);
});

test('P-M1: the same selection ticked in another order is the same review — worked out once, one digest', { skip }, async () => {
  const ids = await ottoSurveys('Gate Survey', GATE_QUESTIONS, [[42, [gateRow('yes'), followRow('mail')]], [43, [gateRow('yes'), followRow('day')]]]);
  const body = reviewBody('Gate Survey', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }]);
  let scans = 0;
  const client = mongoose.connection.getClient();
  const listen = (ev) => {
    if (ev.command.find === 'surveyresponses' && ev.command.projection?.editedBy === 1) scans += 1;
  };
  client.on('commandStarted', listen);
  let x;
  let y;
  try {
    [x, y] = await Promise.all([call('POST', edits(), asAdmin(body)), call('POST', edits(), asBea({ ...body, actionIds: [...ids].reverse() }))]);
  } finally {
    client.off('commandStarted', listen);
  }
  assert.deepStrictEqual([x.status, y.status], [200, 200]);
  assert.strictEqual(scans, 1);
  assert.strictEqual(x.json.digest, y.json.digest);
});

test('P-m2: once a review has answered, its tag counts stop — none starts after the answer', { skip }, async () => {
  const rows = Array.from({ length: 9 }, (_, i) => [44 + i, [{ questionKey: 'pick', questionLabel: 'Pick one', answer: `Tag ${i}`, optionIds: [`t${i}`] }]]);
  const ids = await ottoSurveys('Many Tags', MANY_QUESTIONS, rows);
  const launches = [];
  hookProto(mongoose.Aggregate.prototype, 'exec', function (real, args) {
    if (!isIdentifiedCount(this)) return real(...args);
    launches.push(Date.now());
    return pause(300).then(() => real(...args));
  });
  const r = await withEnv({ ANSWER_EDIT_TAG_BUDGET_MS: '450' }, () => call('POST', edits(), asAdmin(reviewBody('Many Tags', ids, [{ questionKey: 'pick', op: 'set', optionIds: ['t9'] }]))));
  const answeredAt = Date.now();
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.price.tagsUnavailable, true, 'ten counts at 300 ms, two at a time, can\'t finish in 450 ms');
  await pause(1500);
  assert.ok(launches.length >= 2, `the counts ran (${launches.length})`);
  assert.deepStrictEqual(launches.filter((t) => t > answeredAt), [], 'no count started after the answer');
});

test('P-m2: the current-tag read stops at its deadline, and rows an abort cut short are never counted', { skip }, async () => {
  const template = { questions: MANY_QUESTIONS };
  const match = { campaignId: ctx.campaign._id };
  // Already past it: no read at all.
  let sent = 0;
  const client = mongoose.connection.getClient();
  const listen = (ev) => {
    if (ev.command.aggregate === 'surveyresponses') sent += 1;
  };
  client.on('commandStarted', listen);
  try {
    await assert.rejects(currentVoterSetsByTag(match, template, null, { deadline: Date.now() - 1 }), { code: 'DEADLINE' });
    await pause(50);
  } finally {
    client.off('commandStarted', listen);
  }
  assert.strictEqual(sent, 0, 'nothing sent to the database');
  // Aborted mid-read, the driver either ends the read early with what it had or fails: DEADLINE either way.
  for (const outcome of ['partial', 'error']) {
    const real = SurveyResponse.collection.aggregate;
    SurveyResponse.collection.aggregate = (pipeline, options) => {
      SurveyResponse.collection.aggregate = real;
      return {
        toArray: () =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => (outcome === 'partial' ? resolve([]) : reject(new Error('operation was interrupted'))));
          }),
      };
    };
    pending.push(() => { SurveyResponse.collection.aggregate = real; });
    await assert.rejects(currentVoterSetsByTag(match, template, null, { deadline: Date.now() + 50 }), { code: 'DEADLINE' }, outcome);
  }
  // Inside its deadline it reads whole.
  const sets = await currentVoterSetsByTag(match, template, null, { deadline: Date.now() + 10_000 });
  assert.ok(sets instanceof Map);
});

test('P-m4: the counts of tags a review finds while it scans share one limit with those it started up front', { skip }, async () => {
  const ids = await ottoSurveys('Gate Survey', GATE_QUESTIONS, [[53, [gateRow('yes'), followRow('mail', 'early')]], [54, [gateRow('maybe'), followRow('day', 'unsure')]]]);
  let inFlight = 0;
  let most = 0;
  hookProto(mongoose.Aggregate.prototype, 'exec', function (real, args) {
    if (!isIdentifiedCount(this)) return real(...args);
    inFlight += 1;
    most = Math.max(most, inFlight);
    return pause(150)
      .then(() => real(...args))
      .finally(() => { inFlight -= 1; });
  });
  const r = await call('POST', edits(), asAdmin(reviewBody('Gate Survey', ids, [{ questionKey: 'gate', op: 'set', optionIds: ['no'] }])));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.price.tagsUnavailable, false);
  assert.ok(r.json.price.tags.some((t) => t.tag === 'Votes mail'), 'a dropped follow-up\'s tag was priced');
  assert.ok(most <= 2, `at most two at once (${most})`);
});
