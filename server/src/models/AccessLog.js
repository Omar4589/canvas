import mongoose from 'mongoose';

// Append-only: who (staff) touched which customer's voter content, when, and under what grant.
//
// There was NO read-audit anywhere in this codebase. Not a model, not a middleware, nothing. The
// only staff-action records that existed were write-side and partial (SubscriptionEvent,
// PersonMergeLog). `morgan('combined')` looks like an access log and is not one: its `remote-user`
// field is populated from HTTP Basic auth, and this app uses a bearer JWT, so that column is
// literally always `-`. It records an IP, not a person, and it writes to stdout — ephemeral on
// Heroku. It could never have answered "did anyone at Doorline read this customer's voter file?"
//
// A processor that cannot answer that question has no story to tell a customer who asks it. This is
// the record that makes the answer knowable — by us, and by them.
//
// Written by middleware/accessLog.js on any request that returns voter content while the caller is
// platform staff. NOT written for a customer's own admins reading their own data — that is not
// vendor access and logging it would bury the signal.
const accessLogSchema = new mongoose.Schema(
  {
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    // The grant that authorized it. Present for every row — access without one is a 403.
    grantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportAccessGrant',
      default: null,
      index: true,
    },
    method: { type: String, required: true },
    // The route TEMPLATE (/admin/voters/:voterId), not the filled path.
    route: { type: String, required: true },
    // What class of thing was read, in words a non-engineer can audit.
    resource: { type: String, default: null }, // 'voters' | 'map' | 'reports' | 'surveys' | 'notes' | …
    // Magnitude: rows = list length of the JSON/CSV payload (null = unknown or single-record),
    // bytes = uncompressed payload size. Captured centrally by the res wraps in
    // middleware/accessLog.js; null on rows written by direct recordAccess callers that don't
    // measure (persons.js).
    rows: { type: Number, default: null },
    bytes: { type: Number, default: null },
    // WHICH records this request opened — the record-level half of "was MY record accessed?"
    // (2026-07-19; earlier rows predate it and are request-level only). Deliberately SCOPED:
    // single-record opens/writes (a voter profile, a household drill, a person-console read) and
    // EXPORTS (the frozen id set actually written to the file) carry subjects; LIST/BROWSE
    // requests do not — a directory page listing 200 names is one browse, not 200 record
    // accesses, and pretending otherwise would drown the signal the log exists to carry. Ids
    // belong here: this IS the audit, its rows are keep-forever evidence, and an id that
    // outlives its record is the proof of what was once read. Volume stays tiny — rows are only
    // ever written for staff access under a grant. Capped per row (capSubjects in
    // services/access/supportAccess.js): subjectsTruncated + subjectsTotal record the honest
    // remainder for a pathological export.
    subjects: {
      type: [
        {
          type: { type: String, enum: ['voter', 'person', 'household', 'user'], required: true },
          id: { type: mongoose.Schema.Types.ObjectId, required: true },
        },
      ],
      default: undefined, // absent, not [], on request-level rows — keeps them visibly pre-feature/browse
      _id: false,
    },
    subjectsTruncated: { type: Boolean, default: false },
    // Real subject count when truncated (subjects.length is the cap, not the truth, then).
    subjectsTotal: { type: Number, default: null },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false } // `at` is the timestamp; a createdAt would be noise
);

// NO TTL — DELIBERATE, OWNER-DECIDED (July 2026). The Privacy Policy states access records "are
// retained" and names them as "the evidence that our controls operated", a carve-out that survives
// customer deletion; the DPA promises not to materially decrease protection. A delete-window was
// considered and rejected as policy-contradicting. Growth is bounded by staff support burden (one
// row per granted request), never tenant traffic — capacity is not a reason to revisit. Do not add
// expireAfterSeconds here without an owner decision AND owner edits to privacy.html + DPA.md.
// See docs/PRIVACY_VERIFICATION.md (v3.1 stamp).

accessLogSchema.index({ organizationId: 1, at: -1 }); // "who looked at MY data?"
accessLogSchema.index({ actorUserId: 1, at: -1 }); // "what did this person look at?"
accessLogSchema.index({ 'subjects.id': 1, at: -1 }); // "was THIS record accessed?" (multikey)

export const AccessLog = mongoose.model('AccessLog', accessLogSchema);
