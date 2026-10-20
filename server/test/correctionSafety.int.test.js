import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Six data-safety fixes found while planning survey answer edits (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md
// §P), each pinned against the REAL app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/correction_safety_test node --test test/correctionSafety.int.test.js
//
//   F1  an UNKNOCKED survey's archived answers never read as a same-round overwrite: not on Duplicate
//       Surveys, not as "Replaced X's earlier answers" on the profile or the response detail.
//   F5  Restore refuses to give a visit that no longer reads Surveyed a survey back — the swap and
//       the resurrect alike — and the profile says why up front; the designed restores still work.
//   F7  a failed UNDO of a conversion parks as revert_failed: it can be retried, never "picked up",
//       because picking it up re-applied the conversion.
//   F9  an archive copy is never silently skipped: the old insertMany(ordered:false) dropped a
//       snapshot that failed validation and the caller then deleted the original.
//   F2  a re-survey clears the desk-entry stamp (and archives the desk answers), so undoing that desk
//       entry can no longer delete a canvasser's real field answers; syncedAt follows the re-submit.
//   F4  a re-sent offline survey with the SAME timestamp is the same submission already delivered —
//       it must not silently revert an admin's edit.
//
// Redis points at a dead port so nothing here can reach a worker; the conversions use the inline
// door-by-door path and the small-run inline revert, which is what a real 1–3 door correction takes.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-correction-safety';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
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
const { UnknockRun } = await import('../src/models/UnknockRun.js');
const { UnknockRunChunk } = await import('../src/models/UnknockRunChunk.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { archiveOverwrittenResponses } = await import('../src/services/surveys/archiveOverwrite.js');
const { reconcileFailedConversionJob } = await import('../src/services/canvass/conversionProcessor.js');
const { executeConversionRun } = await import('../src/services/canvass/surveyConversion.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const DOORS = 16;

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment,
    Household, Voter, CanvassActivity, SurveyResponse, SurveyResponseArchive, SurveyTemplate,
    SurveyConversionRun, UnknockRun, UnknockRunChunk, Subscription,
  ]) {
    await M.deleteMany({});
  }
  await SurveyResponse.init();
  await SurveyResponseArchive.init();

  const org = await Organization.create({ name: 'Safety Org', slug: 'safety-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'sa@t.co', passwordHash: 'x', isActive: true });
  const cara = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'sc@t.co', passwordHash: 'x', isActive: true });
  const otto = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'so@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  for (const u of [cara, otto]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  }
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Safety Survey', version: 1, isActive: true,
    questions: [
      { key: 'q1', label: 'Support?', type: 'single_choice', order: 0, options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }] },
    ],
  });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Safety C', type: 'survey', state: 'FL', isActive: true,
    timeZone: 'America/New_York', surveyTemplateId: template._id,
  });
  for (const u of [cara, otto]) {
    await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: u._id });
  }
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1,
    name: 'Round 1', status: 'active',
  });
  const homes = await Household.insertMany(
    Array.from({ length: DOORS }, (_, i) => ({
      organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
      addressLine1: `${i + 1} Safe St`, city: 'Town', state: 'FL', zipCode: '33540',
      normalizedAddress: `SAFE${i + 1}`, location: { type: 'Point', coordinates: [-82.1 + i * 0.001, 28.2] },
      isActive: true, status: 'unknocked',
    }))
  );
  const turf = await Turf.create({
    organizationId: org._id, campaignId: campaign._id, passId: pass._id, name: 'Book Safe',
    mode: 'manual', status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  for (const u of [cara, otto]) {
    await TurfAssignment.create({ organizationId: org._id, campaignId: campaign._id, passId: pass._id, turfId: turf._id, userId: u._id });
  }
  const voters = await Voter.insertMany(
    homes.map((h, i) => ({
      organizationId: org._id, campaignId: campaign._id, householdId: h._id,
      stateVoterId: `SAFE-${i + 1}`, firstName: 'V', lastName: `${i + 1}`, fullName: `Voter ${i + 1}`,
    }))
  );
  // A second voter at the last door: surveying one voter replaces the visit's entry with a newer one.
  const housemate = await Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: homes[DOORS - 1]._id,
    stateVoterId: 'SAFE-MATE', firstName: 'M', lastName: 'Mate', fullName: 'Mate Voter',
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

const near = (i) => ({ lat: 28.2 + 0.00001, lng: -82.1 + i * 0.001 + 0.00001, accuracy: 6 });
let minute = 0;
const nextTs = () => {
  minute += 1;
  return new Date(Date.now() - 6 * 3600_000 + minute * 60_000).toISOString();
};

const yes = [{ questionKey: 'q1', questionLabel: 'Support?', optionIds: ['o1'], answer: 'Yes' }];
const no = [{ questionKey: 'q1', questionLabel: 'Support?', optionIds: ['o2'], answer: 'No' }];

const survey = (token, i, answers, extra = {}) =>
  call('POST', `/mobile/voters/${ctx.voters[i]._id}/survey`, {
    token,
    body: {
      surveyTemplateId: String(ctx.template._id),
      answers,
      location: near(i),
      timestamp: nextTs(),
      ...extra,
    },
  });
const notHome = (token, i) =>
  call('POST', `/mobile/households/${ctx.homes[i]._id}/not-home`, {
    token,
    body: { location: near(i), timestamp: nextTs() },
  });

const entryOf = (i, userId) =>
  CanvassActivity.findOne({ householdId: ctx.homes[i]._id, userId, actionType: { $ne: 'note_added' } }).lean();
const liveOf = (i) => SurveyResponse.findOne({ voterId: ctx.voters[i]._id }).lean();
const conv = (suffix = '') => `/admin/campaigns/${ctx.campaign._id}/survey-conversions${suffix}`;

// ── F1 + F5: struck (unknocked) surveys ─────────────────────────────────────────────────────────

test('F1. an unknocked survey never reads as a same-round overwrite', { skip }, async () => {
  // Cara's fake survey of voter 0, struck from the record; then Otto genuinely surveys voter 0.
  assert.strictEqual((await survey(ctx.caraTok, 0, yes)).status, 201);
  const caraEntry = await entryOf(0, ctx.cara._id);
  const struck = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries`, asAdmin({
    scope: { userId: String(ctx.cara._id) }, actionIds: [String(caraEntry._id)],
  }));
  assert.strictEqual(struck.status, 201, `unknock ran: ${JSON.stringify(struck.json)}`);
  ctx.unknockRunId = struck.json.run.id;
  const archived = await SurveyResponseArchive.findOne({ voterId: ctx.voters[0]._id, overwrittenVia: 'unknock' }).lean();
  assert.ok(archived, 'the struck answers were archived');
  ctx.struckArchiveId = String(archived._id);

  assert.strictEqual((await survey(ctx.ottoTok, 0, no)).status, 201);
  const live = await liveOf(0);
  assert.strictEqual(String(live.userId), String(ctx.otto._id));

  const dupes = await call('GET', `/admin/reports/duplicate-surveys?campaignId=${ctx.campaign._id}`, asAdmin());
  assert.strictEqual(dupes.status, 200);
  const listed = (dupes.json.duplicates || []).find((d) => String(d.voter?.id || d.voterId || d._id) === String(ctx.voters[0]._id));
  assert.ok(!listed, 'the voter is not on Duplicate Surveys');

  const profile = await call('GET', `/admin/voters/${ctx.voters[0]._id}`, asAdmin());
  assert.strictEqual(profile.status, 200);
  assert.strictEqual(profile.json.surveys[0].replacedEarlier, null, 'the live survey does not claim it replaced anyone');
  const detail = await call('GET', `/admin/reports/responses/${live._id}?campaignId=${ctx.campaign._id}`, asAdmin());
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.json.response.replacedEarlier, null, 'nor does the response detail');
});

test('F5. Restore refuses to put struck answers back over a real survey, and says so up front', { skip }, async () => {
  const profile = await call('GET', `/admin/voters/${ctx.voters[0]._id}`, asAdmin());
  const card = profile.json.overwrittenSurveys.find((o) => o.id === ctx.struckArchiveId);
  assert.ok(card, 'the struck answers stay on the record as history');
  assert.strictEqual(card.restorable, false, 'not restorable');
  assert.strictEqual(card.restoreBlockedReason, 'unknocked');

  const r = await call('POST', `/admin/voters/${ctx.voters[0]._id}/surveys/${ctx.struckArchiveId}/restore`, asAdmin());
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'RESTORE_VISIT_NOT_SURVEYED');
  const live = await liveOf(0);
  assert.strictEqual(String(live.userId), String(ctx.otto._id), "Otto's real survey is untouched");
  assert.strictEqual(live.answers[0].optionIds[0], 'o2');

  // Once the unknock is undone, Cara's own entry is back (her visit was empty); her answers can't
  // take Otto's slot, so they stay preserved — and are now restorable, as an admin's explicit swap.
  const undo = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries/revert`, asAdmin({
    runId: ctx.unknockRunId,
  }));
  assert.strictEqual(undo.status, 200, JSON.stringify(undo.json));
  assert.strictEqual(undo.json.run.counts.rowsNotRestored, 0, "Cara's entry is back");
  assert.strictEqual(undo.json.run.counts.responsesNotRestored, 1, "Otto's survey keeps the slot");
  const after = await call('GET', `/admin/voters/${ctx.voters[0]._id}`, asAdmin());
  const back = after.json.overwrittenSurveys.find((o) => o.id === ctx.struckArchiveId);
  assert.strictEqual(back.restorable, true, 'the visit these answers came from reads Surveyed again');
  assert.strictEqual(String((await liveOf(0)).userId), String(ctx.otto._id));
});

test('F5. a converted visit (Surveyed → Not home) cannot be given its survey back from the profile either', { skip }, async () => {
  assert.strictEqual((await survey(ctx.caraTok, 1, yes)).status, 201);
  const entry = await entryOf(1, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({
    direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(entry._id)],
  }));
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  const step = await call('POST', conv(`/${opened.json.run.id}/door`), asAdmin({ actionId: String(entry._id) }));
  assert.strictEqual(step.status, 200, JSON.stringify(step.json));
  await call('POST', conv(`/${opened.json.run.id}/close`), asAdmin());
  assert.strictEqual(await liveOf(1), null, 'the answers left the live record');
  const archived = await SurveyResponseArchive.findOne({ voterId: ctx.voters[1]._id, overwrittenVia: 'outcome_convert' }).lean();
  assert.ok(archived);

  const r = await call('POST', `/admin/voters/${ctx.voters[1]._id}/surveys/${archived._id}/restore`, asAdmin());
  assert.strictEqual(r.status, 409, 'no survey resurrected under a Not home entry');
  assert.strictEqual(r.json.code, 'RESTORE_VISIT_NOT_SURVEYED');
  assert.strictEqual(await liveOf(1), null);
  const profile = await call('GET', `/admin/voters/${ctx.voters[1]._id}`, asAdmin());
  const card = profile.json.overwrittenSurveys.find((o) => o.id === String(archived._id));
  assert.strictEqual(card.restorable, false);
  assert.strictEqual(card.restoreBlockedReason, 'converted');
});

