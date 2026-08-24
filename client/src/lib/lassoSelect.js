// "Select doors" — the pure half of the lasso: hit-testing a drawn ring against the doors the
// map is DRAWING, and turning the resulting selection into the two desk-restrict payloads.
// Shared by the Turf Cutting page and the admin Map page so both pages catch the same doors,
// print the same breakdown, and send the same ids. Dependency-free and pinned by
// lassoSelect.test.js.
//
// THE RULE the whole file exists to hold: the lasso catches WHAT IS DRAWN, never
// `queryRenderedFeatures`. The rendered query can't see a door just off-screen, can't tell a
// markable door from a completed one, and on the Turf page can't see the three visibility
// mechanisms that live in Mapbox layer state. So each page hands us its own drawn array and we
// answer geometrically — in lng/lat, because that is the one coordinate space both the ring
// (unprojected by useLassoDraw) and the doors already live in.
//
// Everything here is O(n) with a plain loop and no spread: campaigns with 250k doors exist and
// `Math.min(...xs)` on one of them is a RangeError, not a slowdown (the same stack overflow
// server/src/services/turf/spatial.js:59-61 documents killing a whole cut).

import { buildingKeyForCoords } from './buildings.js';

// The server takes 1–1000 household ids per request (parseHouseholdIds, routes/admin/turfs.js).
// The selection is capped at the same number so one lasso is always exactly one request: chunking
// would pay recomputeCampaignStats' whole-ledger recompute once per chunk.
export const SELECTION_CAP = 1000;

// Doors already done keep their result — the server skips them (planDeskRestrict) and so does the
// preview. Mirrors buildings.js's DONE_STATUSES and the desk-restrict ladder.
const COMPLETED_STATUSES = new Set(['surveyed', 'lit_dropped']);

// A door's id, however the page shapes its rows (the Map page's /map payload and the Turf page's
// /doors payload both use `id`; a bare string is accepted so callers can pass ids straight in).
const idOf = (d) => {
  if (typeof d === 'string') return d;
  if (!d) return null;
  const raw = d.id ?? d._id;
  return raw == null ? null : String(raw);
};

// Coordinate accessors that cover both payload shapes without allocating: the Map page nests
// ({ location: { lng, lat } }, and `location` is null for an ungeocoded door), the Turf page is
// flat ({ lng, lat }).
const defaultLng = (d) => (d && d.location ? d.location.lng : d && d.lng);
const defaultLat = (d) => (d && d.location ? d.location.lat : d && d.lat);

