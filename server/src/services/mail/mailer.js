// Transactional email sender (Resend). Mirrors the Geocodio provider's fetch + AbortController shape
// (services/import/geocode/geocodioProvider.js) and the access-log recorder's "loud but never throws"
// semantics (services/access/supportAccess.js → recordAccess): a mail failure must never take down the
// request or job that triggered it, but it must never be silent either.
//
// DORMANT by default. BOTH RESEND_API_KEY and MAIL_FROM must be set to actually send; without them
// (every test, local dev, and a keyless prod dyno) this module NEVER touches the network — it records
// the intended send on `outbox` and returns { sent: false, disabled: true }. That lets a caller assert
// what WOULD have been sent with no live account.
//
// No Express imports on purpose: the web process AND worker.js (the retention deletion-warning job)
// both import this module.

import mongoose from 'mongoose';
import { EmailLog } from '../../models/EmailLog.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Metadata-only send log (models/EmailLog.js) — the super-admin Emails page and the
// deletion-warning evidence trail. Fire-and-forget and NEVER throws: a logging failure must not
// affect the send (or its honest return value), and a standalone script importing this module
// with no DB connection must not hang on a buffered write — hence the readyState guard.
// The two warning kinds are kept forever (expiresAt null); everything else ages out.
const KEEP_FOREVER_KINDS = new Set(['windDownWarning', 'dormancyWarning']);
const EMAIL_LOG_RETENTION_DAYS = Number(process.env.EMAIL_LOG_RETENTION_DAYS || 365);

function recordEmail({ kind, recipients, subject, outcome, error, meta, resendId }) {
  if (mongoose.connection.readyState !== 1) return;
  const sentAt = new Date();
  EmailLog.create({
    kind: kind || 'mail',
    to: recipients,
    subject,
    outcome,
    error: error || null,
    resendId: resendId || null,
    organizationId: meta?.organizationId || null,
    organizationName: meta?.organizationName || null,
    userId: meta?.userId || null,
    sentAt,
    expiresAt: KEEP_FOREVER_KINDS.has(kind)
      ? null
      : new Date(sentAt.getTime() + EMAIL_LOG_RETENTION_DAYS * 86_400_000),
  }).catch((err) => {
    console.error(`[mailer] email log write failed (${kind || 'mail'}): ${err?.message || err}`);
  });
}

// Ring buffer of the last N intended sends (dormant mode). Bounded: a keyless prod dyno that "sends"
// for weeks would otherwise leak memory one entry at a time. Oldest drops first.
const OUTBOX_CAP = 100;
export const outbox = [];

/** Empty the outbox in place (tests call this between cases). */
export function clearOutbox() {
  outbox.length = 0;
}

function pushOutbox(entry) {
  outbox.push(entry);
  if (outbox.length > OUTBOX_CAP) outbox.splice(0, outbox.length - OUTBOX_CAP);
}

// One-time warn for the half-configured deploy: a key present but no MAIL_FROM looks live yet can't
// send. Loud once, not on every attempt.
let warnedKeyNoFrom = false;
let warnedTestTransport = false;

/** True only when BOTH env vars are present — i.e. a real send to Resend will be attempted. */
export function mailEnabled() {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

// Customer-typed strings (org / campaign names) reach the Subject and the From display name. Strip
// CR/LF/TAB so nobody can inject a mail header or a second recipient line through a typed name.
function sanitizeHeader(s) {
  return String(s == null ? '' : s).replace(/[\r\n\t]/g, ' ').trim();
}

// MAIL_FROM is either "Doorline <hello@doorline.app>" or a bare address. Strip control chars from the
// display-name portion (it may carry a customer-typed name in some setups) without touching the address.
function sanitizeFrom(raw) {
  const s = String(raw || '');
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].replace(/[\r\n\t]/g, ' ').trim();
    return name ? `${name} <${m[2].trim()}>` : m[2].trim();
  }
  return s.replace(/[\r\n\t]/g, ' ').trim();
}

// o***@hotmail.com — enough to tell two recipients apart in a log line without printing the address.
// ENABLED-mode logs mask; dormant logs (dev only) may print the full address.
function maskEmail(addr) {
  const s = String(addr || '');
  const at = s.indexOf('@');
  if (at <= 0) return '***';
  return `${s[0]}***${s.slice(at)}`;
}

function toArray(to) {
  return (Array.isArray(to) ? to : [to]).filter(Boolean);
}