test('F5. the designed restores still work: a teammate overwrite, and delete-then-restore', { skip }, async () => {
  // Cara surveys voter 2, Otto overwrites in the same round: Cara's visit still reads Surveyed.
  assert.strictEqual((await survey(ctx.caraTok, 2, yes)).status, 201);
  assert.strictEqual((await survey(ctx.ottoTok, 2, no)).status, 201);
  const caraCopy = await SurveyResponseArchive.findOne({ voterId: ctx.voters[2]._id, overwrittenVia: 'submit' }).lean();
  const profile = await call('GET', `/admin/voters/${ctx.voters[2]._id}`, asAdmin());
  assert.strictEqual(profile.json.overwrittenSurveys.find((o) => o.id === String(caraCopy._id)).restorable, true);
  const swap = await call('POST', `/admin/voters/${ctx.voters[2]._id}/surveys/${caraCopy._id}/restore`, asAdmin());
  assert.strictEqual(swap.status, 200, JSON.stringify(swap.json));
  assert.strictEqual(String((await liveOf(2)).userId), String(ctx.cara._id), "Cara's answers are current again");

  // Delete the current response, then restore the preserved one into the gap (the void branch).
  const live = await liveOf(2);
  assert.strictEqual((await call('DELETE', `/admin/voters/${ctx.voters[2]._id}/surveys/${live._id}`, asAdmin())).status, 200);
  const ottoCopy = await SurveyResponseArchive.findOne({ voterId: ctx.voters[2]._id, overwrittenVia: 'restore' }).lean();
  const back = await call('POST', `/admin/voters/${ctx.voters[2]._id}/surveys/${ottoCopy._id}/restore`, asAdmin());
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  assert.strictEqual(String((await liveOf(2)).userId), String(ctx.otto._id));
});