// Even-odd (crossing-number) ray cast. `ring` is [[x, y], …] in ANY units — we feed it lng/lat.
// A closing vertex equal to the first is tolerated (a zero-length edge crosses nothing), so a
// GeoJSON ring and an open path both work.
//
// Boundary points are decided by the half-open `(yi > y) !== (yj > y)` test rather than by an
// epsilon: a point exactly on an edge or vertex lands inside or outside deterministically but not
// symmetrically. That is the right trade for a hand-drawn lasso — nobody can place a door on the
// line on purpose — and the test file pins the outcome so a rewrite can't quietly change it.
export const pointInRing = (x, y, ring) => {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const xi = a[0];
    const yi = a[1];
    const xj = b[0];
    const yj = b[1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// The ring's bounds in ONE pass. Never `Math.min(...xs)`: a densified freehand path is thousands
// of vertices and spreading one argument per vertex overflows the call stack. Returns null for a
// degenerate ring so callers can bail before touching the door array.
export const ringBBox = (ring) => {
  if (!ring || ring.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const x = p[0];
    const y = p[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) && Number.isFinite(minY) ? { minX, minY, maxX, maxY } : null;
};

// The doors inside the ring, as the caller's own row objects (never copies — the caller reads
// status/effort off them straight after). Bounds-prefiltered so a small lasso over a 50k-door
// viewport pays one comparison per door instead of a full ray cast.
export const doorsInRing = ({ doors, ring, getLng = defaultLng, getLat = defaultLat }) => {
  const hits = [];
  const list = doors || [];
  const bb = ringBBox(ring);
  if (!bb || !list.length) return hits;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    const x = getLng(d);
    const y = getLat(d);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue; // ungeocoded — it isn't drawn
    if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) continue;
    if (pointInRing(x, y, ring)) hits.push(d);
  }
  return hits;
};

// The building key a door's pin rounds to, or null when it has no pin.
const defaultBuildingKey = (d) => buildingKeyForCoords(defaultLng(d), defaultLat(d));

// Take every unit at a hit building. Units in one building share a ROUNDED key (~1.1 m,
// buildings.js:22) but the glyph is drawn at the FIRST unit's real coordinate, so a lasso edge can
// slice a stack and take 3 of 5 units while ringing a glyph that stands for all 5. Whatever the
// admin ringed, they meant the building.
//
// Returns `hits` itself when nothing expands, so an unchanged result is reference-stable.
export const snapBuildings = (hits, doors, keyOf = defaultBuildingKey) => {
  const list = doors || [];
  if (!hits || !hits.length || !list.length) return hits || [];
  const keys = new Set();
  const seen = new Set();
  for (let i = 0; i < hits.length; i++) {
    const k = keyOf(hits[i]);
    if (k) keys.add(k);
    const id = idOf(hits[i]);
    if (id) seen.add(id);
  }
  if (!keys.size) return hits;
  let out = null;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    const id = idOf(d);
    if (!id || seen.has(id)) continue;
    const k = keyOf(d);
    if (!k || !keys.has(k)) continue;
    seen.add(id);
    if (!out) out = hits.slice();
    out.push(d);
  }
  return out || hits;
};

// Union (or subtract) one lasso's hits into the selection.
//   mode 'add'      → { ids: next Set, added, removed: 0, overCap, wouldBe }
//   mode 'subtract' → the same shape, never over cap
//
// An over-cap lasso is REFUSED WHOLE and the caller shows the count it would have needed: neither
// map payload is sorted (households.js limits without sorting), so "the first 1,000 of them" is an
// arbitrary, unrepeatable subset — silently truncating would mark doors nobody picked. The
// original Set comes back by REFERENCE on a refusal so a `setState` bails out instead of
// re-rendering every ring.
export const applySelection = (current, hits, mode = 'add') => {
  const base = current instanceof Set ? current : new Set(current || []);
  const list = hits || [];
  if (mode === 'subtract') {
    let removed = 0;
    let next = null;
    for (let i = 0; i < list.length; i++) {
      const id = idOf(list[i]);
      if (!id || !base.has(id)) continue;
      if (!next) next = new Set(base);
      next.delete(id);
      removed += 1;
    }
    return { ids: next || base, added: 0, removed, overCap: false, wouldBe: base.size - removed };
  }
  // Deduped: snapBuildings can hand back the same unit twice if a caller passes overlapping hits,
  // and a double-counted `added` would refuse a lasso that fits.
  const fresh = new Set();
  for (let i = 0; i < list.length; i++) {
    const id = idOf(list[i]);
    if (!id || base.has(id)) continue;
    fresh.add(id);
  }
  const wouldBe = base.size + fresh.size;
  if (wouldBe > SELECTION_CAP) return { ids: base, added: 0, removed: 0, overCap: true, wouldBe };
  if (!fresh.size) return { ids: base, added: 0, removed: 0, overCap: false, wouldBe };
  const next = new Set(base);
  for (const id of fresh) next.add(id);
  return { ids: next, added: fresh.size, removed: 0, overCap: false, wouldBe };
};

// What a row's status says about it. Written as an EXCLUSION exactly like the server's scope rule
// (deskRestrict.js planDeskRestrict), so a status added later reads as `reached` — under-marking a
// preview is recoverable, silently promoting a new status into "will be marked" is not.
const bucketFor = (status) => {
  const s = status || 'unknocked';
  if (COMPLETED_STATUSES.has(s)) return 'completed';
  if (s === 'restricted') return 'restricted';
  if (s === 'unknocked') return 'unknocked';
  return 'reached';
};

