import { CampaignAssignment } from '../models/CampaignAssignment.js';
import { CampaignManager } from '../models/CampaignManager.js';
import { Membership } from '../models/Membership.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { joinCampaignCrew, CREW_JOB } from './memberships/setCoordinator.js';
import { mapWithLimit } from '../utils/mapWithLimit.js';

// CampaignAssignment is the per-campaign roster that GATES mobile visibility — a
// canvasser only sees campaigns they're assigned to. Whenever a user is given work
// (a book), make sure they're on that campaign's roster, so they can actually SEE the
// campaign in the field app. Idempotent upsert keyed on the unique (campaignId,userId).
//
// `join` (the two book routes): someone a book puts BACK on a campaign is coming back to it, whatever
// their role (owner ruling 2026-10-26), so they join with No crew and their earlier doors there move
// with them — joinCampaignCrew, whose insert is the claim. The roster is read once and only ids not
// on it join: joining runs the job's plan, which a book holder already on the roster doesn't need.
// No book screen has a crew choice, so no count is shown first; History records any move. A join
// whose plan throws still adds the person (joinCampaignCrew falls back to a plain insert), and a
// ledger error never fails the book assignment — the job stays on the row for Finish it.
//
// The demo seeder calls this without `join`: it builds demo data and must not move staged doors.
export async function ensureCampaignAssignments(campaignId, userIds, orgId, byUserId, { join = false } = {}) {
  const ids = [...new Set((userIds || []).map((u) => String(u)))].filter(Boolean);
  if (!ids.length) return;
  const now = new Date();
  // NO EMAIL ON PURPOSE. This is a SILENT side-effect roster add — it fires whenever someone is handed a
  // book so the campaign shows up in their field app, not from a deliberate "add to campaign" action. The
  // "you've been added to a campaign" note is sent only from the Team-page add loop (routes/admin/
  // assignments.js). Do NOT wire a sendMail here or a book assignment would spam a duplicate notice.
  if (join) {
    const on = new Set((await CampaignAssignment.find({ campaignId, userId: { $in: ids } }, 'userId').lean()).map((r) => String(r.userId)));
    await mapWithLimit(ids.filter((uid) => !on.has(uid)), CREW_JOB.sideBySide, async (uid) => {
      try {
        await joinCampaignCrew({ organizationId: orgId, campaignId, userId: uid, coordinatorId: null, actorUserId: byUserId || null });
      } catch (err) {
        // Never fail the book over the join: put them on the roster plainly, as before.
        await CampaignAssignment.updateOne(
          { campaignId, userId: uid },
          { $setOnInsert: { organizationId: orgId, assignedBy: byUserId || null, assignedAt: now } },
          { upsert: true }
        );
      }
    });
    return;
  }
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

// The subset of `ids` that are Doorline staff counted as members here WITHOUT a membership row:
// live super-admin accounts, and only in an INTERNAL org, the one place orgContext seats staff as
// members (middleware/orgContext.js). In a customer org staff are held to the member rule like
// anyone else, and support access can't mint them that membership (services/memberships/vendorGuards.js).
//
// This used to exempt staff in EVERY org ("cross-org oversight"). A customer's admin or lead could
// then put any Doorline staff account on a book or a walk-list crew: the 201, where anyone else's
// id earns a 409, confirmed the id was staff, and the book lists served the staffer's name and
// email back (PRIVACY_VERIFICATION item 36).
const internalStaffIdSet = async (organizationId, ids) => {
  if (!(await Organization.exists({ _id: organizationId, isInternal: true }))) return new Set();
  const staff = await User.find({ _id: { $in: ids }, isSuperAdmin: true, isActive: true }).distinct('_id');
  return new Set(staff.map(String));
};

// The subset of `ids` we can POSITIVELY show as deactivated — an org membership explicitly
// switched off, or a disabled user account. Deliberately NOT the complement of
// activeMemberIdSet: staff in an internal org hold no membership row there at all (and books
// handed to staff before item 36 can still sit in a customer org), and "no evidence of
// activation" must never render as "inactive" beside a real person's name. Read-only
// labelling — deactivating a member intentionally KEEPS their books
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
// Live staff accounts are exempt only in an internal org (internalStaffIdSet). In a customer org a
// staffer is gone on the same evidence as anyone, so a snapshot can't hand back a book the
// assign endpoints would now refuse them.
//
// This is deliberately NOT partitionAssignable inverted. That answers "may I hand this person
// NEW work?" and refuses anyone merely absent from a campaign's roster — a book-holder is put on
// that roster by ensureCampaignAssignments, but nothing re-checks it, so inverting it would let
// an incidental roster gap silently strip a restored book from someone who never went anywhere.
// Restoring a snapshot must only refuse people we can PROVE are gone.
export async function departedMemberIdSet(organizationId, ids) {
  const list = [...new Set((ids || []).map((u) => String(u)))].filter(Boolean);
  if (!list.length) return new Set();
  const [liveUsers, staff, activeMembers] = await Promise.all([
    User.find({ _id: { $in: list }, isActive: true }).distinct('_id'),
    internalStaffIdSet(organizationId, list),
    Membership.find({ organizationId, userId: { $in: list }, isActive: true }).distinct('userId'),
  ]);
  const live = new Set(liveUsers.map(String));
  const member = new Set(activeMembers.map(String));
  return new Set(list.filter((id) => !staff.has(id) && (!live.has(id) || !member.has(id))));
}

// Who may be assigned work (a book) in a campaign: users on the campaign roster, OR org
// admins — who can be assigned on the fly (incl. self) and get added to the roster when
// they are — OR a team lead holding a management grant on THIS campaign, for the same
// reason (a lead runs the campaign; they must be able to put themselves on a book without
// asking an admin to roster them first). In all three cases only if they are currently
// ACTIVATED (active org membership + active user account), so a since-deactivated person can
// no longer be given new work. Doorline staff skip all of that only in an internal org, where
// they self-assign for demos; in a customer org they need a membership like anyone else
// (internalStaffIdSet). Everyone else must be added on the Team page first.
//
// `selfOnlyFor` is the caller's id when the caller is a TEAM LEAD (null for admins and staff): the
// off-the-team exceptions above then cover only the lead themself, so a lead can still take a book
// before they're on the team but can't put an org admin or a co-lead onto it, which rostered them
// and let the lead read back their email and phone (PRIVACY_VERIFICATION item 41). People already
// on the team are unaffected.
// Returns { allowed, notOnTeam } as arrays of string ids (deduped).
export async function partitionAssignable({ campaignId, organizationId, userIds, selfOnlyFor = null }) {
  const ids = [...new Set((userIds || []).map((u) => String(u)))].filter(Boolean);
  if (!ids.length) return { allowed: [], notOnTeam: [] };
  const [onRoster, admins, managers, staff, activeSet] = await Promise.all([
    CampaignAssignment.find({ campaignId, userId: { $in: ids } }).distinct('userId'),
    Membership.find({ organizationId, userId: { $in: ids }, role: 'admin', isActive: true }).distinct('userId'),
    // Scoped to THIS campaign's grants, never "is a lead somewhere" — a lead's authority is the
    // set of campaigns granted to them, so a grant on another campaign must not open this one.
    CampaignManager.find({ organizationId, campaignId, userId: { $in: ids } }).distinct('userId'),
    internalStaffIdSet(organizationId, ids),
    activeMemberIdSet(organizationId, ids),
  ]);
  const roster = new Set(onRoster.map(String));
  const admin = new Set(admins.map(String));
  const manager = new Set(managers.map(String));
  // Roster/admin/lead candidates must ALSO be activated; staff bypass in an internal org only.
  // With no `selfOnlyFor` this is exactly: staff || ((roster || admin || manager) && active).
  const self = selfOnlyFor ? String(selfOnlyFor) : null;
  const ok = new Set(
    ids.filter((id) => {
      if (roster.has(id) && (activeSet.has(id) || staff.has(id))) return true;
      const exempt = staff.has(id) || ((admin.has(id) || manager.has(id)) && activeSet.has(id));
      return exempt && (!self || id === self);
    })
  );
  return {
    allowed: ids.filter((id) => ok.has(id)),
    notOnTeam: ids.filter((id) => !ok.has(id)),
  };
}