test('F5. the same canvasser surveys a struck visit again: the struck answers still cannot replace it', { skip }, async () => {
  assert.strictEqual((await survey(ctx.caraTok, 8, yes)).status, 201);
  const entry = await entryOf(8, ctx.cara._id);
  const struck = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries`, asAdmin({
    scope: { userId: String(ctx.cara._id) }, actionIds: [String(entry._id)],
  }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  const archived = await SurveyResponseArchive.findOne({ voterId: ctx.voters[8]._id, overwrittenVia: 'unknock' }).lean();
  // She comes back and really surveys: a NEW entry at the very same visit (door, round, canvasser).
  assert.strictEqual((await survey(ctx.caraTok, 8, no)).status, 201);

  const profile = await call('GET', `/admin/voters/${ctx.voters[8]._id}`, asAdmin());
  const card = profile.json.overwrittenSurveys.find((o) => o.id === String(archived._id));
  assert.strictEqual(card.restorable, false, 'a visit surveyed again after the strike is not the struck visit');
  assert.strictEqual(card.restoreBlockedReason, 'unknocked');
  const r = await call('POST', `/admin/voters/${ctx.voters[8]._id}/surveys/${archived._id}/restore`, asAdmin());
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await liveOf(8)).answers[0].optionIds[0], 'o2', 'her real survey is untouched');

  // Undoing the unknock agrees: her new visit keeps its entry (the struck one is not put back over
  // it) and the new survey keeps the slot, so the struck answers stay preserved and still can't go back.
  const undo = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries/revert`, asAdmin({
    runId: struck.json.run.id,
  }));
  assert.strictEqual(undo.status, 200, JSON.stringify(undo.json));
  assert.strictEqual(undo.json.run.counts.rowsNotRestored, 1);
  assert.strictEqual(undo.json.run.counts.responsesNotRestored, 1);
  const after = await call('GET', `/admin/voters/${ctx.voters[8]._id}`, asAdmin());
  const kept = after.json.overwrittenSurveys.find((o) => o.id === String(archived._id));
  assert.ok(kept, 'still preserved');
  assert.strictEqual(kept.restorable, false);
  assert.strictEqual((await liveOf(8)).answers[0].optionIds[0], 'o2');
});

