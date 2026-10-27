import mongoose from 'mongoose';

const importJobSchema = new mongoose.Schema(
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
    filename: { type: String, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['pending', 'parsing', 'geocoding', 'linking', 'importing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    // Liveness + stage detail for the stuck-job expiry (GET /:importId and the
    // nightly sweep). A worker OOM-abort skips every catch, so the doc can freeze
    // in an active status — heartbeatAt is how a reader tells alive from dead.
    heartbeatAt: { type: Date, default: null },
    // Finer-grained than status (e.g. 'diffing' while a preview's status is
    // 'parsing'): queued|parsing|geocoding|linking|diffing|importing.
    phase: { type: String, default: null },
    // Terminal failure detail written by the worker's `failed` listener when
    // BullMQ exhausts retries — reconciles Redis-only failures back into Mongo.
    lastError: { type: String, default: null },
    totalRows: { type: Number, default: 0 },
    uniqueVoters: { type: Number, default: 0 },
    uniqueHouseholds: { type: Number, default: 0 },
    newVoters: { type: Number, default: 0 },
    updatedVoters: { type: Number, default: 0 },
    newHouseholds: { type: Number, default: 0 },
    // Re-housing audit: voters whose household changed, and doors emptied + deactivated by it.
    movedVoters: { type: Number, default: 0 },
    deactivatedDoors: { type: Number, default: 0 },
    // Geocoding audit (when GEOCODE_ENABLED): coords newly geocoded, served from cache,
    // addresses that couldn't be placed (unmatched), and transient provider errors (failed).
    geocodedNew: { type: Number, default: 0 },
    geocodedCached: { type: Number, default: 0 },
    geocodeUnmatched: { type: Number, default: 0 },
    geocodeFailed: { type: Number, default: 0 },
    // Homes that arrived WITH lat/long in the file (no paid lookup needed). Only geocodedNew is
    // billable; this + geocodedCached are free. Powers the super-admin Imports cost review.
    householdsWithFileCoords: { type: Number, default: 0 },
    // Addresses whose rows asserted DIFFERENT pins. Resolved by majority / state bounds;
    // `Ties` is the subset the file could not settle, which kept the first row's pin and
    // is what `repair:import-pins` adjudicates. Recorded because the old rule silently
    // took whichever row sorted first — a door could land miles away with no trace.
    coordConflicts: { type: Number, default: 0 },
    coordConflictTies: { type: Number, default: 0 },
    // Placeholder coordinates: pins where doors from several DIFFERENT streets share one
    // exact spot (a vendor stamped a centroid on addresses it couldn't place), plus stray
    // doors parked on some other street's building. Warned in the preview; adjudicated
    // after import by `repair:import-pins` — never nulled at import (a suspect pin walks,
    // a geocoder-dropped door doesn't).
    placeholderPins: { type: Number, default: 0 },
    placeholderPinDoors: { type: Number, default: 0 },
    // Doors on an apartment building's or park's spot with a different street address (the preview's
    // "N homes sit on a building's spot" line). Placeholder doors are placeholderPinDoors above.
    strayPinDoors: { type: Number, default: 0 },
    // Coordinates the import refused (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S4.4), FILE-scoped and
    // door-weighted, computed by the preview's finish() and re-saved at apply from the same function: rows
    // at 0,0, rows outside their own state, homes pinned far from their street (the cohort rule over this
    // file's homes), and homes with no street address to look up (reported; never looked up).
    offWorldDoors: { type: Number, default: 0 },
    outsideStateDoors: { type: Number, default: 0 },
    farPinDoors: { type: Number, default: 0 },
    unlocatableDoors: { type: Number, default: 0 },
    // The placement pass's outcome for THIS file's homes (services/households/placeStackedPins.js),
    // $set from state at the end: placed by the address lookup at a rooftop or point; placed "in
    // place" (the lookup confirmed the spot they already had); still without an exact spot (Pin Fixes).
    pinsPlacedExact: { type: Number, default: 0 },
    pinsConfirmedInPlace: { type: Number, default: 0 },
    pinsStillUnplaced: { type: Number, default: 0 },
    // The pin-fixes build's outcome counts: placed on the street (an estimate, listed Approximate), in a
    // complex, parked at a holding spot (a subset of still-unplaced), and far marks this pass set anywhere
    // in the campaign (so the line can say "N flagged far — look them up").
    pinsPlacedApprox: { type: Number, default: 0 },
    pinsComplex: { type: Number, default: 0 },
    pinsUnlocated: { type: Number, default: 0 },
    pinsFarMarked: { type: Number, default: 0 },
    // Lookup spend for the pass. New = bought ($inc after each provider chunk); cached and over-ceiling
    // are a final $set (an $inc would double-count cache hits on a retry). Hidden from organizations.
    pinLookupsNew: { type: Number, default: 0 },
    pinLookupsCached: { type: Number, default: 0 },
    pinLookupsOverCap: { type: Number, default: 0 },
    // The ceiling's ledger: household ids already sent to the provider by this import ($addToSet per
    // chunk), so a retried job never charges the same home twice. Hidden everywhere.
    pinProbedIds: { type: [String], default: undefined },
    // kind 'pin_lookup' only: the household ids Look up by address was asked to look up. Hidden from
    // organizations with the other ledgers.
    pinLookupTargets: { type: [String], default: undefined },
    // Doors whose lookup placement this import's file merely echoed back, so the placed pin was kept.
    keptPlacements: { type: Number, default: 0 },
    // The pass's org-visible line when it didn't finish (generic, never a provider message), and the
    // full cause for the super-admin page only: a fixed provider cause ("HTTP 401", "timeout",
    // "network: ENOTFOUND", "bad response (not JSON)", an error name), "busy: …", or a thrown
    // non-provider message. Never written to lastError, which organizations read.
    pinPassError: { type: String, default: null },
    pinPassCause: { type: String, default: null },
    // Households the incoming voters lived at BEFORE this import (captured pre-apply).
    // Persisted so a BullMQ retry — which would re-read post-move state — still knows
    // which doors to re-check for emptiness. Source of retry-safe orphan deactivation.
    sourceHouseholdIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Household', default: [] },
    // Both doors of every move this import made (the one an incoming voter left and the one they landed in),
    // read right after the write. Persisted for the same reason as sourceHouseholdIds: a retry re-reads
    // post-move state, where nobody looks moved, yet these doors still need their resident-derived flags
    // (fullyVoted, fullyDnc) recomputed — a voted voter who moved can finish the door they joined or the one
    // they left (importProcessor.js).
    movedHouseholdIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Household', default: [] },
    // Exact docs this import INSERTED (net-new), captured from the upsert's upsertedIds.
    // Power the "undo import" — only these, and only if still untouched, can be removed.
    insertedHouseholdIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Household', default: [] },
    insertedVoterIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Voter', default: [] },
    undone: { type: Boolean, default: false },
    undoneAt: { type: Date, default: null },
    undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    undoResult: {
      doorsDeleted: { type: Number, default: 0 },
      doorsSkipped: { type: Number, default: 0 },
      votersDeleted: { type: Number, default: 0 },
      votersSkipped: { type: Number, default: 0 },
    },
    duplicateStateVoterIds: { type: [String], default: [] },
    errors: { type: [mongoose.Schema.Types.Mixed], default: [] },
    errorCount: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // Async queue execution (M1).
    progress: { type: Number, default: 0 },
    processedRows: { type: Number, default: 0 },
    queueJobId: { type: String, default: null },
    // Column mapping used for this import (resolved canonical -> vendor column).
    importProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportProfile', default: null },
    fieldMapping: { type: mongoose.Schema.Types.Mixed, default: null },
    // Smart import: explode multi-voter-per-row files? Persisted so the worker
    // apply explodes identically to what the preview showed.
    explode: { type: Boolean, default: true },
    // Vendor namespace for this import's uid column (shared voter DB matching).
    uidSource: { type: String, default: null },
    // Opt-in: when a new target voter lands in a home already WORKED this campaign,
    // collect those homes into a saved search so the admin can cut a fresh (billable)
    // revisit round. `revisitSavedSearchId` is set once (idempotency guard + UI link).
    revisitNewVoters: { type: Boolean, default: false },
    revisitSavedSearchId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedSearch', default: null },
    revisitHouseholdCount: { type: Number, default: 0 },
    // Hand-edit conflicts: the admin's per-import "keep or overwrite" decision, plus the outcome —
    // (voter, field) instances where the file disagreed with an armed hand edit (kept by default;
    // overwritten + disarmed when the admin opted in on the preview panel).
    overwriteHandEdits: { type: Boolean, default: false },
    keptHandEdits: { type: Number, default: 0 },
    overwrittenHandEdits: { type: Number, default: 0 },
    // Households whose human-corrected map pin this import left alone (the same
    // overwriteHandEdits opt-in releases it, so a pin is a hand edit like any other).
    keptPins: { type: Number, default: 0 },
    // Households whose confirm-in-place vouched pin (Pin Fixes, locationConfirmedAt) this
    // import left alone. Counted apart from keptPins so that number keeps meaning
    // "human-corrected pins kept" — the two are different promises.
    keptConfirmed: { type: Number, default: 0 },
    // 'apply' = the real import (default; old docs read as apply). 'preview' = a
    // read-only diff run on the worker for large files (stores `diff`, no writes).
    // 'pin_lookup' = Pin Fixes' "Look up by address": no file, no rows — the placement pass on a set of the
    // campaign's existing homes (services/import/importProcessor.js processPinLookupJob).
    kind: { type: String, enum: ['preview', 'apply', 'geocode_check', 'pin_lookup'], default: 'apply', index: true },
    diff: { type: mongoose.Schema.Types.Mixed, default: null },
    // "See exact placement" result (kind 'geocode_check'): exact placeable/unplaceable + sample.
    geocodeCheck: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Admin import history: org + campaign, newest first (routes/admin/imports.js GET /).
importJobSchema.index({ organizationId: 1, campaignId: 1, createdAt: -1 });
// Super-admin cross-org Imports page sorts all orgs by createdAt desc (routes/superAdmin/imports.js).
importJobSchema.index({ createdAt: -1 });
// Stale-job sweep: find active-status jobs whose heartbeat lapsed. Prod autoIndex
// is OFF — needs `npm run migrate:build-indexes -- --apply` after deploy.
importJobSchema.index({ status: 1, heartbeatAt: 1 });

export const ImportJob = mongoose.model('ImportJob', importJobSchema);
