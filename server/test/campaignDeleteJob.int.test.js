import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Background campaign deletion over the REAL app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/campaign_delete_test node --test test/campaignDeleteJob.int.test.js
// Covers: the DELETE stamp+enqueue route (503-without-Redis restores the pre-stamp state,
// idempotent 202 on a fresh stamp, the failed-retry CAS guard, has-activity 400, the
// active-import/export 409), the deletingCampaigns list split + quarantine surfaces
// (mobile list, setup-status 404, rollup, PATCH 409, canvass 404s), the processor end to
// end (cascade incl. CoordinatorChange, DNC parking, VoterNote re-pointing; failure marks
// failed + retry completes; the has-canvassed re-check), poll-side stale expiry, worker
// claim checks for imports, and the super-admin retention-health surface.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-campaign-delete';
// No Redis in the harness: enqueue attempts must fail fast (503), never hang on the
// ioredis offline buffer.
process.env.CAMPAIGN_DELETE_ENQUEUE_TIMEOUT_MS = process.env.CAMPAIGN_DELETE_ENQUEUE_TIMEOUT_MS || '400';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { VoterNote } = await import('../src/models/VoterNote.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { CoordinatorChange } = await import('../src/models/CoordinatorChange.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { DncPendingId } = await import('../src/models/DncPendingId.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { processCampaignDeleteJob } = await import('../src/services/campaigns/deleteCampaignProcessor.js');
const { processImportJob } = await import('../src/services/import/importProcessor.js');
const { isDeleting, campaignDeletionHealth } = await import('../src/services/campaigns/deletionState.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const fakeQueueJob = (campaignId) => ({
  data: { campaignId: String(campaignId) },
  id: `t-${campaignId}`,
  attemptsMade: 1,
  opts: { attempts: 3 },
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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

// A fresh never-walked campaign with one household + two voters (one DNC-flagged with no
// sibling, one shared with the keeper campaign) + an org-level note on the shared voter +
// a CoordinatorChange row — everything the cascade must remove, park, or re-point.
async function seedDeletableCampaign(name) {
  const campaign = await Campaign.create({
    organizationId: ctx.org._id, name, type: 'survey', state: 'TX', timeZone: 'America/Chicago',
  });
  const home = await Household.create({
    organizationId: ctx.org._id, campaignId: campaign._id,
    addressLine1: '2 Elm St', city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: `2 elm st austin tx 78701 ${name}`,
    location: { type: 'Point', coordinates: [-97.75, 30.28] },
  });
  const shared = await Voter.create({
    organizationId: ctx.org._id, campaignId: campaign._id, householdId: home._id,
    stateVoterId: 'SHARED1', firstName: 'Sal', lastName: 'Shared', fullName: 'Sal Shared',
  });
  const flagged = await Voter.create({
    organizationId: ctx.org._id, campaignId: campaign._id, householdId: home._id,
    stateVoterId: `FLAG-${name}`, firstName: 'Flo', lastName: 'Flagged', fullName: 'Flo Flagged',
    doNotContact: { flagged: true, at: new Date(), reason: 'asked', source: 'admin' },
  });
  const note = await VoterNote.create({
    organizationId: ctx.org._id, voterId: shared._id, authorId: ctx.admin._id, body: 'call back after 5',
  });
  const coordRow = await CoordinatorChange.create({
    organizationId: ctx.org._id, campaignId: campaign._id, userId: ctx.admin._id, source: 'admin_users',
  });
  return { campaign, home, shared, flagged, note, coordRow };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  ctx.org = await Organization.create({ name: 'Del Org', slug: 'del-org', isActive: true });
  await Subscription.create({ organizationId: ctx.org._id, status: 'active' });

  ctx.admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@del.test', passwordHash: 'h', isActive: true });
  ctx.lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'lee@del.test', passwordHash: 'h', isActive: true });
  await Membership.create({ userId: ctx.admin._id, organizationId: ctx.org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: ctx.lead._id, organizationId: ctx.org._id, role: 'lead', isActive: true });
  ctx.adminTok = signUserToken(ctx.admin);
  ctx.leadTok = signUserToken(ctx.lead);

  // The keeper campaign holds SHARED1's sibling row — the delete must leave both the row
  // and the re-pointed note with it.
  ctx.keeper = await Campaign.create({ organizationId: ctx.org._id, name: 'Keeper', type: 'survey', state: 'TX' });
  const keeperHome = await Household.create({
    organizationId: ctx.org._id, campaignId: ctx.keeper._id,
    addressLine1: '9 Oak St', city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: '9 oak st austin tx 78701',
    location: { type: 'Point', coordinates: [-97.73, 30.26] },
  });
  ctx.keeperShared = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.keeper._id, householdId: keeperHome._id,
    stateVoterId: 'SHARED1', firstName: 'Sal', lastName: 'Shared', fullName: 'Sal Shared',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

// ---- DELETE route: stamp + enqueue -----------------------------------------------------

test('DELETE without Redis: 503 queue-unavailable AND the fresh stamp is rolled back', { skip }, async () => {
  const { campaign } = await seedDeletableCampaign('rollback');
  const res = await call('DELETE', `/admin/campaigns/${campaign._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.json.code, 'queue-unavailable');
  const after1 = await Campaign.findById(campaign._id).lean();
  assert.strictEqual(after1.deletion?.requestedAt ?? null, null, 'stamp must be rolled back');
  await Campaign.deleteOne({ _id: campaign._id });
});

test('DELETE on a failed retry whose enqueue fails restores the failed quarantine, not null', { skip }, async () => {
  const { campaign } = await seedDeletableCampaign('requarantine');
  const requestedAt = new Date(Date.now() - 60_000);
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt, requestedBy: ctx.admin._id, status: 'failed', heartbeatAt: null, error: 'boom' } } }
  );
  const res = await call('DELETE', `/admin/campaigns/${campaign._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(res.status, 503); // no Redis — enqueue fails after the re-stamp
  const after1 = await Campaign.findById(campaign._id).lean();
  assert.strictEqual(after1.deletion.status, 'failed', 'quarantine must be restored, not lifted');
  assert.ok(after1.deletion.requestedAt, 'requestedAt must survive');
  await Campaign.deleteOne({ _id: campaign._id });
});

test('DELETE is an idempotent 202 while a fresh pending/running stamp exists', { skip }, async () => {
  const { campaign } = await seedDeletableCampaign('idempotent');
  const requestedAt = new Date();
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt, requestedBy: ctx.admin._id, status: 'pending', heartbeatAt: null, error: null } } }
  );
  const res = await call('DELETE', `/admin/campaigns/${campaign._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(res.status, 202);
  assert.strictEqual(res.json.queued, true);
  const after1 = await Campaign.findById(campaign._id).lean();
  assert.strictEqual(after1.deletion.status, 'pending');
  assert.strictEqual(String(after1.deletion.requestedAt), String(requestedAt), 'stamp untouched');
  await Campaign.deleteOne({ _id: campaign._id });
});

test('DELETE gates: lead 403, has-activity 400, active import/export 409 campaign-busy', { skip }, async () => {
  const { campaign } = await seedDeletableCampaign('gates');

  const lead = await call('DELETE', `/admin/campaigns/${campaign._id}`, { token: ctx.leadTok, orgId: ctx.org._id });
  assert.strictEqual(lead.status, 403);

  const importJob = await ImportJob.create({
    organizationId: ctx.org._id, campaignId: campaign._id, uploadedBy: ctx.admin._id,
    filename: 'x.csv', status: 'parsing',
  });
  const busyImport = await call('DELETE', `/admin/campaigns/${campaign._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(busyImport.status, 409);
  assert.strictEqual(busyImport.json.code, 'campaign-busy');
  await ImportJob.updateOne({ _id: importJob._id }, { $set: { status: 'completed' } });

  const exportJob = await ExportJob.create({
    organizationId: ctx.org._id, campaignId: campaign._id, requestedBy: ctx.admin._id,
    type: 'voter-file', params: {}, status: 'running',
  });
  const busyExport = await call('DELETE', `/admin/campaigns/${campaign._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(busyExport.status, 409);
  await ExportJob.updateOne({ _id: exportJob._id }, { $set: { status: 'completed' } });

  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: campaign._id, householdId: campaign._id, // household shape irrelevant here
    userId: ctx.admin._id, actionType: 'not_home', timestamp: new Date(),
    location: { lat: 30.28, lng: -97.75, accuracy: 5 },
  });
  const walked = await call('DELETE', `/admin/campaigns/${campaign._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(walked.status, 400);
  assert.strictEqual(walked.json.code, 'has-activity');

  await CanvassActivity.deleteMany({ campaignId: campaign._id });
  await Campaign.deleteOne({ _id: campaign._id });
});

// ---- Quarantine surfaces ---------------------------------------------------------------

test('a stamped campaign moves to deletingCampaigns and is gone from every other surface', { skip }, async () => {
  const { campaign } = await seedDeletableCampaign('quarantine');
  await CampaignAssignment.create({ organizationId: ctx.org._id, campaignId: campaign._id, userId: ctx.admin._id });
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt: new Date(), requestedBy: ctx.admin._id, status: 'running', heartbeatAt: new Date(), error: null } } }
  );

  const list = await call('GET', '/admin/campaigns', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(list.status, 200);
  assert.ok(!list.json.campaigns.some((c) => String(c._id) === String(campaign._id)), 'absent from campaigns');
  const row = list.json.deletingCampaigns.find((c) => String(c._id) === String(campaign._id));
  assert.ok(row, 'present in deletingCampaigns');
  assert.strictEqual(row.deletionStatus, 'running');
  assert.strictEqual(row.deletion, undefined, 'raw subdoc stays server-side');

  const mobileList = await call('GET', '/mobile/campaigns', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.ok(!(mobileList.json.campaigns || []).some((c) => String(c._id) === String(campaign._id)), 'absent from mobile list');

  const setup = await call('GET', `/admin/campaigns/${campaign._id}/setup-status`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(setup.status, 404, 'campaign-scoped routes 404');

  const rollup = await call('GET', `/admin/reports/campaign-rollup?scope=all&campaignId=${campaign._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.ok(!(rollup.json.campaigns || []).some((c) => String(c._id) === String(campaign._id)), 'absent from rollup even by explicit id');

  const patch = await call('PATCH', `/admin/campaigns/${campaign._id}`, { token: ctx.adminTok, orgId: ctx.org._id, body: { name: 'Nope' } });
  assert.strictEqual(patch.status, 409);
  assert.strictEqual(patch.json.code, 'campaign-deleting');

  // The requireActiveCampaign middleware's deleting branch fires BEFORE the route's own
  // loadOwnedCampaign 404 — either refusal quarantines the write; the 409 carries the reason.
  const assign = await call('POST', `/admin/campaigns/${campaign._id}/assignments`, { token: ctx.adminTok, orgId: ctx.org._id, body: { userIds: [String(ctx.admin._id)] } });
  assert.strictEqual(assign.status, 409, 'assignment writes are quarantined');
  assert.strictEqual(assign.json.code, 'campaign-deleting');

  const bootstrap = await call('GET', `/mobile/bootstrap?campaignId=${campaign._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(bootstrap.status, 404, 'mobile bootstrap walls canvassing');

  await CampaignAssignment.deleteMany({ campaignId: campaign._id });
  await Campaign.deleteOne({ _id: campaign._id });
});

// ---- Processor -------------------------------------------------------------------------

test('processor happy path: cascade removes everything, parks DNC, re-points the note', { skip }, async () => {
  const { campaign, shared, note, coordRow } = await seedDeletableCampaign('happy');
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt: new Date(), requestedBy: ctx.admin._id, status: 'pending', heartbeatAt: null, error: null } } }
  );

  await processCampaignDeleteJob(fakeQueueJob(campaign._id));

  assert.strictEqual(await Campaign.findById(campaign._id), null, 'campaign row gone');
  assert.strictEqual(await Voter.countDocuments({ campaignId: campaign._id }), 0);
  assert.strictEqual(await Household.countDocuments({ campaignId: campaign._id }), 0);
  assert.strictEqual(await CoordinatorChange.countDocuments({ _id: coordRow._id }), 0, 'CoordinatorChange cascades now');

  // FLAG-happy had no sibling → parked; SHARED1 lives on in Keeper → not parked.
  assert.ok(await DncPendingId.findOne({ organizationId: ctx.org._id, stateVoterId: 'FLAG-happy' }), 'DNC parked');
  assert.strictEqual(await DncPendingId.findOne({ organizationId: ctx.org._id, stateVoterId: 'SHARED1' }), null);

  // The note re-pointed from the deleted SHARED1 row to the keeper sibling.
  const movedNote = await VoterNote.findById(note._id).lean();
  assert.strictEqual(String(movedNote.voterId), String(ctx.keeperShared._id), 'note re-pointed to sibling');
  assert.notStrictEqual(String(movedNote.voterId), String(shared._id));
});

test('processor re-checks has-canvassed at claim: fails without destroying anything', { skip }, async () => {
  const { campaign, home, shared } = await seedDeletableCampaign('recheck');
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt: new Date(), requestedBy: ctx.admin._id, status: 'pending', heartbeatAt: null, error: null } } }
  );
  // A knock lands between the route's gate and the worker claiming the job.
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: campaign._id, householdId: home._id,
    voterId: shared._id, userId: ctx.admin._id, actionType: 'not_home', timestamp: new Date(),
    location: { lat: 30.28, lng: -97.75, accuracy: 5 },
  });

  await assert.rejects(() => processCampaignDeleteJob(fakeQueueJob(campaign._id)), /archive/i);
  const after1 = await Campaign.findById(campaign._id).lean();
  assert.ok(after1, 'campaign intact');
  assert.strictEqual(after1.deletion.status, 'failed');
  assert.match(after1.deletion.error, /archive/i);
  assert.ok(await Voter.countDocuments({ campaignId: campaign._id }) > 0, 'nothing destroyed');

  await CanvassActivity.deleteMany({ campaignId: campaign._id });
  await Voter.deleteMany({ campaignId: campaign._id });
  await Household.deleteMany({ campaignId: campaign._id });
  await VoterNote.deleteMany({ organizationId: ctx.org._id, voterId: { $ne: ctx.keeperShared._id } });
  await CoordinatorChange.deleteMany({ campaignId: campaign._id });
  await Campaign.deleteOne({ _id: campaign._id });
});

