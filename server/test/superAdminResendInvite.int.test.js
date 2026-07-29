import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Staff-side cross-org invite resend:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/staffresend node --test test/superAdminResendInvite.int.test.js
//
// The org-scoped resend (mailTriggers.int.test.js) needs MEMBERSHIP, which staff do not have in a
// customer org — entering one sets req.supportGrant and the memberships router refuses every
// non-GET. This suite covers the deliberate staff route that fills that gap, and pins the two
// things most likely to go quietly wrong: the invite naming the WRONG organization for a
// multi-org user, and the claim that the send is attributable via EmailLog.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-staff-resend';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { EmailLog } = await import('../src/models/EmailLog.js');
const { outbox, clearOutbox } = await import('../src/services/mail/mailer.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, { timeout = 2000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (pred()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(interval);
  }
}
const invites = () => outbox.filter((e) => e.kind === 'inviteSetPassword');
const bodyOf = (e) => `${e?.html || ''}\n${e?.text || ''}`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, EmailLog]) await M.deleteMany({});

  // Two DIFFERENT customer orgs. Staff are members of neither — that is the whole point.
  const clientOrg = await Organization.create({ name: 'Client Co', slug: 'client-co', isActive: true });
  const otherOrg = await Organization.create({ name: 'Other Co', slug: 'other-co', isActive: true });

  const staff = await User.create({
    firstName: 'Sydney', lastName: 'Staff', email: 'sydney@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'support',
  });
  const outsider = await User.create({
    firstName: 'Nora', lastName: 'Normal', email: 'nora@client.co', passwordHash: 'x', isActive: true,
  });

  // The real-world case: provisioned, never signed in, temp password long expired.
  const stranded = await User.create({
    firstName: 'Cara', lastName: 'Client', email: 'cara@client.co',
    passwordHash: 'x', isActive: true, mustChangePassword: true,
    tempPasswordSetAt: new Date(Date.now() - 10 * 24 * 3600_000),
  });
  // Deliberately in BOTH orgs, so "which org gets named" is a real question and not a formality.
  await Membership.create({ userId: stranded._id, organizationId: clientOrg._id, role: 'admin', isActive: true });
  await Membership.create({ userId: stranded._id, organizationId: otherOrg._id, role: 'canvasser', isActive: true });

  const signedIn = await User.create({
    firstName: 'Sam', lastName: 'Seen', email: 'sam@client.co',
    passwordHash: 'x', isActive: true, lastLoginAt: new Date(),
  });
  await Membership.create({ userId: signedIn._id, organizationId: clientOrg._id, role: 'canvasser', isActive: true });

  Object.assign(ctx, {
    clientOrg, otherOrg, stranded, signedIn,
    staffTok: signUserToken(staff),
    outsiderTok: signUserToken(outsider),
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
  clearOutbox();
  if (!URI) return;
  // Clear the mint-based cooldown so each test starts clean.
  await User.updateMany({}, { $unset: { passwordResetToken: 1, passwordResetExpiresAt: 1 } });
});

const resend = (userId, organizationId, token = ctx.staffTok) =>
  call('POST', `/super-admin/users/${userId}/resend-invite`, { token, body: { organizationId } });

test('staff can re-invite into an org they are not a member of, and the link works', { skip }, async () => {
  const res = await resend(ctx.stranded._id, String(ctx.clientOrg._id));
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.to, 'cara@client.co');

  assert.ok(await waitFor(() => invites().length === 1), `saw ${outbox.length} mails`);
  const m = bodyOf(invites()[0]).match(/reset-password\/([A-Za-z0-9_-]+)/);
  assert.ok(m, 'the invite carries a set-password link');

  const consume = await call('POST', '/auth/reset-password', {
    body: { token: m[1], newPassword: 'Chosen!Pass9' },
  });
  assert.strictEqual(consume.status, 200, 'the emailed link is a live token');
});

// The failure that would be invisible in production: a multi-org user gets an invite naming
// whichever org happened to be found first, and a client reads another company's name.
test('the invite names the REQUESTED org, not the user\'s other one', { skip }, async () => {
  assert.strictEqual((await resend(ctx.stranded._id, String(ctx.otherOrg._id))).status, 200);
  assert.ok(await waitFor(() => invites().length === 1));
  const body = bodyOf(invites()[0]);
  assert.ok(body.includes('Other Co'), 'names the org that was asked for');
  assert.ok(!body.includes('Client Co'), 'and never the other one');
});

test('the org must be named explicitly and must actually contain the user', { skip }, async () => {
  const missing = await call('POST', `/super-admin/users/${ctx.stranded._id}/resend-invite`, {
    token: ctx.staffTok,
    body: {},
  });
  assert.strictEqual(missing.status, 400, 'no silent guess when the org is omitted');
  assert.strictEqual(missing.json.code, 'ORG_REQUIRED');

  // A real org the user does NOT belong to.
  const stray = await Organization.create({ name: 'Stray Co', slug: 'stray-co', isActive: true });
  const wrong = await resend(ctx.stranded._id, String(stray._id));
  assert.strictEqual(wrong.status, 404, 'membership in the named org is required');

  await sleep(150);
  assert.strictEqual(invites().length, 0, 'nothing was emailed on either refusal');
});

test('someone who has already signed in is refused — Forgot password is their route', { skip }, async () => {
  const res = await resend(ctx.signedIn._id, String(ctx.clientOrg._id));
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'ALREADY_SIGNED_IN');
  await sleep(150);
  assert.strictEqual(invites().length, 0, 'and no link of theirs was killed');
});

test('a non-super caller cannot reach the staff route at all', { skip }, async () => {
  const res = await resend(ctx.stranded._id, String(ctx.clientOrg._id), ctx.outsiderTok);
  assert.strictEqual(res.status, 403);
  const anon = await call('POST', `/super-admin/users/${ctx.stranded._id}/resend-invite`, {
    body: { organizationId: String(ctx.clientOrg._id) },
  });
  assert.strictEqual(anon.status, 401);
});

// The audit claim is that EmailLog makes a staff send attributable with no new model. Assert it
// rather than assuming it — the whole "no new audit model needed" argument rests on this row.
test('the send is attributable: EmailLog carries the org and the user', { skip }, async () => {
  assert.strictEqual((await resend(ctx.stranded._id, String(ctx.clientOrg._id))).status, 200);

  // recordEmail() is fire-and-forget inside sendMail, so the row lands shortly after the response.
  let found = null;
  for (let i = 0; i < 40 && !found; i++) {
    found = await EmailLog.findOne({ kind: 'inviteSetPassword', userId: ctx.stranded._id }).lean();
    if (!found) await sleep(50);
  }

  assert.ok(found, 'an EmailLog row was written for the resend');
  assert.strictEqual(String(found.organizationId), String(ctx.clientOrg._id));
  assert.strictEqual(found.organizationName, 'Client Co');
  assert.deepStrictEqual(found.to, ['cara@client.co']);
});
