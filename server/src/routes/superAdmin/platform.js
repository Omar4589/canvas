import { Router } from 'express';
import { Organization } from '../../models/Organization.js';
import { Membership } from '../../models/Membership.js';
import { User } from '../../models/User.js';
import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ACTION_DOOR = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped'];

function startOfTodayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

router.get('/platform-overview', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - FIFTEEN_MIN_MS);
    const todayStart = startOfTodayUTC();

    const [
      orgsAgg,
      usersAgg,
      activeNowIds,
      campaignsAgg,
      todayAgg,
      orgs,
      memberByOrg,
      campaignsByOrg,
      activeNowByOrg,
      lastActivityByOrg,
    ] = await Promise.all([
      Organization.aggregate([
        { $group: { _id: '$isActive', count: { $sum: 1 } } },
      ]),
      User.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            superAdmins: { $sum: { $cond: ['$isSuperAdmin', 1, 0] } },
          },
        },
      ]),
      CanvassActivity.distinct('userId', { timestamp: { $gte: since } }),
      Campaign.aggregate([
        { $group: { _id: '$isActive', count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: { timestamp: { $gte: todayStart } } },
        { $group: { _id: '$actionType', count: { $sum: 1 } } },
      ]),
      Organization.find().sort({ createdAt: -1 }).lean(),
      Membership.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$organizationId', count: { $sum: 1 } } },
      ]),
      Campaign.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$organizationId', count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: { org: '$organizationId', user: '$userId' } } },
        { $group: { _id: '$_id.org', count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $group: { _id: '$organizationId', last: { $max: '$timestamp' } } },
      ]),
    ]);

    let orgsActive = 0;
    let orgsInactive = 0;
    for (const r of orgsAgg) {
      if (r._id) orgsActive += r.count;
      else orgsInactive += r.count;
    }

    let campaignsActive = 0;
    let campaignsTotal = 0;
    for (const r of campaignsAgg) {
      campaignsTotal += r.count;
      if (r._id) campaignsActive += r.count;
    }

    const todayCounts = { doorsKnocked: 0, surveysSubmitted: 0, litDropped: 0 };
    for (const r of todayAgg) {
      if (ACTION_DOOR.includes(r._id)) todayCounts.doorsKnocked += r.count;
      if (r._id === 'survey_submitted') todayCounts.surveysSubmitted = r.count;
      if (r._id === 'lit_dropped') todayCounts.litDropped = r.count;
    }

    const memberMap = new Map(memberByOrg.map((r) => [String(r._id), r.count]));
    const campaignMap = new Map(campaignsByOrg.map((r) => [String(r._id), r.count]));
    const activeNowMap = new Map(activeNowByOrg.map((r) => [String(r._id), r.count]));
    const lastMap = new Map(lastActivityByOrg.map((r) => [String(r._id), r.last]));

    const usersTotals = usersAgg[0] || { total: 0, active: 0, superAdmins: 0 };

    res.json({
      totals: {
        orgs: {
          total: orgsActive + orgsInactive,
          active: orgsActive,
          inactive: orgsInactive,
        },
        users: {
          total: usersTotals.total,
          active: usersTotals.active,
          superAdmins: usersTotals.superAdmins,
        },
        activeNow: { count: activeNowIds.length, threshold: '15m' },
        campaigns: { total: campaignsTotal, active: campaignsActive },
        today: todayCounts,
      },
      organizations: orgs.map((o) => ({
        id: String(o._id),
        name: o.name,
        slug: o.slug,
        isActive: o.isActive,
        memberCount: memberMap.get(String(o._id)) || 0,
        campaignCount: campaignMap.get(String(o._id)) || 0,
        activeNowCount: activeNowMap.get(String(o._id)) || 0,
        lastActivityAt: lastMap.get(String(o._id)) || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/activity-feed', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const filter = { actionType: { $in: ACTION_DOOR } };
    if (req.query.since) {
      const sinceMs = Date.parse(req.query.since);
      if (Number.isFinite(sinceMs)) filter.timestamp = { $gt: new Date(sinceMs) };
    }

    const events = await CanvassActivity.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('userId', 'firstName lastName email')
      .populate('campaignId', 'name')
      .populate('householdId', 'addressLine1 city state')
      .populate('organizationId', 'name')
      .lean();

    res.json({
      events: events.map((e) => ({
        id: String(e._id),
        actionType: e.actionType,
        timestamp: e.timestamp,
        organization: e.organizationId
          ? { id: String(e.organizationId._id), name: e.organizationId.name }
          : null,
        canvasser: e.userId
          ? {
              id: String(e.userId._id),
              firstName: e.userId.firstName,
              lastName: e.userId.lastName,
            }
          : null,
        campaign: e.campaignId
          ? { id: String(e.campaignId._id), name: e.campaignId.name }
          : null,
        household: e.householdId
          ? {
              id: String(e.householdId._id),
              addressLine1: e.householdId.addressLine1,
              city: e.householdId.city,
              state: e.householdId.state,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