test('processor failure marks failed on the attempt; a re-stamped retry completes', { skip }, async (t) => {
  const { campaign } = await seedDeletableCampaign('faildelete');
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt: new Date(), requestedBy: ctx.admin._id, status: 'pending', heartbeatAt: null, error: null } } }
  );

  const boom = t.mock.method(Voter, 'deleteMany', () => { throw new Error('mongo hiccup'); });
  await assert.rejects(() => processCampaignDeleteJob(fakeQueueJob(campaign._id)), /mongo hiccup/);
  boom.mock.restore();

  const mid = await Campaign.findById(campaign._id).lean();
  assert.ok(mid, 'campaign survives the failed attempt');
  assert.strictEqual(mid.deletion.status, 'failed');
  assert.ok(isDeleting(mid), 'failed keeps the quarantine');

  // The retry path: re-stamp (what the route does) + re-run.
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt: new Date(), requestedBy: ctx.admin._id, status: 'pending', heartbeatAt: null, error: null } } }
  );
  await processCampaignDeleteJob(fakeQueueJob(campaign._id));
  assert.strictEqual(await Campaign.findById(campaign._id), null, 'retry finishes the delete');
});

test('processor no-ops on a missing campaign and on an unstamped one', { skip }, async () => {
  await processCampaignDeleteJob(fakeQueueJob(new mongoose.Types.ObjectId())); // gone: stale redelivery

  const { campaign } = await seedDeletableCampaign('unstamped');
  await processCampaignDeleteJob(fakeQueueJob(campaign._id)); // stamp cleared: must NOT delete
  assert.ok(await Campaign.findById(campaign._id), 'unstamped campaign untouched');
  await Voter.deleteMany({ campaignId: campaign._id });
  await Household.deleteMany({ campaignId: campaign._id });
  await VoterNote.deleteMany({ organizationId: ctx.org._id, voterId: { $ne: ctx.keeperShared._id } });
  await CoordinatorChange.deleteMany({ campaignId: campaign._id });
  await Campaign.deleteOne({ _id: campaign._id });
});

