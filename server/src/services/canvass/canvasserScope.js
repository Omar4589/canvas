import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { activePassIds } from '../passes/activePasses.js';

export function isOrgAdminOrSuper(req) {
  if (req.user.isSuperAdmin) return true;
  return req.activeMembership?.role === 'admin';
}

// The households in the books ASSIGNED to this user on the campaign's ACTIVE rounds
// — UNIONED across all active efforts. This applies to EVERYONE, admins included: an
// admin who canvasses is scoped to their own assigned books (same mechanism as a
// canvasser) so two people never knock the same block. Admin oversight lives in the
// /admin screens, not here. Returns the allowed household ids; an EMPTY array ⇒ they
// see nothing (unassigned). Shared by /mobile/bootstrap (door list/map), /changes,
// and /mobile/me/today ("Remaining") so every surface counts the SAME doors.
export async function canvasserHouseholdScope(req, campaign) {
  const passIds = await activePassIds(campaign._id);
  if (!passIds.length) return []; // no active round anywhere → see nothing
  const myTurfs = await TurfAssignment.find(
    { userId: req.user._id, campaignId: campaign._id, passId: { $in: passIds } },
    { turfId: 1 }
  ).lean();
  if (!myTurfs.length) return []; // not assigned a book on any active round
  const books = await Turf.find({ _id: { $in: myTurfs.map((a) => a.turfId) } }, { householdIds: 1 }).lean();
  return books.flatMap((b) => b.householdIds || []);
}
