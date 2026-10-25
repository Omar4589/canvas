import crypto from 'node:crypto';
import mongoose from 'mongoose';

import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import {
  wouldStrandBilling,
  countLiveAdmins,
  countLiveBillingAdmins,
} from '../memberships/billingGuards.js';
import { Organization } from '../../models/Organization.js'; // registered for populate
import { Campaign } from '../../models/Campaign.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CampaignManager } from '../../models/CampaignManager.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { EffortMember } from '../../models/EffortMember.js';
import { Pass } from '../../models/Pass.js';
import { DeletedUserRecord } from '../../models/DeletedUserRecord.js';
import { FbTimePersonLink } from '../../models/FbTimePersonLink.js';
import { FbTimeShift } from '../../models/FbTimeShift.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { PacePause } from '../../models/PacePause.js';
import { CoordinatorChange } from '../../models/CoordinatorChange.js';
import { EmailLog } from '../../models/EmailLog.js';
import { NOT_BULK } from '../reports/aggregations.js';

// Account deletion — self-serve (App Store guideline 5.1.1(v) and Google Play's account-deletion
// policy both require it, triggered by the fact that our mobile binary can CREATE accounts), plus
// three staff/admin doors: the platform console, the CLI, and an org admin deleting a member who
// belongs only to their organization (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md).
//
// The shape of this is dictated by the schema, not by preference. CanvassActivity.userId,
// SurveyResponse.userId and FlagReview.reviewedBy are all `required`, so the User row
// cannot be removed without destroying the knock ledger — and that ledger is what campaign
// counts, coverage and the invoice are computed from (knocksPipeline groups on
// {householdId, passId} and never joins User, so a scrub cannot move a bill). Deletion is
// therefore a scrub-in-place: the row survives, every trace of the person does not.
//
// THE MODEL (one rule, four doors): one deletion at a time per account; only membership changes
// before the account dies, and those are undone on refusal; everything else afterwards, idempotent,
// keyed by userId, and finished by a sweep if a crash interrupts it. There are no Mongo transactions
// in this codebase, so every step is a conditional write or a compensating recount:
//   1. blockers (the org door's review runs in its route, before this);
//   2. the lock — the pending DeletedUserRecord (claimDeletionLock);
//   3. the burned password hash, precomputed so the window to the gate is one write;
//   4. memberships off one row at a time, then a recount: no org may lose its last live admin or
//      billing admin (two admins deleting each other refuse rather than strand);
//   5. THE GATE — one conditional write that scrubs the User. From here the account is dead;
//   6-11. finishDeletion: the name record's orgs, memberships, released work, the FbTime email,
//      the email log, and the finished record.
// The sweep (sweepDeletionLocks, every 15 minutes and before the nightly purge) finishes a deletion
// that crashed after the gate, and undoes one that crashed before it.

// How long a deleted account's name is kept (DeletedUserRecord.retentionUntil); the identity purge reads it
// too, for an account whose record an organization's deletion dropped (purgeDeletedIdentities.js).
export const RETENTION_DAYS = Number(process.env.DELETED_IDENTITY_RETENTION_DAYS || 180);
const DAY_MS = 24 * 60 * 60 * 1000;

// A lock older than this belongs to an attempt that died; the next attempt, or the sweep, may take it.
export const LOCK_STALE_MS = 10 * 60 * 1000;

// When lastLoginAt became trustworthy: the field shipped 2026-05-07 (95f6b9d) and this is a week
// later, so an account created earlier may have signed in with nothing recorded. Such an account
// always reads as 'used' — it never loses its row, or its name, on the say-so of a missing clock.
export const CLOCKS_RELIABLE_FROM = new Date('2026-05-15T00:00:00.000Z');

export class AccountDeletionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const DELETION_IN_PROGRESS_MESSAGE =
  'A deletion of this account is already under way. Try again in a few minutes.';

// The email must stay unique (User.email carries a unique index), so the tombstone embeds
// the user id. A single shared constant would throw E11000 on the SECOND deletion — and
// that duplicate-key path is already mapped to a misleading "Email already exists" 409.
//
// Scrubbing the address also RELEASES the person's real email: if they are ever re-added
// they come back as a new User document. Their historical knocks stay bound to the old id,
// which is correct — the ledger records who did the work at the time, and re-hiring someone
// must not silently re-attach them to a flag history they deleted.
export function tombstoneEmail(userId) {
  return `deleted+${userId}@deleted.doorline.invalid`;
}

// passwordHash is `required`, so it cannot be cleared: a .save() would throw ValidationError,
// and a $set of null would slip past the validator and then make bcrypt.compare(plain, null)
// THROW on the next login — a 500 where a clean 401 belongs. Burn it to an unusable random
// hash instead. Nothing can ever match it.
async function unusablePasswordHash() {
  return User.hashPassword(`deleted-${crypto.randomBytes(32).toString('hex')}`);
}

