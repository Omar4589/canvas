import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Help Center content API over the REAL Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/help_test node --test test/help.int.test.js
// Proves the role-audience gate: canvasser < lead < admin < super, over GET /help/index,
// /help/faq, and /help/articles/:slug. Uses the seed content shipped in
// server/src/content/help/ (admin-getting-started=admin, voter-imports/page-campaign-home
// =lead, canvasser-first-day=canvasser, two FAQ=all).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-help';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Help Org', slug: 'help-org', isActive: true });
  async function member(first, role) {
    const u = await User.create({
      firstName: first, lastName: 'X', email: `${first.toLowerCase()}@t.co`,
      passwordHash: 'x', isActive: true,
    });
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
    return { token: signUserToken(u), orgId: org._id };
  }
  ctx.admin = await member('Ada', 'admin');
  ctx.lead = await member('Lee', 'lead');
  ctx.canv = await member('Cam', 'canvasser');

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function call(path, who) {
  const res = await fetch(`${base}/api${path}`, {
    headers: { Authorization: `Bearer ${who.token}`, 'X-Org-Id': String(who.orgId) },
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

test('GET /help/index widens by role: canvasser < lead < admin', { skip }, async () => {
  const canv = await call('/help/index', ctx.canv);
  const lead = await call('/help/index', ctx.lead);
  const admin = await call('/help/index', ctx.admin);
  assert.strictEqual(canv.status, 200);
  assert.strictEqual(canv.json.role, 'canvasser');
  const slugs = (r) => r.json.articles.map((a) => a.slug);

  // canvasser sees the canvasser track, never the lead/admin guides
  assert.ok(slugs(canv).includes('canvasser-first-day'));
  assert.ok(!slugs(canv).includes('voter-imports'));
  assert.ok(!slugs(canv).includes('admin-getting-started'));

  // lead adds the lead guides, still not the admin one
  assert.ok(slugs(lead).includes('voter-imports'));
  assert.ok(slugs(lead).includes('page-campaign-home'));
  assert.ok(!slugs(lead).includes('admin-getting-started'));

  // admin sees everything the lead does, plus admin-only content
  assert.ok(slugs(admin).includes('admin-getting-started'));
  assert.ok(slugs(admin).includes('voter-imports'));
  assert.ok(admin.json.articles.length > lead.json.articles.length);
  assert.ok(lead.json.articles.length > canv.json.articles.length);

  // index omits FAQ (that's a separate endpoint) and omits block bodies
  assert.ok(!slugs(admin).includes('add-a-second-voter-file'));
  assert.ok(admin.json.articles.every((a) => a.blocks === undefined));
});

test('GET /help/faq returns full entries (with blocks) for every role', { skip }, async () => {
  for (const who of [ctx.canv, ctx.lead, ctx.admin]) {
    const r = await call('/help/faq', who);
    assert.strictEqual(r.status, 200);
    assert.ok(r.json.faq.length >= 2, 'the two all-audience FAQ entries are visible');
    const one = r.json.faq.find((f) => f.slug === 'reset-my-password');
    assert.ok(one && Array.isArray(one.blocks) && one.blocks.length > 0, 'FAQ carries rendered blocks');
    assert.ok(one.question, 'FAQ carries a question');
  }
});

test('GET /help/articles/:slug enforces the role gate', { skip }, async () => {
  const forbidden = await call('/help/articles/admin-getting-started', ctx.canv);
  assert.strictEqual(forbidden.status, 404, 'canvasser cannot read an admin article');

  const ok = await call('/help/articles/admin-getting-started', ctx.admin);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.article.slug, 'admin-getting-started');
  assert.ok(ok.json.article.blocks.some((b) => b.type === 'heading'));
  assert.ok(ok.json.article.blocks.some((b) => b.type === 'callout'));

  const canvOwn = await call('/help/articles/canvasser-first-day', ctx.canv);
  assert.strictEqual(canvOwn.status, 200, 'canvasser can read their own track');

  const missing = await call('/help/articles/nope-nope', ctx.admin);
  assert.strictEqual(missing.status, 404);
});
