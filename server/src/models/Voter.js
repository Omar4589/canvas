import mongoose from 'mongoose';

// "Never contact this person again" — org-wide, campaign-transcending (a vote resets each
// election; this request does not). Set by an org admin with a reason, or by a DNC list upload.
// It lives HERE and not on Person because Person is identity-only (see the allowlist in
// services/person/propagateIdentity.js — canvassing state is banned there), and not in a
// campaign-scoped side collection because the flag must follow the person into every future
// campaign. Import-survival is by omission: this field is never in csvImporter's row.voter, so
// the re-import $set spread can never touch it (the surveyStatus mechanism).
const doNotContactSchema = new mongoose.Schema(
  {
    flagged: { type: Boolean, default: false },
    // The last transition in either direction (set OR clear) — the durable history is the
    // VoterNote trail the endpoints write.
    at: { type: Date, default: null },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, default: null, trim: true },
    source: { type: String, enum: ['admin', 'upload'], default: 'admin' },
    // Which DNC list upload flagged this voter (null = admin-set). Undo of an upload reverts
    // ONLY its own rows — an admin-set flag, or an admin re-flag that overwrote the subdoc,
    // is never touched by an upload's undo.
    uploadId: { type: mongoose.Schema.Types.ObjectId, ref: 'DncUpload', default: null },
  },
  { _id: false }
);

const voterSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    householdId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Household',
      required: true,
      index: true,
    },

    stateVoterId: { type: String, required: true, index: true, trim: true },
    uid: { type: String, default: null, index: true, trim: true },

    // ── Cross-org canonical Person link (shared voter DB — see docs/PERSONS.md) ──
    // The deduped Person this row maps to. The identity fields below become a
    // denormalized CACHE of that Person; canvassing fields stay org-private.
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', default: null, index: true },
    // Vendor namespace for this row's `uid` (from the ImportProfile). Only a
    // namespaced uid is used as a cross-org match key.
    uidSource: { type: String, default: null, trim: true },
    // Identity fields this org corrected locally (e.g. a door-confirmed phone);
    // canonical propagation and non-owner imports must NOT overwrite these.
    locallyEditedFields: { type: [String], default: [] },
    // Snapshot of this org's identity immediately before the first canonical
    // propagation overwrote it — enables rollback without a DB restore.
    identityBackup: { type: mongoose.Schema.Types.Mixed, default: null },

    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },

    phone: { type: String, default: null, trim: true },
    phoneType: { type: String, default: null, trim: true },
    cellPhone: { type: String, default: null, trim: true },

    party: { type: String, default: null, trim: true },
    gender: { type: String, default: null, trim: true },
    dateOfBirth: { type: Date, default: null },

    registrationStatus: { type: String, default: null, trim: true },
    registeredState: { type: String, default: null, trim: true, uppercase: true },

    congressionalDistrict: { type: String, default: null, trim: true },
    stateSenateDistrict: { type: String, default: null, trim: true },
    stateHouseDistrict: { type: String, default: null, trim: true },
    precinct: { type: String, default: null, trim: true },

    surveyStatus: {
      type: String,
      enum: ['not_surveyed', 'surveyed'],
      default: 'not_surveyed',
      index: true,
    },

    // Do-not-contact (see doNotContactSchema above). Null until first touched.
    doNotContact: { type: doNotContactSchema, default: null },

    // Admin edit stamp (the voter directory lets an admin correct voter fields).
    lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastEditedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

voterSchema.index({ householdId: 1, surveyStatus: 1 });
// Paginated, name-sorted org-wide directory listing.
voterSchema.index({ organizationId: 1, lastName: 1, firstName: 1 });
// Voter identity is scoped per-org (decision 13): one org's import never
// clobbers another's. Replaces the old global-unique index on stateVoterId.
voterSchema.index({ organizationId: 1, stateVoterId: 1 }, { unique: true });
// Directory "Do not contact" filter + upload/undo scans. Partial: only flagged rows are indexed
// (tiny index, like CanvassActivity's location.mocked one). Prod autoIndex is OFF — this exists
// only after `migrate:build-indexes --apply`; its key shape is distinct so buildIndexes sees it.
voterSchema.index(
  { organizationId: 1, 'doNotContact.flagged': 1 },
  { partialFilterExpression: { 'doNotContact.flagged': true } }
);

export const Voter = mongoose.model('Voter', voterSchema);
