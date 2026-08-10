import { api } from './api';
import { saveBootstrap, loadBootstrap } from './cache';
import { reconcilePendingHouseholds, reconcilePendingLocations } from './recordAction';

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
  return async () => {
    try {
      const fresh = await api(`/mobile/bootstrap?campaignId=${campaignId}`);
      fresh.households = reconcilePendingLocations(reconcilePendingHouseholds(fresh.households));
      // Fire-and-forget: saveBootstrap never rejects, and awaiting a multi-MB
      // disk write here would only delay first paint of the fresh data.
      saveBootstrap(fresh);
      return fresh;
    } catch (err) {
      // A 404 is the server giving an ANSWER — this campaign is not canvassable any more
      // (archived, deleted, access revoked) — not a transport failure. Falling back to the disk
      // snapshot here opened the canvasser flow on stale doors whose knocks could never be
      // recorded, with no error shown at all. Offline failures carry no `.status` (lib/api.js),
      // so the cache fallback below still covers the case it was written for.
      if (err?.status === 404) throw err;
      const live = qc.getQueryData(['bootstrap']);
      if (live && String(live.campaign?.id) === String(campaignId)) throw err;
      const cached = await loadBootstrap();
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
        return {
          ...cached,
          households: reconcilePendingLocations(reconcilePendingHouseholds(cached.households)),
          fromDiskCache: true,
        };
      }
      throw err;
    }
  };
}
