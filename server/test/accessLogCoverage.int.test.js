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

const { classifyResource, isAuditExempt, capSubjects, SUBJECT_CAP } = await import('../src/services/access/supportAccess.js');
const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { AccessLog } = await import('../src/models/AccessLog.js');
// ALL dynamic imports live up here, before any test() is defined: an `await import` BETWEEN test
// definitions lets already-defined tests start running while the file is still loading, and a
// fast early finish then force-exits the runner mid-load, cancelling the not-yet-defined tests
// (observed as a flaky "3 tests, all failed" run).
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { Person } = await import('../src/models/Person.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');

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

// ONE before hook on purpose. A failed hook does NOT stop later hooks from running, so a
// second hook depending on state this one builds turns any transient failure here (e.g. a
// mongod still warming up) into a misleading TypeError from the second hook instead of the
// real error. Everything sequential, one hook, one failure story.
before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Subscription, SupportAccessGrant, AccessLog,
    Membership, Campaign, Household, Voter, Person, SavedSearch,
  ]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Coverage Co', slug: 'coverage', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const support = await User.create({
    firstName: 'Sam', lastName: 'Support', email: 'support@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'support',
  });
  Object.assign(ctx, { org, support: { token: signUserToken(support), orgId: org._id, _id: support._id } });

  // Record-level fixtures (the tests added 2026-07-19): a campaign with one door, two voters,
  // a person, a frozen walk list, a member admin + canvasser in-org, a break-glass staffer,
  // and a second org for the isolation case.
  const camp = await Campaign.create({ organizationId: org._id, name: 'Cov Camp', type: 'survey', state: 'FL', isActive: true });
  const hh = await Household.create({
    organizationId: org._id, campaignId: camp._id,
    addressLine1: '1 Audit Way', city: 'T', state: 'FL', zipCode: '1',
    normalizedAddress: '1 AUDIT WAY|coverage',
    location: { type: 'Point', coordinates: [-81, 28] },
  });
  const voter = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: 'SV-AUDIT-1',
    firstName: 'Vera', lastName: 'Subject', fullName: 'Vera Subject',
  });
  const voter2 = await Voter.create({
    organizationId: org._id, campaignId: camp._id, householdId: hh._id, stateVoterId: 'SV-AUDIT-2',
    firstName: 'Vic', lastName: 'Second', fullName: 'Vic Second',
  });
  const person = await Person.create({
    organizationId: org._id, firstName: 'Pera', lastName: 'Identity', fullName: 'Pera Identity',
  });
  const walklist = await SavedSearch.create({
    organizationId: org._id, campaignId: camp._id, name: 'Audit WL',
    voterIds: [voter._id, voter2._id], householdIds: [hh._id],
  });
  const memberAdmin = await User.create({
    firstName: 'Mia', lastName: 'Member', email: 'mia.member@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: memberAdmin._id, organizationId: org._id, role: 'admin', isActive: true });
  const walker = await User.create({
    firstName: 'Wal', lastName: 'Walker', email: 'wal.cov@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: walker._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const breakGlass = await User.create({
    firstName: 'Bree', lastName: 'Glass', email: 'bg@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'break_glass',
  });
  const org2 = await Organization.create({ name: 'Other Co', slug: 'other-cov', isActive: true });
  const admin2 = await User.create({
    firstName: 'Ann', lastName: 'Other', email: 'ann.other@t.co', passwordHash: 'x', isActive: true,
  });
  await Membership.create({ userId: admin2._id, organizationId: org2._id, role: 'admin', isActive: true });

  Object.assign(ctx, {
    camp, hh, voter, voter2, person, walklist,
    member: { token: signUserToken(memberAdmin), orgId: org._id },
    walker: { token: signUserToken(walker), orgId: org._id },
    bg: { token: signUserToken(breakGlass), orgId: org._id, _id: breakGlass._id },
    other: { token: signUserToken(admin2), orgId: org2._id },
  });

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

// ── RECORD-LEVEL SUBJECTS ("was MY record accessed?") — added 2026-07-19 ─────────────────────
// Single-record opens and exports tag WHICH records a vendor request touched; list browses stay
// request-level. These tests pin the whole contract: tagging, the honest-scope negative (members
// still never logged), the subjectId lookup, and the customer-facing voter panel endpoint.

async function pollLogs(filter, want = 1) {
  let logs = [];
  for (const deadline = Date.now() + 3000; Date.now() < deadline; ) {
    logs = await AccessLog.find(filter).lean();
    if (logs.length >= want) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return logs;
}

async function grantFor(actorToken) {
  const r = await call('POST', '/super-admin/access/grants', {
    token: actorToken,
    body: { organizationId: String(ctx.org._id), reason: 'Record-level audit test (ticket 5).' },
  });
  assert.strictEqual(r.status, 201);
}

test('RECORD-LEVEL: a vendor voter-profile read carries the voter as its subject', { skip }, async () => {
  await grantFor(ctx.support.token);
  const read = await call('GET', `/admin/voters/${ctx.voter._id}`, ctx.support);
  assert.ok(read.status < 400, `expected a successful read, got ${read.status}`);

  const logs = await pollLogs({ organizationId: ctx.org._id, 'subjects.id': ctx.voter._id });
  assert.strictEqual(logs.length, 1, 'the profile read row carries the voter subject');
  assert.deepStrictEqual(
    logs[0].subjects.map((s) => `${s.type}:${s.id}`),
    [`voter:${ctx.voter._id}`]
  );
  assert.strictEqual(logs[0].subjectsTruncated, false);
});

test('RECORD-LEVEL: a vendor walk-list export logs exactly the voters written to the file', { skip }, async () => {
  await grantFor(ctx.support.token);
  const csv = await call('GET', `/admin/campaigns/${ctx.camp._id}/walklists/${ctx.walklist._id}/export.csv`, ctx.support);
  assert.ok(csv.status < 400, `expected a successful export, got ${csv.status}`);

  const logs = await pollLogs({ organizationId: ctx.org._id, resource: 'walklists' });
  assert.strictEqual(logs.length, 1);
  const ids = new Set((logs[0].subjects || []).map((s) => String(s.id)));
  assert.ok(ids.has(String(ctx.voter._id)) && ids.has(String(ctx.voter2._id)), 'both exported voters are subjects');
  assert.strictEqual(logs[0].subjects.every((s) => s.type === 'voter'), true);
  assert.strictEqual(logs[0].subjectsTruncated, false);
});

test('HONEST SCOPE: a MEMBER admin reading the same profile and export logs NOTHING', { skip }, async () => {
  const read = await call('GET', `/admin/voters/${ctx.voter._id}`, ctx.member);
  assert.strictEqual(read.status, 200);
  const csv = await call('GET', `/admin/campaigns/${ctx.camp._id}/walklists/${ctx.walklist._id}/export.csv`, ctx.member);
  assert.ok(csv.status < 400);
  await new Promise((r) => setTimeout(r, 400)); // give a wrong write time to land
  assert.strictEqual(await AccessLog.countDocuments({}), 0, 'member access is never vendor access');
});

test('RECORD-LEVEL: the turf-cutting door drill carries the household as its subject', { skip }, async () => {
  // The turfs router (admin + campaign-managing leads) has its own single-record open returning
  // voter names — GET .../turfs/household/:householdId — and originally had no router.param hook,
  // so it opened a door without recording WHICH door. Same pattern as /admin/households now.
  await grantFor(ctx.support.token);
  const read = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs/household/${ctx.hh._id}`, ctx.support);
  assert.ok(read.status < 400, `expected a successful door read, got ${read.status}`);

  const logs = await pollLogs({ organizationId: ctx.org._id, 'subjects.id': ctx.hh._id });
  assert.strictEqual(logs.length, 1, 'the door-drill row carries the household subject');
  assert.deepStrictEqual(
    logs[0].subjects.map((s) => `${s.type}:${s.id}`),
    [`household:${ctx.hh._id}`]
  );
});

test('RECORD-LEVEL: the person console read carries the person subject (direct recordAccess path)', { skip }, async () => {
  await grantFor(ctx.bg.token);
  const read = await call('GET', `/super-admin/persons/${ctx.person._id}`, { token: ctx.bg.token });
  assert.ok(read.status < 400, `expected a successful person read, got ${read.status}`);

  const logs = await pollLogs({ organizationId: ctx.org._id, 'subjects.id': ctx.person._id });
  assert.strictEqual(logs.length, 1, 'the person-console read row carries the person subject');
  assert.strictEqual(logs[0].subjects[0].type, 'person');
});

test('LOOKUP: /super-admin/access/log?subjectId returns exactly the rows that touched the record', { skip }, async () => {
  await grantFor(ctx.support.token);
  await call('GET', `/admin/voters/${ctx.voter._id}`, ctx.support); // touches voter
  await call('GET', '/admin/imports', ctx.support); // request-level row, no subjects
  await pollLogs({ organizationId: ctx.org._id }, 2);

  const filtered = await call('GET', `/super-admin/access/log?subjectId=${ctx.voter._id}`, { token: ctx.support.token });
  assert.strictEqual(filtered.status, 200);
  assert.strictEqual(filtered.json.entries.length, 1, 'only the row that touched this record');
  assert.strictEqual(filtered.json.entries[0].subjectCount, 1);
  assert.strictEqual(filtered.json.entries[0].subjects[0].id, String(ctx.voter._id));

  const all = await call('GET', '/super-admin/access/log', { token: ctx.support.token });
  assert.ok(all.json.entries.length >= 2, 'unfiltered log still shows both rows');
});

test('CUSTOMER-FACING: the voter staff-access panel answers from the org side, first-name-only', { skip }, async () => {
  await grantFor(ctx.support.token);
  await call('GET', `/admin/voters/${ctx.voter._id}`, ctx.support); // a direct open
  await call('GET', `/admin/campaigns/${ctx.camp._id}/walklists/${ctx.walklist._id}/export.csv`, ctx.support); // an export sweep
  await pollLogs({ organizationId: ctx.org._id }, 2);

  const panel = await call('GET', `/admin/voters/${ctx.voter._id}/staff-access`, ctx.member);
  assert.strictEqual(panel.status, 200);
  assert.strictEqual(panel.json.count, 2, 'both the direct open and the export touched this record');
  for (const e of panel.json.entries) {
    assert.strictEqual(e.staffFirstName, 'Sam', 'first name only');
    assert.ok(e.reason, 'the grant reason is shown');
    assert.ok(!JSON.stringify(e).includes('support@doorline.app'), 'never the staff email');
  }
  assert.deepStrictEqual(
    panel.json.entries.map((e) => e.export).sort(),
    [false, true],
    'the export entry is marked as an export; the direct open is not'
  );

  // The untouched voter reads clean — "never accessed" is a real answer, not a default.
  const clean = await call('GET', `/admin/voters/${ctx.voter2._id}/staff-access`, ctx.member);
  assert.strictEqual(clean.json.count, 1, 'voter2 was only touched by the export');
  assert.strictEqual(clean.json.entries[0].export, true);

  // Org isolation + role gate.
  const cross = await call('GET', `/admin/voters/${ctx.voter._id}/staff-access`, ctx.other);
  assert.strictEqual(cross.status, 404, 'another org cannot see this voter at all');
  const walker = await call('GET', `/admin/voters/${ctx.voter._id}/staff-access`, ctx.walker);
  assert.strictEqual(walker.status, 403, 'canvassers have no admin surface');
});

// Pure unit — the cap can never quietly claim completeness.
test('capSubjects: over-cap lists truncate with an honest total', () => {
  const list = Array.from({ length: SUBJECT_CAP + 5 }, (_, i) => ({ type: 'voter', id: String(i) }));
  const capped = capSubjects(list);
  assert.strictEqual(capped.subjects.length, SUBJECT_CAP);
  assert.strictEqual(capped.subjectsTruncated, true);
  assert.strictEqual(capped.subjectsTotal, SUBJECT_CAP + 5);
  const small = capSubjects(list.slice(0, 3));
  assert.strictEqual(small.subjects.length, 3);
  assert.strictEqual(small.subjectsTruncated, undefined);
});
