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

// Frozen per-tag voter rollup for one window. `identifiedVoters` = distinct voters with ANY
// in-window response selecting a tag-carrying option (ever tagged); `currentVoters` = distinct
// voters whose LATEST in-window answer per member question still selects one (a later response
// that skipped the question via branching does not override). currentVoters <= identifiedVoters
// always. VOTER counts, not shares — the renderers must never derive a percent from these.
const tagBreakdownSchema = new mongoose.Schema(
  {
    tag: { type: String, required: true }, // display casing from the template's tag palette
    identifiedVoters: { type: Number, default: 0 },
    currentVoters: { type: Number, default: 0 },
  },
  { _id: false }
);

// One time-window's frozen aggregates. `totals`/`contactBreakdown`/`coverage` are free-form
// computed blobs (Mixed) mirroring the report aggregation service output; surveyBreakdowns and
// tagBreakdowns are structured so the client UI can render without guessing shape.
const windowStatsSchema = new mongoose.Schema(
  {
    totals: { type: mongoose.Schema.Types.Mixed, default: {} },
    contactBreakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
    coverage: { type: mongoose.Schema.Types.Mixed, default: {} },
    surveyBreakdowns: { type: [surveyBreakdownSchema], default: [] },
    tagBreakdowns: { type: [tagBreakdownSchema], default: [] },
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

    // Denormalized campaign type so the client UI can hide lit-drop rows for survey campaigns
    // (and survey rows for lit-drop campaigns) without a live campaign lookup. Optional for
    // back-compat with reports created before this field — those render everything.
    campaignType: { type: String, enum: ['survey', 'lit_drop'], default: null },

    // Optional walk-list scope: null = the whole campaign (every report before this field, and
    // the default). When set, both stat windows and the frozen map cover only this effort's
    // doors/activity. effortName is FROZEN at creation on purpose — the public share page
    // renders the label without an admin API lookup, and it survives the walk list being
    // renamed or deleted later.
    effortId: { type: mongoose.Schema.Types.ObjectId, ref: 'Effort', default: null },
    effortName: { type: String, default: null },

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
      // Tags the client may see. EMPTY = SHOW NONE — the OPPOSITE default of
      // visibleQuestionKeys' empty=all, on purpose: tag names are operator-authored strings
      // rendered on an unauthenticated share page, so each one is an explicit opt-in tick,
      // and every report created before this field shows no tags with no migration.
      visibleTags: { type: [String], default: [] },
    },

    // Denormalized count of frozen ClientReportMapPoint docs (for list views).
    mapPointCount: { type: Number, default: 0 },

    // How many times a client opened this report through a public share link, and when last.
    // Best-effort signal for the operator (admin previews don't count; see routes/public/share.js).
    // Missing on old reports — `$inc` treats absent as 0 and the defaults apply on read, so no
    // backfill/migration is needed.
    viewCount: { type: Number, default: 0 },
    lastViewedAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Unreviewed mock-location flags inside the report's cumulative window when it was
    // published — audit trail for the soft publish gate (the builder warns, never blocks).
    // Operator-facing only; never shaped into the public view (see clientReportView.js).
    openMockFlagsAtPublish: { type: Number, default: null },
  },
  { timestamps: true }
);

// Client "my weekly reports" list: published reports for a campaign, newest first.
clientReportSchema.index({ campaignId: 1, status: 1, weekStart: -1 });
clientReportSchema.index({ organizationId: 1, campaignId: 1, weekStart: -1 });

export const ClientReport = mongoose.model('ClientReport', clientReportSchema);