// Blocker copy, by who is reading it. 'self' is the person deleting themselves (the phone's own
// sheet); 'other' is anyone deleting someone else — the platform page and the CLI name the org,
// the org door doesn't need to (it is the reader's own org) and never carries another org's id.
const blockerCopy = {
  self: {
    locked:
      'This is an app-review demo account, so it can’t be deleted — otherwise the next ' +
      'review would have no way in. To test account deletion, please sign in with the ' +
      'disposable account listed in the App Review notes; it exists only for that purpose.',
    lastSuper: 'You are the only super-admin. Promote another super-admin first.',
    lastAdmin: (org) => `You are the only admin of ${org}. Make someone else an admin first.`,
    lastBilling: (org) =>
      `You are the only admin who can manage billing for ${org}. Give billing access to another admin first.`,
  },
  other: {
    locked: 'This is an app-review demo account, so it can’t be deleted: the next store review needs it to sign in.',
    lastSuper: 'This is the only super-admin. Promote another super-admin first.',
    lastAdmin: (org) => `This person is the only admin of ${org}. Make someone else an admin there first.`,
    lastBilling: (org) =>
      `This person is the only admin who can manage billing for ${org}. Give billing access to another admin there first.`,
  },
  org: {
    lastAdmin: () => 'They’re the only admin here. Make someone else an admin first.',
    lastBilling: () => 'They’re the only admin with billing access here. Give billing access to another admin first.',
  },
};

/**
 * Everything that would break if this user vanished right now. Returns a list of blockers;
 * an empty list means the deletion is safe to run.
 *
 * A User is GLOBAL across orgs, so one delete tap pulls the person out of every org they
 * belong to at once. Each of those orgs has to survive it. On the org door (`organizationId`
 * given) only that org is checked — another membership refuses the whole deletion earlier
 * (OTHER_ORGANIZATION), so nothing here may mention another org — and no blocker carries an id.
 */
export const checkDeletionBlockers = async (userId, { subject = 'self', organizationId = null } = {}) => {
  const user = await User.findById(userId);
  if (!user) throw new AccountDeletionError('NOT_FOUND', 'User not found');
  if (user.deletedAt) throw new AccountDeletionError('ALREADY_DELETED', 'This account is already deleted');

  const copy = organizationId ? { ...blockerCopy.other, ...blockerCopy.org } : blockerCopy[subject] || blockerCopy.other;
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
    blockers.push({ code: 'DELETION_LOCKED', message: copy.locked });
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
      blockers.push({ code: 'LAST_SUPER_ADMIN', message: copy.lastSuper });
    }
  }

  const memberships = await Membership.find({
    userId: user._id,
    isActive: true,
    ...(organizationId ? { organizationId } : {}),
  })
    .populate('organizationId', 'name')
    .lean();

  for (const m of memberships) {
    if (m.role !== 'admin') continue;
    const orgId = m.organizationId?._id ?? m.organizationId;
    const orgName = m.organizationId?.name || 'your organization';
    // Only the platform page and the CLI may name the org (they can delete a multi-org account).
    const where = organizationId ? {} : { organizationId: String(orgId) };

    // A sole admin who leaves bricks the org: nobody left who can add users, cut turf, assign
    // books or run reports, while canvassers keep knocking.
    const otherAdmins = await activeAdminIds(orgId, user._id);
    if (otherAdmins.length === 0) {
      blockers.push({ code: 'LAST_ADMIN', message: copy.lastAdmin(orgName), ...where });
      continue;
    }

    // Worse than bricking: losing the last bill-payer means nobody can see or pay the
    // subscription, and the entitlement gate drives the whole org read-only when it lapses.
    // A deletion must not be able to financially suspend a customer.
    if (m.billingAccess) {
      // The SAME count the console doors use (services/memberships/billingGuards.js) — this asks
      // the question in blocker form rather than 409 form, but a second copy of "who is last" is
      // how the two answers drift into disagreeing about the same org.
      const stranded = await wouldStrandBilling({ organizationId: orgId, userId: user._id });
      if (stranded) {
        blockers.push({ code: 'LAST_BILLING_ADMIN', message: copy.lastBilling(orgName), ...where });
      }
    }
  }

  return { user, memberships, blockers };
};

// Other LIVE admins of the org: an active admin membership whose account is live too. The same
// definition billingGuards counts with, so "last admin" and "last billing admin" never disagree.
const activeAdminIds = async (organizationId, excludeUserId) => {
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
};

// ── The org door: what an admin sees before deleting a member ─────────────────────────────────

