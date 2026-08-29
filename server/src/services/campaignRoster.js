import { CampaignAssignment } from '../models/CampaignAssignment.js';
import { CampaignManager } from '../models/CampaignManager.js';
import { Membership } from '../models/Membership.js';
import { User } from '../models/User.js';

// CampaignAssignment is the per-campaign roster that GATES mobile visibility — a
// canvasser only sees campaigns they're assigned to. Whenever a user is given work
// (a book), make sure they're on that campaign's roster, so they can actually SEE the
// campaign in the field app. Idempotent upsert keyed on the unique (campaignId,userId).
export async function ensureCampaignAssignments(campaignId, userIds, orgId, byUserId) {
  const ids = [...new Set((userIds || []).map((u) => String(u)))].filter(Boolean);
  if (!ids.length) return;
  const now = new Date();
  // NO EMAIL ON PURPOSE. This is a SILENT side-effect roster add — it fires whenever someone is handed a
  // book so the campaign shows up in their field app, not from a deliberate "add to campaign" action. The
  // "you've been added to a campaign" note is sent only from the Team-page add loop (routes/admin/
  // assignments.js). Do NOT wire a sendMail here or a book assignment would spam a duplicate notice.
  await CampaignAssignment.bulkWrite(
    ids.map((uid) => ({
      updateOne: {
        filter: { campaignId, userId: uid },
        update: { $setOnInsert: { organizationId: orgId, assignedBy: byUserId || null, assignedAt: now } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

// The subset of `ids` that are ACTIVATED members of this org: an active membership whose
// user account is also active. This is what "and activated" means for assignment — it
// mirrors the book pickers, which hide anyone whose user.isActive/membership.isActive is false.
async function activeMemberIdSet(organizationId, ids) {
  const memberIds = await Membership.find(
    { organizationId, userId: { $in: ids }, isActive: true }
  ).distinct('userId');
  if (!memberIds.length) return new Set();
  const activeUserIds = await User.find({ _id: { $in: memberIds }, isActive: true }).distinct('_id');
  return new Set(activeUserIds.map(String));
}

// The subset of `ids` we can POSITIVELY show as deactivated — an org membership explicitly
// switched off, or a disabled user account. Deliberately NOT the complement of
// activeMemberIdSet: a superadmin doing cross-org oversight holds no membership row in this
// org at all, and "no evidence of activation" must never render as "inactive" beside a real
// person's name. Read-only labelling — deactivating a member intentionally KEEPS their books
// (memberships.js skips releaseAssignedWork), so this names that state, never changes it.
export async function deactivatedMemberIdSet(organizationId, ids) {
  const list = [...new Set((ids || []).map((u) => String(u)))].filter(Boolean);
  if (!list.length) return new Set();
  const [offMembers, offUsers] = await Promise.all([
    Membership.find({ organizationId, userId: { $in: list }, isActive: false }).distinct('userId'),
    User.find({ _id: { $in: list }, isActive: false }).distinct('_id'),
  ]);
  return new Set([...offMembers, ...offUsers].map(String));
}

// The subset of `ids` that have positively LEFT or been switched off: a deleted user account, a
// deactivated one, a deactivated org membership, or no membership in this org at all (what
// removal leaves behind — releaseAssignedWork drops the books, the membership goes with it).
// Superadmins are exempt: cross-org oversight means they legitimately hold no membership here.
//
// This is deliberately NOT partitionAssignable inverted. That answers "may I hand this person
// NEW work?" and refuses anyone merely absent from a campaign's roster — a book-holder is put on
// that roster by ensureCampaignAssignments, but nothing re-checks it, so inverting it would let
// an incidental roster gap silently strip a restored book from someone who never went anywhere.
// Restoring a snapshot must only refuse people we can PROVE are gone.
export async function departedMemberIdSet(organizationId, ids) {
  const list = [...new Set((ids || []).map((u) => String(u)))].filter(Boolean);
  if (!list.length) return new Set();
  const [liveUsers, supers, activeMembers] = await Promise.all([
    User.find({ _id: { $in: list }, isActive: true }).distinct('_id'),
    User.find({ _id: { $in: list }, isSuperAdmin: true }).distinct('_id'),
    Membership.find({ organizationId, userId: { $in: list }, isActive: true }).distinct('userId'),
  ]);
  const live = new Set(liveUsers.map(String));
  const superSet = new Set(supers.map(String));
  const member = new Set(activeMembers.map(String));
  return new Set(list.filter((id) => !superSet.has(id) && (!live.has(id) || !member.has(id))));
}

// Who may be assigned work (a book) in a campaign: users on the campaign roster, OR org
// admins — who can be assigned on the fly (incl. self) and get added to the roster when
// they are — OR a team lead holding a management grant on THIS campaign, for the same
// reason (a lead runs the campaign; they must be able to put themselves on a book without
// asking an admin to roster them first). In all three cases only if they are currently
// ACTIVATED (active org membership + active user account), so a since-deactivated person can
// no longer be given new work. Superadmins are always allowed (cross-org oversight +
// self-assign). Everyone else must be added on the Team page first.
// Returns { allowed, notOnTeam } as arrays of string ids (deduped).
export async function partitionAssignable({ campaignId, organizationId, userIds }) {
  const ids = [...new Set((userIds || []).map((u) => String(u)))].filter(Boolean);
  if (!ids.length) return { allowed: [], notOnTeam: [] };
  const [onRoster, admins, managers, supers, activeSet] = await Promise.all([
    CampaignAssignment.find({ campaignId, userId: { $in: ids } }).distinct('userId'),
    Membership.find({ organizationId, userId: { $in: ids }, role: 'admin', isActive: true }).distinct('userId'),
    // Scoped to THIS campaign's grants, never "is a lead somewhere" — a lead's authority is the
    // set of campaigns granted to them, so a grant on another campaign must not open this one.
    CampaignManager.find({ organizationId, campaignId, userId: { $in: ids } }).distinct('userId'),
    User.find({ _id: { $in: ids }, isSuperAdmin: true }).distinct('_id'),
    activeMemberIdSet(organizationId, ids),
  ]);
  const roster = new Set(onRoster.map(String));
  const admin = new Set(admins.map(String));
  const manager = new Set(managers.map(String));
  const superSet = new Set(supers.map(String));
  // Roster/admin/lead candidates must ALSO be activated; superadmins bypass (oversight).
  const ok = new Set(
    ids.filter(
      (id) =>
        superSet.has(id) ||
        ((roster.has(id) || admin.has(id) || manager.has(id)) && activeSet.has(id))
    )
  );
  return {
    allowed: ids.filter((id) => ok.has(id)),
    notOnTeam: ids.filter((id) => !ok.has(id)),
  };
}
