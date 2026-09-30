import { Household } from '../../models/Household.js';
import { VotedVoter } from '../../models/VotedVoter.js';
import { VotedUpload } from '../../models/VotedUpload.js';
import { VotedPendingId } from '../../models/VotedPendingId.js';
import { canonicalVoterId } from '../../utils/voterIdKey.js';
import { findVotersByVoterIds, clearParkedByCanonical } from '../voters/voterIdLookup.js';

// "Sticky" early voting. A voted-list upload records each unmatched id as a VotedPendingId (the
// voter wasn't in the universe yet). When that voter is later imported, this graduates the pending
// id into a real VotedVoter row — so a door whose occupants all actually voted doesn't wrongly
// re-open on a universe re-import. Returns the affected householdIds for the caller to recompute.
// Idempotent; only non-undone uploads' pending ids re-apply.
//
// A parked id is an OUTSIDE id (it came from a list), so it is matched the way the upload matched
// it: leading zeros ignored, inside this campaign (services/voters/voterIdLookup.js). A list that
// lost its zeros in Excel, uploaded before the padded voter file arrived, still graduates. The
// do-not-contact twin (services/dnc/reapplyDncLists.js) is deliberately still exact — it is
// org-wide, and two states can issue the same digits; see docs/PROPOSAL_VOTER_ID_KEYS.md.
export async function reapplyVotedLists(campaignId) {
  const liveUploadIds = (
    await VotedUpload.find({ campaignId, undone: { $ne: true } }, { _id: 1 }).lean()
  ).map((u) => u._id);
  if (!liveUploadIds.length) return { marked: 0, householdIds: [] };

  const pending = await VotedPendingId.find(
    { campaignId, uploadId: { $in: liveUploadIds } },
    { stateVoterId: 1, uploadId: 1, organizationId: 1 }
  ).lean();
  if (!pending.length) return { marked: 0, householdIds: [] };

  const org = pending[0].organizationId;
  // canonical id -> uploadId to attribute the eventual mark to (first upload wins).
  const uploadByCanonical = new Map();
  for (const p of pending) {
    const c = canonicalVoterId(p.stateVoterId);
    if (c != null && !uploadByCanonical.has(c)) uploadByCanonical.set(c, p.uploadId);
  }
  if (!uploadByCanonical.size) return { marked: 0, householdIds: [] };

  // Voters now present in THIS campaign (rows are per-campaign, so the campaign scope is the whole
  // question), whatever spelling the file parked them under.
  const { voters } = await findVotersByVoterIds({
    scopeFilter: { campaignId },
    ids: pending.map((p) => p.stateVoterId),
    projection: { _id: 1, stateVoterId: 1, householdId: 1 },
  });
  // Defensive: a row whose household is not this campaign's is not this campaign's voter.
  const hhIds = [...new Set(voters.map((v) => String(v.householdId)))];
  const inCampaignHh = new Set(
    (await Household.find({ _id: { $in: hhIds }, campaignId }, { _id: 1 }).lean()).map((h) => String(h._id))
  );
  const present = voters.filter((v) => inCampaignHh.has(String(v.householdId)));
  if (!present.length) return { marked: 0, householdIds: [] };

  // These ids have graduated (their voter is now in the campaign) — drop them regardless of
  // whether a VotedVoter row already existed.
  const gradCanonicals = new Set(present.map((v) => canonicalVoterId(v.stateVoterId)));

  const already = new Set(
    (
      await VotedVoter.find(
        { campaignId, voterId: { $in: present.map((v) => v._id) } },
        { voterId: 1 }
      ).lean()
    ).map((r) => String(r.voterId))
  );
  const toMark = present.filter((v) => !already.has(String(v._id)));

  const affected = new Set();
  if (toMark.length) {
    const ops = toMark.map((v) => ({
      updateOne: {
        filter: { campaignId, voterId: v._id },
        update: {
          $setOnInsert: {
            organizationId: org,
            campaignId,
            voterId: v._id,
            householdId: v.householdId,
            stateVoterId: v.stateVoterId,
            votedAt: new Date(),
            uploadId: uploadByCanonical.get(canonicalVoterId(v.stateVoterId)),
          },
        },
        upsert: true,
      },
    }));
    for (let i = 0; i < ops.length; i += 2000) {
      await VotedVoter.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
    }
    for (const v of toMark) affected.add(String(v.householdId));

    // Keep each upload's `matched` count honest.
    const byUpload = new Map();
    for (const v of toMark) {
      const k = String(uploadByCanonical.get(canonicalVoterId(v.stateVoterId)));
      byUpload.set(k, (byUpload.get(k) || 0) + 1);
    }
    for (const [uid, n] of byUpload) {
      await VotedUpload.updateOne({ _id: uid }, { $inc: { matched: n } });
    }
  }

  await clearParkedByCanonical(VotedPendingId, { campaignId }, gradCanonicals);
  return { marked: toMark.length, householdIds: [...affected] };
}