// What the person did HERE, which decides whether the account was ever used. lastLoginAt only:
// lastSeenAt is super-admin-only by a locked decision.
const usageHere = async (user, organizationId) => {
  const userId = user._id;
  const org = String(organizationId);
  const [knockOrgs, surveyOrgs, fbtimeHours, campaignIds] = await Promise.all([
    // userId-only filters on purpose: an org-scoped probe picks the organizationId index and reads
    // the whole org (reproduced at 100,000 docs). The org is compared in code instead.
    CanvassActivity.distinct('organizationId', { userId, ...NOT_BULK }),
    SurveyResponse.distinct('organizationId', { userId }),
    FbTimeShift.exists({ organizationId, userId }),
    Campaign.find({ organizationId }).distinct('_id'),
  ]);
  const fieldRecordsHere = [...knockOrgs, ...surveyOrgs].some((id) => String(id) === org);
  const crewRows = campaignIds.length
    ? await CampaignAssignment.find({ campaignId: { $in: campaignIds }, coordinatorId: userId })
        .select('userId campaignId')
        .lean()
    : [];
  const crew = {
    people: new Set(crewRows.map((r) => String(r.userId))).size,
    campaigns: new Set(crewRows.map((r) => String(r.campaignId))).size,
  };
  // A coordinator stamped on the ledger keeps a team's name; deleting them must not read as "unused".
  const wasCoordinator =
    crew.people > 0 ||
    Boolean(await CoordinatorChange.exists({ organizationId, fromCoordinatorId: userId })) ||
    Boolean(await CoordinatorChange.exists({ organizationId, toCoordinatorId: userId })) ||
    Boolean(await Membership.exists({ organizationId, coordinatorId: userId }));
  return {
    signedIn: Boolean(user.lastLoginAt),
    fieldRecordsHere,
    fbtimeHours: Boolean(fbtimeHours),
    crew,
    wasCoordinator,
  };
};

// 'unused' removes the person's row and their name; only an account whose clock can be trusted,
// with nothing at all on record here, qualifies.
const kindOf = (user, usage) =>
  user.createdAt &&
  new Date(user.createdAt) >= CLOCKS_RELIABLE_FROM &&
  !usage.signedIn &&
  !usage.fieldRecordsHere &&
  !usage.fbtimeHours &&
  !usage.wasCoordinator
    ? 'unused'
    : 'used';

// What deleting them hands back here, for the review's lines.
const holdingHere = async (userId, organizationId, membership) => {
  const [campaigns, effortCrews, leadGrants, books] = await Promise.all([
    CampaignAssignment.countDocuments({ userId, organizationId }),
    EffortMember.countDocuments({ userId, organizationId }),
    CampaignManager.countDocuments({ userId, organizationId }),
    TurfAssignment.find({ userId, organizationId }).select('turfId passId').lean(),
  ]);
  // Books in an ACTIVE round only — archived rounds hand nothing back anyone would notice.
  const activePasses = books.length
    ? new Set((await Pass.find({ _id: { $in: [...new Set(books.map((b) => String(b.passId)))] }, status: 'active' }).distinct('_id')).map(String))
    : new Set();
  const turfIds = books.filter((b) => activePasses.has(String(b.passId))).map((b) => b.turfId);
  const holders = turfIds.length
    ? await TurfAssignment.aggregate([
        { $match: { turfId: { $in: turfIds } } },
        { $group: { _id: '$turfId', n: { $sum: 1 } } },
      ])
    : [];
  return {
    campaigns,
    books: {
      soleHolder: holders.filter((h) => h.n === 1).length,
      shared: holders.filter((h) => h.n > 1).length,
    },
    effortCrews,
    leadGrants,
    membershipActive: Boolean(membership.isActive),
    retained: { days: RETENTION_DAYS },
  };
};

const reviewBlocker = (code, message) => ({ code, message });

/**
 * The org door's review: one function for the preflight (GET .../deletion-check) and the DELETE, so
 * the screen the admin read and the rule the server enforces are the same code. The checks run in a
 * fixed order and the first refusal ends them; each comes back as a blocker rather than an error.
 * Throws NOT_A_MEMBER (an unknown id answers identically) and ALREADY_DELETED.
 *
 * Returns { blockers, confirmEmail, kind, usage, holding, reason, otherOrganization }.
 */
