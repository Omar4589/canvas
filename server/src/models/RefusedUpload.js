import mongoose from 'mongoose';

// One door a phone saved without signal that the server turned down when it finally arrived
// (docs/PROPOSAL_OFFLINE_QUEUE.md §D): the canvasser had been taken off the campaign, the walk list's
// survey had changed, the house was gone, the account was paused, and so on. Written only by
// middleware/refusalRecorder.js, read by the console's Audit page ("Doors not saved"). It works for
// every phone from the server deploy on, old ones included, because the server is the one refusing.
//
// What a row holds: who was signed in, which door (and book, and survey) as ids, what kind of write,
// when it was tapped, and the refusal's status, code and message. Deliberately absent: survey
// answers, notes, names and coordinates — the list says a survey was turned down, never what it said.
// Every id that came from the request body is kept only if it is sane (the recorder's sanitizers), so
// a removed canvasser's token can't park megabytes here.
//
// Filed from server records only — the household or voter in the URL, else the book — never from
// X-Org-Id or a body campaignId, and only in an organization that carries the person (a membership in
// any state, or their own work there). Deleted with its organization (ORG_SCOPED) and its campaign
// (CAMPAIGN_SCOPED), never written while either is being deleted, and gone after 180 days.
export const REFUSED_UPLOAD_RETENTION_DAYS = 180;

export const REFUSED_UPLOAD_KINDS = Object.freeze(['result', 'survey', 'add_person', 'pin_move']);

const refusedUploadSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    // Whoever was signed in when it uploaded. Old phones (and the kill switch's off position) upload
    // under the current session, which is why the console calls the column "Signed in as".
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    kind: { type: String, enum: REFUSED_UPLOAD_KINDS, required: true },
    // The door result ('not_home' …) for kind 'result'; null for the other three.
    actionType: { type: String, default: null },
    // The door. For a survey it is the voter's household, when the voter still exists.
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', default: null },
    voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter', default: null },
    // The book the phone said it tapped in, kept only when it is in this campaign.
    turfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', default: null },
    surveyTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyTemplate', default: null },
    // When the canvasser tapped (the body's timestamp), if the phone sent a real date.
    recordedAt: { type: Date, default: null },

    // The refusal as the phone received it.
    status: { type: Number, required: true },
    code: { type: String, default: null },
    reason: { type: String, default: null },

    // The phone's queue item id (updated phones only). A resend after a lost response finds its row
    // by it, and a later accepted resend of the same item closes the row (savedLaterAt).
    queueItemId: { type: String, default: null },
    savedLaterAt: { type: Date, default: null },

    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Built at BOOT by the web dyno, the only writer (syncRefusedUploadIndexes in middleware/refusalRecorder.js),
// because production autoIndex is off and the unique index has to exist before the first row: built on
// an empty collection it never meets an earlier duplicate, and the TTL runs from the first row. So this
// collection needs no migrate:build-indexes step. Distinct key shapes (buildIndexes diffs by key shape).
//
// The Audit page's list and count, newest first, and both cascades' organizationId sweep.
refusedUploadSchema.index({ organizationId: 1, campaignId: 1, createdAt: -1 });
// One row per queue item: two copies of one resend racing each other can't both insert (the loser's
// E11000 is "already recorded"). Partial, so old phones' rows (no queue item id) are never constrained.
// A query reaches it only when it states the partial filter itself — `queueItemId: { $eq, $type:
// 'string' }` — MongoDB won't infer `$type` from a plain string equality (checked on 7.0).
refusedUploadSchema.index(
  { userId: 1, queueItemId: 1 },
  { unique: true, partialFilterExpression: { queueItemId: { $type: 'string' } } }
);
// The 180-day retention (decision 3).
refusedUploadSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefusedUpload = mongoose.model('RefusedUpload', refusedUploadSchema);
