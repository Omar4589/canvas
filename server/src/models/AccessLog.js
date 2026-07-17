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
    // The route TEMPLATE (/admin/voters/:voterId), not the filled path — so the log doesn't itself
    // become a pile of voter ids.
    route: { type: String, required: true },
    // What class of thing was read, in words a non-engineer can audit.
    resource: { type: String, default: null }, // 'voters' | 'map' | 'reports' | 'surveys' | 'notes' | …
    // Magnitude. The log is request-level (one row per request, never record ids), so these are what
    // distinguish a one-voter peek from a 4,000-row export: rows = list length of the JSON/CSV payload
    // (null = unknown or single-record), bytes = uncompressed payload size. Captured centrally by the
    // res wraps in middleware/accessLog.js; null on rows written by direct recordAccess callers that
    // don't measure (persons.js).
    rows: { type: Number, default: null },
    bytes: { type: Number, default: null },
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

export const AccessLog = mongoose.model('AccessLog', accessLogSchema);