export const reviewOrgDeletion = async ({ userId, req }) => {
  const organizationId = req.activeOrg._id;
  const [membership, user] = await Promise.all([
    Membership.findOne({ userId, organizationId }).lean(),
    User.findById(userId).lean(),
  ]);
  if (!membership || !user) throw new AccountDeletionError('NOT_A_MEMBER', 'Member not in this org');
  if (user.deletedAt) throw new AccountDeletionError('ALREADY_DELETED', 'This account was already deleted.');

  const usage = await usageHere(user, organizationId);
  const kind = kindOf(user, usage);
  const holding = await holdingHere(user._id, organizationId, membership);
  const review = { blockers: [], confirmEmail: user.email, kind, usage, holding, reason: 'org_admin', otherOrganization: false };
  const refuse = (code, message) => ({ ...review, blockers: [reviewBlocker(code, message)] });

  // Who is asking, resolved in orgContext's own order: a membership, then the internal-org
  // carve-out, then a support grant. Leads never get here (requireAdminRole).
  if (req.user.isSuperAdmin) {
    if (req.activeMembership) {
      if (req.activeMembership.role !== 'admin') {
        return refuse('ADMIN_ONLY', 'Only an admin of this organization can delete an account. Your membership here isn’t an admin one.');
      }
      // A staffer who is this org's own admin is that, nothing more.
    } else if (req.supportGrant) {
      review.reason = 'super_admin';
      // Support tier may clear away an account nobody used; anything with a history needs the
      // authority the platform page needs: deleting one person should not be easier than deleting their org.
      if (req.user.platformRole !== 'break_glass' && kind !== 'unused') {
        return refuse('BREAK_GLASS_REQUIRED', 'This account has been used, so deleting it needs break-glass authority. Support access can delete only accounts nobody used.');
      }
    } else {
      review.reason = 'super_admin'; // an internal org, entered without a membership
    }
  } else if (req.user.deletionLocked) {
    // The store review logins sit in the demo org as admins; a reviewer must not be able to
    // delete the next reviewer's way in, or the disposable account the notes promise them.
    return refuse('REVIEW_LOGIN', 'App-review demo logins can’t delete accounts.');
  }

  if (String(userId) === String(req.user._id)) {
    return refuse('SELF', 'You can’t delete your own account here. To delete it, use Profile → Delete account in the Doorline app.');
  }
  if (user.isSuperAdmin) {
    return refuse('STAFF_ACCOUNT', 'This is a Doorline staff account. It can’t be deleted from an organization.');
  }

  // Any other organization, active or switched off (owner decision 2026-10-24): one org's admin
  // must never delete an account another org still has. Nothing about that org crosses — not its
  // name, its id, or how many there are — so the response carries this blocker and nothing else.
  if (await Membership.exists({ userId, organizationId: { $ne: organizationId } })) {
    return {
      blockers: [
        reviewBlocker(
          'OTHER_ORGANIZATION',
          'This person also belongs to another organization, so their account can’t be deleted from here. Use Remove from org to take them off yours.'
        ),
      ],
      otherOrganization: true,
    };
  }

  // Billing access protects its holder: only an admin who has it (or staff) may delete them.
  if (membership.billingAccess && !req.user.isSuperAdmin && !req.activeMembership?.billingAccess) {
    return refuse('BILLING_TARGET', 'Only an admin with billing access can delete this account.');
  }

  const { blockers } = await checkDeletionBlockers(userId, { subject: 'other', organizationId });
  return { ...review, blockers: blockers.map(({ code, message }) => reviewBlocker(code, message)) };
};

// ── The lock ────────────────────────────────────────────────────────────────────────────────

// Switch back on the memberships an attempt switched off, where they are still off. Used when an
// attempt refuses, errors, or died before the gate (claimed stale, or found by the sweep).
const restoreMemberships = async (ids) => {
  if (!ids?.length) return;
  await Membership.updateMany({ _id: { $in: ids }, isActive: false }, { $set: { isActive: true } });
};

// The account's deletion lock IS its pending name record. Insert it; or claim one that is neither
// finished nor held by a live attempt. A finished record is never claimable: an attempt that read
// the account before another finished must not take over (and then, refusing, delete) the evidence.
// Exported for the race tests, which force exactly that interleaving.
export const claimDeletionLock = async ({ user, pendingToken, reason, deletedBy, unusedOrgId, now }) => {
  const shape = {
    pendingAt: now,
    pendingToken,
    // An unused account's name is never kept: the review told the admin it would be erased.
    firstName: unusedOrgId ? '' : user.firstName,
    lastName: unusedOrgId ? '' : user.lastName,
    reason,
    deletedBy,
    unusedOrgId,
    touchedMemberships: [],
    organizationIds: [],
    deletedAt: now,
    retentionUntil: new Date(now.getTime() + RETENTION_DAYS * DAY_MS),
    purgedAt: null,
    finishedAt: null,
  };
  // Equality on the unique key, so a concurrent insert is retried by the server as an update rather
  // than surfacing E11000; the loser then finds a live lock below.
  const inserted = await DeletedUserRecord.updateOne(
    { userId: user._id },
    { $setOnInsert: { userId: user._id, ...shape } },
    { upsert: true }
  );
  if (inserted.upsertedCount === 1) return;

  // A legacy record on a live account, or an attempt that crashed more than ten minutes ago. The
  // takeover KEEPS the crashed attempt's touchedMemberships: if this process dies before switching
  // them back on, the sweep still has the list (this attempt's own rows join it with $addToSet).
  const stale = new Date(now.getTime() - LOCK_STALE_MS);
  const { touchedMemberships: _fresh, ...takeover } = shape;
  const prior = await DeletedUserRecord.findOneAndUpdate(
    { userId: user._id, finishedAt: null, $or: [{ pendingAt: null }, { pendingAt: { $lt: stale } }] },
    { $set: takeover, $unset: { email: 1, phone: 1 } },
    { new: false }
  ).lean();
  if (prior) {
    // A crashed attempt may have left memberships switched off; this attempt starts from scratch.
    await restoreMemberships(prior.touchedMemberships);
    return;
  }
  const existing = await DeletedUserRecord.findOne({ userId: user._id }).select('finishedAt').lean();
  if (existing?.finishedAt) throw new AccountDeletionError('ALREADY_DELETED', 'This account is already deleted');
  throw new AccountDeletionError('DELETION_IN_PROGRESS', DELETION_IN_PROGRESS_MESSAGE);
};

// Only ever removes a lock this attempt holds (a finished record can't be claimed, so it can't be ours).
const releaseLock = (userId, pendingToken) => DeletedUserRecord.deleteOne({ userId, pendingToken });

