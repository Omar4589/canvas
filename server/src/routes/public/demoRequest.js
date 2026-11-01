import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sendMail } from '../../services/mail/mailer.js';
import { demoRequest as demoRequestTemplate } from '../../services/mail/templates.js';
import { nameSchema, emailSchema } from '../../utils/validators.js';
import { DemoRequest, DEMO_REQUEST_RETENTION_DAYS } from '../../models/DemoRequest.js';
import { ROLES, TEAM_SIZES, HEARD_ABOUT, WHEN, SOURCE_PATTERN } from '../../services/site/demoOptions.js';

// The demo request form on the public marketing site — the ONLY conversion action on doorline.app.
//
// It replaced a `mailto:` that opened the visitor's mail client. That silently did NOTHING for
// anyone whose OS has no mail handler (webmail on a desktop browser — a large share of the buyers
// this page is written for), so the single entrance to a sales-led funnel failed invisibly.
//
// WHAT THIS COLLECTS, and why it is bounded the way it is: a name, work email, organization, a few
// optional selects (role, team size, how they heard of us, and on /aapc when they'd like to meet) and
// optional free text, volunteered by a member of the public who is not a user, not a voter, and not a
// customer — plus which page and ?src= tag the form was opened from. That is a data-subject class the
// rest of the system never sees, so:
//
//   · IT IS STORED, AND THE POLICY SAYS SO. Each request is saved (models/DemoRequest.js) BEFORE the
//     notice email goes out — a failed send used to lose the lead outright. The published Privacy
//     Policy names the category ("Demo requests"), its use (reply and arrange a demo) and its
//     retention (up to 24 months: a TTL on expiresAt). Super-admins read, handle and delete them on
//     /super-admin/website. docs/PRIVACY_VERIFICATION.md records it.
//   · NO THIRD PARTY. Mail goes through Resend, already a disclosed subprocessor (docs/DPA.md §6).
//     Bot protection is a honeypot plus a timing check, NOT a hosted captcha — Turnstile,
//     hCaptcha and reCAPTCHA would each be a new subprocessor, which under the signed DPA is a
//     customer-notice event, not a code decision. Keep it that way.
//
// See docs/MARKETING_SITE.md.

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
const messageSchema = z.string().trim().max(2000).optional();
// An optional select: one of its listed labels, or nothing (an empty string means "not picked").
const pick = (options) =>
  z.union([z.enum(options), z.literal('')]).optional().transform((v) => v || null);

const bodySchema = z.object({
  name: nameSchema,
  email: emailSchema,
  organization: orgSchema,
  role: pick(ROLES),
  teamSize: pick(TEAM_SIZES),
  heardAbout: pick(HEARD_ABOUT),
  when: pick(WHEN),
  message: messageSchema,
  // Where the form was opened: the page's ?src= tag and its path. Unrecognised values are dropped,
  // never rejected — attribution is a nicety, and a stray tag must not cost a lead.
  source: z.string().max(200).optional().transform((v) => {
    const s = (v || '').trim().toLowerCase();
    return SOURCE_PATTERN.test(s) ? s : null;
  }),
  page: z.string().max(200).optional().transform((v) => (typeof v === 'string' && v.startsWith('/') ? v : null)),
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
    const { company, elapsedMs, ...request } = parsed.data;
    const message = request.message || null;

    // Both bot checks answer EXACTLY what a real success answers. A bot that fills the honeypot
    // gets the same 200 as a human and learns nothing about why nothing happened; probing for the
    // difference costs it the rate limit. Nothing is stored for it either.
    const looksAutomated = !!company || (elapsedMs !== undefined && elapsedMs < MIN_ELAPSED_MS);
    if (looksAutomated) {
      console.warn(`[demo-request] discarded automated submission (org: ${String(request.organization).slice(0, 40)})`);
      return res.json({ ok: true });
    }

    // Saved FIRST, so the lead survives a failed send. A failed save (no database, a hiccup) is
    // logged and the email still goes — either one is enough to answer the prospect.
    let stored = null;
    try {
      stored = await DemoRequest.create({
        ...request,
        message,
        expiresAt: new Date(Date.now() + DEMO_REQUEST_RETENTION_DAYS * 86_400_000),
      });
    } catch (err) {
      console.error(`[demo-request] could not save (org: ${String(request.organization).slice(0, 40)}): ${err.message}`);
    }

    // AWAITED, unlike the detached send in POST /auth/forgot-password. That route answers before
    // doing any work to close an account-existence oracle; there is no oracle here, and the send's
    // outcome decides what the prospect is told when the save failed too. Mirrors
    // services/memberships/resendInvite.js — the send is part of the request.
    const result = await sendMail({
      to: notifyAddress(),
      ...demoRequestTemplate({ ...request, message }),
      kind: 'demoRequest',
      // Reply in the inbox answers the prospect, not MAIL_FROM.
      replyTo: request.email,
    });
    // `disabled` is the dormant mailer (no RESEND_API_KEY / MAIL_FROM) — every test and local dev.
    const emailOutcome = result.sent ? 'sent' : result.disabled ? 'dormant' : 'failed';
    if (stored) {
      await DemoRequest.updateOne({ _id: stored._id }, { $set: { emailOutcome } }).catch(() => {});
    }

    // Only when BOTH failed is the lead lost — then say so, so the dialog can offer the direct
    // address instead of a false success. A saved request whose email failed is still a success:
    // it waits on the Website page.
    if (!stored && emailOutcome === 'failed') {
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
