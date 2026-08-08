import mongoose from 'mongoose';

// "Nobody comes to this door again" — an org-wide, campaign-transcending request attached to an
// ADDRESS, not a person. The source of truth for Household.doNotKnock (which is only a mirror).
//
// Why this lives here and not as a plain boolean on Household: Household rows are PER-CAMPAIGN
// ({campaignId, normalizedAddress} unique), so a boolean alone fails three ways — it misses the
// sibling campaign's row for the same address, it dies when a campaign is deleted, and an address
// re-imported into a NEW campaign arrives unsuppressed. Those are the exact three failures
// per-campaign Voter rows forced person-level DNC to solve with sibling fan-out + DncPendingId.
// Keying by {organizationId, normalizedAddress} instead solves all three at once, and makes
// campaign deletion a no-op (nothing to park — compare deleteCampaign.js's DNC parking block).
//
// Distinct from Voter.doNotContact in BOTH directions and deliberately so: suppressing a door
// never flags its residents (someone who moves away carries no mark from a request about a house
// they left), and flagging a resident never suppresses the door (that stays fullyDnc's job, which
// requires EVERY voter flagged).
const doNotKnockAddressSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },

    // The EXACT key — byte-identical to Household.normalizedAddress (utils/normalizeAddress.js).
    // This is the only key ever used to match doors. See looseKey below for why.
    normalizedAddress: { type: String, required: true, trim: true },

    // ADVISORY ONLY, never a match key. looseAddressKey() collapses formatting drift
    // ("123 N MAIN ST" vs "123 NORTH MAIN STREET") which the exact key does not, so two campaigns
    // whose source files disagree on formatting produce different normalizedAddress values and
    // sibling fan-out misses. Auto-suppressing on this key would eventually darken a NEIGHBOUR's
    // door on a formatting coincidence — a silent false positive with nobody to catch it. So it
    // feeds an admin "these may be the same address" review prompt and nothing else. Its own
    // definition says it: "never used as an upsert key — that stays exact normalizeAddress".
    looseKey: { type: String, default: null, trim: true, index: true },

    // Human-readable copy of the address AS IT STOOD when suppressed. Denormalized on purpose:
    // the record has to outlive every Household row that carries these fields (campaign delete),
    // and the admin review list must still be able to name the door it is showing.
    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, default: null, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true, uppercase: true },
    zipCode: { type: String, required: true, trim: true },

    // Required, min 3 chars at the route — the same bar the DNC flag sets. Suppressing a door is
    // never anonymous and never silent.
    reason: { type: String, required: true, trim: true },
    // Which management role set it. Canvassers CANNOT set this (ruling): the request reaches us at
    // the door but the decision to darken an address org-wide and permanently is a management one.
    source: { type: String, enum: ['admin', 'lead', 'super'], required: true },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },

    // Context only, NEVER scope: which campaign the setter was looking at. The suppression itself
    // is org-wide — reading this as a filter would reintroduce the per-campaign bug the whole
    // model exists to avoid.
    campaignIdAtSet: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
  },
  { timestamps: true }
);

// The upsert key + the suppression lookup. Unique: one standing request per address per org.
doNotKnockAddressSchema.index({ organizationId: 1, normalizedAddress: 1 }, { unique: true });
// Admin review list (newest first).
doNotKnockAddressSchema.index({ organizationId: 1, createdAt: -1 });

export const DoNotKnockAddress = mongoose.model('DoNotKnockAddress', doNotKnockAddressSchema);