// The scrub. Everything that identifies the person goes; the row survives so the ledger stays keyed.
const scrubFields = (userId, passwordHash, now) => ({
  firstName: 'Deleted',
  lastName: 'user',
  email: tombstoneEmail(userId),
  phone: null,
  passwordHash,
  isActive: false,
  deletedAt: now,
  mustChangePassword: false,
  tempPasswordSetAt: null,
  passwordResetToken: null,
  passwordResetExpiresAt: null,
  // Both activity clocks go too. The tombstone exists so the org's field records stay
  // attributable to a stable id — "when was this person last online" contributes nothing to
  // that and everything to a re-identification hint about someone who asked to be forgotten.
  // lastLoginAt USED to survive here; scrubbing it changes previously documented behavior —
  // see the v4 stamps in docs/PRIVACY_VERIFICATION.md.
  lastLoginAt: null,
  lastSeenAt: null,
  // Ended session ids carry nothing about the person, but they are account data with no
  // purpose once the account is gone (requireAuth refuses a deleted account first anyway).
  endedSessionIds: [],
});

/**
 * Delete the account. Scrubs the identity, keeps the name for the retention window so the orgs can
 * still attribute past field work, releases every piece of work the person was holding, and shuts
 * the login permanently.
 *
 * Deliberately leaves CanvassActivity / SurveyResponse / FlagReview / HouseholdLocationChange
 * untouched: those are the organization's field records, not the user's personal content, and
 * removing them would silently rewrite campaign counts and invoices. Both stores allow this
 * retention; both require it be disclosed, which the deletion sheet and privacy policy do.
 *
 * `org` is the org door: { organizationId, unused }. Its review already ran in the route (it IS
 * step 1 there), so `reviewed` skips the generic blockers; the recount in step 4 still re-asks the
 * questions a race could change.
 */
export const deleteAccount = async (userId, { reason = 'self', deletedBy = null, org = null, reviewed = false } = {}) => {
  // 1. Blockers.
  let user;
  if (reviewed) {
    user = await User.findById(userId).lean();
    if (!user) throw new AccountDeletionError('NOT_FOUND', 'User not found');
    if (user.deletedAt) throw new AccountDeletionError('ALREADY_DELETED', 'This account is already deleted');
  } else {
    const checked = await checkDeletionBlockers(userId, { subject: reason === 'self' ? 'self' : 'other' });
    if (checked.blockers.length > 0) {
      throw new AccountDeletionError('BLOCKED', 'This account cannot be deleted yet.', { blockers: checked.blockers });
    }
    user = checked.user.toObject();
  }

  // 2. The lock.
  const now = new Date();
  const pendingToken = crypto.randomUUID();
  const unused = Boolean(org?.unused);
  await claimDeletionLock({
    user,
    pendingToken,
    reason,
    deletedBy,
    unusedOrgId: unused ? org.organizationId : null,
    now,
  });

  const touched = []; // pre-images of the memberships this attempt switched off
  // Re-read FIRST. An account that is dead after all (a gate write that landed though its call
  // failed) must never get its memberships back or its lock freed — that strands a half-finished
  // deletion nothing can find. Finish it; if that fails too, the pending record stays for the sweep.
  // If even the re-read fails, this throws before touching anything, and the sweep decides later.
  const undo = async () => {
    const after = await User.findById(user._id).select('deletedAt').lean();
    if (!after || after.deletedAt) {
      await finishDeletion(user._id, { reason, deletedBy }).catch(() => {});
      return;
    }
    await restoreMemberships(touched.map((m) => m._id));
    await releaseLock(user._id, pendingToken);
  };

  let preImage;
  try {
    // 3. The burned hash, before anything is switched off.
    const passwordHash = await unusablePasswordHash();

    // 4. Memberships off, one row at a time, each recorded on the lock FIRST so a crash after the
    //    write still leaves the sweep the list it needs to switch it back on.
    const live = await Membership.find({ userId: user._id, isActive: true }).select('_id').lean();
    for (const { _id } of live) {
      await DeletedUserRecord.updateOne({ userId: user._id, pendingToken }, { $addToSet: { touchedMemberships: _id } });
      const pre = await Membership.findOneAndUpdate({ _id, isActive: true }, { $set: { isActive: false } }, { new: false }).lean();
      if (pre) touched.push(pre);
      else await DeletedUserRecord.updateOne({ userId: user._id, pendingToken }, { $pull: { touchedMemberships: _id } });
    }

    // The org door first re-asks its one cross-org question: a membership elsewhere that appeared
    // since the review (a link racing this deletion) refuses it — and ALONE, before any recount, so
    // nothing about that other org's admins can cross (the review's own rule).
    let refusals = [];
    if (org && (await Membership.exists({ userId: user._id, organizationId: { $ne: org.organizationId } }))) {
      refusals = [
        {
          code: 'OTHER_ORGANIZATION',
          message: 'This person also belongs to another organization, so their account can’t be deleted from here. Use Remove from org to take them off yours.',
        },
      ];
    } else {
      // The recount, per org this attempt touched: live admins and live billing admins left. Two
      // admins deleting each other both see zero and both refuse — over-refusal, never a stranded org.
      const byOrg = new Map();
      for (const m of touched) {
        const k = String(m.organizationId);
        if (!byOrg.has(k)) byOrg.set(k, []);
        byOrg.get(k).push(m);
      }
      for (const [orgId, rows] of byOrg) {
        if (rows.some((m) => m.role === 'admin') && (await countLiveAdmins(orgId)) === 0) {
          refusals.push({ code: 'LAST_ADMIN', message: org ? blockerCopy.org.lastAdmin() : 'This would leave an organization with no admin. Make someone else an admin first.' });
        } else if (rows.some((m) => m.role === 'admin' && m.billingAccess) && (await countLiveBillingAdmins(orgId)) === 0) {
          refusals.push({ code: 'LAST_BILLING_ADMIN', message: org ? blockerCopy.org.lastBilling() : 'This would leave an organization with no admin who can manage billing. Give billing access to another admin first.' });
        }
      }
    }
    if (refusals.length) {
      await undo();
      throw new AccountDeletionError('BLOCKED', 'This account cannot be deleted yet.', { blockers: refusals });
    }

    // 5. THE GATE. One conditional write; an unused-account deletion also requires that they still
    //    never signed in (a support-tier delete may not race a first sign-in into a used account).
    let passedOnError = false;
    try {
      preImage = await User.findOneAndUpdate(
        { _id: user._id, deletedAt: null, ...(unused ? { lastLoginAt: null } : {}) },
        { $set: scrubFields(user._id, passwordHash, now) },
        { new: false }
      ).lean();
    } catch (err) {
      // We can't tell whether a failed gate write landed. If it did, the account is dead: finish it
      // below with the name the lock captured. If not, the outer catch gives the memberships back.
      const after = await User.findById(user._id).select('deletedAt').lean();
      if (!after?.deletedAt) throw err;
      passedOnError = true;
    }
    if (!preImage && !passedOnError) {
      const after = await User.findById(user._id).select('deletedAt').lean();
      if (!after || after.deletedAt) {
        // Deleted by something that did not hold this lock. Leave the record: the sweep finishes it.
        throw new AccountDeletionError('ALREADY_DELETED', 'This account is already deleted');
      }
      await undo();
      throw new AccountDeletionError(
        'USAGE_CHANGED',
        'This person just signed in, so their account now counts as used. Review it again before deleting.'
      );
    }
  } catch (err) {
    // Refusals above already undid their own work. Anything else (the gate never landed): undo, so a
    // transient error doesn't leave the person switched off or the account locked for ten minutes.
    if (err instanceof AccountDeletionError) throw err;
    await undo().catch(() => {});
    throw err;
  }

  // 6-11. After the gate.
  return finishDeletion(user._id, { preImage, reason, deletedBy });
};

