import mongoose from 'mongoose';

// A time-boxed, reason-bearing permission for Doorline staff to enter ONE customer organization.
//
// Before this, `isSuperAdmin` + an `X-Org-Id` header was all it took: middleware/orgContext.js set
// `req.activeOrg` with NO membership check, middleware/auth.js waved the caller past every role gate,
// and every `/admin/*` route then scoped its queries to that org. The org switcher in the web client
// listed EVERY organization on the platform. So a staff member could read any customer's full voter
// file — names, home addresses, dates of birth, party, survey answers, free-text notes, GPS trails —
// and there was no record anywhere that it had happened. morgan's `combined` format cannot capture
// the actor (its `remote-user` field is HTTP-Basic-only, and we use a bearer JWT), and it writes to
// stdout, which on Heroku is ephemeral.
//
// This is not about distrusting the operator. It is that "I can look at any customer's voter file and
// nobody, including me, could ever prove whether I did" is not a position a data processor can defend
// — to a customer, to an auditor, or in a dispute. A grant makes the access deliberate, bounded, and
// attributable. It does not remove the ability to help a customer; it makes helping them leave a
// trace.
//
// Every read of voter content under a grant is recorded in AccessLog.
const supportAccessGrantSchema = new mongoose.Schema(
  {
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    // REQUIRED, and free text on purpose. A dropdown of canned reasons becomes a formality nobody
    // reads; a sentence you had to type is something you can be asked about later.
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    // What the operator was doing. Not enforced — recorded.
    kind: {
      type: String,
      enum: ['support', 'incident', 'migration', 'audit', 'other'],
      default: 'support',
    },
    grantedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
    // Rolling count, so a grant's blast radius is visible without joining AccessLog.
    accessCount: { type: Number, default: 0 },
    lastAccessAt: { type: Date, default: null },
  },
  { timestamps: true }
);

supportAccessGrantSchema.index({ actorUserId: 1, organizationId: 1, expiresAt: -1 });

supportAccessGrantSchema.methods.isLive = function () {
  return !this.revokedAt && this.expiresAt > new Date();
};

export const SupportAccessGrant = mongoose.model('SupportAccessGrant', supportAccessGrantSchema);
