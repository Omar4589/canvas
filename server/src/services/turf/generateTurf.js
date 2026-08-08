import { Campaign } from '../../models/Campaign.js';
import { Pass } from '../../models/Pass.js';
import { Household } from '../../models/Household.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { attributeCut } from './attributeCut.js';
import { geometricCut } from './geometricCut.js';
import { resolveWalkList, isActiveTargetFilter } from '../walklist/resolveWalkList.js';
import { computeBoundary, computeCentroid, computeTerritories } from './boundary.js';
import { computeWalkOrder } from './walkOrder.js';
import { KNOCKABLE_DOOR_FILTER } from '../canvass/knockableDoorFilter.js';

const CUT_COLUMNS = {
  location: 1,
  addressLine1: 1,
  precinctValue: 1,
  congressionalValue: 1,
  stateSenateValue: 1,
  stateHouseValue: 1,
  cityValue: 1,
  zipValue: 1,
  countyValue: 1,
};

// Orchestrates a turf generation run: load the pass's walk-list households,
// dispatch to the cut mode, compute boundary/centroid/walk-order per book, and
// persist Turf docs as drafts atomically (clearing prior drafts for the pass so
// a re-run / worker restart is clean). Mirrors turfId/walkOrder onto households.
export async function generateTurf({ campaignId, passId, mode, params = {}, generationJobId, generatedBy, onProgress }) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) throw new Error('Campaign not found');
  // A queued cut can be claimed AFTER a delete stamped the campaign — writing Turf rows
  // mid-cascade would orphan them (services/campaigns/deletionState.js).
  if (campaign.deletion?.requestedAt) throw new Error('Campaign is being deleted');
  const pass = await Pass.findOne({ _id: passId, campaignId }).lean();
  if (!pass) throw new Error('Pass not found');

  await onProgress?.({ phase: 'loading', pct: 5 });

  // A round cuts from its EFFORT's owned households (Household.effortId). Skip
  // fully-voted doors (everyone there already voted early) — they're not knockable,
  // so including them would balance books on dead doors. Mirrors the canvasser list.
  const baseFilter = {
    campaignId,
    effortId: pass.effortId,
    ...KNOCKABLE_DOOR_FILTER,
    'location.coordinates': { $exists: true, $ne: null },
    // Admin-reviewed second-pass removal: when set, this cut skips inaccessible homes
    // (Household.status === 'restricted'). Non-destructive — the homes stay in the
    // campaign/counts and re-enter scope automatically if re-dispositioned.
    ...(params.excludeRestricted ? { status: { $ne: 'restricted' } } : {}),
  };

  // Targeted follow-up round: restrict the universe to the effort's doors matching
  // a walk-list-shaped filter (knock status + survey answers, minus its exclude
  // branch). The existing fullyVoted/fullyDnc/excludedFromTurf/coords exclusions
  // still apply (intersection). The active check is shared with the resolver.
  const targeted = isActiveTargetFilter(params.targetFilter);
  if (targeted) {
    const { householdIds, excludeDegenerate } = await resolveWalkList(campaign, params.targetFilter, {
      effortId: pass.effortId,
    });
    // The admin asked to exclude doors but every exclude condition was unusable —
    // cutting anyway would silently send canvassers to the doors they removed. Fail
    // the job loudly instead (the throw surfaces via the generation job status).
    if (excludeDegenerate) {
      throw new Error('The exclusion filter has no valid conditions — fix or remove it, then re-cut');
    }
    baseFilter._id = { $in: householdIds };
  }
  // Record (or clear) what this round targeted — for reproducibility + a label.
  await Pass.updateOne({ _id: passId }, { $set: { targetFilter: targeted ? params.targetFilter : null } });

  let books;
  if (mode === 'manual') {
    // One or more hand-drawn areas. Each area is one book by default; with subCutN
    // set, big areas are geometrically split into ~subCutN-door walkable books.
    const polygons = params.polygons?.length ? params.polygons : params.polygon ? [params.polygon] : [];
    if (!polygons.length) throw new Error('manual mode requires params.polygons');
    const subCutN = Number(params.subCutN) || 0;
    books = [];
    let idx = 0;
    // Overlapping areas: first area drawn wins — a household only ever joins one
    // book (double-assignment would double-count doors and leave the turfId
    // mirror pointing at a random book).
    const claimed = new Set();
    for (const polygon of polygons) {
      idx += 1;
      const found = await Household.find(
        { ...baseFilter, location: { $geoWithin: { $geometry: polygon } } },
        CUT_COLUMNS
      ).lean();
      const hh = found.filter((h) => !claimed.has(String(h._id)));
      hh.forEach((h) => claimed.add(String(h._id)));
      if (!hh.length) continue;
      if (subCutN > 0 && hh.length > subCutN) {
        const chunks = geometricCut(hh, { maxDoors: subCutN });
        chunks.forEach((c, j) => books.push({ name: `Area ${idx} · ${j + 1}`, households: c.households }));
      } else {
        books.push({ name: `Area ${idx}`, households: hh, boundary: polygon });
      }
    }
    if (!books.length) throw new Error('No doors inside the drawn area(s)');
  } else {
    const households = await Household.find(baseFilter, CUT_COLUMNS).lean();
    await onProgress?.({ phase: 'clustering', pct: 25 });
    if (mode === 'attribute') {
      books = attributeCut(households, { attribute: params.attribute, capN: params.capN || null });
    } else if (mode === 'geometric') {
      books = geometricCut(households, { maxDoors: params.maxDoors || 65, tolerance: params.tolerance });
    } else {
      throw new Error(`Unknown mode: ${mode}`);
    }
  }

  await onProgress?.({ phase: 'boundaries', pct: 55, booksTotal: books.length });

  // Wipe prior drafts for this pass CLEANLY: drop their assignments and clear the
  // household mirror for their members before deleting, so a re-cut leaves no
  // orphaned assignments or stale Household.turfId behind. (The published guard on
  // /generate means only draft books can exist on the pass at this point.)
  const priorDrafts = await Turf.find({ passId, status: 'draft' }, { _id: 1 }).lean();
  if (priorDrafts.length) {
    const draftIds = priorDrafts.map((d) => d._id);
    await TurfAssignment.deleteMany({ turfId: { $in: draftIds } });
    await Household.updateMany({ turfId: { $in: draftIds } }, { $set: { turfId: null, walkOrder: null } });
    await Turf.deleteMany({ _id: { $in: draftIds } });
  }

  const turfDocs = [];
  const bookData = [];
  let done = 0;
  for (const book of books) {
    const members = book.households;
    const ordered = computeWalkOrder(members, { optimize: params.optimizeWalk !== false });
    const centroid = computeCentroid(members);
    turfDocs.push({
      organizationId: campaign.organizationId,
      campaignId,
      passId,
      name: book.name,
      mode,
      params,
      boundary: book.boundary || null,
      centroid,
      householdIds: ordered,
      doorCount: ordered.length,
      status: 'draft',
      generationJobId,
      generatedBy,
    });
    bookData.push({ centroid, households: members });
    done += 1;
    if (onProgress && done % 5 === 0) {
      await onProgress({
        phase: 'boundaries',
        pct: 55 + Math.round((done / books.length) * 30),
        booksDone: done,
        booksTotal: books.length,
      });
    }
  }

  // Non-overlapping territory outlines: each book's hull clipped to its Voronoi
  // cell. Manual mode supplies its own drawn polygon — leave those untouched.
  const territories = computeTerritories(bookData);
  turfDocs.forEach((d, i) => { if (!d.boundary) d.boundary = territories[i] || null; });

  await onProgress?.({ phase: 'saving', pct: 90 });
  const inserted = await Turf.insertMany(turfDocs);

  // Mirror turfId + walkOrder onto households (one book per household).
  const mirrorOps = [];
  for (const t of inserted) {
    t.householdIds.forEach((hid, idx) => {
      mirrorOps.push({ updateOne: { filter: { _id: hid }, update: { $set: { turfId: t._id, walkOrder: idx } } } });
    });
  }
  for (let i = 0; i < mirrorOps.length; i += 2000) {
    await Household.bulkWrite(mirrorOps.slice(i, i + 2000), { ordered: false });
  }

  await onProgress?.({ phase: 'done', pct: 100, booksTotal: inserted.length });
  return { bookCount: inserted.length };
}

