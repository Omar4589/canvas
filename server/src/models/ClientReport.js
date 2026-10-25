import mongoose from 'mongoose';

// A FROZEN weekly report shown to a client (candidate) in the read-only portal. The
// operator builds it under /admin/client-reports, reviews it, and publishes — which freezes
// exactly the snapshot the operator previewed, so a published report can't drift when live data
// changes later. Its numbers change only through Refresh numbers (a before-and-after the operator
// applies); its words through Edit. The map's frozen rows live in companion collections
// (ClientReportMapPoint, ClientReportAreaCell) to keep this doc small (16MB BSON cap).
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
    // INTERNAL counts for the builder's notes (desk-entered and edited responses behind these
    // figures), never shown to the client: shapeWindow (clientReportView.js) is a whitelist. Must be
    // declared — strict mode dropped it at the stats assignment, so the notes never appeared.
    provenance: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

// One kind of opener's count for a report: how many visits the page counted, and when. Written by
// one updateOne with $inc/$min/$max (stage 2's /opened ping); declared, because a plain nested
// object on a Map value would be stripped silently.
const openCountSchema = new mongoose.Schema(
  {
    opens: { type: Number, default: 0 },
    firstOpenedAt: { type: Date, default: null },
    lastOpenedAt: { type: Date, default: null },
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

    // FROZEN door-goal progress at publish time, when the operator opted in
    // (visibility.showGoal). Progress ONLY — no pace, no verdict, no projected finish: a
    // frozen "behind pace" is a claim that keeps being made long after it stopped being true,
    // and whether to tell a client you're behind is an operator's call, not a report's.
    // `done` is the same all-time billable-door figure the console shows
    // (services/reports/goalProgress.js). Null on every report where no goal was set.
    goalSnapshot: {
      target: { type: Number, default: null },
      deadline: { type: String, default: null }, // 'YYYY-MM-DD' in the campaign's timeZone
      done: { type: Number, default: null },
      remaining: { type: Number, default: null },
      percent: { type: Number, default: null },
      asOf: { type: Date, default: null },
    },

    // Editorial control over what the client sees.
    visibility: {
      // Survey questions the client may see. EMPTY = SHOW NONE, for every report (it used to mean
      // all, so unticking every question showed all of them). Create, Next and the builder always
      // write explicit keys. Read through visibleKeysFor (services/reports/reportVisibility.js).
      visibleQuestionKeys: { type: [String], default: [] },
      // Which survey-answer keys become client-side map filters. Empty = none. Never holds a key
      // outside mapKeysFor: a key that leaves that set leaves this list too.
      mapAnswerKeys: { type: [String], default: [] },
      showMap: { type: Boolean, default: true },
      // Exact door pins (missing reads as pins) or shaded areas (H3 hexagons, services/reports/
      // areaCells.js). On a published report these change only through a build: Switch to areas
      // is a remap, anything else a Refresh. The map a client sees follows the LIVE snapshot's
      // mode (liveInputs), never this setting.
      mapMode: { type: String, enum: ['pins', 'area'], default: 'pins' },
      areaSize: { type: String, enum: ['small', 'large'], default: 'small' },
      // Tags the client may see. EMPTY = SHOW NONE — the OPPOSITE default of
      // visibleQuestionKeys' empty=all, on purpose: tag names are operator-authored strings
      // rendered on an unauthenticated share page, so each one is an explicit opt-in tick,
      // and every report created before this field shows no tags with no migration.
      visibleTags: { type: [String], default: [] },
      // Door-goal progress on the client-facing report. DEFAULT FALSE, same reasoning as
      // visibleTags above: the share page is unauthenticated, so putting a contracted target
      // in front of whoever holds the link is an affirmative tick, never a default. Every
      // report published before this field keeps rendering exactly as it was, no migration.
      showGoal: { type: Boolean, default: false },
    },

    // Denormalized count of frozen ClientReportMapPoint docs (for list views).
    mapPointCount: { type: Number, default: 0 },
    // The same for an area report's ClientReportAreaCell docs.
    areaCellCount: { type: Number, default: 0 },

    // ── The live snapshot (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F2) ──────────────────────────
    // A snapshot is one build's frozen output: the numbers above and the map rows tagged with its
    // snapshotId. A build never writes over a live snapshot; it writes a new one and one atomic
    // update swaps it in (services/reports/clientReportBuilds.js).
    //
    // OLD DOCUMENTS LACK EVERY FIELD BELOW, and JavaScript never trusts a Mongoose default for them:
    // each is read through one helper with an explicit fallback (reportVisibility.js — liveInputs,
    // numbersCutOff, seriesKeyOf). Hence no defaults on the Mixed fields: a missing snapshotInputs
    // must stay missing, never hydrate as "nothing on the map".
    //
    // null on a report built before this change, whose rows carry no snapshotId ({ snapshotId: null }
    // matches the missing field). snapshotKey is its opaque random twin, the only one the client
    // sees (an ObjectId's first bytes are a timestamp); legacy reports read as 'legacy'.
    snapshotId: { type: mongoose.Schema.Types.ObjectId, default: null },
    snapshotKey: { type: String, default: null },
    // What the live snapshot was built with: { showMap, mapMode, areaSize, mapKeys, questionDeps,
    // coordinatorIds }. Removals prune it in place (the one removal path); anything that adds to it
    // needs a new build. questionDeps is [[questionKey, [keys it depends on]], …], frozen at build.
    snapshotInputs: { type: mongoose.Schema.Types.Mixed },
    // The live snapshot's cut-off instant (the build's fence). Stored; the client only ever gets a
    // date (`numbersThrough`). Read through numbersCutOff (statsComputedAt ?? publishedAt).
    statsComputedAt: { type: Date, default: null },
    // Incremented by every PATCH; Publish compares it with what the builder previewed.
    editVersion: { type: Number },
    // The map's bounding box, frozen from the pins (or the cells' boundaries on an area report):
    // { minLng, minLat, maxLng, maxLat }. The client map opens on it.
    extent: { type: mongoose.Schema.Types.Mixed },
    // Earlier totals (owner ruling 10-24): the previous report of this series, recomputed by this
    // build up to that report's cut-off, card by card — compared at READ time with what that report
    // froze (clientReportRead.js earlierTotalsLine), so a report taken down or replaced later drops
    // the clause.
    earlierTotals: { type: mongoose.Schema.Types.Mixed, default: null },
    comparedReportId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // The compared report's live snapshot when this build compared with it (null when that report
    // had none). Once that report's numbers are refreshed its snapshot moves, and the comparison no
    // longer means anything: the line is hidden rather than read as totals going down (NUM-1).
    comparedSnapshotId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Knocks in this report's scope created after the fence but timed before the period ended — "3
    // knocks arrived while these numbers were being built — Recompute to include them".
    arrivedDuringBuild: { type: Number, default: null },

    // The build in flight or its result: { kind: recompute | refresh | remap, status: queued |
    // waiting | running | ready | failed | idle, jobId, snapshotId, snapshotKey, inputs, fenceAt,
    // fenceSeen, startedAt, beatAt, waitingSince, rebuilds, progress, waitingFor, error: { code,
    // message, … }, result, requestedBy, cancelledAt, cancelledBy }. Mixed and always replaced
    // WHOLE on a claim, cancel or reset: every worker write matches on build.jobId and
    // build.snapshotId, which a replacement removes, so a cancelled build's heartbeat, commit and
    // failure writes all miss (setting only build.status would not do that).
    build: { type: mongoose.Schema.Types.Mixed },

    // ── Series, scope and lifecycle ─────────────────────────────────────────────────────────────
    // The run of reports this one belongs to (ClientReportSeries) — whole campaign, a walk list, a
    // team or a team on one walk list. scope.label is FROZEN at creation; the client groups by the
    // opaque seriesKey (seriesKeyOf) and shows the series' current label.
    seriesId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientReportSeries', default: null },
    scope: {
      type: new mongoose.Schema(
        {
          kind: { type: String, enum: ['campaign', 'walk_list', 'team', 'team_walk_list'] },
          label: { type: String, default: '' },
        },
        { _id: false }
      ),
      default: null,
    },
    // Take down hides a published report from the client but keeps it exactly as it was; Put back
    // up shows it again with its original publish date. Every public route filters takenDownAt:
    // null. There is no path from published back to draft.
    takenDownAt: { type: Date, default: null },
    takenDownBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // An accepted edit (or a switch to areas) on a published report — the client sees "Edited".
    contentEditedAt: { type: Date, default: null },
    contentEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // An applied Refresh — the client sees "Numbers refreshed".
    numbersRefreshedAt: { type: Date, default: null },
    numbersRefreshedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Next report: the notes it copied ({ reportId, weekStart, weekEnd }) and whether the operator
    // ticked "I've reviewed these notes" (null on a report that copied nothing).
    copiedFrom: { type: mongoose.Schema.Types.Mixed, default: null },
    copiedNotesReviewed: { type: Boolean, default: null },
    // The draft Next made from this report — the insert-first CAS that makes a double click return
    // one draft (routes/admin/clientReports.js POST /:id/next).
    nextReportId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Bumped by every Erase of this report's History text; a Restore's CAS requires it unchanged, so
    // an Erase landing mid-restore wins (services/reports/clientReportHistory.js).
    eraseEpoch: { type: Number },

    // Who opened this report (§F7, written by stage 2's /opened ping): per share link, and members
    // of the org (by role) and Doorline staff separately. No IP, no device. Declared as a Map of a
    // subschema: a plain nested object would be stripped silently.
    views: {
      byLink: { type: Map, of: openCountSchema, default: undefined },
      members: {
        admins: { type: openCountSchema, default: undefined },
        leads: { type: openCountSchema, default: undefined },
        others: { type: openCountSchema, default: undefined },
        staff: { type: openCountSchema, default: undefined },
      },
    },

    // How many times a client opened this report through a public share link, and when last.
    // Best-effort signal for the operator (admin previews don't count). No longer incremented —
    // `views` replaced it — and kept so the panel can say "N views before per-link counts".
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
