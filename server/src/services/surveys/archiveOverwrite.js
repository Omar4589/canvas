import mongoose from 'mongoose';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';

// Snapshot a SurveyResponse doc that is ABOUT to be replaced or removed.
//
// via 'submit'  — a different canvasser's field submission replaced it, or the same canvasser
//                 re-surveyed over answers an admin desk-entered (canvass.js). A same-user re-submit
//                 over their own field answers is the designed self-heal and preserves nothing.
// via 'restore' — the response displaced by promoting an archived one.
// via 'outcome_convert' — an admin converted a Surveyed door back to a door outcome. Here the
//                 answers are the point (fraud cleanup destroys the evidence otherwise), so
//                 `conversionRunId` links the row to the run that Revert reads.
// via 'unknock' — an admin removed the surveyed ENTRY itself (services/canvass/unknock.js): the
//                 visit is being struck from the record, so its answers go the same way an
//                 outcome_convert's do, linked by `unknockRunId` instead.
// via 'answer_edit' — written by services/canvass/answerEditWriter.js with its own raw insert
//                 (it adds the run, survey and fingerprint links and leaves the other run ids
//                 ABSENT, so their indexes stay out of it); the same verbatim-copy rule holds.
//
// Snapshot-BEFORE-write, the buildReplacedSnapshot rule: built from the pre-read doc, never a
// re-query, and inserted before the $set/delete — a crash between the two can leave a spurious
// archive row duplicating still-current content (harmless), but never a destroyed response.
//
// RAW DRIVER INSERTS, on purpose. These rows are verbatim copies of documents that already exist,
// and some old ones no longer pass today's schema (an answer row from before questionLabel was
// required, say). Through Mongoose, `insertMany(…, { ordered: false })` validated each copy, SKIPPED
// the one that failed without throwing, and the caller then deleted the original: the answers were
// gone, and nothing reported it. A raw insert keeps the bytes exactly as read and throws on any real
// write failure, so the caller stops before it deletes anything it couldn't copy. The provenance
// fields are the only ones written here, and they are typed explicitly below.
const asId = (v) => (v == null ? null : new mongoose.Types.ObjectId(String(v)));

const archiveRow = (doc, { byUserId, via, conversionRunId, unknockRunId, at }) => {
  const { _id, __v, createdAt, updatedAt, ...snapshot } = doc; // doc is a .lean() object
  return {
    ...snapshot,
    overwrittenBy: asId(byUserId),
    overwrittenVia: via,
    overwrittenAt: at,
    conversionRunId: asId(conversionRunId),
    unknockRunId: asId(unknockRunId),
    createdAt: at,
    updatedAt: at,
  };
};

// Returns the copy's id, so a caller whose own write then misses can remove the copy it just made.
export async function archiveOverwrittenResponse(doc, { byUserId, via = 'submit', conversionRunId = null, unknockRunId = null }) {
  const at = new Date();
  const r = await SurveyResponseArchive.collection.insertOne(
    archiveRow(doc, { byUserId, via, conversionRunId, unknockRunId, at })
  );
  return r.insertedId;
}

// Bulk form — same contract, one insertMany. Used by a conversion run, which archives a whole
// chunk of doors at once and would otherwise pay a round trip per response. Ordered, so a failure
// throws before the caller's delete.
export async function archiveOverwrittenResponses(docs, { byUserId, via, conversionRunId = null, unknockRunId = null }) {
  if (!docs.length) return;
  const at = new Date();
  await SurveyResponseArchive.collection.insertMany(
    docs.map((doc) => archiveRow(doc, { byUserId, via, conversionRunId, unknockRunId, at })),
    { ordered: true }
  );
}

/**
 * Delete the surveys a removal has just copied — each only while it still holds the submission the removal
 * read (same canvasser, same moment). One replaced since, by a profile Restore swapping another survey into
 * the slot or by a re-survey, stays as it now is, and the removal's copy of what it held stays beside the
 * one that writer kept (code review round 9: deleted by id, the answers a Restore had just swapped in went
 * nowhere). An edit or a re-stamp of the same submission doesn't spare it: it is the struck visit's survey
 * still. Returns how many went.
 */
export async function deleteUnlessReplaced(docs) {
  if (!docs.length) return 0;
  const res = await SurveyResponse.collection.bulkWrite(
    docs.map((d) => ({ deleteOne: { filter: { _id: d._id, userId: d.userId ?? null, submittedAt: d.submittedAt ?? null } } })),
    { ordered: false }
  );
  return res.deletedCount || 0;
}

// The inverse strip for restore: an archive doc minus its own identity + provenance is exactly
// the SurveyResponse field set it snapshotted. The note stamp and landing marks are part of the
// snapshot (SurveyResponse fields), so they come back with it; the answer-edit provenance doesn't.
export function snapshotFromArchive(archiveDoc) {
  const {
    _id,
    __v,
    createdAt,
    updatedAt,
    overwrittenBy,
    overwrittenVia,
    overwrittenAt,
    conversionRunId,
    unknockRunId,
    answerEditRunId,
    responseId,
    appliedHash,
    undoStartedAt,
    undoToken,
    writerToken,
    ...snapshot
  } = archiveDoc;
  return snapshot;
}

// An undo that writes surveys back from copies CLAIMS each copy first — the stamp the profile's Erase
// and Restore wait on (routes/admin/voters.js) — and writes back only a copy it holds: an Erase that
// landed between the undo's read and its write-back was honoured, and then the undo wrote the erased
// answers back from what it had read (code review round 5; the answer-edit undo stamped its copies
// since round 1, the removal undos never did). A stamp older than ten minutes belongs to an undo that
// died, and is taken over. The claim is the RUN's (`owner`, its id): a retry of that run's undo takes
// back what an earlier attempt of it claimed and left — round 6: an attempt that failed after its claim
// left the copies stamped, and the retry counted them "not restored" and closed the run without them.
// Each run's undo is exclusive already (its own run-level claim), so the same owner twice is the same
// undo, retried.
const COPY_CLAIM_STALE_MS = 10 * 60 * 1000;
/** Claim these copies for `owner`'s write-back; returns the ones it now holds, as they are on file. */
export async function claimCopiesForWriteBack(ids, owner) {
  if (!ids.length) return [];
  const token = new mongoose.Types.ObjectId(String(owner));
  const now = new Date();
  await SurveyResponseArchive.collection.updateMany(
    {
      _id: { $in: ids },
      $or: [{ undoStartedAt: null }, { undoStartedAt: { $lt: new Date(now.getTime() - COPY_CLAIM_STALE_MS) } }, { undoToken: token }],
    },
    { $set: { undoStartedAt: now, undoToken: token } }
  );
  return SurveyResponseArchive.collection.find({ _id: { $in: ids }, undoToken: token }).toArray();
}
/** Let go of claimed copies that were not written back (removed with $unset — a null stamp would block an Erase for good). */
export async function releaseCopies(ids, owner) {
  if (!ids.length) return;
  await SurveyResponseArchive.collection.updateMany(
    { _id: { $in: ids }, undoToken: new mongoose.Types.ObjectId(String(owner)) },
    { $unset: { undoStartedAt: '', undoToken: '' } }
  );
}
