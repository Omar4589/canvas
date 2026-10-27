// The person panel's Recent doors (docs/PROPOSAL_PEOPLE_PAGES.md §B.2, §D.4): the newest 5, then 10
// more per Show more. Pure, so the paging rule is tested directly (personDoors.test.js).
//
// Neither read sends a usable total (the org one has none at all), so Show more stops when a page
// comes back short or adds no id not already shown — a server that predates `skip` answers page one
// again, and this is what stops it.

// Door outcomes plus restricted, never notes: the shared action list (the phone member sheet sends the
// same). A Team page passes it to the reports read, which otherwise counts notes as doors.
export const RECENT_DOOR_ACTIONS = [
  'not_home',
  'wrong_address',
  'refused',
  'survey_submitted',
  'lit_dropped',
  'no_soliciting',
  'not_target',
  'restricted',
];

export const FIRST_DOORS = 5;
export const MORE_DOORS = 10;
export const firstDoorsPage = { skip: 0, limit: FIRST_DOORS };

// The org read (Users page) or one campaign's (a Team page).
export const doorsPath = ({ userId, campaignId = null }, { skip, limit }) =>
  campaignId
    ? `/admin/reports/canvassers/${userId}/activities?campaignId=${campaignId}&actionType=${RECENT_DOOR_ACTIONS.join(',')}&limit=${limit}&skip=${skip}`
    : `/admin/memberships/${userId}/recent-activity?limit=${limit}&skip=${skip}`;

const rowsOf = (page) => (Array.isArray(page?.activities) ? page.activities : []);

// The next page to ask for, or undefined when there is none (useInfiniteQuery's getNextPageParam).
export const nextDoorsPage = (pages, lastParam) => {
  if (!pages.length) return undefined;
  const last = rowsOf(pages[pages.length - 1]);
  if (last.length < lastParam.limit) return undefined;
  const earlier = new Set(pages.slice(0, -1).flatMap(rowsOf).map((a) => String(a.id)));
  if (!last.some((a) => !earlier.has(String(a.id)))) return undefined;
  return { skip: lastParam.skip + lastParam.limit, limit: MORE_DOORS };
};

// Every page's doors in order, each once.
export const doorRows = (pages) => {
  const seen = new Set();
  const out = [];
  for (const a of (pages || []).flatMap(rowsOf)) {
    const id = String(a.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(a);
  }
  return out;
};

// A recorded action → the door status whose color its dot wears (lib/statusColors.js).
export const ACTION_STATUS = {
  not_home: 'not_home',
  wrong_address: 'wrong_address',
  refused: 'refused',
  survey_submitted: 'surveyed',
  lit_dropped: 'lit_dropped',
  restricted: 'restricted',
  no_soliciting: 'no_soliciting',
  not_target: 'not_target',
};
