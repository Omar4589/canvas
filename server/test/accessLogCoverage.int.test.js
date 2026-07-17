import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// STRUCTURAL audit-coverage test. The vendor access log has silently under-recorded three times now:
// once the mount prefix was wrong (req.path vs originalUrl), once three of ten content prefixes were
// dead strings that could never match a real route (so the walk-list CSV export of names/addresses/
// phones logged NOTHING), and the design that produced both was "log only paths that look like content."
//
// The fix is fail-closed: a vendor (support-grant) request to ANY /admin or /mobile route is logged
// unless it is on a short, explicit metadata allowlist. This test guards that property two ways:
//   1. BEHAVIORAL — a real vendor request to a route that was NEVER on the old content list
//      (/admin/imports) now produces an AccessLog row. If someone reverts to an allowlist, this fails.
//   2. STRUCTURAL — the classifier treats known voter-data URL shapes as loggable and only the known
//      metadata shapes as exempt. If someone exempts a content route, this fails.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-accesslog';

const { classifyResource, isAuditExempt } = await import('../src/services/access/supportAccess.js');
const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { AccessLog } = await import('../src/models/AccessLog.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Subscription, SupportAccessGrant, AccessLog]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Coverage Co', slug: 'coverage', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const support = await User.create({
    firstName: 'Sam', lastName: 'Support', email: 'support@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'support',
  });
  Object.assign(ctx, { org, support: { token: signUserToken(support), orgId: org._id, _id: support._id } });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

beforeEach(async () => {
  if (!URI) return;
  for (const M of [SupportAccessGrant, AccessLog]) await M.deleteMany({});
});

test('BEHAVIORAL: a vendor read of /admin/imports — never on the old content list — is now logged', { skip }, async () => {
  const grant = await call('POST', '/super-admin/access/grants', {
    token: ctx.support.token,
    body: { organizationId: String(ctx.org._id), reason: 'Investigating an import that stalled (ticket 9).' },
  });
  assert.strictEqual(grant.status, 201);

  // /admin/imports returns the org's import history. Under the OLD allowlist this route was absent, so a
  // staffer could read it with no audit row. Fail-closed means it logs now.
  const read = await call('GET', '/admin/imports', ctx.support);
  assert.ok(read.status < 400, `expected a successful read, got ${read.status}`);

  // recordAccess is fire-and-forget from the res 'finish' listener (an audit write must never
  // block the request it audits), so the row is EVENTUALLY visible — not synchronously with the
  // response. Poll briefly instead of asserting an instant read; under full-suite load the write
  // can land a few ms after the HTTP call returns.
  let logs = [];
  for (const deadline = Date.now() + 3000; Date.now() < deadline; ) {
    logs = await AccessLog.find({ organizationId: ctx.org._id }).lean();
    if (logs.length) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.strictEqual(logs.length, 1, 'the import-history read must produce exactly one audit row');
  assert.strictEqual(String(logs[0].actorUserId), String(ctx.support._id));
  assert.strictEqual(logs[0].resource, 'imports');
  // Magnitude capture: the res wraps count the payload as it leaves, so every logged row carries
  // how MUCH was read — a peek and a bulk export must no longer look identical in the audit trail.
  assert.ok(typeof logs[0].bytes === 'number' && logs[0].bytes > 0, 'the row must carry the payload size');
  assert.ok(logs[0].rows === null || typeof logs[0].rows === 'number', 'rows is a count or null (unknown)');
});

// No DB needed — pure classifier assertions, so this runs in CI even without a throwaway mongod.
test('STRUCTURAL: every known voter-data URL shape is loggable; only metadata is exempt', () => {
  const C = '652f000000000000000000aa'; // a stand-in campaign id
  const W = '652f000000000000000000bb'; // a stand-in walklist id

  // These are the routes that hand back names, addresses, phones, GPS or survey answers. Each MUST be
  // logged for a vendor — none may be audit-exempt. The walk-list CSV export is the one the dead-prefix
  // bug actually silenced; it leads the list on purpose.
  const MUST_LOG = [
    [`/admin/campaigns/${C}/walklists/${W}/export.csv`, 'walklists'],
    [`/admin/campaigns/${C}/walklists`, 'walklists'],
    [`/admin/campaigns/${C}/households`, 'map'],
    [`/admin/campaigns/${C}/voted`, 'voted'],
    ['/admin/imports', 'imports'],
    ['/admin/voters', 'voters'],
    ['/admin/households', 'map'],
    ['/admin/reports', 'reports'],
    ['/admin/activities', 'activity'],
    ['/admin/surveys', 'surveys'],
    ['/admin/client-reports', 'client-reports'],
    [`/admin/campaigns/${C}/turfs`, 'turf'],
    ['/mobile/bootstrap', 'mobile'],
  ];
  for (const [path, label] of MUST_LOG) {
    assert.strictEqual(isAuditExempt(path), false, `${path} must NOT be audit-exempt — it returns voter content`);
    assert.strictEqual(classifyResource(path), label, `${path} should classify as ${label}`);
  }

  // The only routes a vendor may touch unlogged: pure metadata. If a content route ever lands here, the
  // audit trail goes silent for it — which is the whole failure class this test exists to prevent.
  const EXEMPT = [
    '/admin/config',
    '/admin/config/flags',
    `/admin/campaigns/${C}/setup-status`,
    `/admin/campaigns/${C}/passes`,
  ];
  for (const path of EXEMPT) {
    assert.strictEqual(isAuditExempt(path), true, `${path} is metadata and is expected to be exempt`);
  }

  // Fail-closed backstop: an UNRECOGNIZED /admin route is still logged (classified 'other'), not skipped.
  assert.strictEqual(isAuditExempt('/admin/some-future-voter-surface'), false);
  assert.strictEqual(classifyResource('/admin/some-future-voter-surface'), 'other');
});
