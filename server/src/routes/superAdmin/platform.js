import { Router } from 'express';
import { Organization } from '../../models/Organization.js';
import { Membership } from '../../models/Membership.js';
import { User } from '../../models/User.js';
import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Subscription } from '../../models/Subscription.js';
import { entitlementFor } from '../../services/billing/entitlement.js';
import { seedDemoOrg } from '../../services/platform/seedDemoOrg.js';
import { requireAuth, requireSuperAdmin, requireBreakGlass } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
// Every door-level knock the platform counts + feeds. `refused` is a first-class,
// billable knock (a person answered but declined) — include it so the Control Room
// "Today" doorsKnocked and the cross-org activity feed don't undercount it.
const ACTION_DOOR = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped'];

function startOfTodayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

router.get('/platform-overview', async (req, res, next) => {
  try {
    const since = new Date(Date.now() - FIFTEEN_MIN_MS);
    const todayStart = startOfTodayUTC();

    // Platform-wide "active" filter: only count activity tied to active campaigns,
    // matching the campaign COUNT aggregation which already filters isActive:true.
    const activeCampaignIds = await Campaign.distinct('_id', { isActive: true });

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
      CanvassActivity.distinct('userId', {
        timestamp: { $gte: since },
        campaignId: { $in: activeCampaignIds },
        via: { $ne: 'bulk' }, // an admin's bulk mark isn't field activity
      }),
      Campaign.aggregate([
        { $group: { _id: '$isActive', count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: { timestamp: { $gte: todayStart }, campaignId: { $in: activeCampaignIds } } },
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
        // via ≠ bulk on active-now/last-activity: admin bulk marks aren't field
        // pulse. todayCounts above deliberately stays inclusive — "N doors
        // restricted today" is a truthful org-scope tally either way.
        { $match: { timestamp: { $gte: since }, campaignId: { $in: activeCampaignIds }, via: { $ne: 'bulk' } } },
        { $group: { _id: { org: '$organizationId', user: '$userId' } } },
        { $group: { _id: '$_id.org', count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: { campaignId: { $in: activeCampaignIds }, via: { $ne: 'bulk' } } },
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

    const todayCounts = { doorsKnocked: 0, surveysSubmitted: 0, litDropped: 0, restricted: 0 };
    for (const r of todayAgg) {
      if (ACTION_DOOR.includes(r._id)) todayCounts.doorsKnocked += r.count;
      if (r._id === 'survey_submitted') todayCounts.surveysSubmitted = r.count;
      if (r._id === 'lit_dropped') todayCounts.litDropped = r.count;
      if (r._id === 'restricted') todayCounts.restricted = r.count; // marker, not in doorsKnocked
    }

    const memberMap = new Map(memberByOrg.map((r) => [String(r._id), r.count]));
    const campaignMap = new Map(campaignsByOrg.map((r) => [String(r._id), r.count]));
    const activeNowMap = new Map(activeNowByOrg.map((r) => [String(r._id), r.count]));
    const lastMap = new Map(lastActivityByOrg.map((r) => [String(r._id), r.last]));

    const usersTotals = usersAgg[0] || { total: 0, active: 0, superAdmins: 0 };

    // Billing pill + "needs attention" data for the Control Room org cards.
    const subs = await Subscription.find({}, null).lean();
    const subMap = new Map(subs.map((s) => [String(s.organizationId), s]));

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
      organizations: orgs.map((o) => {
        const sub = subMap.get(String(o._id)) || null;
        const ent = entitlementFor(sub);
        return {
          id: String(o._id),
          name: o.name,
          slug: o.slug,
          isActive: o.isActive,
          isInternal: !!o.isInternal,
          memberCount: memberMap.get(String(o._id)) || 0,
          campaignCount: campaignMap.get(String(o._id)) || 0,
          activeNowCount: activeNowMap.get(String(o._id)) || 0,
          lastActivityAt: lastMap.get(String(o._id)) || null,
          billing: {
            status: sub?.status ?? null,
            effective: ent.effective,
            trialEndsAt: sub?.trialEndsAt ?? null,
            trialDaysLeft: ent.trialDaysLeft,
          },
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Rebuild the demo org from the SEED — the same engine as `npm run seed:demo -- --reset
// --apply`, which is the only path that actually heals drifted book assignments (it does a
// clean deleteMany + insertMany per round) and the only one that recreates a review account a
// store reviewer deleted. The old activity-only refresh service is gone; it resolved each book
// to a single owner through a lossy Map over a MANY-TO-MANY table, so one extra assignment row
// on the review account silently re-attributed every field canvasser's knocks to it.
//
// Locked to the demo org by slug inside the engine — it can never touch a real org — and the
// three destructive doors are nailed shut here rather than in the engine, so the CLI keeps them.
let demoRebuildRunning = false;

router.post('/demo/refresh-day', requireBreakGlass, async (req, res, next) => {
  // A bodyless POST is a browser tab left open across this deploy: the old bundle fired this
  // URL with no body for the far gentler activity-only refresh. Refuse it rather than hand a
  // stale client the more destructive operation it never asked for.
  if (req.body?.confirm !== 'rebuild') {
    return res.status(400).json({
      error: 'Reload the Control Room — this action now rebuilds the demo org and needs confirmation.',
      code: 'confirm-required',
    });
  }
  // Two overlapping runs corrupt each other: buildRoundBooks deletes then re-inserts the round's
  // assignments against a unique {turfId,userId} index, and `willStage` is computed from a live
  // activity count both would read as 0 after the other's wipe — double-staging the day, or
  // leaving it empty right before a pitch. No Mongo transactions here (standalone-mongod test
  // harness), so a single in-process flag is the guard. Per-DYNO: advisory only if web ever
  // scales past 1, which it does not today.
  if (demoRebuildRunning) {
    return res.status(409).json({
      error: 'A demo rebuild is already running — wait for it to finish.',
      code: 'DEMO_REBUILD_RUNNING',
    });
  }
  demoRebuildRunning = true;
  const started = Date.now();
  try {
    const summary = await seedDemoOrg({
      apply: true,
      reset: true,
      rebuild: false,            // the campaign-wipe cascade is CLI-only, permanently
      allowImport: false,        // a ~2,600-voter import cannot finish inside a 30s request
      syncPasswords: false,      // never rewrite credentials Apple/Google are mid-review with
      requireExisting: true,     // refuse the cold-build path instead of half-building it
      requireSharePassword: true,
      // The CLI pins the staged-knock rng so a re-run reproduces the same day. The button
      // varies it, keeping what the old refresh button gave you: a slightly different day
      // each press. The household/voter rng stays fixed — see RNG_SEED.
      historySeed: Date.now(),
      log: () => {},             // three of the engine's log lines print credentials
    });
    // The demo org is isInternal, so staff enter without a grant and deliberately leave no
    // AccessLog row. This line is the only record of who pressed it.
    console.warn(
      `[demo-rebuild] ${req.user.email || req.user._id} rebuilt the demo org in ${Date.now() - started}ms`,
      summary.staged
    );
    res.json({ ...summary, durationMs: Date.now() - started });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  } finally {
    demoRebuildRunning = false;
  }
});

router.get('/activity-feed', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const filter = {
      actionType: { $in: [...ACTION_DOOR, 'restricted'] },
      via: { $ne: 'bulk' }, // a 100-door bulk mark would flood the live feed
    };
    if (req.query.since) {
      const sinceMs = Date.parse(req.query.since);
      if (Number.isFinite(sinceMs)) filter.timestamp = { $gt: new Date(sinceMs) };
    }
    // `before` is `since`'s mirror: page BACKWARD into history ("Load older"), which the
    // newer-only cursor could never reach.
    if (req.query.before) {
      const beforeMs = Date.parse(req.query.before);
      if (Number.isFinite(beforeMs)) {
        filter.timestamp = { ...(filter.timestamp || {}), $lt: new Date(beforeMs) };
      }
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
        // The street address is gone from this feed on purpose.
        //
        // The Control Room is an operational dashboard — "is the platform busy, is anything on fire"
        // — and it is visible to any staff member with NO access grant and NO audit trail. It used to
        // stream, cross-org and unlogged, a live line of "canvasser Jane knocked 412 Elm St at 3:47pm
        // for Acme Campaigns". That is voter content, and voter content now requires a grant and gets
        // logged (see models/SupportAccessGrant.js). City/state stays: it tells you WHERE the platform
        // is busy without identifying a home.
        household: e.householdId
          ? { id: String(e.householdId._id), city: e.householdId.city, state: e.householdId.state }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
