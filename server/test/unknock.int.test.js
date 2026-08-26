// UNKNOCK — striking entries from the record (services/canvass/unknock.js).
//
// The central assertion is the money shot BOTH WAYS: the priced preview equals reality once the
// run lands, and a revert restores every counter, rate and billable figure byte-for-byte. That
// pairing is the safety argument for letting a tool DELETE recorded work, so it is asserted
// field-by-field rather than described — the reclassify suite's rule, extended to the one
// operation that can never be rate-neutral.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-unknock';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
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
const { UnknockRun } = await import('../src/models/UnknockRun.js');
const { UnknockRunChunk } = await import('../src/models/UnknockRunChunk.js');
const { ReclassifyRun } = await import('../src/models/ReclassifyRun.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { recomputeCampaignStats } = await import('../src/services/reports/campaignCounters.js');
const { getPassStatusMap } = await import('../src/services/passes/passStatus.js');
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const KNOCK_AT = new Date('2026-07-04T15:00:00Z'); // 10:00 America/Chicago
const GPS = { lat: 30.26, lng: -97.74, accuracy: 7, mocked: false, fixTimestamp: KNOCK_AT };

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, CampaignChange, Effort, Pass, Turf, TurfAssignment, Household, Voter, CanvassActivity, SurveyResponse, SurveyResponseArchive, SurveyTemplate, UnknockRun, UnknockRunChunk, ReclassifyRun, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Unknock Org', slug: 'unknock-org', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ua@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lena', lastName: 'Lead', email: 'ul@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'uc@t.co', passwordHash: 'x', isActive: true });
  const other = await User.create({ firstName: 'Otto', lastName: 'Other', email: 'uo@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  for (const u of [canv, other]) {
    await Membership.create({ userId: u._id, organizationId: org._id, role: 'canvasser', isActive: true });
  }
  await Subscription.create({ organizationId: org._id, status: 'active' });

  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'U Survey', version: 1, isActive: true,
    questions: [{
      key: 'support', label: 'Support?', type: 'single_choice', order: 0,
      options: [{ id: 'yes', text: 'Yes', order: 0 }, { id: 'no', text: 'No', order: 1 }],
    }],
  });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Unknock C', type: 'survey', state: 'TX',
    timeZone: 'America/Chicago', surveyTemplateId: template._id, isActive: true,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: campaign._id, userId: canv._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: campaign._id, name: 'Intake' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: campaign._id, effortId: effort._id, roundNumber: 1, name: 'R1', status: 'active' });

  const door = (n) => ({
    organizationId: org._id, campaignId: campaign._id, effortId: effort._id,
    addressLine1: `${n} Unknock Uz`, city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: `${n} unknock uz austin tx 78701`,
    location: { type: 'Point', coordinates: [-97.74 + n * 0.001, 30.26] },
    status: 'unknocked', isActive: true,
  });
  // d1: Cara surveyed a two-voter door; Otto also honestly visited it.
  // d2: Cara not_home. d3: Cara lit_dropped. d4: desk mark + Cara not_home. d5: Cara refused.
  // d6: Cara not_home plus a note row (notes must survive).
  const doors = await Household.insertMany([1, 2, 3, 4, 5, 6].map(door));
  const [d1, d2, d3, d4, d5, d6] = doors;
  const mkV = (d, n) => ({
    organizationId: org._id, campaignId: campaign._id, householdId: d._id,
    stateVoterId: `U${n}`, firstName: `V${n}`, lastName: 'Probe', fullName: `V${n} Probe`, surveyStatus: 'not_surveyed',
  });
  const [v1a, v1b] = await Voter.insertMany([mkV(d1, 1), mkV(d1, 2)]);

  const turf = await Turf.create({
    organizationId: org._id, campaignId: campaign._id, passId: pass._id, name: 'Book U', mode: 'geometric',
    status: 'published', householdIds: doors.map((h) => h._id), doorCount: doors.length,
  });
  await TurfAssignment.create({ organizationId: org._id, campaignId: campaign._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  const act = (d, userId, actionType, extra = {}) => ({
    organizationId: org._id, campaignId: campaign._id, householdId: d._id, userId,
    actionType, effortId: effort._id, passId: pass._id, turfId: turf._id,
    location: GPS, distanceFromHouseMeters: 9, timestamp: KNOCK_AT, ...extra,
  });
  await CanvassActivity.insertMany([
    act(d1, canv._id, 'survey_submitted', { voterId: v1b._id }),
    act(d1, other._id, 'not_home', { timestamp: new Date(KNOCK_AT.getTime() + 600000) }),
    act(d2, canv._id, 'not_home'),
    act(d3, canv._id, 'lit_dropped'),
    act(d4, canv._id, 'not_home'),
    // The desk mark: an admin's prediction, via 'bulk' — never selectable, and it keeps the
    // door reading `restricted` after Cara's row is struck.
    act(d4, admin._id, 'restricted', { via: 'bulk', distanceFromHouseMeters: 0 }),
    act(d5, canv._id, 'refused'),
    act(d6, canv._id, 'not_home'),
    act(d6, canv._id, 'note_added', { note: 'gate code 1234' }),
  ]);
  const resp = (voter, optionId) => ({
    organizationId: org._id, campaignId: campaign._id, voterId: voter._id, householdId: d1._id,
    userId: canv._id, surveyTemplateId: template._id, surveyTemplateVersion: 1,
    answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: optionId, optionIds: [optionId] }],
    location: GPS, submittedAt: KNOCK_AT, passId: pass._id, effortId: effort._id,
  });
  await SurveyResponse.insertMany([resp(v1a, 'yes'), resp(v1b, 'no')]);
  await Voter.updateMany({ _id: { $in: [v1a._id, v1b._id] } }, { $set: { surveyStatus: 'surveyed' } });

  for (const [d, st] of [[d1, 'surveyed'], [d2, 'not_home'], [d3, 'lit_dropped'], [d4, 'restricted'], [d5, 'refused'], [d6, 'not_home']]) {
    await Household.updateOne({ _id: d._id }, { $set: { status: st, lastActionAt: KNOCK_AT, lastActionBy: canv._id } });
  }
  await recomputeCampaignStats(campaign._id);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, admin, lead, canv, other, campaign, effort, pass, turf, doors, v1a, v1b, template,
    adminTok: signUserToken(admin), leadTok: signUserToken(lead), canvTok: signUserToken(canv),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const url = (suffix = '') => `/admin/campaigns/${ctx.campaign._id}/unknock-entries${suffix}`;

