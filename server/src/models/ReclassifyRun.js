import mongoose from 'mongoose';

// One outcome-reclassification run: "on 2026-08-16 an admin folded this campaign's 412
// no-soliciting entries into not-home." The row exists to make the operation REVERSIBLE and
// LISTABLE — the converted CanvassActivity rows each carry a `reclassified` stamp pointing back
// here, and Revert restores them from it.
//
// `from`/`to` are door outcomes (never a completion action — a surveyed entry owns real survey
// answers). `from` is `'mixed'` when one run converted a selection spanning several outcomes,
// which the Door Outcomes page allows; the per-row `reclassified.from` stamp is what Revert
// actually restores from, so a mixed run undoes exactly as precisely as a uniform one.
// A pair outside the rate-neutral trio moves reported numbers and is priced before it runs —
// see services/canvass/reclassifyOutcomes.js.
//
// `count` is entries (CanvassActivity rows) and `doorCount` is distinct households, because the
// two answer different questions an admin asks before pressing the button ("how much history am
// I rewriting" vs "how many doors change colour").
const reclassifyRunSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },

    from: { type: String, required: true },
    to: { type: String, required: true },

    count: { type: Number, default: 0 },
    doorCount: { type: Number, default: 0 },

    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // The FILTER that produced a scoped run, mirrored from SurveyConversionRun.selection.scope —
    // without it a run scoped to "answered Opposed, Aug 1–7" was stored identically to a
    // whole-campaign fold, and the run list could not tell an admin which they were undoing.
    // Deliberately NO actionIds array here: this model's revert is stamp-driven
    // (reclassified.runId on each row), so 25k ObjectIds on one doc would be dead weight —
    // the opposite trade from SurveyConversionRun, whose worker genuinely re-reads its ids.
    // `byIds` records whether the admin hand-ticked rows (true) or wrote by filter alone.
    selection: {
      scope: { type: mongoose.Schema.Types.Mixed, default: {} },
      byIds: { type: Boolean, default: false },
    },
    // One human line for the filter, frozen at creation (services/canvass/scopeSummary.js) so it
    // names what the admin SAW, not what the options are called now. Null = unscoped fold.
    scopeSummary: { type: String, default: null },
    // null = still in effect. Set once, on Revert; a reverted run is kept (not deleted) so the
    // history feed and this list both stay honest about what was done and undone.
    revertedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The run list on the campaign's outcomes card — newest first.
reclassifyRunSchema.index({ campaignId: 1, createdAt: -1 });

export const ReclassifyRun = mongoose.model('ReclassifyRun', reclassifyRunSchema);