// Add supplemental book(s) to an existing pass from its currently-UNASSIGNED
// households (e.g. voters imported after the pass was cut) WITHOUT wiping or
// recutting the existing books. New books are inserted as drafts (so they flow
// through the normal Accept → Assign steps) and the whole pass is re-tessellated
// so territories stay non-overlapping. Walk-list passes only consider the frozen
// list, so imports outside that list won't be picked up (documented limitation).
export async function addSupplementalBooks({ campaignId, passId, name = 'New voters', maxDoors = 65, excludeRestricted = false }) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) throw new Error('Campaign not found');
  // Same mid-delete guard as generateTurf above.
  if (campaign.deletion?.requestedAt) throw new Error('Campaign is being deleted');
  const pass = await Pass.findOne({ _id: passId, campaignId }).lean();
  if (!pass) throw new Error('Pass not found');

  // Supplemental books come from the effort's OWNED doors not yet in one of THIS
  // PASS's books — judged against the pass's own Turf.householdIds, never the
  // Household.turfId mirror. The mirror points at the LATEST cut anywhere in the
  // campaign, so a door claimed by another round's draft cut would read "booked"
  // here and silently never make it into a supplemental book on this one.
  // Skip fully-voted doors (not knockable), same as the main cut.
  const ownBooks = await Turf.find(
    { passId, status: { $ne: 'archived' } },
    { householdIds: 1 }
  ).lean();
  const alreadyBooked = ownBooks.flatMap((t) => t.householdIds || []);
  const baseFilter = {
    campaignId,
    effortId: pass.effortId,
    ...(alreadyBooked.length ? { _id: { $nin: alreadyBooked } } : {}),
    ...KNOCKABLE_DOOR_FILTER,
    'location.coordinates': { $exists: true, $ne: null },
    ...(excludeRestricted ? { status: { $ne: 'restricted' } } : {}),
  };

  // A targeted round only ever wants its matching doors: resolve the pass's own
  // recorded targetFilter (exclude branch included) and constrain to it. Without
  // this, a supplemental book would sweep up every bookless door — including the
  // ones the target skipped or the exclusion deliberately removed. A genuinely new
  // door still flows in (it's unknocked and has no survey answers, so it matches
  // the usual follow-up targets and can't match an answer-based exclusion).
  if (isActiveTargetFilter(pass.targetFilter)) {
    const { householdIds } = await resolveWalkList(campaign, pass.targetFilter, { effortId: pass.effortId });
    if (!householdIds.length) return { added: 0, bookCount: 0, bookIds: [] };
    // Compose with the already-booked exclusion above — assigning `_id` twice would
    // silently drop whichever condition wrote first.
    const booked = new Set(alreadyBooked.map(String));
    const fresh = householdIds.filter((id) => !booked.has(String(id)));
    if (!fresh.length) return { added: 0, bookCount: 0, bookIds: [] };
    baseFilter._id = { $in: fresh };
  }

  const households = await Household.find(baseFilter, CUT_COLUMNS).lean();
  if (!households.length) return { added: 0, bookCount: 0, bookIds: [] };

  const books = geometricCut(households, { maxDoors });
  const turfDocs = books.map((book, i) => {
    const ordered = computeWalkOrder(book.households, { optimize: true });
    return {
      organizationId: campaign.organizationId,
      campaignId,
      passId,
      name: books.length > 1 ? `${name} ${i + 1}` : name,
      mode: 'geometric',
      params: { supplemental: true, maxDoors },
      boundary: null, // filled by recomputePassTerritories below
      centroid: computeCentroid(book.households),
      householdIds: ordered,
      doorCount: ordered.length,
      status: 'draft',
    };
  });

  const inserted = await Turf.insertMany(turfDocs);

  const mirrorOps = [];
  for (const t of inserted) {
    t.householdIds.forEach((hid, idx) => {
      mirrorOps.push({ updateOne: { filter: { _id: hid }, update: { $set: { turfId: t._id, walkOrder: idx } } } });
    });
  }
  for (let i = 0; i < mirrorOps.length; i += 2000) {
    await Household.bulkWrite(mirrorOps.slice(i, i + 2000), { ordered: false });
  }

  // Re-tessellate the whole pass (new drafts + existing live books) so the new
  // territories slot in without overlapping the existing ones.
  await recomputePassTerritories(passId);

  return { added: households.length, bookCount: inserted.length, bookIds: inserted.map((t) => String(t._id)) };
}

