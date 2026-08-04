// Pure helpers for the Turf Cutting map's building markers (TurfsPage.jsx).
//
// Building markers are HTML DOM overlays (mapboxgl.Marker). At 107k doors a
// campaign can hold ~3,100 stacked-coordinate buildings — creating a DOM node
// for every one, and tearing them ALL down on every toggle change, is what made
// the cut map jank. The fix: only markers inside the (padded) viewport exist,
// synced by diffing against what's already on the map; above MAX_DOM_MARKERS
// the DOM layer stands down entirely (the building-dots circle layer keeps
// every building visible and clickable at any zoom — nothing is clustered).

export const MAX_DOM_MARKERS = 300;

// bounds: { west, south, east, north } (from map.getBounds()). Pads by
// marginFrac per side so slow pans hit pre-created markers instead of pop-in.
export function inBoundsWithMargin(bounds, lng, lat, marginFrac = 0.2) {
  const mLng = (bounds.east - bounds.west) * marginFrac;
  const mLat = (bounds.north - bounds.south) * marginFrac;
  return (
    lng >= bounds.west - mLng &&
    lng <= bounds.east + mLng &&
    lat >= bounds.south - mLat &&
    lat <= bounds.north + mLat
  );
}

// Render signature: a marker is rebuilt only when something it DRAWS changed.
export function markerSig(color, badgeText, dimmed, dark) {
  return `${color}|${badgeText ?? ''}|${dimmed ? 1 : 0}|${dark ? 1 : 0}`;
}

/**
 * Diff the currently-rendered marker map against the wanted set.
 *   current: Map<key, { sig }>   wanted: Map<key, { sig }>
 * Returns { remove: [key], create: [key], rebuild: [key] } — create/rebuild are
 * separated so the caller can reuse expensive teardown-free paths later if it
 * wants; today both mean "make a fresh element".
 */
export function diffMarkers(current, wanted) {
  const remove = [];
  const create = [];
  const rebuild = [];
  for (const key of current.keys()) {
    if (!wanted.has(key)) remove.push(key);
  }
  for (const [key, w] of wanted) {
    const cur = current.get(key);
    if (!cur) create.push(key);
    else if (cur.sig !== w.sig) rebuild.push(key);
  }
  return { remove, create, rebuild };
}
