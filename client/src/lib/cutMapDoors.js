import { buildingKeyForCoords } from './buildings.js';

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

// What the map is ACTUALLY DRAWING right now — the pool a lasso is allowed to catch.
//
// `visibleCutDoors` above answers only one of the page's three visibility mechanisms. The other
// two live in Mapbox layer state, where no memo can see them:
//   · the book-status chips (Assigned / Completed / …) hide non-matching books AND their dots
//     via `setFilter('doors', ['in', ['get','turfId'], …])` — and a loose door's `turfId`
//     property is the empty string, which is in no book's id list, so every loose door is
//     hidden the moment ANY chip is on;
//   · the Houses layer toggle hides the door dots, the building dots and the HTML building
//     markers together, so with it off nothing on the map is selectable at all.
// Answering "what is drawn" anywhere else would silently drift from those two.
//
// The chip filter is applied per BUILDING, not per door: stacked units are drawn as one
// building pin whose `turfId` is the FIRST unit's (groupDoors in TurfsPage), so a mixed-book
// stack is drawn — or hidden — as a unit. Judging each unit on its own turfId would let the
// lasso catch a door whose pin isn't on the screen (or miss one that is).
const NO_DOORS = []; // one stable reference, so a houses-off render doesn't churn every memo
const doorKey = (d) => buildingKeyForCoords(d.lng, d.lat);

export const drawnCutDoors = ({ doors, bookIds, showLoose, visibleBookIds = null, housesVisible = true, keyOf = doorKey }) => {
  if (!housesVisible) return NO_DOORS;
  const visible = visibleCutDoors(doors, bookIds, showLoose);
  if (!visibleBookIds) return visible; // no chip active = every visible door is drawn
  // The door whose turfId the shared pin is drawn under, per rounded building key.
  const pinOwner = new Map();
  for (const d of visible) {
    const k = keyOf(d);
    if (k && !pinOwner.has(k)) pinOwner.set(k, d);
  }
  return visible.filter((d) => {
    const k = keyOf(d);
    const owner = (k && pinOwner.get(k)) || d;
    return visibleBookIds.has(String(owner.turfId));
  });
};
