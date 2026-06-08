import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { Pass } from '../../models/Pass.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Organization } from '../../models/Organization.js';
import { zonedDayRange, tzAbbrev, zonedDayStr } from '../../utils/timezone.js';
import {
  KNOCK_ACTIONS,
  knocksPipeline,
  connectionRate,
  coverageBucketExpr,
} from '../../services/reports/aggregations.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

// Resolve the ANCHOR timezone for every report request: the campaign's zone when a
// single campaign is scoped, else the org's zone. Every date window + day-bucket uses
// this (NOT the viewer's tz), so admins in Tyler / Vegas / NY see identical numbers.
async function resolveAnchorTz(req) {
  const orgId = req.activeOrg?._id;
  if (!orgId) return 'UTC';
  if (req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)) {
    const c = await Campaign.findOne({ _id: req.query.campaignId, organizationId: orgId }, { timeZone: 1 }).lean();
    if (c?.timeZone) return c.timeZone;
  }
  const org = await Organization.findById(orgId, { timeZone: 1 }).lean();
  return org?.timeZone || 'America/New_York';
}
router.use(async (req, res, next) => {
  try {
    req.anchorTz = await resolveAnchorTz(req);
    next();
  } catch (err) {
    next(err);
  }
});

function activeOrgId(req) {
  return req.activeOrg?._id;
}

function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}

// from/to are date-only 'YYYY-MM-DD' (the picked calendar days); we slice to stay robust
// to any legacy ISO value. The window is computed in the request's ANCHOR timezone
// (req.anchorTz) as a half-open [start-of-fromDay, start-of-(toDay+1)) — so a single day
// is a full 24h window and the same range means the same days for EVERY viewer.
function parseDateRange(req, field) {
  const tz = req.anchorTz || 'UTC';
  const fromDay = req.query.from ? String(req.query.from).slice(0, 10) : null;
  const toDay = req.query.to ? String(req.query.to).slice(0, 10) : null;
  const range = zonedDayRange(fromDay, toDay, tz);
  if (!range.$gte && !range.$lt) return {};
  return { [field]: range };
}

// Active campaigns whose CURRENT calendar date (in their own tz) differs from the org's
// right now — the nightly window where a relative preset (Today/Yesterday/…), computed in
// the org's day, lands on a different day for that campaign than its own dashboard would.
// Takes `now` so it is deterministic to unit-test.
function crossZoneSeam(now, orgTz, campaigns) {
  const orgToday = zonedDayStr(now, orgTz);
  return campaigns.filter((c) => zonedDayStr(now, c.timeZone || 'America/New_York') !== orgToday);
}

function baseFilter(req) {
  const orgId = activeOrgId(req);
  const filter = { organizationId: orgId };
  if (req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)) {
    filter.campaignId = new mongoose.Types.ObjectId(req.query.campaignId);
  }
  // Optional per-effort scoping. effortId is denormalized onto CanvassActivity,
  // SurveyResponse, and Household, so this one filter scopes knocks, surveys, and
  // coverage alike. Omit it for whole-campaign totals (the sum across efforts).
  if (req.query.effortId && mongoose.isValidObjectId(req.query.effortId)) {
    filter.effortId = new mongoose.Types.ObjectId(req.query.effortId);
  }
  return filter;
}

// KNOCK_ACTIONS, knocksPipeline, connectionRate, coverageBucketExpr now live in
// services/reports/aggregations.js (shared with the client report builder).

function parseUserIdParam(req, res) {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400).json({ error: 'Invalid userId' });
    return null;
  }
  return new mongoose.Types.ObjectId(userId);
}

// Day-bucket timezone = the resolved ANCHOR tz (campaign/org), NOT the viewer's
// req.query.tz, so per-day groupings are identical for everyone.
function tzOf(req) {
  return req.anchorTz || 'UTC';
}

function dayBucketExpr(field, tz) {
  return { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: tz } };
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers, rows) {
  const out = [headers.map(csvCell).join(',')];
  for (const row of rows) out.push(row.map(csvCell).join(','));
  return out.join('\n');
}

function streetAddress(h) {
  if (!h) return '';
  const line2 = h.addressLine2 ? `, ${h.addressLine2}` : '';
  return `${h.addressLine1 || ''}${line2}, ${h.city || ''}, ${h.state || ''} ${h.zipCode || ''}`.trim();
}

router.get('/overview', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    const householdMatch = { isActive: true, ...cFilter };

    const memberCountPromise = Membership.countDocuments({
      organizationId: orgId,
      isActive: true,
    });

    const [
      households,
      voterDocs,
      activeUsers,
      surveysSubmitted,
      surveyedVoterIds,
      homesKnocked,
      statusAgg,
      eventAgg,
      knockAgg,
    ] = await Promise.all([
      Household.countDocuments(householdMatch),
      Household.find(householdMatch, { _id: 1 }).lean(),
      memberCountPromise,
      SurveyResponse.countDocuments(cFilter),
      SurveyResponse.distinct('voterId', cFilter),
      Household.countDocuments({ ...householdMatch, status: { $ne: 'unknocked' } }),
      Household.aggregate([
        { $match: householdMatch },
        { $group: { _id: coverageBucketExpr, count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: cFilter },
        { $group: { _id: '$actionType', count: { $sum: 1 } } },
      ]),
      // Billable knocks: distinct (household, pass). See knocksPipeline.
      CanvassActivity.aggregate(knocksPipeline(cFilter)),
    ]);

    const voterIds = voterDocs.map((h) => h._id);
    const voters = await Voter.countDocuments({
      householdId: { $in: voterIds },
      organizationId: orgId,
    });

    const canvass = {
      unknocked: 0,
      not_home: 0,
      surveyed: 0,
      wrong_address: 0,
      lit_dropped: 0,
      voted: 0,
    };
    for (const r of statusAgg) canvass[r._id] = r.count;

    const events = { notHome: 0, wrongAddress: 0, surveySubmitted: 0, litDropped: 0 };
    for (const r of eventAgg) {
      if (r._id === 'not_home') events.notHome = r.count;
      else if (r._id === 'wrong_address') events.wrongAddress = r.count;
      else if (r._id === 'survey_submitted') events.surveySubmitted = r.count;
      else if (r._id === 'lit_dropped') events.litDropped = r.count;
    }

    const k = knockAgg[0] || { knocks: 0, surveyedKnocks: 0, litKnocks: 0 };
    const surveyedVoters = surveyedVoterIds.length;

    res.json({
      totals: {
        households,
        voters,
        activeUsers,
        surveysSubmitted,
        surveyedVoters,
        homesKnocked,
        knocks: k.knocks,
        surveyedKnocks: k.surveyedKnocks,
        litKnocks: k.litKnocks,
        connectionRate: connectionRate(k),
      },
      canvass,
      events,
      timeZone: req.anchorTz,
      tzAbbrev: tzAbbrev(req.anchorTz),
    });
  } catch (err) {
    next(err);
  }
});

