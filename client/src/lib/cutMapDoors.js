// Which doors the Turf Cutting map should draw, and which count as "loose".
//
// The rule this file exists to hold: "in a book" means in one of THIS PASS's books —
// never `turfId != null`. Household.turfId is a single global pointer and a cut only
// re-points the doors it selects, so a door a targeted Pass-2 cut skipped still carries
// its Pass-1 book id. Judged by turfId presence it would read "booked" (and gray-fallback
// against this pass's palette); judged by pass membership it reads loose — which is what
// the page means. cutMapDoors.test.js pins both this and the pre-cut rule below.
//
// Since Aug 2026 the SERVER already answers pass-scoped: /doors resolves each door's turfId
// from the pass's own Turf.householdIds, never the mirror (cutting a future draft round used
// to make this page hide the live round's 12k doors as "not in any book"). The set-membership
// check here stays as defense — a foreign id can then only ever read as loose, never booked.

// The pass's own book ids, as the string Set every door check runs against.
export const passBookIds = (turfs) => new Set((turfs || []).map((t) => String(t._id)));

// A door is loose when it is not in one of this pass's books. `String(null)` is never in
// the set, so turfId-null doors (new imports) are loose too.
export const isLooseDoor = (door, bookIds) => !bookIds.has(String(door.turfId));

// The doors the map should draw. Before any cut there are no books, so nothing hides —
// the classic full-universe gray pre-cut map stays intact. After a cut, loose doors hide
// unless `showLoose` (the "Not in a book" Layers toggle) is on.
export const visibleCutDoors = (doors, bookIds, showLoose) => {
  const all = doors || [];
  const hideLoose = bookIds.size > 0 && !showLoose;
  return hideLoose ? all.filter((d) => !isLooseDoor(d, bookIds)) : all;
};

// Count behind the "Not in a book (N)" toggle label. 0 before any cut (no books = nothing
// is meaningfully "not in a book" yet), which also keeps the toggle row hidden pre-cut.
export const countLooseDoors = (doors, bookIds) =>
  bookIds.size ? (doors || []).filter((d) => isLooseDoor(d, bookIds)).length : 0;
