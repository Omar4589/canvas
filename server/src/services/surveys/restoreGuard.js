import { CanvassActivity } from '../../models/CanvassActivity.js';

// Can a preserved (archived) survey be restored? Only into a visit that still reads Surveyed.
//
// Restore puts an archived response back as the voter's current one, and when nothing is current it
// re-creates the response and counts it. Both are right when the archived survey's own visit — the
// (door, round, canvasser) it was recorded at — still has its survey_submitted entry: a teammate
// overwrite, a restore swap, or the profile's "delete the current one, then restore the earlier one".
// They are wrong when that entry is gone or no longer says Surveyed: an unknocked visit, a visit an
// admin converted to Not home on Door Outcomes, or one the canvasser re-recorded as a different
// result. Restoring there put a counted survey under a door that says it wasn't surveyed — and, after
// an unknock, swapped the struck fake answers over a real later survey.
//
// ONE owner of the rule, so the profile (which hides Restore up front) and the restore route (which
// refuses) can never disagree.
//
// Answers an ADMIN took off the record — unknocked, or changed from Surveyed on Door Outcomes — need
// more than "the visit reads Surveyed": the canvasser may have come back and surveyed again, which
// writes a NEW entry at the same visit, and the struck answers must never replace that real survey.
// For those, only an entry recorded BEFORE the removal counts — the visit's own entry, back because
// the removal was undone. (Matching the entry's time to the survey's own instead is wrong: at a
// two-voter door the second survey replaces the visit's entry with a newer one, so the first voter's
// survey has no entry at its own time even though its visit plainly still reads Surveyed.)
const STRUCK_VIAS = new Set(['unknock', 'outcome_convert']);

const visitKey = (r) => `${String(r.householdId)}|${r.passId ? String(r.passId) : 'null'}|${String(r.userId)}`;
const recordedAt = (a) => (a.createdAt ? new Date(a.createdAt) : a._id.getTimestamp());

/**
 * Map<archiveId, { restorable, reason }> for a set of archive rows (lean). One activity read for all
 * of them. `reason` is null when restorable, else 'unknocked' (the visit's entry was unknocked),
 * 'converted' (an admin changed it from Surveyed on Door Outcomes) or 'not_surveyed' (it now holds
 * another result, usually the canvasser's own re-recording).
 */
export const restoreStates = async (archiveRows) => {
  const out = new Map();
  if (!archiveRows.length) return out;
  const visits = new Map();
  for (const r of archiveRows) {
    visits.set(visitKey(r), { householdId: r.householdId, passId: r.passId ?? null, userId: r.userId });
  }
  const rows = await CanvassActivity.find(
    { $or: [...visits.values()], actionType: { $ne: 'note_added' } },
    { householdId: 1, passId: 1, userId: 1, actionType: 1, createdAt: 1, 'reclassified.kind': 1 }
  ).lean();
  const byVisit = new Map();
  for (const a of rows) {
    const k = visitKey(a);
    const v = byVisit.get(k) || { surveyedAt: [], convertedAway: false };
    if (a.actionType === 'survey_submitted') v.surveyedAt.push(recordedAt(a));
    if (a.reclassified?.kind === 'from_survey') v.convertedAway = true;
    byVisit.set(k, v);
  }
  for (const r of archiveRows) {
    const v = byVisit.get(visitKey(r));
    if (STRUCK_VIAS.has(r.overwrittenVia)) {
      const struckAt = new Date(r.overwrittenAt);
      const ownEntryBack = !!v && v.surveyedAt.some((t) => t <= struckAt);
      out.set(
        String(r._id),
        ownEntryBack
          ? { restorable: true, reason: null }
          : { restorable: false, reason: r.overwrittenVia === 'unknock' ? 'unknocked' : 'converted' }
      );
      continue;
    }
    if (v?.surveyedAt.length) out.set(String(r._id), { restorable: true, reason: null });
    else out.set(String(r._id), { restorable: false, reason: !v ? 'unknocked' : v.convertedAway ? 'converted' : 'not_surveyed' });
  }
  return out;
};

// The refusal the restore route sends, worded by cause. The web card says the same thing up front.
export const RESTORE_BLOCKED_MESSAGES = {
  unknocked:
    "These answers were removed when this visit was unknocked on Door Outcomes, so they can't go back from here. Undo that unknock on Door Outcomes to bring them back.",
  converted:
    "These answers were removed when this visit was changed from Surveyed on Door Outcomes, so they can't go back from here. Undo that change on Door Outcomes to bring them back.",
  not_surveyed:
    "This visit no longer reads Surveyed — the canvasser recorded a different result at this door — so there's no survey to put these answers into.",
};
