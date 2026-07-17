import { Voter } from '../../models/Voter.js';
import { DncUpload } from '../../models/DncUpload.js';
import { DncPendingId } from '../../models/DncPendingId.js';

// "Sticky" do-not-contact. A DNC list upload records each unmatched id as a DncPendingId (the
// voter wasn't in the org's universe yet). When that voter is later imported, this graduates the
// pending id onto the real Voter row — so a do-not-contact request made before the voter entered
// the universe is still honored. Org-scoped (no campaign filter — DNC transcends campaigns),
// otherwise the mirror of reapplyVotedLists. Returns affected householdIds for the caller to
// recomputeFullyDnc. Idempotent; only non-undone uploads' pending ids re-apply.
export async function reapplyDncLists(organizationId) {
  const liveUploadIds = (
    await DncUpload.find({ organizationId, undone: { $ne: true } }, { _id: 1 }).lean()
  ).map((u) => u._id);
  if (!liveUploadIds.length) return { flagged: 0, householdIds: [] };

  const pending = await DncPendingId.find(
    { organizationId, uploadId: { $in: liveUploadIds } },
    { stateVoterId: 1, uploadId: 1 }
  ).lean();
  if (!pending.length) return { flagged: 0, householdIds: [] };

  // stateVoterId -> uploadId to attribute the eventual flag to (first upload wins).
  const uploadBySvid = new Map();
  for (const p of pending) {
    if (!uploadBySvid.has(p.stateVoterId)) uploadBySvid.set(p.stateVoterId, p.uploadId);
  }
  const svids = [...uploadBySvid.keys()];

  const voters = await Voter.find(
    { organizationId, stateVoterId: { $in: svids } },
    { _id: 1, stateVoterId: 1, householdId: 1, 'doNotContact.flagged': 1 }
  ).lean();
  if (!voters.length) return { flagged: 0, householdIds: [] };

  // These ids have graduated (their voter now exists) — drop them regardless of whether the
  // voter was already flagged by some other path.
  const gradSvids = [...new Set(voters.map((v) => v.stateVoterId))];
  const toFlag = voters.filter((v) => v.doNotContact?.flagged !== true);

  const affected = new Set();
  if (toFlag.length) {
    const now = new Date();
    const ops = toFlag.map((v) => ({
      updateOne: {
        // The flagged-$ne guard keeps undo attribution clean: a voter flagged by an admin (or an
        // earlier upload) between our read and this write is never re-attributed.
        filter: { _id: v._id, 'doNotContact.flagged': { $ne: true } },
        update: {
          $set: {
            doNotContact: {
              flagged: true,
              at: now,
              byUserId: null,
              reason: null,
              source: 'upload',
              uploadId: uploadBySvid.get(v.stateVoterId),
            },
          },
        },
      },
    }));
    for (let i = 0; i < ops.length; i += 2000) {
      await Voter.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
    }
    for (const v of toFlag) affected.add(String(v.householdId));

    // Keep each upload's `matched` count honest.
    const byUpload = new Map();
    for (const v of toFlag) {
      const k = String(uploadBySvid.get(v.stateVoterId));
      byUpload.set(k, (byUpload.get(k) || 0) + 1);
    }
    for (const [uid, n] of byUpload) {
      await DncUpload.updateOne({ _id: uid }, { $inc: { matched: n } });
    }
  }

  await DncPendingId.deleteMany({ organizationId, stateVoterId: { $in: gradSvids } });
  return { flagged: toFlag.length, householdIds: [...affected] };
}