// Cross-campaign rollup: one row per campaign plus a cumulative total. Scope by
// active/archived/all campaigns. Door-days are deduped per household per day.
router.get('/campaign-rollup', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const organizationId = activeOrgId(req);
    const scope = req.query.scope || 'active';

    const filter = { organizationId };
    // Optional campaignId scopes the rollup to one campaign (used by the mobile
    // detail so its in-range numbers match the landing exactly). Otherwise scope
    // by active/archived/all.
    if (req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)) {
      filter._id = new mongoose.Types.ObjectId(req.query.campaignId);
    } else if (scope === 'active') filter.isActive = true;
    else if (scope === 'archived') filter.isActive = false;

    const campaigns = await Campaign.find(filter, { name: 1, type: 1, isActive: 1, timeZone: 1 }).lean();
    const ids = campaigns.map((c) => c._id);

    if (ids.length === 0) {
      return res.json({
        scope,
        cumulative: {
          campaigns: 0,
          households: 0,
          homesKnocked: 0,
          knockedPct: 0,
          knocks: 0,
          surveyedKnocks: 0,
          litKnocks: 0,
          surveysSubmitted: 0,
          surveyedVoters: 0,
          litDropped: 0,
          connectionRate: 0,
          activeCanvassers: 0,
          lastActivityAt: null,
        },
        campaigns: [],
      });
    }

    // Activity counts (knocks/surveys/canvassers) honor an optional from/to range;
    // households + coverage stay current-state (all-time). Knocks range on `timestamp`,
    // surveys on `submittedAt` (matching /canvassers).
    //
    // Org-wide rollups span timezones (a Texas campaign on Central, a Florida one on
    // Eastern), so window EACH zone in its own clock for the requested day(s) — the
    // per-campaign rows then match each campaign's own dashboard, and the cumulative is
    // their sum. Grouping by tz keeps the $or to one branch per distinct zone (<= ~6).
    // A single-campaign request (filter._id) already uses that campaign's tz via
    // req.anchorTz, and All time has no window — both keep the simple parseDateRange path.
    const fromDay = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const toDay = req.query.to ? String(req.query.to).slice(0, 10) : null;
    const perZoneWindows = !filter._id && (fromDay || toDay);
    const byTz = new Map();
    for (const c of campaigns) {
      const tz = c.timeZone || 'America/New_York';
      if (!byTz.has(tz)) byTz.set(tz, []);
      byTz.get(tz).push(c._id);
    }
    const dateMatch = (field) =>
      perZoneWindows
        ? { $or: [...byTz].map(([tz, cids]) => ({ campaignId: { $in: cids }, [field]: zonedDayRange(fromDay, toDay, tz) })) }
        : parseDateRange(req, field);
    // Honor an optional effortId (like /overview's baseFilter) so Activity scopes to
    // the effort when the Dashboard filters by one — otherwise Coverage (effort-scoped
    // households) and Activity (knocks/surveys) disagree. effortId is denormalized on
    // Household / CanvassActivity / SurveyResponse, so this one filter scopes them all.
    const effortMatch = req.query.effortId && mongoose.isValidObjectId(req.query.effortId)
      ? { effortId: new mongoose.Types.ObjectId(req.query.effortId) }
      : {};
    const match = { organizationId, campaignId: { $in: ids }, ...effortMatch };
    const activityMatch = { ...match, ...dateMatch('timestamp') };
    const surveyMatch = { ...match, ...dateMatch('submittedAt') };

    const [coverageAgg, eventAgg, knockAgg, surveyAgg, canvasserAgg, cumulativeCanvassers] =
      await Promise.all([
        Household.aggregate([
          { $match: { organizationId, campaignId: { $in: ids }, isActive: true, ...effortMatch } },
          {
            $group: {
              _id: { campaignId: '$campaignId', bucket: coverageBucketExpr },
              count: { $sum: 1 },
            },
          },
        ]),
        CanvassActivity.aggregate([
          { $match: activityMatch },
          {
            $group: {
              _id: { campaignId: '$campaignId', actionType: '$actionType' },
              count: { $sum: 1 },
            },
          },
        ]),
        // Billable knocks per campaign: distinct (household, pass). See knocksPipeline.
        CanvassActivity.aggregate(knocksPipeline(activityMatch, { byCampaign: true })),
        // Surveys (volume) + surveyed voters (distinct) per campaign, from SurveyResponse.
        SurveyResponse.aggregate([
          { $match: surveyMatch },
          { $group: { _id: { campaignId: '$campaignId', voterId: '$voterId' }, responses: { $sum: 1 } } },
          {
            $group: {
              _id: '$_id.campaignId',
              surveyedVoters: { $sum: 1 },
              surveysSubmitted: { $sum: '$responses' },
            },
          },
        ]),
        CanvassActivity.aggregate([
          { $match: activityMatch },
          {
            $group: {
              _id: '$campaignId',
              users: { $addToSet: '$userId' },
              last: { $max: '$timestamp' },
            },
          },
          { $project: { activeCanvassers: { $size: '$users' }, last: 1 } },
        ]),
        CanvassActivity.distinct('userId', activityMatch),
      ]);

    const byCampaign = new Map();
    for (const c of campaigns) {
      byCampaign.set(String(c._id), {
        households: 0,
        homesKnocked: 0,
        coverage: {
          unknocked: 0,
          not_home: 0,
          surveyed: 0,
          wrong_address: 0,
          lit_dropped: 0,
          voted: 0,
        },
        surveysSubmitted: 0,
        surveyedVoters: 0,
        litDropped: 0,
        knocks: 0,
        surveyedKnocks: 0,
        litKnocks: 0,
        activeCanvassers: 0,
        lastActivityAt: null,
      });
    }

    for (const r of coverageAgg) {
      const c = byCampaign.get(String(r._id.campaignId));
      if (!c) continue;
      const bucket = r._id.bucket;
      c.households += r.count;
      // 'voted' (early-voted, never knocked) and 'unknocked' are not "homes knocked".
      if (bucket !== 'unknocked' && bucket !== 'voted') c.homesKnocked += r.count;
      if (bucket in c.coverage) c.coverage[bucket] = r.count;
    }
    for (const r of eventAgg) {
      const c = byCampaign.get(String(r._id.campaignId));
      if (!c) continue;
      // Lit drops are a volume count (every drop); Surveys come from SurveyResponse below.
      if (r._id.actionType === 'lit_dropped') c.litDropped = r.count;
    }
    for (const r of knockAgg) {
      const c = byCampaign.get(String(r._id));
      if (!c) continue;
      c.knocks = r.knocks;
      c.surveyedKnocks = r.surveyedKnocks;
      c.litKnocks = r.litKnocks;
    }
    for (const r of surveyAgg) {
      const c = byCampaign.get(String(r._id));
      if (!c) continue;
      c.surveysSubmitted = r.surveysSubmitted;
      c.surveyedVoters = r.surveyedVoters;
    }
    for (const r of canvasserAgg) {
      const c = byCampaign.get(String(r._id));
      if (!c) continue;
      c.activeCanvassers = r.activeCanvassers;
      c.lastActivityAt = r.last;
    }

    const rows = campaigns
      .map((campaign) => {
        const c = byCampaign.get(String(campaign._id));
        return {
          id: String(campaign._id),
          name: campaign.name,
          type: campaign.type,
          isActive: campaign.isActive,
          households: c.households,
          homesKnocked: c.homesKnocked,
          knockedPct: c.households > 0 ? Math.round((c.homesKnocked / c.households) * 100) : 0,
          knocks: c.knocks,
          surveyedKnocks: c.surveyedKnocks,
          litKnocks: c.litKnocks,
          surveysSubmitted: c.surveysSubmitted,
          surveyedVoters: c.surveyedVoters,
          litDropped: c.litDropped,
          connectionRate: connectionRate(c),
          activeCanvassers: c.activeCanvassers,
          lastActivityAt: c.lastActivityAt,
          coverage: c.coverage,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const sum = (key) => rows.reduce((acc, r) => acc + (r[key] || 0), 0);
    const cumulative = {
      campaigns: ids.length,
      households: sum('households'),
      homesKnocked: sum('homesKnocked'),
      knockedPct: 0,
      knocks: sum('knocks'),
      surveyedKnocks: sum('surveyedKnocks'),
      litKnocks: sum('litKnocks'),
      surveysSubmitted: sum('surveysSubmitted'),
      surveyedVoters: sum('surveyedVoters'),
      litDropped: sum('litDropped'),
      connectionRate: 0,
      activeCanvassers: cumulativeCanvassers.length,
      lastActivityAt: rows.reduce(
        (acc, r) =>
          r.lastActivityAt && (!acc || r.lastActivityAt > acc) ? r.lastActivityAt : acc,
        null
      ),
    };
    cumulative.knockedPct =
      cumulative.households > 0
        ? Math.round((cumulative.homesKnocked / cumulative.households) * 100)
        : 0;
    cumulative.connectionRate = connectionRate(cumulative);
    cumulative.coverage = rows.reduce(
      (acc, r) => {
        for (const k of Object.keys(acc)) acc[k] += r.coverage?.[k] || 0;
        return acc;
      },
      { unknocked: 0, not_home: 0, surveyed: 0, wrong_address: 0, lit_dropped: 0, voted: 0 }
    );

    // Heads-up flag: are we in the nightly window where a relative preset could read a day
    // off for an off-zone campaign vs its own dashboard? Only meaningful org-wide.
    const seam = filter._id ? [] : crossZoneSeam(new Date(), req.anchorTz, campaigns);

    res.json({
      scope,
      cumulative,
      campaigns: rows,
      timeZone: req.anchorTz,
      tzAbbrev: tzAbbrev(req.anchorTz),
      crossZoneDaySeam: seam.length > 0,
      seamCampaigns: seam.map((c) => c.name),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/canvassers', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const cFilter = baseFilter(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter };

    const [surveyAgg, activityAgg, rangeAgg] = await Promise.all([
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        {
          $group: {
            _id: '$userId',
            surveysSubmitted: { $sum: 1 },
            lastSurveyAt: { $max: '$submittedAt' },
          },
        },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { userId: '$userId', actionType: '$actionType' },
            count: { $sum: 1 },
            lastAt: { $max: '$timestamp' },
          },
        },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: '$userId',
            firstActivityAt: { $min: '$timestamp' },
            lastActivityAt: { $max: '$timestamp' },
          },
        },
      ]),
    ]);

    const byUser = new Map();
    const ensure = (id) => {
      const key = String(id);
      if (!byUser.has(key)) {
        byUser.set(key, {
          userId: key,
          surveysSubmitted: 0,
          surveyKnocks: 0,
          notHome: 0,
          wrongAddress: 0,
          litDropped: 0,
          firstActivityAt: null,
          lastActivityAt: null,
        });
      }
      return byUser.get(key);
    };

    for (const row of surveyAgg) {
      const u = ensure(row._id);
      u.surveysSubmitted = row.surveysSubmitted;
      if (row.lastSurveyAt && (!u.lastActivityAt || row.lastSurveyAt > u.lastActivityAt)) {
        u.lastActivityAt = row.lastSurveyAt;
      }
    }
    for (const row of activityAgg) {
      const u = ensure(row._id.userId);
      if (row._id.actionType === 'not_home') u.notHome = row.count;
      else if (row._id.actionType === 'wrong_address') u.wrongAddress = row.count;
      else if (row._id.actionType === 'lit_dropped') u.litDropped = row.count;
      // survey_submitted activities are deduped to one per (user, household, pass), so this
      // is the canvasser's count of distinct surveyed door-passes (the rate's numerator).
      else if (row._id.actionType === 'survey_submitted') u.surveyKnocks = row.count;
      if (row.lastAt && (!u.lastActivityAt || row.lastAt > u.lastActivityAt)) {
        u.lastActivityAt = row.lastAt;
      }
    }
    for (const row of rangeAgg) {
      const u = ensure(row._id);
      u.firstActivityAt = row.firstActivityAt;
      if (
        row.lastActivityAt &&
        (!u.lastActivityAt || row.lastActivityAt > u.lastActivityAt)
      ) {
        u.lastActivityAt = row.lastActivityAt;
      }
    }

    const userIds = Array.from(byUser.keys()).map((id) => new mongoose.Types.ObjectId(id));
    const users = await User.find(
      { _id: { $in: userIds } },
      'firstName lastName email isActive'
    ).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const rows = Array.from(byUser.values())
      .map((u) => {
        const info = userMap.get(u.userId);
        // Billable knocks = this canvasser's distinct (household, pass) door interactions.
        // surveyKnocks/litDropped are mutually exclusive by campaign type, so they're the
        // completion-action numerator for the connection rate.
        const knocks = u.notHome + u.wrongAddress + u.litDropped + u.surveyKnocks;
        return {
          userId: u.userId,
          firstName: info?.firstName || '',
          lastName: info?.lastName || '',
          email: info?.email || '',
          isActive: info?.isActive ?? false,
          surveysSubmitted: u.surveysSubmitted,
          surveyKnocks: u.surveyKnocks,
          notHome: u.notHome,
          wrongAddress: u.wrongAddress,
          litDropped: u.litDropped,
          knocks,
          // homesKnocked kept as an alias of knocks for back-compat with un-updated callers.
          homesKnocked: knocks,
          connectionRate: connectionRate({
            knocks,
            surveyedKnocks: u.surveyKnocks,
            litKnocks: u.litDropped,
          }),
          firstActivityAt: u.firstActivityAt,
          lastActivityAt: u.lastActivityAt,
        };
      })
      .sort((a, b) => {
        if (b.surveysSubmitted !== a.surveysSubmitted) return b.surveysSubmitted - a.surveysSubmitted;
        return b.knocks - a.knocks;
      });

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/surveys', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);

    let templateFilter = { organizationId: orgId };
    if (cFilter.campaignId) {
      const campaign = await Campaign.findOne({ _id: cFilter.campaignId, organizationId: orgId }).lean();
      if (campaign?.surveyTemplateId) {
        templateFilter = { _id: campaign.surveyTemplateId, organizationId: orgId };
      } else {
        return res.json([]);
      }
    }

    const [templates, responseCounts] = await Promise.all([
      SurveyTemplate.find(templateFilter, 'name version').sort({ updatedAt: -1 }).lean(),
      SurveyResponse.aggregate([
        { $match: cFilter },
        { $group: { _id: '$surveyTemplateId', count: { $sum: 1 } } },
      ]),
    ]);

    const counts = new Map(responseCounts.map((r) => [String(r._id), r.count]));
    const rows = templates
      .map((t) => ({
        id: String(t._id),
        name: t.name,
        version: t.version,
        responseCount: counts.get(String(t._id)) || 0,
      }))
      .filter((t) => t.responseCount > 0 || !cFilter.campaignId)
      .sort((a, b) => b.responseCount - a.responseCount);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/survey-results', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    let { surveyTemplateId } = req.query;

    let template = null;
    if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
      template = await SurveyTemplate.findOne({
        _id: surveyTemplateId,
        organizationId: orgId,
      }).lean();
    }
    if (!template && cFilter.campaignId) {
      const campaign = await Campaign.findOne({ _id: cFilter.campaignId, organizationId: orgId }).lean();
      if (campaign?.surveyTemplateId) {
        template = await SurveyTemplate.findOne({
          _id: campaign.surveyTemplateId,
          organizationId: orgId,
        }).lean();
      }
    }
    if (!template) {
      return res.json({ surveyTemplate: null, totalResponses: 0, questions: [] });
    }

    const dateRange = parseDateRange(req, 'submittedAt');
    const userIdParam =
      req.query.userId && mongoose.isValidObjectId(req.query.userId)
        ? new mongoose.Types.ObjectId(req.query.userId)
        : null;
    const compareToOrg = req.query.compareToOrg === 'true' && !!userIdParam;
    const baseMatch = { surveyTemplateId: template._id, ...dateRange, ...cFilter };
    const match = userIdParam ? { ...baseMatch, userId: userIdParam } : baseMatch;
    const [totalResponses, orgTotalResponses] = await Promise.all([
      SurveyResponse.countDocuments(match),
      compareToOrg ? SurveyResponse.countDocuments(baseMatch) : Promise.resolve(null),
    ]);

    const voterPreviewLimit = Math.min(
      Math.max(parseInt(req.query.voterPreview, 10) || 0, 0),
      20
    );

    const questions = [];
    const sortedQs = [...(template.questions || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

    const aggResults = [];
    for (const q of sortedQs) {
      const pipeline = [
        { $match: match },
        { $unwind: '$answers' },
        { $match: { 'answers.questionKey': q.key } },
      ];

      if (q.type === 'multiple_choice') {
        pipeline.push({ $unwind: '$answers.answer' });
      }

      const wantsPreview = voterPreviewLimit > 0 && q.type !== 'text';
      if (wantsPreview) {
        pipeline.push({ $sort: { submittedAt: -1 } });
      }

      const groupStage = {
        _id: '$answers.answer',
        count: { $sum: 1 },
      };
      if (wantsPreview) {
        groupStage.responseIds = { $push: '$_id' };
      }
      pipeline.push({ $group: groupStage });

      if (wantsPreview) {
        pipeline.push({
          $project: {
            count: 1,
            responseIds: { $slice: ['$responseIds', voterPreviewLimit] },
          },
        });
      }

      pipeline.push({ $sort: { count: -1 } });
      if (q.type === 'text') {
        pipeline.push({ $limit: 10 });
      }

      const agg = await SurveyResponse.aggregate(pipeline);

      let orgAgg = null;
      if (compareToOrg) {
        // Same pipeline but matched against the whole org (no userId scope) so we
        // can show "this canvasser vs everyone" on each option.
        const orgPipeline = [
          { $match: baseMatch },
          { $unwind: '$answers' },
          { $match: { 'answers.questionKey': q.key } },
        ];
        if (q.type === 'multiple_choice') {
          orgPipeline.push({ $unwind: '$answers.answer' });
        }
        orgPipeline.push({ $group: { _id: '$answers.answer', count: { $sum: 1 } } });
        orgAgg = await SurveyResponse.aggregate(orgPipeline);
      }

      aggResults.push({ q, agg, orgAgg });
    }

    const allResponseIds = new Set();
    for (const { q, agg } of aggResults) {
      if (q.type === 'text') continue;
      for (const row of agg) {
        for (const id of row.responseIds || []) allResponseIds.add(String(id));
      }
    }

    let responseLookup = new Map();
    if (allResponseIds.size > 0) {
      const ids = Array.from(allResponseIds).map((id) => new mongoose.Types.ObjectId(id));
      const responses = await SurveyResponse.find({ _id: { $in: ids }, organizationId: orgId })
        .populate('voterId', 'fullName party')
        .populate('householdId', 'addressLine1 city state')
        .populate('userId', 'firstName lastName')
        .lean();
      responseLookup = new Map(responses.map((r) => [String(r._id), r]));
    }

    function shapeVoter(r) {
      return {
        responseId: String(r._id),
        submittedAt: r.submittedAt,
        voter: r.voterId
          ? {
              id: String(r.voterId._id),
              fullName: r.voterId.fullName,
              party: r.voterId.party || null,
            }
          : null,
        household: r.householdId
          ? {
              id: String(r.householdId._id),
              addressLine1: r.householdId.addressLine1,
              city: r.householdId.city,
              state: r.householdId.state,
            }
          : null,
        canvasser: r.userId
          ? {
              id: String(r.userId._id),
              firstName: r.userId.firstName,
              lastName: r.userId.lastName,
            }
          : null,
      };
    }

    for (const { q, agg, orgAgg } of aggResults) {
      const orgMap = new Map();
      if (orgAgg) {
        for (const r of orgAgg) {
          const key = typeof r._id === 'string' ? r._id : String(r._id);
          orgMap.set(key, r.count);
        }
      }

      const options = agg
        .filter((r) => r._id !== null && r._id !== undefined && r._id !== '')
        .map((r) => {
          const optionKey = typeof r._id === 'string' ? r._id : String(r._id);
          const out = {
            option: optionKey,
            count: r.count,
            percent: totalResponses > 0 ? Math.round((r.count / totalResponses) * 1000) / 10 : 0,
          };
          if (compareToOrg) {
            const orgCount = orgMap.get(optionKey) || 0;
            out.orgCount = orgCount;
            out.orgPercent =
              orgTotalResponses > 0
                ? Math.round((orgCount / orgTotalResponses) * 1000) / 10
                : 0;
          }
          if (voterPreviewLimit > 0 && q.type !== 'text') {
            out.voters = (r.responseIds || [])
              .map((id) => responseLookup.get(String(id)))
              .filter(Boolean)
              .map(shapeVoter);
          }
          return out;
        });

      // When comparing, also surface org-only options the canvasser never picked
      // (so the bar chart shows zero for them rather than hiding the gap).
      if (compareToOrg) {
        const seen = new Set(options.map((o) => o.option));
        for (const [opt, orgCount] of orgMap.entries()) {
          if (seen.has(opt) || opt === '' || opt === 'null' || opt === 'undefined') continue;
          options.push({
            option: opt,
            count: 0,
            percent: 0,
            orgCount,
            orgPercent:
              orgTotalResponses > 0
                ? Math.round((orgCount / orgTotalResponses) * 1000) / 10
                : 0,
          });
        }
      }

      questions.push({
        key: q.key,
        label: q.label,
        type: q.type,
        options,
      });
    }

    res.json({
      surveyTemplate: {
        id: String(template._id),
        name: template.name,
        version: template.version,
      },
      totalResponses,
      orgTotalResponses: compareToOrg ? orgTotalResponses : undefined,
      compareToOrg,
      userId: userIdParam ? String(userIdParam) : null,
      questions,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/voters-by-answer', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { questionKey, option, surveyTemplateId } = req.query;
    if (!questionKey || !option) {
      return res.status(400).json({ error: 'questionKey and option are required' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const dateRange = parseDateRange(req, 'submittedAt');
    const cFilter = baseFilter(req);
    const filter = {
      ...dateRange,
      ...cFilter,
      answers: { $elemMatch: { questionKey, answer: option } },
    };
    if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
      filter.surveyTemplateId = new mongoose.Types.ObjectId(surveyTemplateId);
    }

    const [total, responses] = await Promise.all([
      SurveyResponse.countDocuments(filter),
      SurveyResponse.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('voterId', 'fullName party')
        .populate('householdId', 'addressLine1 city state')
        .populate('userId', 'firstName lastName')
        .lean(),
    ]);

    res.json({
      total,
      voters: responses.map((r) => ({
        responseId: String(r._id),
        submittedAt: r.submittedAt,
        voter: r.voterId
          ? {
              id: String(r.voterId._id),
              fullName: r.voterId.fullName,
              party: r.voterId.party || null,
            }
          : null,
        household: r.householdId
          ? {
              id: String(r.householdId._id),
              addressLine1: r.householdId.addressLine1,
              city: r.householdId.city,
              state: r.householdId.state,
            }
          : null,
        canvasser: r.userId
          ? {
              id: String(r.userId._id),
              firstName: r.userId.firstName,
              lastName: r.userId.lastName,
            }
          : null,
        note: r.note || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// A house is an "overlap" only when 2+ DISTINCT canvassers knocked it within the SAME pass.
// Once a house is knocked in a pass nobody should return until the next pass, so a single
// canvasser revisiting — or different canvassers across DIFFERENT passes (a legitimate 2nd-pass
// sweep of not-homes/undecideds) — is not an overlap. passId:null is its own bucket (legacy
// data: 2+ distinct canvassers there still collide).
router.get('/overlaps', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'timestamp');
    const match = {
      ...cFilter,
      ...dateRange,
      actionType: { $in: KNOCK_ACTIONS },
    };

    const collisions = await CanvassActivity.aggregate([
      { $match: match },
      {
        $group: {
          _id: { householdId: '$householdId', passId: '$passId' },
          canvassers: { $addToSet: '$userId' },
          events: {
            $push: { userId: '$userId', actionType: '$actionType', timestamp: '$timestamp' },
          },
        },
      },
      { $set: { distinctCount: { $size: '$canvassers' } } },
      { $match: { distinctCount: { $gt: 1 } } },
      { $sort: { distinctCount: -1 } },
      { $limit: 200 },
    ]);

    if (!collisions.length) {
      return res.json({ overlaps: [], total: 0 });
    }

    const householdIds = [...new Set(collisions.map((c) => String(c._id.householdId)))];
    const passIds = [
      ...new Set(collisions.map((c) => c._id.passId).filter(Boolean).map(String)),
    ];
    const userIds = [
      ...new Set(collisions.flatMap((c) => c.events.map((e) => String(e.userId)))),
    ];

    const [households, users, passes] = await Promise.all([
      Household.find(
        { _id: { $in: householdIds }, organizationId: orgId },
        'addressLine1 addressLine2 city state zipCode location'
      ).lean(),
      User.find({ _id: { $in: userIds } }, 'firstName lastName email').lean(),
      passIds.length
        ? Pass.find({ _id: { $in: passIds } }, 'roundNumber name').lean()
        : [],
    ]);

    const hMap = new Map(households.map((h) => [String(h._id), h]));
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    const pMap = new Map(passes.map((p) => [String(p._id), p]));

    // Roll the (household, pass) collisions up into one card per household, listing each
    // colliding pass and the canvassers who knocked that door in it.
    const byHousehold = new Map();
    for (const c of collisions) {
      const h = hMap.get(String(c._id.householdId));
      if (!h) continue;
      const hid = String(c._id.householdId);
      if (!byHousehold.has(hid)) {
        byHousehold.set(hid, {
          household: {
            id: hid,
            addressLine1: h.addressLine1,
            addressLine2: h.addressLine2 || null,
            city: h.city,
            state: h.state,
            zipCode: h.zipCode,
          },
          passes: [],
          canvasserSet: new Set(),
        });
      }
      const entry = byHousehold.get(hid);
      const pass = c._id.passId ? pMap.get(String(c._id.passId)) : null;
      const roundNumber = pass?.roundNumber ?? null;
      entry.passes.push({
        passId: c._id.passId ? String(c._id.passId) : null,
        roundNumber,
        roundLabel: pass ? `Pass ${pass.roundNumber} · ${pass.name}` : 'Legacy / no pass',
        canvassers: c.events
          .map((e) => {
            const u = uMap.get(String(e.userId));
            return {
              userId: String(e.userId),
              firstName: u?.firstName || '',
              lastName: u?.lastName || '',
              email: u?.email || '',
              actionType: e.actionType,
              timestamp: e.timestamp,
            };
          })
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
      });
      for (const e of c.events) entry.canvasserSet.add(String(e.userId));
    }

    const result = [...byHousehold.values()]
      .map((e) => ({
        household: e.household,
        passes: e.passes.sort(
          (a, b) => (a.roundNumber ?? Infinity) - (b.roundNumber ?? Infinity)
        ),
        totalCanvassers: e.canvasserSet.size,
      }))
      .sort((a, b) => b.totalCanvassers - a.totalCanvassers);

    res.json({ overlaps: result, total: result.length });
  } catch (err) {
    next(err);
  }
});

router.get('/canvassers/:userId/responses', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const skip = parseInt(req.query.skip, 10) || 0;
    const dateRange = parseDateRange(req, 'submittedAt');
    const cFilter = baseFilter(req);
    const filter = {
      userId: new mongoose.Types.ObjectId(userId),
      ...dateRange,
      ...cFilter,
    };

    const [user, total, responses] = await Promise.all([
      User.findById(userId, 'firstName lastName email').lean(),
      SurveyResponse.countDocuments(filter),
      SurveyResponse.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('voterId', 'fullName')
        .populate('householdId', 'addressLine1 city state')
        .populate('surveyTemplateId', 'name version')
        .lean(),
    ]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: String(user._id),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      total,
      responses: responses.map((r) => ({
        id: String(r._id),
        submittedAt: r.submittedAt,
        surveyTemplate: r.surveyTemplateId
          ? {
              id: String(r.surveyTemplateId._id),
              name: r.surveyTemplateId.name,
              version: r.surveyTemplateVersion ?? r.surveyTemplateId.version,
            }
          : null,
        voter: r.voterId
          ? { id: String(r.voterId._id), fullName: r.voterId.fullName }
          : null,
        household: r.householdId
          ? {
              id: String(r.householdId._id),
              addressLine1: r.householdId.addressLine1,
              city: r.householdId.city,
              state: r.householdId.state,
            }
          : null,
        answers: r.answers || [],
        note: r.note || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Canvasser audit drilldown
// ─────────────────────────────────────────────────────────────────────────────

// Leaderboard CSV export — same shape as GET /canvassers, rendered as text/csv.
router.get('/canvassers.csv', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const cFilter = baseFilter(req);
    const tz = tzOf(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter };

    const [surveyAgg, activityAgg, hoursAgg] = await Promise.all([
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        { $group: { _id: '$userId', surveysSubmitted: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { userId: '$userId', actionType: '$actionType' },
            count: { $sum: 1 },
            firstAt: { $min: '$timestamp' },
            lastAt: { $max: '$timestamp' },
          },
        },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { userId: '$userId', day: dayBucketExpr('timestamp', tz) },
            first: { $min: '$timestamp' },
            last: { $max: '$timestamp' },
          },
        },
        {
          $group: {
            _id: '$_id.userId',
            hoursOnDoors: {
              $sum: { $divide: [{ $subtract: ['$last', '$first'] }, 3600000] },
            },
            daysActive: { $sum: 1 },
          },
        },
      ]),
    ]);

    const byUser = new Map();
    const ensure = (id) => {
      const key = String(id);
      if (!byUser.has(key)) {
        byUser.set(key, {
          userId: key,
          surveysSubmitted: 0,
          surveyKnocks: 0,
          notHome: 0,
          wrongAddress: 0,
          litDropped: 0,
          firstActivityAt: null,
          lastActivityAt: null,
          hoursOnDoors: 0,
          daysActive: 0,
        });
      }
      return byUser.get(key);
    };
    for (const r of surveyAgg) ensure(r._id).surveysSubmitted = r.surveysSubmitted;
    for (const r of activityAgg) {
      const u = ensure(r._id.userId);
      if (r._id.actionType === 'not_home') u.notHome = r.count;
      else if (r._id.actionType === 'wrong_address') u.wrongAddress = r.count;
      else if (r._id.actionType === 'lit_dropped') u.litDropped = r.count;
      else if (r._id.actionType === 'survey_submitted') u.surveyKnocks = r.count;
      if (!u.firstActivityAt || r.firstAt < u.firstActivityAt) u.firstActivityAt = r.firstAt;
      if (!u.lastActivityAt || r.lastAt > u.lastActivityAt) u.lastActivityAt = r.lastAt;
    }
    for (const r of hoursAgg) {
      const u = ensure(r._id);
      u.hoursOnDoors = r.hoursOnDoors;
      u.daysActive = r.daysActive;
    }

    const userIds = Array.from(byUser.keys()).map((id) => new mongoose.Types.ObjectId(id));
    const users = await User.find(
      { _id: { $in: userIds } },
      'firstName lastName email phone isActive'
    ).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const headers = [
      'Rank', 'First name', 'Last name', 'Email', 'Phone', 'Active',
      'Knocks', 'Surveys', 'Lit drops', 'Not home', 'Wrong address',
      'Connection rate %', 'Hours on doors', 'Days active', 'Knocks/hr', 'Surveys/hr',
      'First activity', 'Last activity',
    ];
    const enriched = Array.from(byUser.values())
      .map((u) => {
        const info = userMap.get(u.userId) || {};
        // Billable knocks = distinct (household, pass). Connection = completion knocks / knocks.
        const knocks = u.notHome + u.wrongAddress + u.litDropped + u.surveyKnocks;
        const connection = connectionRate({
          knocks,
          surveyedKnocks: u.surveyKnocks,
          litKnocks: u.litDropped,
        });
        const doorsPerHour = u.hoursOnDoors > 0 ? knocks / u.hoursOnDoors : 0;
        const surveysPerHour = u.hoursOnDoors > 0 ? u.surveysSubmitted / u.hoursOnDoors : 0;
        return {
          ...u,
          firstName: info.firstName || '',
          lastName: info.lastName || '',
          email: info.email || '',
          phone: info.phone || '',
          isActive: info.isActive ?? false,
          knocks,
          connection,
          doorsPerHour,
          surveysPerHour,
        };
      })
      .sort(
        (a, b) =>
          b.surveysSubmitted - a.surveysSubmitted || b.knocks - a.knocks
      );

    const rows = enriched.map((u, i) => [
      i + 1,
      u.firstName,
      u.lastName,
      u.email,
      u.phone,
      u.isActive ? 'yes' : 'no',
      u.knocks,
      u.surveysSubmitted,
      u.litDropped,
      u.notHome,
      u.wrongAddress,
      u.connection,
      Math.round(u.hoursOnDoors * 100) / 100,
      u.daysActive,
      Math.round(u.doorsPerHour * 100) / 100,
      Math.round(u.surveysPerHour * 100) / 100,
      u.firstActivityAt ? new Date(u.firstActivityAt).toISOString() : '',
      u.lastActivityAt ? new Date(u.lastActivityAt).toISOString() : '',
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="canvassers-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(toCsv(headers, rows));
  } catch (err) {
    next(err);
  }
});

// Org-wide averages for the active range. Used for "vs team avg" badges and
// the Compare screen.
router.get('/team-averages', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const cFilter = baseFilter(req);
    const tz = tzOf(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter };

    const [perUserActivity, perUserSurveys, perUserHours] = await Promise.all([
      CanvassActivity.aggregate([
        { $match: { ...activityMatch, actionType: { $in: KNOCK_ACTIONS } } },
        {
          $group: {
            _id: '$userId',
            homesKnocked: { $sum: 1 },
            surveyedKnocks: { $sum: { $cond: [{ $eq: ['$actionType', 'survey_submitted'] }, 1, 0] } },
            litKnocks: { $sum: { $cond: [{ $eq: ['$actionType', 'lit_dropped'] }, 1, 0] } },
          },
        },
      ]),
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        { $group: { _id: '$userId', surveysSubmitted: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { userId: '$userId', day: dayBucketExpr('timestamp', tz) },
            first: { $min: '$timestamp' },
            last: { $max: '$timestamp' },
          },
        },
        {
          $group: {
            _id: '$_id.userId',
            hoursOnDoors: {
              $sum: { $divide: [{ $subtract: ['$last', '$first'] }, 3600000] },
            },
            daysActive: { $sum: 1 },
          },
        },
      ]),
    ]);

    const blank = () => ({ homesKnocked: 0, completionKnocks: 0, surveysSubmitted: 0, hoursOnDoors: 0, daysActive: 0 });
    const byUser = new Map();
    for (const r of perUserActivity) {
      byUser.set(String(r._id), { ...blank(), homesKnocked: r.homesKnocked, completionKnocks: r.surveyedKnocks + r.litKnocks });
    }
    for (const r of perUserSurveys) {
      const k = String(r._id);
      if (!byUser.has(k)) byUser.set(k, blank());
      byUser.get(k).surveysSubmitted = r.surveysSubmitted;
    }
    for (const r of perUserHours) {
      const k = String(r._id);
      if (!byUser.has(k)) byUser.set(k, blank());
      const u = byUser.get(k);
      u.hoursOnDoors = r.hoursOnDoors;
      u.daysActive = r.daysActive;
    }

    const users = Array.from(byUser.values());
    const n = users.length;
    function avg(field) {
      if (!n) return 0;
      return users.reduce((acc, u) => acc + (u[field] || 0), 0) / n;
    }
    function avgRate(num, den) {
      if (!n) return 0;
      const sumN = users.reduce((a, u) => a + (u[num] || 0), 0);
      const sumD = users.reduce((a, u) => a + (u[den] || 0), 0);
      return sumD > 0 ? sumN / sumD : 0;
    }

    const homesKnocked = avg('homesKnocked');
    const surveysSubmitted = avg('surveysSubmitted');
    const hoursOnDoors = avg('hoursOnDoors');
    const daysActive = avg('daysActive');

    res.json({
      canvasserCount: n,
      avg: {
        homesKnocked: Math.round(homesKnocked * 10) / 10,
        surveysSubmitted: Math.round(surveysSubmitted * 10) / 10,
        hoursOnDoors: Math.round(hoursOnDoors * 100) / 100,
        daysActive: Math.round(daysActive * 10) / 10,
        doorsPerHour:
          Math.round(avgRate('homesKnocked', 'hoursOnDoors') * 100) / 100,
        surveysPerHour:
          Math.round(avgRate('surveysSubmitted', 'hoursOnDoors') * 100) / 100,
        connectionRatePct:
          Math.round(avgRate('completionKnocks', 'homesKnocked') * 1000) / 10,
      },
    });
  } catch (err) {
    next(err);
  }
});

// One-shot summary for the per-canvasser Overview screen.
router.get('/canvassers/:userId/summary', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    const tz = tzOf(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter, userId };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId };

    const knockMatch = { ...activityMatch, actionType: { $in: KNOCK_ACTIONS } };

    const [user, memberships, actionAgg, hourAgg, dowAgg, dailyAgg, surveysCount, qualityAgg, distanceHist] =
      await Promise.all([
        User.findById(userId, 'firstName lastName email phone isActive lastLoginAt').lean(),
        Membership.find({ userId, organizationId: orgId }, 'role isActive').lean(),
        CanvassActivity.aggregate([
          { $match: activityMatch },
          { $group: { _id: '$actionType', count: { $sum: 1 } } },
        ]),
        CanvassActivity.aggregate([
          { $match: knockMatch },
          {
            $group: {
              _id: { $hour: { date: '$timestamp', timezone: tz } },
              count: { $sum: 1 },
            },
          },
        ]),
        CanvassActivity.aggregate([
          { $match: knockMatch },
          {
            $group: {
              _id: { $dayOfWeek: { date: '$timestamp', timezone: tz } },
              count: { $sum: 1 },
            },
          },
        ]),
        CanvassActivity.aggregate([
          { $match: knockMatch },
          {
            $group: {
              _id: dayBucketExpr('timestamp', tz),
              homesKnocked: { $sum: 1 },
              first: { $min: '$timestamp' },
              last: { $max: '$timestamp' },
            },
          },
          { $sort: { _id: -1 } },
        ]),
        SurveyResponse.countDocuments(surveyMatch),
        CanvassActivity.aggregate([
          { $match: activityMatch },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              offlineCount: { $sum: { $cond: ['$wasOfflineSubmission', 1, 0] } },
              avgDistance: { $avg: '$distanceFromHouseMeters' },
              farCount: {
                $sum: {
                  $cond: [{ $gt: ['$distanceFromHouseMeters', 50] }, 1, 0],
                },
              },
              firstActivityAt: { $min: '$timestamp' },
              lastActivityAt: { $max: '$timestamp' },
            },
          },
        ]),
        CanvassActivity.aggregate([
          { $match: activityMatch },
          {
            $bucket: {
              groupBy: { $ifNull: ['$distanceFromHouseMeters', -1] },
              boundaries: [-1, 0, 10, 25, 50, 100, 1000000],
              default: 'unknown',
              output: { count: { $sum: 1 } },
            },
          },
        ]),
      ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const actions = { not_home: 0, wrong_address: 0, survey_submitted: 0, lit_dropped: 0, note_added: 0 };
    for (const r of actionAgg) actions[r._id] = r.count;
    const homesKnocked =
      actions.not_home + actions.wrong_address + actions.survey_submitted + actions.lit_dropped;

    const surveysSubmitted = surveysCount;

    // Per-day shift sum
    const dailySorted = [...dailyAgg].sort((a, b) => (a._id < b._id ? -1 : 1));
    let hoursOnDoors = 0;
    for (const d of dailySorted) {
      const ms = new Date(d.last) - new Date(d.first);
      hoursOnDoors += ms / 3600000;
    }
    const daysActive = dailySorted.length;

    // Best day (by homesKnocked)
    let bestDay = null;
    for (const d of dailySorted) {
      if (!bestDay || d.homesKnocked > bestDay.homesKnocked) {
        bestDay = { date: d._id, homesKnocked: d.homesKnocked };
      }
    }

    // Current streak — count consecutive days ending at "today (tz)" or last active day
    // working backwards.
    function dayKey(date) {
      return new Date(date).toLocaleDateString('en-CA', { timeZone: tz });
    }
    const dayKeys = new Set(dailySorted.map((d) => d._id));
    let streak = 0;
    let cursor = new Date();
    for (let i = 0; i < 365; i++) {
      const k = dayKey(cursor);
      if (dayKeys.has(k)) streak += 1;
      else if (i === 0) {
        // skip today if no activity, allow streak to be measured from yesterday
      } else break;
      cursor = new Date(cursor.getTime() - 86400000);
    }

    const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    for (const r of hourAgg) hourBuckets[r._id].count = r.count;

    // mongo's $dayOfWeek is 1=Sun..7=Sat; expose 0=Sun..6=Sat
    const dowBuckets = Array.from({ length: 7 }, (_, i) => ({ dow: i, count: 0 }));
    for (const r of dowAgg) dowBuckets[r._id - 1].count = r.count;

    const lastSevenDays = dailySorted.slice(-7).map((d) => ({
      date: d._id,
      homesKnocked: d.homesKnocked,
      hoursOnDoors: Math.round(((new Date(d.last) - new Date(d.first)) / 3600000) * 100) / 100,
      firstActivityAt: d.first,
      lastActivityAt: d.last,
    }));

    const qual = qualityAgg[0] || {
      total: 0,
      offlineCount: 0,
      avgDistance: null,
      farCount: 0,
      firstActivityAt: null,
      lastActivityAt: null,
    };

    const distanceHistogram = [
      { bucket: '0-10m', count: 0 },
      { bucket: '10-25m', count: 0 },
      { bucket: '25-50m', count: 0 },
      { bucket: '50-100m', count: 0 },
      { bucket: '100m+', count: 0 },
      { bucket: 'unknown', count: 0 },
    ];
    const bucketIndex = { 0: 0, 10: 1, 25: 2, 50: 3, 100: 4 };
    for (const b of distanceHist) {
      if (b._id === 'unknown' || b._id === -1) distanceHistogram[5].count += b.count;
      else if (bucketIndex[b._id] !== undefined) distanceHistogram[bucketIndex[b._id]].count = b.count;
    }

    const doorsPerHour = hoursOnDoors > 0 ? homesKnocked / hoursOnDoors : 0;
    const surveysPerHour = hoursOnDoors > 0 ? surveysSubmitted / hoursOnDoors : 0;
    const avgMinutesPerDoor =
      homesKnocked > 0 && hoursOnDoors > 0 ? (hoursOnDoors * 60) / homesKnocked : 0;
    // Of this canvasser's knocks, how many landed a completion action (survey/lit). The
    // numerator is door-pass-level (survey_submitted/lit_dropped activities), so it caps at 100%.
    const connectionRatePct =
      homesKnocked > 0
        ? ((actions.survey_submitted + actions.lit_dropped) / homesKnocked) * 100
        : 0;

    res.json({
      user: {
        id: String(user._id),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || null,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
      },
      memberships: memberships.map((m) => ({
        role: m.role,
        isActive: m.isActive,
      })),
      range: {
        from: req.query.from || null,
        to: req.query.to || null,
        tz,
      },
      kpi: {
        homesKnocked,
        surveysSubmitted,
        litDropped: actions.lit_dropped,
        notHome: actions.not_home,
        wrongAddress: actions.wrong_address,
        notesAdded: actions.note_added,
        connectionRatePct: Math.round(connectionRatePct * 10) / 10,
        hoursOnDoors: Math.round(hoursOnDoors * 100) / 100,
        daysActive,
        doorsPerHour: Math.round(doorsPerHour * 100) / 100,
        surveysPerHour: Math.round(surveysPerHour * 100) / 100,
        avgMinutesPerDoor: Math.round(avgMinutesPerDoor * 10) / 10,
      },
      highlights: {
        bestDay,
        currentStreak: streak,
        firstActivityAt: qual.firstActivityAt,
        lastActivityAt: qual.lastActivityAt,
      },
      hourDistribution: hourBuckets,
      dayOfWeekDistribution: dowBuckets,
      lastSevenDays,
      quality: {
        totalActivities: qual.total,
        offlineCount: qual.offlineCount,
        offlinePercent:
          qual.total > 0 ? Math.round((qual.offlineCount / qual.total) * 1000) / 10 : 0,
        avgDistanceFromHouseMeters:
          qual.avgDistance != null ? Math.round(qual.avgDistance * 10) / 10 : null,
        farFromHouseCount: qual.farCount,
        farFromHousePercent:
          qual.total > 0 ? Math.round((qual.farCount / qual.total) * 1000) / 10 : 0,
        distanceHistogram,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Per-day breakdown across the active range.
router.get('/canvassers/:userId/daily', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const tz = tzOf(req);
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter, userId };
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId };

    const [activityDaily, surveyDaily] = await Promise.all([
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: { day: dayBucketExpr('timestamp', tz), actionType: '$actionType' },
            count: { $sum: 1 },
            first: { $min: '$timestamp' },
            last: { $max: '$timestamp' },
          },
        },
      ]),
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        {
          $group: {
            _id: dayBucketExpr('submittedAt', tz),
            surveysSubmitted: { $sum: 1 },
          },
        },
      ]),
    ]);

    const byDay = new Map();
    const ensure = (date) => {
      if (!byDay.has(date)) {
        byDay.set(date, {
          date,
          surveysSubmitted: 0,
          surveyKnocks: 0,
          notHome: 0,
          wrongAddress: 0,
          litDropped: 0,
          notesAdded: 0,
          homesKnocked: 0,
          firstActivityAt: null,
          lastActivityAt: null,
        });
      }
      return byDay.get(date);
    };
    for (const r of activityDaily) {
      const d = ensure(r._id.day);
      const at = r._id.actionType;
      if (at === 'not_home') d.notHome = r.count;
      else if (at === 'wrong_address') d.wrongAddress = r.count;
      else if (at === 'lit_dropped') d.litDropped = r.count;
      else if (at === 'note_added') d.notesAdded = r.count;
      else if (at === 'survey_submitted') d.surveyKnocks = r.count;
      if (KNOCK_ACTIONS.includes(at)) d.homesKnocked += r.count;
      if (!d.firstActivityAt || r.first < d.firstActivityAt) d.firstActivityAt = r.first;
      if (!d.lastActivityAt || r.last > d.lastActivityAt) d.lastActivityAt = r.last;
    }
    for (const r of surveyDaily) {
      const d = ensure(r._id);
      d.surveysSubmitted = r.surveysSubmitted;
    }

    const rows = Array.from(byDay.values())
      .map((d) => {
        const hoursOnDoors =
          d.firstActivityAt && d.lastActivityAt
            ? (new Date(d.lastActivityAt) - new Date(d.firstActivityAt)) / 3600000
            : 0;
        const connectionRatePct =
          d.homesKnocked > 0
            ? ((d.surveyKnocks + d.litDropped) / d.homesKnocked) * 100
            : 0;
        return {
          ...d,
          hoursOnDoors: Math.round(hoursOnDoors * 100) / 100,
          connectionRatePct: Math.round(connectionRatePct * 10) / 10,
          doorsPerHour:
            hoursOnDoors > 0 ? Math.round((d.homesKnocked / hoursOnDoors) * 100) / 100 : 0,
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    res.json({ days: rows, tz });
  } catch (err) {
    next(err);
  }
});

// Paginated raw activity feed. Supports actionType, flaggedOnly, order.
router.get('/canvassers/:userId/activities', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'timestamp');
    const filter = { ...dateRange, ...cFilter, userId };

    if (req.query.actionType) {
      const types = String(req.query.actionType).split(',');
      filter.actionType = { $in: types };
    }
    if (req.query.flaggedOnly === 'true') {
      filter.$or = [
        { wasOfflineSubmission: true },
        { distanceFromHouseMeters: { $gt: 50 } },
      ];
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const order = req.query.order === 'asc' ? 1 : -1;

    const [total, activities] = await Promise.all([
      CanvassActivity.countDocuments(filter),
      CanvassActivity.find(filter)
        .sort({ timestamp: order })
        .skip(skip)
        .limit(limit)
        .populate('householdId', 'addressLine1 addressLine2 city state zipCode')
        .populate('voterId', 'fullName party')
        .lean(),
    ]);

    res.json({
      total,
      limit,
      skip,
      activities: activities.map((a) => ({
        id: String(a._id),
        actionType: a.actionType,
        timestamp: a.timestamp,
        note: a.note || null,
        location: a.location,
        distanceFromHouseMeters: a.distanceFromHouseMeters,
        wasOfflineSubmission: !!a.wasOfflineSubmission,
        household: a.householdId
          ? {
              id: String(a.householdId._id),
              addressLine1: a.householdId.addressLine1,
              addressLine2: a.householdId.addressLine2 || null,
              city: a.householdId.city,
              state: a.householdId.state,
              zipCode: a.householdId.zipCode,
            }
          : null,
        voter: a.voterId
          ? {
              id: String(a.voterId._id),
              fullName: a.voterId.fullName,
              party: a.voterId.party || null,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Distinct households this canvasser interacted with in range.
router.get('/canvassers/:userId/households', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'timestamp');
    const match = { ...dateRange, ...cFilter, userId };

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: '$householdId',
          visits: { $sum: 1 },
          firstAt: { $min: '$timestamp' },
          lastAt: { $max: '$timestamp' },
          actionTypes: { $addToSet: '$actionType' },
          lastAction: { $last: '$actionType' },
        },
      },
      { $sort: { lastAt: -1 } },
    ];
    const all = await CanvassActivity.aggregate(pipeline);

    const householdIds = all.map((r) => r._id);
    const orgId = activeOrgId(req);
    let households = await Household.find(
      { _id: { $in: householdIds }, organizationId: orgId },
      'addressLine1 addressLine2 city state zipCode status'
    ).lean();

    // Optional address search
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      households = households.filter((h) =>
        `${h.addressLine1} ${h.city} ${h.state} ${h.zipCode}`.toLowerCase().includes(q)
      );
    }
    const hMap = new Map(households.map((h) => [String(h._id), h]));

    const enriched = all
      .map((r) => {
        const h = hMap.get(String(r._id));
        if (!h) return null;
        return {
          household: {
            id: String(h._id),
            addressLine1: h.addressLine1,
            addressLine2: h.addressLine2 || null,
            city: h.city,
            state: h.state,
            zipCode: h.zipCode,
            status: h.status,
          },
          visits: r.visits,
          firstAt: r.firstAt,
          lastAt: r.lastAt,
          actionTypes: r.actionTypes,
          finalAction: r.lastAction,
        };
      })
      .filter(Boolean);

    res.json({
      total: enriched.length,
      limit,
      skip,
      households: enriched.slice(skip, skip + limit),
    });
  } catch (err) {
    next(err);
  }
});

// Voters surveyed by this canvasser, with demographic mix summary.
router.get('/canvassers/:userId/voters', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'submittedAt');
    const filter = { ...dateRange, ...cFilter, userId };

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const [total, responses] = await Promise.all([
      SurveyResponse.countDocuments(filter),
      SurveyResponse.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('voterId', 'fullName party gender dateOfBirth')
        .populate('householdId', 'addressLine1 city state')
        .lean(),
    ]);

    // Party + gender breakdown over the full set (not just the page)
    const [partyAgg, genderAgg] = await Promise.all([
      SurveyResponse.aggregate([
        { $match: filter },
        { $lookup: { from: 'voters', localField: 'voterId', foreignField: '_id', as: 'v' } },
        { $unwind: '$v' },
        { $group: { _id: '$v.party', count: { $sum: 1 } } },
      ]),
      SurveyResponse.aggregate([
        { $match: filter },
        { $lookup: { from: 'voters', localField: 'voterId', foreignField: '_id', as: 'v' } },
        { $unwind: '$v' },
        { $group: { _id: '$v.gender', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      total,
      limit,
      skip,
      partyBreakdown: partyAgg.map((p) => ({ value: p._id || 'Unknown', count: p.count })),
      genderBreakdown: genderAgg.map((g) => ({ value: g._id || 'Unknown', count: g.count })),
      voters: responses.map((r) => ({
        responseId: String(r._id),
        submittedAt: r.submittedAt,
        voter: r.voterId
          ? {
              id: String(r.voterId._id),
              fullName: r.voterId.fullName,
              party: r.voterId.party || null,
              gender: r.voterId.gender || null,
              dateOfBirth: r.voterId.dateOfBirth || null,
            }
          : null,
        household: r.householdId
          ? {
              id: String(r.householdId._id),
              addressLine1: r.householdId.addressLine1,
              city: r.householdId.city,
              state: r.householdId.state,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// All notes left by this canvasser — union of activity notes and survey notes.
router.get('/canvassers/:userId/notes', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);

    const [activityNotes, surveyNotes] = await Promise.all([
      CanvassActivity.find(
        {
          ...parseDateRange(req, 'timestamp'),
          ...cFilter,
          userId,
          note: { $exists: true, $ne: null, $not: /^\s*$/ },
        },
        '_id note timestamp actionType householdId voterId'
      )
        .populate('householdId', 'addressLine1 city state')
        .populate('voterId', 'fullName')
        .sort({ timestamp: -1 })
        .lean(),
      SurveyResponse.find(
        {
          ...parseDateRange(req, 'submittedAt'),
          ...cFilter,
          userId,
          note: { $exists: true, $ne: null, $not: /^\s*$/ },
        },
        '_id note submittedAt householdId voterId'
      )
        .populate('householdId', 'addressLine1 city state')
        .populate('voterId', 'fullName')
        .sort({ submittedAt: -1 })
        .lean(),
    ]);

    const merged = [
      ...activityNotes.map((a) => ({
        source: 'activity',
        id: String(a._id),
        note: a.note,
        timestamp: a.timestamp,
        actionType: a.actionType,
        household: a.householdId
          ? {
              id: String(a.householdId._id),
              addressLine1: a.householdId.addressLine1,
              city: a.householdId.city,
              state: a.householdId.state,
            }
          : null,
        voter: a.voterId
          ? { id: String(a.voterId._id), fullName: a.voterId.fullName }
          : null,
      })),
      ...surveyNotes.map((s) => ({
        source: 'survey',
        id: String(s._id),
        note: s.note,
        timestamp: s.submittedAt,
        actionType: 'survey_submitted',
        household: s.householdId
          ? {
              id: String(s.householdId._id),
              addressLine1: s.householdId.addressLine1,
              city: s.householdId.city,
              state: s.householdId.state,
            }
          : null,
        voter: s.voterId
          ? { id: String(s.voterId._id), fullName: s.voterId.fullName }
          : null,
      })),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ total: merged.length, notes: merged });
  } catch (err) {
    next(err);
  }
});

// Lat/lng + action points for map drawing.
router.get('/canvassers/:userId/path', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'timestamp');
    const filter = { ...dateRange, ...cFilter, userId };

    if (req.query.actionType) {
      filter.actionType = { $in: String(req.query.actionType).split(',') };
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 1000, 1), 5000);

    const points = await CanvassActivity.find(filter, {
      timestamp: 1,
      actionType: 1,
      location: 1,
      distanceFromHouseMeters: 1,
      householdId: 1,
      wasOfflineSubmission: 1,
    })
      .sort({ timestamp: 1 })
      .limit(limit)
      .populate('householdId', 'addressLine1 city state')
      .lean();

    res.json({
      total: points.length,
      points: points.map((p) => ({
        id: String(p._id),
        lat: p.location?.lat,
        lng: p.location?.lng,
        accuracy: p.location?.accuracy ?? null,
        timestamp: p.timestamp,
        actionType: p.actionType,
        distanceFromHouseMeters: p.distanceFromHouseMeters,
        wasOfflineSubmission: !!p.wasOfflineSubmission,
        household: p.householdId
          ? {
              id: String(p.householdId._id),
              addressLine1: p.householdId.addressLine1,
              city: p.householdId.city,
              state: p.householdId.state,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Geo + sync quality audit.
router.get('/canvassers/:userId/quality', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId };
    const surveyMatch = { ...parseDateRange(req, 'submittedAt'), ...cFilter, userId };

    const [distAgg, offlineAgg, syncAgg, flaggedList, lastSync] = await Promise.all([
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $bucket: {
            groupBy: { $ifNull: ['$distanceFromHouseMeters', -1] },
            boundaries: [-1, 0, 10, 25, 50, 100, 1000000],
            default: 'unknown',
            output: { count: { $sum: 1 } },
          },
        },
      ]),
      CanvassActivity.aggregate([
        { $match: activityMatch },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            offlineCount: { $sum: { $cond: ['$wasOfflineSubmission', 1, 0] } },
            avgDistance: { $avg: '$distanceFromHouseMeters' },
            farCount: {
              $sum: {
                $cond: [{ $gt: ['$distanceFromHouseMeters', 50] }, 1, 0],
              },
            },
          },
        },
      ]),
      SurveyResponse.aggregate([
        { $match: surveyMatch },
        {
          $project: {
            lagMs: { $subtract: ['$syncedAt', '$submittedAt'] },
            wasOfflineSubmission: 1,
          },
        },
        {
          $bucket: {
            groupBy: '$lagMs',
            boundaries: [-1, 1000, 60000, 600000, 3600000, 1e15],
            default: 'unknown',
            output: { count: { $sum: 1 } },
          },
        },
      ]),
      CanvassActivity.find(
        {
          ...activityMatch,
          $or: [
            { wasOfflineSubmission: true },
            { distanceFromHouseMeters: { $gt: 50 } },
          ],
        },
        '_id actionType timestamp wasOfflineSubmission distanceFromHouseMeters householdId location'
      )
        .populate('householdId', 'addressLine1 city state')
        .sort({ timestamp: -1 })
        .limit(100)
        .lean(),
      SurveyResponse.findOne(surveyMatch, 'syncedAt').sort({ syncedAt: -1 }).lean(),
    ]);

    const distanceHistogram = [
      { bucket: '0-10m', count: 0 },
      { bucket: '10-25m', count: 0 },
      { bucket: '25-50m', count: 0 },
      { bucket: '50-100m', count: 0 },
      { bucket: '100m+', count: 0 },
      { bucket: 'unknown', count: 0 },
    ];
    const bucketIndex = { 0: 0, 10: 1, 25: 2, 50: 3, 100: 4 };
    for (const b of distAgg) {
      if (b._id === 'unknown' || b._id === -1) distanceHistogram[5].count += b.count;
      else if (bucketIndex[b._id] !== undefined) distanceHistogram[bucketIndex[b._id]].count = b.count;
    }

    const syncLagLabels = ['<1s (immediate)', '1s–1m', '1m–10m', '10m–1h', '1h+'];
    const syncLagHistogram = syncLagLabels.map((label) => ({ bucket: label, count: 0 }));
    const syncIndex = { '-1': 0, '1000': 1, '60000': 2, '600000': 3, '3600000': 4 };
    for (const b of syncAgg) {
      const idx = syncIndex[String(b._id)];
      if (idx !== undefined) syncLagHistogram[idx].count = b.count;
    }

    const q = offlineAgg[0] || {
      total: 0,
      offlineCount: 0,
      avgDistance: null,
      farCount: 0,
    };

    res.json({
      totalActivities: q.total,
      offlineCount: q.offlineCount,
      offlinePercent: q.total > 0 ? Math.round((q.offlineCount / q.total) * 1000) / 10 : 0,
      avgDistanceFromHouseMeters:
        q.avgDistance != null ? Math.round(q.avgDistance * 10) / 10 : null,
      farFromHouseCount: q.farCount,
      farFromHousePercent:
        q.total > 0 ? Math.round((q.farCount / q.total) * 1000) / 10 : 0,
      distanceHistogram,
      syncLagHistogram,
      lastSyncAt: lastSync?.syncedAt || null,
      flaggedActivities: flaggedList.map((a) => ({
        id: String(a._id),
        actionType: a.actionType,
        timestamp: a.timestamp,
        wasOfflineSubmission: !!a.wasOfflineSubmission,
        distanceFromHouseMeters: a.distanceFromHouseMeters,
        location: a.location,
        household: a.householdId
          ? {
              id: String(a.householdId._id),
              addressLine1: a.householdId.addressLine1,
              city: a.householdId.city,
              state: a.householdId.state,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Per-canvasser activity CSV export.
router.get('/canvassers/:userId/export.csv', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const userId = parseUserIdParam(req, res);
    if (!userId) return;
    const cFilter = baseFilter(req);
    const filter = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId };

    const activities = await CanvassActivity.find(filter, {
      timestamp: 1,
      actionType: 1,
      note: 1,
      location: 1,
      distanceFromHouseMeters: 1,
      wasOfflineSubmission: 1,
      householdId: 1,
      voterId: 1,
    })
      .sort({ timestamp: 1 })
      .populate('householdId', 'addressLine1 addressLine2 city state zipCode')
      .populate('voterId', 'fullName party')
      .lean();

    const headers = [
      'Timestamp', 'Action', 'Address', 'City', 'State', 'Zip', 'Voter', 'Party',
      'Latitude', 'Longitude', 'Accuracy (m)', 'Distance from house (m)',
      'Offline submission', 'Note',
    ];
    const rows = activities.map((a) => [
      new Date(a.timestamp).toISOString(),
      a.actionType,
      a.householdId?.addressLine1 || '',
      a.householdId?.city || '',
      a.householdId?.state || '',
      a.householdId?.zipCode || '',
      a.voterId?.fullName || '',
      a.voterId?.party || '',
      a.location?.lat ?? '',
      a.location?.lng ?? '',
      a.location?.accuracy ?? '',
      a.distanceFromHouseMeters ?? '',
      a.wasOfflineSubmission ? 'yes' : 'no',
      a.note || '',
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="canvasser-${userId}-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(toCsv(headers, rows));
  } catch (err) {
    next(err);
  }
});

export default router;
