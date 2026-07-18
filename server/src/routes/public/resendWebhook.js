import crypto from 'node:crypto';
import { Router } from 'express';
import { EmailLog } from '../../models/EmailLog.js';

// Resend delivery webhook — upgrades EmailLog rows from "Resend accepted it" to what actually
// happened at the inbox: delivered · bounced · complained · delayed. Public by necessity
// (Resend calls it), so AUTH IS THE SIGNATURE: every request must carry a valid Svix signature
// over the RAW body (app.js mounts express.raw for exactly this path, ahead of the global JSON
// parser) with the shared RESEND_WEBHOOK_SECRET. No secret configured → 503 and process
// nothing: an unverifiable event is an unauthenticated write to the audit trail.
//
// Deliberately NOT consumed: email.opened / email.clicked. That is behavioral tracking of
// recipients — the privacy policy says we don't do it, and tracking stays off in Resend too.
//
// The join key is EmailLog.resendId (captured from the send response; the test transport
// fabricates one so the whole loop is testable offline). Unknown ids answer 200 — webhooks
// retry on failure, and an id we never logged (e.g. a dashboard test send) is not an error.
const router = Router();

// bounced/complained are TERMINAL: a late or out-of-order 'delivered' must never repaint a
// bounce as success — the evidence trail's pessimism is the trustworthy direction.
const TERMINAL = ['bounced', 'complained'];
const EVENT_STATUS = {
  'email.delivered': 'delivered',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivery_delayed': 'delayed',
};

// Svix signature scheme (what Resend signs with): base64-decode the secret after its 'whsec_'
// prefix, HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`, base64 result. The signature
// header carries one or more space-separated 'v1,<base64>' entries (key rotation) — accepting
// ANY match is the documented contract. Constant-time comparison, ±5 min timestamp window.
const TOLERANCE_SECONDS = 5 * 60;

function verifySignature({ secret, id, timestamp, signatureHeader, rawBody }) {
  if (!id || !timestamp || !signatureHeader) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  return String(signatureHeader)
    .split(' ')
    .some((entry) => {
      const [version, sig] = entry.split(',');
      if (version !== 'v1' || !sig) return false;
      const candidate = Buffer.from(sig, 'base64');
      return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
    });
}

router.post('/', async (req, res, next) => {
  try {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[resend-webhook] event received but RESEND_WEBHOOK_SECRET is not set — refusing (503).');
      return res.status(503).json({ error: 'Webhook not configured' });
    }

    // express.raw gives a Buffer; anything else means the raw mount was bypassed — refuse
    // rather than verify against a re-serialization that may not match the signed bytes.
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null;
    if (rawBody === null) {
      console.error('[resend-webhook] body was not raw — check the express.raw mount in app.js.');
      return res.status(500).json({ error: 'Misconfigured body parsing' });
    }

    const ok = verifySignature({
      secret,
      id: req.headers['svix-id'],
      timestamp: req.headers['svix-timestamp'],
      signatureHeader: req.headers['svix-signature'],
      rawBody,
    });
    if (!ok) return res.status(401).json({ error: 'Invalid signature' });

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const status = EVENT_STATUS[event?.type];
    if (!status) return res.json({ ok: true, ignored: event?.type || 'unknown' });

    const resendId = event?.data?.email_id;
    if (!resendId) return res.json({ ok: true, ignored: 'no email_id' });

    const detail =
      event?.data?.bounce?.message ||
      event?.data?.bounce?.subType ||
      event?.data?.complaint?.complaintFeedbackType ||
      null;
    const at = event?.created_at ? new Date(event.created_at) : new Date();

    // Terminal statuses always write; non-terminal ones only onto rows not already terminal.
    const query = TERMINAL.includes(status)
      ? { resendId }
      : { resendId, deliveryStatus: { $nin: TERMINAL } };
    const updated = await EmailLog.findOneAndUpdate(
      query,
      { $set: { deliveryStatus: status, deliveryAt: at, deliveryDetail: detail } },
      { new: true }
    );
    if (!updated) {
      console.log(`[resend-webhook] ${event.type} for unknown/terminal resendId ${resendId} — ignored.`);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
