// Pure helpers for the Books map's round-wide door dots (books.jsx).
//
// At 100k+ doors the old flow — api() JSON.parse on the JS thread, 100k feature
// objects, then <ShapeSource shape={...}> serializing tens of MB across the RN
// bridge — froze the phone. The fix is a FILE-backed source: the server's
// format=geojson response is downloaded straight to the cache directory and the
// ShapeSource gets a file:// URL, so the native SDK fetches and parses it off
// the JS thread entirely. Every door stays on the map; nothing is clustered.

// Request + cache-file naming for one (campaign, pass, epoch) door set. The epoch
// is baked into the filename because the ShapeSource only refetches when its URL
// CHANGES — bump it on invalidation (e.g. bulk-restrict) and delete the old file.
export function doorDotsRequest(campaignId, passId, epoch = 0) {
  return {
    path: `/admin/campaigns/${campaignId}/turfs/doors?passId=${passId}&slim=1&format=geojson`,
    fileName: `door-dots-${campaignId}-${passId}-${epoch}.json`,
  };
}

// Layer filter for the density dots. The file now carries EVERY placed door
// (turfId null included — the server no longer pre-filters for us), so uncut
// doors are excluded here, in the layer, where it's free.
//   - nothing narrowed (every book visible): a cheap truthiness test — never make
//     the GPU evaluate a ~3k-id literal `in` against 100k features for a no-op.
//   - chips narrowing: the literal `in` on just the visible ids.
//   - promoted book: excluded (its doors come from the status-colored layer).
export function doorDotFilterExpr(visibleBookIds, totalBooks, promotedId) {
  const inBook = ['to-boolean', ['get', 'turfId']];
  const narrowed = totalBooks != null && visibleBookIds.length < totalBooks;
  const base = narrowed
    ? ['all', inBook, ['in', ['get', 'turfId'], ['literal', visibleBookIds]]]
    : inBook;
  return promotedId ? ['all', base, ['!=', ['get', 'turfId'], promotedId]] : base;
}
