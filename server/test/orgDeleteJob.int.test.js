import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The ORG-delete state machine, over the REAL app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/orgdeljob node --test test/orgDeleteJob.int.test.js
// Covers what orgDelete.int.test.js (the cascade's contents) does not: the stamp/claim/expire CAS
// ladder, the enqueue-failure rollback, the TENANT WALL a stamp puts up, the chunked person purge
// at a chunk boundary, the health counters, and the delete-on-request handoff.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-org-delete-job';
// No Redis in the harness: the enqueue must fail fast (503), never hang on the offline buffer.
process.env.ORG_DELETE_ENQUEUE_TIMEOUT_MS = process.env.ORG_DELETE_ENQUEUE_TIMEOUT_MS || '400';
// Prove the chunked person purge crosses chunk boundaries without seeding 5001 Person docs.
process.env.ORG_DELETE_CHUNK = '2';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { Person } = await import('../src/models/Person.js');
const { PersonMergeCandidate } = await import('../src/models/PersonMergeCandidate.js');
const { PersonMergeLog } = await import('../src/models/PersonMergeLog.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { OrgDeletionRequest } = await import('../src/models/OrgDeletionRequest.js');
const { processOrgDeleteJob } = await import('../src/services/platform/deleteOrgProcessor.js');
const { orgDeletionHealth, isDeleting } = await import('../src/services/platform/orgDeletionState.js');
const { deletionRequestHealth } = await import('../src/services/retention/triggers.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const fakeJob = (orgId, extra = {}) => ({
  data: { organizationId: String(orgId), source: 'break_glass', requestId: null, ...extra },
  id: `t-${orgId}`,
  attemptsMade: 1,
  opts: { attempts: 3 },
});

const stamp = (orgId, deletion) =>
  Organization.updateOne(
    { _id: orgId },
    {
      $set: {
        deletion: {
          requestedAt: new Date(), requestedBy: null, source: 'break_glass',
          requestId: null, status: 'pending', heartbeatAt: null, error: null,
          ...deletion,
        },
      },
    }
  );

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

