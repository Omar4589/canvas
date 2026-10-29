import { UnrecoverableError } from 'bullmq';
import { Campaign } from '../../models/Campaign.js';
import { Effort } from '../../models/Effort.js';
import { Pass } from '../../models/Pass.js';
import { Household } from '../../models/Household.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { assertCampaignWritable, assertPassWritable, assertWalkListWritable } from '../../middleware/campaignWritable.js';
import { attributeCut } from './attributeCut.js';
import { geometricCut } from './geometricCut.js';
import { resolveWalkList, isActiveTargetFilter } from '../walklist/resolveWalkList.js';
import { computeBoundary, computeCentroid, computeTerritories } from './boundary.js';
import { computeWalkOrder } from './walkOrder.js';
import { KNOCKABLE_DOOR_FILTER } from '../canvass/knockableDoorFilter.js';
import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { getTargetingStatusMap } from '../walklist/targetingStatus.js';

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

// Mongo returns documents in no guaranteed order, and the cut is order-SENSITIVE: seeds
// in balancedKMeans are picked by position in the Hilbert-sorted array, and doors that tie
// on every geometric key — an apartment stack shares one geocode, so it ties on all of
// them — break by arrival order. Without a canonical order the same pass could re-cut into
// different books on a re-run or a retried job, which the module header, boundary.js and
// the docs all promise it does not.
//
// Sorted HERE rather than with a Mongo `.sort({_id:1})` deliberately: no Household index
// ends in _id (models/Household.js), so the server would satisfy it with a blocking
// in-memory sort — the failure mode that shows up only on the biggest campaigns, which are
// exactly the ones that need the cut. The cut already materializes every document, so this
// costs nothing and cannot depend on which indexes prod happens to have built.
const byId = (docs) => docs.sort((a, b) => {
  const x = String(a._id);
  const y = String(b._id);
  return x < y ? -1 : x > y ? 1 : 0;
});

// Orchestrates a turf generation run: load the pass's walk-list households,
// dispatch to the cut mode, compute boundary/centroid/walk-order per book, and
// persist Turf docs as drafts atomically (clearing prior drafts for the pass so
// "Leave out homes without a reliable map spot" (Turf Cutting's toggle; docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md
// S3.4, S10.6). A door cuts when it carries no pin flag, when its flag is 'complex' (the spot IS right —
// a complex cuts as one point, like a tower), or when a lead has vouched for it. Everything flagged and
// unvouched — a shared spot, a pin far from its street, a holding spot — is left out, to be added after
// its pin is fixed (Add as new book). A set-aside door is already out through KNOCKABLE_DOOR_FILTER.
export const CUTTABLE_PIN = Object.freeze({
  $or: [{ pinSuspect: { $exists: false } }, { pinSuspect: 'complex' }, { locationConfirmedAt: { $ne: null } }],
});

