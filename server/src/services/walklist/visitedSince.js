import { civilDaySchema } from '../../utils/validators.js';
import { zonedDayRange } from '../../utils/timezone.js';
import { Organization } from '../../models/Organization.js';

// "Visited in the last N days" — the Exclude doors line on Turf Cutting that leaves out every door a
// canvasser visited since a civil day, read in the campaign's zone (docs/PROPOSAL_RECENT_VISITS.md).
// One reader for the value, shared by the routes that refuse it and the resolver that applies it, so
// "no line" can never mean one thing on a route and another in a cut.

export const VISITED_SINCE_INVALID = '"Visited in the last … days" needs a valid date.';
export const VISITED_SINCE_INCLUDE = '"Visited in the last … days" can only exclude doors.';
export const VISITED_SINCE_SAVED_SEARCH = '"Visited in the last … days" is on Turf Cutting only.';

// undefined, null and '' are "no line": the page deletes the key when the line is unticked, but a null
// from an older tab or another caller must read the same. Anything else must be a real calendar day
// as a string — a ['2026-10-25'] passes a bare regex test, and a saved search then 500s on cast.
export const readVisitedSince = (value) => {
  if (value === undefined || value === null || value === '') return { present: false };
  const valid = civilDaySchema.safeParse(value).success;
  return { present: true, valid, day: valid ? value : null };
};

// What a cut or a preview must refuse: the line on the include side (it only ever leaves doors out),
// or an exclude-side value that is not a real day.
export const visitedSinceProblem = (filter) => {
  if (!filter || typeof filter !== 'object') return null;
  if (readVisitedSince(filter.visitedSince).present) return VISITED_SINCE_INCLUDE;
  const exclude = filter.exclude && typeof filter.exclude === 'object' ? filter.exclude : null;
  const ex = readVisitedSince(exclude?.visitedSince);
  return ex.present && !ex.valid ? VISITED_SINCE_INVALID : null;
};

// Either side carrying the line at all — what the saved-search routes refuse: a saved search's
// Filtered voters export re-resolves its filter on export day, so a "since" there would quietly drift
// from the list that was saved.
export const carriesVisitedSince = (filter) =>
  !!filter &&
  typeof filter === 'object' &&
  (readVisitedSince(filter.visitedSince).present ||
    readVisitedSince(filter.exclude && typeof filter.exclude === 'object' ? filter.exclude.visitedSince : undefined).present);

// The first instant of `day` in `zone` — midnight there, DST-aware.
export const dayStart = (day, zone) => zonedDayRange(day, null, zone).$gte;

// The campaign's zone, in the order the Turf Cutting page reads it (the campaign's, then the org's), so
// the date the page shows and the day the server applies are the same day. The org is read only when
// the campaign has none: a lean read skips the schema default.
export const zoneFor = async (campaign) => {
  if (campaign?.timeZone) return campaign.timeZone;
  const org = campaign?.organizationId
    ? await Organization.findById(campaign.organizationId, { timeZone: 1 }).lean()
    : null;
  return org?.timeZone || 'America/New_York';
};
