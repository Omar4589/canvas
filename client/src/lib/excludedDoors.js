// Which doors the admin map draws once "Doors excluded from books" is set to Dim or Hide.
//
// The rule this file exists to hold: excluded doors are NEVER filtered server-side. The admin
// map is the record of what exists and what was worked and billed — an excluded apartment door
// can still be flagged, overlapped, or marked do-not-contact, so /admin/households/map returns
// it and the CLIENT decides how to draw it. (Same rule as doNotKnock; see docs/MAPS.md §I.)
//
// Hide has to filter BEFORE groupHouseholds. Filter after and the hidden doors are still in
// `stackedIds`, so the household layer's `['!=', ['get','stacked'], true]` keeps them invisible
// anyway while the building glyph keeps counting them in `total` — the sidebar would then report
// stacked doors that are no longer on the map.
//
// Exclusion is CAMPAIGN-WIDE and provenance-free (the flag stores no effort/pass/actor), so copy
// here may say "not in books" and must never say "excluded from this walk list".

export const isExcludedDoor = (h) => h?.excludedFromTurf === true;

// mode: 'show' | 'dim' | 'hide'. Only 'hide' changes the door set — 'dim' is a paint concern,
// carried to the map as a per-feature property so the doors stay grouped, counted and clickable.
export const visibleMapDoors = (households, mode) =>
  mode === 'hide' ? (households || []).filter((h) => !isExcludedDoor(h)) : households || [];

// Counted over the doors in the current payload — which is viewport-bounded and capped at
// MAP_HOUSEHOLD_CAP. This is "of the doors in view" (what Dim / Hide will act on), never a
// campaign total — MapFilters labels it "in view" and sits the campaign-wide figures from
// /map/counts (matching.excludedFromTurf / universe.excludedFromTurf) beneath it. Neither will
// reconcile with Turf Cutting's effort-scoped excludedApartmentCount.
export const countExcludedDoors = (households) => (households || []).filter(isExcludedDoor).length;