// The selection, classified, plus the two payloads.
//
// `rows` are the DRAWN rows for the selected ids — resolve the Set against the drawn array first,
// so a door a refetch dropped can neither be counted nor sent. Each row is read for:
//   id, status  — the door's status IN THE SCOPE THE PAGE IS SHOWING (per-round `passStatus` when
//                 a pass scope is active, else the global sticky Household.status)
//   effortId    — its walk list. `null` means Intake and is load-bearing; `undefined` means the
//                 payload doesn't carry the field (the Turf page's /doors rows, where every door
//                 is the pass's effort by construction) and must NEVER read as Intake.
//   excludedFromTurf, doNotKnock — the two KNOCKABLE_DOOR_FILTER flags the map payload exposes.
//
// Options:
//   forRound    — a pass scope is active, so `status` answers the round the server will write to.
//                 When false the per-round buckets come back NULL rather than as numbers: the Map
//                 page's global status is sticky-completed and campaign-wide (households.js:610),
//                 a different question from the one the server asks, and printing it as
//                 "completed this round" would be a confident lie. The response tally owns those
//                 numbers instead.
//   sendsPassId — the request will name a passId. Defaults to `forRound`, which is the same
//                 condition on both pages.
//
// The two payloads are DIFFERENT on purpose:
//   markIds   drops Intake, excluded-from-books and do-not-knock doors. One Intake door 400s the
//             whole batch with PASS_REQUIRED and writes nothing (turfs.js:1012); the other two are
//             rejected by KNOCKABLE_DOOR_FILTER and would land in `skipped.ineligible`.
//   unmarkIds drops ONLY Intake, and only when no passId is sent (that is the only case that
//             resolves a round per door). unrestrict-doors applies no knockable filter, no effort
//             guard and no pass-existence check (turfs.js:1046-1049) — a door desk-marked in March
//             and excluded-from-books in April is still unmarkable today, and filtering it out
//             would strand its mark forever.
// Doors that WILL be skipped (completed, already restricted) still ride along in markIds: the
// server's own per-round classification is exact where ours can be stale, and under scope
// 'unknocked' it needs the reached doors present to count them.
export const planDoorSelection = (rows, { forRound = false, sendsPassId = forRound } = {}) => {
  const list = rows || [];
  const markIds = [];
  const unmarkIds = [];
  const cannotMarkReasons = { intake: 0, excluded: 0, doNotKnock: 0 };
  let cannotMark = 0;
  let unknocked = 0;
  let reached = 0;
  let alreadyRestricted = 0;
  let completed = 0;

  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const id = idOf(row);
    if (!id) continue;
    const intake = row.effortId === null;
    const excluded = row.excludedFromTurf === true;
    const dnk = row.doNotKnock === true;

    if (!intake || sendsPassId) unmarkIds.push(id);

    if (intake || excluded || dnk) {
      cannotMark += 1;
      // One door can trip more than one gate; name the first that applies, biggest first, so the
      // reasons sum to `cannotMark` and the popover's lines add up.
      if (intake) cannotMarkReasons.intake += 1;
      else if (excluded) cannotMarkReasons.excluded += 1;
      else cannotMarkReasons.doNotKnock += 1;
      continue;
    }
    markIds.push(id);
    switch (bucketFor(row.status)) {
      case 'completed':
        completed += 1;
        break;
      case 'restricted':
        alreadyRestricted += 1;
        break;
      case 'unknocked':
        unknocked += 1;
        break;
      default:
        reached += 1;
    }
  }

  return {
    total: list.length,
    perRound: forRound,
    // Doors this action would actually mark. Per-round exact when a pass scope is active; in
    // global mode it is every eligible door and the server's tally narrows it.
    markable: forRound ? unknocked + reached : markIds.length,
    unknocked: forRound ? unknocked : null,
    reached: forRound ? reached : null,
    alreadyRestricted: forRound ? alreadyRestricted : null,
    completedThisRound: forRound ? completed : null,
    cannotMark,
    cannotMarkReasons,
    markIds,
    unmarkIds,
  };
};
