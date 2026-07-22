import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SupportAccessGrant } from '../../models/SupportAccessGrant.js';
import { AccessLog } from '../../models/AccessLog.js';
import { DeletedUserRecord } from '../../models/DeletedUserRecord.js';
import { NOT_BULK } from '../reports/aggregations.js';

/**
 * Super-admin per-user oversight view — the composite behind GET /super-admin/users/:userId.
 *
 * PURE METADATA, deliberately: accounts, memberships, structural activity counts, and (for staff)
 * their own access history. It never reads voter content — no answers, no notes, no addresses — so
 * it needs no support grant and writes no AccessLog row. That is the exact line models/User.js
 * draws for the support tier ("sees the platform METADATA dashboard freely; reaches VOTER CONTENT
 * only through a SupportAccessGrant").
 *
 * Memberships are returned INCLUDING deactivated ones (isActive:false) — the platform list route
 * hard-filters those out, which made a person's past org relationships invisible from every
 * platform surface. Genuinely REMOVED memberships cannot appear: removal hard-deletes the row.
 *
 * The DeletedUserRecord block is STATUS ONLY (dates + org count). The tombstone's name content is
 * read elsewhere under org-scoped, purge-aware guards (resolveDeletedIdentities) for report
 * attribution; re-revealing it platform-wide here would sidestep those guards, so we don't.
 *
 * Returns null if the user doesn't exist.
 */
export async function buildUserOversight(userId) {
  const user = await User.findById(userId).lean();
  if (!user) return null;

  const [memberships, activityAgg, surveyAgg, deletedRecord] = await Promise.all([
    Membership.find({ userId: user._id })
      .populate({ path: 'organizationId', select: 'name slug isActive' })
      .populate({ path: 'coordinatorId', select: 'firstName lastName' })
      .sort({ createdAt: 1 })
      .lean(),
    // RAW field records per org (one row per action, matching the platform lifetime unit — NOT
    // billable knocks, which collapse to distinct household×pass). Structural counts only.
    CanvassActivity.aggregate([
      { $match: { userId: user._id, ...NOT_BULK } },
      {
        $group: {
          _id: '$organizationId',
          fieldRecords: { $sum: 1 },
          firstAt: { $min: '$timestamp' },
          lastAt: { $max: '$timestamp' },
        },
      },
    ]),
    SurveyResponse.aggregate([
      { $match: { userId: user._id } },
      { $group: { _id: '$organizationId', surveys: { $sum: 1 } } },
    ]),
    DeletedUserRecord.findOne({ userId: user._id }, 'deletedAt retentionUntil purgedAt organizationIds').lean(),
  ]);

  const activityByOrg = new Map(activityAgg.map((a) => [String(a._id), a]));
  const surveysByOrg = new Map(surveyAgg.map((s) => [String(s._id), s.surveys]));

  const membershipRows = memberships
    .filter((m) => m.organizationId) // org hard-deleted → nothing to show
    .map((m) => {
      const orgId = String(m.organizationId._id);
      const act = activityByOrg.get(orgId);
      return {
        organizationId: orgId,
        organizationName: m.organizationId.name,
        organizationActive: m.organizationId.isActive,
        role: m.role,
        isActive: m.isActive,
        billingAccess: !!m.billingAccess,
        coordinator: m.coordinatorId
          ? `${m.coordinatorId.firstName || ''} ${m.coordinatorId.lastName || ''}`.trim() || null
          : null,
        acknowledgedAt: m.acknowledgedAt || null,
        joinedAt: m.createdAt || null,
        fieldRecords: act?.fieldRecords || 0,
        surveys: surveysByOrg.get(orgId) || 0,
        firstActivityAt: act?.firstAt || null,
        lastActivityAt: act?.lastAt || null,
      };
    });

  // Staff history — only meaningful (and only computed) for super-admin accounts: every grant they
  // ever held, including expired/revoked (the live-grants route can't show history), and their
  // access-log footprint per org. Index-backed by {actorUserId:1, at:-1}.
  let staff = null;
  if (user.isSuperAdmin) {
    const [grants, accessAgg] = await Promise.all([
      SupportAccessGrant.find({ actorUserId: user._id })
        .populate({ path: 'organizationId', select: 'name' })
        .sort({ grantedAt: -1 })
        .limit(50)
        .lean(),
      AccessLog.aggregate([
        { $match: { actorUserId: user._id } },
        {
          $group: {
            _id: '$organizationId',
            requests: { $sum: 1 },
            rows: { $sum: { $ifNull: ['$rows', 0] } },
            bytes: { $sum: { $ifNull: ['$bytes', 0] } },
            lastAt: { $max: '$at' },
          },
        },
      ]),
    ]);
    const orgNames = new Map(
      grants.filter((g) => g.organizationId).map((g) => [String(g.organizationId._id), g.organizationId.name])
    );
    staff = {
      grants: grants.map((g) => ({
        id: String(g._id),
        organizationName: g.organizationId?.name || 'deleted org',
        reason: g.reason,
        kind: g.kind,
        grantedAt: g.grantedAt,
        expiresAt: g.expiresAt,
        revokedAt: g.revokedAt || null,
        accessCount: g.accessCount || 0,
      })),
      accessByOrg: accessAgg.map((a) => ({
        organizationName: orgNames.get(String(a._id)) || 'unknown org',
        requests: a.requests,
        rows: a.rows,
        bytes: a.bytes,
        lastAt: a.lastAt,
      })),
    };
  }

  return {
    user: {
      id: String(user._id),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone || null,
      isSuperAdmin: !!user.isSuperAdmin,
      platformRole: user.isSuperAdmin ? user.platformRole || 'support' : null,
      isActive: user.isActive,
      deletedAt: user.deletedAt || null,
      deletionLocked: !!user.deletionLocked,
      mustChangePassword: !!user.mustChangePassword,
      tempPasswordSetAt: user.tempPasswordSetAt || null,
      lastLoginAt: user.lastLoginAt || null,
      lastSeenAt: user.lastSeenAt || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    memberships: membershipRows,
    staff,
    // Status only — dates + how many orgs the tombstone serves. Never the snapshot's name content.
    deletedRecord: deletedRecord
      ? {
        deletedAt: deletedRecord.deletedAt,
        retentionUntil: deletedRecord.retentionUntil,
        purgedAt: deletedRecord.purgedAt || null,
        organizationCount: (deletedRecord.organizationIds || []).length,
      }
      : null,
  };
}
