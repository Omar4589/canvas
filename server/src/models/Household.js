import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: undefined },
  },
  { _id: false }
);

// Set aside from the Pin Fixes queue and from every book cut (services/households/setAsidePin.js, the ONE
// writer): who and when. Presence is tested on `.at`, the pinPlacement pattern.
const pinSetAsideSchema = new mongoose.Schema(
  {
    at: { type: Date },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

// The record of the latest time this door left a judged shared spot (pinPlacement below). A
// sub-schema with `default: undefined` rather than a plain nested path: a nested path would give
// every household `from: []`, and presence is always tested on `.at`.
const pinPlacementSchema = new mongoose.Schema(
  {
    from: { type: [Number], default: undefined }, // [lng, lat] it left
    to: { type: [Number], default: undefined }, // [lng, lat] it went to
    at: { type: Date },
    kind: { type: String, enum: ['placeholder', 'stray', 'far', 'unlocated', 'complex'] }, // the flag it left
    by: { type: String, enum: ['lookup', 'person', 'file'] },
    // The answer class the lookup placed with (services/households/pinTrust.js answerClass). Kept apart
    // from `kind` on purpose: the revert path writes `kind` back into pinSuspect, and an answer class
    // must never land there. Lookup only; absent on records written before the pin-fixes build.
    answer: { type: String, enum: ['exact', 'estimate', 'street'] },
    accuracyType: { type: String }, // the lookup's answer type; lookup only
    stackSize: { type: Number }, // the spot's other homes at that moment
    releasedAt: { type: Date }, // it later left `to` without a person moving it
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
    // (geocoded), 'corrected' (a canvasser/admin moved the pin — see updateHouseholdLocation), or
    // 'holding' (no usable coordinate and the address lookup found nothing: a Doorline-derived spot in
    // the home's ZIP that is deliberately NOT the home — services/import/holdingSpot.js; it always
    // travels with pinSuspect 'unlocated').
    // coordConfidence is the geocoder's precision ('exact' rooftop vs 'interpolated'); null for
    // file-supplied and corrected coords. Lets the map/turf tooling flag and re-verify pins.
    coordSource: { type: String, default: null },
    coordConfidence: { type: String, default: null },
    // Pin-correction provenance (set only when coordSource === 'corrected').
    correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    correctedAt: { type: Date, default: null },
    previousLocation: { type: pointSchema, default: null }, // the pre-correction point (context/undo)
    // Confirm-in-place (the Pin Fixes queue): a campaign manager checked this door's
    // interpolated geocode against imagery/Google Maps and vouched the pin is right WITHOUT
    // moving it. coordConfidence stays 'interpolated' — the geocoder's honest verdict — and
    // the stamp is what removes the door from the needs-fixing set and the amber ring. A
    // confirmed pin is still the geocoder's answer, never a human-PLACED one: audit code
    // (far-flag downgrade) must keep keying on coordSource === 'corrected', not this.
    // Cleared by any real pin move (updateHouseholdLocation) and by an import overwrite of
    // the pin when the hand-edit shield is disarmed (csvImporter, overwriteHandEdits).
    locationConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    locationConfirmedAt: { type: Date, default: null },
    // Shared map spots (services/households/placeStackedPins.js; docs/PROPOSAL_PLACEHOLDER_PINS.md §C).
    // pinSuspect: this door's coordinate was judged to be one of several different homes a vendor
    // stamped with one coordinate ('placeholder'), or a different address on a building's spot
    // ('stray'), and nothing has positively cleared it since. NO default: mongoose writes schema
    // defaults into bulk upsert inserts. Sticky — only a writer that moves the door off the spot
    // clears it, and the pass only on positive evidence. A confirm keeps it: "unplaced now" is
    // pinSuspect && !locationConfirmedAt (isPinUnplaced), so an Undo of the confirm restores the door.
    //
    // The pin-fixes build (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S3.1) adds three kinds:
    //   'far'       — the pin sits far from the other homes on its street (or in its ZIP); recomputed by
    //                 every pass from the cohort, never sticky;
    //   'unlocated' — no usable coordinate and the lookup found nothing: parked at a holding spot; sticky;
    //   'complex'   — the vendor's spot and an exact lookup answer agree this home shares one point with
    //                 other addresses (a condo complex). NOT unplaced: isPinUnplaced excludes it, every map
    //                 still needs the fact, so it is sent whether or not a lead has vouched. Sticky until
    //                 a writer moves the door off the spot.
    pinSuspect: { type: String, enum: ['placeholder', 'stray', 'far', 'unlocated', 'complex'] },
    // The ~1.1 m key of the complex's point, set with pinSuspect 'complex' and $unset with it. The one
    // field the Pin Fixes complexes list, the sidebar count and the spot-scope vouch group on.
    pinComplexKey: { type: String },
    // Set aside: see pinSetAsideSchema above. Rides excludedFromTurf (every cut, count, phone and packet
    // already honours it); Re-include apartments never clears a door carrying this stamp.
    pinSetAside: { type: pinSetAsideSchema, default: undefined },
    // Written by the pass when it places the door (by 'lookup'), by updateHouseholdLocation when a
    // person moves a flagged door ('person'), and by an import whose file moves a flagged door
    // ('file'). Never $unset. "Currently placed by the lookup" = by 'lookup', no releasedAt, and
    // coordSource still 'geocodio'.
    pinPlacement: { type: pinPlacementSchema, default: undefined },
    // Building keys the collapse check distrusted for this door: an answer landing on one is refused,
    // so a re-import can't put the door back on a point two addresses claimed. $addToSet only.
    pinDistrustedKeys: { type: [String], default: undefined },

    status: {
      type: String,
      enum: ['unknocked', 'not_home', 'surveyed', 'wrong_address', 'refused', 'lit_dropped', 'restricted', 'no_soliciting', 'not_target'],
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
// Pin Fixes queue: list + badge count of interpolated doors not yet human-confirmed. The
// partial filter carries only the constant term (a `locationConfirmedAt: null` inside a
// partialFilterExpression works on newer servers but matches no repo precedent and pins a
// server-version floor nothing else pins); the null test rides the KEY bounds instead, which
// measures just as selective. Key deliberately NOT bare {campaignId: 1}: the buildIndexes
// dry run dedupes by key pattern alone, so a duplicate key would falsely report "present".
householdSchema.index(
  { campaignId: 1, locationConfirmedAt: 1 },
  { partialFilterExpression: { coordConfidence: 'interpolated' } }
);
// Pin Fixes' second set: doors on a shared spot (pinSuspect) not yet confirmed. A distinct key
// pattern from the index above, for the same buildIndexes dedupe reason.
householdSchema.index(
  { campaignId: 1, pinSuspect: 1 },
  { partialFilterExpression: { pinSuspect: { $type: 'string' } } }
);

export const Household = mongoose.model('Household', householdSchema);
