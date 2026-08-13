import mongoose from 'mongoose';

// Identity map: which Doorline user is which FbTime person, per organization.
// Provenance-first, following Person.uidKeySchema's shape — every link records
// HOW it came to exist (auto email match vs a human choice) and by whom,
// because the mapping decides whose measured hours land on whose leaderboard
// row, and a wrong link is a payroll-adjacent mistake someone must be able to
// trace.
//
// Auto-matching is an explicit ACTION (at connect, and a button on the mapping
// screen), never a background sweep — so an admin's deliberate unlink is never
// silently re-created behind their back.
//
// Links survive disconnect on purpose: they are the org's own mapping labor.
// The hours CACHE is what disconnecting deletes; reconnecting later finds the
// roster already mapped.
const fbTimePersonLinkSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // FbTime's person id — a 24-hex Mongo id in THEIR database. Validated at
    // the route (the provider 400s USER_ID_INVALID on malformed ids; we refuse
    // them before they ever travel).
    fbtimePersonId: { type: String, required: true },

    // Denormalized at link time for the mapping screen — a roster row must
    // still mean something if the person later disappears from /people.
    fbtimeEmail: { type: String, default: null }, // lowercased
    fbtimeName: { type: String, default: null },

    source: { type: String, enum: ['auto-email', 'manual'], required: true },
    linkedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = auto pass
    linkedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One-to-one within an organization, both directions: a Doorline user maps to
// at most one FbTime person and vice versa. Enforced in the database because
// both the auto-match pass and the manual route write links, and an invariant
// checked in one of them is an invariant missing from the other.
fbTimePersonLinkSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
fbTimePersonLinkSchema.index({ organizationId: 1, fbtimePersonId: 1 }, { unique: true });

export const FbTimePersonLink = mongoose.model('FbTimePersonLink', fbTimePersonLinkSchema);
