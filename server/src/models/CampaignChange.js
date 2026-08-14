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
    // Constrained to AUDITED_FIELDS in routes/admin/campaigns.js; an unlisted field is not logged.
    field: { type: String, required: true },
    // Mixed because the audited fields are a String, a Number, a Boolean and a tri-state Boolean.
    // `null` is a REAL value on both sides for most of them ("no goal", "no date", "inherit the
    // org default"), so it is stored as null rather than a sentinel — the same call
    // CoordinatorChange made for "No coordinator".
    fromValue: { type: mongoose.Schema.Types.Mixed, default: null },
    toValue: { type: mongoose.Schema.Types.Mixed, default: null },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // the actor
    // How the edit arrived. One value today; an enum so a future bulk/repair path has to declare
    // itself rather than masquerading as a human edit in the feed.
    source: { type: String, enum: ['admin_campaigns'], required: true },
  },
  { timestamps: true }
);

// "What happened to this campaign?" — the feed's only query shape.
campaignChangeSchema.index({ campaignId: 1, createdAt: -1 });
// "What happened in my org?" — mirrors CoordinatorChange, for a future org-wide activity view.
campaignChangeSchema.index({ organizationId: 1, createdAt: -1 });

export const CampaignChange = mongoose.model('CampaignChange', campaignChangeSchema);
