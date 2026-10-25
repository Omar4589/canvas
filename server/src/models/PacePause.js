import mongoose from 'mongoose';

// One automatic pause (docs/PROPOSAL_PACE_PAUSE.md §D): a canvasser whose doors came in faster than anyone
// could knock them, paused for review by services/audit/pacePause.js. Unlike the GPS-audit flags (computed
// live, never stored), a pause is an event with a lifecycle, so it IS stored — together with the evidence
// behind it, FROZEN at the moment it fired: Unknock removes rows from the ledger, and the "why" must survive
// the fix.
//
// Deliberately absent: GPS coordinates, addresses, email addresses and any free text. The window holds ids
// and derived numbers; addresses and names are read live when a review screen opens. Nothing anywhere reads
// this collection to change a count, an export, a report, a bill or FbTime (decision 2: no hold).
//
// The restart point after an unpause is NOT kept here (Membership.paceRestartAt): a resolved pause can be
// deleted (decision 17), and deleting it must never bring the old fails back into the count.

// The second check of a visit: its first survey, timed from the same predecessor (§B.4 check 2).
const surveyCheckSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    gapSec: { type: Number, required: true },
    meters: { type: Number, required: true },
    neededSec: { type: Number, required: true },
    fail: { type: Boolean, required: true },
  },
  { _id: false }
);

// One judged visit of the window, as the rule saw it when the pause fired.
const windowVisitSchema = new mongoose.Schema(
  {
    activityId: { type: mongoose.Schema.Types.ObjectId, required: true }, // the visit's standing row
    householdId: { type: mongoose.Schema.Types.ObjectId, required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, default: null },
    result: { type: String, required: true },
    at: { type: Date, required: true }, // the visit's first entry
    // The predecessor: the latest entry before the visit at a different door. Null for the day's first door.
    prevHouseholdId: { type: mongoose.Schema.Types.ObjectId, default: null },
    prevCampaignId: { type: mongoose.Schema.Types.ObjectId, default: null },
    prevResult: { type: String, default: null },
    prevAt: { type: Date, default: null },
    gapSec: { type: Number, default: null },
    meters: { type: Number, default: null },
    effectiveMeters: { type: Number, default: null },
    neededSec: { type: Number, default: null },
    fail: { type: Boolean, required: true },
    pattern: { type: String, enum: ['vehicle', 'still', 'walking', null], default: null },
    surveyCheck: { type: surveyCheckSchema, default: null },
  },
  { _id: false }
);

const pacePauseSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    status: { type: String, enum: ['paused', 'resolved'], required: true, default: 'paused' },
    firedAt: { type: Date, required: true },
    triggerActivityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    triggerAt: { type: Date, required: true },
    day: { type: String, required: true }, // 'YYYY-MM-DD' in timeZone
    timeZone: { type: String, required: true },

    // The numbers in force when it fired, so a later config change can't rewrite why it fired.
    config: {
      doorSec: { type: Number, required: true },
      surveySec: { type: Number, required: true },
      travelMps: { type: Number, required: true },
      window: { type: Number, required: true },
      failsToPause: { type: Number, required: true },
      sameVisitSec: { type: Number, required: true },
    },
    window: { type: [windowVisitSchema], default: [] },

    // The alert's outcome, never its recipients' addresses. 'pending' is written with the pause, so a dyno
    // restart mid-send leaves "Sending the email…" rather than nothing.
    alert: {
      status: { type: String, enum: ['pending', 'done'], default: 'pending' },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      at: { type: Date, default: null },
    },

    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedVia: { type: String, enum: ['unpause', 'setting_off', 'switch_off', null], default: null },
  },
  { timestamps: true }
);

// At most one open pause per canvasser per org: a second tipping write racing the first hits E11000 and is
// treated as "already paused". Built at boot (syncPacePauseIndexes), because production autoIndex is off
// and this index must exist before the first pause can be written.
pacePauseSchema.index(
  { organizationId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: 'paused' } }
);
// The gate's lookup and a member's history, newest first. Distinct key shape from the one above (buildIndexes
// diffs by key shape).
pacePauseSchema.index({ organizationId: 1, userId: 1, firedAt: -1 });
// Badge counts and the Audit page's list, and the campaign-delete cascade.
pacePauseSchema.index({ campaignId: 1, status: 1 });

export const PacePause = mongoose.model('PacePause', pacePauseSchema);
