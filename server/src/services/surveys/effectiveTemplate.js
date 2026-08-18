import { Effort } from '../../models/Effort.js';

// Which survey template applies AT A GIVEN DOOR.
//
// A campaign has a default template; an Effort (walk list) may override it for the doors it owns,
// so "the campaign's survey" is not a question with one answer. The mobile submit path enforces
// this — it 400s a response whose template isn't the door's effective one — and the admin
// conversion tool has to resolve it the same way, or it would write responses the field path
// itself would have rejected.
//
// Extracted so there is exactly one rule. routes/mobile/canvass.js imports it; do not re-inline.

/** The effective template id for one door. null when the campaign has no survey at all. */
export function effectiveSurveyTemplateIdFor(campaign, effort) {
  if (effort?.surveyTemplateId) return effort.surveyTemplateId;
  return campaign?.surveyTemplateId || null;
}

/** Single-door form: loads the door's effort when it has one. */
export async function effectiveSurveyTemplateId(campaign, household) {
  if (!household?.effortId) return effectiveSurveyTemplateIdFor(campaign, null);
  const effort = await Effort.findById(household.effortId).select('surveyTemplateId').lean();
  return effectiveSurveyTemplateIdFor(campaign, effort);
}

/**
 * Batch form for a selection: one Effort query for every distinct effort in the set.
 *
 * Returns { byDoorId: Map<string, templateId|null>, templateIds: string[] } where `templateIds`
 * is the DISTINCT set — a selection with more than one entry there spans templates and must be
 * refused rather than silently written under whichever template happened to be first.
 */
export async function effectiveSurveyTemplatesForDoors(campaign, households) {
  const effortIds = [...new Set(households.map((h) => (h.effortId ? String(h.effortId) : null)).filter(Boolean))];
  const efforts = effortIds.length
    ? await Effort.find({ _id: { $in: effortIds } }, 'surveyTemplateId').lean()
    : [];
  const effortById = new Map(efforts.map((e) => [String(e._id), e]));

  const byDoorId = new Map();
  const distinct = new Set();
  for (const h of households) {
    const effort = h.effortId ? effortById.get(String(h.effortId)) : null;
    const id = effectiveSurveyTemplateIdFor(campaign, effort);
    byDoorId.set(String(h._id), id ? String(id) : null);
    distinct.add(id ? String(id) : null);
  }
  return { byDoorId, templateIds: [...distinct] };
}