// Every counter, rate and billable figure an unknock can move — compared field-by-field.
async function moneyShot() {
  const c = await Campaign.findById(ctx.campaign._id).lean();
  const roll = await call('GET', `/admin/reports/campaign-rollup?campaignId=${ctx.campaign._id}`, asAdmin());
  const cum = roll.json.cumulative;
  return {
    stats: {
      activityCount: c.stats.activityCount, knockCount: c.stats.knockCount,
      surveyedKnockCount: c.stats.surveyedKnockCount, litKnockCount: c.stats.litKnockCount,
      refusedKnockCount: c.stats.refusedKnockCount, restrictedDoorCount: c.stats.restrictedDoorCount,
      litDroppedCount: c.stats.litDroppedCount, surveyCount: c.stats.surveyCount,
    },
    knocks: cum.knocks, contactRate: cum.contactRate, connectionRate: cum.connectionRate,
    billableDoors: cum.billableDoors,
  };
}

test('org admins only', { skip }, async () => {
  const r = await call('POST', url(), { token: ctx.leadTok, orgId: ctx.org._id, body: { dryRun: true, scope: { userId: String(ctx.canv._id) } } });
  assert.equal(r.status, 403);
});

test('THE MONEY SHOT, BOTH WAYS — preview equals reality, revert restores it byte-for-byte', { skip }, async () => {
  const baseline = await moneyShot();
  const scope = { userId: String(ctx.canv._id) };

  // Parity with one deliberate difference: the table never lists lit_dropped (nothing to
  // relabel), but a scoped unknock sweeps it too — a faked lit drop bills, and a delete
  // fabricates nothing. The dry run's `sources` names the extra so the confirm stays honest.
  const table = await call('GET', `/admin/campaigns/${ctx.campaign._id}/outcome-entries?userId=${ctx.canv._id}`, asAdmin());
  const dry = await call('POST', url(), { ...asAdmin(), body: { dryRun: true, scope } });
  assert.equal(dry.status, 200);
  assert.equal(table.json.total, 5);
  // Cara's unknockable rows: d1 survey, d2/d4/d6 not_home, d3 lit_dropped, d5 refused = 6.
  // The note row and the desk mark are not selectable; Otto's visit is not hers.
  assert.equal(dry.json.entries, 6);
  assert.ok(dry.json.sources.includes('lit_dropped'), 'a faked lit drop is unknockable');
  // d1 keeps Otto's visit, d4 keeps the desk mark.
  assert.equal(dry.json.doorsStillRecorded, 2);
  assert.equal(dry.json.survey.responsesToArchive, 2);
  assert.deepEqual(dry.json.survey.manifest.map((m) => m.voterName).sort(), ['V1 Probe', 'V2 Probe']);

  const run = await call('POST', url(), { ...asAdmin(), body: { scope } });
  assert.equal(run.status, 201);
  assert.equal(run.json.run.status, 'completed');
  assert.equal(run.json.run.counts.entriesRemoved, 6);
  assert.equal(run.json.run.counts.responsesArchived, 2);
  assert.match(run.json.run.scopeSummary, /Cara Canvasser/);

  // Preview == reality: recompute from the ledger, never trust counters.
  await recomputeCampaignStats(ctx.campaign._id);
  const landed = await moneyShot();
  assert.equal(landed.knocks, dry.json.impact.after.knocks);
  assert.equal(landed.billableDoors, dry.json.impact.after.billableDoors);
  assert.equal(landed.contactRate, dry.json.impact.after.contactRate);
  assert.equal(landed.connectionRate, dry.json.impact.after.connectionRate);

  // Revert: the whole world comes back.
  const undo = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: run.json.run.id } });
  assert.equal(undo.status, 200);
  assert.equal(undo.json.run.counts.rowsNotRestored, 0);
  assert.equal(undo.json.run.counts.responsesNotRestored, 0);
  await recomputeCampaignStats(ctx.campaign._id);
  assert.deepEqual(await moneyShot(), baseline, 'no knock, rate, counter or billable figure may survive a revert changed');

  const again = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: run.json.run.id } });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'ALREADY_REVERTED');
});

