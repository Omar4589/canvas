import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';

// The Resend delivery webhook — the public, signature-authenticated endpoint that upgrades
// EmailLog rows from "Resend accepted it" to what the inbox actually reported.
//
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/rswh node --test test/resendWebhook.int.test.js
//
// The security posture under test: the ONLY authentication is the Svix HMAC over the raw body,
// so a bad signature, a stale timestamp, or a missing secret must all refuse — and the terminal
// statuses (bounced/complained) must never be repainted by a late 'delivered'.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-resend-webhook';

const SECRET = `whsec_${Buffer.from('webhook-test-key-32-bytes-long!!').toString('base64')}`;

const { createApp } = await import('../src/app.js');
const { EmailLog } = await import('../src/models/EmailLog.js');
const { sendMail, clearOutbox } = await import('../src/services/mail/mailer.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});
beforeEach(async () => {
  if (!URI) return;
  await EmailLog.deleteMany({});
  clearOutbox();
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
});

function sign({ secret = SECRET, id, timestamp, body }) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

// A signed POST the way Resend/Svix sends it: raw JSON body + the three svix headers.
async function deliver(event, { secret, timestamp, badSignature } = {}) {
  const body = JSON.stringify(event);
  const id = `msg_${Math.random().toString(36).slice(2, 10)}`;
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signature = badSignature ? 'v1,AAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAA=' : sign({ secret, id, timestamp: ts, body });
  const res = await fetch(`${base}/api/webhooks/resend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': id,
      'svix-timestamp': String(ts),
      'svix-signature': signature,
    },
    body,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

const seedRow = (resendId, extra = {}) =>
  EmailLog.create({
    kind: 'passwordReset', to: ['x@t.co'], subject: 'S', outcome: 'sent',
    resendId, sentAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), ...extra,
  });

test('the full loop: an accepted send carries a resendId, and a signed delivered event upgrades the row', { skip }, async () => {
  // Test transport = a fabricated resendId with no network, exactly for this loop.
  process.env.RESEND_API_KEY = 'test:accept';
  process.env.MAIL_FROM = 'Doorline <t@doorline.test>';
  const result = await sendMail({ to: 'loop@t.co', subject: 'Loop', html: '<p>x</p>', text: 'x', kind: 'passwordReset' });
  assert.strictEqual(result.sent, true);

  let row;
  for (let i = 0; i < 40 && !row; i++) {
    row = await EmailLog.findOne({ to: 'loop@t.co' }).lean();
    if (!row) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(row?.resendId, 'the accepted send recorded a resendId');
  assert.strictEqual(row.deliveryStatus, null, 'no delivery info until the webhook speaks');

  const res = await deliver({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: row.resendId } });
  assert.strictEqual(res.status, 200);
  const upgraded = await EmailLog.findById(row._id).lean();
  assert.strictEqual(upgraded.deliveryStatus, 'delivered');
  assert.ok(upgraded.deliveryAt);
});

test('a bounce records the reason, and a LATE delivered never repaints it', { skip }, async () => {
  const row = await seedRow('re_bounce_1');
  const bounce = await deliver({
    type: 'email.bounced',
    created_at: new Date().toISOString(),
    data: { email_id: 're_bounce_1', bounce: { message: 'The recipient address does not exist.', type: 'Permanent', subType: 'General' } },
  });
  assert.strictEqual(bounce.status, 200);
  let fresh = await EmailLog.findById(row._id).lean();
  assert.strictEqual(fresh.deliveryStatus, 'bounced');
  assert.strictEqual(fresh.deliveryDetail, 'The recipient address does not exist.');

  // Out-of-order 'delivered' after the bounce: the terminal status must stand.
  const late = await deliver({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 're_bounce_1' } });
  assert.strictEqual(late.status, 200);
  fresh = await EmailLog.findById(row._id).lean();
  assert.strictEqual(fresh.deliveryStatus, 'bounced', 'bounced is terminal — a late delivered never overwrites it');
});

test('delivered does overwrite the transient delayed', { skip }, async () => {
  const row = await seedRow('re_delay_1');
  await deliver({ type: 'email.delivery_delayed', created_at: new Date().toISOString(), data: { email_id: 're_delay_1' } });
  assert.strictEqual((await EmailLog.findById(row._id).lean()).deliveryStatus, 'delayed');
  await deliver({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 're_delay_1' } });
  assert.strictEqual((await EmailLog.findById(row._id).lean()).deliveryStatus, 'delivered');
});

test('a BAD signature is refused and touches nothing', { skip }, async () => {
  const row = await seedRow('re_sig_1');
  const res = await deliver(
    { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 're_sig_1' } },
    { badSignature: true }
  );
  assert.strictEqual(res.status, 401);
  assert.strictEqual((await EmailLog.findById(row._id).lean()).deliveryStatus, null);
});

test('a WRONG-SECRET signature is refused', { skip }, async () => {
  await seedRow('re_sig_2');
  const otherSecret = `whsec_${Buffer.from('a-completely-different-key-32bb!').toString('base64')}`;
  const res = await deliver(
    { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 're_sig_2' } },
    { secret: otherSecret }
  );
  assert.strictEqual(res.status, 401);
});

test('a STALE timestamp is refused (replay window)', { skip }, async () => {
  await seedRow('re_stale_1');
  const res = await deliver(
    { type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 're_stale_1' } },
    { timestamp: Math.floor(Date.now() / 1000) - 10 * 60 }
  );
  assert.strictEqual(res.status, 401);
});

test('no secret configured → 503, nothing processed', { skip }, async () => {
  await seedRow('re_nosecret_1');
  delete process.env.RESEND_WEBHOOK_SECRET;
  try {
    const res = await deliver({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 're_nosecret_1' } });
    assert.strictEqual(res.status, 503);
    assert.strictEqual((await EmailLog.findOne({ resendId: 're_nosecret_1' }).lean()).deliveryStatus, null);
  } finally {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  }
});

test('unknown email_id and ignored event types both answer 200 (webhooks retry on failure)', { skip }, async () => {
  const unknown = await deliver({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 're_never_logged' } });
  assert.strictEqual(unknown.status, 200);

  // Open/click tracking is deliberately not consumed — behavioral tracking stays off.
  const row = await seedRow('re_open_1');
  const opened = await deliver({ type: 'email.opened', created_at: new Date().toISOString(), data: { email_id: 're_open_1' } });
  assert.strictEqual(opened.status, 200);
  assert.strictEqual(opened.json.ignored, 'email.opened');
  assert.strictEqual((await EmailLog.findById(row._id).lean()).deliveryStatus, null);
});