// ---- Poll-side stale expiry ------------------------------------------------------------

test('GET /admin/campaigns expires stale deletions to failed; fresh ones stay', { skip }, async () => {
  const stalePending = await Campaign.create({ organizationId: ctx.org._id, name: 'Stale P', type: 'survey', state: 'TX' });
  const staleRunning = await Campaign.create({ organizationId: ctx.org._id, name: 'Stale R', type: 'survey', state: 'TX' });
  const freshRunning = await Campaign.create({ organizationId: ctx.org._id, name: 'Fresh R', type: 'survey', state: 'TX' });
  const old = new Date(Date.now() - 10 * 60 * 1000);
  await Campaign.updateOne({ _id: stalePending._id }, { $set: { deletion: { requestedAt: old, requestedBy: ctx.admin._id, status: 'pending', heartbeatAt: null, error: null } } });
  await Campaign.updateOne({ _id: staleRunning._id }, { $set: { deletion: { requestedAt: old, requestedBy: ctx.admin._id, status: 'running', heartbeatAt: old, error: null } } });
  await Campaign.updateOne({ _id: freshRunning._id }, { $set: { deletion: { requestedAt: old, requestedBy: ctx.admin._id, status: 'running', heartbeatAt: new Date(), error: null } } });

  const list = await call('GET', '/admin/campaigns', { token: ctx.adminTok, orgId: ctx.org._id });
  const byId = (id) => list.json.deletingCampaigns.find((c) => String(c._id) === String(id));
  assert.strictEqual(byId(stalePending._id).deletionStatus, 'failed', 'stale pending expired');
  assert.match(byId(stalePending._id).deletionError, /worker/i);
  assert.strictEqual(byId(staleRunning._id).deletionStatus, 'failed', 'stale running expired');
  assert.strictEqual(byId(freshRunning._id).deletionStatus, 'running', 'fresh heartbeat NOT expired');

  await Campaign.deleteMany({ _id: { $in: [stalePending._id, staleRunning._id, freshRunning._id] } });
});

