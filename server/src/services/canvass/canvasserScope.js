import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { activePassIds } from '../passes/activePasses.js';

export function isOrgAdminOrSuper(req) {
  if (req.user.isSuperAdmin) return true;
  return req.activeMembership?.role === 'admin';
}

// A canvasser only sees households in the books ASSIGNED to them on the campaign's
// ACTIVE rounds — UNIONED across all active efforts (a canvasser can be on more than
// one effort). Returns:
//   null  -> no restriction (admin/super see everything)
//   [...] -> the allowed household ids; an EMPTY array ⇒ they see nothing.
//
// Shared by /mobile/bootstrap (the canvasser's door list/map) and /mobile/me/today
// (the "Remaining" stat) so both surfaces count the SAME doors.
export async function canvasserHouseholdScope(req, campaign) {
  if (isOrgAdminOrSuper(req)) return null;
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
