import { Voter } from '../../models/Voter.js';
import { Campaign } from '../../models/Campaign.js';
import { DncUpload } from '../../models/DncUpload.js';
import { DncPendingId } from '../../models/DncPendingId.js';

// "Sticky" do-not-contact. A DNC list upload records each unmatched id as a DncPendingId (the
// voter wasn't in the org's universe yet), and a campaign deletion records the flagged people
// whose last row it removed (uploadId null for admin-set flags, with the original reason).
// When that voter is later imported, this graduates the pending id onto the real Voter row —
// so a do-not-contact request made before the voter (re-)entered the universe is still
// honored. Org-scoped (no campaign filter — DNC transcends campaigns; with per-campaign rows
// the svid match reaches every sibling), otherwise the mirror of reapplyVotedLists. Returns
// affected householdIds for the caller to recomputeFullyDnc. Idempotent; only non-undone
// uploads' pending ids re-apply — null-upload (admin) pendings always do.
//
// Matching here is EXACT on the stored string, on purpose and unlike reapplyVotedLists: this job is
// org-wide, and two states can issue the same digits, so ignoring leading zeros here could flag a
// stranger in another state (docs/PROPOSAL_VOTER_ID_KEYS.md). What it does honor is the STATE a
// list was declared for: a parking stamped GA graduates only onto voters in Georgia campaigns. An
// unstamped parking (an admin flag preserved across a campaign delete; rows parked before the stamp
// existed) graduates anywhere, as it always has. A voter row's state is its campaign's state.
export async function reapplyDncLists(organizationId) {
  const liveUploadIds = (
    await DncUpload.find({ organizationId, undone: { $ne: true } }, { _id: 1 }).lean()
  ).map((u) => u._id);

  const pending = await DncPendingId.find(
    { organizationId, $or: [{ uploadId: null }, { uploadId: { $in: liveUploadIds } }] },
    { stateVoterId: 1, uploadId: 1, reason: 1, state: 1 }
  ).lean();
  if (!pending.length) return { flagged: 0, householdIds: [] };

  // stateVoterId -> the parkings that could claim it, one per declared state (first wins), so the
  // eventual flag is attributed to the list whose state the voter is actually in.
  const parkingsBySvid = new Map();
  for (const p of pending) {
    const state = p.state || null;
    const list = parkingsBySvid.get(p.stateVoterId) || [];
    if (!list.some((x) => x.state === state)) list.push({ uploadId: p.uploadId || null, reason: p.reason || null, state });
    parkingsBySvid.set(p.stateVoterId, list);
  }
  const svids = [...parkingsBySvid.keys()];

  const voters = await Voter.find(
    { organizationId, stateVoterId: { $in: svids } },
    { _id: 1, stateVoterId: 1, householdId: 1, campaignId: 1, 'doNotContact.flagged': 1 }
  ).lean();
  if (!voters.length) return { flagged: 0, householdIds: [] };

  const campaigns = await Campaign.find({ organizationId }, { state: 1 }).lean();
  const stateOf = new Map(campaigns.map((c) => [String(c._id), c.state || null]));
  // The parking that claims this row: one declared for the row's state, else an unstamped one.
  const parkingFor = (v) => {
    const st = stateOf.get(String(v.campaignId)) || null;
    const list = parkingsBySvid.get(v.stateVoterId) || [];
    return list.find((x) => x.state === st) || list.find((x) => x.state === null) || null;
  };
  const claimed = voters.map((v) => ({ v, parking: parkingFor(v) })).filter((x) => x.parking);
  if (!claimed.length) return { flagged: 0, householdIds: [] };

  // These parkings have graduated (their voter now exists in a campaign they may claim) — drop
  // them regardless of whether the voter was already flagged by some other path. Keyed by
  // (id, declared state) so a sibling state's parking of the same digits is left alone.
  const graduated = new Map(); // key -> { stateVoterId, state }
  for (const { v, parking } of claimed) graduated.set(`${v.stateVoterId}|${parking.state ?? ''}`, { stateVoterId: v.stateVoterId, state: parking.state });
  const toFlag = claimed.filter(({ v }) => v.doNotContact?.flagged !== true);

  const affected = new Set();
  if (toFlag.length) {
    const now = new Date();
    const ops = toFlag.map(({ v, parking }) => ({
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
              reason: parking.reason,
              source: parking.uploadId ? 'upload' : 'admin',
              uploadId: parking.uploadId,
            },
          },
        },
      },
    }));
    for (let i = 0; i < ops.length; i += 2000) {
      await Voter.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
    }
    for (const { v } of toFlag) affected.add(String(v.householdId));

    // Keep each upload's `matched` count honest — PEOPLE, not rows: a person with sibling
    // rows in two campaigns graduates as one match, however many rows got flagged.
    const byUpload = new Map();
    const countedSvids = new Set();
    for (const { v, parking } of toFlag) {
      if (countedSvids.has(v.stateVoterId)) continue;
      countedSvids.add(v.stateVoterId);
      if (!parking.uploadId) continue; // admin pendings have no upload to tally
      const k = String(parking.uploadId);
      byUpload.set(k, (byUpload.get(k) || 0) + 1);
    }
    for (const [uid, n] of byUpload) {
      await DncUpload.updateOne({ _id: uid }, { $inc: { matched: n } });
    }
  }

  const pairs = [...graduated.values()];
  for (let i = 0; i < pairs.length; i += 500) {
    await DncPendingId.deleteMany({
      organizationId,
      $or: pairs.slice(i, i + 500).map((g) => ({ stateVoterId: g.stateVoterId, state: g.state })),
    });
  }
  return { flagged: toFlag.length, householdIds: [...affected] };
}
