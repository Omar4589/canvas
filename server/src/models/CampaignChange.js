import mongoose from 'mongoose';

// Audit trail of CAMPAIGN CONFIGURATION changes — one row per field per edit, so "who lowered the
// door goal from 12,000 to 9,000, and when?" is answerable after the fact.
//
// This exists because a team lead can now set a campaign's door goal (owner ruling 2026-08-14).
// A goal is a contract number: an org may have promised a client 10,000 doors, and someone editing
// it down changes what the whole console reports as "behind" or "on track" without touching a
// single door. The same is true of `billRestrictedDoors` (it moves the invoice figure) and
// `isActive` (archiving stops the billing clock).
//
// Deliberately NOT AccessLog, for the reason CoordinatorChange already records: that collection is
// scoped to platform STAFF reading customer content under a support grant, carries a keep-forever
// policy tied to published Privacy Policy text, and a customer's own admin editing their own
// campaign is not vendor access. Logging it there would bury the signal AccessLog exists to carry.
//
// Read by GET /admin/campaigns/:campaignId/history, which merges these rows with CoordinatorChange
// into one per-campaign feed. Unlike CoordinatorChange — which was write-only for its whole life,
// readable only from a database console — this one ships with the surface that reads it.
const campaignChangeSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    // The schema path that changed — the key, not a label. Labels live on the clients
    // (client/src/lib/campaignHistory.js), so re-wording one is never a data migration.
    // Config edits are constrained to AUDITED_FIELDS in routes/admin/campaigns.js; an unlisted
    // field is not logged. ONE key is not a schema path: 'outcomeReclassify', written by the
    // outcome-reclassification tool, where fromValue/toValue are the two outcome keys the run
    // folded together (swapped on a revert). It rides this collection rather than growing its own
    // feed because "who rewrote 412 doors' history" belongs beside "who lowered the door goal".
    field: { type: String, required: true },
    // Mixed because the audited fields are a String, a Number, a Boolean and a tri-state Boolean.
    // `null` is a REAL value on both sides for most of them ("no goal", "no date", "inherit the
    // org default"), so it is stored as null rather than a sentinel — the same call
    // CoordinatorChange made for "No coordinator".
    fromValue: { type: mongoose.Schema.Types.Mixed, default: null },
    toValue: { type: mongoose.Schema.Types.Mixed, default: null },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // the actor
    // How the edit arrived. An enum so a bulk/repair path has to declare itself rather than
    // masquerading as a human field edit in the feed: 'admin_campaigns' is the PATCH,
    // 'outcome_reclassify' is the outcome-reclassification tool (and its revert), and
    // 'survey_conversion' is its Surveyed-direction sibling (services/canvass/surveyConversion.js),
    // which additionally creates or archives real survey answers; 'unknock' strikes entries; and
    // 'answer_edit' changes answers on surveys that stay surveyed (field 'answerEdit', its values
    // frozen English — services/canvass/answerEditRuns.js). Server-side only — the history
    // route deliberately does not ship `source` to the clients, so adding a value here is never a
    // client change.
    // 'client_report' rows are the Client Reports tab's own History (fields 'clientReport.*',
    // 'clientReportSeries.*' and stage 2's 'reportLink.*' — services/reports/clientReportHistory.js).
    // They are KEPT OUT of the campaign's general feed by a filter in the history route's query, so
    // the web campaign History and the phone (which calls it unfiltered) see exactly what they saw
    // before, 200-row cap included; the tab asks for them with ?include=client_reports.
    source: {
      type: String,
      enum: ['admin_campaigns', 'outcome_reclassify', 'survey_conversion', 'unknock', 'answer_edit', 'client_report'],
      required: true,
    },
    // Client-report rows. DECLARED, because strictQuery drops an undeclared filter key — Erase-all
    // by clientReportId would otherwise match every row of the campaign. An edit row keeps only the
    // EARLIER text, in fromValue (toValue stays null: the current text lives on the report), so each
    // version is kept in exactly one row; other rows name the report's period, never its title.
    clientReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientReport', default: null },
    seriesId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientReportSeries', default: null },
    shareLinkId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportShareLink', default: null },
    periodLabel: { type: String, default: null },
    // Erase (admins): the earlier text is removed from fromValue and the row says who erased it.
    erasedAt: { type: Date, default: null },
    erasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// "What happened to this campaign?" — the feed's only query shape.
campaignChangeSchema.index({ campaignId: 1, createdAt: -1 });
// Erase-all of a report's earlier text, including after the report is deleted.
campaignChangeSchema.index({ campaignId: 1, clientReportId: 1 });
// "What happened in my org?" — mirrors CoordinatorChange, for a future org-wide activity view.
campaignChangeSchema.index({ organizationId: 1, createdAt: -1 });

export const CampaignChange = mongoose.model('CampaignChange', campaignChangeSchema);
