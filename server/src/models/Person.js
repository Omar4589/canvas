import mongoose from 'mongoose';

const { Schema } = mongoose;

// A canonical Person is ONE real human, deduped across organizations. It holds
// SHARED identity only — never an organizationId, surveyStatus, or any canvassing
// field. Each org's Voter row links to it (Voter.personId) and keeps a
// denormalized cache of these fields. See docs/PERSONS.md.
//
// Identity keys are stored as two SETS (uidKeys + svidKeys) rather than scalar
// columns so a cross-state move or vendor re-key APPENDS a key instead of
// overwriting — other orgs' Voter rows keep matching their original key.
//
// Why two arrays instead of one mixed array: the dedup invariant is a
// partial-unique multikey index. On a single array whose elements mixed
// null/non-null key fields, a document with both a uid-key and an svid-key would
// index its svid-key element as (uid:null) and collide with every other such
// document. Splitting into two arrays — each element of which always has its key
// fields populated — keeps each partial-unique index clean.

const uidKeySchema = new Schema(
  {
    uidSource: { type: String, required: true }, // vendor namespace, e.g. 'i360'
    uid: { type: String, required: true },
    source: { type: String, enum: ['import', 'backfill', 'merge', 'manual'], required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const svidKeySchema = new Schema(
  {
    registeredState: { type: String, required: true, uppercase: true },
    stateVoterId: { type: String, required: true },
    source: { type: String, enum: ['import', 'backfill', 'merge', 'manual'], required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const personSchema = new Schema(
  {
    uidKeys: { type: [uidKeySchema], default: [] }, // (uidSource, uid) tuples
    svidKeys: { type: [svidKeySchema], default: [] }, // (registeredState, stateVoterId) tuples

    // Shared identity (source of truth). Display/targeting fields only.
    // Districting (precinct/CD/SD/HD) is intentionally absent — it is
    // address-derived and stays per-org on Voter (propagating it would re-cut
    // other orgs' turf via the org-blind cut recompute).
    firstName: { type: String, default: null, trim: true },
    lastName: { type: String, default: null, trim: true },
    fullName: { type: String, default: null, trim: true },
    phone: { type: String, default: null, trim: true },
    phoneType: { type: String, default: null, trim: true },
    cellPhone: { type: String, default: null, trim: true },
    party: { type: String, default: null, trim: true },
    gender: { type: String, default: null, trim: true },
    dateOfBirth: { type: Date, default: null },
    registrationStatus: { type: String, default: null, trim: true },

    // Governance.
    identityOwnerOrgId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null }, // null = super-admin-only canonical edits
    ownerProvisional: { type: Boolean, default: false }, // auto-assigned sole-org owner; collapses to null on 2nd org link
    // field -> { source, orgId, userId, at, prevValue }. Mixed (not Map) to match
    // house style; written with dotted $set paths, never whole-object replacement.
    fieldProvenance: { type: Schema.Types.Mixed, default: () => ({}) },
    lockedFields: { type: [String], default: [] }, // super-admin pins; ignored by all writes
    matchConfidence: { type: String, enum: ['exact_uid', 'fallback_svid', 'manual', null], default: null },

    identityVersion: { type: Number, default: 0 }, // optimistic concurrency for propagation
    mergedInto: { type: Schema.Types.ObjectId, ref: 'Person', default: null }, // non-null = tombstone
  },
  { timestamps: true }
);

// Dedup invariant: no two (non-tombstoned) Persons may share a (uidSource, uid) or
// a (registeredState, stateVoterId). Partial so empty key arrays never collide.
// In production these are built ONLY by migratePersons after backfill dedup
// (autoIndex is off in prod — see config/db.js).
personSchema.index(
  { 'uidKeys.uidSource': 1, 'uidKeys.uid': 1 },
  { unique: true, partialFilterExpression: { 'uidKeys.uid': { $type: 'string' } } }
);
personSchema.index(
  { 'svidKeys.registeredState': 1, 'svidKeys.stateVoterId': 1 },
  { unique: true, partialFilterExpression: { 'svidKeys.stateVoterId': { $type: 'string' } } }
);
personSchema.index({ lastName: 1, firstName: 1 }); // super-admin directory + candidate search
personSchema.index({ mergedInto: 1 });

export const Person = mongoose.model('Person', personSchema);
