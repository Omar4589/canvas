import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Export Center lifecycle over the REAL app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/exports_test node --test test/exports.int.test.js
// Covers: POST validation + role/campaign scoping, org isolation, the processor run end to
// end (GridFS artifact, DNC exclusion, honest counters), download streaming + expiry (410),
// the sweeper (expired / failed-leftover / orphan passes), DELETE semantics, and the
// sweeper's placement in MAINTENANCE_JOBS but NOT the pinned REPEATABLE_JOBS.
// (The entitlement carve-out matrix lives in billing.int.test.js beside the rest of the
// status × method gate; the per-type column/semantics assertions live in
// exportBuilders.int.test.js.)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-exports';
// No Redis in the harness: enqueue attempts must fail fast (503), never hang on the
// ioredis offline buffer.
process.env.EXPORT_ENQUEUE_TIMEOUT_MS = process.env.EXPORT_ENQUEUE_TIMEOUT_MS || '400';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { processExportJob } = await import('../src/services/export/exportProcessor.js');
const { sweepExpiredExports, EXPORT_SWEEP_JOB } = await import('../src/services/export/sweepExpiredExports.js');
const { REPEATABLE_JOBS, MAINTENANCE_JOBS } = await import('../src/services/retention/scheduler.js');
const { openArtifactUploadStream } = await import('../src/services/export/exportArtifactStore.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const fakeQueueJob = (id) => ({ data: { exportJobId: String(id) }, id: `t-${id}`, attemptsMade: 1, opts: { attempts: 3 } });

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
  return { status: res.status, json, headers: res.headers, text };
}

