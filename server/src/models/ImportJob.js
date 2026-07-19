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
      enum: ['pending', 'parsing', 'geocoding', 'importing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
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
    // Households the incoming voters lived at BEFORE this import (captured pre-apply).
    // Persisted so a BullMQ retry — which would re-read post-move state — still knows
    // which doors to re-check for emptiness. Source of retry-safe orphan deactivation.
    sourceHouseholdIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Household', default: [] },
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
    // 'apply' = the real import (default; old docs read as apply). 'preview' = a
    // read-only diff run on the worker for large files (stores `diff`, no writes).
    kind: { type: String, enum: ['preview', 'apply', 'geocode_check'], default: 'apply', index: true },
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

export const ImportJob = mongoose.model('ImportJob', importJobSchema);
