// The live-refresh contract for any admin page that shows a LiveStatus pill.
//
// The rule this file exists to enforce: **every query whose number sits under the pill must poll,
// and the pill must answer for all of them.** Both halves matter, and the second one is the reason
// this isn't just a copy-pasted options object.
//
// It was learned the hard way. The Timeline's by-team table was added with no `refetchInterval`
// while the canvasser table beside it polled every 20s — so a live knock moved one number and not
// the other. That alone is a nuisance. What made it a *wrong number* is that the pill read only the
// polling query's `dataUpdatedAt`, so it cheerfully said "Live · updated 3s ago" over a team total
// that was minutes old. An admin reading that figure to a client had no way to know. A stale number
// labelled stale is a nuisance; a stale number labelled fresh is a lie.
//
// So: spread `livePollOptions(...)` into every count query on a live page, and build the pill's
// props with `liveStatusProps([...those queries])`. Adding a query without doing both is the bug.

export const LIVE_POLL_MS = 20_000;

// `includesToday` defaults true for pages with no date range (the platform control room): a page
// that can't be scrolled into the past is always "now". Pages that CAN show a historical range pass
// it explicitly, so a past range stops polling instead of re-fetching a frozen answer every 20s.
export function livePollOptions(live, includesToday = true, intervalMs = LIVE_POLL_MS) {
  return {
    refetchInterval: live && includesToday ? intervalMs : false,
    // A backgrounded tab left open all day shouldn't keep hitting the server.
    refetchIntervalInBackground: false,
  };
}

// The pill may promise no more freshness than its STALEST panel.
export function liveStatusProps(queries, { live, onToggle }) {
  const loaded = queries.filter(Boolean);
  // A query that has never resolved reports dataUpdatedAt: 0 — feeding that to Math.min would date
  // the whole page to 1970. Drop the zeroes; if nothing has loaded yet, LiveStatus renders
  // "just now" for a falsy stamp, which is right for a page that is still doing its first fetch.
  const stamps = loaded.map((q) => q.dataUpdatedAt).filter(Boolean);
  return {
    live,
    onToggle,
    isFetching: loaded.some((q) => q.isFetching),
    updatedAt: stamps.length ? Math.min(...stamps) : 0,
    onRefresh: () => loaded.forEach((q) => q.refetch()),
  };
}
