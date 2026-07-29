import { test, before, after } from 'node:test';
import assert from 'node:assert';

// The public demo form — the site's only conversion action. Deliberately NOT an .int test: it
// needs no database (EmailLog's writer no-ops when mongoose isn't connected), so it runs on plain
// `npm test` and can never silently skip. The properties below are the ones that would regress
// quietly and expensively:
//
//   · the two bot checks must be INDISTINGUISHABLE from success, or the form becomes an oracle
//     that tells a bot which of its submissions got through;
//   · the subject must carry the organization and NOTHING else, because subjects are copied
//     verbatim into EmailLog — that is the whole reason the prospect's name and address live in
//     the body, which is never logged;
//   · Reply must reach the prospect, not MAIL_FROM;
//   · a customer-typed org name must not be able to inject a mail header.
//
// Mail runs through the test transport (RESEND_API_KEY=test:accept), which emulates a Resend 2xx
// without touching the network, so `outbox` is what WOULD have been sent.
//
// The router is mounted on a bare Express app rather than through createApp(): createApp()
// eagerly builds the bull-board queues (live ioredis handles), which is why every suite that
// boots the real app must be an .int test reaped by the harness's --test-force-exit. Mounting
// the router directly keeps plain `npm test` Redis-free — the invariant buildStatus.int.test.js
// spells out — at the cost of not exercising the mount path in routes/index.js, which is one
// line and covered by the production smoke check in docs/MARKETING_SITE.md.
process.env.RESEND_API_KEY = 'test:accept';
process.env.MAIL_FROM = 'Doorline <notifications@doorline.app>';
process.env.DEMO_REQUEST_TO = 'demo-inbox@doorline.app';

const express = (await import('express')).default;
const demoRequestRouter = (await import('../src/routes/public/demoRequest.js')).default;
const { outbox, clearOutbox } = await import('../src/services/mail/mailer.js');

const VALID = {
  name: "Dana O'Neill",
  email: 'dana@bryant-fox.org',
  organization: 'Bryant & Fox Strategies',
  teamSize: '11–50',
  message: 'Three state races this cycle.',
  elapsedMs: 45_000,
};

let server;
let base;

// One before() hook for the file — the harness convention here; a second one silently replaces it.
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/demo-request', demoRequestRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/demo-request`;
});

// closeAllConnections() before close() is load-bearing: Node's global fetch keeps its sockets
// alive, and server.close() waits on them forever. Without this the file needs the int harness's
// --test-force-exit to terminate, and plain `npm test` would hang here.
after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

// The endpoint allows 20 requests/hour per IP and every test here shares 127.0.0.1, so this file
// must stay well under that. It currently spends 6.
const post = async (body) => {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('a valid submission mails the notice, with Reply pointed at the prospect', async () => {
  clearOutbox();
  const res = await post(VALID);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { ok: true });

  assert.strictEqual(outbox.length, 1, 'exactly one mail queued');
  const [mail] = outbox;
  assert.deepStrictEqual(mail.to, ['demo-inbox@doorline.app'], 'goes to DEMO_REQUEST_TO, not the prospect');
  assert.strictEqual(mail.replyTo, VALID.email, 'Reply answers the prospect');
  assert.strictEqual(mail.kind, 'demoRequest');

  // Every field reaches the body, in BOTH halves — asserted per half rather than on a
  // concatenation, so one side dropping out can't hide behind the other.
  for (const [half, content] of [['html', mail.html], ['text', mail.text]]) {
    assert.ok(content.includes('dana@bryant-fox.org'), `email address in ${half}`);
    assert.ok(content.includes('Three state races this cycle.'), `message in ${half}`);
  }
});

test('the subject carries the organization and no other personal detail', async () => {
  clearOutbox();
  await post(VALID);
  const { subject } = outbox[0];
  assert.strictEqual(subject, 'Demo request — Bryant & Fox Strategies');
  // EmailLog copies the subject verbatim and is readable on the super-admin Emails page, so a
  // name or address here would put prospect PII into a 365-day log.
  assert.ok(!subject.includes('Dana'), 'no prospect name in the subject');
  assert.ok(!subject.includes('@'), 'no email address in the subject');
});

test('a filled honeypot is answered exactly like a success, and sends nothing', async () => {
  clearOutbox();
  const res = await post({ ...VALID, company: 'spam-bot-inc' });
  assert.strictEqual(res.status, 200, 'same status as a real success');
  assert.deepStrictEqual(res.body, { ok: true }, 'same body as a real success');
  assert.strictEqual(outbox.length, 0, 'no mail sent');
});

test('a submission faster than a human could type is answered the same way, and sends nothing', async () => {
  clearOutbox();
  const res = await post({ ...VALID, elapsedMs: 250 });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { ok: true });
  assert.strictEqual(outbox.length, 0, 'no mail sent');
});

test('invalid input is rejected outright and never reaches the mailer', async () => {
  clearOutbox();
  const badEmail = await post({ ...VALID, email: 'not-an-email' });
  assert.strictEqual(badEmail.status, 400);
  assert.strictEqual(badEmail.body.error, 'Invalid input');
  assert.strictEqual(outbox.length, 0);
});

test('CRLF in a typed organization name cannot inject a mail header', async () => {
  clearOutbox();
  const res = await post({ ...VALID, organization: 'Acme\r\nBcc: evil@example.com' });
  assert.strictEqual(res.status, 200);
  assert.ok(!/[\r\n]/.test(outbox[0].subject), 'subject carries no bare CR/LF');
});
