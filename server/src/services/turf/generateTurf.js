import { Campaign } from '../../models/Campaign.js';
import { Pass } from '../../models/Pass.js';
import { WalkList } from '../../models/WalkList.js';
import { Household } from '../../models/Household.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { attributeCut } from './attributeCut.js';
import { geometricCut } from './geometricCut.js';
import { computeBoundary, computeCentroid, computeTerritories } from './boundary.js';
import { computeWalkOrder } from './walkOrder.js';

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
  const pass = await Pass.findOne({ _id: passId, campaignId }).lean();
  if (!pass) throw new Error('Pass not found');

  await onProgress?.({ phase: 'loading', pct: 5 });

  let baseFilter = {
    campaignId,
    isActive: true,
    'location.coordinates': { $exists: true, $ne: null },
  };
  if (pass.walkListId) {
    const wl = await WalkList.findById(pass.walkListId, { householdIds: 1 }).lean();
    if (wl?.householdIds?.length) baseFilter = { _id: { $in: wl.householdIds }, ...baseFilter };
  }

  let books;
  if (mode === 'manual') {
    if (!params.polygon) throw new Error('manual mode requires params.polygon');
    const households = await Household.find(
      { ...baseFilter, location: { $geoWithin: { $geometry: params.polygon } } },
      CUT_COLUMNS
    ).lean();
    books = [{ name: params.name || 'Drawn book', households, boundary: params.polygon }];
  } else {
    const households = await Household.find(baseFilter, CUT_COLUMNS).lean();
    await onProgress?.({ phase: 'clustering', pct: 25 });
    if (mode === 'attribute') {
      books = attributeCut(households, { attribute: params.attribute, capN: params.capN || null });
    } else if (mode === 'geometric') {
      books = geometricCut(households, { maxDoors: params.maxDoors || 65 });
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

// Re-tessellate ALL of a pass's books into non-overlapping territories (each
// book's hull clipped to its Voronoi cell). Call AFTER an edit shifts a book's
// centroid/members — the shared seams move, so the whole pass re-tessellates.
// Uses the books' stored centroids, so run it after the per-book recomputeTurf.
export async function recomputePassTerritories(passId) {
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
  const territories = computeTerritories(books);
  const bulk = turfs.map((t, i) => ({
    updateOne: { filter: { _id: t._id }, update: { $set: { boundary: territories[i] || null } } },
  }));
  if (bulk.length) await Turf.bulkWrite(bulk, { ordered: false });
}