// A throwaway org with a campaign, a household and one voter — enough for the wall tests.
async function makeOrg(slug) {
  const org = await Organization.create({ name: slug, slug, isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  await Membership.create({ userId: ctx.admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const campaign = await Campaign.create({ organizationId: org._id, name: 'C', type: 'survey', state: 'FL' });
  const home = await Household.create({
    organizationId: org._id, campaignId: campaign._id,
    addressLine1: '1 Elm', city: 'T', state: 'FL', zipCode: '1',
    normalizedAddress: `1 elm ${slug}`,
    location: { type: 'Point', coordinates: [-81, 28] },
  });
  await Voter.create({
    organizationId: org._id, campaignId: campaign._id, householdId: home._id,
    stateVoterId: `SV-${slug}`, firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter',
  });
  return { org, campaign, home };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  ctx.admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@odj.test', passwordHash: 'h', isActive: true });
  ctx.super = await User.create({
    firstName: 'Sue', lastName: 'Super', email: 'sue@odj.test', passwordHash: 'h',
    isActive: true, isSuperAdmin: true, platformRole: 'break_glass',
  });
  ctx.adminTok = signUserToken(ctx.admin);
  ctx.superTok = signUserToken(ctx.super);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

// ---- Route: stamp, enqueue, rollback ---------------------------------------------------

test('DELETE without Redis: 503 queue-unavailable AND the fresh stamp is rolled back', { skip }, async () => {
  const { org } = await makeOrg('rollback');
  const r = await call('DELETE', `/super-admin/organizations/${org._id}`, {
    token: ctx.superTok, body: { confirmSlug: 'rollback' },
  });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.json.code, 'queue-unavailable');
  const after1 = await Organization.findById(org._id).lean();
  assert.strictEqual(after1.deletion?.requestedAt ?? null, null, 'a failed enqueue must not wall the tenant');
});

test('DELETE on a failed org whose enqueue fails restores the quarantine, not null', { skip }, async () => {
  const { org } = await makeOrg('requarantine');
  await stamp(org._id, { status: 'failed', error: 'boom', requestedAt: new Date(Date.now() - 60_000) });
  const r = await call('DELETE', `/super-admin/organizations/${org._id}`, {
    token: ctx.superTok, body: { confirmSlug: 'requarantine' },
  });
  assert.strictEqual(r.status, 503);
  const after1 = await Organization.findById(org._id).lean();
  assert.strictEqual(after1.deletion.status, 'failed', 'a half-destroyed org must stay walled');
  assert.ok(after1.deletion.requestedAt);
  await Organization.deleteOne({ _id: org._id }); // orgDeletionHealth counts platform-wide
});

test('DELETE is an idempotent 202 while a fresh pending stamp exists', { skip }, async () => {
  const { org } = await makeOrg('idempotent');
  const at = new Date();
  await stamp(org._id, { requestedAt: at });
  const r = await call('DELETE', `/super-admin/organizations/${org._id}`, {
    token: ctx.superTok, body: { confirmSlug: 'idempotent' },
  });
  assert.strictEqual(r.status, 202);
  assert.strictEqual(r.json.queued, true);
  const after1 = await Organization.findById(org._id).lean();
  assert.strictEqual(String(after1.deletion.requestedAt), String(at), 'stamp untouched');
  await Organization.deleteOne({ _id: org._id }); // orgDeletionHealth counts platform-wide
});

test('DELETE gates: bad slug 400, non-break-glass 403, active import/export 409 org-busy', { skip }, async () => {
  const { org, campaign } = await makeOrg('gates');

  const wrongSlug = await call('DELETE', `/super-admin/organizations/${org._id}`, {
    token: ctx.superTok, body: { confirmSlug: 'nope' },
  });
  assert.strictEqual(wrongSlug.status, 400);
  assert.strictEqual(wrongSlug.json.code, 'confirm-slug-mismatch');

  const notSuper = await call('DELETE', `/super-admin/organizations/${org._id}`, {
    token: ctx.adminTok, body: { confirmSlug: 'gates' },
  });
  assert.strictEqual(notSuper.status, 403);

  const job = await ImportJob.create({
    organizationId: org._id, campaignId: campaign._id, uploadedBy: ctx.admin._id,
    filename: 'x.csv', status: 'parsing',
  });
  const busyImport = await call('DELETE', `/super-admin/organizations/${org._id}`, {
    token: ctx.superTok, body: { confirmSlug: 'gates' },
  });
  assert.strictEqual(busyImport.status, 409);
  assert.strictEqual(busyImport.json.code, 'org-busy');
  await ImportJob.updateOne({ _id: job._id }, { $set: { status: 'completed' } });

  const xp = await ExportJob.create({
    organizationId: org._id, campaignId: null, requestedBy: ctx.admin._id,
    type: 'full-backup', params: {}, status: 'running',
  });
  const busyExport = await call('DELETE', `/super-admin/organizations/${org._id}`, {
    token: ctx.superTok, body: { confirmSlug: 'gates' },
  });
  assert.strictEqual(busyExport.status, 409);
  await ExportJob.deleteOne({ _id: xp._id });
});

// ---- The tenant wall -------------------------------------------------------------------

test('a stamped org is walled off from every tenant surface and every org list', { skip }, async () => {
  const { org, campaign } = await makeOrg('walled');
  await stamp(org._id, { status: 'running', heartbeatAt: new Date() });

  const admin = await call('GET', '/admin/campaigns', { token: ctx.adminTok, orgId: org._id });
  assert.strictEqual(admin.status, 404, 'every /admin request 404s');
  assert.strictEqual(admin.json.code, 'ORG_CONTEXT', 'with the code both clients already recover from');
  assert.strictEqual(admin.json.reason, 'deleting');

  const mobile = await call('GET', `/mobile/bootstrap?campaignId=${campaign._id}`, { token: ctx.adminTok, orgId: org._id });
  assert.strictEqual(mobile.status, 404, 'canvassing is walled too');

  const me = await call('GET', '/auth/me', { token: ctx.adminTok });
  assert.ok(
    !(me.json.memberships || []).some((m) => String(m.organizationId?.id || m.organizationId?._id || m.organizationId) === String(org._id)),
    'the org drops out of the user’s own org list'
  );

  const list = await call('GET', '/super-admin/organizations', { token: ctx.superTok });
  assert.ok(!list.json.organizations.some((o) => o.id === String(org._id)), 'absent from the normal list');
  const row = list.json.deletingOrganizations.find((o) => o.id === String(org._id));
  assert.ok(row, 'present in deletingOrganizations');
  assert.strictEqual(row.deletionStatus, 'running');
  assert.strictEqual(row.deletion, undefined, 'the raw subdoc stays server-side');

  const patch = await call('PATCH', `/super-admin/organizations/${org._id}`, {
    token: ctx.superTok, body: { isActive: false },
  });
  assert.strictEqual(patch.status, 409, 'Reactivate/Deactivate must not appear to succeed');
  assert.strictEqual(patch.json.code, 'org-deleting');
});

// ---- Processor -------------------------------------------------------------------------

test('processor purges persons across CHUNK boundaries, satellites and all', { skip }, async () => {
  const { org, campaign, home } = await makeOrg('chunky');
  // 3 persons reachable via Voter.personId, 2 reachable only via Person.organizationId — the two
  // cursor passes — with ORG_DELETE_CHUNK=2 forcing several chunks through each.
  const linked = [];
  for (let i = 0; i < 3; i += 1) {
    const p = await Person.create({ organizationId: org._id, firstName: `L${i}`, lastName: 'Linked' });
    linked.push(p);
    await Voter.create({
      organizationId: org._id, campaignId: campaign._id, householdId: home._id,
      stateVoterId: `SV-chunky-${i}`, firstName: `L${i}`, lastName: 'Linked', fullName: `L${i} Linked`,
      personId: p._id,
    });
  }
  const orphans = [];
  for (let i = 0; i < 2; i += 1) {
    orphans.push(await Person.create({ organizationId: org._id, firstName: `O${i}`, lastName: 'Orphan' }));
  }
  // PII-bearing satellites on one of each kind — these must die WITH their person.
  await PersonMergeCandidate.create({
    organizationId: org._id, personIdA: linked[0]._id, personIdB: orphans[0]._id,
    status: 'open', reason: 'manual',
  });
  await PersonMergeLog.create({
    organizationId: org._id, survivorId: linked[1]._id, victimId: orphans[1]._id, action: 'merge',
  });

  await stamp(org._id);
  const summary = await processOrgDeleteJob(fakeJob(org._id));

  assert.strictEqual(summary.personsPurged, 5, 'each person counted exactly once across both passes');
  assert.strictEqual(await Person.countDocuments({ organizationId: org._id }), 0);
  assert.strictEqual(await PersonMergeCandidate.countDocuments({}), 0, 'merge candidates die with their person');
  assert.strictEqual(await PersonMergeLog.countDocuments({}), 0, 'merge logs carry a full PII snapshot — they must not survive');
  assert.strictEqual(await Organization.countDocuments({ _id: org._id }), 0);
});

test('processor no-ops on a missing org and on an UNSTAMPED one', { skip }, async () => {
  await processOrgDeleteJob(fakeJob(new mongoose.Types.ObjectId())); // stale redelivery

  const { org } = await makeOrg('unstamped');
  const out = await processOrgDeleteJob(fakeJob(org._id));
  assert.strictEqual(out, null);
  assert.ok(await Organization.findById(org._id), 'never destroy a tenant nobody asked to destroy');
});

test('processor failure marks failed and keeps the wall; a re-stamped retry completes', { skip }, async (t) => {
  const { org } = await makeOrg('failretry');
  await stamp(org._id);

  const boom = t.mock.method(Voter, 'deleteMany', () => { throw new Error('mongo hiccup'); });
  await assert.rejects(() => processOrgDeleteJob(fakeJob(org._id)), /mongo hiccup/);
  boom.mock.restore();

  const mid = await Organization.findById(org._id).lean();
  assert.ok(mid, 'the org survives the failed attempt');
  assert.strictEqual(mid.deletion.status, 'failed');
  assert.ok(isDeleting(mid), 'a failed delete stays walled — it may be half-destroyed');

  await stamp(org._id); // what the retry route does
  await processOrgDeleteJob(fakeJob(org._id));
  assert.strictEqual(await Organization.countDocuments({ _id: org._id }), 0, 'the retry finishes it');
});

// ---- Stale expiry + health --------------------------------------------------------------

test('the org list expires stale deletions; a fresh heartbeat survives', { skip }, async () => {
  const stale = (await makeOrg('stalerun')).org;
  const fresh = (await makeOrg('freshrun')).org;
  const queued = (await makeOrg('queuedrun')).org;
  const old = new Date(Date.now() - 60 * 60 * 1000); // an hour
  await stamp(stale._id, { status: 'running', heartbeatAt: old, requestedAt: old });
  await stamp(fresh._id, { status: 'running', heartbeatAt: new Date(), requestedAt: old });
  await stamp(queued._id, { status: 'pending', requestedAt: new Date(Date.now() - 60_000) });

  const list = await call('GET', '/super-admin/organizations', { token: ctx.superTok });
  const byId = (id) => list.json.deletingOrganizations.find((o) => o.id === String(id));
  assert.strictEqual(byId(stale._id).deletionStatus, 'failed', 'a dead run must not read "Deleting…" forever');
  assert.match(byId(stale._id).deletionError, /worker/i);
  assert.strictEqual(byId(fresh._id).deletionStatus, 'running', 'a live cascade is left alone');
  // A pending job waiting behind a concurrency-1 queue is NOT stale — the unclaimed window is hours.
  assert.strictEqual(byId(queued._id).deletionStatus, 'pending');

  const health = await orgDeletionHealth();
  assert.strictEqual(health.failed, 1);
  assert.strictEqual(health.healthy, false);
  assert.strictEqual(health.queued, 1, 'a normally-queued org is reported but is NOT a red condition');
  assert.strictEqual(health.unstarted, 0);

  await Organization.deleteMany({ _id: { $in: [stale._id, fresh._id, queued._id] } });
});

test('health: a long-unclaimed pending deletion is unstarted (the worker is off)', { skip }, async () => {
  const { org } = await makeOrg('nevereclaimed');
  await stamp(org._id, { status: 'pending', requestedAt: new Date(Date.now() - 7 * 60 * 60 * 1000) });
  const health = await orgDeletionHealth();
  assert.strictEqual(health.unstarted, 1);
  assert.strictEqual(health.healthy, false);
  await Organization.deleteOne({ _id: org._id });
});

// ---- Delete-on-request handoff -----------------------------------------------------------

test('an in-flight deletion keeps its overdue request OUT of the stuck count; the job closes it', { skip }, async () => {
  const { org } = await makeOrg('slaorg');
  const req = await OrgDeletionRequest.create({
    organizationId: org._id, requestedByEmail: 'ada@sla.test',
    scheduledFor: new Date(Date.now() - 3 * 86_400_000), status: 'scheduled', // overdue by 3 days
  });

  const before1 = await deletionRequestHealth();
  assert.strictEqual(before1.stuck, 1, 'overdue and nothing happening → stuck');

  await stamp(org._id, { source: 'requested', requestId: req._id, status: 'running', heartbeatAt: new Date() });
  const during = await deletionRequestHealth();
  assert.strictEqual(during.stuck, 0, 'a deletion actually running is not a broken promise');
  assert.strictEqual(during.inFlight, 1, 'and it is reported, not hidden');
  assert.strictEqual(during.healthy, true);

  await processOrgDeleteJob(fakeJob(org._id, { source: 'requested', requestId: String(req._id) }));
  const closed = await OrgDeletionRequest.findById(req._id).lean();
  assert.strictEqual(closed.status, 'completed', 'the JOB closes the request');
  assert.ok(closed.completedAt);
});

test('a request whose org is already gone is closed completed, not retried forever', { skip }, async () => {
  const orphanOrgId = new mongoose.Types.ObjectId();
  const req = await OrgDeletionRequest.create({
    organizationId: orphanOrgId, requestedByEmail: 'bob@sla.test',
    scheduledFor: new Date(Date.now() - 86_400_000), status: 'scheduled',
  });
  // The crash-between-cascade-and-close window: the processor redelivers, finds no org, and must
  // still close the row — the promise WAS kept.
  await processOrgDeleteJob(fakeJob(orphanOrgId, { source: 'requested', requestId: String(req._id) }));
  assert.strictEqual((await OrgDeletionRequest.findById(req._id).lean()).status, 'completed');
});