// Recompute a turf's geometry + walk order after an edit changes its members,
// and re-mirror turfId/walkOrder onto its households.
export async function recomputeTurf(turfDoc) {
  const households = await Household.find(
    { _id: { $in: turfDoc.householdIds } },
    { location: 1, addressLine1: 1 }
  ).lean();
  const ordered = computeWalkOrder(households, { optimize: true });
  turfDoc.householdIds = ordered;
  turfDoc.doorCount = ordered.length;
  turfDoc.boundary = computeBoundary(households);
  turfDoc.centroid = computeCentroid(households);
  await turfDoc.save();

  const ops = ordered.map((hid, idx) => ({
    updateOne: { filter: { _id: hid }, update: { $set: { turfId: turfDoc._id, walkOrder: idx } } },
  }));
  for (let i = 0; i < ops.length; i += 2000) {
    await Household.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
  }
  return turfDoc;
}

// Re-tessellate a pass's books into non-overlapping, door-containing territories
// (each book's hull ∩ the union of its own doors' Voronoi cells — see
// computeTerritories). Call AFTER an edit changes a book's members, after the
// per-book recomputeTurf.
//
// onlyTurfIds: limit the expensive per-book geometry to just the books an edit
// touched (~150-250ms at 16k doors instead of ~1.6s for all 128). The Voronoi
// diagram is still computed over the WHOLE pass — seams depend on every door —
// but only the listed books' shapes are rebuilt and written; the rest keep their
// stored shapes, which remain exactly correct (moves don't change the diagram)
// or conservatively contained (removals only grow the remaining cells).
export async function recomputePassTerritories(passId, { onlyTurfIds = null } = {}) {
  const turfs = await Turf.find(
    { passId, status: { $in: ['draft', 'published'] } },
    { _id: 1, centroid: 1, householdIds: 1 }
  ).lean();
  if (!turfs.length) return;
  const allIds = turfs.flatMap((t) => t.householdIds || []);
  const households = await Household.find({ _id: { $in: allIds } }, { location: 1 }).lean();
  const hhById = new Map(households.map((h) => [String(h._id), h]));
  const books = turfs.map((t) => ({
    centroid: t.centroid,
    households: (t.householdIds || []).map((id) => hhById.get(String(id))).filter(Boolean),
  }));
  const only = onlyTurfIds ? new Set(onlyTurfIds.map(String)) : null;
  const onlyIndices = only
    ? new Set(turfs.map((t, i) => (only.has(String(t._id)) ? i : -1)).filter((i) => i >= 0))
    : null;
  const territories = computeTerritories(books, { onlyIndices });
  const bulk = [];
  turfs.forEach((t, i) => {
    if (onlyIndices && !onlyIndices.has(i)) return; // untouched book — keep its stored shape
    bulk.push({ updateOne: { filter: { _id: t._id }, update: { $set: { boundary: territories[i] || null } } } });
  });
  if (bulk.length) await Turf.bulkWrite(bulk, { ordered: false });
}
