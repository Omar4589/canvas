import mongoose from 'mongoose';

// An organization's report branding: the logo on its clients' report pages and PDFs
// (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F8). Its own collection rather than a field on
// Organization, because orgContext loads the whole Organization on every request and a logo would
// ride along on every one of them. One document per organization (unique), written by an upsert.
//
// `logo` is never the uploaded file: it is a FRESH PNG the server wrote from the upload's validated
// pixels (services/branding/png.js), so no chunk, text or metadata the upload carried is ever stored.
// Deleted with the organization (ORG_SCOPED in services/platform/deleteOrganization.js); it has no
// campaignId, so the campaign cascade never touches it.
const orgBrandingSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    logo: { type: Buffer, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    bytes: { type: Number, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

orgBrandingSchema.index({ organizationId: 1 }, { unique: true });

export const OrgBranding = mongoose.model('OrgBranding', orgBrandingSchema);
