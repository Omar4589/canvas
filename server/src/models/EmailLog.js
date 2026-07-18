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
    // 'provisioningWelcome' | 'supportGrantNotice' | 'windDownWarning' | 'dormancyWarning'
    // (+ 'preview' from the dev preview script). Free string, not an enum, so a new template
    // can't crash logging by existing before this file learns about it.
    kind: { type: String, required: true, index: true },
    to: { type: [String], default: [] },
    subject: { type: String, default: '' },
    // 'sent' = Resend accepted (2xx) · 'failed' = attempted, not accepted · 'dormant' = mail
    // unconfigured, send recorded only. Mirrors sendMail's honest return, never re-derived.
    outcome: { type: String, enum: ['sent', 'failed', 'dormant'], required: true, index: true },
    error: { type: String, default: null },
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

export const EmailLog = mongoose.model('EmailLog', emailLogSchema);
