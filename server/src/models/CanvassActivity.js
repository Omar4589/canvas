import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: null },
    // GPS-audit provenance, nested here ON PURPOSE: the `replaced` snapshot below embeds
    // this schema, so correction snapshots carry it for free, and the flag detector's
    // scan projection already includes `location`. null = unknown (legacy rows, iOS for
    // mocked, old clients) — absence must never flag.
    mocked: { type: Boolean, default: null }, // Android isFromMockProvider (fake-GPS apps)
    fixTimestamp: { type: Date, default: null }, // when the OS computed the fix (vs `timestamp`, the tap)
  },
  { _id: false }
);

// Snapshot of the entry this row REPLACED ("latest wins" is a delete-then-create, which
// would otherwise destroy the prior entry's GPS evidence). Stamped server-side at write
// time only — never accepted from the request body, so a client can't forge exoneration.
// `nearest` carries the best door-presence evidence across the whole replacement chain
// (min effective distance among the prior row's own stamp and its replaced.nearest), so
// a second correction from afar can't lose the proof the first one preserved. The GPS
// audit downgrades an honest correction's "far" flag using `nearest` (flagDetection.js).
const replacedSchema = new mongoose.Schema(
  {
    actionType: { type: String, default: null },
    timestamp: { type: Date, default: null },
    location: { type: locationSchema, default: null },
    distanceFromHouseMeters: { type: Number, default: null },
    nearest: {
      distanceFromHouseMeters: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      timestamp: { type: Date, default: null },
    },
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
      enum: ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'note_added', 'lit_dropped', 'restricted', 'no_soliciting'],
      required: true,
      index: true,
    },

    note: { type: String, default: null },

    location: { type: locationSchema, required: true },
    distanceFromHouseMeters: { type: Number, default: null },
    // null = a first entry (replaced nothing); legacy rows also lack it.
    replaced: { type: replacedSchema, default: null },

    timestamp: { type: Date, required: true, index: true },
    wasOfflineSubmission: { type: Boolean, default: false },
    // Provenance: null = recorded in the field; 'bulk' = an admin DESK mark — a
    // whole book (turfs.js restrict-bulk) or a single home (restrict-doors), both
    // written by services/canvass/deskRestrict.js. Desk rows drive door status and
    // campaign-scope tallies like any other row, but are EXCLUDED from the GPS
    // audit and every per-canvasser surface (NOT_BULK in reports/aggregations).
    via: { type: String, enum: [null, 'bulk'], default: null },

    // Set when an admin REWROTE what this row says happened. `from` is the actionType this row
    // carried before, which is what Revert restores; `runId` points at the run that did it.
    // Absent on every row recorded in the field, which is also the flag both tools read: a stamped
    // row is EXCLUDED from later runs, so provenance stays exactly one level deep and a revert can
    // never land on a guess about what the original outcome was.
    //
    // `kind` decides WHICH collection runId points into, and there is deliberately ONE stamp rather
    // than two parallel ones: a second field would leave a desk-surveyed row still matching
    // `reclassified: { $exists: false }` and therefore eligible for a plain reclassify run on top —
    // exactly the compounding the single-level rule exists to forbid.
    //   'outcome'     → ReclassifyRun          (door outcome ↔ door outcome; reclassifyOutcomes.js)
    //   'to_survey'   → SurveyConversionRun    (door outcome → Surveyed;      surveyConversion.js)
    //   'from_survey' → SurveyConversionRun    (Surveyed → door outcome;      surveyConversion.js)
    // `voterIdWas` snapshots this row's voterId before a to_survey run overwrote it (a door-outcome
    // row carries none, but it is stored rather than assumed so revert restores verbatim).
    reclassified: {
      type: new mongoose.Schema(
        {
          from: { type: String, required: true },
          at: { type: Date, required: true },
          byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          runId: { type: mongoose.Schema.Types.ObjectId, required: true },
          kind: { type: String, enum: ['outcome', 'to_survey', 'from_survey'], default: 'outcome' },
          voterIdWas: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter', default: null },
        },
        { _id: false }
      ),
      default: undefined,
    },

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
// Mock-GPS nudge (campaignSummaries.openMockFlags): tiny partial index containing ONLY
// mocked rows (near-empty for honest orgs). DELIBERATE distinct key shape: buildIndexes.js
// diffs indexes by key shape alone, so a partial index reusing {campaignId:1, timestamp:-1}
// above would be reported as already-present and silently never built.
canvassActivitySchema.index(
  { campaignId: 1, 'location.mocked': 1 },
  { partialFilterExpression: { 'location.mocked': true } }
);
// Reverting a run finds its rows by stamp — twice (householdsOfRun's aggregate, then the
// updateMany). Without this both scan the campaign's whole ledger. Partial, and near-empty for
// orgs that never correct an outcome. Same distinct-key-shape rule as the mock index above.
canvassActivitySchema.index(
  { 'reclassified.runId': 1 },
  { partialFilterExpression: { 'reclassified.runId': { $exists: true } } }
);

export const CanvassActivity = mongoose.model('CanvassActivity', canvassActivitySchema);