test('a standing run: doors read unknocked, answers are archived evidence, facts follow the rows', { skip }, async () => {
  const [d1, d2, , d4, , d6] = ctx.doors;
  const scope = { userId: String(ctx.canv._id) };
  const run = await call('POST', url(), { ...asAdmin(), body: { scope } });
  assert.equal(run.status, 201);
  ctx.standingRunId = run.json.run.id;

  // Global status: an emptied door is unknocked; a door with surviving rows shows THEM.
  const fresh = await Household.find({ _id: { $in: [d1._id, d2._id, d4._id, d6._id] } }).lean();
  const by = new Map(fresh.map((h) => [String(h._id), h]));
  assert.equal(by.get(String(d2._id)).status, 'unknocked');
  assert.equal(by.get(String(d6._id)).status, 'unknocked'); // the note never drove status
  assert.equal(by.get(String(d1._id)).status, 'not_home'); // Otto's honest visit survives
  assert.equal(by.get(String(d4._id)).status, 'restricted'); // the office's gate mark survives

  // Per-round: the same doors read fresh inside their own round.
  const map = await getPassStatusMap(ctx.pass._id, [d2._id, d6._id], 'survey');
  assert.equal(map.get(String(d2._id))?.status ?? 'unknocked', 'unknocked');

  // Last-action facts are re-derived from surviving rows, never left naming the struck visit.
  assert.equal(by.get(String(d2._id)).lastActionAt, null);
  assert.equal(by.get(String(d2._id)).lastActionBy, null);
  assert.equal(String(by.get(String(d1._id)).lastActionBy), String(ctx.other._id));

  // The answers: archived with this run's id, restorable, and the voters read not_surveyed.
  const archived = await SurveyResponseArchive.find({ unknockRunId: run.json.run.id }).lean();
  assert.equal(archived.length, 2);
  assert.equal(archived[0].overwrittenVia, 'unknock');
  assert.equal(await SurveyResponse.countDocuments({ campaignId: ctx.campaign._id }), 0);
  const voters = await Voter.find({ _id: { $in: [ctx.v1a._id, ctx.v1b._id] } }).lean();
  assert.ok(voters.every((v) => v.surveyStatus === 'not_surveyed'));

  // The note survives on an unknocked door.
  assert.equal(await CanvassActivity.countDocuments({ householdId: d6._id, actionType: 'note_added' }), 1);

  // The frozen originals live in chunks, not on the run document.
  const runDoc = await UnknockRun.findById(run.json.run.id).lean();
  assert.equal(runDoc.activities, undefined);
  assert.equal(runDoc.frozenRows, 6);
  const chunks = await UnknockRunChunk.find({ runId: run.json.run.id }).lean();
  assert.equal(chunks.reduce((n, c) => n + c.rows.length, 0), 6);
});

