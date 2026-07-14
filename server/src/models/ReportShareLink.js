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
    // bcrypt hash of the per-link password.
    //
    // This is NO LONGER OPTIONAL for new links (routes/admin/clientReports.js generates one when the
    // operator doesn't supply it). It used to default to null, and share.js waved through any link
    // without one — so a published report was an OPEN, UNAUTHENTICATED URL. And what a report carries
    // is not aggregate: every map point is a household's exact street address and coordinates plus
    // that household's survey answers ("412 Elm St → Opposed"). A name is a public voter-file lookup
    // away. The token being unguessable is not access control; it is obscurity, and it survives being
    // forwarded, pasted into a group chat, or sitting in a mail archive forever.
    //
    // `default: null` stays only so the migration can identify pre-existing open links.
    passwordHash: { type: String, default: null },
    // Links now expire. There was no expiry at all: a token stayed live forever unless a human
    // remembered to revoke it, long after the campaign, the staffer and the client relationship were
    // gone. Nullable so legacy rows read as "no expiry" and the migration can find them.
    expiresAt: { type: Date, default: null, index: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastAccessedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// True for a link that predates the password+expiry rules. Used by the migration and by the admin
// UI to nag about legacy open links rather than silently breaking a client's live URL.
reportShareLinkSchema.methods.isLegacyOpen = function () {
  return !this.passwordHash || !this.expiresAt;
};

reportShareLinkSchema.index({ campaignId: 1, isActive: 1 });

export const ReportShareLink = mongoose.model('ReportShareLink', reportShareLinkSchema);
