import { ACTION_LABELS } from './statusColors.js';

// The Audit page's "Doors not saved" section (docs/PROPOSAL_OFFLINE_QUEUE.md Part 1 and §E): what a phone
// saved without signal that the server turned down when it finally arrived. The rows come from
// GET /admin/campaigns/:campaignId/refused-uploads; this file turns each into the section's words, so
// they are tested directly (notSaved.test.js) and the component only lays them out. The phone's own
// "Not saved" list says the same reasons in the second person ("You were no longer on this campaign's
// team…"); the console says them in the third.

export const NOT_SAVED_TABS = [
  { value: 'open', label: 'Open' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'all', label: 'All' },
];

// §E's empty state: nothing turned down for this campaign (or this canvasser) at all.
export const NOT_SAVED_EMPTY =
  "Nothing has been turned down. Items saved without signal that the server couldn't accept would show here.";

// The tab is empty, but other rows exist.
export const emptyLine = (tab, all) => {
  if (!all || tab === 'all') return NOT_SAVED_EMPTY;
  return tab === 'open'
    ? 'Nothing open. Everything turned down here has been reviewed or was saved later.'
    : 'Nothing has been marked reviewed yet.';
};

const KIND_LABELS = { survey: 'Survey', add_person: 'Added a person', pin_move: 'Moved a pin' };

// What was recorded: the door result in the console's own words (Not home, Refused…), else the kind.
export const whatLabel = ({ kind, actionType } = {}) =>
  kind === 'result' ? ACTION_LABELS[actionType] || 'Door result' : KIND_LABELS[kind] || 'Door';

// "1412 Elm St, Austin · Book 7". A house no longer in the campaign (Undo import, say) has no address.
export const doorLine = ({ address, book } = {}) => {
  if (!address) return 'No longer in this campaign';
  return book ? `${address} · ${book}` : address;
};

const NO_MEMBERSHIP = 'Not in this organization any more';
const CAMPAIGN_DELETED = 'The campaign was deleted';
const HOUSE_GONE = 'The house is no longer in the campaign';
// The server hides another organization's house behind the same 404, so a "house not found" whose house
// IS still in this campaign (the row has its address) means the phone uploaded it with a different
// organization selected — rare, since phones pin each save to the organization it was recorded in.
const OTHER_ORG = 'Uploaded while another organization was selected on the phone';
const PIN_OFF_MAP = "The new pin was outside the campaign's area";

// The server's codes, in the third person. Chosen by code first; FORBIDDEN_ROLE and ORG_CONTEXT need the
// kind and the message too (below). Anything not here shows the server's own message.
const BY_CODE = new Map([
  ['NOT_ASSIGNED', "Not on this campaign's team"],
  ['SUPPORT_ACCESS_REQUIRED', 'Doorline staff need an access grant for this organization'],
  ['SURVEY_TEMPLATE_MISMATCH', "The walk list's survey changed"],
  ['TEMPLATE_NOT_FOUND', 'The survey was deleted'],
  ['DO_NOT_CONTACT', 'The voter asked not to be contacted'],
  ['HOUSEHOLD_NOT_FOUND', HOUSE_GONE],
  ['HOUSEHOLD_FOR_VOTER_NOT_FOUND', HOUSE_GONE],
  // A walk-up's survey whose add was turned down (the survey route looks the voter up first), or a voter
  // Undo import took out.
  ['VOTER_NOT_FOUND', "The person this survey was for isn't in this campaign"],
  ['CAMPAIGN_NOT_FOUND', CAMPAIGN_DELETED],
  ['campaign-deleting', CAMPAIGN_DELETED],
  ['campaign-archived', 'The campaign is archived'],
  ['subscription-inactive', 'The account was paused'],
  ['out_of_bounds', PIN_OFF_MAP],
  ['invalid_coords', PIN_OFF_MAP],
  ['VOTER_ID_CONFLICT', "The person couldn't be added — add them again"],
]);

/**
 * Why it was turned down, from the row's code, kind and message (`reason`, the server's words).
 *   FORBIDDEN_ROLE  from the org gate ("No active org membership") it means they had left the
 *                   organization; on a pin move it is the lead-only rule; otherwise the server's words.
 *   ORG_CONTEXT     a 403 is "not a member of this organization"; anything else, the server's words.
 *   HOUSEHOLD_NOT_FOUND (or …_FOR_VOTER_…) on a row whose house is still in the campaign: another
 *                   organization was selected (OTHER_ORG, above).
 */
export const notSavedReason = ({ code, kind, reason, status, address } = {}) => {
  if ((code === 'HOUSEHOLD_NOT_FOUND' || code === 'HOUSEHOLD_FOR_VOTER_NOT_FOUND') && address) return OTHER_ORG;
  if (code === 'FORBIDDEN_ROLE') {
    if (reason === 'No active org membership') return NO_MEMBERSHIP;
    if (kind === 'pin_move') return 'Only leads and admins can move a pin';
  } else if (code === 'ORG_CONTEXT') {
    if (status === 403) return NO_MEMBERSHIP;
  } else if (code && BY_CODE.has(code)) {
    return BY_CODE.get(code);
  }
  return reason || (status ? `Turned down by the server (${status})` : 'Turned down by the server');
};

// What the row's last column offers: a saved-later row is settled (its door went in after all), a
// reviewed one can be reopened, an open one marked reviewed.
export const rowState = ({ savedLaterAt, reviewedAt } = {}) => {
  if (savedLaterAt) return 'saved-later';
  return reviewedAt ? 'reviewed' : 'open';
};