test('F5. at a two-voter door, a teammate overwrite stays restorable after the next voter is surveyed', { skip }, async () => {
  const door = DOORS - 1;
  assert.strictEqual((await survey(ctx.caraTok, door, yes)).status, 201);
  // Surveying the housemate replaces Cara's entry for this visit with a newer one.
  const mate = await call('POST', `/mobile/voters/${ctx.housemate._id}/survey`, {
    token: ctx.caraTok,
    body: { surveyTemplateId: String(ctx.template._id), answers: no, location: near(door), timestamp: nextTs() },
  });
  assert.strictEqual(mate.status, 201, JSON.stringify(mate.json));
  assert.strictEqual((await survey(ctx.ottoTok, door, no)).status, 201);
  const caraCopy = await SurveyResponseArchive.findOne({ voterId: ctx.voters[door]._id, overwrittenVia: 'submit' }).lean();
  assert.ok(caraCopy, "Otto's survey preserved Cara's");

  const profile = await call('GET', `/admin/voters/${ctx.voters[door]._id}`, asAdmin());
  assert.strictEqual(profile.json.overwrittenSurveys.find((o) => o.id === String(caraCopy._id)).restorable, true);
  const swap = await call('POST', `/admin/voters/${ctx.voters[door]._id}/surveys/${caraCopy._id}/restore`, asAdmin());
  assert.strictEqual(swap.status, 200, JSON.stringify(swap.json));
  assert.strictEqual(String((await liveOf(door)).userId), String(ctx.cara._id));
});

// ── F7: a failed undo is retried, never picked up ──────────────────────────────────────────────

