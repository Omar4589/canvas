import mongoose from 'mongoose';

// A canvassing ROUND within an effort: draft -> active -> archived, and back with Bring back
// (services/passes/passLifecycle.js, the one writer of these transitions); roundNumber
// auto-increments per EFFORT and is never reused; the name is free-form. At most one round is
// active per effort (a campaign can have several active rounds — one per active effort), enforced
// by the one_live_pass_per_walk_list index below.
const passSchema = new mongoose.Schema(
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
    // The effort this round belongs to. The round's door-set is the effort's
    // owned households (Household.effortId), not walkListId (which is retired).
    effortId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Effort',
      required: true,
      index: true,
    },
    roundNumber: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    // Deprecated: door-set now comes from the effort's owned households. Kept on
    // existing docs for history; new rounds leave it null.
    walkListId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedSearch', default: null },
    // Optional targeting for a follow-up round: a walk-list-shaped filter
    // (knock status + survey answers) the cut was restricted to, scoped to this
    // round's effort. null/empty = the full effort universe. Stored for
    // reproducibility + a round label. Resolution lives in resolveWalkList.
    targetFilter: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      default: 'draft',
      index: true,
    },
    // Half-open attribution windows depend on activatedAt being monotonic.
    activatedAt: { type: Date, default: null },
    // activatedAt is FIRST activation only (it survives a discard), so this is stamped on EVERY
    // activation and every bring-back to live — Bring back's "a later pass went live" rule reads it.
    lastActivatedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    // How the round was archived and what it was before — Bring back restores archivedFrom, and a
    // round ended by the next one going live ('next-pass') never comes back. Null on rounds archived
    // before these fields existed; the rules infer them (passLifecycle.js).
    archivedFrom: { type: String, enum: ['active', 'draft', null], default: null },
    archivedVia: { type: String, enum: ['pass', 'walk-list', 'next-pass', 'repair', null], default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The pass whose activation ended this one (archivedVia 'next-pass').
    endedByPassId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pass', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Advisory lock so concurrent destructive book operations can't interleave
    // (web discard/restore AND worker claim/supplemental jobs — see recutLock.js).
    // token: opaque holder id (a BullMQ jobId for jobs) so a long-running holder can
    // RENEW its own lock past STALE_MS without being able to renew anyone else's.
    recutLock: {
      lockedAt: { type: Date, default: null },
      lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      token: { type: String, default: null },
      // The holder clears or restores the round's knocks (a clear-knocks discard, a snapshot restore that
      // brings knocks back): only then do unknocks and conversions wait for it (removalBusy).
      knocks: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

passSchema.index({ effortId: 1, roundNumber: 1 }, { unique: true }); // roundNumber resets per effort
passSchema.index({ campaignId: 1, status: 1 });
passSchema.index({ effortId: 1, status: 1 });
// One live pass per walk list, enforced. The key is {status, effortId} — NOT {effortId}: that
// pattern already exists (effortId's index:true), and migrate:build-indexes decides "missing" by key
// alone, so it would never be built. The $type filter keeps live passes from before walk lists
// existed (no effortId) from colliding on null. Built in tests by scripts/testIndexPreload.mjs.
passSchema.index(
  { status: 1, effortId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active', effortId: { $type: 'objectId' } },
    name: 'one_live_pass_per_walk_list',
  }
);

export const Pass = mongoose.model('Pass', passSchema);
