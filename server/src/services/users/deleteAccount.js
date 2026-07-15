import crypto from 'node:crypto';
import mongoose from 'mongoose';

import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { Organization } from '../../models/Organization.js'; // registered for populate
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CampaignManager } from '../../models/CampaignManager.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { EffortMember } from '../../models/EffortMember.js';
import { DeletedUserRecord } from '../../models/DeletedUserRecord.js';

// Self-serve account deletion — App Store guideline 5.1.1(v) and Google Play's
// account-deletion policy both require it, and both are triggered by the fact that our
// mobile binary can CREATE accounts (the admin "add canvasser" forms), not merely by the
// fact that it has a login.
//
// The shape of this is dictated by the schema, not by preference. CanvassActivity.userId,
// SurveyResponse.userId and FlagReview.reviewedBy are all `required`, so the User row
// cannot be removed without destroying the knock ledger — and that ledger is what campaign
// counts, coverage and the invoice are computed from (knocksPipeline groups on
// {householdId, passId} and never joins User, so a scrub cannot move a bill). Deletion is
// therefore a scrub-in-place: the row survives, every trace of the person does not.

const RETENTION_DAYS = Number(process.env.DELETED_IDENTITY_RETENTION_DAYS || 180);

export class AccountDeletionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// The email must stay unique (User.email carries a unique index), so the tombstone embeds
// the user id. A single shared constant would throw E11000 on the SECOND deletion — and
// that duplicate-key path is already mapped to a misleading "Email already exists" 409.
//
// Scrubbing the address also RELEASES the person's real email: if they are ever re-added
// they come back as a new User document. Their historical knocks stay bound to the old id,
// which is correct — the ledger records who did the work at the time, and re-hiring someone
// must not silently re-attach them to a flag history they deleted.
function tombstoneEmail(userId) {
  return `deleted+${userId}@deleted.doorline.invalid`;
}

// passwordHash is `required`, so it cannot be cleared: a .save() would throw ValidationError,
// and a $set of null would slip past the validator and then make bcrypt.compare(plain, null)
// THROW on the next login — a 500 where a clean 401 belongs. Burn it to an unusable random
// hash instead. Nothing can ever match it.
async function unusablePasswordHash() {
  return User.hashPassword(`deleted-${crypto.randomBytes(32).toString('hex')}`);
}

/**
 * Everything that would break if this user vanished right now. Returns a list of blockers;
 * an empty list means the deletion is safe to run.
 *
 * A User is GLOBAL across orgs, so one delete tap pulls the person out of every org they
 * belong to at once. Each of those orgs has to survive it.
 */
