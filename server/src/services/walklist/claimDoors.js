import mongoose from 'mongoose';
import { Campaign } from '../../models/Campaign.js';
import { Effort } from '../../models/Effort.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { Household } from '../../models/Household.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { snapshotPass } from '../turf/snapshot.js';
import { computeWalkOrder } from '../turf/walkOrder.js';
import { computeBoundary, computeCentroid } from '../turf/boundary.js';
import { recomputePassTerritories } from '../turf/generateTurf.js';
import { acquireRecutLock, renewRecutLock, releaseRecutLock } from '../turf/recutLock.js';

// Claiming doors into a walk list (materializing Household.effortId) — the service
// behind POST /admin/campaigns/:id/efforts/:id/claim and the TURF queue's 'claim'
// job. This used to live inline in the route and run synchronously; at 24k doors
// the re-carve loop outlived Heroku's 30s router timeout, the client saw a 503
// while the server kept moving doors, and nothing locked the donor passes against
// a concurrent cut (2026-08 incident). Now the route only previews/enqueues and
// THIS runs on the worker, holding (and renewing) the per-pass recut lock.
//
// Split three ways so the route, the processor, and the int tests share one
// implementation and cannot drift:
//   resolveClaimTargets    — who would move (Intake vs owned-by-another-list)
//   previewClaimConflicts  — the enriched 409 breakdown the confirm modal renders
//   executeClaim           — the move itself (snapshot → move → re-carve), idempotent

const CHUNK = 50000; // $in / updateMany batch size — bounds the query doc, nothing else
const chunks = (arr, size = CHUNK) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// Same canonical order every cut-feeding load uses (generateTurf's byId) — book
// membership and walk order must not depend on Mongo's arrival order.
const byId = (docs) => docs.sort((a, b) => {
  const x = String(a._id);
  const y = String(b._id);
  return x < y ? -1 : x > y ? 1 : 0;
});

// Targets = a saved search's households, or (all:true) every Intake (unowned)
// door. Returns { intake, owned } as arrays of {_id, effortId, turfId} — owned
// means "owned by a DIFFERENT effort than the target" (doors already on the
// target list are neither claimable nor conflicts; they're already home).
export const resolveClaimTargets = async ({ campaignId, effortId, walkListId, all }) => {
  let idFilter;
  if (walkListId) {
    const wl = await SavedSearch.findOne({ _id: walkListId, campaignId }, { householdIds: 1 }).lean();
    if (!wl) {
      const err = new Error('Saved search not found');
      err.code = 'walklist-not-found';
      throw err;
    }
    idFilter = { _id: { $in: wl.householdIds || [] } };
  } else if (all) {
    idFilter = { effortId: null }; // Intake (unowned) doors only — never another effort's doors
  } else {
    const err = new Error('Provide walkListId or all:true');
    err.code = 'bad-claim-request';
    throw err;
  }

  const targets = await Household.find(
    { campaignId, isActive: true, ...idFilter },
    { _id: 1, effortId: 1, turfId: 1 }
  ).lean();

  return {
    intake: targets.filter((h) => !h.effortId),
    owned: targets.filter((h) => h.effortId && String(h.effortId) !== String(effortId)),
  };
};

// The stakes, per donor walk list, for the force-confirm modal: how many doors
// each list loses, how many of its books that touches, and how many of those
// books it EMPTIES. Grouped by the household's own effortId (a book only ever
// holds its own effort's doors, so a door's mirror turfId belongs to its owner).
export const previewClaimConflicts = async ({ owned }) => {
  if (!owned.length) {
    return { breakdown: [], totalBooksAffected: 0, totalBooksEmptied: 0 };
  }
  const byEffort = new Map(); // effortId -> { doors, turfIds:Set }
  const lostByTurf = new Map(); // turfId -> doors leaving it
  for (const h of owned) {
    const ek = String(h.effortId);
    const entry = byEffort.get(ek) || { doors: 0, turfIds: new Set() };
    entry.doors += 1;
    if (h.turfId) {
      entry.turfIds.add(String(h.turfId));
      lostByTurf.set(String(h.turfId), (lostByTurf.get(String(h.turfId)) || 0) + 1);
    }
    byEffort.set(ek, entry);
  }

  const allTurfIds = [...lostByTurf.keys()];
  const turfDocs = allTurfIds.length
    ? await Turf.find({ _id: { $in: allTurfIds } }, { doorCount: 1 }).lean()
    : [];
  const doorCountOf = new Map(turfDocs.map((t) => [String(t._id), t.doorCount || 0]));
  const emptied = new Set(
    allTurfIds.filter((tid) => (lostByTurf.get(tid) || 0) >= (doorCountOf.get(tid) ?? Infinity))
  );

  const effortDocs = await Effort.find(
    { _id: { $in: [...byEffort.keys()].map((id) => new mongoose.Types.ObjectId(id)) } },
    { name: 1 }
  ).lean();
  const nameOf = new Map(effortDocs.map((e) => [String(e._id), e.name]));

  const breakdown = [...byEffort.entries()]
    .map(([ek, entry]) => ({
      effortId: ek,
      effortName: nameOf.get(ek) || '(deleted list)',
      doors: entry.doors,
      booksAffected: entry.turfIds.size,
      booksEmptied: [...entry.turfIds].filter((tid) => emptied.has(tid)).length,
    }))
    .sort((a, b) => b.doors - a.doors);

  return {
    breakdown,
    totalBooksAffected: lostByTurf.size,
    totalBooksEmptied: emptied.size,
  };
};