/**
 * Everything after the gate, idempotent: the attempt runs it, and the sweep runs it again for one
 * that crashed. Keyed by userId; it reads what it needs (the lock's unusedOrgId) from the record.
 */
export const finishDeletion = async (userId, { preImage = null, reason = 'self', deletedBy = null } = {}) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const [user, record] = await Promise.all([
    User.findById(id).select('deletedAt').lean(),
    DeletedUserRecord.findOne({ userId: id }).lean(),
  ]);
  const deletedAt = user?.deletedAt || new Date();

  // 6. Every org that may need to attribute this person's work: any membership, in any status,
  //    plus the orgs of their own ledger rows (desk marks excluded — their userId is whoever pressed
  //    the button), plus the orgs holding an automatic pause about them — a canvasser whose doors were
  //    all unknocked and whose membership was removed still has their pauses attributed
  //    (docs/PROPOSAL_PACE_PAUSE.md §D.4). userId-only filters, so no index hint is needed.
  const [memberOrgs, knockOrgs, surveyOrgs, pauseOrgs] = await Promise.all([
    Membership.distinct('organizationId', { userId: id }),
    CanvassActivity.aggregate([{ $match: { userId: id, ...NOT_BULK } }, { $group: { _id: '$organizationId' } }]),
    SurveyResponse.aggregate([{ $match: { userId: id } }, { $group: { _id: '$organizationId' } }]),
    PacePause.distinct('organizationId', { userId: id }),
  ]);
  const organizationIds = [
    ...new Map(
      [...memberOrgs, ...knockOrgs.map((r) => r._id), ...surveyOrgs.map((r) => r._id), ...pauseOrgs]
        .filter(Boolean)
        .map((o) => [String(o), o])
    ).values(),
  ];

  // 7. Memberships go inactive rather than away: reports.js counts team members straight off
  //    Membership with no join to User. Billing access goes too, so a tombstone row never reads as
  //    a bill-payer and anyone can tidy it away. This also catches a reactivation that slipped in.
  //    An unused account's row in the deleting org is removed outright: nothing there names them.
  await Membership.updateMany({ userId: id }, { $set: { isActive: false, billingAccess: false } });
  if (record?.unusedOrgId) await Membership.deleteMany({ userId: id, organizationId: record.unusedOrgId });

  // 8. Release every piece of work the person was holding, so no book, effort or campaign is
  //    left assigned to a ghost.
  const released = await releaseAssignedWork(id);

  // 9. The FbTime link (one per org that connected FbTime) holds the FbTime person's email,
  //    which for the same human is this person's email: it goes now, with the account's own
  //    ("removed immediately"). The link itself stays until the purge — it is what keeps the
  //    person's measured hours theirs, and an admin's "was the link right?" needs it.
  await FbTimePersonLink.updateMany({ userId: id }, { $set: { fbtimeEmail: null } });

  // 10. The send log of this account's own mail.
  await scrubAccountEmailLog(id);

  // 11. The finished record. The name: the pre-image's when this run did the scrub; blank for an
  //     unused account; otherwise whatever the lock claim captured. Attribution was written by the
  //     claim; $setOnInsert covers a record that vanished, so it can never come back as `self`
  //     for a deletion somebody else ordered.
  const name = record?.unusedOrgId
    ? { firstName: '', lastName: '' }
    : preImage
      ? { firstName: preImage.firstName || '', lastName: preImage.lastName || '' }
      : {};
  const retentionUntil = new Date(new Date(deletedAt).getTime() + RETENTION_DAYS * DAY_MS);
  await DeletedUserRecord.updateOne(
    { userId: id },
    {
      $set: { finishedAt: new Date(), ...name, organizationIds, deletedAt, retentionUntil, purgedAt: null },
      $setOnInsert: { reason, deletedBy },
      $unset: { email: 1, phone: 1, pendingAt: 1, pendingToken: 1, unusedOrgId: 1, touchedMemberships: 1 },
    },
    { upsert: true }
  );

  return { deletedAt, retentionUntil, organizationIds, released };
};