// ---- Canvassing walls + worker claim checks --------------------------------------------

test('knock and survey POSTs against a stamped campaign 404', { skip }, async () => {
  const { campaign, home, shared } = await seedDeletableCampaign('knockwall');
  await CampaignAssignment.create({ organizationId: ctx.org._id, campaignId: campaign._id, userId: ctx.admin._id });
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt: new Date(), requestedBy: ctx.admin._id, status: 'running', heartbeatAt: new Date(), error: null } } }
  );

  const knock = await call('POST', `/mobile/households/${home._id}/not-home`, {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: { location: { lat: 30.28, lng: -97.75, accuracy: 5 }, timestamp: new Date().toISOString() },
  });
  assert.strictEqual(knock.status, 404, `knock walled (got ${knock.status}: ${JSON.stringify(knock.json)})`);

  const survey = await call('POST', `/mobile/voters/${shared._id}/survey`, {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: {
      surveyTemplateId: String(new mongoose.Types.ObjectId()),
      answers: [],
      location: { lat: 30.28, lng: -97.75, accuracy: 5 },
      timestamp: new Date().toISOString(),
    },
  });
  assert.strictEqual(survey.status, 404, `survey walled (got ${survey.status})`);

  await CampaignAssignment.deleteMany({ campaignId: campaign._id });
  await Voter.deleteMany({ campaignId: campaign._id });
  await Household.deleteMany({ campaignId: campaign._id });
  await VoterNote.deleteMany({ organizationId: ctx.org._id, voterId: { $ne: ctx.keeperShared._id } });
  await CoordinatorChange.deleteMany({ campaignId: campaign._id });
  await Campaign.deleteOne({ _id: campaign._id });
});

