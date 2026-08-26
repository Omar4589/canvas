import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';

// Snapshot a SurveyResponse doc that is ABOUT to be replaced or removed.
//
// via 'submit'  — cross-canvasser only; callers guard on userId inequality (a same-user re-submit
//                 is the designed self-heal and preserves nothing).
// via 'restore' — the response displaced by promoting an archived one.
// via 'outcome_convert' — an admin converted a Surveyed door back to a door outcome. Here the
//                 answers are the point (fraud cleanup destroys the evidence otherwise), so
//                 `conversionRunId` links the row to the run that Revert reads.
// via 'unknock' — an admin removed the surveyed ENTRY itself (services/canvass/unknock.js): the
//                 visit is being struck from the record, so its answers go the same way an
//                 outcome_convert's do, linked by `unknockRunId` instead.
//
// Snapshot-BEFORE-write, the buildReplacedSnapshot rule: built from the pre-read doc, never a
// re-query, and inserted before the $set/delete — a crash between the two can leave a spurious
// archive row duplicating still-current content (harmless), but never a destroyed response.
export async function archiveOverwrittenResponse(doc, { byUserId, via = 'submit', conversionRunId = null, unknockRunId = null }) {
  const { _id, __v, createdAt, updatedAt, ...snapshot } = doc; // doc is a .lean() object
  await SurveyResponseArchive.create({
    ...snapshot,
    overwrittenBy: byUserId,
    overwrittenVia: via,
    overwrittenAt: new Date(),
    conversionRunId,
    unknockRunId,
  });
}

// Bulk form — same contract, one insertMany. Used by a conversion run, which archives a whole
// chunk of doors at once and would otherwise pay a round trip per response.
export async function archiveOverwrittenResponses(docs, { byUserId, via, conversionRunId = null, unknockRunId = null }) {
  if (!docs.length) return;
  const at = new Date();
  await SurveyResponseArchive.insertMany(
    docs.map(({ _id, __v, createdAt, updatedAt, ...snapshot }) => ({
      ...snapshot,
      overwrittenBy: byUserId,
      overwrittenVia: via,
      overwrittenAt: at,
      conversionRunId,
      unknockRunId,
    })),
    { ordered: false }
  );
}

// The inverse strip for restore: an archive doc minus its own identity + provenance is exactly
// the SurveyResponse field set it snapshotted.
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
    ...snapshot
  } = archiveDoc;
  return snapshot;
}
