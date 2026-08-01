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
      const live = qc.getQueryData(['bootstrap']);
      if (live && String(live.campaign?.id) === String(campaignId)) throw err;
      const cached = await loadBootstrap();
      if (cached && String(cached.campaign?.id) === String(campaignId)) return cached;
      throw err;
    }
  };
}