test('F7. a failed conversion undo parks as revert_failed: retry works, pick-up is refused', { skip }, async () => {
  assert.strictEqual((await notHome(ctx.caraTok, 3)).status, 201);
  const entry = await entryOf(3, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({
    direction: 'to_survey', to: 'survey_submitted', mode: 'queue', actionIds: [String(entry._id)],
  }));
  const runId = opened.json.run.id;
  await call('POST', conv(`/${runId}/door`), asAdmin({
    actionId: String(entry._id), voterPlans: { [String(ctx.voters[3]._id)]: { answers: yes } },
  }));
  await call('POST', conv(`/${runId}/close`), asAdmin());
  assert.ok((await liveOf(3))?.deskEntry, 'desk answers recorded');

  // A revert job that dies on its last attempt, as the worker's failed listener sees it — the run's
  // own job (the listener parks only that one).
  await SurveyConversionRun.updateOne({ _id: runId }, { $set: { status: 'reverting', queueJobId: 'f7-revert-job' } });
  await reconcileFailedConversionJob(
    { id: 'f7-revert-job', name: 'revert', data: { runId }, opts: { attempts: 1 }, attemptsMade: 1, finishedOn: Date.now() },
    new Error('worker died mid-undo')
  );
  const parked = await SurveyConversionRun.findById(runId).lean();
  assert.strictEqual(parked.status, 'revert_failed', 'a failed UNDO is not a failed conversion');

  const pickUp = await call('POST', conv(`/${runId}/resume`), asAdmin());
  assert.strictEqual(pickUp.status, 409, 'picking it up would re-apply the conversion');
  assert.ok((await liveOf(3))?.deskEntry, 'nothing re-applied');

  const retry = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(retry.status, 200, JSON.stringify(retry.json));
  assert.strictEqual((await SurveyConversionRun.findById(runId).lean()).status, 'reverted');
  assert.strictEqual(await liveOf(3), null, 'the retried undo finished');
  assert.strictEqual((await entryOf(3, ctx.cara._id)).actionType, 'not_home');
});

test('F7. a failed FORWARD job still reads failed (Pick up stays the remedy there)', { skip }, async () => {
  const run = await SurveyConversionRun.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, byUserId: ctx.admin._id,
    direction: 'to_survey', mode: 'bulk', to: 'survey_submitted', status: 'running', queueJobId: 'outcome-convert-f7-own',
  });
  // Only the run's own job marks it (round 5): a job a Pick up replaced leaves the one running alone.
  await reconcileFailedConversionJob(
    { id: 'outcome-convert-f7-stale', name: 'convert', data: { runId: String(run._id) }, opts: { attempts: 3 }, attemptsMade: 3, finishedOn: Date.now() },
    new Error('boom')
  );
  assert.strictEqual((await SurveyConversionRun.findById(run._id).lean()).status, 'running');
  await reconcileFailedConversionJob(
    { id: 'outcome-convert-f7-own', name: 'convert', data: { runId: String(run._id) }, opts: { attempts: 3 }, attemptsMade: 3, finishedOn: Date.now() },
    new Error('boom')
  );
  assert.strictEqual((await SurveyConversionRun.findById(run._id).lean()).status, 'failed');
  // A retry still coming is not a failure yet.
  await SurveyConversionRun.updateOne({ _id: run._id }, { $set: { status: 'running' } });
  await reconcileFailedConversionJob(
    { id: 'outcome-convert-f7-own', name: 'convert', data: { runId: String(run._id) }, opts: { attempts: 3 }, attemptsMade: 1 },
    new Error('transient')
  );
  assert.strictEqual((await SurveyConversionRun.findById(run._id).lean()).status, 'running');
  // A run left reading `running` holds the campaign for every other removal (round 6): put it down.
  await SurveyConversionRun.deleteOne({ _id: run._id });
});

// The undo is RE-ENTRANT: wherever an attempt dies, undoing again finishes it and settles every door
// and voter — including the ones the dead attempt already put back. Each test kills one attempt at a
// different point by making one database call throw once, in this process (the app shares it).
const failOnce = (Model, method, message) => {
  Model[method] = () => {
    delete Model[method];
    throw new Error(message);
  };
};
const stateOf = async (i) => ({
  door: (await Household.findById(ctx.homes[i]._id).lean()).status,
  voter: (await Voter.findById(ctx.voters[i]._id).lean()).surveyStatus,
  entry: await entryOf(i, ctx.cara._id),
});

test('F7. an inline undo that dies before the entries flip back parks as revert_failed, and Retry undo settles it', { skip }, async () => {
  const { runId } = await deskEnter(9);
  assert.strictEqual((await stateOf(9)).door, 'surveyed');
  failOnce(CanvassActivity, 'updateMany', 'database dropped mid-undo');
  const dead = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(dead.status, 500);
  assert.strictEqual(dead.json.code, 'REVERT_FAILED');
  assert.strictEqual(dead.json.run.status, 'revert_failed', 'never stuck reading Undoing');
  assert.strictEqual(await liveOf(9), null, 'the attempt got as far as deleting the desk answers');

  const retry = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(retry.status, 200, JSON.stringify(retry.json));
  assert.strictEqual(retry.json.run.status, 'reverted');
  const after = await stateOf(9);
  assert.strictEqual(after.entry.actionType, 'not_home');
  assert.strictEqual(after.entry.reclassified, undefined, 'stamp lifted');
  assert.strictEqual(after.door, 'not_home', 'the door no longer reads Surveyed');
  assert.strictEqual(after.voter, 'not_surveyed', 'nor the voter whose answers the dead attempt deleted');
});

