import * as turf from '@turf/turf';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { safeContains } from './boundary.js';
import { recomputePassTerritories } from './generateTurf.js';

// Redraw the book outlines a pin move just invalidated. Called by the ONE pin-move writer
// (services/households/updateHouseholdLocation.js) after the coordinate + audit rows are
// committed, so the web Map page, the mobile admin map, the canvasser FixPinModal and the Turf
// Cutting pop-ups all keep "every house sits inside its book's shape" the same way. Display-only:
// Turf.boundary + Turf.centroid are rewritten; householdIds, walkOrder, doorCount and
// Household.turfId are never touched (walk order is by design never recomputed mid-round — that
// is recomputeTurf's job on a MEMBER edit, and forbidden here).
//
// Which books, per live (non-archived) pass that books any moved door:
//   · the door's OWN book — its stored hull no longer contains the new point; and
//   · every other book whose stored shape CONTAINS the new point. Inserting a Voronoi site at
//     the new spot can only SHRINK its neighbours' cells, so a book whose shape covered that spot
//     would now overlap the moved door's cell and visibly contain someone else's door. Books near
//     the OLD spot only GROW (the removal case in boundary.js) — their stored shapes stay
//     contained and disjoint, at worst un-drawn by a notch, never overlapping. The residue (the
//     moved door's new cell ∩ a Voronoi-adjacent book that did NOT contain the point) is
//     lot-scale, usually 0 m², and `npm run recompute:territories -- --apply` heals it.
// Archived passes are skipped explicitly: archiving a Pass leaves its Turfs `published`
// (routes/admin/passes.js), and a finished round's shapes are history, not a promise.
//
// Scale guard: the fixed cost is the one move-door already pays inline — every member location +
// one turf.voronoi over the whole pass (recomputePassTerritories) — fine at 16k doors, minutes at
// 250k. Past TURF_REHULL_INLINE_MAX_DOORS booked doors the pass is skipped (logged) so the pin
// PATCH stays under Heroku's 30 s router. No queue job on purpose: the TURF queue is concurrency-1
// behind long generates, and a pin move must never depend on Redis. The env is read at call time
// (balancedKMeans.js precedent) so an operator — or a test — can turn it without a restart.
//
// Best-effort: a failure on one pass is logged and the others still run; the caller has already
// committed the pin and never throws because of this. Must NOT import CanvassActivity —
// docs/AUDIT.md promises the pin-move path writes no activity rows.
//
// Returns the turf ids rewritten (string[]) — [] when no live book holds a moved door.

const LIVE_BOOK_STATUS = { $in: ['draft', 'published'] };
const DEFAULT_INLINE_MAX_DOORS = 60000;

const inlineMaxDoors = () => Number(process.env.TURF_REHULL_INLINE_MAX_DOORS) || DEFAULT_INLINE_MAX_DOORS;

export const rehullBooksForMovedHouseholds = async ({ campaignId, householdIds, point }) => {
  if (!campaignId || !householdIds?.length || !Array.isArray(point) || point.length !== 2) return [];

  const livePasses = await Pass.find({ campaignId, status: { $ne: 'archived' } }, { _id: 1 }).lean();
  if (!livePasses.length) return [];
  const own = await Turf.find(
    { passId: { $in: livePasses.map((p) => p._id) }, householdIds: { $in: householdIds }, status: LIVE_BOOK_STATUS },
    { _id: 1, passId: 1 }
  ).lean();
  if (!own.length) return [];

  // Own books, grouped by pass — one re-tessellation per pass, never per door.
  const ownByPass = new Map();
  for (const t of own) {
    const k = String(t.passId);
    if (!ownByPass.has(k)) ownByPass.set(k, new Set());
    ownByPass.get(k).add(String(t._id));
  }

  const pt = turf.point(point);
  const recomputed = [];
  for (const [passId, ownIds] of ownByPass) {
    try {
      // Scale guard FIRST — a doorCount-only projection, before any geometry is loaded.
      const booked = await Turf.find({ passId, status: LIVE_BOOK_STATUS }, { doorCount: 1 }).lean();
      const doors = booked.reduce((n, t) => n + (t.doorCount || 0), 0);
      const max = inlineMaxDoors();
      if (doors > max) {
        console.warn(`[pin-move] skipped re-hull: pass ${passId} has ${doors} booked doors (cap ${max})`);
        continue;
      }

      // Neighbour expansion: the other books whose stored shape covers the new spot.
      const others = await Turf.find(
        { passId, status: LIVE_BOOK_STATUS, _id: { $nin: [...ownIds] } },
        { _id: 1, boundary: 1 }
      ).lean();
      const onlyTurfIds = [...ownIds];
      for (const t of others) {
        if (t.boundary && safeContains(t.boundary, pt)) onlyTurfIds.push(String(t._id));
      }

      await recomputePassTerritories(passId, { onlyTurfIds, withCentroid: true });
      recomputed.push(...onlyTurfIds);
    } catch (err) {
      console.error(`[pin-move] re-hull failed for pass ${passId}:`, err?.message || err);
    }
  }
  return recomputed;
};