async function download(path, { token, orgId }) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(orgId) },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, text: buf.toString('utf8') };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();

  ctx.org = await Organization.create({ name: 'Export Org', slug: 'export-org', isActive: true });
  ctx.org2 = await Organization.create({ name: 'Other Org', slug: 'other-org', isActive: true });
  await Subscription.create({ organizationId: ctx.org._id, status: 'active' });
  await Subscription.create({ organizationId: ctx.org2._id, status: 'active' });

  ctx.admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ada@x.test', passwordHash: 'h', isActive: true });
  ctx.lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'lee@x.test', passwordHash: 'h', isActive: true });
  ctx.admin2 = await User.create({ firstName: 'Bob', lastName: 'Boss', email: 'bob@x.test', passwordHash: 'h', isActive: true });
  await Membership.create({ userId: ctx.admin._id, organizationId: ctx.org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: ctx.lead._id, organizationId: ctx.org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: ctx.admin2._id, organizationId: ctx.org2._id, role: 'admin', isActive: true });
  ctx.adminTok = signUserToken(ctx.admin);
  ctx.leadTok = signUserToken(ctx.lead);
  ctx.admin2Tok = signUserToken(ctx.admin2);

  ctx.c1 = await Campaign.create({ organizationId: ctx.org._id, name: 'Camp One', type: 'survey', state: 'TX', timeZone: 'America/Chicago' });
  ctx.c2 = await Campaign.create({ organizationId: ctx.org._id, name: 'Camp Two', type: 'survey', state: 'TX' });
  await CampaignManager.create({ campaignId: ctx.c1._id, userId: ctx.lead._id, organizationId: ctx.org._id });

  const home = await Household.create({
    organizationId: ctx.org._id, campaignId: ctx.c1._id,
    addressLine1: '1 Main St', city: 'Austin', state: 'TX', zipCode: '78701',
    normalizedAddress: '1 main st austin tx 78701',
    location: { type: 'Point', coordinates: [-97.74, 30.27] },
  });
  ctx.home = home;
  ctx.alice = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.c1._id, householdId: home._id,
    stateVoterId: 'SV1', firstName: 'Alice', lastName: 'Able', fullName: 'Alice Able', party: 'DEM',
  });
  ctx.donna = await Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.c1._id, householdId: home._id,
    stateVoterId: 'SVDNC1', firstName: 'Donna', lastName: 'Dncerson', fullName: 'Donna Dncerson', party: 'REP',
    doNotContact: { flagged: true, at: new Date(), reason: 'asked', source: 'admin' },
  });
  await CanvassActivity.create({
    organizationId: ctx.org._id, campaignId: ctx.c1._id, householdId: home._id,
    voterId: ctx.alice._id, userId: ctx.admin._id, actionType: 'not_home',
    timestamp: new Date('2026-08-01T15:00:00Z'), location: { lat: 30.27, lng: -97.74, accuracy: 5 },
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

// ---- POST validation + scoping ---------------------------------------------------------

test('POST: unknown type / missing campaign / bad params are 400s', { skip }, async () => {
  const bad = await call('POST', '/admin/exports', {
    token: ctx.adminTok, orgId: ctx.org._id, body: { type: 'nope', campaignId: String(ctx.c1._id) },
  });
  assert.strictEqual(bad.status, 400);
  const noCamp = await call('POST', '/admin/exports', {
    token: ctx.adminTok, orgId: ctx.org._id, body: { type: 'canvass-activity' },
  });
  assert.strictEqual(noCamp.status, 400);
  const badParam = await call('POST', '/admin/exports', {
    token: ctx.adminTok, orgId: ctx.org._id,
    body: { type: 'canvass-activity', campaignId: String(ctx.c1._id), params: { from: 'yesterday' } },
  });
  assert.strictEqual(badParam.status, 400);
  assert.match(badParam.json.error, /YYYY-MM-DD/);
});

test('POST: lead scoping — managed campaign passes the gates, unmanaged 403, admin-only 403', { skip }, async () => {
  const managed = await call('POST', '/admin/exports', {
    token: ctx.leadTok, orgId: ctx.org._id, body: { type: 'canvass-activity', campaignId: String(ctx.c1._id) },
  });
  // 201 with Redis, 503 without — either proves role+campaign gates passed.
  assert.ok([201, 503].includes(managed.status), `got ${managed.status}`);
  const unmanaged = await call('POST', '/admin/exports', {
    token: ctx.leadTok, orgId: ctx.org._id, body: { type: 'canvass-activity', campaignId: String(ctx.c2._id) },
  });
  assert.strictEqual(unmanaged.status, 403);
  const adminOnly = await call('POST', '/admin/exports', {
    token: ctx.leadTok, orgId: ctx.org._id, body: { type: 'voter-notes', campaignId: String(ctx.c1._id) },
  });
  assert.strictEqual(adminOnly.status, 403, 'voter-notes is admin-only');
  const orgWide = await call('POST', '/admin/exports', {
    token: ctx.leadTok, orgId: ctx.org._id, body: { type: 'full-backup' },
  });
  assert.strictEqual(orgWide.status, 403, 'org-wide backup is admin-only');
});

test('POST: doc is created with the anchor tz frozen into params', { skip }, async () => {
  const r = await call('POST', '/admin/exports', {
    token: ctx.adminTok, orgId: ctx.org._id, body: { type: 'voter-file', campaignId: String(ctx.c1._id) },
  });
  assert.ok([201, 503].includes(r.status), `got ${r.status}`);
  const doc = await ExportJob.findOne({ organizationId: ctx.org._id, type: 'voter-file' }).sort({ createdAt: -1 }).lean();
  assert.ok(doc, 'ExportJob doc exists even when the enqueue 503s (marked failed)');
  assert.strictEqual(doc.params.anchorTz, 'America/Chicago', 'campaign tz frozen at POST');
});

test('POST: per-org active-job throttle 429s', { skip }, async () => {
  const stubs = await ExportJob.insertMany(
    [0, 1, 2].map(() => ({ organizationId: ctx.org._id, campaignId: ctx.c1._id, type: 'voter-file', status: 'pending' }))
  );
  const r = await call('POST', '/admin/exports', {
    token: ctx.adminTok, orgId: ctx.org._id, body: { type: 'voter-file', campaignId: String(ctx.c1._id) },
  });
  assert.strictEqual(r.status, 429);
  assert.strictEqual(r.json.code, 'export-throttled');
  await ExportJob.deleteMany({ _id: { $in: stubs.map((s) => s._id) } });
});

// ---- list / poll scoping ---------------------------------------------------------------

test('GET list: org isolation, lead scoping, admin sees org-wide rows', { skip }, async () => {
  await ExportJob.deleteMany({});
  await ExportJob.create({ organizationId: ctx.org._id, campaignId: ctx.c1._id, type: 'voter-file', status: 'pending' });
  await ExportJob.create({ organizationId: ctx.org._id, campaignId: ctx.c2._id, type: 'voter-file', status: 'pending' });
  await ExportJob.create({ organizationId: ctx.org._id, campaignId: null, type: 'full-backup', status: 'pending' });

  const admin = await call('GET', `/admin/exports?campaignId=${ctx.c1._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(admin.status, 200);
  assert.strictEqual(admin.json.jobs.length, 2, 'campaign rows PLUS the org-wide row');
  assert.ok(admin.json.jobs.every((j) => !j.audit?.subjectIds), 'subjectIds never ship on a list');

  const lead = await call('GET', '/admin/exports', { token: ctx.leadTok, orgId: ctx.org._id });
  assert.strictEqual(lead.status, 200);
  assert.strictEqual(lead.json.jobs.length, 1, 'lead sees only managed campaigns — never c2, never org-wide');
  assert.strictEqual(String(lead.json.jobs[0].campaignId), String(ctx.c1._id));
  const leadForbidden = await call('GET', `/admin/exports?campaignId=${ctx.c2._id}`, { token: ctx.leadTok, orgId: ctx.org._id });
  assert.strictEqual(leadForbidden.status, 403);

  const other = await call('GET', '/admin/exports', { token: ctx.admin2Tok, orgId: ctx.org2._id });
  assert.strictEqual(other.json.jobs.length, 0, 'org isolation');
});

test('GET /:id: cross-org 404, lead-unmanaged 403', { skip }, async () => {
  const job = await ExportJob.findOne({ campaignId: ctx.c2._id }).lean();
  const foreign = await call('GET', `/admin/exports/${job._id}`, { token: ctx.admin2Tok, orgId: ctx.org2._id });
  assert.strictEqual(foreign.status, 404);
  const lead = await call('GET', `/admin/exports/${job._id}`, { token: ctx.leadTok, orgId: ctx.org._id });
  assert.strictEqual(lead.status, 403);
});

// ---- processor + download + expiry + delete --------------------------------------------

test('processor: voter-file runs end to end — artifact, honest counters, DNC excluded', { skip }, async () => {
  await ExportJob.deleteMany({});
  const job = await ExportJob.create({
    organizationId: ctx.org._id, campaignId: ctx.c1._id, type: 'voter-file',
    params: { anchorTz: 'America/Chicago' }, requestedBy: ctx.admin._id,
  });
  await processExportJob(fakeQueueJob(job._id));
  const done = await ExportJob.findById(job._id).lean();
  assert.strictEqual(done.status, 'completed');
  assert.strictEqual(done.rowCount, 1, 'Alice only — Donna is DNC');
  assert.strictEqual(done.excludedDncCount, 1);
  assert.ok(done.bytes > 0);
  assert.ok(done.artifact.gridFsId, 'artifact stored');
  assert.match(done.artifact.filename, /^export-org-camp_one-voter-file-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.ok(done.expiresAt > new Date(), 'TTL stamped');
  assert.deepStrictEqual(done.files, [{ name: 'voterfile-current', rows: 1 }]);
  assert.strictEqual(done.audit.subjectsTotal, 1, 'subjects = ids actually written');
  ctx.doneJob = done;
});

test('download: streams the artifact with BOM + disposition; scoped like the job', { skip }, async () => {
  const r = await download(`/admin/exports/${ctx.doneJob._id}/download`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename=/);
  assert.ok(r.text.startsWith('\uFEFF'), 'UTF-8 BOM for Excel');
  assert.match(r.text, /Alice/);
  assert.doesNotMatch(r.text, /Donna|Dncerson|SVDNC1/, 'no DNC voter in any artifact');
  const foreign = await download(`/admin/exports/${ctx.doneJob._id}/download`, { token: ctx.admin2Tok, orgId: ctx.org2._id });
  assert.strictEqual(foreign.status, 404);
});

test('download: pending job 409s', { skip }, async () => {
  const pending = await ExportJob.create({ organizationId: ctx.org._id, campaignId: ctx.c1._id, type: 'voter-file', status: 'pending' });
  const r = await download(`/admin/exports/${pending._id}/download`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 409);
  await ExportJob.deleteOne({ _id: pending._id });
});

test('sweeper: expires past-TTL artifacts (history row survives), download 410s', { skip }, async () => {
  await ExportJob.updateOne({ _id: ctx.doneJob._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const res = await sweepExpiredExports();
  assert.strictEqual(res.expired, 1);
  const swept = await ExportJob.findById(ctx.doneJob._id).lean();
  assert.strictEqual(swept.status, 'expired');
  assert.strictEqual(swept.artifact.gridFsId, null);
  assert.strictEqual(swept.rowCount, 1, 'the history row keeps its accounting');
  const files = await mongoose.connection.db.collection('exportArtifacts.files')
    .countDocuments({ filename: String(ctx.doneJob._id) });
  assert.strictEqual(files, 0, 'artifact gone');
  const r = await download(`/admin/exports/${ctx.doneJob._id}/download`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 410);
  assert.strictEqual(JSON.parse(r.text).code, 'export-expired');
});

test('sweeper: cleans failed-job leftovers and orphan files', { skip }, async () => {
  // A failed job whose artifact survived (the import-path leak lesson).
  const failed = await ExportJob.create({
    organizationId: ctx.org._id, campaignId: ctx.c1._id, type: 'voter-file',
    status: 'failed', artifact: { gridFsId: new mongoose.Types.ObjectId(), filename: 'x.csv', contentType: 'text/csv' },
  });
  await new Promise((resolve, reject) => {
    const up = openArtifactUploadStream(failed._id, { filename: 'x.csv', contentType: 'text/csv', organizationId: ctx.org._id, campaignId: ctx.c1._id });
    up.on('error', reject); up.on('finish', resolve); up.end(Buffer.from('a\r\n'));
  });
  // An orphan with no ExportJob at all.
  const ghost = new mongoose.Types.ObjectId();
  await new Promise((resolve, reject) => {
    const up = openArtifactUploadStream(ghost, { filename: 'g.csv', contentType: 'text/csv', organizationId: ctx.org._id, campaignId: null });
    up.on('error', reject); up.on('finish', resolve); up.end(Buffer.from('b\r\n'));
  });
  const res = await sweepExpiredExports();
  assert.strictEqual(res.failedCleaned, 1);
  assert.strictEqual(res.orphans, 1);
  const left = await mongoose.connection.db.collection('exportArtifacts.files')
    .countDocuments({ filename: { $in: [String(failed._id), String(ghost)] } });
  assert.strictEqual(left, 0);
  await ExportJob.deleteOne({ _id: failed._id });
});

test('DELETE: running 409s; terminal deletes doc + artifact', { skip }, async () => {
  const running = await ExportJob.create({ organizationId: ctx.org._id, campaignId: ctx.c1._id, type: 'voter-file', status: 'running' });
  const blocked = await call('DELETE', `/admin/exports/${running._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(blocked.status, 409);
  await ExportJob.deleteOne({ _id: running._id });

  const doneJob = await ExportJob.create({ organizationId: ctx.org._id, campaignId: ctx.c1._id, type: 'voter-file', status: 'completed', expiresAt: new Date(Date.now() + 3600e3) });
  await new Promise((resolve, reject) => {
    const up = openArtifactUploadStream(doneJob._id, { filename: 'd.csv', contentType: 'text/csv', organizationId: ctx.org._id, campaignId: ctx.c1._id });
    up.on('error', reject); up.on('finish', resolve); up.end(Buffer.from('c\r\n'));
  });
  const r = await call('DELETE', `/admin/exports/${doneJob._id}`, { token: ctx.adminTok, orgId: ctx.org._id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await ExportJob.countDocuments({ _id: doneJob._id }), 0);
  const files = await mongoose.connection.db.collection('exportArtifacts.files')
    .countDocuments({ filename: String(doneJob._id) });
  assert.strictEqual(files, 0, 'artifact purged with the job');
});

// ---- scheduler placement ---------------------------------------------------------------

test('sweep job is in MAINTENANCE_JOBS and NOT in the pinned retention list', { skip: false }, () => {
  assert.ok(MAINTENANCE_JOBS.some((j) => j.name === EXPORT_SWEEP_JOB), 'registered as maintenance');
  // REPEATABLE_JOBS is retention-promise-only and its count is pinned by the health surface
  // (supportAccess.int.test.js) — an export sweep going quiet must never read
  // "Retention: NOT ENFORCED".
  assert.ok(!REPEATABLE_JOBS.some((j) => j.name === EXPORT_SWEEP_JOB), 'never in REPEATABLE_JOBS');
});
