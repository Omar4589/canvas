import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Published client reports, and what they are allowed to expose.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/repsec node --test test/reportSecurity.int.test.js
//
// A published report is not the aggregate summary the privacy policy describes. Every map point is a
// household at its EXACT street address and coordinates, carrying that household's survey answers —
// "412 Elm St → Opposed". A name is a public voter-file lookup away.
//
// That is defensible: the recipient is the customer's own client, who already owns the voter file.
// What was NOT defensible is how it was protected:
//   · the share link had NO password by default and share.js waved through any link without one, so
//     a published report was an open, unauthenticated URL;
//   · the link NEVER expired — it outlived the campaign, the staffer and the client relationship,
//     and kept working from any inbox it had ever been forwarded to;
//   · `mapAnswerKeys` accepted ANY question key with no validation, so an operator could pin a
//     FREE-TEXT answer — whatever a canvasser typed — to somebody's home address, in public.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-report-security';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');

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
  for (const M of [Organization, User, Membership, Campaign, SurveyTemplate, ClientReport, ReportShareLink, Subscription]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Acme', slug: 'acme', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const admin = await User.create({
    firstName: 'Ada', lastName: 'Admin', email: 'ada@t.co',
    passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true,
  });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  // A survey with BOTH a choice question and a free-text one. The free-text question is the hazard.
  const template = await SurveyTemplate.create({
    organizationId: org._id, name: 'Doors', isActive: true,
    questions: [
      { key: 'support', label: 'Support?', type: 'single_choice', options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] },
      { key: 'notes', label: 'Anything else?', type: 'text' },
    ],
  });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Fall', type: 'survey', state: 'FL',
    isActive: true, surveyTemplateId: template._id,
  });

  Object.assign(ctx, { org, camp, admin: { token: signUserToken(admin), orgId: org._id } });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('a free-text question CANNOT be pinned to a street address in a published report', { skip }, async () => {
  const draft = await ClientReport.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id,
    title: 'Week 1', status: 'draft',
    weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: true },
  });

  // 'notes' is a free-text question. A canvasser can type anything into it.
  const bad = await call('PATCH', `/admin/client-reports/${draft._id}`, {
    ...ctx.admin,
    body: { visibility: { mapAnswerKeys: ['support', 'notes'] } },
  });
  assert.strictEqual(bad.status, 400, 'a text question must be refused');
  assert.strictEqual(bad.json.code, 'MAP_ANSWER_KEYS_NOT_CHOICE');
  assert.deepStrictEqual(bad.json.rejected, ['notes']);

  const stored = await ClientReport.findById(draft._id).lean();
  assert.deepStrictEqual(stored.visibility.mapAnswerKeys, [], 'nothing was written');

  // The choice question alone is fine — this is the legitimate use.
  const ok = await call('PATCH', `/admin/client-reports/${draft._id}`, {
    ...ctx.admin,
    body: { visibility: { mapAnswerKeys: ['support'] } },
  });
  assert.strictEqual(ok.status, 200);
  const after = await ClientReport.findById(draft._id).lean();
  assert.deepStrictEqual(after.visibility.mapAnswerKeys, ['support']);
});

test('a new share link ALWAYS gets a password and an expiry', { skip }, async () => {
  // The operator supplied neither. It used to produce an open, never-expiring public URL.
  const res = await call('POST', '/admin/client-reports/shares', {
    ...ctx.admin,
    body: { campaignId: String(ctx.camp._id), label: 'Client' },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.strictEqual(res.json.share.hasPassword, true, 'a password was generated');
  assert.ok(res.json.share.expiresAt, 'an expiry was set');
  assert.ok(res.json.generatedPassword, 'the generated password is returned ONCE so it can be shared');
  assert.ok(res.json.generatedPassword.length >= 10);

  const stored = await ReportShareLink.findById(res.json.share.id);
  assert.ok(stored.passwordHash, 'stored hashed, never in the clear');
  assert.ok(stored.expiresAt > new Date());
  ctx.share = stored;
});

test('an expired link is refused, even with the right token', { skip }, async () => {
  const expired = await ReportShareLink.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id,
    token: 'expired-token-abc', passwordHash: 'x',
    expiresAt: new Date(Date.now() - 1000),
    isActive: true,
  });
  const res = await call('GET', `/share/${expired.token}`);
  assert.strictEqual(res.status, 410, 'an expired link must be gone, not merely password-protected');
  assert.strictEqual(res.json.code, 'SHARE_EXPIRED');
});

test('a legacy link with no expiry still works — we do not break a client\'s live URL silently', { skip }, async () => {
  // Links created before this change have expiresAt: null. Breaking them without notice would take a
  // published report offline under a customer's feet. They are sunset on notice, not by surprise.
  const legacy = await ReportShareLink.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id,
    token: 'legacy-token-xyz', passwordHash: null, expiresAt: null, isActive: true,
  });
  const res = await call('GET', `/share/${legacy.token}`);
  assert.notStrictEqual(res.status, 410, 'a legacy link must not be killed by the expiry check');
  const row = await ReportShareLink.findById(legacy._id);
  assert.strictEqual(row.isLegacyOpen(), true, 'but it is flagged so the UI can nag about it');
});
