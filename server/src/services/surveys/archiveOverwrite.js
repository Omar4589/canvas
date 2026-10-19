import mongoose from 'mongoose';
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

export async function archiveOverwrittenResponse(doc, { byUserId, via = 'submit', conversionRunId = null, unknockRunId = null }) {
  const at = new Date();
  await SurveyResponseArchive.collection.insertOne(
    archiveRow(doc, { byUserId, via, conversionRunId, unknockRunId, at })
  );
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
    ...snapshot
  } = archiveDoc;
  return snapshot;
}