export async function checkDeletionBlockers(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AccountDeletionError('NOT_FOUND', 'User not found');
  if (user.deletedAt) throw new AccountDeletionError('ALREADY_DELETED', 'This account is already deleted');

  const blockers = [];

  // The App Review / Play reviewer demo login. A reviewer WILL press this button — testing it
  // is the whole point of 5.1.1(v) — and letting them through would destroy the demo tenant and
  // leave the NEXT submission with no working credentials to review.
  //
  // But locking it is only half the answer: a reviewer who cannot complete a deletion anywhere
  // will reject us for "unable to verify account deletion", which is the very thing they came to
  // check. So the demo tenant ships with a SECOND, disposable canvasser account that is NOT
  // locked and exists purely to be deleted, and the App Review notes name it. This message points
  // there, because a reviewer may well tap the button before reading the notes.
  if (user.deletionLocked) {
    blockers.push({
      code: 'DELETION_LOCKED',
      message:
        'This is an app-review demo account, so it can’t be deleted — otherwise the next ' +
        'review would have no way in. To test account deletion, please sign in with the ' +
        'disposable account listed in the App Review notes; it exists only for that purpose.',
    });
  }

  // Losing the last super-admin would leave the platform with no oversight at all.
  if (user.isSuperAdmin) {
    const others = await User.countDocuments({
      _id: { $ne: user._id },
      isSuperAdmin: true,
      isActive: true,
      deletedAt: null,
    });
    if (others === 0) {
      blockers.push({
        code: 'LAST_SUPER_ADMIN',
        message: 'You are the only super-admin. Promote another super-admin first.',
      });
    }
  }

  const memberships = await Membership.find({ userId: user._id, isActive: true })
    .populate('organizationId', 'name')
    .lean();

  for (const m of memberships) {
    if (m.role !== 'admin') continue;
    const orgName = m.organizationId?.name || 'your organization';

    // A sole admin who deletes themselves bricks the org: nobody left who can add users,
    // cut turf, assign books or run reports, while canvassers keep knocking.
    const otherAdmins = await activeAdminIds(m.organizationId?._id ?? m.organizationId, user._id);
    if (otherAdmins.length === 0) {
      blockers.push({
        code: 'LAST_ADMIN',
        message: `You are the only admin of ${orgName}. Make someone else an admin first.`,
        organizationId: String(m.organizationId?._id ?? m.organizationId),
      });
      continue;
    }

    // Worse than bricking: losing the last bill-payer means nobody can see or pay the
    // subscription, and the entitlement gate drives the whole org read-only when it lapses.
    // Self-deletion must not be able to financially suspend a customer.
    if (m.billingAccess) {
      const otherBillers = await Membership.countDocuments({
        organizationId: m.organizationId?._id ?? m.organizationId,
        userId: { $ne: user._id },
        role: 'admin',
        isActive: true,
        billingAccess: true,
      });
      if (otherBillers === 0) {
        blockers.push({
          code: 'LAST_BILLING_ADMIN',
          message: `You are the only admin who can manage billing for ${orgName}. Give billing access to another admin first.`,
          organizationId: String(m.organizationId?._id ?? m.organizationId),
        });
      }
    }
  }

  return { user, memberships, blockers };
}

async function activeAdminIds(organizationId, excludeUserId) {
  const rows = await Membership.find({
    organizationId,
    userId: { $ne: excludeUserId },
    role: 'admin',
    isActive: true,
  })
    .select('userId')
    .lean();
  // A membership can outlive its user's account, so confirm the admin is a live login.
  const ids = rows.map((r) => r.userId);
  if (ids.length === 0) return [];
  const live = await User.find({ _id: { $in: ids }, isActive: true, deletedAt: null })
    .select('_id')
    .lean();
  return live.map((u) => u._id);
}

/**
 * Delete the account. Scrubs the identity, snapshots it for fraud attribution, releases
 * every piece of work the person was holding, and shuts the login permanently.
 *
 * Deliberately leaves CanvassActivity / SurveyResponse / FlagReview / HouseholdLocationChange
 * untouched: those are the organization's field records, not the user's personal content, and
 * removing them would silently rewrite campaign counts and invoices. Both stores allow this
 * retention; both require it be disclosed, which the deletion sheet and privacy policy do.
 */
export async function deleteAccount(userId, { reason = 'self' } = {}) {
  const { user, memberships, blockers } = await checkDeletionBlockers(userId);
  if (blockers.length > 0) {
    throw new AccountDeletionError(
      'BLOCKED',
      'This account cannot be deleted yet.',
      { blockers }
    );
  }

  const now = new Date();
  const orgIds = memberships.map((m) => m.organizationId?._id ?? m.organizationId).filter(Boolean);

  // Snapshot the identity BEFORE the scrub — this is the only thing standing between a
  // deleted canvasser and an unattributable GPS trail. See models/DeletedUserRecord.js.
  // NAME ONLY: attribution needs a name, not a mailbox. The published deletion promise is
  // that email, phone and password are removed immediately — a snapshot that kept them
  // would quietly falsify it. ($unset covers a re-delete over a legacy full snapshot.)
  const retentionUntil = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await DeletedUserRecord.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        userId: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        organizationIds: orgIds,
        deletedAt: now,
        retentionUntil,
      },
      $unset: { email: 1, phone: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Release every piece of work the person was holding, so no book, effort or campaign is
  // left assigned to a ghost. The existing admin remove-from-org route (DELETE
  // /admin/memberships/:userId) drops Membership/CampaignAssignment/CampaignManager but has
  // never released TurfAssignment or EffortMember — which is why a removed user can still be
  // holding books and an effort still reads as "staffed". Fixed here for deletion; the admin
  // route reuses this helper.
  await releaseAssignedWork(user._id);

  // Memberships go inactive rather than away: reports.js counts team members straight off
  // Membership with no join to User, so leaving them active would keep counting a deleted
  // person forever, and the campaign setup-progress step would still read as "staffed".
  await Membership.updateMany({ userId: user._id }, { $set: { isActive: false } });

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        firstName: 'Deleted',
        lastName: 'user',
        email: tombstoneEmail(user._id),
        phone: null,
        passwordHash: await unusablePasswordHash(),
        isActive: false,
        deletedAt: now,
        mustChangePassword: false,
        tempPasswordSetAt: null,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      },
    }
  );

  return { deletedAt: now, retentionUntil, organizationIds: orgIds };
}