test('import worker claim check: a queued import against a stamped campaign fails its job', { skip }, async () => {
  const { campaign } = await seedDeletableCampaign('importclaim');
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt: new Date(), requestedBy: ctx.admin._id, status: 'pending', heartbeatAt: null, error: null } } }
  );
  const job = await ImportJob.create({
    organizationId: ctx.org._id, campaignId: campaign._id, uploadedBy: ctx.admin._id,
    filename: 'late.csv', status: 'pending',
  });
  await assert.rejects(
    () => processImportJob({ data: { importJobId: String(job._id) }, id: 't-import' }),
    /being deleted/i
  );
  const failed = await ImportJob.findById(job._id).lean();
  assert.strictEqual(failed.status, 'failed');

  await ImportJob.deleteMany({ campaignId: campaign._id });
  await Voter.deleteMany({ campaignId: campaign._id });
  await Household.deleteMany({ campaignId: campaign._id });
  await VoterNote.deleteMany({ organizationId: ctx.org._id, voterId: { $ne: ctx.keeperShared._id } });
  await CoordinatorChange.deleteMany({ campaignId: campaign._id });
  await Campaign.deleteOne({ _id: campaign._id });
});

// ---- Super-admin health ----------------------------------------------------------------

test('a failed campaign deletion turns the retention-health surface unhealthy', { skip }, async () => {
  const clean = await campaignDeletionHealth();
  assert.strictEqual(clean.healthy, true, 'baseline healthy');

  const { campaign } = await seedDeletableCampaign('health');
  await Campaign.updateOne(
    { _id: campaign._id },
    { $set: { deletion: { requestedAt: new Date(), requestedBy: ctx.admin._id, status: 'failed', heartbeatAt: null, error: 'boom' } } }
  );
  const dirty = await campaignDeletionHealth();
  assert.strictEqual(dirty.healthy, false);
  assert.strictEqual(dirty.failed, 1);

  await Voter.deleteMany({ campaignId: campaign._id });
  await Household.deleteMany({ campaignId: campaign._id });
  await VoterNote.deleteMany({ organizationId: ctx.org._id, voterId: { $ne: ctx.keeperShared._id } });
  await CoordinatorChange.deleteMany({ campaignId: campaign._id });
  await Campaign.deleteOne({ _id: campaign._id });
});
