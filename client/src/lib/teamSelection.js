import { standing } from './rosterView.js';

// The Team page's selection and who each bulk action reaches (docs/PROPOSAL_PEOPLE_PAGES.md §E.4).
// Pure, so the rules are tested directly (teamSelection.test.js).
//
// The selection is a Set of ids, up to 500. It clears when a filter or the search changes and after
// every run (the page does that), and the bar acts only on the selected people still in the filter.

export const SELECT_MAX = 500;

const idOf = (r) => String(r.userId);

// Tick or untick one person; a tick past the cap is refused (the same Set comes back).
export const toggleId = (selected, id, max = SELECT_MAX) => {
  const key = String(id);
  if (selected.has(key)) {
    const next = new Set(selected);
    next.delete(key);
    return next;
  }
  if (selected.size >= max) return selected;
  return new Set([...selected, key]);
};

// Select all N that match: the first `max` of the filtered, sorted list.
export const selectAllMatching = (rows, max = SELECT_MAX) => new Set(rows.slice(0, max).map(idOf));

// The selected people still in the filter, in list order — what the bar acts on.
export const selectedInFilter = (selected, rows) => rows.filter((r) => selected.has(idOf(r)));

// Resend invites goes only to people who never signed in (an account from before the sign-in clock
// doesn't count), and for a team lead only to canvassers. Never a Doorline staff account.
export const resendTargets = (rows, { isOrgAdmin, pausedIds }) =>
  rows.filter(
    (r) => standing(r, pausedIds) === 'never-signed-in' && !r.isSuperAdmin && (isOrgAdmin || (r.role || 'canvasser') === 'canvasser')
  );

// Remove from campaign: an org admin removes anyone; a team lead removes canvassers, people no longer
// in the org, and themselves (item 41, the server's DELETE .../assignments/:userId rule).
export const removeTargets = (rows, { isOrgAdmin, viewerId }) =>
  rows.filter(
    (r) =>
      isOrgAdmin ||
      String(r.userId) === String(viewerId) ||
      (!r.isSuperAdmin && (r.status === 'removed' || (r.role || 'canvasser') === 'canvasser'))
  );

// Among the people being removed, who runs a crew here, and how many of their crew stay behind with no
// crew (crew members being removed too don't count).
export const crewsDisbanded = (removing, roster) => {
  const gone = new Set(removing.map(idOf));
  return removing
    .map((r) => ({
      userId: idOf(r),
      firstName: (r.firstName || '').trim() || `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'They',
      people: roster.filter((x) => x.coordinatorId && String(x.coordinatorId) === idOf(r) && !gone.has(idOf(x))).length,
    }))
    .filter((c) => c.people > 0);
};

// "Dana runs a crew here: 12 people will have no crew. Their past doors stay on Dana’s team."
export const disbandLine = ({ firstName, people }) =>
  `${firstName} runs a crew here: ${people.toLocaleString()} ${people === 1 ? 'person' : 'people'} will have no crew. Their past doors stay on ${firstName}’s team.`;

// The same for Remove from org, from the deletion check's `usage.crew: { people, campaigns }`.
export const orgDisbandLine = ({ firstName, people, campaigns }) =>
  people > 0
    ? `${firstName} runs a crew of ${people.toLocaleString()} on ${campaigns.toLocaleString()} ${campaigns === 1 ? 'campaign' : 'campaigns'}: ${
        people === 1 ? 'that person' : 'those people'
      } will have no crew. Their past doors stay on ${firstName}’s team.`
    : null;
