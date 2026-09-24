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
  no_soliciting: 'no_soliciting', // reached the door, a sign forbade the knock — a knock, NOT a contact
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
  no_soliciting: 7, // ditto — cosmetic
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

// The row set every status resolver matches. Notes never affect a door's status, and a desk
// restriction DOES — services/canvass/status.js, services/passes/passStatus.js and
// utils/reconcileCounts.js all match exactly this. Exported so a caller that resolves a status
// from an aggregation pairs the predicate with the ladder below instead of inventing its own
// (resolving over, say, only field visits prints "Not home" for a door the whole rest of the
// product calls "Restricted").
export const STATUS_ROW_MATCH = { actionType: { $ne: 'note_added' } };

/**
 * The SAME ladder as resolveStatus, for a per-door `$group` that cannot ship whole rows:
 *   summary.actions          — $addToSet of actionType over STATUS_ROW_MATCH rows
 *   summary.latestActionType — the actionType of the latest such row (a $max composite, not $last)
 *
 * Why it exists: resolveStatus reads `actionType`/`timestamp` off each ELEMENT, so handing it one
 * grouped document skips every element and returns 'unknocked' — a legal-looking constant for
 * every door. And $push-ing the real rows back in re-imports resolveStatus's tie-break, which is
 * array-order dependent at equal instants (strict `>`); a $max composite is deterministic.
 * test/resolveStatusSummary.test.js pins both halves of that: the two forms agree for every row
 * set with distinct instants, and AT A TIE they deliberately do not — this one resolves on
 * actionType and answers the same way whatever order the scan returned.
 */
export const resolveStatusFromSummary = (campaignType, summary) => {
  const actions = (summary?.actions || []).filter((a) => a !== 'note_added');
  if (!actions.length) return 'unknocked';

  const completion = COMPLETION_ACTION[campaignType];
  if (completion && actions.includes(completion)) return COMPLETION_STATUS[campaignType];

  return ACTION_TO_STATUS[summary?.latestActionType] || 'unknocked';
};

// Door status → display label, the 8-value domain of Household.status. Deliberately NOT a copy of
// the web map: that one carries three extra keys (voted / dnc / doNotKnock) that are voter facts,
// not door statuses, so the two can only be compared as a subset — which is what
// test/actionLabels.test.js does, against Household's own enum, so a renamed status fails there
// rather than shipping a raw slug into a customer-facing CSV.
export const DOOR_STATUS_LABELS = {
  unknocked: 'Unknocked',
  not_home: 'Not home',
  surveyed: 'Surveyed',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  lit_dropped: 'Lit dropped',
  restricted: 'Restricted',
  no_soliciting: 'No soliciting',
};
