// Door-status resolution (decision 2). A campaign is either survey-type or
// lit-drop-type. The campaign's COMPLETION action is sticky (can't be
// downgraded): `surveyed` for survey campaigns, `lit_dropped` for lit-drop.
// Everything else is last-write-wins by timestamp.

export const ACTION_TO_STATUS = {
  not_home: 'not_home',
  wrong_address: 'wrong_address',
  refused: 'refused', // someone answered but declined — a contact, NOT a completion
  lit_dropped: 'lit_dropped',
  survey_submitted: 'surveyed',
  restricted: 'restricted', // home is inaccessible — a marker, NOT billable / NOT a knock
  // note_added has no effect on door status
};

// Kept for any rank-based comparisons / sorting needs (currently no consumers).
export const STATUS_RANK = {
  unknocked: 0,
  not_home: 1,
  wrong_address: 2,
  refused: 3,
  lit_dropped: 4,
  surveyed: 5,
  restricted: 6, // non-completion; last-write-wins governs resolveStatus, so rank is cosmetic
};

const COMPLETION_ACTION = { survey: 'survey_submitted', lit_drop: 'lit_dropped' };
const COMPLETION_STATUS = { survey: 'surveyed', lit_drop: 'lit_dropped' };

/**
 * Resolve a household's status from a set of CanvassActivity-like rows
 * ({ actionType, timestamp }). Completion is sticky; otherwise latest wins.
 */
export function resolveStatus(campaignType, activities) {
  if (!activities || activities.length === 0) return 'unknocked';

  const completion = COMPLETION_ACTION[campaignType];
  if (completion && activities.some((a) => a.actionType === completion)) {
    return COMPLETION_STATUS[campaignType];
  }

  let latest = null;
  for (const a of activities) {
    if (a.actionType === 'note_added') continue;
    if (!ACTION_TO_STATUS[a.actionType]) continue;
    if (!latest || new Date(a.timestamp) > new Date(latest.timestamp)) latest = a;
  }
  return latest ? ACTION_TO_STATUS[latest.actionType] : 'unknocked';
}
