import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Demo requests are SAVED, not just emailed (routes/public/demoRequest.js → models/DemoRequest.js),
// and super-admins work them on /super-admin/website, beside the site's traffic
// (routes/superAdmin/website.js; the traffic itself is siteTraffic.int.test.js). The promises this pins:
//   · a real request is saved with what the person picked, where they came from, and an expiry
//     24 months out (the published "up to 24 months");
//   · a failed email no longer loses the lead — it is saved, and the prospect is told it went through;
//   · bot submissions are never saved;
//   · only super-admins can read, handle or delete them; delete is permanent.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/demostore node --test test/demoRequestStore.int.test.js
process.env.RESEND_API_KEY = 'test:accept';
process.env.MAIL_FROM = 'Doorline <notifications@doorline.app>';
process.env.DEMO_REQUEST_TO = 'demo-inbox@doorline.app';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-demo-store';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { User } = await import('../src/models/User.js');
const { DemoRequest, DEMO_REQUEST_RETENTION_DAYS } = await import('../src/models/DemoRequest.js');
const { outbox, clearOutbox } = await import('../src/services/mail/mailer.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const makeUser = (first, { isSuperAdmin = false } = {}) =>
  User.create({ firstName: first, lastName: 'X', email: `${first.toLowerCase()}@t.co`, passwordHash: 'x', isActive: true, isSuperAdmin });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [User, DemoRequest]) await M.deleteMany({});
  const superU = await makeUser('Sue', { isSuperAdmin: true });
  const plainU = await makeUser('Pat');
  Object.assign(ctx, { sup: { token: signUserToken(superU), userId: superU._id }, plain: { token: signUserToken(plainU) } });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (URI) await mongoose.disconnect();
});

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};

const VALID = {
  name: 'Dana Reyes',
  email: 'dana@reyesfield.com',
  organization: 'Reyes Field Co.',
  role: 'Canvassing firm',
  teamSize: '11–50',
  heardAbout: 'AAPC event',
  phone: '+1 515-555-0134',
  message: 'Two county races.',
  source: 'home-banner',
  page: '/',
  elapsedMs: 30_000,
};

test('a request is saved with what was picked, where it came from, and a 24-month expiry', { skip }, async () => {
  clearOutbox();
  const before = Date.now();
  const res = await call('POST', '/demo-request', { body: VALID });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.json, { ok: true });
  const row = await DemoRequest.findOne({ email: VALID.email }).lean();
  assert.ok(row, 'saved');
  for (const k of ['name', 'organization', 'role', 'teamSize', 'heardAbout', 'phone', 'message', 'source', 'page']) {
    assert.strictEqual(row[k], VALID[k], k);
  }
  assert.strictEqual(row.when, null, 'not asked on the homepage');
  assert.strictEqual(row.emailOutcome, 'sent', 'the notice went out (test transport)');
  assert.strictEqual(outbox.length, 1);
  const days = (row.expiresAt - before) / 86_400_000;
  assert.ok(Math.abs(days - DEMO_REQUEST_RETENTION_DAYS) < 1, `expires ~${DEMO_REQUEST_RETENTION_DAYS} days out (got ${days.toFixed(2)})`);
});

test('a failed email no longer loses the lead: it is saved and the prospect is told it went through', { skip }, async () => {
  process.env.RESEND_API_KEY = 'test:reject';
  try {
    const res = await call('POST', '/demo-request', { body: { ...VALID, email: 'second@reyesfield.com' } });
    assert.strictEqual(res.status, 200, 'saved, so not a failure');
    const row = await DemoRequest.findOne({ email: 'second@reyesfield.com' }).lean();
    assert.ok(row, 'saved');
    assert.strictEqual(row.emailOutcome, 'failed', 'and the Website page can see the send failed');
  } finally {
    process.env.RESEND_API_KEY = 'test:accept';
  }
});

test('a bot submission is answered like a success and never saved', { skip }, async () => {
  const before = await DemoRequest.countDocuments();
  const honeypot = await call('POST', '/demo-request', { body: { ...VALID, email: 'bot1@x.co', company: 'Acme' } });
  const tooFast = await call('POST', '/demo-request', { body: { ...VALID, email: 'bot2@x.co', elapsedMs: 300 } });
  assert.deepStrictEqual([honeypot.status, tooFast.status], [200, 200]);
  assert.strictEqual(await DemoRequest.countDocuments(), before, 'nothing saved');
});

test('only super-admins can read, handle and delete demo requests', { skip }, async () => {
  for (const [method, path] of [['GET', '/super-admin/website/demo-requests'], ['GET', '/super-admin/website/traffic']]) {
    assert.strictEqual((await call(method, path, ctx.plain)).status, 403, `${method} ${path} as a plain user`);
    assert.strictEqual((await call(method, path)).status, 401, `${method} ${path} signed out`);
  }

  const list = await call('GET', '/super-admin/website/demo-requests', ctx.sup);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.json.open, 2);
  assert.deepStrictEqual(list.json.requests.map((r) => r.email), ['second@reyesfield.com', VALID.email], 'newest first');

  const id = list.json.requests[1].id;
  const handled = await call('PATCH', `/super-admin/website/demo-requests/${id}`, { ...ctx.sup, body: { handled: true } });
  assert.strictEqual(handled.status, 200);
  assert.ok(handled.json.request.handledAt);
  const stored = await DemoRequest.findById(id).lean();
  assert.strictEqual(String(stored.handledBy), String(ctx.sup.userId), 'who handled it is kept');

  const open = await call('GET', '/super-admin/website/demo-requests?status=open', ctx.sup);
  assert.deepStrictEqual(open.json.requests.map((r) => r.email), ['second@reyesfield.com']);
  const done = await call('GET', '/super-admin/website/demo-requests?status=handled', ctx.sup);
  assert.deepStrictEqual(done.json.requests.map((r) => r.email), [VALID.email]);

  const reopened = await call('PATCH', `/super-admin/website/demo-requests/${id}`, { ...ctx.sup, body: { handled: false } });
  assert.strictEqual(reopened.json.request.handledAt, null);

  assert.strictEqual((await call('DELETE', `/super-admin/website/demo-requests/${id}`, ctx.plain)).status, 403);
  assert.strictEqual((await call('DELETE', `/super-admin/website/demo-requests/${id}`, ctx.sup)).status, 204);
  assert.strictEqual(await DemoRequest.countDocuments({ _id: id }), 0, 'gone for good');
  assert.strictEqual((await call('DELETE', `/super-admin/website/demo-requests/${id}`, ctx.sup)).status, 404);
  assert.strictEqual((await call('PATCH', '/super-admin/website/demo-requests/not-an-id', { ...ctx.sup, body: { handled: true } })).status, 400);
});
