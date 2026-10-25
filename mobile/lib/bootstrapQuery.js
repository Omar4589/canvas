import { useEffect } from 'react';
import { isCancelledError } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import { api } from './api';
import { getSessionGeneration } from './authState';
import { saveBootstrap, loadBootstrap, loadActiveCampaign } from './cache';
import { reconcilePendingHouseholds, reconcilePendingLocations } from './recordAction';
import { newerPace } from './pace';
import { rosterErrorIsFinal, seatedRosterView } from './seatedRoster';

export { isForeignRoster, rosterErrorIsFinal } from './seatedRoster';

// The one retry a failed roster fetch gets, after react-query's own first-retry delay.
const RETRY_DELAY_MS = 1000;
// Counts roster fetches, so a retry can tell a newer fetch (a Refresh, a door write's refresh) has
// replaced its own.
let latestRosterFetch = 0;

// THE bootstrap queryFn — shared by the map and the books screen so ['bootstrap']
// has exactly one fetch behavior. Two invariants both screens must honor:
//
// 1. Every fresh fetch runs through the pending overlays, so a refetch resolving
//    right after an optimistic recolor can't revert it (books.jsx used to skip
//    this, and its refetch-on-mount could flash a just-knocked door backwards).
//
// 2. The disk cache is a COLD-START fallback only. On a failed REFETCH we rethrow:
//    react-query then keeps the previous in-memory data (optimistic recolors +
//    applied deltas), whereas returning the disk snapshot here would REPLACE live
//    state with an older one — mid-shift, on any flaky fetch or deploy 503, doors
//    would snap back to whatever the disk last saw.
export function bootstrapQueryFn(qc, campaignId) {
  const fetchRoster = async () => {
    // Which person's session this fetch belongs to. A roster that lands after that session ended
    // (signed out, or someone else signed in on this phone) is discarded: it must never be written
    // to disk or shown under the next person. A daily extension or a password typed into the
    // in-place screen is the same session and doesn't change this. (Deliberately not react-query's
    // abort signal: consuming it would also abort a multi-MB download whenever the map unmounts.)
    const generation = getSessionGeneration();
    const sessionChanged = () => getSessionGeneration() !== generation;
    try {
      const fresh = await api(`/mobile/bootstrap?campaignId=${campaignId}`);
      if (sessionChanged()) throw new Error('The session changed while the houses were loading.');
      fresh.households = reconcilePendingLocations(reconcilePendingHouseholds(fresh.households));
      // The automatic-pause state (lib/pace.js): a roster that left the server before a newer answer
      // landed — a door write's reply, the paused banner's poll — keeps that newer answer.
      const pace = newerPace(qc.getQueryData(['bootstrap'])?.pace, fresh.pace);
      if (pace) fresh.pace = pace;
      // Fire-and-forget: saveBootstrap never rejects, and awaiting a multi-MB
      // disk write here would only delay first paint of the fresh data.
      saveBootstrap(fresh);
      return fresh;
    } catch (err) {
      if (sessionChanged()) throw err;
      // Doorline's final answer about this campaign (archived or deleted 404, not assigned 403, a
      // bad request: lib/seatedRoster.js rosterErrorIsFinal) is an ANSWER, not a transport failure.
      // Falling back to the disk snapshot here opened the canvasser flow on stale doors whose knocks
      // could never be recorded, with no error shown at all. Offline failures carry no `.status`
      // (lib/api.js), and a captive portal's or proxy's error page is no answer of ours, so the
      // cache fallback below still covers both.
      if (rosterErrorIsFinal(err)) throw err;
      const live = qc.getQueryData(['bootstrap']);
      if (live && String(live.campaign?.id) === String(campaignId)) throw err;
      const cached = await loadBootstrap();
      if (sessionChanged()) throw err;
      if (cached && String(cached.campaign?.id) === String(campaignId)) {
        // Cold-start offline fallback. Two amendments before serving it:
        // 1. Re-apply the pending overlays — actions queued AFTER this snapshot
        //    was written aren't in it, so without this a dead-signal cold start
        //    painted doors the canvasser just worked as un-knocked ("the app
        //    moved me back in time").
        // 2. Mark it as the disk snapshot (`fromDiskCache`). The map banners its
        //    server age (generatedAt) and — crucially — must NOT treat its
        //    possibly-outdated books list as authority to evict the canvasser
        //    from their selected book. The first successful delta triggers a full
        //    bootstrap refetch (map.jsx), whose fresh data replaces this marker;
        //    saveBootstrap never persists it.
        // 3. Say WHY (`fallbackReason`): a 401 means the phone is online but needs the password
        //    again, which DataHealthBanner words differently from being offline.
        return {
          ...cached,
          households: reconcilePendingLocations(reconcilePendingHouseholds(cached.households)),
          fromDiskCache: true,
          // Only a coded session end (err.reason, set by lib/api.js) — an older server's uncoded
          // 401 reaches no password screen, so it must not read as "password needed".
          fallbackReason: err?.reason ? 'auth' : 'offline',
        };
      }
      throw err;
    }
  };
  // One attempt, its failure tagged with the campaign it was for: a screen that has just seated
  // another campaign must not show it as its own (lib/seatedRoster.js).
  const attempt = async () => {
    try {
      return await fetchRoster();
    } catch (err) {
      if (err && typeof err === 'object') err.campaignId = campaignId;
      throw err;
    }
  };
  // One retry, like every other query's (retryUnless401) — made here, so both attempts fetch THIS
  // campaign. react-query re-reads the query's options for each of its own retries, and the door
  // screens subscribe to ['bootstrap'] without a query function, which left such a retry with none
  // ("Missing queryFn" under the map); the map and books set retry: false. Never for a 401 (the
  // password screen's job), for Doorline's final answer about the campaign, once the person on the
  // phone changed, or once another campaign is seated (a download that failed after the person moved
  // on isn't worth a second try: the new campaign's screen fetches its own).
  // Nor once react-query has let go of this fetch: a door write or a Refresh cancelled it, a newer
  // fetch replaced it, or the query was removed. Its own retries stopped there; this one must too, or
  // it downloads the whole roster again and can save an older copy over a newer one.
  return async () => {
    const generation = getSessionGeneration();
    const mine = ++latestRosterFetch;
    const query = qc.getQueryCache().find({ queryKey: ['bootstrap'], exact: true });
    const stillWanted = async () => {
      const seated = await loadActiveCampaign().catch(() => null);
      return (
        getSessionGeneration() === generation &&
        String(seated?.id) === String(campaignId) &&
        mine === latestRosterFetch &&
        qc.getQueryCache().find({ queryKey: ['bootstrap'], exact: true }) === query &&
        query?.state.fetchStatus === 'fetching'
      );
    };
    try {
      return await attempt();
    } catch (err) {
      if (err?.status === 401 || rosterErrorIsFinal(err) || !(await stillWanted())) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      if (!(await stillWanted())) throw err;
      return attempt();
    }
  };
}

// The map and books screens' view of the shared ['bootstrap'] query for the campaign seated on this
// phone (the rules are in lib/seatedRoster.js): another campaign's roster or failure never shows as
// this campaign's, a refresh cancelled by a door write is not a failure, and this campaign's roster
// is fetched whenever something else sits in the way — again each time the cached roster or failure
// changes, so a fetch still running for the previous campaign is followed by one for this campaign.
// Joins a fetch already in flight rather than restarting it. Only the screen in front fetches: two
// field screens left mounted on different campaigns would otherwise take turns replacing each
// other's roster forever (expo-router keeps stack screens mounted underneath).
export const useSeatedRoster = (query, campaignId) => {
  const isFocused = useIsFocused();
  const { data: roster, error: queryError, refetch } = query;
  const view = seatedRosterView({
    roster,
    error: queryError,
    cancelled: isCancelledError(queryError),
    campaignId,
  });
  const { waiting } = view;
  useEffect(() => {
    if (waiting && isFocused) refetch({ cancelRefetch: false });
  }, [waiting, isFocused, roster, queryError, refetch]);
  return view;
};