test('F7. an undo that dies after the entries flip back still finds and settles those doors on retry', { skip }, async () => {
  const { runId } = await deskEnter(10);
  failOnce(Voter, 'distinct', 'worker restarted mid-undo');
  const dead = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(dead.status, 500);
  const mid = await stateOf(10);
  assert.strictEqual(mid.entry.actionType, 'not_home', 'flipped back');
  assert.ok(mid.entry.reclassified?.runId, 'but still stamped, so a retry can find it');
  assert.strictEqual(mid.door, 'surveyed', 'not settled yet');

  const retry = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(retry.status, 200, JSON.stringify(retry.json));
  const after = await stateOf(10);
  assert.strictEqual(after.door, 'not_home');
  assert.strictEqual(after.voter, 'not_surveyed');
  assert.strictEqual(after.entry.reclassified, undefined);
});

test('F7. an inline undo that died with its request stops reading Undoing', { skip }, async () => {
  const { runId } = await deskEnter(11);
  // What a dyno restart mid-undo leaves: `reverting`, no job, and nothing that will ever change it.
  await SurveyConversionRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    { $set: { status: 'reverting', updatedAt: new Date(Date.now() - 11 * 60_000) } }
  );
  const polled = await call('GET', conv(`/${runId}`), asAdmin());
  assert.strictEqual(polled.json.run.status, 'revert_failed');
  const listed = await call('GET', conv(), asAdmin());
  assert.strictEqual(listed.json.runs.find((r) => r.id === runId).status, 'revert_failed');
  const retry = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(retry.status, 200, JSON.stringify(retry.json));
  assert.strictEqual((await stateOf(11)).door, 'not_home');
});

test('F7. a large undo that cannot reach the queue stays a stopped undo', { skip }, async () => {
  const { runId } = await deskEnter(12);
  // Large enough to be undone by a job; Redis is down in this suite, so the enqueue times out.
  await SurveyConversionRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    { $set: { status: 'revert_failed', 'counts.entriesConverted': 501 } }
  );
  const r = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(r.status, 503);
  assert.strictEqual((await SurveyConversionRun.findById(runId).lean()).status, 'revert_failed', 'not reset to completed');
  await SurveyConversionRun.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(runId) },
    { $set: { 'counts.entriesConverted': 1 } }
  );
  assert.strictEqual((await call('POST', conv(`/${runId}/revert`), asAdmin())).status, 200);
});

test('F7. a stopped Surveyed → Not home undo does not blame a field answer for its own put-back', { skip }, async () => {
  assert.strictEqual((await survey(ctx.caraTok, 13, yes)).status, 201);
  const entry = await entryOf(13, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({
    direction: 'from_survey', to: 'not_home', mode: 'queue', actionIds: [String(entry._id)],
  }));
  const runId = opened.json.run.id;
  await call('POST', conv(`/${runId}/door`), asAdmin({ actionId: String(entry._id) }));
  await call('POST', conv(`/${runId}/close`), asAdmin());
  const copy = await SurveyResponseArchive.findOne({ conversionRunId: new mongoose.Types.ObjectId(runId) }).lean();
  // The dead attempt put the answers back and died before clearing the archive copy.
  failOnce(SurveyResponseArchive, 'deleteMany', 'worker restarted mid-undo');
  const dead = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(dead.status, 500);
  assert.ok(await liveOf(13), 'answers are back');
  assert.ok(await SurveyResponseArchive.findById(copy._id).lean(), 'and the copy is still there');

  const retry = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(retry.status, 200, JSON.stringify(retry.json));
  assert.strictEqual(retry.json.run.counts.responsesNotRestored, 0, 'its own put-back is not a newer field answer');
  assert.strictEqual(await SurveyResponseArchive.findById(copy._id).lean(), null, 'the copy is cleared');
  assert.strictEqual(await SurveyResponse.countDocuments({ voterId: ctx.voters[13]._id }), 1);
  const after = await stateOf(13);
  assert.strictEqual(after.entry.actionType, 'survey_submitted');
  assert.strictEqual(after.door, 'surveyed');
  assert.strictEqual(after.voter, 'surveyed');
});

