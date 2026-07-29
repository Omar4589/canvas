import mongoose from 'mongoose';

// One row per transactional-email ATTEMPT, written fire-and-forget from the sendMail chokepoint
// (services/mail/mailer.js) — METADATA ONLY, never the body. Two jobs:
//
//   1. Operational visibility: the super-admin Emails page answers "what did we send, to whom,
//      did it deliver" without leaving Doorline (Resend's dashboard remains the source for
//      rendered content and bounce detail).
//   2. Evidence: the wind-down / dormancy deletion WARNINGS are legally load-bearing ("we never
//      delete unwarned" — see services/retention/triggers.js), so their rows are kept forever:
//      "we warned org X on date Y and Resend accepted it" stays provable after the org itself
//      is purged. Everything else expires via the TTL below.
//
// Retention: `expiresAt` is stamped at insert (sentAt + EMAIL_LOG_RETENTION_DAYS, default 365)
// for ordinary kinds and left NULL for the two warning kinds — the TTL index only removes rows
// whose expiresAt is a real date, so warning rows never age out. The index is declared here and,
// like every index, needs `migrate:build-indexes --apply` in prod (autoIndex is off).
const emailLogSchema = new mongoose.Schema(
  {
    // Template kind — 'passwordReset' | 'inviteSetPassword' | 'addedToOrg' | 'addedToCampaign' |
    // 'provisioningWelcome' | 'supportGrantNotice' | 'windDownWarning' | 'dormancyWarning' |
    // 'demoRequest' (+ 'preview' from the dev preview script). Free string, not an enum, so a new
    // template can't crash logging by existing before this file learns about it.
    // 'demoRequest' is the one kind whose recipient is US, not a customer — its `to` is our own
    // address and the prospect's details stay in the unlogged body (services/mail/templates.js).
    kind: { type: String, required: true, index: true },
    to: { type: [String], default: [] },
    subject: { type: String, default: '' },
    // 'sent' = Resend accepted (2xx) · 'failed' = attempted, not accepted · 'dormant' = mail
    // unconfigured, send recorded only. Mirrors sendMail's honest return, never re-derived.
    outcome: { type: String, enum: ['sent', 'failed', 'dormant'], required: true, index: true },
    error: { type: String, default: null },
    // Resend's id for this email (from the 2xx response body) — the join key the delivery
    // webhook uses to upgrade this row from "accepted" to what actually happened. The test
    // transport fabricates one so the full accept→webhook loop is testable offline.
    resendId: { type: String, default: null },
    // What the inbox side reported, via the signed Resend webhook (routes/public/resendWebhook.js):
    // delivered · bounced · complained · delayed. null = no webhook event yet (or webhooks not
    // configured). bounced/complained are TERMINAL — a late 'delivered' never overwrites them.
    deliveryStatus: { type: String, enum: [null, 'delivered', 'bounced', 'complained', 'delayed'], default: null },
    deliveryAt: { type: Date, default: null },
    // Human-readable detail for the bad outcomes (bounce reason, complaint type).
    deliveryDetail: { type: String, default: null },
    // Attribution when the caller knows it — the org an org-level notice concerns, the user a
    // personal email addresses. Optional: some sends have only one or neither.
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    // Name SNAPSHOT at send time: the deletion-warning evidence rows must stay legible after
    // the org itself is purged (the whole point of keeping them), and a populate against a
    // deleted org returns null. Ordinary rows benefit too (renames don't rewrite history).
    organizationName: { type: String, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sentAt: { type: Date, required: true },
    // Null = keep forever (the deletion-warning evidence rows). TTL removes only real dates.
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

emailLogSchema.index({ sentAt: -1 });
emailLogSchema.index({ organizationId: 1, sentAt: -1 });
emailLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// The webhook's lookup key. Sparse: only rows that actually went through Resend carry one.
emailLogSchema.index({ resendId: 1 }, { sparse: true });

export const EmailLog = mongoose.model('EmailLog', emailLogSchema);
