import mongoose from 'mongoose';

// The measured-hours cache: one row per FbTime SHIFT, re-pulled from
// GET /shifts by the sync jobs. This is the collection reports join against
// (via services/reports/hoursSource.js — routes never read it directly), which
// buckets each shift into a local day AT READ TIME, in the report's own anchor
// timezone. That is the whole reason this stores shifts rather than the
// provider's pre-bucketed day totals: a day is zone-relative, and an org can
// run campaigns in more than one zone. An instant is not. Storing instants
// makes "hours-days and knock-days share a bucketing" true by construction —
// the same request resolves one anchor tz and feeds it to both — instead of
// depending on a zone stamped at sync time matching a zone resolved at read
// time (the equality that broke and stranded a whole campaign on estimates).
//
// IT IS A CACHE OF RANGES, NOT A LEDGER. The provider hard-deletes time
// entries, so sync REPLACES each pulled range wholesale: shifts present in the
// response are upserted by their provider id, shifts we hold inside the range
// that the response no longer contains are deleted. A deleted shift simply
// vanishes here and the report falls back to span math for that user-day.
// There is deliberately no updatedSince cursor, no reconciliation pass, and no
// drift detection — the polling model is self-healing by construction, and
// absence is NEVER written as a zero row (a zero denominator reads as an
// infinite rate).
//
// The three hour figures are stored AS THE PROVIDER SENT THEM — each rounded
// to 2dp per shift, per its contract — and summed already-rounded at read
// time, because that is literally how the provider's own /hours computes its
// totals. Recomputing anything from clock times here would create a second
// opinion about somebody's pay.
//
// DELIBERATELY NOT STORED (data minimization — the privacy entry's "break
// detail: not held" stays true as written): clockOut (isOpen carries the only
// fact reports need), the breaks array, and every break-minutes figure.
// clockIn must be held — it is what a shift's local day is derived from.
//
// userId is denormalized from FbTimePersonLink at sync time and backfilled by
// updateMany whenever a link is created or removed. null = an FbTime person
// with hours that no Doorline user is mapped to — which is exactly what the
// mapping screen's "unmatched hours exist" badge counts.
const fbTimeShiftSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    // The provider's own shift id — the upsert identity. Using clockIn as the
    // key would turn an admin's clock-in correction into a delete + insert;
    // the id makes it an update to the same row.
    shiftId: { type: String, required: true },
    fbtimePersonId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // The instant the shift STARTED. A shift belongs entirely to the local day
    // of its clockIn, in whatever zone the reading report anchors to — the
    // provider's own bucketing rule (localDateOf), reproduced with the same
    // instant and the same zone, so the two can never disagree.
    clockIn: { type: Date, required: true },

    // All three contract figures travel; which one divides doors-per-hour is
    // the connection's hourFigure setting, resolved at read time — so changing
    // the setting never requires a re-sync.
    grossHours: { type: Number, required: true },
    adjustedHours: { type: Number, required: true },
    workedHours: { type: Number, required: true },

    // Still clocked in — hours accrue on the provider side and each re-pull
    // advances them ("so far"). Staleness (open since an EARLIER day = a
    // forgotten clock-out) is deliberately NOT stored: it embeds a "today",
    // which is wrong from the next midnight and frozen wrong for any org whose
    // sync is erroring. hoursSource.js derives it per request, exactly.
    isOpen: { type: Boolean, default: false },
    isManualEntry: { type: Boolean, default: false },

    // The zone the shift was actually clocked in (provider's entryTimeZone) —
    // the diagnostic for "clocked in Nebraska, bucketed Eastern" conversations.
    // Never used for bucketing.
    entryTimeZone: { type: String, default: null },

    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Upsert key for the replace-range sync.
fbTimeShiftSchema.index({ organizationId: 1, shiftId: 1 }, { unique: true });
// The report join: mapped shifts over a clockIn range, and the replace-range
// delete scan ("every shift we hold inside the pulled window").
fbTimeShiftSchema.index({ organizationId: 1, clockIn: 1 });
fbTimeShiftSchema.index({ organizationId: 1, userId: 1, clockIn: 1 });

export const FbTimeShift = mongoose.model('FbTimeShift', fbTimeShiftSchema);