// Admin-reviewed second-pass removal: the two cut-time boxes.
//   excludeRestricted   — inaccessible homes (gate/locked building; never reached the door)
//   excludeNoSoliciting — a posted sign ended the visit (the door WAS reached; still a knock)
// Both are judged by the TARGETING ladder (utils/statusPrecedence.js resolveTargetingStatus) over
// the door's whole history — the same rule a Target doors tick reads — never by Household.status
// and never by one round. The owner's ruling (2026-10-13), "restricted wins every time": any
// Restricted entry in any round, desk or field, even one a canvasser later knocked through or a
// survey later completed, keeps the home out of every cut with the box on, until the mark is
// unmarked (desk) or the entry unknocked (Door Outcomes). Two earlier rules this replaces, so the
// history is not re-learned: a bare `status: { $nin }` on Household.status (completion-sticky, so
// a home surveyed in round 1 and desk-marked in round 2 was cut straight back in — the 2026-08-24
// bug), and the per-round fix that judged each mark in the round holding it (right for the phones,
// but blind to another walk list's rounds after a move, and it cut a superseded mark back in).
// Non-destructive: the homes stay in the campaign and in every count.
//
// Bounded by the MARKS, never by the effort's doors: only a door with a restricted or no-soliciting
// row can read either status (the ladder's rungs 1 and 3), so the candidates are the campaign's
// doors with such a row — a few hundred on a big campaign — narrowed to the doors asked for (an
// effort, or a `filter`), and the ladder runs over those alone. Enumerating the effort's doors here
// instead was measured at ~400 ms and ~40 MB per preview tick at 25k doors, i.e. seconds and the
// whole dyno at 250k (round-1 review, 2026-10-14).
export async function offLimitsDoorIds({ campaignId, effortId, campaignType, filter = null } = {}) {
  const restricted = [];
  const noSoliciting = [];
  const marked = await CanvassActivity.distinct('householdId', {
    campaignId,
    actionType: { $in: ['restricted', 'no_soliciting'] },
  });
  if (!marked.length) return { restricted, noSoliciting };
  // $and, so a `filter` that already owns `_id` (a targeted rollup's `$in`) keeps it.
  const scope = filter || { campaignId, effortId, isActive: true };
  const candidates = (await Household.find({ $and: [scope, { _id: { $in: marked } }] }, { _id: 1 }).lean()).map((h) => h._id);
  const map = await getTargetingStatusMap(campaignId, candidates, campaignType);
  for (const id of candidates) {
    const status = map.get(String(id))?.status;
    if (status === 'restricted') restricted.push(id);
    else if (status === 'no_soliciting') noSoliciting.push(id);
  }
  return { restricted, noSoliciting };
}

// The cut's exclusions as $and CLAUSES rather than a spread fragment.
//
// It must be `$and` and not a spread: two of the three cut filters already own an `_id` key
// (`addSupplementalBooks`' `$nin: alreadyBooked`, and the preview route's `$in: householdIds`),
// so returning `{ _id: { $nin } }` to be spread would silently clobber one of them. Neither call
// site uses `$and` for anything else, and each merges this once.
//
// `cutExclusionParts` is the builder for a caller that must also NAME the doors the boxes removed
// (the target preview's "why is this door faded"): `filter` is the cut's own clauses,
// `filterWithoutUnplaced` the same minus the pin clause (the "reliable map spot" box's own delta),
// and `restrictedIds` / `noSolicitingIds` the doors each box dropped. `cutExclusionFilter` is its
// `filter`, so every cut keeps calling one builder.
export async function cutExclusionParts({
  campaignId,
  effortId,
  campaignType,
  excludeRestricted,
  excludeNoSoliciting,
  excludeUnplaced,
} = {}) {
  const clauses = [];
  let restrictedIds = [];
  let noSolicitingIds = [];
  if (excludeRestricted || excludeNoSoliciting) {
    const off = await offLimitsDoorIds({ campaignId, effortId, campaignType });
    if (excludeRestricted) restrictedIds = off.restricted;
    if (excludeNoSoliciting) noSolicitingIds = off.noSoliciting;
    const drop = [...restrictedIds, ...noSolicitingIds];
    if (drop.length) clauses.push({ _id: { $nin: drop } });
  }
  const and = (list) => (list.length ? { $and: list } : {});
  return {
    filter: and(excludeUnplaced ? [...clauses, CUTTABLE_PIN] : clauses),
    filterWithoutUnplaced: and(clauses),
    restrictedIds,
    noSolicitingIds,
  };
}

export async function cutExclusionFilter(args = {}) {
  return (await cutExclusionParts(args)).filter;
}

// ── The TURF jobs' own guard (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.5) ──
// A queued job re-checks what its route checked when it was enqueued — the campaign is writable
// (not archived, not being deleted), the pass isn't archived, its walk list isn't — because an
// archive can land while the job waits in the queue or runs. A refusal throws BullMQ's
// UnrecoverableError, so the job fails at once instead of retrying three times into the same
// refusal (queues/index.js), and the Turf page's job line shows the guard's own sentence
// (GET /turfs/jobs/:jobId → failedReason). The same rules and words as the routes: the job runs
// middleware/campaignWritable.js's guards themselves.

