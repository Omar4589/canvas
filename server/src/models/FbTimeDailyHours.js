import mongoose from 'mongoose';

// The measured-hours cache: one row per FbTime person per local day, re-pulled
// from GET /hours by the sync jobs. This is the collection reports join
// against (via services/reports/hoursSource.js — routes never read it
// directly).
//
// IT IS A CACHE OF RANGES, NOT A LEDGER. The provider hard-deletes time
// entries, so sync REPLACES each pulled date range wholesale: rows present in
// the response are upserted, rows we hold inside the range that the response
// no longer contains are deleted. A deleted shift simply vanishes here and the
// report falls back to span math for that user-day. There is deliberately no
// updatedSince cursor, no reconciliation pass, and no drift detection — the
// polling model is self-healing by construction, and absence is NEVER written
// as a zero row (a zero denominator reads as an infinite rate).
//
// userId is denormalized from FbTimePersonLink at sync time and backfilled by
// updateMany whenever a link is created or removed. null = an FbTime person
// with hours that no Doorline user is mapped to — which is exactly what the
// mapping screen's "unmatched hours exist" badge counts.
const fbTimeDailyHoursSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    fbtimePersonId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // The provider-bucketed local day ('YYYY-MM-DD'). A shift belongs entirely
    // to the day it STARTED, bucketed in the zone we sent as ?timeZone=.
    day: { type: String, required: true },

    // The IANA zone this row was pulled under (the org's zone). Stamped so a
    // later org-timezone change is detectable: hoursSource refuses rows whose
    // zone doesn't match the report's, falling back to estimated rather than
    // joining hours-days against knock-days bucketed differently.
    timeZone: { type: String, required: true },

    // All three contract figures travel; which one divides doors-per-hour is
    // the connection's hourFigure setting, resolved at read time — so changing
    // the setting never requires a re-sync.
    grossHours: { type: Number, required: true },
    adjustedHours: { type: Number, required: true },
    workedHours: { type: Number, required: true },

    shiftCount: { type: Number, default: 0 },
    // Per-day rollups of the provider's trust flags. isStale (an open shift
    // from an earlier day — almost certainly a forgotten clock-out) makes the
    // day unusable as a denominator; the others ride along as labels.
    isOpen: { type: Boolean, default: false },
    isStale: { type: Boolean, default: false },
    isManualEntry: { type: Boolean, default: false },

    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Upsert key for the replace-range sync.
fbTimeDailyHoursSchema.index(
  { organizationId: 1, fbtimePersonId: 1, day: 1 },
  { unique: true }
);
// The report join: measured hours for these users over this range.
fbTimeDailyHoursSchema.index({ organizationId: 1, userId: 1, day: 1 });
// The replace-range delete scan ("every row we hold inside [start, end]").
fbTimeDailyHoursSchema.index({ organizationId: 1, day: 1 });

export const FbTimeDailyHours = mongoose.model('FbTimeDailyHours', fbTimeDailyHoursSchema);
