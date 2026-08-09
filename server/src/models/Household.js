import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: undefined },
  },
  { _id: false }
);

const householdSchema = new mongoose.Schema(
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

    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, default: null, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true, uppercase: true },
    zipCode: { type: String, required: true, trim: true },
    county: { type: String, default: null, trim: true },

    normalizedAddress: { type: String, required: true, index: true },

    location: { type: pointSchema, default: null },
    // How the coordinates were obtained: 'file' (supplied in the import), 'geocodio'
    // (geocoded), or 'corrected' (a canvasser/admin moved the pin — see updateHouseholdLocation).
    // coordConfidence is the geocoder's precision ('exact' rooftop vs 'interpolated'); null for
    // file-supplied and corrected coords. Lets the map/turf tooling flag and re-verify pins.
    coordSource: { type: String, default: null },
    coordConfidence: { type: String, default: null },
    // Pin-correction provenance (set only when coordSource === 'corrected').
    correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    correctedAt: { type: Date, default: null },
    previousLocation: { type: pointSchema, default: null }, // the pre-correction point (context/undo)

    status: {
      type: String,
      enum: ['unknocked', 'not_home', 'surveyed', 'wrong_address', 'refused', 'lit_dropped', 'restricted', 'no_soliciting'],
      default: 'unknocked',
      index: true,
    },
    isActive: { type: Boolean, default: true },

    lastActionAt: { type: Date, default: null },
    lastActionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Denormalized cut attributes (turf-cutting). *Value = modal voter value;
    // cutConflicts flags attributes where the household's voters disagree.
    precinctValue: { type: String, default: null },
    congressionalValue: { type: String, default: null },
    stateSenateValue: { type: String, default: null },
    stateHouseValue: { type: String, default: null },
    cityValue: { type: String, default: null },
    zipValue: { type: String, default: null },
    countyValue: { type: String, default: null },
    cutConflicts: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Which EFFORT owns this door (null = Intake — newly imported / unassigned,
    // not yet canvassable). Source of truth for door ownership + per-effort
    // coverage; a door belongs to at most one effort (disjointness).
    effortId: { type: mongoose.Schema.Types.ObjectId, ref: 'Effort', default: null, index: true },

    // Turf membership mirror (set by turf generation / edits).
    turfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', default: null },
    walkOrder: { type: Number, default: null },

    // Early voting: true when EVERY voter at this address has already voted, so
    // the door drops off the canvasser's map/books (recomputed on voted-import).
    fullyVoted: { type: Boolean, default: false, index: true },

    // Do-not-contact: true when EVERY voter at this address is flagged do-not-contact, so the
    // door drops off cutting, books, and the CANVASSER's map/list for ALL campaign types (lit
    // drop included — "never come to my door" covers literature). Derived ONLY by
    // services/dnc/recomputeFullyDnc.js; a voter-less door is never fullyDnc (the ≥1-voter guard).
    //
    // The ADMIN map deliberately still shows it (routes/admin/households.js does not filter on
    // this): that map is the record of work performed and billed, and hiding a surveyed pin
    // because the voter later opted out would erase delivered work from the person paying for it.
    // The rule the whole feature turns on: this flag answers "where may we go NEXT", never
    // "what did we DO" — which is why no report or billing query reads it (the sole exception is
    // the coverage bucket, and only for doors that were never knocked).
    fullyDnc: { type: Boolean, default: false, index: true },

    // Do-not-knock: the residents asked that NOBODY come to this door again. Same suppression
    // reach as fullyDnc (cutting, books, canvasser map/list, walk packets, all campaign types),
    // and the same "where may we go NEXT, never what did we DO" rule — the admin map still shows
    // it, and no report or billing query reads it (sole exception: the coverage bucket, and only
    // for doors never knocked).
    //
    // NOT derived from the voters — mirrored from the org-level DoNotKnockAddress record, which
    // is the source of truth (see that model for why a bare boolean here cannot work). Written
    // ONLY by services/dnc/recomputeDoNotKnock.js.
    //
    // Two deliberate divergences from fullyDnc:
    //   1. One resident's request suppresses the whole address — fullyDnc needs EVERY voter flagged.
    //   2. It NEVER auto-reopens. fullyDnc reopens when a new resident is imported (they asked for
    //      nothing); this request was about the ADDRESS, so a file refresh showing new names is not
    //      consent. Only an explicit admin clear reopens it.
    doNotKnock: { type: Boolean, default: false, index: true },

    // Admin-excluded from turf (e.g. "remove apartments"): like fullyVoted, these doors are
    // skipped from cutting, book door counts, the canvasser list, and printed packets — via
    // KNOCKABLE_DOOR_FILTER, which reads this flag UNSCOPED. So exclusion is campaign-wide:
    // the stamp records no effort/pass/actor, and the door is uncuttable in every effort until
    // POST /admin/turfs/include-apartments clears it on whichever effort owns it now.
    //
    // NOT skipped from the ADMIN MAP — that map is the record of what exists and what was
    // worked, so an excluded door stays visible and merely rides a flag (same rule as
    // doNotKnock; see docs/MAPS.md §I). This comment used to claim "the map" and was the
    // sentence that seeded the same error in PASSES_AND_TURF.md.
    excludedFromTurf: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

householdSchema.index({ location: '2dsphere' });
householdSchema.index({ campaignId: 1, normalizedAddress: 1 }, { unique: true });
householdSchema.index({ campaignId: 1, precinctValue: 1 });
householdSchema.index({ campaignId: 1, countyValue: 1 });
householdSchema.index({ campaignId: 1, cityValue: 1 });
householdSchema.index({ turfId: 1, walkOrder: 1 });
householdSchema.index({ campaignId: 1, effortId: 1 }); // per-effort ownership / coverage / intake
// Admin map + campaignSummaries filter on campaignId + isActive (isActive was unindexed, so the
// map's active-household filter rode the campaignId index alone and residual-scanned isActive).
householdSchema.index({ campaignId: 1, isActive: 1 });

export const Household = mongoose.model('Household', householdSchema);
