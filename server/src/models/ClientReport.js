import mongoose from 'mongoose';

// A FROZEN weekly report shown to a client (candidate) in the read-only portal. The
// operator builds it under /admin/client-reports, reviews it, and publishes — at which
// point the computed numbers are snapshotted here and never recomputed, so a published
// report can't drift when live data changes later. The map's frozen household points live
// in a companion collection (ClientReportMapPoint) to keep this doc small (16MB BSON cap).
//
// Every aggregate is stored for TWO windows: `cumulative` (all activity through the week's
// end instant) and `period` (just the week). The "Activity at a glance" cards render the
// cumulative total as the big number and the period total as the "+N this week" delta.
// See docs/CLIENT_PORTAL.md.

const sectionSchema = new mongoose.Schema(
  {
    // Admin-authored "Canvasser Observations" section — a heading + a paragraph/bullets.
    heading: { type: String, required: true, trim: true },
    body: { type: String, default: '' },
  },
  { _id: false }
);

const breakdownOptionSchema = new mongoose.Schema(
  {
    option: { type: String, required: true },
    count: { type: Number, default: 0 },
    percent: { type: Number, default: 0 },
  },
  { _id: false }
);

const surveyBreakdownSchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true },
    questionLabel: { type: String, default: '' },
    type: { type: String, default: 'single_choice' },
    // The one question the operator designated as the headline "support" breakdown
    // (e.g. Support / Likely Support / Undecided / Opposed).
    isSupportQuestion: { type: Boolean, default: false },
    options: { type: [breakdownOptionSchema], default: [] },
  },
  { _id: false }
);

// One time-window's frozen aggregates. `totals`/`contactBreakdown`/`coverage` are free-form
// computed blobs (Mixed) mirroring the report aggregation service output; surveyBreakdowns is
// structured so the client UI can render bars without guessing shape.
const windowStatsSchema = new mongoose.Schema(
  {
    totals: { type: mongoose.Schema.Types.Mixed, default: {} },
    contactBreakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
    coverage: { type: mongoose.Schema.Types.Mixed, default: {} },
    surveyBreakdowns: { type: [surveyBreakdownSchema], default: [] },
  },
  { _id: false }
);

const clientReportSchema = new mongoose.Schema(
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

    // Human label, e.g. "Week of Jun 1". Optional; the UI falls back to weekStart..weekEnd.
    title: { type: String, default: '', trim: true },

    // The week window. weekStart/weekEnd are calendar days ('YYYY-MM-DD') in the campaign's
    // timezone; rangeStartUtc/rangeEndUtc are the frozen half-open UTC instants the
    // aggregations actually used (from zonedDayRange), so the window is reproducible.
    weekStart: { type: String, required: true },
    weekEnd: { type: String, required: true },
    timeZone: { type: String, required: true },
    rangeStartUtc: { type: Date, required: true },
    rangeEndUtc: { type: Date, required: true },

    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },

    observations: { type: [sectionSchema], default: [] },

    stats: {
      cumulative: { type: windowStatsSchema, default: () => ({}) },
      period: { type: windowStatsSchema, default: () => ({}) },
    },
    supportQuestionKey: { type: String, default: null },

    // Editorial control over what the client sees.
    visibility: {
      // Survey questions the client may see. Empty = all.
      visibleQuestionKeys: { type: [String], default: [] },
      // Which survey-answer keys become client-side map filters.
      mapAnswerKeys: { type: [String], default: [] },
      showMap: { type: Boolean, default: true },
    },

    // Denormalized count of frozen ClientReportMapPoint docs (for list views).
    mapPointCount: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Client "my weekly reports" list: published reports for a campaign, newest first.
clientReportSchema.index({ campaignId: 1, status: 1, weekStart: -1 });
clientReportSchema.index({ organizationId: 1, campaignId: 1, weekStart: -1 });

export const ClientReport = mongoose.model('ClientReport', clientReportSchema);
