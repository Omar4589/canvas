import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: null, trim: true },
    passwordHash: { type: String, required: true },
    // "Is this person Doorline staff at all." Kept as-is so every existing check still works.
    isSuperAdmin: { type: Boolean, default: false, index: true },
    // WHICH staff. This split exists so that hiring a second person does not mean handing them an
    // omniscient login.
    //
    //   support     — the default, and least privilege. Sees the platform METADATA dashboard freely
    //                 (org / user / campaign counts, billing state, usage, health). Reaches a
    //                 customer's VOTER CONTENT only through a SupportAccessGrant: time-boxed, with a
    //                 typed reason, and every read written to AccessLog. Cannot delete an
    //                 organization, promote staff, or edit canonical identity.
    //
    //   break_glass — full platform authority (org deletion, staff promotion, identity merges). Still
    //                 needs a grant to enter a customer org, and is still logged. "No god mode"
    //                 means no unlogged mode — not no access.
    //
    // Existing super-admins default to break_glass so nothing they can do today stops working; new
    // staff should be created as `support` and escalated deliberately.
    platformRole: {
      type: String,
      enum: ['support', 'break_glass'],
      default: 'support',
    },
    isActive: { type: Boolean, default: true },
    // Set when the user deletes their own account (App Store 5.1.1(v) / Play's
    // account-deletion policy). Deliberately NOT the same thing as isActive:false:
    // deactivate is a reversible admin toggle (PATCH /:userId/password re-issues a temp
    // password and revives the account), and Apple is explicit that "only offering to
    // temporarily deactivate or disable an account is insufficient". Deletion is terminal —
    // every auth path refuses a deletedAt user and every admin write route rejects one.
    //
    // The document itself must SURVIVE: CanvassActivity.userId, SurveyResponse.userId and
    // FlagReview.reviewedBy all declare the ref as `required`, and that knock ledger is what
    // campaign counts and billing are computed from. So deletion scrubs the PII off this row
    // rather than removing it — see services/users/deleteAccount.js.
    deletedAt: { type: Date, default: null, index: true },
    // Accounts that may never be self-deleted: the App Review / Play reviewer demo logins.
    // A reviewer WILL press "Delete my account" — that is precisely what 5.1.1(v) asks them
    // to test — and an unguarded delete would destroy the demo tenant and leave the NEXT
    // submission unreviewable.
    deletionLocked: { type: Boolean, default: false },
    // When true, the user was issued a temporary password (e.g. an admin reset)
    // and must choose a new one before they can use the app. See passwordGate.js.
    mustChangePassword: { type: Boolean, default: false },
    tempPasswordSetAt: { type: Date, default: null },
    passwordResetToken: { type: String, default: null },
    passwordResetExpiresAt: { type: Date, default: null },
    // Session revocation anchor: any JWT issued BEFORE this instant is refused by requireAuth
    // (401 SESSION_REVOKED). Stamped when the USER sets a new password themselves (self-serve
    // change or emailed reset) — "I changed my password" must mean "everyone else holding my
    // old session is out." Deliberately NOT stamped by an admin temp reset: that path already
    // suspends live sessions via mustChangePassword (passwordGate.js), and the stamp lands the
    // moment the user completes the forced change. null = never changed → all tokens honored
    // (grandfathers every session issued before this field shipped).
    passwordChangedAt: { type: Date, default: null },
    // Written in exactly ONE place: POST /auth/login (routes/auth.js). It is "when they last typed
    // a password", NOT "when they were last here" — tokens live 30d (services/auth/tokens.js) and
    // the mobile app skips the login screen whenever a stored one is present, so a canvasser who
    // knocks doors every day legitimately reads "27d ago". Use lastSeenAt for the second question.
    lastLoginAt: { type: Date, default: null },
    // The real last-activity clock: stamped by requireAuth on ANY authenticated request, throttled
    // to ~15 min per user per process (middleware/lastSeen.js), so it is approximate by design.
    // Deliberately absent from toSafeJSON() below and from GET /admin/memberships: this is a
    // super-admin-only operational signal, never something an org admin can read about a member who
    // may also belong to another org. Deliberately NOT indexed — it is projected into a response
    // and is never a predicate or a sort key, so an index would buy write amplification on the
    // hottest write path in the app for no read at all. Means "this session called the API", which
    // is not proof a human tapped anything: a phone with the app open in a pocket still polls.
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, 10);
};

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
    phone: this.phone,
    isSuperAdmin: !!this.isSuperAdmin,
    platformRole: this.isSuperAdmin ? (this.platformRole || 'support') : null,
    isActive: this.isActive,
    deletedAt: this.deletedAt || null,
    mustChangePassword: !!this.mustChangePassword,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const User = mongoose.model('User', userSchema);
