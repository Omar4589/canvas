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

// Per-round statuses that mean "off the table": restricted access and a posted no-soliciting
// sign. In status mode their dots are the darkest on the map (slate/pink), and on a heavily
// desk-restricted round they bury the work — so the Layers box offers to hide them. Judged on
// `passStatus` (what colors the dot), never the global `Household.status` a prior round set.
export const OFF_LIMITS_STATUSES = new Set(['restricted', 'no_soliciting']);
export const isOffLimitsDoor = (d) => OFF_LIMITS_STATUSES.has(d.passStatus);

// A stack is off the table only as a WHOLE: every unit off-limits. A mixed stack keeps all
// its units on the map — its pin is a book-membership object over several statuses, and
// dropping single units would change stack totals and pin ownership. A fully off-limits
// stack, though, is the building-shaped version of the solid empty book: badged
// "12/12 hit" in book color while nobody could enter — so the page paints it slate and the
// off-limits toggle hides it whole.
export const isOffLimitsStack = (units) => (units || []).length > 0 && units.every(isOffLimitsDoor);

// The books that toggle leaves with NOTHING drawn — the ones whose polygon would otherwise sit
// on the map as an empty filled shell. A fully off-limits book reads knocked === total, so its
// completion tint is SOLID: on a decluttered map the emptiest books would render the boldest.
// The page drops their fill, outline and label; every other book keeps its shape, because a
// shape over live doors is exactly what the admin still wants to see.
//
// Two rules earn their keep here. (1) The test is "nothing of this book is still drawn", never
// "the book is fully restricted": a MIXED stack is never status-hidden, so a book holding one
// keeps its shape or the surviving pin strands over nothing — while a fully off-limits stack
// hides with the toggle (isOffLimitsStack), so its units keep no book's shape alive. (2) A
// unit counts for ITS OWN book, not the stack's pin owner — a stack can span books while the
// pin takes units[0]'s turfId, so judging by the pin would hide book B's shape while a door
// of B's is on screen under book A's pin.
//
// Only books emptied BY the hiding are named: one that already drew no dots (all its doors
// non-knockable, so /doors never returned them) never enters `had`, and keeps the bare shape it
// has always drawn. Call only while hiding is on.
export const booksEmptiedByOffLimits = ({ singles = [], buildings = [] } = {}) => {
  const had = new Set(); // books with at least one door in the drawn set
  const kept = new Set(); // …of those, the ones with at least one door still drawn
  const note = (turfId, drawn) => {
    if (!turfId) return; // a loose door belongs to no book, so it can empty none
    const id = String(turfId);
    had.add(id);
    if (drawn) kept.add(id);
  };
  for (const b of buildings) {
    const drawn = !isOffLimitsStack(b.units); // a hidden stack keeps no book on the map
    for (const u of b.units || []) note(u.turfId, drawn);
  }
  for (const d of singles) note(d.turfId, !isOffLimitsDoor(d));
  const emptied = new Set();
  for (const id of had) if (!kept.has(id)) emptied.add(id);
  return emptied;
};

// What the map is ACTUALLY DRAWING right now — the pool a lasso is allowed to catch.
//
// `visibleCutDoors` above answers only the first of the page's FOUR visibility mechanisms.
// The second is the off-limits toggle (`hideOffLimits` below — the "Restricted & no
// soliciting" Layers row), another data filter. The other two live in Mapbox layer state,
// where no memo can see them:
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

export const drawnCutDoors = ({ doors, bookIds, showLoose, visibleBookIds = null, housesVisible = true, hideOffLimits = false, keyOf = doorKey }) => {
  if (!housesVisible) return NO_DOORS;
  let visible = visibleCutDoors(doors, bookIds, showLoose);
  if (hideOffLimits) {
    // Hides off-limits SINGLE-home dots, and whole stacks in which EVERY unit is off-limits
    // (see isOffLimitsStack above). A mixed stack keeps every unit — including its off-limits
    // ones — since the stack is drawn as one pin; dropping single units would change stack
    // totals and pin ownership. Group sizes and liveness are counted over the same set
    // groupDoors receives, so "single here" is exactly "drawn as a lone dot on the map",
    // and a surviving stack's units all survive, so the pin-owner map below is undisturbed.
    const sizes = new Map(); // key -> unit count
    const live = new Set(); // keys with at least one non-off-limits unit
    for (const d of visible) {
      const k = keyOf(d);
      if (!k) continue;
      sizes.set(k, (sizes.get(k) || 0) + 1);
      if (!isOffLimitsDoor(d)) live.add(k);
    }
    visible = visible.filter((d) => {
      if (!isOffLimitsDoor(d)) return true;
      const k = keyOf(d);
      return !!k && sizes.get(k) >= 2 && live.has(k);
    });
  }
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