test('the offline-replay tombstone: a struck knock cannot walk back in through the queue', { skip }, async () => {
  const [, d2] = ctx.doors;
  // Cara's phone replays the struck knock: recorded before the cleanup, delivered after it.
  const replay = await call('POST', `/mobile/households/${d2._id}/not-home`, {
    token: ctx.canvTok,
    orgId: ctx.org._id,
    body: { location: { lat: 30.26, lng: -97.74 }, wasOfflineSubmission: true, timestamp: KNOCK_AT.toISOString() },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.superseded, true);
  assert.equal(await CanvassActivity.countDocuments({ householdId: d2._id }), 0, 'the struck knock stayed struck');

  // A LIVE knock is new work and always lands — the door really is back in play.
  const live = await call('POST', `/mobile/households/${d2._id}/not-home`, {
    token: ctx.canvTok,
    orgId: ctx.org._id,
    body: { location: { lat: 30.26, lng: -97.74 } },
  });
  assert.equal(live.status, 201);
  assert.equal(await CanvassActivity.countDocuments({ householdId: d2._id }), 1);
  // ...and the re-knocked pair bills exactly once.
  await recomputeCampaignStats(ctx.campaign._id);
  const c = await Campaign.findById(ctx.campaign._id).lean();
  const agg = await CanvassActivity.aggregate([
    { $match: { householdId: d2._id } }, { $group: { _id: { h: '$householdId', p: '$passId' } } }, { $count: 'pairs' },
  ]);
  assert.equal(agg[0].pairs, 1);
  assert.ok(c.stats.knockCount >= 1);
});

test('revert after a real re-knock: newer work is never clobbered, and it says so', { skip }, async () => {
  const [d1, d2] = ctx.doors;
  // A newer field answer refilled v1a's round slot — the archived answer must stay archived.
  await SurveyResponse.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, voterId: ctx.v1a._id, householdId: d1._id,
    userId: ctx.other._id, surveyTemplateId: ctx.template._id, surveyTemplateVersion: 1,
    answers: [{ questionKey: 'support', questionLabel: 'Support?', answer: 'yes', optionIds: ['yes'] }],
    location: GPS, submittedAt: new Date(), passId: ctx.pass._id, effortId: ctx.effort._id,
  });

  const undo = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: ctx.standingRunId } });
  assert.equal(undo.status, 200);
  // d2's visit was re-knocked live in the previous test: its frozen original is skipped.
  assert.equal(undo.json.run.counts.rowsNotRestored, 1);
  assert.equal(undo.json.run.counts.responsesNotRestored, 1);
  const d2rows = await CanvassActivity.find({ householdId: d2._id }).lean();
  assert.equal(d2rows.length, 1, 'exactly the newer live knock — never two rows at one visit');
  assert.ok(new Date(d2rows[0].timestamp) > KNOCK_AT);
  // v1a keeps the newer answer; v1b's archived one came back.
  assert.equal(await SurveyResponse.countDocuments({ voterId: ctx.v1b._id }), 1);
  assert.equal(await SurveyResponseArchive.countDocuments({ unknockRunId: ctx.standingRunId }), 1);
});

test('a pending run refuses to revert — its entries were never removed', { skip }, async () => {
  const pending = await UnknockRun.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, status: 'pending', frozenRows: 1,
  });
  const r = await call('POST', url('/revert'), { ...asAdmin(), body: { runId: String(pending._id) } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'RUN_NOT_COMPLETED');
});

test('rows held by an earlier correction run are counted, not silently missing', { skip }, async () => {
  const [, , , , d5] = ctx.doors;
  // Reclassify d5's refused row (restored by the money-shot revert) — it is now stamped.
  const table = await call('GET', `/admin/campaigns/${ctx.campaign._id}/outcome-entries?outcomes=refused`, asAdmin());
  const refusedRow = table.json.entries.find((e) => e.householdId === String(d5._id));
  const rc = await call('POST', `/admin/campaigns/${ctx.campaign._id}/reclassify-outcomes`, {
    ...asAdmin(),
    body: { to: 'not_home', scope: { outcomes: ['refused'] }, actionIds: [refusedRow.id] },
  });
  assert.equal(rc.status, 201);

  const dry = await call('POST', url(), { ...asAdmin(), body: { dryRun: true, scope: { userId: String(ctx.canv._id) } } });
  assert.equal(dry.status, 200);
  assert.ok(dry.json.heldByRuns >= 1, 'the stamped row is reported as held, not just absent');
});

test('the campaign delete cascade takes UnknockRun and its chunks with it', { skip }, async () => {
  assert.ok((await UnknockRun.countDocuments({ campaignId: ctx.campaign._id })) > 0);
  assert.ok((await UnknockRunChunk.countDocuments({ campaignId: ctx.campaign._id })) > 0);
  await deleteCampaignCascade(ctx.campaign._id);
  assert.equal(await UnknockRun.countDocuments({ campaignId: ctx.campaign._id }), 0);
  assert.equal(await UnknockRunChunk.countDocuments({ campaignId: ctx.campaign._id }), 0);
});
