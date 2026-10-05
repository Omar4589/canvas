import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The map-pin pass's bookkeeping that organizations never see, over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/orgimportfields node --test test/orgImportFields.int.test.js
//
// The address cache is shared across customers, so how many of an import's homes were bought vs
// served from cache, and the ledger of probed ids, would tell an organization which addresses
// someone else's import had already looked up; the full pass cause is for super-admins
// (docs/PROPOSAL_PLACEHOLDER_PINS.md §O, ORG_HIDDEN_IMPORT_FIELDS in routes/admin/imports.js).
// Proves: the org list, detail and cancel reads omit pinProbedIds, pinLookupsNew, pinLookupsCached,
// pinLookupsOverCap and pinPassCause while keeping the outcome counts and the generic sentence;
// the super-admin list keeps the lookups and the cause, never the ledger.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-org-import-fields';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const HIDDEN = ['pinProbedIds', 'pinLookupsNew', 'pinLookupsCached', 'pinLookupsOverCap', 'pinPassCause'];
const FAILED = "Map pins weren't checked this time. Import the file again to try again.";

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, ImportJob, Subscription]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Fields Org', slug: 'fields-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'oif@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const superU = await User.create({
    firstName: 'Sue', lastName: 'Super', email: 'oif-super@doorline.app', passwordHash: 'x', isActive: true, isSuperAdmin: true,
  });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Nye', type: 'survey', state: 'NV', isActive: true });
  const job = await ImportJob.create({
    organizationId: org._id,
    campaignId: camp._id,
    uploadedBy: admin._id,
    kind: 'apply',
    status: 'completed',
    filename: 'nye.csv',
    uniqueHouseholds: 500,
    pinsPlacedExact: 412,
    pinsConfirmedInPlace: 9,
    pinsStillUnplaced: 60,
    pinLookupsNew: 300,
    pinLookupsCached: 181,
    pinLookupsOverCap: 2,
    pinProbedIds: ['6a0000000000000000000001', '6a0000000000000000000002'],
    pinPassError: FAILED,
    pinPassCause: 'HTTP 401',
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, job, adminTok: signUserToken(admin), superTok: signUserToken(superU) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (method, path, token, orgId) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(orgId ? { 'X-Org-Id': String(orgId) } : {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const assertOrgShape = (job, where) => {
  for (const f of HIDDEN) assert.equal(f in job, false, `${where} leaks ${f}`);
  assert.equal(job.pinsPlacedExact, 412, `${where} keeps the outcome counts`);
  assert.equal(job.pinsConfirmedInPlace, 9);
  assert.equal(job.pinsStillUnplaced, 60);
  assert.equal(job.pinPassError, FAILED, `${where} keeps the generic sentence`);
};

test('the org import list omits the lookup bookkeeping and the cause', { skip }, async () => {
  const res = await call('GET', '/admin/imports', ctx.adminTok, ctx.org._id);
  assert.equal(res.status, 200);
  assert.equal(res.body.jobs.length, 1);
  assertOrgShape(res.body.jobs[0], 'list');
});

test('the org import detail omits them too', { skip }, async () => {
  const res = await call('GET', `/admin/imports/${ctx.job._id}`, ctx.adminTok, ctx.org._id);
  assert.equal(res.status, 200);
  assertOrgShape(res.body.job, 'detail');
});

test('cancel on a finished import answers with the same shape', { skip }, async () => {
  const res = await call('POST', `/admin/imports/${ctx.job._id}/cancel`, ctx.adminTok, ctx.org._id);
  assert.equal(res.status, 200);
  assertOrgShape(res.body.job, 'cancel');
});

test('the super-admin list keeps the lookups and the cause, never the ledger', { skip }, async () => {
  const res = await call('GET', '/super-admin/imports', ctx.superTok);
  assert.equal(res.status, 200);
  const row = res.body.imports.find((r) => String(r.id) === String(ctx.job._id));
  assert.ok(row, 'the import is listed');
  assert.equal(row.pinLookupsNew, 300);
  assert.equal(row.pinLookupsCached, 181);
  assert.equal(row.pinLookupsOverCap, 2);
  assert.equal(row.pinPassCause, 'HTTP 401');
  assert.equal('pinProbedIds' in row, false);
});
