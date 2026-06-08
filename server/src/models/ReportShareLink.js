import mongoose from 'mongoose';

// A public, revocable, optionally-password-protected link to a campaign's published client reports.
// Replaces per-client login accounts: the operator shares `/r/<token>` and anyone with it sees the
// campaign's report hub (latest + history). The token is an unguessable capability string; a
// password (bcrypt) adds a second factor; rotate = new token, revoke = isActive:false. See
// docs/CLIENT_PORTAL.md and routes/public/share.js.
const reportShareLinkSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    // Opaque capability token in the URL (crypto.randomBytes base64url). Unique + indexed.
    token: { type: String, required: true, unique: true },
    label: { type: String, default: '', trim: true },
    // bcrypt hash of the optional per-link password; null = open link.
    passwordHash: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastAccessedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

reportShareLinkSchema.index({ campaignId: 1, isActive: 1 });

export const ReportShareLink = mongoose.model('ReportShareLink', reportShareLinkSchema);