// Those guards answer through `res`; a job has none, so it lends them one that keeps the body.
const guardRefusal = async (guard) => {
  let body = null;
  const res = {
    status: () => res,
    json: (b) => {
      body = b;
      return res;
    },
  };
  return (await guard(res)) ? null : body;
};

// → the refusal ({ error, code }), or null when the job may write. Re-reads everything it checks —
// what a job loaded at its start may be stale by the time it writes. `passId` checks the pass and
// its walk list; `effortId` (a claim's TARGET walk list) checks the walk list alone.
export const turfJobRefusal = async ({ campaignId, passId = null, effortId = null }) => {
  const campaign = await Campaign.findById(campaignId, { isActive: 1, deletion: 1 }).lean();
  if (!campaign) return { error: 'Campaign not found', code: 'campaign-not-found' };
  const archivedOrGoing = await guardRefusal((res) => assertCampaignWritable(res, campaign));
  if (archivedOrGoing) return archivedOrGoing;
  if (passId) {
    const pass = await Pass.findOne({ _id: passId, campaignId }, { status: 1, effortId: 1, roundNumber: 1, name: 1 }).lean();
    if (!pass) return { error: 'Pass not found', code: 'pass-not-found' };
    return guardRefusal((res) => assertPassWritable(res, pass));
  }
  if (effortId) {
    const effort = await Effort.findOne({ _id: effortId, campaignId }, { name: 1, status: 1 }).lean();
    if (!effort) return { error: 'Walk list not found', code: 'walk-list-not-found' };
    return guardRefusal((res) => assertWalkListWritable(res, effort));
  }
  return null;
};

// The refusal, if there is one, as the UnrecoverableError that fails the job.
export const assertTurfJobWritable = async (ids) => {
  const refusal = await turfJobRefusal(ids);
  if (refusal) throw new UnrecoverableError(refusal.error);
};

// Generate's post-insert undo: the books THIS run inserted that are still drafts, and their
// household mirror. Never a published one — an Accept that landed mid-run stands, and so does its
// mirror (a book accepted between the read and the delete is not deleted, so it keeps it too).
// Drafts carry no assignments (both assign routes 409 `not-accepted`); swept anyway, as
// wipeDraftBooks does.
const dropOwnDrafts = async (insertedIds) => {
  const drafts = (await Turf.find({ _id: { $in: insertedIds }, status: 'draft' }, { _id: 1 }).lean()).map((t) => t._id);
  if (!drafts.length) return;
  await Turf.deleteMany({ _id: { $in: drafts }, status: 'draft' });
  const kept = new Set((await Turf.find({ _id: { $in: drafts } }, { _id: 1 }).lean()).map((t) => String(t._id)));
  const gone = drafts.filter((id) => !kept.has(String(id)));
  if (!gone.length) return;
  await TurfAssignment.deleteMany({ turfId: { $in: gone } });
  await Household.updateMany({ turfId: { $in: gone } }, { $set: { turfId: null, walkOrder: null } });
};

// Wipe a pass's DRAFT books cleanly: drop their assignments and clear the
// household mirror for their members before deleting, so no orphaned assignments
// or stale Household.turfId are left behind. Published books untouched. Two
// callers: every re-generate (drafts are wiped before a fresh cut) and the
// drafts-only Discard scope (routes/admin/turfs.js) — one implementation so the
// endpoint can never drift from what the cut itself does. Draft books cannot
// carry assignments (both assign routes 409 `not-accepted` on drafts), so the
// TurfAssignment sweep is belt-and-braces, not a data path.
export const wipeDraftBooks = async (passId) => {
  const priorDrafts = await Turf.find({ passId, status: 'draft' }, { _id: 1 }).lean();
  if (!priorDrafts.length) return 0;
  const draftIds = priorDrafts.map((d) => d._id);
  await TurfAssignment.deleteMany({ turfId: { $in: draftIds } });
  await Household.updateMany({ turfId: { $in: draftIds } }, { $set: { turfId: null, walkOrder: null } });
  await Turf.deleteMany({ _id: { $in: draftIds } });
  return draftIds.length;
};