// The send log keeps one row per email; a person's OWN mail (invites, resets, added-to notices)
// carries their userId and only their address. Those rows lose the address and any bounce text.
// Decided 2026-10-24: by account only, never by address — addresses get reused (re-added after a
// deletion, an email fix), so matching by address rewrote other people's rows. Deletion-warning and
// support-grant notice rows carry no userId and keep their recipients: they are the evidence that
// the notices went out.
//
// Never without a valid id: an undefined filter value matches `userId: null` — exactly the warning and
// notice rows that must keep their recipients — and that rewrite could never be undone. `since` bounds
// the sweep's re-scrub to recent rows through the sentAt index (EmailLog has no userId index; the full
// scrub at deletion reads the collection once).
export const scrubAccountEmailLog = async (userId, { since = null } = {}) => {
  if (!userId || !mongoose.isValidObjectId(userId)) return 0;
  const r = await EmailLog.updateMany(
    { userId, ...(since ? { sentAt: { $gte: since } } : {}) },
    { $set: { to: [tombstoneEmail(userId)], error: null, deliveryDetail: null } }
  );
  return r.modifiedCount || 0;
};

// ── The sweep ───────────────────────────────────────────────────────────────────────────────
// Every 15 minutes (scheduler.js, MAINTENANCE_JOBS) and again before the nightly purge. "Deleted"
// means deletedAt is set OR there is no User document at all (purge fixtures make records without
// one, and nothing hard-deletes users). With apply: false it only counts.
//
// A record without a valid userId is malformed: it is counted as a failure (so retention health
// shows it) and never acted on — above all never handed to the email scrub, where an undefined id
// would match every row that has no userId.
const validId = (id) => Boolean(id) && mongoose.isValidObjectId(id);

// How far before a deletion the re-scrub looks: mail sent just before the scrub can be logged
// just after it (mailer.js writes the row after the provider call).
const LATE_MAIL_MARGIN_MS = 60 * 60 * 1000;

