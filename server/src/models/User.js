import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: null, trim: true },
    passwordHash: { type: String, required: true },
    isSuperAdmin: { type: Boolean, default: false, index: true },
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
    lastLoginAt: { type: Date, default: null },
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
    isActive: this.isActive,
    deletedAt: this.deletedAt || null,
    mustChangePassword: !!this.mustChangePassword,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const User = mongoose.model('User', userSchema);