// a re-run / worker restart is clean). Mirrors turfId/walkOrder onto households.
export async function generateTurf({ campaignId, passId, mode, params = {}, generationJobId, generatedBy, onProgress }) {
  // A queued cut can be claimed AFTER a delete stamped the campaign — writing Turf rows
  // mid-cascade would orphan them (services/campaigns/deletionState.js) — or after the
  // campaign, the pass or its walk list was archived (§C.5).
  await assertTurfJobWritable({ campaignId, passId });
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) throw new Error('Campaign not found');
  const pass = await Pass.findOne({ _id: passId, campaignId }).lean();
  if (!pass) throw new Error('Pass not found');

  await onProgress?.({ phase: 'loading', pct: 5 });

  // Targeted follow-up round: restrict the universe to the effort's doors matching
  // a walk-list-shaped filter (knock status + survey answers, minus its exclude
  // branch). The existing fullyVoted/fullyDnc/excludedFromTurf/coords exclusions
  // still apply (intersection). The active check is shared with the resolver.
  // Resolved first, so a degenerate exclusion refuses before any filter is built.
  const targeted = isActiveTargetFilter(params.targetFilter);
  const resolved = targeted ? await resolveWalkList(campaign, params.targetFilter, { effortId: pass.effortId }) : null;
  // The admin asked to exclude doors but every exclude condition was unusable —
  // cutting anyway would silently send canvassers to the doors they removed. Fail
  // the job loudly instead (the throw surfaces via the generation job status).
  if (resolved?.excludeDegenerate) {
    throw new Error('The exclusion filter has no valid conditions — fix or remove it, then re-cut');
  }

  // A round cuts from its EFFORT's owned households (Household.effortId). Skip
  // fully-voted doors (everyone there already voted early) — they're not knockable,
  // so including them would balance books on dead doors. Mirrors the canvasser list.
  const baseFilter = {
    campaignId,
    effortId: pass.effortId,
    ...KNOCKABLE_DOOR_FILTER,
    'location.coordinates': { $exists: true, $ne: null },
    ...(await cutExclusionFilter({
      campaignId,
      effortId: pass.effortId,
      campaignType: campaign.type,
      excludeRestricted: params.excludeRestricted,
      excludeNoSoliciting: params.excludeNoSoliciting,
      excludeUnplaced: params.excludeUnplaced,
    })),
  };
  if (resolved) baseFilter._id = { $in: resolved.householdIds };
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
    // Resolve every area's doors BEFORE cutting any of them, so the first-drawn-wins
    // claim is settled across all areas before any of them is subdivided.
    const areas = [];
    for (const polygon of polygons) {
      const found = byId(await Household.find(
        { ...baseFilter, location: { $geoWithin: { $geometry: polygon } } },
        CUT_COLUMNS
      ).lean());
      const hh = found.filter((h) => !claimed.has(String(h._id)));
      hh.forEach((h) => claimed.add(String(h._id)));
      areas.push({ polygon, hh });
    }
    for (const { polygon, hh } of areas) {
      idx += 1;
      if (!hh.length) continue;
      if (subCutN > 0 && hh.length > subCutN) {
        const chunks = await geometricCut(hh, { maxDoors: subCutN });
        chunks.forEach((c, j) => books.push({ name: `Area ${idx} · ${j + 1}`, households: c.households }));
      } else {
        books.push({ name: `Area ${idx}`, households: hh, boundary: polygon });
      }
    }
    if (!books.length) throw new Error('No doors inside the drawn area(s)');
  } else {
    const households = byId(await Household.find(baseFilter, CUT_COLUMNS).lean());
    await onProgress?.({ phase: 'clustering', pct: 25 });
    if (mode === 'attribute') {
      books = await attributeCut(households, { attribute: params.attribute, capN: params.capN || null });
    } else if (mode === 'geometric') {
      // Chunked clustering reports per-chunk completion; map it onto pct 25→55 so a
      // 250k-door cut shows movement instead of sitting at 25 for minutes.
      books = await geometricCut(households, {
        maxDoors: params.maxDoors || 65,
        tolerance: params.tolerance,
        onProgress: async ({ chunk, chunks }) => {
          await onProgress?.({ phase: 'clustering', pct: 25 + Math.round((chunk / chunks) * 30) });
        },
      });
    } else {
      throw new Error(`Unknown mode: ${mode}`);
    }
  }

  await onProgress?.({ phase: 'boundaries', pct: 55, booksTotal: books.length });

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
    // YIELD EVERY BOOK, report progress every fifth. BullMQ renews a job's lock on a TIMER,
    // and a timer cannot fire while the event loop is blocked — a long unbroken run of
    // synchronous work makes the lock lapse, the job get redelivered, and the cut restart
    // from the top ("job stalled more than allowable limit"). That is a real incident this
    // code has caused. The setImmediate is nearly free; the progress write stays every fifth
    // because it costs a Redis round-trip and there is no reason to pay it 400 times.
    await new Promise((resolve) => setImmediate(resolve));
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
  const territories = await computeTerritories(bookData);
  turfDocs.forEach((d, i) => { if (!d.boundary) d.boundary = territories[i] || null; });

  await onProgress?.({ phase: 'saving', pct: 90 });
  // Checked again right before the run's first write: the clustering and boundaries above can
  // take minutes on a big campaign, and an archive landing meanwhile must keep its drafts too.
  await assertTurfJobWritable({ campaignId, passId });
  // Wipe prior drafts for this pass CLEANLY (shared helper — the drafts-only
  // Discard scope is the same operation, exposed as an endpoint). The published
  // guard on /generate means only draft books can exist on the pass at this point.
  await wipeDraftBooks(passId);
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

  // And once more AFTER the insert, because generate takes no recut lock (recutLock.js): an
  // archive can land while it writes. If one did, the drafts this run made go again (never a
  // book accepted meanwhile) and the job fails the same way. A run killed mid-insert and
  // redelivered fails at its start check instead and may leave its drafts behind — harmless on
  // an archived pass, which never reaches a phone and is view-only.
  const late = await turfJobRefusal({ campaignId, passId });
  if (late) {
    await dropOwnDrafts(inserted.map((t) => t._id));
    throw new UnrecoverableError(late.error);
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
export async function addSupplementalBooks({ campaignId, passId, name = 'New voters', maxDoors = 65, excludeRestricted = false, excludeNoSoliciting = false, excludeUnplaced = false, onProgress }) {
  // Same guard as generateTurf above (mid-delete, archived campaign / pass / walk list). The job
  // runs under the pass's recut lock (turfProcessor.js), so this is also the lock holder's re-read.
  await assertTurfJobWritable({ campaignId, passId });
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) throw new Error('Campaign not found');
  const pass = await Pass.findOne({ _id: passId, campaignId }).lean();
  if (!pass) throw new Error('Pass not found');

  await onProgress?.({ phase: 'loading', pct: 5 });

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
  // A targeted round only ever wants its matching doors: resolve the pass's own
  // recorded targetFilter (exclude branch included) and constrain to it. Without
  // this, a supplemental book would sweep up every bookless door — including the
  // ones the target skipped or the exclusion deliberately removed. A genuinely new
  // door still flows in (it's unknocked and has no survey answers, so it matches
  // the usual follow-up targets and can't match an answer-based exclusion).
  const resolved = isActiveTargetFilter(pass.targetFilter)
    ? await resolveWalkList(campaign, pass.targetFilter, { effortId: pass.effortId })
    : null;
  if (resolved && !resolved.householdIds.length) return { added: 0, bookCount: 0, bookIds: [] };

  const baseFilter = {
    campaignId,
    effortId: pass.effortId,
    ...(alreadyBooked.length ? { _id: { $nin: alreadyBooked } } : {}),
    ...KNOCKABLE_DOOR_FILTER,
    'location.coordinates': { $exists: true, $ne: null },
    // $and, so the box exclusions cannot collide with the `_id` above.
    ...(await cutExclusionFilter({
      campaignId,
      effortId: pass.effortId,
      campaignType: campaign.type,
      excludeRestricted,
      excludeNoSoliciting,
      excludeUnplaced,
    })),
  };
  if (resolved) {
    // Compose with the already-booked exclusion above — assigning `_id` twice would
    // silently drop whichever condition wrote first.
    const booked = new Set(alreadyBooked.map(String));
    const fresh = resolved.householdIds.filter((id) => !booked.has(String(id)));
    if (!fresh.length) return { added: 0, bookCount: 0, bookIds: [] };
    baseFilter._id = { $in: fresh };
  }

  const households = byId(await Household.find(baseFilter, CUT_COLUMNS).lean());
  if (!households.length) return { added: 0, bookCount: 0, bookIds: [] };

  await onProgress?.({ phase: 'clustering', pct: 25 });
  const books = await geometricCut(households, {
    maxDoors,
    onProgress: async ({ chunk, chunks }) => {
      await onProgress?.({ phase: 'clustering', pct: 25 + Math.round((chunk / chunks) * 30) });
    },
  });
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

  await onProgress?.({ phase: 'saving', pct: 65 });
  // Again right before the insert: the job's recut lock fences this pass's own Archive, but not
  // the next pass going live (activation ends this one without waiting for the lock), an archive
  // of a draft's walk list (which locks only a LIVE pass), or the campaign's.
  await assertTurfJobWritable({ campaignId, passId });
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
  await onProgress?.({ phase: 'territories', pct: 85 });
  await recomputePassTerritories(passId);

  await onProgress?.({ phase: 'done', pct: 100, booksTotal: inserted.length });
  return { added: households.length, bookCount: inserted.length, bookIds: inserted.map((t) => String(t._id)) };
}

