import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Household } from '../../models/Household.js';
import { Pass } from '../../models/Pass.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { recomputeHouseholdStatusesByIds, recomputeSurveyStatus } from '../canvass/status.js';

// Capture a pass's current book set (+ assignments, + optionally the knock
// history about to be cleared) into a TurfSnapshot for undo. Call this BEFORE
// any deletion so a failed/partial discard is still recoverable.
export async function snapshotPass({ campaign, passId, reason, includeKnocks, userId }) {
  const books = await Turf.find({
    campaignId: campaign._id,
    passId,
    status: { $in: ['draft', 'published'] },
  })
    .sort({ createdAt: 1 })
    .lean();
  const indexByTurf = new Map(books.map((b, i) => [String(b._id), i]));

  const assignmentDocs = await TurfAssignment.find({ turfId: { $in: books.map((b) => b._id) } }).lean();
  const assignments = assignmentDocs
    .filter((a) => indexByTurf.has(String(a.turfId)))
    .map((a) => ({
      bookIndex: indexByTurf.get(String(a.turfId)),
      userId: a.userId,
      assignedBy: a.assignedBy,
      assignedAt: a.assignedAt,
    }));

  let activities = [];
  let responses = [];
  if (includeKnocks) {
    activities = await CanvassActivity.find({ passId }).lean();
    responses = await SurveyResponse.find({ passId }).lean();
  }

  return TurfSnapshot.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    passId,
    reason: reason || 'discard',
    books: books.map((b) => ({
      name: b.name,
      mode: b.mode,
      params: b.params,
      boundary: b.boundary,
      centroid: b.centroid,
      householdIds: b.householdIds,
      doorCount: b.doorCount,
      status: b.status,
    })),
    assignments,
    clearedKnocks: !!includeKnocks,
    activities,
    responses,
    bookCount: books.length,
    knockCount: activities.length + responses.length,
    createdBy: userId || null,
  });
}

// Restore a snapshot: recreate its books (fresh ids), re-mirror households,
// re-create assignments, and — if it captured cleared knocks — re-insert them
// verbatim and recompute the affected statuses. Does NOT re-activate the pass;
// the admin re-activates from the Passes page if it was live. The caller must
// ensure the pass currently has no live books (else this would duplicate).
export async function restoreSnapshot({ campaign, snapshot, userId }) {
  // Read through a plain object so the Mixed arrays (cleared knocks) insert cleanly.
  const snap = typeof snapshot.toObject === 'function' ? snapshot.toObject() : snapshot;
  const passId = snap.passId;

  // Only doors that STILL belong to this round's effort may be re-attached — a door
  // re-carved into another effort since the snapshot must not be yanked back into this
  // effort's book (disjointness). Such doors are dropped from the restored books.
  const pass = await Pass.findById(passId, { effortId: 1 }).lean();
  const allHhIds = [...new Set(snap.books.flatMap((b) => (b.householdIds || []).map(String)))];
  const owned = new Set(
    pass && allHhIds.length
      ? (
          await Household.find(
            { _id: { $in: allHhIds }, campaignId: snap.campaignId, effortId: pass.effortId },
            { _id: 1 }
          ).lean()
        ).map((h) => String(h._id))
      : []
  );

  const inserted = await Turf.insertMany(
    snap.books.map((b) => {
      const householdIds = (b.householdIds || []).filter((id) => owned.has(String(id)));
      return {
        organizationId: snap.organizationId,
        campaignId: snap.campaignId,
        passId,
        name: b.name,
        mode: b.mode,
        params: b.params,
        boundary: b.boundary,
        centroid: b.centroid,
        householdIds,
        doorCount: householdIds.length,
        status: b.status,
        generatedBy: userId || null,
      };
    })
  );

  const mirrorOps = [];
  inserted.forEach((t) => {
    t.householdIds.forEach((hid, idx) => {
      mirrorOps.push({ updateOne: { filter: { _id: hid }, update: { $set: { turfId: t._id, walkOrder: idx } } } });
    });
  });
  for (let i = 0; i < mirrorOps.length; i += 2000) {
    await Household.bulkWrite(mirrorOps.slice(i, i + 2000), { ordered: false });
  }

  const asgOps = (snap.assignments || [])
    .filter((a) => inserted[a.bookIndex])
    .map((a) => ({
      turfId: inserted[a.bookIndex]._id,
      userId: a.userId,
      organizationId: snap.organizationId,
      campaignId: snap.campaignId,
      passId,
      assignedBy: a.assignedBy,
      assignedAt: a.assignedAt,
    }));
  if (asgOps.length) await TurfAssignment.insertMany(asgOps, { ordered: false });

  if (snap.clearedKnocks) {
    // Raw inserts preserve the original _ids and every field exactly.
    if (snap.activities?.length) await CanvassActivity.collection.insertMany(snap.activities);
    if (snap.responses?.length) await SurveyResponse.collection.insertMany(snap.responses);
    const hhIds = [...new Set((snap.activities || []).map((a) => String(a.householdId)))];
    const voterIds = [...new Set((snap.responses || []).map((r) => String(r.voterId)))];
    await recomputeHouseholdStatusesByIds(hhIds, campaign.type);
    await recomputeSurveyStatus(voterIds);
  }

  snapshot.restoredAt = new Date();
  await snapshot.save();
  return { bookCount: inserted.length, restoredKnocks: !!snap.clearedKnocks };
}