export const sweepDeletionLocks = async ({ apply = true, now = new Date() } = {}) => {
  const counts = { finished: 0, released: 0, liveRecordsDeleted: 0, legacyFinished: 0, rescrubbed: 0, failed: 0 };
  const stale = new Date(now.getTime() - LOCK_STALE_MS);

  const pending = await DeletedUserRecord.find({ finishedAt: null, pendingAt: { $ne: null, $lt: stale } })
    .select('userId pendingToken touchedMemberships reason deletedBy')
    .lean();
  for (const rec of pending) {
    try {
      if (!validId(rec.userId)) {
        counts.failed += 1;
        console.error('[deletion-sweep] pending record without a valid userId', String(rec._id));
        continue;
      }
      const user = await User.findById(rec.userId).select('deletedAt').lean();
      const dead = !user || Boolean(user.deletedAt);
      if (!apply) {
        counts[dead ? 'finished' : 'released'] += 1;
        continue;
      }
      // Take the lock before acting on it. A fresh attempt may have claimed this stale record since it
      // was read; acting on the old snapshot would switch a now-deleted account's memberships back on,
      // or a pair of admins' — and strand their org. If the token moved, it isn't ours to settle.
      const sweepToken = `sweep-${crypto.randomUUID()}`;
      const held = await DeletedUserRecord.findOneAndUpdate(
        { _id: rec._id, pendingToken: rec.pendingToken, finishedAt: null },
        { $set: { pendingToken: sweepToken, pendingAt: now } },
        { new: true }
      ).lean();
      if (!held) continue;
      const after = await User.findById(rec.userId).select('deletedAt').lean();
      if (!after || after.deletedAt) {
        await finishDeletion(rec.userId, { reason: held.reason, deletedBy: held.deletedBy });
        counts.finished += 1;
      } else {
        // The attempt died before the gate: switch back on what it switched off, then free the lock.
        await restoreMemberships(held.touchedMemberships);
        await releaseLock(rec.userId, sweepToken);
        counts.released += 1;
      }
    } catch (err) {
      counts.failed += 1;
      console.error('[deletion-sweep] pending record', String(rec._id), err?.message || err);
    }
  }

  // Records that are neither pending nor finished predate the lock. On a deleted account that is a
  // finished deletion: stamp it so, which also makes it unclaimable for good. On a live account it is
  // an anomaly (an old crash between the record and the scrub): delete it, conditioned so it can't
  // remove a lock an attempt claims at the same moment.
  const legacy = await DeletedUserRecord.find({ finishedAt: null, pendingAt: null })
    .select('userId deletedAt')
    .lean();
  const legacyIds = legacy.map((r) => r.userId).filter(validId);
  const legacyUsers = legacyIds.length
    ? new Map((await User.find({ _id: { $in: legacyIds } }).select('deletedAt').lean()).map((u) => [String(u._id), u]))
    : new Map();
  for (const rec of legacy) {
    try {
      if (!validId(rec.userId)) {
        counts.failed += 1;
        console.error('[deletion-sweep] record without a valid userId', String(rec._id));
        continue;
      }
      const u = legacyUsers.get(String(rec.userId));
      if (!u || u.deletedAt) {
        if (apply) {
          // The record's own deletedAt when it is a real date; a malformed one is the purge's to report.
          const at = rec.deletedAt instanceof Date && !Number.isNaN(rec.deletedAt.getTime()) ? rec.deletedAt : now;
          await DeletedUserRecord.updateOne(
            { _id: rec._id, finishedAt: null, pendingAt: null },
            { $set: { finishedAt: at } }
          );
        }
        counts.legacyFinished += 1;
        continue;
      }
      if (apply) {
        const r = await DeletedUserRecord.deleteOne({ _id: rec._id, pendingAt: null, finishedAt: null });
        counts.liveRecordsDeleted += r.deletedCount || 0;
      } else {
        counts.liveRecordsDeleted += 1;
      }
    } catch (err) {
      counts.failed += 1;
      console.error('[deletion-sweep] live record', String(rec._id), err?.message || err);
    }
  }

  // Mail logged late, re-scrubbed for a week: read from the (small) name records rather than scanning
  // every user, and bounded to rows sent from just before each deletion (the sentAt index).
  const recent = await DeletedUserRecord.find({
    finishedAt: { $ne: null },
    deletedAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) },
  })
    .select('userId deletedAt')
    .lean();
  for (const { userId, deletedAt } of recent) {
    if (!validId(userId)) continue; // the legacy pass above already counted it
    try {
      const since = new Date(new Date(deletedAt).getTime() - LATE_MAIL_MARGIN_MS);
      counts.rescrubbed += apply
        ? await scrubAccountEmailLog(userId, { since })
        : await EmailLog.countDocuments({ userId, sentAt: { $gte: since }, to: { $ne: [tombstoneEmail(userId)] } });
    } catch (err) {
      counts.failed += 1;
      console.error('[deletion-sweep] email log', String(userId), err?.message || err);
    }
  }
  return counts;
};

// Put back what a write did for an account that was deleted while the write was in flight. The
// eleven writers that can land on an account mid-deletion (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md
// §C3) call this AFTER their last write. Converge, never restore a snapshot: restoring the pre-write
// state brought back exactly the active admin and billing flag the deletion had just removed.
// Returns true when the account was deleted (the caller then answers 409 ACCOUNT_DELETED).
export const convergeIfDeleted = async ({ userId, organizationId, membershipId = null, campaignId = null }) => {
  const user = await User.findById(userId).select('deletedAt').lean();
  if (!user?.deletedAt) return false;
  await Promise.all([
    membershipId
      ? Membership.updateOne({ _id: membershipId }, { $set: { isActive: false, billingAccess: false } })
      : Membership.updateMany({ userId, organizationId }, { $set: { isActive: false, billingAccess: false } }),
    CampaignManager.deleteMany({ userId, organizationId }),
    campaignId ? CampaignAssignment.deleteMany({ userId, campaignId }) : null,
  ]);
  return true;
};

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
  // A coordinator who leaves must not keep supervising anybody — their crew's roster rows are
  // cleared so the NEXT knock stamps no team rather than a departed one.
  //
  // The LEDGER is deliberately untouched: the doors that crew already knocked keep the departed
  // coordinator's stamp, which is what keeps their team whole. Re-stamping here would dump the
  // whole history into the "No team" bucket admins exclude — the original 104-door under-report.
  // That asymmetry is the entire reason this write does not go through setMemberCoordinator.
  //
  // Runs in EVERY scope now, campaign included, because the crew lives on the campaign roster:
  // clearing it for one campaign severs supervision in that campaign only, which is exactly right.
  // (It was org/global-only when a crew was one org-wide field and clearing it in campaign scope
  // would have broken a link that had nothing to do with this campaign.)
  await CampaignAssignment.updateMany(
    { coordinatorId: userId, ...scope },
    { $set: { coordinatorId: null } }
  );

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