/**
 * Hand back everything the user was holding. Shared by account deletion, the admin
 * remove-from-org route, and remove-from-CAMPAIGN, so the three paths can't drift apart.
 *
 * Scope, widest to narrowest:
 *   {}                    — global (account deletion): every org, every campaign.
 *   { organizationId }    — one org: all of that org's campaigns.
 *   { campaignId }        — ONE campaign only. All four work models denormalize campaignId,
 *                           so this is exact — a user removed from campaign A keeps every
 *                           book they hold in campaign B of the same org.
 *
 * Two deliberate asymmetries in campaign scope:
 *   - Membership has NO campaignId, so the coordinator reset is inherently org-level and is
 *     skipped. Clearing it would sever a supervision link that has nothing to do with this
 *     campaign.
 *   - CampaignManager (a team lead's grant to MANAGE the campaign) is left alone. This route
 *     is mounted behind requireCampaignManager, which passes for any lead holding a grant on
 *     the campaign — cascading here would let one lead revoke another's grant (or their own)
 *     from a walker-roster button. Revoking a grant stays admin-only, on the Users page.
 *
 * Never touches CanvassActivity / SurveyResponse: releasing work must not rewrite a single
 * knock. The departed canvasser stays in every campaign total and on the invoice.
 */
export async function releaseAssignedWork(
  userId,
  { organizationId = null, campaignId = null } = {}
) {
  const scope = campaignId ? { campaignId } : organizationId ? { organizationId } : {};
  // Books are released across ALL rounds, not just active ones: readiness rollups
  // (efforts, campaignSummaries, setupStatus) count assignments on passes of any status, so a
  // stale archived row would keep the campaign reading as "staffed" by someone who is gone.
  // No history is lost — CanvassActivity stamps userId/passId/turfId on every knock, so who
  // walked which book in which round lives in the ledger, not here.
  const [turf, efforts, campaigns, managed] = await Promise.all([
    TurfAssignment.deleteMany({ userId, ...scope }),
    EffortMember.deleteMany({ userId, ...scope }),
    CampaignAssignment.deleteMany({ userId, ...scope }),
    campaignId ? Promise.resolve({ deletedCount: 0 }) : CampaignManager.deleteMany({ userId, ...scope }),
  ]);
  // A coordinator who leaves the ORG must not keep supervising anybody. Org/global scope only.
  if (!campaignId) {
    await Membership.updateMany(
      { coordinatorId: userId, ...scope },
      { $set: { coordinatorId: null } }
    );
  }

  return {
    turfAssignments: turf.deletedCount || 0,
    effortMemberships: efforts.deletedCount || 0,
    campaignAssignments: campaigns.deletedCount || 0,
    managedCampaigns: managed.deletedCount || 0,
  };
}

/**
 * The identity behind a deleted user, for the org's own audit surfaces. Returns null once
 * the retention window has lapsed and the snapshot has been purged — after which the
 * records no longer directly identify the person (they stay keyed to the account id, so
 * the end state is de-identified, not anonymous — same wording as the privacy policy).
 */
export async function resolveDeletedIdentities(userIds, { organizationId = null } = {}) {
  const ids = (userIds || []).filter((id) => mongoose.isValidObjectId(id));
  if (ids.length === 0) return new Map();
  const query = { userId: { $in: ids }, purgedAt: null };
  if (organizationId) query.organizationIds = organizationId;
  const rows = await DeletedUserRecord.find(query).lean();
  return new Map(rows.map((r) => [String(r.userId), r]));
}