/**
 * Send one transactional email. NEVER throws.
 *
 * The return value is a CONTRACT the callers rely on: { sent: true } is returned ONLY on a real
 * Resend 2xx. The retention wind-down / dormancy WARNING job keys "we told this customer before we
 * delete their data" off this flag, so a false positive here would let us delete data we never warned
 * about. Every other outcome — dormant, non-2xx, thrown, aborted — is { sent: false, ... }.
 *
 * `replyTo` is optional and only used by the demo-request notice (routes/public/demoRequest.js),
 * where the message goes to US and Reply must reach the prospect instead of MAIL_FROM. It is
 * sanitized like any other header and deliberately NEVER reaches EmailLog — that log is
 * metadata-only, and this address belongs to a member of the public, not to a user of ours.
 */
export async function sendMail({ to, subject, html, text, kind, meta, replyTo } = {}) {
  const recipients = toArray(to);
  const safeSubject = sanitizeHeader(subject);
  const safeReplyTo = replyTo ? sanitizeHeader(replyTo) : null;

  if (!mailEnabled()) {
    if (process.env.RESEND_API_KEY && !process.env.MAIL_FROM && !warnedKeyNoFrom) {
      warnedKeyNoFrom = true;
      console.warn('[mailer] RESEND_API_KEY is set but MAIL_FROM is not — mail stays DORMANT (no send).');
    }
    // Dormant: log intent (full addresses are fine in dev) and stash on the ring buffer.
    console.log(`[mailer] DORMANT ${kind || 'mail'} → ${recipients.join(', ') || '(none)'} :: ${safeSubject}`);
    pushOutbox({ to: recipients, subject: safeSubject, html, text, kind, replyTo: safeReplyTo, at: new Date() });
    recordEmail({ kind, recipients, subject: safeSubject, outcome: 'dormant', meta });
    return { sent: false, disabled: true };
  }

  // Test transport: RESEND_API_KEY of 'test:accept' / 'test:reject' (with MAIL_FROM set)
  // short-circuits before the network. 'accept' emulates a Resend 2xx — outbox push plus
  // { sent: true } — which is the ONLY way tests can exercise callers that gate on real
  // delivery (the retention warning markers); 'reject' emulates a failed send. Never a real
  // key, and loud in case it ever leaks into a live config.
  if (process.env.RESEND_API_KEY === 'test:accept' || process.env.RESEND_API_KEY === 'test:reject') {
    const accept = process.env.RESEND_API_KEY === 'test:accept';
    if (!warnedTestTransport) {
      warnedTestTransport = true;
      console.warn('[mailer] TEST transport active — no real mail is being delivered.');
    }
    pushOutbox({ to: recipients, subject: safeSubject, html, text, kind, replyTo: safeReplyTo, at: new Date() });
    // Accepted test sends fabricate a resendId, so tests can drive the full accept → webhook →
    // delivery-status loop with no network (test/resendWebhook.int.test.js).
    recordEmail({
      kind, recipients, subject: safeSubject, meta,
      outcome: accept ? 'sent' : 'failed',
      error: accept ? null : 'test transport: rejected',
      resendId: accept ? `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` : null,
    });
    return accept ? { sent: true } : { sent: false, error: 'test transport: rejected' };
  }

  const from = sanitizeFrom(process.env.MAIL_FROM);
  const timeoutMs = Number(process.env.MAIL_TIMEOUT_MS || 10000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: safeSubject,
        html,
        text,
        ...(safeReplyTo ? { reply_to: safeReplyTo } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const summary = `Resend HTTP ${res.status}: ${body.slice(0, 200)}`;
      console.error(`[mailer] send FAILED (${kind || 'mail'} → ${recipients.map(maskEmail).join(', ')}): ${summary}`);
      recordEmail({ kind, recipients, subject: safeSubject, outcome: 'failed', error: summary, meta });
      return { sent: false, error: summary };
    }
    console.log(`[mailer] sent ${kind || 'mail'} → ${recipients.map(maskEmail).join(', ')} :: ${safeSubject}`);
    // Resend's 2xx body carries the email id — the key the delivery webhook joins back on.
    // Best-effort: a body we can't parse just means no delivery upgrades for this row.
    const sentBody = await res.json().catch(() => null);
    recordEmail({ kind, recipients, subject: safeSubject, outcome: 'sent', meta, resendId: sentBody?.id || null });
    return { sent: true };
  } catch (err) {
    const summary = err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (err?.message || String(err));
    console.error(`[mailer] send THREW (${kind || 'mail'} → ${recipients.map(maskEmail).join(', ')}): ${summary}`);
    recordEmail({ kind, recipients, subject: safeSubject, outcome: 'failed', error: summary, meta });
    return { sent: false, error: summary };
  } finally {
    clearTimeout(timer);
  }
}
