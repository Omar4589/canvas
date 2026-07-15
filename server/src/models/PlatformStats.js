import mongoose from 'mongoose';

// Lifetime marketing counters that SURVIVE organization deletion. "10,000 doors knocked across 40
// campaigns" has to stay true after the org that knocked them is gone — deleting a customer must not
// rewrite history on the homepage.
//
// TWO buckets per metric, and the split is what makes this correct rather than a double-counting mess:
//
//   live    — the contribution of organizations that STILL EXIST. Incremented as events happen
//             (a knock, an import), and RECOMPUTABLE from the live rows at any time (the backfill does
//             exactly that), so it self-heals if a live increment is ever missed.
//   deleted — the contribution of organizations that have been DELETED, captured from their real rows
//             the instant before those rows are destroyed. Monotonic; never recomputed (the rows are
//             gone). This is the bucket that gives lifetime numbers their permanence.
//
// The marketing total for a metric is `live + deleted`. When an org is deleted we MOVE its counts from
// live to deleted (deleted += C, live -= C), so the total is unchanged across a deletion — the number
// is preserved, not re-added. That move is why "increment live" and "capture on delete" don't collide:
// they act on different buckets, and deletion nets to zero on the total.
//
// `internal` organizations (Doorline's own demo/Meridian) are excluded EVERYWHERE — never incremented,
// never captured, never backfilled. These are public-facing numbers; synthetic data must not inflate
// them.
//
// COUNTERS ONLY. No per-voter, per-address, per-answer, or per-area data may ever live here — this
// document is safe to expose publicly precisely because it is nothing but sums.
const metricFields = () => ({
  organizations: { type: Number, default: 0, min: 0 },
  campaigns: { type: Number, default: 0, min: 0 },
  doorsKnocked: { type: Number, default: 0, min: 0 },
  surveyResponses: { type: Number, default: 0, min: 0 },
  votersProcessed: { type: Number, default: 0, min: 0 },
});

const platformStatsSchema = new mongoose.Schema(
  {
    // Singleton. One document; `key` keeps it unique so upserts always target the same row.
    key: { type: String, default: 'singleton', unique: true },
    live: metricFields(),
    deleted: metricFields(),
    // Stamped by the backfill so it can be a one-time, idempotent operation.
    backfilledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const PlatformStats = mongoose.model('PlatformStats', platformStatsSchema);

// The metrics, in one place, so the service, backfill and tests iterate the same set.
export const PLATFORM_METRICS = ['organizations', 'campaigns', 'doorsKnocked', 'surveyResponses', 'votersProcessed'];