// Recompute a turf's geometry + walk order after an edit changes its members,
// and re-mirror turfId/walkOrder onto its households.
export async function recomputeTurf(turfDoc) {
  const households = byId(await Household.find(
    { _id: { $in: turfDoc.householdIds } },
    { location: 1, addressLine1: 1 }
  ).lean());
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
// stored shapes, which remain exactly correct (a door's BOOK move doesn't change
// the diagram — only cell ownership flips) or conservatively contained (removals
// only grow the remaining cells). A COORDINATE move DOES change the diagram: the
// pin-move caller (rehullAfterPinMove.js) therefore also lists the books whose
// stored shape contains the new point — the new site can only shrink those cells.
//
// withCentroid: also rewrite each listed book's `centroid` from its members'
// current pins — for the pin-move caller, whose edit changes a coordinate rather
// than the member list (recomputeTurf owns the centroid on a member edit). The
// default keeps every other caller, and recompute:territories' "writes ONLY
// Turf.boundary" promise, exactly as before.
export async function recomputePassTerritories(passId, { onlyTurfIds = null, withCentroid = false } = {}) {
  // Sorted for the same reason as the household loads: computeTerritories dedupes
  // shared coordinates first-book-wins (boundary.js), so which book owns an apartment
  // stack's Voronoi cell — and therefore both books' drawn shapes — follows this order.
  const turfs = byId(await Turf.find(
    { passId, status: { $in: ['draft', 'published'] } },
    { _id: 1, centroid: 1, householdIds: 1 }
  ).lean());
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
  const territories = await computeTerritories(books, { onlyIndices });
  const bulk = [];
  turfs.forEach((t, i) => {
    if (onlyIndices && !onlyIndices.has(i)) return; // untouched book — keep its stored shape
    const $set = { boundary: territories[i] || null };
    if (withCentroid) $set.centroid = computeCentroid(books[i].households);
    bulk.push({ updateOne: { filter: { _id: t._id }, update: { $set } } });
  });
  if (bulk.length) await Turf.bulkWrite(bulk, { ordered: false });
}
