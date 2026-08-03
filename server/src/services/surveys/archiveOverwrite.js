import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';

// Snapshot a SurveyResponse doc that is ABOUT to be replaced. Cross-canvasser only — callers
// guard on userId inequality (a same-user re-submit is the designed self-heal and preserves
// nothing). Snapshot-BEFORE-write, the buildReplacedSnapshot rule: built from the pre-read doc,
// never a re-query, and inserted before the $set — a crash between the two can leave a spurious
// archive row duplicating still-current content (harmless), but never a destroyed response.
export async function archiveOverwrittenResponse(doc, { byUserId, via = 'submit' }) {
  const { _id, __v, createdAt, updatedAt, ...snapshot } = doc; // doc is a .lean() object
  await SurveyResponseArchive.create({
    ...snapshot,
    overwrittenBy: byUserId,
    overwrittenVia: via,
    overwrittenAt: new Date(),
  });
}

// The inverse strip for restore: an archive doc minus its own identity + provenance is exactly
// the SurveyResponse field set it snapshotted.
export function snapshotFromArchive(archiveDoc) {
  const { _id, __v, createdAt, updatedAt, overwrittenBy, overwrittenVia, overwrittenAt, ...snapshot } =
    archiveDoc;
  return snapshot;
}
