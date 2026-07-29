import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sendMail } from '../../services/mail/mailer.js';
import { demoRequest as demoRequestTemplate } from '../../services/mail/templates.js';
import { nameSchema, emailSchema } from '../../utils/validators.js';

// The demo request form on the public marketing site — the ONLY conversion action on doorline.app.
//
// It replaced a `mailto:` that opened the visitor's mail client. That silently did NOTHING for
// anyone whose OS has no mail handler (webmail on a desktop browser — a large share of the buyers
// this page is written for), so the single entrance to a sales-led funnel failed invisibly.
//
// WHAT THIS COLLECTS, and why it is bounded the way it is: a name, work email, organization, and
// optional free text, volunteered by a member of the public who is not a user, not a voter, and
// not a customer. That is a data-subject class the rest of the system never sees. Two deliberate
// limits keep it from becoming one:
//
//   · NOTHING IS STORED. There is no Lead/DemoRequest model and there must not be one without a
//     privacy review — the submission becomes an email and nothing else. The only persistent
//     trace is the metadata-only EmailLog row, whose `to` is our own address, so it holds no
//     prospect PII (see the subject-line note in templates.js → demoRequest).
//   · NO THIRD PARTY. Mail goes through Resend, already a disclosed subprocessor (docs/DPA.md §6).
//     Bot protection is a honeypot plus a timing check, NOT a hosted captcha — Turnstile,
//     hCaptcha and reCAPTCHA would each be a new subprocessor, which under the signed DPA is a
//     customer-notice event, not a code decision. Keep it that way.
//
// See docs/PRIVACY_VERIFICATION.md (watchlist) and docs/MARKETING_SITE.md.

// Where the notice lands. Env-overridable so a staging deploy can point somewhere harmless
// without a code change; read per-request, per the house convention in middleware/loginRateLimit.js.
function notifyAddress() {
  return String(process.env.DEMO_REQUEST_TO || 'hello@doorline.app').trim();
}

// Unlike the auth limiters there is no email-keyed twin — a demo form has no natural key a bot
// can't fabricate — so IP plus the two shape checks below is the whole defence.
//
// The cap counts EVERY request, not just successful ones: a bot that spams invalid payloads must
// still hit a wall. That is also why it isn't tight. Only a *valid* submission sends mail, so a
// rejected one costs nothing but CPU — and a cap low enough to be "one prospect, one submission"
// would lock a real person out for an hour for mistyping their own email a few times. 20 leaves
// room for typos and for a couple of colleagues behind one office NAT, while still bounding the
// inbox to something a human can triage.
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Email hello@doorline.app instead.', code: 'rate-limited' },
});

// Bounded free text. Deliberately NOT added to utils/validators.js: that file is mirrored by hand
// into client/ and mobile/, and a demo-form-only schema there would create drift pressure for no
// reason. The caps are generous for a human and hostile to a payload.
const orgSchema = z.string().trim().min(1).max(120);
const teamSizeSchema = z.string().trim().max(40).optional();
const messageSchema = z.string().trim().max(2000).optional();

const bodySchema = z.object({
  name: nameSchema,
  email: emailSchema,
  organization: orgSchema,
  teamSize: teamSizeSchema,
  message: messageSchema,
  // The honeypot. A real form leaves it empty because it is hidden; a bot fills every input it
  // finds. Named plausibly on purpose — `company` next to a real `organization` field reads like
  // something worth filling in.
  company: z.string().max(200).optional(),
  // Milliseconds between the modal opening and submit, stamped by the client. Anything under the
  // floor was not typed by a person.
  elapsedMs: z.coerce.number().int().min(0).max(86_400_000).optional(),
});

const MIN_ELAPSED_MS = 2000;

const router = Router();

router.post('/', limiter, async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', issues: parsed.error.issues });
    }
    const { name, email, organization, teamSize, message, company, elapsedMs } = parsed.data;

    // Both bot checks answer EXACTLY what a real success answers. A bot that fills the honeypot
    // gets the same 200 as a human and learns nothing about why nothing happened; probing for the
    // difference costs it the rate limit.
    const looksAutomated = !!company || (elapsedMs !== undefined && elapsedMs < MIN_ELAPSED_MS);
    if (looksAutomated) {
      console.warn(`[demo-request] discarded automated submission (org: ${String(organization).slice(0, 40)})`);
      return res.json({ ok: true });
    }

    // AWAITED, unlike the detached send in POST /auth/forgot-password. That route answers before
    // doing any work to close an account-existence oracle; there is no oracle here, and if the
    // send fails the lead is simply LOST. So this mirrors services/memberships/resendInvite.js —
    // the send IS the request — and reports the failure so the form can offer the direct address
    // instead of showing a false success.
    const result = await sendMail({
      to: notifyAddress(),
      ...demoRequestTemplate({ name, email, organization, teamSize, message }),
      kind: 'demoRequest',
      // Reply in the inbox answers the prospect, not MAIL_FROM.
      replyTo: email,
    });

    // `disabled` is the dormant mailer (no RESEND_API_KEY / MAIL_FROM) — every test and local dev.
    // Treated as success so the form is exercisable without a live mail account; the intended send
    // is on the outbox either way.
    if (!result.sent && !result.disabled) {
      return res.status(502).json({
        error: "We couldn't send that. Please email hello@doorline.app directly.",
        code: 'send-failed',
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
