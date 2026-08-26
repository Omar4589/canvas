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
    // which additionally creates or archives real survey answers. Server-side only — the history
    // route deliberately does not ship `source` to the clients, so adding a value here is never a
    // client change.
    source: {
      type: String,
      enum: ['admin_campaigns', 'outcome_reclassify', 'survey_conversion', 'unknock'],
      required: true,
    },
  },
  { timestamps: true }
);

// "What happened to this campaign?" — the feed's only query shape.
campaignChangeSchema.index({ campaignId: 1, createdAt: -1 });
// "What happened in my org?" — mirrors CoordinatorChange, for a future org-wide activity view.
campaignChangeSchema.index({ organizationId: 1, createdAt: -1 });

export const CampaignChange = mongoose.model('CampaignChange', campaignChangeSchema);
