import mongoose from 'mongoose';

// The per-day series behind the Control Room's trend sparklines: how many of each lifetime metric
// happened on each UTC day, computed from the DATES of surviving rows (Organization/Campaign/Voter
// createdAt, CanvassActivity timestamp, SurveyResponse submittedAt) with the SAME filter set as the
// lifetime `live` bucket (internal orgs excluded, knocks are KNOCK_ACTIONS and never via:'bulk').
//
// Rebuilt in FULL by recomputeDaily() (services/platform/platformStats.js) — nightly beside the
// live-bucket reconcile, and by the manual backfill/Reconcile-now. Full rebuild is the point: when an
// organization is hard-deleted its rows vanish, so its bars drop out of this series retroactively
// while the PlatformStats `deleted` bank grows by the same amount — the identity
//   Σ(series) + undated + deleted === total
// holds before and after, and the UI labels the chart "live organizations only" with the exact gap.
//
// COUNTERS ONLY, platform-wide, deliberately NO org dimension. The published Privacy Policy discloses
// "aggregate, non-identifying usage statistics … which do not identify any customer"; a per-org daily
// breakdown would identify a customer and is a separate privacy decision, not a schema tweak here.
const platformDailySchema = new mongoose.Schema(
  {
    // 'YYYY-MM-DD', UTC. UTC is the only defensible bucket for a platform-wide series (there is no
    // campaign anchor timezone), and it matches the overview Today card's "since midnight UTC".
    day: { type: String, required: true, unique: true },
    organizations: { type: Number, default: 0, min: 0 },
    campaigns: { type: Number, default: 0, min: 0 },
    doorsKnocked: { type: Number, default: 0, min: 0 },
    surveyResponses: { type: Number, default: 0, min: 0 },
    votersProcessed: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export const PlatformDaily = mongoose.model('PlatformDaily', platformDailySchema);