test('a resumed conversion settles the doors its dead attempt converted, not only the ones it converts', { skip }, async () => {
  const { runId } = await deskEnter(14);
  // What a job that died before its final settle leaves: the door converted and stamped, its pin and
  // voter never recomputed.
  await Household.collection.updateOne({ _id: ctx.homes[14]._id }, { $set: { status: 'not_home' } });
  await Voter.collection.updateOne({ _id: ctx.voters[14]._id }, { $set: { surveyStatus: 'not_surveyed' } });
  const run = await SurveyConversionRun.findById(runId);
  run.status = 'running';
  await run.save();
  const campaign = await Campaign.findById(ctx.campaign._id).lean();
  await executeConversionRun({ run, campaign });
  const after = await stateOf(14);
  assert.strictEqual(after.door, 'surveyed', 'the resumed pass settled the door the dead attempt converted');
  assert.strictEqual(after.voter, 'surveyed');
});

// ── F9: an archive copy is never silently skipped ──────────────────────────────────────────────

test('F9. the archive keeps a snapshot even when it would fail validation', { skip }, async () => {
  const good = (await SurveyResponse.findOne({}).lean());
  // A legacy-shaped row: an answer with no questionLabel (required today), as old data can hold.
  const legacy = {
    ...good,
    _id: new mongoose.Types.ObjectId(),
    voterId: ctx.voters[7]._id,
    answers: [{ questionKey: 'q1', answer: 'Yes' }],
  };
  const before = await SurveyResponseArchive.countDocuments({});
  await archiveOverwrittenResponses([good, legacy], { byUserId: ctx.admin._id, via: 'outcome_convert' });
  assert.strictEqual(await SurveyResponseArchive.countDocuments({}), before + 2, 'both copies kept');
  const copy = await SurveyResponseArchive.findOne({ voterId: ctx.voters[7]._id }).lean();
  assert.deepStrictEqual(copy.answers, [{ questionKey: 'q1', answer: 'Yes' }], 'kept verbatim');
});

