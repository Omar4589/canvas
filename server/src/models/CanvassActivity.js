import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: null },
  },
  { _id: false }
);

const canvassActivitySchema = new mongoose.Schema(
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
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, index: true },
    voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter', default: null, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    actionType: {
      type: String,
      enum: ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'note_added', 'lit_dropped', 'restricted'],
      required: true,
      index: true,
    },

    note: { type: String, default: null },

    location: { type: locationSchema, required: true },
    distanceFromHouseMeters: { type: Number, default: null },

    timestamp: { type: Date, required: true, index: true },
    wasOfflineSubmission: { type: Boolean, default: false },
    // Provenance: null = recorded in the field; 'bulk' = an admin book-level
    // bulk mark (turfs.js restrict-bulk). Bulk rows drive door status and
    // campaign-scope tallies like any other row, but are EXCLUDED from the GPS
    // audit and every per-canvasser surface (NOT_BULK in reports/aggregations).
    via: { type: String, enum: [null, 'bulk'], default: null },

    // Pass/turf/effort tags — metadata only (null = pre-turf history).
    passId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pass', default: null },
    turfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', default: null },
    effortId: { type: mongoose.Schema.Types.ObjectId, ref: 'Effort', default: null, index: true },

    // The TEAM this door belongs to: the canvasser's coordinator AT THE MOMENT THEY KNOCKED,
    // frozen here rather than looked up later.
    //
    // It used to be resolved at read time from the campaign roster, which meant (a) removing a
    // canvasser from a campaign silently moved all their doors into "No coordinator" — the bucket
    // admins deliberately EXCLUDE when reporting a team's number to a client — and (b) moving
    // anyone between teams retroactively rewrote history, so a figure quoted to a client last
    // month stopped reconciling. Freezing it makes a team's number immune to everything that
    // happens to the person afterwards: deactivation, campaign removal, org removal, deletion.
    //
    // null is MEANINGFUL, not "unknown": it's the "no coordinator" bucket (a candidate knocking
    // their own district, an admin's bulk marks). Do not backfill over an explicit null — see
    // migrations/migrateActivityCoordinator.js, which keys on {$exists:false} for exactly that
    // reason ({coordinatorId: null} would ALSO match absent fields and re-stamp deliberate nulls).
    coordinatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

canvassActivitySchema.index({ userId: 1, timestamp: -1 });
canvassActivitySchema.index({ householdId: 1, timestamp: -1 });
canvassActivitySchema.index({ campaignId: 1, timestamp: -1 });
canvassActivitySchema.index({ passId: 1, householdId: 1, timestamp: -1 }); // per-pass status derivation
canvassActivitySchema.index({ campaignId: 1, passId: 1, householdId: 1 }); // per-round knock counts (Passes page)
canvassActivitySchema.index({ userId: 1, householdId: 1, passId: 1 }); // within-pass dedup
// Org-wide, date-ranged reports (rollup/timeline/audit without a campaignId): without this they
// fall back to the single-field organizationId index and scan the org's whole ledger by date.
canvassActivitySchema.index({ organizationId: 1, timestamp: -1 });

export const CanvassActivity = mongoose.model('CanvassActivity', canvassActivitySchema);
