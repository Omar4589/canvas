import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// WHO gets a transactional email, and — just as load-bearing — who NEVER does, exercised over the REAL
// Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/mailtriggers_test node --test test/mailTriggers.int.test.js
//
// The mailer is DORMANT (no RESEND_API_KEY / MAIL_FROM), so every intended send is recorded on `outbox`
// rather than delivered — the assertion surface. Route sends are fire-and-forget, so we POLL the outbox
// briefly instead of reading it synchronously after the fetch.
//
// The two rules under test that keep drifting if untended:
//   1. Emails NEVER carry a password — not the admin-typed temp password, not the auto-generated one.
//   2. SILENT side-effect roster adds (ensureCampaignAssignments) never email; only the deliberate
//      Team-page / crew adds do.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-mailtriggers';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { SupportAccessGrant } = await import('../src/models/SupportAccessGrant.js');
const { outbox, clearOutbox } = await import('../src/services/mail/mailer.js');
const { ensureCampaignAssignments } = await import('../src/services/campaignRoster.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {}; // { org, campaign, adminTok, superTok, superFirst, superEmail }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, { timeout = 2000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (pred()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(interval);
  }
}

const kinds = (kind) => outbox.filter((e) => e.kind === kind);
const bodyOf = (entry) => `${entry?.html || ''}\n${entry?.text || ''}`;

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
  for (const M of [Organization, User, Membership, Campaign, Subscription, CampaignAssignment, SupportAccessGrant]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Triggers Org', slug: 'triggers-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active', statusChangedAt: new Date() });
  const admin = await User.create({
    firstName: 'Amy', lastName: 'Admin', email: 'amy.admin@t.co',
    passwordHash: await User.hashPassword('AdminPass!23'), isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const campaign = await Campaign.create({
    organizationId: org._id, name: 'Doorline Field Ops', type: 'survey', state: 'KY', isActive: true,
  });
  // A distinctive first name (and email) so the grant-notice assertions can tell name-in-body from
  // email-in-body apart with no chance of a coincidental substring hit.
  const superU = await User.create({
    firstName: 'Sydney', lastName: 'Staff', email: 'sydney.staff@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'break_glass',
  });

  Object.assign(ctx, {
    org, campaign,
    adminTok: signUserToken(admin),
    superTok: signUserToken(superU),
    superFirst: superU.firstName,
    superEmail: superU.email,
  });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

beforeEach(() => {
  clearOutbox();
});

// 1) Org add a BRAND-NEW user → one inviteSetPassword; the temp password never appears in the email; the
//    set-password link token actually works.
test('memberships POST (new user): inviteSetPassword only, no password in the mail, and the link works', { skip }, async () => {
  const email = 'new.hire@t.co';
  const tempPw = 'TempPass!23'; // the admin-typed temp password — must never reach the inbox
  const res = await call('POST', '/admin/memberships', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { email, firstName: 'New', lastName: 'Hire', password: tempPw },
  });
  assert.strictEqual(res.status, 201);

  const seen = await waitFor(() => kinds('inviteSetPassword').length === 1);
  assert.ok(seen, `expected one inviteSetPassword, saw ${outbox.length} total`);
  const entry = kinds('inviteSetPassword')[0];
  assert.deepStrictEqual(entry.to, [email]);
  assert.ok(!JSON.stringify(outbox).includes(tempPw), 'the email must not carry the temp password');

  // The set-password link is a live INVITE token — consuming it via reset-password chooses a password.
  const m = bodyOf(entry).match(/reset-password\/([A-Za-z0-9_-]+)/);
  assert.ok(m, 'the invite email carries a set-password link');
  const consume = await call('POST', '/auth/reset-password', {
    body: { token: m[1], newPassword: 'Chosen!Pass9' },
  });
  assert.strictEqual(consume.status, 200, 'the emailed set-password link is a working token');
});

// 2) Org add an EXISTING user (linkExisting) → one addedToOrg, and NO credentials link in it.
test('memberships POST (linkExisting): addedToOrg only, carrying no set-password link', { skip }, async () => {
  const email = 'returning@t.co';
  await User.create({
    firstName: 'Rey', lastName: 'Returner', email,
    passwordHash: await User.hashPassword('TheirOwn!23'), isActive: true,
  });
  const res = await call('POST', '/admin/memberships', {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { email, linkExisting: true },
  });
  assert.strictEqual(res.status, 201);

  const seen = await waitFor(() => kinds('addedToOrg').length === 1);
  assert.ok(seen, `expected one addedToOrg, saw ${outbox.length} total`);
  const entry = kinds('addedToOrg')[0];
  assert.deepStrictEqual(entry.to, [email]);
  assert.ok(!bodyOf(entry).includes('/reset-password/'), 'a linked account gets no credentials link');
});

// 3) leadCrew POST (create + attach in one step) → exactly ONE combined email that names the campaign.
test('leadCrew POST: a single combined invite that mentions the campaign name', { skip }, async () => {
  const res = await call('POST', `/admin/campaigns/${ctx.campaign._id}/crew`, {
    token: ctx.adminTok,
    orgId: ctx.org._id,
    body: { email: 'crew.new@t.co', firstName: 'Crew', lastName: 'New', password: 'TempPass!23' },
  });
  assert.strictEqual(res.status, 201);

  const seen = await waitFor(() => outbox.length === 1);
  assert.ok(seen, `expected exactly one email, saw ${outbox.length}`);
  assert.strictEqual(outbox[0].kind, 'inviteSetPassword');
  assert.deepStrictEqual(outbox[0].to, ['crew.new@t.co']);
  assert.ok(bodyOf(outbox[0]).includes(ctx.campaign.name), 'the combined email names the campaign');
});

// 4) AUTO-ADD GUARD: ensureCampaignAssignments is the SILENT side-effect add (a book handed out makes the
//    campaign visible in the field app). It creates the roster row and MUST NOT email.
test('ensureCampaignAssignments creates the roster row and sends NO email', { skip }, async () => {
  const u = await User.create({
    firstName: 'Silent', lastName: 'Add', email: 'silent.add@t.co',
    passwordHash: 'x', isActive: true,
  });
  await ensureCampaignAssignments(ctx.campaign._id, [u._id], ctx.org._id, null);

  const row = await CampaignAssignment.exists({ campaignId: ctx.campaign._id, userId: u._id });
  assert.ok(row, 'the roster row was created');

  await sleep(250);
  assert.strictEqual(outbox.length, 0, 'a silent side-effect roster add never emails');
});

// 5) assignments POST (the Team page): a genuinely-new roster row emails once; a re-add sends nothing; a
//    mustChangePassword invitee is skipped (their invite already named the campaign).
test('assignments POST: new row emails once, re-add is silent, mustChangePassword is skipped', { skip }, async () => {
  const mkMember = async (email, extra = {}) => {
    const u = await User.create({ firstName: 'Ann', lastName: 'Assignee', email, passwordHash: 'x', isActive: true, ...extra });
    await Membership.create({ userId: u._id, organizationId: ctx.org._id, role: 'canvasser', isActive: true });
    return u;
  };
  const x = await mkMember('assignee.x@t.co');
  const y = await mkMember('assignee.y@t.co', { mustChangePassword: true, tempPasswordSetAt: new Date() });

  const opt = { token: ctx.adminTok, orgId: ctx.org._id };

  // New roster row for X → exactly one addedToCampaign for X.
  const add1 = await call('POST', `/admin/campaigns/${ctx.campaign._id}/assignments`, { ...opt, body: { userIds: [String(x._id)] } });
  assert.strictEqual(add1.status, 201);
  assert.strictEqual(add1.json.created, 1);
  assert.ok(await waitFor(() => kinds('addedToCampaign').length === 1), 'X gets one addedToCampaign');
  assert.deepStrictEqual(kinds('addedToCampaign')[0].to, ['assignee.x@t.co']);

  // Re-adding X (row already present) inserts nothing → no second email.
  clearOutbox();
  const add2 = await call('POST', `/admin/campaigns/${ctx.campaign._id}/assignments`, { ...opt, body: { userIds: [String(x._id)] } });
  assert.strictEqual(add2.status, 201);
  assert.strictEqual(add2.json.created, 0);
  await sleep(250);
  assert.strictEqual(kinds('addedToCampaign').length, 0, 'a re-add sends no duplicate');

  // Y is genuinely new to the roster but still holds a temp password → no email for them.
  clearOutbox();
  const addY = await call('POST', `/admin/campaigns/${ctx.campaign._id}/assignments`, { ...opt, body: { userIds: [String(y._id)] } });
  assert.strictEqual(addY.status, 201);
  assert.strictEqual(addY.json.created, 1, 'Y IS added to the roster');
  await sleep(250);
  assert.strictEqual(kinds('addedToCampaign').length, 0, 'a mustChangePassword invitee is not re-notified');
});

// 6) Provisioning (super-admin org create with an admin block) → provisioningWelcome; the returned
//    tempPassword (here auto-generated) is nowhere in the mail.
test('superAdmin organizations POST: provisioningWelcome, and the returned temp password never leaks', { skip }, async () => {
  const res = await call('POST', '/super-admin/organizations', {
    token: ctx.superTok,
    body: { name: 'Provisioned Org', admin: { firstName: 'Percy', lastName: 'Owner', email: 'percy.owner@t.co' } },
  });
  assert.strictEqual(res.status, 201);
  const tempPassword = res.json.tempPassword;
  assert.ok(typeof tempPassword === 'string' && tempPassword.length > 0, 'a temp password is returned once');

  const seen = await waitFor(() => kinds('provisioningWelcome').length === 1);
  assert.ok(seen, `expected one provisioningWelcome, saw ${outbox.length} total`);
  assert.deepStrictEqual(kinds('provisioningWelcome')[0].to, ['percy.owner@t.co']);
  assert.ok(!JSON.stringify(outbox).includes(tempPassword), 'the auto-generated temp password must not reach the inbox');
});

// 7) Grant notice → ONE supportGrantNotice, recipients following the orgNotifyEmails cascade; a re-request
//    while the grant is live does not re-notify; the notice carries the staffer's FIRST name, not their email.
test('supportGrantNotice: cascade recipients, dedupe on reuse, first-name-not-email in the body', { skip }, async () => {
  // Org A: a billingAccess admin AND a plain admin → only the billing admin is notified (not "everyone").
  const orgA = await Organization.create({ name: 'Notice Org A', slug: 'notice-a', isActive: true });
  const billingAdmin = await User.create({ firstName: 'Bill', lastName: 'Payer', email: 'billing.a@t.co', passwordHash: 'x', isActive: true });
  const plainAdmin = await User.create({ firstName: 'Pat', lastName: 'Plain', email: 'plain.a@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: billingAdmin._id, organizationId: orgA._id, role: 'admin', isActive: true, billingAccess: true });
  await Membership.create({ userId: plainAdmin._id, organizationId: orgA._id, role: 'admin', isActive: true, billingAccess: false });

  // Org B: NO admins — the only reachable notify path is Subscription.billingContact.email.
  const orgB = await Organization.create({ name: 'Notice Org B', slug: 'notice-b', isActive: true });
  await Subscription.create({ organizationId: orgB._id, status: 'active', billingContact: { name: 'Contact B', email: 'contact.b@t.co' } });

  const reason = 'Investigating a stuck import for the customer (ticket 42).';

  // Org A grant → one notice, to the billing admin only.
  const gA = await call('POST', '/super-admin/access/grants', { token: ctx.superTok, body: { organizationId: String(orgA._id), reason } });
  assert.strictEqual(gA.status, 201);
  assert.ok(await waitFor(() => kinds('supportGrantNotice').length === 1), 'org A is notified');
  const noticeA = kinds('supportGrantNotice')[0];
  assert.deepStrictEqual(noticeA.to, ['billing.a@t.co'], 'only the billingAccess admin, not every admin');
  const body = bodyOf(noticeA);
  assert.ok(body.includes(ctx.superFirst), "the staffer's first name is in the notice");
  assert.ok(!body.includes(ctx.superEmail), "the staffer's email is NOT in the notice");

  // Re-request the SAME live grant → createGrant reuses it (created:false) → no second notice.
  clearOutbox();
  const again = await call('POST', '/super-admin/access/grants', { token: ctx.superTok, body: { organizationId: String(orgA._id), reason } });
  assert.strictEqual(again.status, 201);
  await sleep(250);
  assert.strictEqual(kinds('supportGrantNotice').length, 0, 'reusing a live grant does not re-notify');

  // Org B grant → notice goes to the billingContact of record.
  clearOutbox();
  const gB = await call('POST', '/super-admin/access/grants', { token: ctx.superTok, body: { organizationId: String(orgB._id), reason } });
  assert.strictEqual(gB.status, 201);
  assert.ok(await waitFor(() => kinds('supportGrantNotice').length === 1), 'org B is notified via billingContact');
  assert.deepStrictEqual(kinds('supportGrantNotice')[0].to, ['contact.b@t.co']);
});

// 8) An org with no reachable notify recipient (no admins, no billingContact) → no crash, no email, and
//    the grant route still succeeds.
test('supportGrantNotice: an org with no reachable recipient sends nothing and the grant still 201s', { skip }, async () => {
  const orgC = await Organization.create({ name: 'Notice Org C', slug: 'notice-c', isActive: true });
  // No admin memberships, no Subscription → orgNotifyEmails returns [].
  const res = await call('POST', '/super-admin/access/grants', {
    token: ctx.superTok,
    body: { organizationId: String(orgC._id), reason: 'A support session with no reachable recipient (ticket 7).' },
  });
  assert.strictEqual(res.status, 201, 'the grant is created regardless of notifiability');
  await sleep(250);
  assert.strictEqual(kinds('supportGrantNotice').length, 0, 'no recipient → no email, no crash');
});