test('F9. unknock of a visit holding a legacy-shaped survey keeps its answers', { skip }, async () => {
  assert.strictEqual((await survey(ctx.caraTok, 6, yes)).status, 201);
  // Make the stored survey legacy-shaped the way old data is: raw, bypassing today's schema.
  await SurveyResponse.collection.updateOne(
    { voterId: ctx.voters[6]._id },
    { $set: { answers: [{ questionKey: 'q1', answer: 'Yes' }] } }
  );
  const entry = await entryOf(6, ctx.cara._id);
  const struck = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries`, asAdmin({
    scope: { userId: String(ctx.cara._id) }, actionIds: [String(entry._id)],
  }));
  assert.strictEqual(struck.status, 201, JSON.stringify(struck.json));
  assert.strictEqual(await liveOf(6), null, 'the survey left the live record');
  const copy = await SurveyResponseArchive.findOne({ voterId: ctx.voters[6]._id, overwrittenVia: 'unknock' }).lean();
  assert.ok(copy, 'its answers were archived, not lost');
  assert.strictEqual(copy.answers[0].answer, 'Yes');

  // ...and the way back takes the same copy: undoing the unknock puts the survey back even though
  // today's schema would refuse its shape (re-validating it failed the undo on every retry).
  const undo = await call('POST', `/admin/campaigns/${ctx.campaign._id}/unknock-entries/revert`, asAdmin({
    runId: struck.json.run.id,
  }));
  assert.strictEqual(undo.status, 200, JSON.stringify(undo.json));
  assert.strictEqual(undo.json.run.counts.responsesNotRestored, 0);
  const back = await liveOf(6);
  assert.ok(back, 'the survey is back on the live record');
  assert.strictEqual(back.answers[0].questionKey, 'q1');
  assert.strictEqual(back.answers[0].answer, 'Yes');
});

// ── F2: a re-survey clears the desk-entry stamp ────────────────────────────────────────────────

const deskEnter = async (i) => {
  assert.strictEqual((await notHome(ctx.caraTok, i)).status, 201);
  const entry = await entryOf(i, ctx.cara._id);
  const opened = await call('POST', conv(), asAdmin({
    direction: 'to_survey', to: 'survey_submitted', mode: 'queue', actionIds: [String(entry._id)],
  }));
  const runId = opened.json.run.id;
  const step = await call('POST', conv(`/${runId}/door`), asAdmin({
    actionId: String(entry._id), voterPlans: { [String(ctx.voters[i]._id)]: { answers: yes } },
  }));
  assert.strictEqual(step.status, 200, JSON.stringify(step.json));
  await call('POST', conv(`/${runId}/close`), asAdmin());
  const desk = await liveOf(i);
  assert.ok(desk?.deskEntry, 'the desk entry exists');
  return { runId, desk };
};

test('F2. the canvasser re-surveys a desk-entered voter: her field answers survive undoing the desk entry', { skip }, async () => {
  const { runId, desk } = await deskEnter(4);
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual((await survey(ctx.caraTok, 4, no)).status, 201);
  const live = await liveOf(4);
  assert.strictEqual(live.deskEntry, undefined, 'her field answers are not labelled desk-entered');
  assert.strictEqual(live.answers[0].optionIds[0], 'o2');
  assert.ok(new Date(live.syncedAt) > new Date(desk.syncedAt), 'syncedAt follows the re-submit');
  const kept = await SurveyResponseArchive.findOne({ voterId: ctx.voters[4]._id, 'deskEntry.runId': new mongoose.Types.ObjectId(runId) }).lean();
  assert.ok(kept, "the admin's typed answers are kept, even though the same canvasser re-surveyed");

  const undo = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(undo.status, 200, JSON.stringify(undo.json));
  const after = await liveOf(4);
  assert.ok(after, 'undoing the desk entry no longer deletes her real answers');
  assert.strictEqual(after.answers[0].optionIds[0], 'o2');
  assert.strictEqual((await Voter.findById(ctx.voters[4]._id).lean()).surveyStatus, 'surveyed');
});

test('F2. a teammate re-surveys a desk-entered voter: his answers survive undoing the desk entry', { skip }, async () => {
  const { runId } = await deskEnter(5);
  assert.strictEqual((await survey(ctx.ottoTok, 5, no)).status, 201);
  const live = await liveOf(5);
  assert.strictEqual(live.deskEntry, undefined);
  assert.strictEqual(String(live.userId), String(ctx.otto._id));

  const undo = await call('POST', conv(`/${runId}/revert`), asAdmin());
  assert.strictEqual(undo.status, 200, JSON.stringify(undo.json));
  const after = await liveOf(5);
  assert.ok(after, "Otto's real survey survives");
  assert.strictEqual(String(after.userId), String(ctx.otto._id));
  assert.strictEqual((await entryOf(5, ctx.cara._id)).actionType, 'not_home', "Cara's entry goes back to what she recorded");
});

// ── F4: a duplicate offline delivery is a no-op ────────────────────────────────────────────────

test('F4. a re-sent offline survey with the same timestamp does not revert an admin edit', { skip }, async () => {
  const ts = nextTs();
  const body = {
    surveyTemplateId: String(ctx.template._id),
    answers: yes,
    location: near(7),
    timestamp: ts,
    wasOfflineSubmission: true,
  };
  const first = await call('POST', `/mobile/voters/${ctx.voters[7]._id}/survey`, { token: ctx.caraTok, body });
  assert.strictEqual(first.status, 201);
  const row = await liveOf(7);
  const edit = await call('PATCH', `/admin/voters/${ctx.voters[7]._id}/surveys/${row._id}`, asAdmin({ answers: no }));
  assert.strictEqual(edit.status, 200);

  // The phone never got the first 200 (a timeout), so its queue sends the very same submission.
  const replay = await call('POST', `/mobile/voters/${ctx.voters[7]._id}/survey`, { token: ctx.caraTok, body });
  assert.strictEqual(replay.status, 200, 'accepted, so the queue drains');
  assert.strictEqual(replay.json?.superseded, true, 'and recognised as already delivered');
  const after = await liveOf(7);
  assert.strictEqual(after.answers[0].optionIds[0], 'o2', "the admin's edit stands");
  assert.strictEqual(String(after.editedBy), String(ctx.admin._id));
});

test('F4. a NEWER offline survey still lands (offline canvassing keeps working)', { skip }, async () => {
  const body = {
    surveyTemplateId: String(ctx.template._id),
    answers: yes,
    location: near(7),
    timestamp: nextTs(),
    wasOfflineSubmission: true,
  };
  const r = await call('POST', `/mobile/voters/${ctx.voters[7]._id}/survey`, { token: ctx.caraTok, body });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await liveOf(7)).answers[0].optionIds[0], 'o1');
});
