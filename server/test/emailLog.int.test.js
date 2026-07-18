import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The metadata-only transactional-email LOG (models/EmailLog.js), written fire-and-forget from the
// sendMail chokepoint (services/mail/mailer.js) and read by the super-admin Emails page
// (routes/superAdmin/emails.js), exercised over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/emaillog_test node --test test/emailLog.int.test.js
//
// The log write is fire-and-forget (recordEmail's EmailLog.create is never awaited by the caller and
// NEVER throws), so — exactly like test/mailTriggers.int.test.js polls the outbox — every case here
// POLLS the EmailLog collection for the expected row(s) rather than reading synchronously after the
// call/fetch. The mailer is DORMANT by default (no RESEND_API_KEY / MAIL_FROM), so ordinary sends log
// outcome 'dormant'; case 3 flips on the TEST transport to exercise 'sent'/'failed' and resets to
// dormant after (every other case depends on dormant).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-emaillog';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { EmailLog } = await import('../src/models/EmailLog.js');
const { sendMail, clearOutbox } = await import('../src/services/mail/mailer.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const DAY_MS = 86_400_000;

let server;
let base;
const ctx = {}; // { org, adminTok, superTok }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll a (sync or async) predicate — the log write lands a few ms after the call/fetch returns.
// ~50ms × 40 ≈ 2s ceiling, the same shape as the outbox pollers in the sibling mail suites.
async function waitFor(pred, { timeout = 2000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await pred()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(interval);
  }
}

// Poll until at least `n` rows match `filter`; returns the matching rows (newest-first).
async function waitForRows(filter, n, opts) {
  let rows = [];
  const ok = await waitFor(async () => {
    rows = await EmailLog.find(filter).sort({ sentAt: -1 }).lean();
    return rows.length >= n;
  }, opts);
  return { ok, rows };
}

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
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, EmailLog]) {
    await M.deleteMany({});
  }

  // Fixture org with an active subscription + an org admin (case 4 drives a real trigger through it;
  // case 7 uses the same admin as the non-super role-gate probe).
  const org = await Organization.create({ name: 'EmailLog Org', slug: 'emaillog-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active', statusChangedAt: new Date() });
  const admin = await User.create({
    firstName: 'Amy', lastName: 'Admin', email: 'amy.admin@el.co',
    passwordHash: await User.hashPassword('AdminPass!23'), isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const superU = await User.create({
    firstName: 'Sam', lastName: 'Staff', email: 'sam.staff@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'break_glass',
  });

  Object.assign(ctx, { org, adminTok: signUserToken(admin), superTok: signUserToken(superU) });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// Only EmailLog is wiped between cases — the org/admin/super fixtures created in `before` must survive.
// Defensively clear the mail-transport env each case so a failure mid-case-3 can't strand the process
// in test-transport (every other case assumes DORMANT).
beforeEach(async () => {
  clearOutbox();
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  if (URI) await EmailLog.deleteMany({});
});

// 1) A dormant send logs one row: outcome 'dormant', the metadata is copied verbatim, and expiresAt is
//    stamped sentAt + 365d (the ordinary-kind TTL horizon).
test('dormant sendMail logs one row with dormant outcome and a ~365d expiresAt', { skip }, async () => {
  const u = await User.create({ firstName: 'Dee', lastName: 'Ormant', email: 'dee@el.co', passwordHash: 'x', isActive: true });

  const ret = await sendMail({ to: 'a@t.co', subject: 'S', html: '<p>x</p>', text: 'x', kind: 'passwordReset', meta: { userId: u._id } });
  assert.deepStrictEqual(ret, { sent: false, disabled: true }, 'dormant send returns the disabled contract');

  const { ok, rows } = await waitForRows({}, 1);
  assert.ok(ok, `expected exactly one EmailLog row, saw ${rows.length}`);
  assert.strictEqual(rows.length, 1, 'exactly one row');
  const r = rows[0];
  assert.strictEqual(r.outcome, 'dormant');
  assert.strictEqual(r.kind, 'passwordReset');
  assert.deepStrictEqual(r.to, ['a@t.co']);
  assert.strictEqual(r.subject, 'S');
  assert.strictEqual(String(r.userId), String(u._id), 'the userId from meta is attributed');
  assert.strictEqual(r.organizationId, null, 'no org attribution was passed');
  assert.strictEqual(r.error, null);

  assert.ok(r.expiresAt instanceof Date, 'expiresAt is a real Date for an ordinary kind');
  const expected = r.sentAt.getTime() + 365 * DAY_MS;
  assert.ok(Math.abs(r.expiresAt.getTime() - expected) < 60_000, 'expiresAt ≈ sentAt + 365d (within a minute)');
});

// 2) The two deletion-warning kinds are kept forever — expiresAt is left NULL so the TTL never ages the
//    "we warned org X" evidence out.
test('windDownWarning and dormancyWarning rows are kept forever (expiresAt null)', { skip }, async () => {
  const meta = { organizationId: ctx.org._id };
  await sendMail({ to: 'w@t.co', subject: 'Wind down', html: '<p>w</p>', text: 'w', kind: 'windDownWarning', meta });
  await sendMail({ to: 'd@t.co', subject: 'Dormant', html: '<p>d</p>', text: 'd', kind: 'dormancyWarning', meta });

  const { ok, rows } = await waitForRows({}, 2);
  assert.ok(ok, `expected two rows, saw ${rows.length}`);
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
  assert.strictEqual(byKind.windDownWarning.expiresAt, null, 'windDownWarning is kept forever');
  assert.strictEqual(byKind.dormancyWarning.expiresAt, null, 'dormancyWarning is kept forever');
  // Attribution still recorded on the evidence rows.
  assert.strictEqual(String(byKind.windDownWarning.organizationId), String(ctx.org._id));
});

// 3) The TEST transport (RESEND_API_KEY=test:accept/reject + MAIL_FROM set) records the honest outcome:
//    'sent' on accept, 'failed' (with the error string) on reject. Env is reset to dormant after.
test('test transport records sent on accept and failed+error on reject', { skip }, async () => {
  try {
    process.env.MAIL_FROM = 'Doorline <t@doorline.test>';

    process.env.RESEND_API_KEY = 'test:accept';
    const accepted = await sendMail({ to: 'ok@t.co', subject: 'Accepted', html: '<p>a</p>', text: 'a', kind: 'passwordReset' });
    assert.deepStrictEqual(accepted, { sent: true }, 'accept emulates a Resend 2xx');
    const acc = await waitForRows({ outcome: 'sent' }, 1);
    assert.ok(acc.ok, 'the accepted send is logged as sent');
    assert.strictEqual(acc.rows[0].kind, 'passwordReset');
    assert.strictEqual(acc.rows[0].error, null, 'a sent row carries no error');

    process.env.RESEND_API_KEY = 'test:reject';
    const rejected = await sendMail({ to: 'no@t.co', subject: 'Rejected', html: '<p>r</p>', text: 'r', kind: 'passwordReset' });
    assert.strictEqual(rejected.sent, false, 'reject emulates a failed send');
    const rej = await waitForRows({ outcome: 'failed' }, 1);
    assert.ok(rej.ok, 'the rejected send is logged as failed');
    assert.strictEqual(rej.rows[0].error, 'test transport: rejected', 'the failure carries the error string');
  } finally {
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
  }
});

// 4) A real trigger through the HTTP app (admin adds a brand-new member → inviteSetPassword) writes an
//    ATTRIBUTED row: both organizationId and userId set, outcome 'dormant' (mailer is dormant).
test('a real trigger (memberships POST) writes an attributed inviteSetPassword row', { skip }, async () => {
  const res = await call('POST', '/admin/memberships', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { email: 'new.hire@el.co', firstName: 'New', lastName: 'Hire', password: 'TempPass!23' },
  });
  assert.strictEqual(res.status, 201);

  const { ok, rows } = await waitForRows({ kind: 'inviteSetPassword' }, 1);
  assert.ok(ok, `expected one inviteSetPassword row, saw ${rows.length}`);
  const r = rows[0];
  assert.strictEqual(r.outcome, 'dormant');
  assert.deepStrictEqual(r.to, ['new.hire@el.co']);
  assert.strictEqual(String(r.organizationId), String(ctx.org._id), 'org attribution set');
  assert.ok(r.userId, 'user attribution set');
});

// 5) The list route: newest-first ordering, correct total, and the kind/outcome/organizationId filters,
//    last24h buckets, kinds list, and per-row keptForever flag are all computed off the real rows.
test('GET /super-admin/emails: ordering, total, filters, last24h, kinds, keptForever', { skip }, async () => {
  const orgA = await Organization.create({ name: 'Filter Org A', slug: 'filter-a', isActive: true });
  const orgB = await Organization.create({ name: 'Filter Org B', slug: 'filter-b', isActive: true });
  const now = Date.now();
  const inYear = new Date(now + 365 * DAY_MS);

  // subject doubles as a stable marker; sentAt controls both ordering and the 24h window.
  await EmailLog.create([
    { kind: 'passwordReset', outcome: 'sent', subject: 'r1', organizationId: null, sentAt: new Date(now), expiresAt: inYear },
    { kind: 'inviteSetPassword', outcome: 'failed', subject: 'r2', error: 'boom', organizationId: orgA._id, sentAt: new Date(now - 1 * 3_600_000), expiresAt: inYear },
    { kind: 'windDownWarning', outcome: 'sent', subject: 'r3', organizationId: orgA._id, sentAt: new Date(now - 2 * 3_600_000), expiresAt: null },
    { kind: 'passwordReset', outcome: 'failed', subject: 'r5', organizationId: orgB._id, sentAt: new Date(now - 30 * 3_600_000), expiresAt: inYear },
    { kind: 'dormancyWarning', outcome: 'dormant', subject: 'r4', organizationId: orgB._id, sentAt: new Date(now - 48 * 3_600_000), expiresAt: null },
  ]);

  // Unfiltered: total 5, newest-first, kinds distinct, last24h buckets, keptForever exactly on nulls.
  const all = await call('GET', '/super-admin/emails', { token: ctx.superTok });
  assert.strictEqual(all.status, 200);
  assert.strictEqual(all.json.total, 5, 'total counts every row');
  assert.strictEqual(all.json.emails.length, 5);
  const order = all.json.emails.map((e) => e.subject);
  assert.deepStrictEqual(order, ['r1', 'r2', 'r3', 'r5', 'r4'], 'rows come back newest-first by sentAt');
  for (let i = 1; i < all.json.emails.length; i++) {
    assert.ok(new Date(all.json.emails[i - 1].sentAt) >= new Date(all.json.emails[i].sentAt), 'sentAt is monotonically non-increasing');
  }
  assert.deepStrictEqual(all.json.kinds, ['dormancyWarning', 'inviteSetPassword', 'passwordReset', 'windDownWarning'], 'distinct kinds, sorted');
  assert.deepStrictEqual(all.json.last24h, { sent: 2, failed: 1 }, 'last24h counts only <24h sent/failed rows (r1+r3 sent, r2 failed)');
  const kept = all.json.emails.filter((e) => e.keptForever).map((e) => e.subject).sort();
  assert.deepStrictEqual(kept, ['r3', 'r4'], 'keptForever true exactly on the null-expiresAt rows');
  // The failed row surfaces its error and its org populates to {id,name,slug}.
  const r2 = all.json.emails.find((e) => e.subject === 'r2');
  assert.strictEqual(r2.error, 'boom');
  assert.strictEqual(r2.organization.name, 'Filter Org A');
  assert.strictEqual(r2.organization.slug, 'filter-a');

  // ?outcome=failed → r2, r5.
  const failed = await call('GET', '/super-admin/emails?outcome=failed', { token: ctx.superTok });
  assert.strictEqual(failed.json.total, 2);
  assert.deepStrictEqual(failed.json.emails.map((e) => e.subject).sort(), ['r2', 'r5']);

  // ?kind=windDownWarning → r3.
  const kind = await call('GET', '/super-admin/emails?kind=windDownWarning', { token: ctx.superTok });
  assert.strictEqual(kind.json.total, 1);
  assert.strictEqual(kind.json.emails[0].subject, 'r3');

  // ?organizationId=orgA → r2, r3.
  const byOrg = await call('GET', `/super-admin/emails?organizationId=${orgA._id}`, { token: ctx.superTok });
  assert.strictEqual(byOrg.json.total, 2);
  assert.deepStrictEqual(byOrg.json.emails.map((e) => e.subject).sort(), ['r2', 'r3']);
});

// 6) Paging: 62 rows → default page is 50 (total 62); skip past them returns the remaining 12.
test('GET /super-admin/emails: default limit 50 with correct total, skip returns the rest', { skip }, async () => {
  const now = Date.now();
  const inYear = new Date(now + 365 * DAY_MS);
  const docs = [];
  for (let i = 0; i < 62; i++) {
    docs.push({ kind: 'passwordReset', outcome: 'sent', subject: `p${i}`, sentAt: new Date(now - i * 1000), expiresAt: inYear });
  }
  await EmailLog.insertMany(docs);

  const first = await call('GET', '/super-admin/emails', { token: ctx.superTok });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.json.total, 62, 'total reflects every row, not the page size');
  assert.strictEqual(first.json.emails.length, 50, 'default page is 50');

  const rest = await call('GET', '/super-admin/emails?skip=50', { token: ctx.superTok });
  assert.strictEqual(rest.json.total, 62);
  assert.strictEqual(rest.json.emails.length, 12, 'skip=50 returns the remaining 12');
});

