// Which roster the map and books screens may show for the campaign seated on this phone, and when
// to fetch that campaign's own.
//
// PLAIN MODULE (no imports), so the rules run in CI (lib/seatedRoster.test.js); lib/bootstrapQuery.js
// wraps it in the hook both screens use (useSeatedRoster).
//
// ['bootstrap'] is ONE cache entry for every campaign, and some ways of seating a campaign (an
// admin's canvass-mode shortcuts) leave it alone, so it can still hold the previous campaign's
// houses, the previous campaign's failure, or a fetch for the previous campaign that is still
// running. bootstrapQueryFn tags every failure with the campaign it was for (`err.campaignId`), which
// is how a screen tells the previous campaign's failure from its own.

// The roster belongs to a different campaign than the one seated.
export const isForeignRoster = (roster, campaignId) =>
  !!roster && !!campaignId && String(roster.campaign?.id) !== String(campaignId);

// The failure came from Doorline's server: a status with our JSON error body. A captive portal's or
// a proxy's error page (hotel wifi) carries no JSON error of ours.
export const answeredByDoorline = (err) => Number.isInteger(err?.status) && typeof err.data?.error === 'string';

// A failed roster fetch is Doorline's ANSWER about this campaign (archived or deleted 404, not
// assigned 403, a bad request) rather than a passing failure: no signal, a server blip, a throttle,
// a sign-in that ran out (401, the password screen's job), or someone else's error page. An answer
// replaces the screen even when houses are showing, because they can't be worked; a passing failure
// keeps them.
export const rosterErrorIsFinal = (err) =>
  answeredByDoorline(err) && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429;

// What the screen shows, from the query's roster and error:
//   data     the roster to show — never another campaign's;
//   error    the failure to show — never another campaign's, and never a cancelled fetch (a door
//            write cancels a running refresh so it can't overwrite the new color; that is not a
//            failure);
//   waiting  nothing of this campaign's to show yet and its fetch hasn't failed, while something
//            else sits in the cache (another campaign's roster or failure, or a cancel): show the
//            loader and fetch this campaign's roster. The hook fetches again whenever the cached
//            roster or failure changes, so a fetch still running for the previous campaign is
//            followed by one for this campaign, and this campaign's own failure ends the wait.
export const seatedRosterView = ({ roster, error, cancelled = false, campaignId }) => {
  if (!campaignId) return { data: roster, error: (!cancelled && error) || null, waiting: false };
  const foreign = isForeignRoster(roster, campaignId);
  const forOtherCampaign = error?.campaignId != null && String(error.campaignId) !== String(campaignId);
  const own = error && !cancelled && !forOtherCampaign ? error : null;
  const data = foreign ? undefined : roster;
  return { data, error: own, waiting: !data && !own && (foreign || !!error) };
};