// The move. Runs on the TURF queue (concurrency 1 already serializes it against
// generate/supplemental/other claims); the per-pass recut lock is what fences off
// the WEB-side discard/restore while this runs. Idempotent under BullMQ's one
// allowed stall-redelivery:
//   - the intake claim filters on effortId:null (already-claimed doors no-op),
//   - the book sweep is keyed off OWNERSHIP, not pre-move state — a re-run finds
//     only books still holding now-foreign doors,
//   - the 'move' snapshot dedupes on {passId, reason, jobId}.
export const executeClaim = async ({
  campaignId,
  effortId,
  walkListId,
  all,
  force = false,
  userId = null,
  jobId = null,
  onProgress,
}) => {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) throw new Error('Campaign not found');
  // Same mid-delete guard as generateTurf: a queued claim must not write into a cascade.
  if (campaign.deletion?.requestedAt) throw new Error('Campaign is being deleted');
  const effort = await Effort.findOne({ _id: effortId, campaignId }).lean();
  if (!effort) throw new Error('Walk list not found');

  await onProgress?.({ phase: 'resolving', pct: 5 });
  let { intake, owned } = await resolveClaimTargets({ campaignId, effortId, walkListId, all });

  // ── Locking (force path only — an Intake-only claim touches no books) ──
  // Lock every donor pass whose books hold doors we're about to pull, renewing
  // periodically so a multi-minute move outlives the lock's 5-min staleness
  // window without lengthening it for crashed web holders (recutLock.js).
  const heldLocks = [];
  let lastRenew = Date.now();
  const maybeRenew = async () => {
    if (!heldLocks.length || Date.now() - lastRenew < 30000) return;
    lastRenew = Date.now();
    for (const pid of heldLocks) {
      if (!(await renewRecutLock(pid, jobId))) {
        throw new Error('Lost the re-cut lock mid-move — another operation took over a donor pass');
      }
    }
  };

  const donorPassesOf = async (ownedDocs) => {
    const ids = ownedDocs.map((h) => h._id);
    const found = new Set();
    for (const part of chunks(ids)) {
      const turfs = await Turf.find(
        { campaignId, householdIds: { $in: part }, status: { $in: ['draft', 'published'] } },
        { passId: 1 }
      ).lean();
      for (const t of turfs) if (t.passId) found.add(String(t.passId));
    }
    // Never lock/snapshot the TARGET effort's own passes — its books aren't donors.
    const targetPasses = await Pass.find({ effortId }, { _id: 1 }).lean();
    const targetSet = new Set(targetPasses.map((p) => String(p._id)));
    return [...found].filter((pid) => !targetSet.has(pid));
  };

  try {
    if (owned.length && force) {
      // Acquire donor-pass locks, then RE-resolve: a door can change hands between
      // the read and the lock. Bounded — a donor set still growing after 3 rounds
      // means something is actively fighting us; fail loudly rather than chase it.
      let donorPassIds = await donorPassesOf(owned);
      for (let round = 0; ; round++) {
        for (const pid of donorPassIds) {
          if (heldLocks.includes(pid)) continue;
          if (!(await acquireRecutLock(pid, userId, jobId))) {
            throw new Error('A re-cut or restore is in progress on a donor pass. Try again shortly.');
          }
          heldLocks.push(pid);
        }
        ({ intake, owned } = await resolveClaimTargets({ campaignId, effortId, walkListId, all }));
        donorPassIds = await donorPassesOf(owned);
        const unlocked = donorPassIds.filter((pid) => !heldLocks.includes(pid));
        if (!unlocked.length) break;
        if (round >= 3) throw new Error('Donor passes kept changing during lock acquisition — try again.');
      }

      // ── Snapshot every donor pass BEFORE any mutation (one-click undo). ──
      await onProgress?.({ phase: 'snapshotting', pct: 15 });
      for (const pid of heldLocks) {
        const existing = jobId
          ? await TurfSnapshot.findOne({ passId: pid, reason: 'move', jobId, restoredAt: null }, { _id: 1 }).lean()
          : null;
        if (existing) continue; // stall-redelivery re-run — this pass is already captured
        await snapshotPass({ campaign, passId: pid, reason: 'move', includeKnocks: false, userId, jobId });
        await maybeRenew();
      }
    }

    // ── Claim Intake doors outright (both paths). effortId:null filter makes a
    // re-run a no-op and guarantees we never steal a door force didn't cover. ──
    await onProgress?.({ phase: 'moving', pct: 30 });
    let claimedIntake = 0;
    for (const part of chunks(intake.map((h) => h._id))) {
      const r = await Household.updateMany(
        { _id: { $in: part }, campaignId, effortId: null },
        { $set: { effortId } }
      );
      claimedIntake += r.modifiedCount || 0;
    }

    let reassigned = 0;
    let recutBooks = 0;
    let emptiedBooks = 0;

    if (owned.length && force) {
      // ── Move the owned doors here, clearing their book mirror. ──
      const ownedIds = owned.map((h) => h._id);
      for (const part of chunks(ownedIds)) {
        const r = await Household.updateMany(
          { _id: { $in: part }, campaignId },
          { $set: { effortId, turfId: null, walkOrder: null } }
        );
        reassigned += r.modifiedCount || 0;
      }

      // ── Sweep: books (outside the target effort) still holding moved doors.
      // Ownership-keyed, so a stall-redelivered re-run naturally finds nothing. ──
      const targetPasses = await Pass.find({ effortId }, { _id: 1 }).lean();
      const targetPassIds = targetPasses.map((p) => p._id);
      const movedSet = new Set(ownedIds.map(String));
      const affectedByPass = new Map(); // passId -> [turf docs]
      const seenTurf = new Set();
      for (const part of chunks(ownedIds)) {
        const turfs = await Turf.find(
          {
            campaignId,
            ...(targetPassIds.length ? { passId: { $nin: targetPassIds } } : {}),
            householdIds: { $in: part },
            status: { $in: ['draft', 'published'] },
          },
          { householdIds: 1, passId: 1 }
        ).lean();
        for (const t of turfs) {
          if (seenTurf.has(String(t._id))) continue;
          seenTurf.add(String(t._id));
          const pid = String(t.passId);
          if (!affectedByPass.has(pid)) affectedByPass.set(pid, []);
          affectedByPass.get(pid).push(t);
        }
      }

      // ── Rebuild the shrunk books in memory: one batched member fetch, then
      // per-book walk order / boundary / centroid with a yield per book (the
      // BullMQ lock-renewal timer must be able to fire — generateTurf.js:189). ──
      const affected = [...affectedByPass.values()].flat();
      const keepByTurf = new Map(
        affected.map((t) => [String(t._id), (t.householdIds || []).filter((id) => !movedSet.has(String(id)))])
      );
      const allKeepIds = [...keepByTurf.values()].flat();
      const memberById = new Map();
      for (const part of chunks(allKeepIds.map(String))) {
        const docs = await Household.find({ _id: { $in: part } }, { location: 1, addressLine1: 1 }).lean();
        for (const d of docs) memberById.set(String(d._id), d);
      }

      const turfBulk = [];
      const mirrorOps = [];
      let done = 0;
      for (const t of affected) {
        const members = byId(
          (keepByTurf.get(String(t._id)) || []).map((id) => memberById.get(String(id))).filter(Boolean)
        );
        const ordered = computeWalkOrder(members, { optimize: true });
        turfBulk.push({
          updateOne: {
            filter: { _id: t._id },
            update: {
              $set: {
                householdIds: ordered,
                doorCount: ordered.length,
                boundary: computeBoundary(members),
                centroid: computeCentroid(members),
              },
            },
          },
        });
        ordered.forEach((hid, idx) => {
          mirrorOps.push({ updateOne: { filter: { _id: hid }, update: { $set: { turfId: t._id, walkOrder: idx } } } });
        });
        if (!ordered.length) emptiedBooks += 1;
        recutBooks += 1;
        done += 1;
        await new Promise((resolve) => setImmediate(resolve));
        if (done % 10 === 0) {
          await onProgress?.({ phase: 'rebuilding', pct: 40 + Math.round((done / affected.length) * 40) });
          await maybeRenew();
        }
      }
      if (turfBulk.length) await Turf.bulkWrite(turfBulk, { ordered: false });
      for (const part of chunks(mirrorOps, 2000)) {
        await Household.bulkWrite(part, { ordered: false });
      }

      // ── Re-clip only the shrunk books' territories (removal only grows the
      // untouched books' cells — their stored shapes stay valid). ──
      await onProgress?.({ phase: 'territories', pct: 85 });
      for (const [pid, turfs] of affectedByPass) {
        await recomputePassTerritories(pid, { onlyTurfIds: turfs.map((t) => String(t._id)) });
        await maybeRenew();
      }
    }

    await onProgress?.({ phase: 'done', pct: 100 });
    return {
      claimed: claimedIntake + reassigned,
      claimedIntake,
      reassigned,
      recutBooks,
      emptiedBooks,
      skippedOwned: !force ? owned.length : 0,
      donorPasses: heldLocks.length,
    };
  } finally {
    for (const pid of heldLocks) {
      await releaseRecutLock(pid, jobId).catch(() => {});
    }
  }
};