// 7) Role gate: the log spans every org, so it is super-admin only. An org admin is 403; no token is 401.
test('GET /super-admin/emails is super-admin only (403 for org admin, 401 for anon)', { skip }, async () => {
  const asAdmin = await call('GET', '/super-admin/emails', { token: ctx.adminTok });
  assert.strictEqual(asAdmin.status, 403, 'a non-super org admin is forbidden');

  const anon = await call('GET', '/super-admin/emails', {});
  assert.strictEqual(anon.status, 401, 'no token is unauthenticated');
});

// 8) /orgs helper: returns exactly the orgs referenced by current rows (name+slug), never a null org and
//    never an org with no rows.
test('GET /super-admin/emails/orgs returns exactly the referenced orgs, no nulls', { skip }, async () => {
  const orgX = await Organization.create({ name: 'Xavier Org', slug: 'xavier-org', isActive: true });
  const orgY = await Organization.create({ name: 'Yolanda Org', slug: 'yolanda-org', isActive: true });
  await Organization.create({ name: 'Zed Org', slug: 'zed-org', isActive: true }); // referenced by NO row
  const now = Date.now();
  const inYear = new Date(now + 365 * DAY_MS);
  await EmailLog.create([
    { kind: 'passwordReset', outcome: 'sent', subject: 'x1', organizationId: orgX._id, sentAt: new Date(now), expiresAt: inYear },
    { kind: 'addedToOrg', outcome: 'dormant', subject: 'x2', organizationId: orgX._id, sentAt: new Date(now - 1000), expiresAt: inYear },
    { kind: 'passwordReset', outcome: 'sent', subject: 'y1', organizationId: orgY._id, sentAt: new Date(now - 2000), expiresAt: inYear },
    { kind: 'passwordReset', outcome: 'sent', subject: 'n1', organizationId: null, sentAt: new Date(now - 3000), expiresAt: inYear },
  ]);

  const res = await call('GET', '/super-admin/emails/orgs', { token: ctx.superTok });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.json.orgs));
  assert.ok(res.json.orgs.every((o) => o && o.id), 'no null orgs');
  const ids = res.json.orgs.map((o) => o.id).sort();
  assert.deepStrictEqual(ids, [String(orgX._id), String(orgY._id)].sort(), 'exactly the two referenced orgs (not the unreferenced Zed)');
  const x = res.json.orgs.find((o) => o.id === String(orgX._id));
  assert.strictEqual(x.name, 'Xavier Org');
  assert.strictEqual(x.slug, 'xavier-org');
});

// 9) The TTL index is DECLARED on the schema — the prod index migration builds indexes from these
//    declarations (autoIndex is off), so the declaration itself is the retention contract.
test('EmailLog schema declares a { expiresAt: 1 } TTL index with expireAfterSeconds 0', () => {
  const indexes = EmailLog.schema.indexes();
  const ttl = indexes.find(([keys, opts]) => keys && keys.expiresAt === 1 && opts && opts.expireAfterSeconds === 0);
  assert.ok(ttl, 'a TTL index on { expiresAt: 1 } with expireAfterSeconds: 0 must be declared on the schema');
});
