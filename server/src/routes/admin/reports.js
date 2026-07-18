import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds, canManageCampaign } from '../../services/authz/campaignManagement.js';
import { Campaign } from '../../models/Campaign.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { choiceKeyStages, mergeOptionRows, voterAnswerClause, answerTagClause } from '../../services/surveys/answerAgg.js';
import { tagOptionMap, normalizeTag } from '../../services/surveys/tags.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Organization } from '../../models/Organization.js';
import { zonedDayRange, tzAbbrev, zonedDayStr } from '../../utils/timezone.js';
import {
  KNOCK_ACTIONS,
  NOT_BULK,
  knocksPipeline,
  connectionRate,
  contactRate,
  coverageBucketExpr,
  teamFoldStage,
} from '../../services/reports/aggregations.js';
import { campaignSummaries } from '../../services/reports/campaignSummaries.js';
import { computeOverlaps } from '../../services/reports/overlaps.js';
import { hydrateCanvassers } from '../../services/reports/canvasserIdentity.js';
import { detectFlags } from '../../services/audit/flagDetection.js';
import { FLAG_THRESHOLDS, SEVERITY_RANK, AUDIT_WINDOW_MAX_DAYS } from '../../services/audit/flagThresholds.js';
import { FlagReview } from '../../models/FlagReview.js';
import { VoterNote } from '../../models/VoterNote.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

// Shared "far knock" threshold — the legacy far-counts/flagged feeds and the new GPS audit
// all key off ONE number (services/audit/flagThresholds.js), so "far" means one thing.
const FAR_WARN_M = FLAG_THRESHOLDS.FAR_WARN_M;

// Reports are campaign-scoped via ?campaignId. Historically baseFilter trusted any
// campaignId with no ownership check. Team leads may pull reports ONLY for a campaign
// they manage — and never org-wide (no campaignId), which would span other campaigns.
// Admins/super stay unscoped. (This also closes the trust-any-campaignId gap.)
router.use(async (req, res, next) => {
  try {
    if (isOrgAdmin(req)) return next();
    // The cross-campaign rollup is the lead's campaign LIST (e.g. the mobile admin
    // landing). It self-scopes to their managed campaigns below, so it's allowed
    // without a single campaignId — unlike every other (per-campaign) report.
    if (req.path === '/campaign-rollup') return next();
    const campaignId = req.query.campaignId;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(403).json({ error: 'A team lead must scope reports to a campaign they manage.' });
    }
    if (!(await canManageCampaign(req, campaignId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  } catch (err) {
    next(err);
  }
});

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

// Optional TEAM (coordinator) scoping — deliberately NOT part of baseFilter().
//
// baseFilter's result is spread into HOUSEHOLD queries (see /overview: `{ isActive: true,
// ...cFilter }`), and a household has no team — a door doesn't belong to a crew. Putting the key
// there would make every household query match zero documents and silently ZERO OUT Coverage.
// effortId only gets away with living in baseFilter because it IS denormalized onto Household.
//
// So this is opt-in, and is spread ONLY into CanvassActivity / SurveyResponse matches.
//
//   ?coordinatorId=<id>   → that team
//   ?coordinatorId=none   → the "No team" bucket (a candidate knocking their own district, etc.)
//
// A team is its crew PLUS THE LEAD'S OWN DOORS. `coordinatorId` answers "who oversees me", so a
// lead's own knocks stamp *their* coordinator (usually nobody) and would otherwise fall into the
// No-team bucket — the lead would be missing from their own team's number. Hence the $or.
// `none` then has to exclude the leads, or their doors would be counted twice.
export function teamMatch(coordinatorId, allLeadIds = []) {
  if (!coordinatorId) return {};
  if (coordinatorId === 'none') {
    return allLeadIds.length
      ? { coordinatorId: null, userId: { $nin: allLeadIds } }
      : { coordinatorId: null };
  }
  const id = new mongoose.Types.ObjectId(String(coordinatorId));
  return { $or: [{ coordinatorId: id }, { userId: id, coordinatorId: null }] };
}

// The users who are somebody's coordinator in this org — i.e. the set of team leads. Needed so the
// "No team" bucket can exclude them (their own doors belong to their own team, above).
async function leadIdsForOrg(orgId) {
  const ids = await Membership.distinct('coordinatorId', {
    organizationId: orgId,
    coordinatorId: { $ne: null },
  });
  return ids;
}

// teamFoldStage lives in services/reports/aggregations.js (imported below) — the audit script needs
// the identical fold, and an audit that can be wrong in the same way as the thing it audits is
// worth nothing.

// The Coordinator label for a canvasser row, resolved from the LEDGER's stamped team ids — never
// from the campaign roster, whose join blanked the column (and dropped the person from their team's
// totals) the moment somebody was taken off a campaign. Takes Map<userId, Set<teamId|null>>, returns
// Map<userId, {coordinatorId, coordinatorName}>. Someone who knocked for two teams in the window
// reads 'Multiple' rather than a silently-picked winner — the by-team breakdown splits their doors
// correctly either way. Shared by /canvasser-timeline and /canvassers so the Timeline and the Home
// leaderboard can never disagree about the same person again.
async function ledgerCoordinatorLabels(coordSetsByUser) {
  const teamIds = [
    ...new Set([...coordSetsByUser.values()].flatMap((s) => [...s]).filter(Boolean)),
  ];
  const teamUsers = teamIds.length
    ? await User.find({ _id: { $in: teamIds } }, 'firstName lastName').lean()
    : [];
  const nameById = new Map(teamUsers.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  const out = new Map();
  for (const [uid, set] of coordSetsByUser) {
    const teams = [...set].filter(Boolean);
    out.set(uid, {
      coordinatorId: teams.length === 1 ? teams[0] : null,
      coordinatorName:
        teams.length > 1 ? 'Multiple' : teams.length === 1 ? nameById.get(teams[0]) || null : null,
    });
  }
  return out;
}

// Resolve ?coordinatorId into a match object, or {} when no team scope was requested.
async function crewFilter(req) {
  const raw = req.query.coordinatorId;
  if (!raw) return {};
  if (raw !== 'none' && !mongoose.isValidObjectId(raw)) return {};
  const leads = raw === 'none' ? await leadIdsForOrg(activeOrgId(req)) : [];
  return teamMatch(raw, leads);
}

// Merge a team clause into a match. NEVER spread it — teamMatch can return `$or`, and a plain
// spread would clobber any `$or` the match already carries (the cross-timezone date windows build
// one). $and composes safely no matter what either side contains.
function withTeam(match, team) {
  if (!team || !Object.keys(team).length) return match;
  if (!team.$or) return { ...match, ...team };
  return { ...match, $and: [...(match.$and || []), { $or: team.$or }] };
}

// KNOCK_ACTIONS, knocksPipeline, connectionRate, coverageBucketExpr now live in
// services/reports/aggregations.js (shared with the client report builder).

// Parse a csv query param into a Set of allowed values, or null when absent/empty (= no filter).
function csvSet(value, allowed) {
  if (value == null) return null;
  const set = new Set(
    String(value)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => allowed.includes(s))
  );
  return set.size ? set : null;
}

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

    // Stats substitution for the two whole-ledger reads (billable knocks + survey volume):
    // /overview never has a date window, so when the scope is org- or campaign-wide (no effortId)
    // and every campaign in scope carries trusted Campaign.stats, sum the maintained counters
    // instead of re-aggregating. The per-actionType event breakdown and the DISTINCT surveyed-voter
    // count have no scalar-counter equivalent and stay live. Any unseeded legacy campaign
    // (stats.reconciledAt null) drops the whole scope back to the live pipelines.
    let statTotals = null;
    if (!cFilter.effortId) {
      const scopeFilter = cFilter.campaignId ? { _id: cFilter.campaignId } : { organizationId: orgId };
      const statDocs = await Campaign.find(scopeFilter, { stats: 1 }).lean();
      if (statDocs.length && statDocs.every((d) => d.stats?.reconciledAt)) {
        statTotals = statDocs.reduce(
          (acc, d) => ({
            knocks: acc.knocks + (d.stats.knockCount || 0),
            surveyedKnocks: acc.surveyedKnocks + (d.stats.surveyedKnockCount || 0),
            litKnocks: acc.litKnocks + (d.stats.litKnockCount || 0),
            refusedKnocks: acc.refusedKnocks + (d.stats.refusedKnockCount || 0),
            surveysSubmitted: acc.surveysSubmitted + (d.stats.surveyCount || 0),
          }),
          { knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0, surveysSubmitted: 0 }
        );
      }
    }

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
      statTotals ? statTotals.surveysSubmitted : SurveyResponse.countDocuments(cFilter),
      SurveyResponse.distinct('voterId', cFilter),
      Household.countDocuments({ ...householdMatch, status: { $nin: ['unknocked', 'restricted'] } }),
      Household.aggregate([
        { $match: householdMatch },
        { $group: { _id: coverageBucketExpr, count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: cFilter },
        { $group: { _id: '$actionType', count: { $sum: 1 } } },
      ]),
      // Billable knocks: distinct (household, pass). See knocksPipeline.
      statTotals ? [] : CanvassActivity.aggregate(knocksPipeline(cFilter)),
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
      refused: 0,
      lit_dropped: 0,
      restricted: 0, // inaccessible homes — its own coverage segment, not "knocked"
      voted: 0,
      dnc: 0, // fully do-not-contact doors — suppressed, never to be knocked
    };
    for (const r of statusAgg) canvass[r._id] = r.count;

    const events = { notHome: 0, wrongAddress: 0, surveySubmitted: 0, litDropped: 0, refused: 0, restricted: 0 };
    for (const r of eventAgg) {
      if (r._id === 'not_home') events.notHome = r.count;
      else if (r._id === 'wrong_address') events.wrongAddress = r.count;
      else if (r._id === 'survey_submitted') events.surveySubmitted = r.count;
      else if (r._id === 'lit_dropped') events.litDropped = r.count;
      else if (r._id === 'refused') events.refused = r.count;
      else if (r._id === 'restricted') events.restricted = r.count;
    }

    const k = statTotals || knockAgg[0] || { knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0 };
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
        refusedKnocks: k.refusedKnocks,
        connectionRate: connectionRate(k),
        contactRate: contactRate(k),
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

    // A team lead's rollup covers only the campaigns they manage — intersect the
    // requested campaignId (must be managed) or restrict the whole list to the grant set.
    if (!isOrgAdmin(req)) {
      const managed = (await managedCampaignIds(req)).map(String);
      if (req.query.campaignId) {
        if (!managed.includes(String(req.query.campaignId))) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      } else {
        filter._id = { $in: managed.map((id) => new mongoose.Types.ObjectId(id)) };
      }
    }

    const campaigns = await Campaign.find(filter, { name: 1, type: 1, isActive: 1, timeZone: 1, surveyTemplateId: 1, electionDay: 1, earlyVotingStart: 1, earlyVotingEnd: 1, datesNote: 1, stats: 1 }).lean();
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
          refusedKnocks: 0,
          surveysSubmitted: 0,
          surveyedVoters: 0,
          litDropped: 0,
          connectionRate: 0,
          contactRate: 0,
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

    // All-time, whole-campaign scope with every campaign's stats trusted → read the
    // CanvassActivity numbers straight off Campaign.stats (maintained write-side by
    // services/reports/campaignCounters.js) and skip every CanvassActivity aggregation below.
    // Any date window, effort scoping, or unseeded legacy campaign (stats.reconciledAt null,
    // pre-migrate:campaign-stats) falls back to the live pipelines — stats are exact or unused,
    // never approximate.
    const useStats =
      !fromDay && !toDay && !req.query.effortId && campaigns.every((c) => c.stats?.reconciledAt);

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
        useStats
          ? []
          : CanvassActivity.aggregate([
              { $match: activityMatch },
              {
                $group: {
                  _id: { campaignId: '$campaignId', actionType: '$actionType' },
                  count: { $sum: 1 },
                },
              },
            ]),
        // Billable knocks per campaign: distinct (household, pass). See knocksPipeline.
        useStats ? [] : CanvassActivity.aggregate(knocksPipeline(activityMatch, { byCampaign: true })),
        // Surveys (volume) + surveyed voters (distinct) per campaign, from SurveyResponse.
        // Stays live even with stats: surveyedVoters is a DISTINCT-voter count, which a
        // maintained scalar counter can't represent.
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
        useStats
          ? []
          : CanvassActivity.aggregate([
              // NOT_BULK: an admin's bulk restrict must not count them as an
              // "active canvasser" on the campaign card. The event tallies above
              // deliberately stay inclusive (campaign-scope counts are truthful).
              { $match: { ...activityMatch, ...NOT_BULK } },
              {
                $group: {
                  _id: '$campaignId',
                  users: { $addToSet: '$userId' },
                  last: { $max: '$timestamp' },
                },
              },
              { $project: { activeCanvassers: { $size: '$users' }, last: 1 } },
            ]),
        useStats ? [] : CanvassActivity.distinct('userId', { ...activityMatch, ...NOT_BULK }),
      ]);

    // Per-campaign setup progress + management flags (campaign-wide; independent of
    // the date/effort activity window above) — one shared helper so the list cards,
    // the Campaigns page, and the dashboard hub all agree.
    const summaries = await campaignSummaries({ organizationId, campaigns });

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
          refused: 0,
          lit_dropped: 0,
          restricted: 0,
          voted: 0,
          dnc: 0,
        },
        surveysSubmitted: 0,
        surveyedVoters: 0,
        litDropped: 0,
        knocks: 0,
        surveyedKnocks: 0,
        litKnocks: 0,
        refusedKnocks: 0,
        activeCanvassers: 0,
        lastActivityAt: null,
      });
    }

    for (const r of coverageAgg) {
      const c = byCampaign.get(String(r._id.campaignId));
      if (!c) continue;
      const bucket = r._id.bucket;
      c.households += r.count;
      // 'voted' (early-voted, never knocked), 'unknocked', and 'restricted' (inaccessible)
      // are not "homes knocked". Restricted is its own coverage segment, never billable.
      if (bucket !== 'unknocked' && bucket !== 'voted' && bucket !== 'restricted') c.homesKnocked += r.count;
      if (bucket in c.coverage) c.coverage[bucket] = r.count;
    }
    // Stats path: the per-campaign activity numbers come off the campaign doc; the agg loops
    // below then no-op on their empty arrays. (Coverage + surveys always come from their aggs.)
    if (useStats) {
      for (const campaign of campaigns) {
        const c = byCampaign.get(String(campaign._id));
        const s = campaign.stats;
        c.knocks = s.knockCount || 0;
        c.surveyedKnocks = s.surveyedKnockCount || 0;
        c.litKnocks = s.litKnockCount || 0;
        c.refusedKnocks = s.refusedKnockCount || 0;
        c.litDropped = s.litDroppedCount || 0;
        c.activeCanvassers = (s.canvasserIds || []).length;
        c.lastActivityAt = s.lastActivityAt || null;
      }
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
      c.refusedKnocks = r.refusedKnocks;
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
        const setup = summaries.get(String(campaign._id)) || {};
        return {
          id: String(campaign._id),
          name: campaign.name,
          type: campaign.type,
          isActive: campaign.isActive,
          electionDay: campaign.electionDay ?? null,
          earlyVotingStart: campaign.earlyVotingStart ?? null,
          earlyVotingEnd: campaign.earlyVotingEnd ?? null,
          datesNote: campaign.datesNote ?? '',
          setupComplete: setup.setupComplete,
          stepsDone: setup.stepsDone,
          stepsTotal: setup.stepsTotal,
          nextStepKey: setup.nextStepKey,
          openMockFlags: setup.openMockFlags || 0,
          households: c.households,
          homesKnocked: c.homesKnocked,
          knockedPct: c.households > 0 ? Math.round((c.homesKnocked / c.households) * 100) : 0,
          knocks: c.knocks,
          surveyedKnocks: c.surveyedKnocks,
          litKnocks: c.litKnocks,
          refusedKnocks: c.refusedKnocks,
          surveysSubmitted: c.surveysSubmitted,
          surveyedVoters: c.surveyedVoters,
          litDropped: c.litDropped,
          connectionRate: connectionRate(c),
          contactRate: contactRate(c),
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
      refusedKnocks: sum('refusedKnocks'),
      surveysSubmitted: sum('surveysSubmitted'),
      surveyedVoters: sum('surveyedVoters'),
      litDropped: sum('litDropped'),
      connectionRate: 0,
      contactRate: 0,
      // Org-level distinct: a canvasser active in two campaigns counts once. Stats path takes the
      // union of the per-campaign canvasser sets (bounded by roster sizes).
      activeCanvassers: useStats
        ? new Set(campaigns.flatMap((c) => (c.stats.canvasserIds || []).map(String))).size
        : cumulativeCanvassers.length,
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
    cumulative.contactRate = contactRate(cumulative);
    // Sum EVERY key present on each campaign's coverage (they're all seeded with the full
    // status set), not a hardcoded seed — a hardcoded list silently dropped `restricted`
    // when that status was added, zeroing it org-wide while the per-campaign cards showed it.
    cumulative.coverage = rows.reduce((acc, r) => {
      for (const [k, v] of Object.entries(r.coverage || {})) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {});

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
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, ...NOT_BULK };

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
        // Bucket by DAY first, so hoursOnDoors is the SUM OF PER-DAY working spans — not
        // (last knock ever − first knock ever), which is a CALENDAR span. The Dashboard used to
        // derive its own hours from firstActivityAt/lastActivityAt and therefore divided a week's
        // doors by a week of wall-clock: a canvasser doing 737 doors over 6 days read 4.9/hr
        // instead of 13.7. The endpoint now returns the real figure so no client has to guess.
        {
          $group: {
            _id: { userId: '$userId', day: dayBucketExpr('timestamp', tzOf(req)) },
            first: { $min: '$timestamp' },
            last: { $max: '$timestamp' },
            // The team(s) stamped on this day's knocks. $ifNull is load-bearing: pre-backfill rows
            // have the field ABSENT and $addToSet silently SKIPS a missing path — the set would
            // come back empty and the coordinator column would blank for exactly the legacy rows
            // it matters most for.
            coordinatorIds: { $addToSet: { $ifNull: ['$coordinatorId', null] } },
          },
        },
        {
          $group: {
            _id: '$_id.userId',
            firstActivityAt: { $min: '$first' },
            lastActivityAt: { $max: '$last' },
            hoursOnDoors: { $sum: { $divide: [{ $subtract: ['$last', '$first'] }, 3600000] } },
            daysActive: { $sum: 1 },
            coordinatorIdSets: { $addToSet: '$coordinatorIds' },
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
          refused: 0,
          litDropped: 0,
          restricted: 0,
          firstActivityAt: null,
          lastActivityAt: null,
          hoursOnDoors: 0,
          daysActive: 0,
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
      else if (row._id.actionType === 'refused') u.refused = row.count;
      else if (row._id.actionType === 'lit_dropped') u.litDropped = row.count;
      // Restricted (inaccessible home): a visible per-canvasser tally, but NOT a knock —
      // deliberately left out of the `knocks` sum below so it never becomes billable.
      else if (row._id.actionType === 'restricted') u.restricted = row.count;
      // survey_submitted activities are deduped to one per (user, household, pass), so this
      // is the canvasser's count of distinct surveyed door-passes (the rate's numerator).
      else if (row._id.actionType === 'survey_submitted') u.surveyKnocks = row.count;
      if (row.lastAt && (!u.lastActivityAt || row.lastAt > u.lastActivityAt)) {
        u.lastActivityAt = row.lastAt;
      }
    }
    const coordSetsByUser = new Map();
    for (const row of rangeAgg) {
      const u = ensure(row._id);
      u.firstActivityAt = row.firstActivityAt;
      u.hoursOnDoors = row.hoursOnDoors || 0;
      u.daysActive = row.daysActive || 0;
      if (
        row.lastActivityAt &&
        (!u.lastActivityAt || row.lastActivityAt > u.lastActivityAt)
      ) {
        u.lastActivityAt = row.lastActivityAt;
      }
      coordSetsByUser.set(
        String(row._id),
        new Set((row.coordinatorIdSets || []).flat().map((c) => (c ? String(c) : null)))
      );
    }

    const [userMap, coordLabels] = await Promise.all([
      hydrateCanvassers(Array.from(byUser.keys()), activeOrgId(req)),
      // Same ledger-sourced Coordinator label the Timeline shows, so the Home leaderboard and the
      // Timeline can never disagree about the same person (the leaderboard used to join the roster,
      // which reads '—' for anyone taken off the campaign — the very people this work recovers).
      ledgerCoordinatorLabels(coordSetsByUser),
    ]);

    const rows = Array.from(byUser.values())
      .map((u) => {
        const info = userMap.get(u.userId);
        // Billable knocks = this canvasser's distinct (household, pass) door interactions.
        // surveyKnocks/litDropped are mutually exclusive by campaign type, so they're the
        // completion-action numerator for the connection rate.
        const knocks = u.notHome + u.wrongAddress + u.refused + u.litDropped + u.surveyKnocks;
        return {
          userId: u.userId,
          firstName: info?.firstName || '',
          lastName: info?.lastName || '',
          email: info?.email || '',
          status: info?.status || 'deleted',
          isActive: info?.isActive ?? false,
          coordinatorId: coordLabels.get(u.userId)?.coordinatorId ?? null,
          coordinatorName: coordLabels.get(u.userId)?.coordinatorName ?? null,
          surveysSubmitted: u.surveysSubmitted,
          surveyKnocks: u.surveyKnocks,
          notHome: u.notHome,
          wrongAddress: u.wrongAddress,
          refused: u.refused,
          litDropped: u.litDropped,
          restricted: u.restricted, // inaccessible homes flagged — shown, never in `knocks`/billable
          knocks,
          // homesKnocked kept as an alias of knocks for back-compat with un-updated callers.
          homesKnocked: knocks,
          connectionRate: connectionRate({
            knocks,
            surveyedKnocks: u.surveyKnocks,
            litKnocks: u.litDropped,
          }),
          contactRate: contactRate({
            knocks,
            surveyedKnocks: u.surveyKnocks,
            refusedKnocks: u.refused,
          }),
          firstActivityAt: u.firstActivityAt,
          lastActivityAt: u.lastActivityAt,
          // Sum of per-DAY working spans — the same method the timeline and the CSV use, so the
          // three surfaces finally agree. Clients must NOT re-derive this from first/last: that is
          // a calendar span, and it under-reports pace by ~3x over a multi-day range.
          hoursOnDoors: Math.round((u.hoursOnDoors || 0) * 100) / 100,
          daysActive: u.daysActive || 0,
          doorsPerHour:
            u.hoursOnDoors > 0 ? Math.round((knocks / u.hoursOnDoors) * 100) / 100 : 0,
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
    let currentId = null;
    if (cFilter.campaignId) {
      const campaign = await Campaign.findOne(
        { _id: cFilter.campaignId, organizationId: orgId },
        'surveyTemplateId'
      ).lean();
      currentId = campaign?.surveyTemplateId ? String(campaign.surveyTemplateId) : null;
      // A campaign attaches one survey at a time but can swap over time; surface every
      // survey that has responses for this campaign (each keeps its own) plus the current one.
      const respIds = await SurveyResponse.distinct('surveyTemplateId', cFilter);
      const ids = new Set(respIds.filter(Boolean).map(String));
      if (currentId) ids.add(currentId);
      if (!ids.size) return res.json([]);
      templateFilter = {
        _id: { $in: [...ids].map((id) => new mongoose.Types.ObjectId(id)) },
        organizationId: orgId,
      };
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
        current: String(t._id) === currentId,
      }))
      // keep the current survey even at 0 responses so it's always selectable
      .filter((t) => t.responseCount > 0 || t.current || !cFilter.campaignId)
      .sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || b.responseCount - a.responseCount);

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
      const isText = q.type === 'text';
      const wantsPreview = voterPreviewLimit > 0 && !isText;

      // Choice questions group on the STABLE option id (id-native) or the legacy answer
      // text (pre-id rows) via choiceKeyStages; text questions group on the free text.
      const buildPipeline = (scope, withPreview) => {
        const p = isText
          ? [{ $match: scope }, { $unwind: '$answers' }, { $match: { 'answers.questionKey': q.key } }]
          : [{ $match: scope }, ...choiceKeyStages(q.key)];
        if (withPreview) p.push({ $sort: { submittedAt: -1 } });
        const groupStage = { _id: isText ? '$answers.answer' : '$_answerKeys', count: { $sum: 1 } };
        if (withPreview) groupStage.responseIds = { $push: '$_id' };
        p.push({ $group: groupStage });
        if (withPreview) {
          p.push({ $project: { count: 1, responseIds: { $slice: ['$responseIds', voterPreviewLimit] } } });
        }
        p.push({ $sort: { count: -1 } });
        if (isText) p.push({ $limit: 10 });
        return p;
      };

      const agg = await SurveyResponse.aggregate(buildPipeline(match, wantsPreview));
      const orgAgg = compareToOrg ? await SurveyResponse.aggregate(buildPipeline(baseMatch, false)) : null;
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
      if (q.type === 'text') {
        const valid = agg.filter((r) => r._id != null && r._id !== '');
        const total = valid.reduce((s, r) => s + r.count, 0);
        questions.push({
          key: q.key,
          label: q.label,
          type: q.type,
          options: valid.map((r) => ({
            option: String(r._id),
            count: r.count,
            percent: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
          })),
        });
        continue;
      }

      // Choice: dual-read merge onto the question's CURRENT options (by id, then text);
      // removed options surface as retired/legacy buckets (id:null). Percent denominator
      // is this question's own answer total (single → answerers, multi → selections).
      const merged = mergeOptionRows(q, agg, { previewLimit: voterPreviewLimit });
      const orgMerged = orgAgg ? mergeOptionRows(q, orgAgg) : [];
      const keyOf = (o) => o.id || `legacy:${o.text}`;
      const orgByKey = new Map(orgMerged.map((o) => [keyOf(o), o.count]));
      const questionTotal = merged.reduce((s, o) => s + o.count, 0);
      const orgQuestionTotal = orgMerged.reduce((s, o) => s + o.count, 0);

      const options = merged.map((o) => {
        const out = {
          option: o.text, // display label — existing chart code keys off this
          id: o.id,
          retired: o.retired,
          count: o.count,
          percent: questionTotal > 0 ? Math.round((o.count / questionTotal) * 1000) / 10 : 0,
        };
        if (compareToOrg) {
          const orgCount = orgByKey.get(keyOf(o)) || 0;
          out.orgCount = orgCount;
          out.orgPercent = orgQuestionTotal > 0 ? Math.round((orgCount / orgQuestionTotal) * 1000) / 10 : 0;
        }
        if (voterPreviewLimit > 0) {
          out.voters = (o.responseIds || [])
            .map((id) => responseLookup.get(String(id)))
            .filter(Boolean)
            .map(shapeVoter);
        }
        return out;
      });

      // Org-only options the canvasser never picked → show a zero bar for the gap.
      if (compareToOrg) {
        const seen = new Set(merged.map(keyOf));
        for (const o of orgMerged) {
          if (seen.has(keyOf(o))) continue;
          options.push({
            option: o.text,
            id: o.id,
            retired: o.retired,
            count: 0,
            percent: 0,
            orgCount: o.count,
            orgPercent: orgQuestionTotal > 0 ? Math.round((o.count / orgQuestionTotal) * 1000) / 10 : 0,
          });
        }
      }

      questions.push({ key: q.key, label: q.label, type: q.type, options });
    }

    // Tag rollup: DISTINCT voters who chose ANY option carrying each tag (across questions).
    // Counts come from a per-tag distinct-voter query (answerTagClause); the contributing
    // options + their counts are pulled from the per-question breakdown built above.
    const tags = [];
    for (const entry of tagOptionMap(template).values()) {
      const memberKeys = new Set(entry.members.map((m) => `${m.questionKey}|${m.optionId}`));
      const tagOptions = [];
      for (const q of questions) {
        for (const o of q.options) {
          if (o.id && memberKeys.has(`${q.key}|${o.id}`)) {
            tagOptions.push({ questionKey: q.key, optionId: o.id, text: o.option, count: o.count });
          }
        }
      }
      const voterIds = await SurveyResponse.distinct('voterId', { ...match, ...answerTagClause(template, entry.display) });
      tags.push({ tag: entry.display, voterCount: voterIds.length, options: tagOptions });
    }
    tags.sort((a, b) => b.voterCount - a.voterCount);

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
      tags,
    });
  } catch (err) {
    next(err);
  }
});

// The response filter behind the answer drill-in — shared by the JSON list and the CSV
// export so the two can never disagree about which responses "chose option X".
// Tag drill: match ANY option carrying the tag (across questions). Otherwise dual-read a
// single option: the stable option id (id-native) OR the legacy answer text. An optional
// ?userId narrows to one canvasser's entries (the audit "who is entering Opposed?" drill).
// Returns { filter, template, wantsTag } or { error: { status, message } }.
async function buildVotersByAnswerFilter(req) {
  const orgId = activeOrgId(req);
  const { questionKey, option, optionId, surveyTemplateId, tag } = req.query;
  const wantsTag = !!tag;
  if (!wantsTag && (!questionKey || (!option && !optionId))) {
    return { error: { status: 400, message: 'questionKey and option (or optionId) are required' } };
  }
  if (wantsTag && !(surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId))) {
    return { error: { status: 400, message: 'surveyTemplateId is required to drill by tag' } };
  }
  let answerClause;
  let template = null;
  if (wantsTag) {
    template = await SurveyTemplate.findOne({ _id: surveyTemplateId, organizationId: orgId }).lean();
    if (!template) return { error: { status: 404, message: 'Survey not found' } };
    answerClause = answerTagClause(template, tag);
  } else {
    answerClause = voterAnswerClause(questionKey, optionId || null, option ?? null);
  }
  const filter = { ...parseDateRange(req, 'submittedAt'), ...baseFilter(req), ...answerClause };
  if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
    filter.surveyTemplateId = new mongoose.Types.ObjectId(surveyTemplateId);
  }
  if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) {
    filter.userId = new mongoose.Types.ObjectId(req.query.userId);
  }
  return { filter, template, wantsTag };
}

router.get('/voters-by-answer', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const built = await buildVotersByAnswerFilter(req);
    if (built.error) return res.status(built.error.status).json({ error: built.error.message });
    const { filter } = built;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const [total, responses] = await Promise.all([
      SurveyResponse.countDocuments(filter),
      SurveyResponse.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('voterId', 'fullName party doNotContact.flagged')
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
              // Historical record of past contact — DNC voters stay listed, MARKED, so the
              // drill-in can't be repurposed as a contact list.
              dnc: !!r.voterId.doNotContact?.flagged,
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
        wasOfflineSubmission: !!r.wasOfflineSubmission,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// The drill-in list as a CSV download — same filter as the JSON list above (incl. ?userId and
// tag mode) with no pagination, for reporting/audit exports ("all Opposed entries this week").
// Capped so a whole-org drill can't stream an unbounded file.
router.get('/voters-by-answer.csv', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const built = await buildVotersByAnswerFilter(req);
    if (built.error) return res.status(built.error.status).json({ error: built.error.message });
    const { filter, template, wantsTag } = built;
    const EXPORT_CAP = 50000;
    const tz = tzOf(req);

    const responses = await SurveyResponse.find(filter)
      .sort({ submittedAt: -1 })
      .limit(EXPORT_CAP)
      .populate('voterId', 'fullName party doNotContact.flagged')
      .populate('householdId', 'addressLine1 addressLine2 city state zipCode')
      .populate('userId', 'firstName lastName')
      .lean();

    // The Question/Answer columns show the drilled question's SNAPSHOT (what was actually
    // recorded at the door — honest even after an option rename). Tag mode spans questions,
    // so collect every answer entry that carries the tag.
    const { questionKey, option, optionId, tag } = req.query;
    const tagMembers = wantsTag ? tagOptionMap(template).get(normalizeTag(tag)) : null;
    const answerMatches = (a) => {
      if (wantsTag) {
        return (tagMembers?.members || []).some(
          (m) =>
            m.questionKey === a.questionKey &&
            ((m.optionId && (a.optionIds || []).includes(m.optionId)) ||
              (m.text != null &&
                (Array.isArray(a.answer) ? a.answer.includes(m.text) : a.answer === m.text)))
        );
      }
      if (a.questionKey !== questionKey) return false;
      if (optionId && (a.optionIds || []).includes(optionId)) return true;
      return option != null && (Array.isArray(a.answer) ? a.answer.includes(option) : a.answer === option);
    };
    const answerText = (a) => {
      const base = Array.isArray(a.answer) ? a.answer.join('; ') : a.answer ?? '';
      // The capture flow embeds the Other free text INTO the answer snapshot itself;
      // only append otherText when it isn't already there (legacy belt-and-braces).
      const embedded = Array.isArray(a.answer) ? a.answer.includes(a.otherText) : a.answer === a.otherText;
      return a.otherText && !embedded ? `${base} — ${a.otherText}` : base;
    };

    const dateFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });

    const headers = [
      'Submitted (ISO)', 'Date', `Time (${tzAbbrev(tz) || tz})`,
      'Voter', 'Party', 'Do not contact', 'Address', 'City', 'State', 'Zip',
      'Canvasser first name', 'Canvasser last name',
      'Question', 'Answer', 'Note', 'Offline submission', 'Response id',
    ];
    const rows = responses.map((r) => {
      const matched = (r.answers || []).filter(answerMatches);
      const h = r.householdId;
      return [
        r.submittedAt ? new Date(r.submittedAt).toISOString() : '',
        r.submittedAt ? dateFmt.format(new Date(r.submittedAt)) : '',
        r.submittedAt ? timeFmt.format(new Date(r.submittedAt)) : '',
        r.voterId?.fullName || '',
        r.voterId?.party || '',
        // Record of past contact, so the row stays — but marked, so the file can't be reused
        // as a call list against the voter's request.
        r.voterId?.doNotContact?.flagged ? 'yes' : '',
        h ? `${h.addressLine1 || ''}${h.addressLine2 ? `, ${h.addressLine2}` : ''}` : '',
        h?.city || '',
        h?.state || '',
        h?.zipCode || '',
        r.userId?.firstName || '',
        r.userId?.lastName || '',
        matched.map((a) => a.questionLabel).join(' | '),
        matched.map(answerText).join(' | '),
        r.note || '',
        r.wasOfflineSubmission ? 'yes' : 'no',
        String(r._id),
      ];
    });

    const slug = String(wantsTag ? `tag-${tag}` : questionKey || 'answers')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 40);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="answers-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(toCsv(headers, rows));
  } catch (err) {
    next(err);
  }
});

// Per-canvasser breakdown for ONE answer option — "who is entering Opposed the most?".
//
// The counting contract: this table must sum EXACTLY to the option's count on
// /survey-results for identical filters. That count comes from the choiceKeyStages
// explode folded by mergeOptionRows (id-native rows count by option id, legacy rows by
// text) — so we aggregate with the SAME explode and match the key against
// {option id, option text}, NOT with voterAnswerClause + countDocuments (a dual-write
// edge row carrying both an id and a mismatched legacy text would double-count there).
//
// Counts are RAW per-user — no team fold (teamFoldStage) — because this is an audit
// surface: it answers "who pressed the button", never "whose team gets credit".
// Tag mode is deliberately unsupported: tag rollups are DISTINCT-voter counts across
// questions, which have no honest per-canvasser sum.
router.get('/answer-canvassers', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const { questionKey, option, optionId, surveyTemplateId, tag } = req.query;
    if (tag) {
      return res.status(400).json({ error: 'Per-canvasser breakdown is per option; tags roll up distinct voters and cannot be split by canvasser.' });
    }
    if (!questionKey || (!option && !optionId)) {
      return res.status(400).json({ error: 'questionKey and option (or optionId) are required' });
    }
    const match = { ...parseDateRange(req, 'submittedAt'), ...baseFilter(req) };
    if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
      match.surveyTemplateId = new mongoose.Types.ObjectId(surveyTemplateId);
    }
    const keys = [optionId, option].filter((v) => v != null && v !== '');

    // Numerator: this option's selections per canvasser. Denominator: each canvasser's
    // TOTAL selections on this question (any option) — the context for "12% of everything
    // they record on this question is Opposed".
    const [optionRows, questionRows] = await Promise.all([
      SurveyResponse.aggregate([
        { $match: match },
        ...choiceKeyStages(questionKey),
        { $match: { _answerKeys: { $in: keys } } },
        { $group: { _id: '$userId', count: { $sum: 1 }, lastAt: { $max: '$submittedAt' } } },
        { $sort: { count: -1 } },
      ]),
      SurveyResponse.aggregate([
        { $match: match },
        ...choiceKeyStages(questionKey),
        { $group: { _id: '$userId', questionTotal: { $sum: 1 } } },
      ]),
    ]);

    const totalByUser = new Map(questionRows.map((r) => [String(r._id), r.questionTotal]));
    const valid = optionRows.filter((r) => r._id != null);
    const total = valid.reduce((s, r) => s + r.count, 0);
    const userMap = await hydrateCanvassers(valid.map((r) => String(r._id)), activeOrgId(req));

    res.json({
      total,
      rows: valid.map((r) => {
        const key = String(r._id);
        const info = userMap.get(key) || {};
        const questionTotal = totalByUser.get(key) || 0;
        return {
          userId: key,
          firstName: info.firstName || '',
          lastName: info.lastName || '',
          status: info.status || 'deleted',
          count: r.count,
          share: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
          questionTotal,
          pctOfOwnAnswers: questionTotal > 0 ? Math.round((r.count / questionTotal) * 1000) / 10 : 0,
          lastAt: r.lastAt,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// One survey response in full — powers the mobile answer-drill detail screen
// (tap a row in voters-by-answer). Returns everything the detail page shows:
// answers, note, GPS + distance, voter, household (with coordinates for the
// map dot), canvasser, and the round it was recorded in. Leads pass the router
// gate via ?campaignId; the response's own campaign is re-checked here (same
// defense-in-depth as /flags/review).
router.get('/responses/:responseId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { responseId } = req.params;
    if (!mongoose.isValidObjectId(responseId)) {
      return res.status(400).json({ error: 'Invalid responseId' });
    }
    const r = await SurveyResponse.findOne({ _id: responseId, organizationId: orgId })
      .populate('voterId', 'fullName party gender precinct')
      .populate('householdId', 'addressLine1 addressLine2 city state zipCode location')
      .populate('userId', 'firstName lastName email')
      .populate('passId', 'roundNumber name')
      .populate('editedBy', 'firstName lastName')
      .lean();
    if (!r) return res.status(404).json({ error: 'Response not found' });
    if (!isOrgAdmin(req) && !(await canManageCampaign(req, r.campaignId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const coords = r.householdId?.location?.coordinates;
    res.json({
      response: {
        id: String(r._id),
        submittedAt: r.submittedAt,
        // syncedAt = when the server received it; for an offline submission it trails
        // submittedAt (the field time) by however long the phone stayed offline.
        syncedAt: r.syncedAt || null,
        answers: r.answers || [],
        note: r.note || null,
        wasOfflineSubmission: !!r.wasOfflineSubmission,
        distanceFromHouseMeters: r.distanceFromHouseMeters ?? null,
        surveyTemplateVersion: r.surveyTemplateVersion || 1,
        editedAt: r.editedAt || null,
        editedBy: r.editedBy
          ? { id: String(r.editedBy._id), firstName: r.editedBy.firstName, lastName: r.editedBy.lastName }
          : null,
      },
      voter: r.voterId
        ? {
            id: String(r.voterId._id),
            fullName: r.voterId.fullName,
            party: r.voterId.party || null,
            gender: r.voterId.gender || null,
            precinct: r.voterId.precinct || null,
          }
        : null,
      household: r.householdId
        ? {
            id: String(r.householdId._id),
            addressLine1: r.householdId.addressLine1,
            addressLine2: r.householdId.addressLine2 || null,
            city: r.householdId.city,
            state: r.householdId.state,
            zipCode: r.householdId.zipCode,
            lng: coords?.length === 2 ? coords[0] : null,
            lat: coords?.length === 2 ? coords[1] : null,
          }
        : null,
      canvasser: r.userId
        ? {
            id: String(r.userId._id),
            firstName: r.userId.firstName,
            lastName: r.userId.lastName,
            email: r.userId.email || null,
          }
        : null,
      round: r.passId
        ? { id: String(r.passId._id), roundNumber: r.passId.roundNumber, name: r.passId.name || null }
        : null,
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
    const match = { ...baseFilter(req), ...parseDateRange(req, 'timestamp') };
    const { overlaps, total } = await computeOverlaps(match, { organizationId: activeOrgId(req) });
    res.json({ overlaps, total });
  } catch (err) {
    next(err);
  }
});

// Per-campaign CANVASSER TIMELINE: rows = canvassers; columns = the hours of ONE day
// (mode:'day' — the default and the mobile path, via ?date=) or the days of a range
// (mode:'range' — the web dashboard, via ?from/&to). Cells = knocks (+ a survey subset).
// A single canvasser has <=1 knock activity per (household, pass), so a row total ==
// that canvasser's billable knocks (matches the leaderboard); the only sum-vs-billable
// gap across canvassers IS the overlap count, surfaced inline as `overlapDoors`
// (= grandKnocks - billableKnocks) — exact in both modes. dayKnocks/daySurveys/dayLit
// keep their names in both modes (they are the WINDOW totals; mobile only ever requests
// one day). Reuses knocksPipeline + computeOverlaps. See docs/METRICS.md.
// = AUDIT_WINDOW_MAX_DAYS so the flags/timeline range cap and the openMockFlags nudge
// count (campaignSummaries.js) can never drift apart.
const TIMELINE_MAX_DAYS = AUDIT_WINDOW_MAX_DAYS;

function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function ymdSpanDays(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

// Every team's numbers at once, with the reconciliation shown.
//
// The question this exists for: "how many doors has MY team knocked?" — asked by a client who runs
// one crew, and by a candidate who wants each crew's numbers side by side. A one-team-at-a-time
// filter makes an admin check three times and add up by hand, which is where the mistake gets made.
//
// The counting contract (see docs/METRICS.md):
//   · Billing is team-blind: a billable knock is one distinct (household, pass). Unchanged.
//   · A TEAM's doors = that same dedupe, applied within the team. Two of Asa's own people knocking
//     one house in one pass collapses to ONE door inside Asa's number, automatically.
//   · Σ teams + "no team" − crossTeamDoors == campaign billable, EXACTLY.
//     crossTeamDoors = houses worked by two DIFFERENT teams. Each team fairly counts it (they each
//     did the work) so it is claimed twice; the campaign counts it once. The difference is that
//     over-claim, and it is pure arithmetic — no extra query. It should normally be 0: two teams on
//     the same doors is an anomaly, and this surfaces it rather than papering over it.
router.get('/team-breakdown', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const org = await Organization.findById(orgId, 'teamAttributionReadyAt').lean();

    const scope = { ...baseFilter(req), ...parseDateRange(req, 'timestamp'), ...NOT_BULK };

    // Until the backfill has run, history carries no team tag — and an unstamped row is invisible
    // to a team while being swallowed by the No-team bucket. That reads as "every team did nothing
    // and the unassigned bucket did everything", which looks like data rather than an error. Refuse
    // rather than mislead.
    if (!org?.teamAttributionReadyAt) {
      return res.json({ ready: false, teams: [], campaign: null, crossTeamDoors: 0 });
    }

    const leadIds = (await leadIdsForOrg(orgId)).map(String);
    const leadSet = new Set(leadIds);

    const [rows, campaignAgg] = await Promise.all([
      CanvassActivity.aggregate([
        { $match: { ...scope, actionType: { $in: KNOCK_ACTIONS } } },
        teamFoldStage(leadIds),
        // Dedupe to the DOOR-PASS *within a team* — this is what makes a team's number a true
        // distinct-door count, and what absorbs a same-team double-knock for free.
        {
          $group: {
            _id: { householdId: '$householdId', passId: '$passId', team: '$team' },
            hasSurvey: { $max: { $cond: [{ $eq: ['$actionType', 'survey_submitted'] }, 1, 0] } },
            hasLit: { $max: { $cond: [{ $eq: ['$actionType', 'lit_dropped'] }, 1, 0] } },
            hasRefused: { $max: { $cond: [{ $eq: ['$actionType', 'refused'] }, 1, 0] } },
            users: { $addToSet: '$userId' },
          },
        },
        {
          $group: {
            _id: '$_id.team',
            doors: { $sum: 1 },
            surveyedKnocks: { $sum: '$hasSurvey' },
            litKnocks: { $sum: '$hasLit' },
            refusedKnocks: { $sum: '$hasRefused' },
            people: { $addToSet: '$users' },
          },
        },
      ]),
      CanvassActivity.aggregate(knocksPipeline(scope)),
    ]);

    // Voter-unit surveys per team (the door-unit count is surveyedKnocks above — they are different
    // questions and the UI must label them as such; one door can survey several voters).
    //
    // It MUST use the same teamFoldStage as the doors aggregate. Without it, a lead who knocks gets
    // their DOORS folded onto their own team while their VOTERS SURVEYED stay in the "No team"
    // bucket — one row, two different notions of who's on the team. The reconciliation check is a
    // SUM, so it cannot see that; the row just quietly lies.
    const voterSurveys = await SurveyResponse.aggregate([
      { $match: { ...baseFilter(req), ...parseDateRange(req, 'submittedAt') } },
      teamFoldStage(leadIds),
      { $group: { _id: '$team', voters: { $sum: 1 } } },
    ]);
    const votersByTeam = new Map(voterSurveys.map((v) => [String(v._id), v.voters]));

    const teamIds = rows.map((r) => r._id).filter(Boolean);
    const names = await User.find({ _id: { $in: teamIds } }, 'firstName lastName').lean();
    const nameById = new Map(names.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));

    const teams = rows
      .map((r) => {
        const id = r._id ? String(r._id) : null;
        const knocks = r.doors;
        return {
          coordinatorId: id,
          coordinatorName: id ? nameById.get(id) || 'Unknown' : null, // null = the "No team" bucket
          people: new Set(r.people.flat().map(String)).size,
          doors: knocks, // DISTINCT (household, pass) worked by this team
          surveyDoors: r.surveyedKnocks, // door-unit — the connection-rate numerator
          votersSurveyed: votersByTeam.get(String(id)) || 0, // voter-unit — a different question
          litKnocks: r.litKnocks,
          connectionRate: connectionRate({
            knocks,
            surveyedKnocks: r.surveyedKnocks,
            litKnocks: r.litKnocks,
          }),
          contactRate: contactRate({
            knocks,
            surveyedKnocks: r.surveyedKnocks,
            refusedKnocks: r.refusedKnocks,
          }),
        };
      })
      .sort((a, b) => b.doors - a.doors);

    const k = campaignAgg[0] || { knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0 };
    const teamSum = teams.reduce((n, t) => n + t.doors, 0);

    res.json({
      ready: true,
      teams,
      campaign: {
        doors: k.knocks,
        surveyDoors: k.surveyedKnocks,
        litKnocks: k.litKnocks,
        connectionRate: connectionRate(k),
        contactRate: contactRate(k),
      },
      // Σ teams − campaign. A door-pass worked by k teams contributes k to the sum and 1 to the
      // campaign, so the difference IS the over-claim. Normally 0; non-zero means two teams walked
      // the same doors, which is worth knowing.
      crossTeamDoors: Math.max(0, teamSum - k.knocks),
      teamSum,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/canvasser-timeline', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const tz = tzOf(req);

    const validYmd = (v) => {
      const s = String(v ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      // Calendar-valid too: Date.UTC normalizes (2026-02-31 → 2026-03-03), so a
      // round-trip mismatch means a fictitious day that would desync days[] from
      // the $dateToString buckets. Invalid values fall back to the defaults.
      return addDaysYmd(s, 0) === s ? s : null;
    };

    // THREE request shapes.
    //   ?date=      (or nothing) — single day, the original/mobile shape.
    //   ?from&to    — a range, capped at TIMELINE_MAX_DAYS.
    //   ?totals=1   — campaign-to-date. No time buckets, so no columns, so NO CAP: the 62-day
    //                 limit exists only because a range renders one grid column per day. This
    //                 is the only way to see a whole campaign — including the people who worked
    //                 it and have since left, whose knocks are in the totals either way.
    // Relative presets send to:null (open-ended through today), so a missing `to` defaults to
    // today-in-anchor-tz BEFORE the single-day check — otherwise "Today" (from=today, to=null)
    // would never take the day path.
    const totalsMode = req.query.totals === '1' || req.query.totals === 'true';
    const hasRange = req.query.from !== undefined || req.query.to !== undefined;
    let from;
    let to;
    if (hasRange) {
      to = validYmd(req.query.to) || zonedDayStr(new Date(), tz);
      from = validYmd(req.query.from) || to;
      if (from > to) return res.status(400).json({ error: 'from must be on or before to' });
      if (!totalsMode && ymdSpanDays(from, to) > TIMELINE_MAX_DAYS) {
        return res.status(400).json({ error: `Date range too large (max ${TIMELINE_MAX_DAYS} days)` });
      }
    } else if (!totalsMode) {
      from = validYmd(req.query.date) || zonedDayStr(new Date(), tz);
      to = from;
    }
    const singleDay = !totalsMode && from === to;

    // Campaign-to-date with no bounds = the whole ledger for this campaign: no timestamp filter.
    const window = totalsMode && !hasRange ? null : zonedDayRange(from, to, tz);
    // Team scope rides on the LEDGER (coordinatorId is frozen onto each knock), so scoping here
    // makes EVERY number below team-correct at once — the rows, the raw totals, and crucially
    // `billableKnocks`, which is deduped server-side and can never be derived client-side.
    const scoped = withTeam(
      { ...baseFilter(req), ...(window ? { timestamp: window } : {}) },
      await crewFilter(req)
    );

    // One aggregation, mode-keyed bucket: hour-of-day for a single day, calendar day for
    // a range. Both bucket in the anchor tz ($hour/$dateToString with timezone), so DST
    // days (23/25h) land in the wall-clock buckets an admin expects. In totals mode there is
    // no bucket at all — we group on userId alone.
    const bucketExpr = singleDay
      ? { $hour: { date: '$timestamp', timezone: tz } }
      : dayBucketExpr('timestamp', tz);

    // Voter-unit surveys, per canvasser. The bucket agg below counts survey DOORS
    // (CanvassActivity.survey_submitted); this counts survey VOTERS (SurveyResponse rows). One door
    // can survey several voters, so the two genuinely differ — the Home tab showed one and the
    // Timeline the other, both labelled "Surveys", which is why they appeared to contradict.
    const voterSurveyAgg = await SurveyResponse.aggregate([
      {
        $match: withTeam(
          {
            ...baseFilter(req),
            ...(window ? { submittedAt: window } : {}),
          },
          await crewFilter(req)
        ),
      },
      { $group: { _id: '$userId', voters: { $sum: 1 } } },
    ]);
    const votersByUser = new Map(voterSurveyAgg.map((v) => [String(v._id), v.voters]));

    const [bucketAgg, knockAgg, overlapRes] = await Promise.all([
      CanvassActivity.aggregate([
        // Include 'restricted' so it contributes a separate tally + extends the shift
        // window (first/last), but it is NOT counted in `knocks` (kept billable-only).
        // Bulk marks excluded: the timeline is a per-CANVASSER grid — an admin's
        // book-level bulk restrict must not appear as a phantom shift.
        { $match: { ...scoped, ...NOT_BULK, actionType: { $in: [...KNOCK_ACTIONS, 'restricted'] } } },
        {
          $group: {
            // Totals mode still buckets BY DAY — it just never ships the per-day maps. Two
            // reasons, both load-bearing:
            //   · hoursOnDoors is the SUM OF PER-DAY spans (see below). Grouping on userId
            //     alone would make it (last knock ever − first knock ever) — weeks, not hours —
            //     and doors/hour would collapse to ~0.
            //   · the 62-day cap protects the CLIENT GRID's columns, not this aggregation.
            //     Grouping a whole campaign by day is cheap; rendering 300 columns is not.
            // So every per-canvasser number in totals mode is, by construction, exactly the sum
            // of its range-mode buckets.
            //
            // Do NOT source these from knocksPipeline: that dedupes by household×pass and
            // collapses ACROSS users to produce the campaign-wide BILLABLE total. It has no
            // userId dimension, and routing per-canvasser counts through it would silently
            // rewrite everyone's numbers.
            _id: { userId: '$userId', bucket: bucketExpr },
            knocks: { $sum: { $cond: [{ $eq: ['$actionType', 'restricted'] }, 0, 1] } },
            surveys: { $sum: { $cond: [{ $eq: ['$actionType', 'survey_submitted'] }, 1, 0] } },
            lit: { $sum: { $cond: [{ $eq: ['$actionType', 'lit_dropped'] }, 1, 0] } },
            refused: { $sum: { $cond: [{ $eq: ['$actionType', 'refused'] }, 1, 0] } },
            notHome: { $sum: { $cond: [{ $eq: ['$actionType', 'not_home'] }, 1, 0] } },
            wrongAddress: { $sum: { $cond: [{ $eq: ['$actionType', 'wrong_address'] }, 1, 0] } },
            restricted: { $sum: { $cond: [{ $eq: ['$actionType', 'restricted'] }, 1, 0] } },
            first: { $min: '$timestamp' },
            last: { $max: '$timestamp' },
            // The team(s) this canvasser's doors are stamped with, straight from the LEDGER — no
            // roster join, which is what used to lose a canvasser the moment they left a campaign.
            // A set, because someone who transferred teams has doors under both, and the honest
            // answer is "Multiple", not a silently-picked winner.
            coordinatorIds: { $addToSet: '$coordinatorId' },
          },
        },
      ]),
      // Campaign-wide BILLABLE knocks — distinct (household, pass), so a door two canvassers
      // both worked is one knock. Unbucketed and uncapped already, so totals mode reuses it
      // as-is and the invoice number is identical in every mode.
      CanvassActivity.aggregate(knocksPipeline(scoped)),
      // Overlaps $push every event into per-door arrays, which over a whole campaign can breach
      // Mongo's 100MB per-stage limit. Reconciling overlaps is a "what happened this week" job
      // anyway — it needs a bounded window, so totals mode skips it rather than risk the query.
      totalsMode
        ? Promise.resolve({ overlaps: [], total: 0, householdIds: [], overlapUserIds: [] })
        : computeOverlaps(scoped, { organizationId: orgId }),
    ]);

    const billableKnocks = knockAgg[0]?.knocks || 0;

    // Per-(user, bucket) tally → per-canvasser rows.
    const byUser = new Map();
    const activeHours = new Set(); // single-day only
    for (const r of bucketAgg) {
      const uid = String(r._id.userId);
      if (!byUser.has(uid)) {
        byUser.set(uid, {
          knocksByHour: {},
          surveysByHour: {},
          knocksByDay: {},
          surveysByDay: {},
          dayKnocks: 0,
          daySurveys: 0,
          dayLit: 0,
          refused: 0,
          notHome: 0,
          wrongAddress: 0,
          dayRestricted: 0,
          first: null,
          last: null,
          hoursOnDoors: 0,
          coordinatorIds: new Set(),
        });
      }
      const row = byUser.get(uid);
      for (const c of r.coordinatorIds || []) row.coordinatorIds.add(c ? String(c) : null);
      // The grid shows knocks only, so a restricted-only bucket (knocks === 0) never
      // creates an empty knock column — but its timestamps still extend the window below.
      if (singleDay) {
        if (r.knocks) {
          activeHours.add(r._id.bucket);
          row.knocksByHour[r._id.bucket] = r.knocks;
        }
        if (r.surveys) row.surveysByHour[r._id.bucket] = r.surveys;
      } else {
        if (r.knocks) row.knocksByDay[r._id.bucket] = r.knocks;
        if (r.surveys) row.surveysByDay[r._id.bucket] = r.surveys;
        // Range buckets ARE days, so summing per-bucket (last - first) is exactly the
        // canvasser-summary endpoint's "sum of per-day active spans" method. Restricted
        // marks are in the bucket, so their time counts toward shift hours (by design).
        row.hoursOnDoors += (r.last - r.first) / 3600000;
      }
      row.dayKnocks += r.knocks;
      row.daySurveys += r.surveys;
      row.dayLit += r.lit;
      row.refused += r.refused;
      row.notHome += r.notHome;
      row.wrongAddress += r.wrongAddress;
      row.dayRestricted += r.restricted;
      if (!row.first || r.first < row.first) row.first = r.first;
      if (!row.last || r.last > row.last) row.last = r.last;
    }

    // Single day: buckets are hours, so the active span is (overall last - first) —
    // summing per-hour spans would drop the gaps between active hours.
    if (singleDay) {
      for (const row of byUser.values()) {
        if (row.first && row.last) row.hoursOnDoors = (row.last - row.first) / 3600000;
      }
    }

    // Contiguous active-hour window (min..max) so the grid has no gaps; [] when no activity.
    const hours = [];
    if (singleDay && activeHours.size) {
      const min = Math.min(...activeHours);
      const max = Math.max(...activeHours);
      for (let h = min; h <= max; h++) hours.push(h);
    }

    // Every day of the range, inclusive — pure calendar-string math (the tz-aware
    // bucketing above already put each knock on its wall-clock day). Totals mode ships no
    // grid, so it ships no day columns (and an unbounded totals request has no from/to to
    // walk in the first place).
    const days = [];
    if (!singleDay && !totalsMode) {
      for (let d = from; d <= to; d = addDaysYmd(d, 1)) days.push(d);
    }

    // Uncapped: computeOverlaps' card list truncates at 200 (worst first), but the flag
    // must cover every colliding canvasser in the window — range mode can exceed the cap.
    const overlapUserIds = new Set(overlapRes.overlapUserIds || []);

    const userIds = [...byUser.keys()];
    const coordLabels = await ledgerCoordinatorLabels(
      new Map(userIds.map((uid) => [uid, byUser.get(uid).coordinatorIds]))
    );

    const uMap = await hydrateCanvassers(userIds, orgId);

    const canvassers = userIds
      .map((uid) => {
        const row = byUser.get(uid);
        const u = uMap.get(uid);
        const rawHours = row.hoursOnDoors;
        const { coordinatorId: teamId, coordinatorName } = coordLabels.get(uid) || {};
        return {
          userId: uid,
          firstName: u?.firstName || '',
          lastName: u?.lastName || '',
          email: u?.email || '',
          // Standing, not membership: the row set comes from the LEDGER, so a canvasser who
          // quit still appears here with all their knocks. This only says where they stand.
          status: u?.status || 'deleted',
          isActive: u?.isActive ?? false,
          // Totals mode ships no grid, so it ships no per-bucket maps — a whole campaign would
          // be hundreds of day columns nobody can read. The scalar totals below are unchanged.
          ...(totalsMode
            ? {}
            : singleDay
              ? { knocksByHour: row.knocksByHour, surveysByHour: row.surveysByHour }
              : { knocksByDay: row.knocksByDay, surveysByDay: row.surveysByDay }),
          dayKnocks: row.dayKnocks,
          daySurveys: row.daySurveys,
          dayLit: row.dayLit,
          refused: row.refused,
          notHome: row.notHome,
          wrongAddress: row.wrongAddress,
          dayRestricted: row.dayRestricted, // inaccessible homes — a tally, never in dayKnocks
          // daySurveys above = survey DOORS (the connection-rate numerator). This is survey VOTERS —
          // a different question, always >= doors, and it must be labelled as such in the UI.
          dayVoterSurveys: votersByUser.get(uid) || 0,
          coordinatorId: teamId ?? null,
          coordinatorName: coordinatorName ?? null,
          firstActivityAt: row.first,
          lastActivityAt: row.last,
          hoursOnDoors: Math.round(rawHours * 100) / 100,
          // Divide by the RAW hours and round only the quotient (matches the canvasser
          // summary endpoint). One-knock windows have a zero span: 0, never Infinity.
          doorsPerHour: rawHours > 0 ? Math.round((row.dayKnocks / rawHours) * 100) / 100 : 0,
          connectionRate: connectionRate({
            knocks: row.dayKnocks,
            surveyedKnocks: row.daySurveys,
            litKnocks: row.dayLit,
          }),
          contactRate: contactRate({
            knocks: row.dayKnocks,
            surveyedKnocks: row.daySurveys,
            refusedKnocks: row.refused,
          }),
          inOverlap: overlapUserIds.has(uid),
        };
      })
      .sort((a, b) => b.daySurveys - a.daySurveys || b.dayKnocks - a.dayKnocks);

    let grandKnocks = 0;
    let grandSurveys = 0;
    const hourTotals = { knocks: {}, surveys: {} };
    const dayTotals = { knocks: {}, surveys: {} };
    for (const c of canvassers) {
      grandKnocks += c.dayKnocks;
      grandSurveys += c.daySurveys;
      if (singleDay) {
        for (const h of hours) {
          if (c.knocksByHour[h]) hourTotals.knocks[h] = (hourTotals.knocks[h] || 0) + c.knocksByHour[h];
          if (c.surveysByHour[h])
            hourTotals.surveys[h] = (hourTotals.surveys[h] || 0) + c.surveysByHour[h];
        }
      } else {
        for (const d of days) {
          if (c.knocksByDay[d]) dayTotals.knocks[d] = (dayTotals.knocks[d] || 0) + c.knocksByDay[d];
          if (c.surveysByDay[d])
            dayTotals.surveys[d] = (dayTotals.surveys[d] || 0) + c.surveysByDay[d];
        }
      }
    }

    res.json({
      mode: totalsMode ? 'totals' : singleDay ? 'day' : 'range',
      range: { from: from ?? null, to: to ?? null }, // both null = campaign-to-date
      // Day mode keeps the original shape (date/hours/hourTotals) byte-compatible for
      // the mobile admin screen; range mode swaps in days/dayTotals. Totals mode has neither.
      ...(totalsMode ? {} : singleDay ? { date: from, hours, hourTotals } : { days, dayTotals }),
      tz,
      tzAbbrev: tzAbbrev(tz),
      canvassers,
      grandKnocks,
      grandSurveys,
      billableKnocks,
      // Pure arithmetic on two numbers we already have, so the overlap DOOR COUNT is honest
      // even in totals mode — it's only the per-door reconciliation CARDS that need a bounded
      // window (see the computeOverlaps skip above).
      overlapDoors: Math.max(0, grandKnocks - billableKnocks),
      overlaps: overlapRes.overlaps,
      overlapCount: overlapRes.total,
      // Totals mode deliberately ships no overlap cards; the client says so rather than
      // implying a campaign had zero overlaps.
      overlapsOmitted: totalsMode,
    });
  } catch (err) {
    next(err);
  }
});

// Voters with MORE THAN ONE survey response (a "Surveys" count above "Surveyed voters" means
// someone was surveyed twice). Surfaces who/when/round/where for each so the operator can tell a
// legit revisit (different canvassers / different round) from a mistake (same canvasser, same
// day). Fix path: open the voter profile and delete the extra response. See METRICS.md §Surveys.
router.get('/duplicate-surveys', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'submittedAt');
    const tz = req.anchorTz || 'UTC';

    const dupes = await SurveyResponse.aggregate([
      { $match: { ...cFilter, ...dateRange } },
      {
        $group: {
          _id: '$voterId',
          count: { $sum: 1 },
          responses: {
            $push: {
              responseId: '$_id',
              submittedAt: '$submittedAt',
              passId: '$passId',
              userId: '$userId',
            },
          },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 200 },
    ]);

    if (!dupes.length) {
      return res.json({ duplicates: [], total: 0, timeZone: tz, tzAbbrev: tzAbbrev(tz) });
    }

    const voterIds = dupes.map((d) => d._id);
    const userIds = [
      ...new Set(dupes.flatMap((d) => d.responses.map((r) => String(r.userId)))),
    ];
    const passIds = [
      ...new Set(dupes.flatMap((d) => d.responses.map((r) => r.passId).filter(Boolean).map(String))),
    ];

    const [voters, users, passes] = await Promise.all([
      Voter.find(
        { _id: { $in: voterIds }, organizationId: orgId },
        'fullName firstName lastName party householdId'
      ).lean(),
      User.find({ _id: { $in: userIds } }, 'firstName lastName email').lean(),
      passIds.length ? Pass.find({ _id: { $in: passIds } }, 'roundNumber name').lean() : [],
    ]);

    const householdIds = [
      ...new Set(voters.map((v) => v.householdId).filter(Boolean).map(String)),
    ];
    const households = householdIds.length
      ? await Household.find(
          { _id: { $in: householdIds }, organizationId: orgId },
          'addressLine1 city state zipCode'
        ).lean()
      : [];

    const vMap = new Map(voters.map((v) => [String(v._id), v]));
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    const pMap = new Map(passes.map((p) => [String(p._id), p]));
    const hMap = new Map(households.map((h) => [String(h._id), h]));

    const result = dupes.map((d) => {
      const voter = vMap.get(String(d._id)) || null;
      const household = voter?.householdId ? hMap.get(String(voter.householdId)) : null;
      const responses = d.responses
        .map((r) => {
          const u = uMap.get(String(r.userId));
          const pass = r.passId ? pMap.get(String(r.passId)) : null;
          return {
            responseId: String(r.responseId),
            submittedAt: r.submittedAt,
            day: zonedDayStr(r.submittedAt, tz),
            canvasser: {
              userId: String(r.userId),
              firstName: u?.firstName || '',
              lastName: u?.lastName || '',
              email: u?.email || '',
            },
            passId: r.passId ? String(r.passId) : null,
            roundLabel: pass ? `Pass ${pass.roundNumber} · ${pass.name}` : 'Legacy / no round',
          };
        })
        .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));

      // Two responses from the SAME canvasser on the SAME campaign-day = the "mistake" signal.
      const seen = new Set();
      let sameCanvasserSameDay = false;
      for (const r of responses) {
        const key = `${r.canvasser.userId}|${r.day}`;
        if (seen.has(key)) sameCanvasserSameDay = true;
        seen.add(key);
      }
      const differentCanvassers = new Set(responses.map((r) => r.canvasser.userId)).size > 1;

      return {
        voterId: String(d._id),
        count: d.count,
        voter: voter
          ? {
              id: String(voter._id),
              fullName:
                voter.fullName || `${voter.firstName || ''} ${voter.lastName || ''}`.trim(),
              party: voter.party || null,
            }
          : null,
        household: household
          ? {
              id: String(household._id),
              addressLine1: household.addressLine1,
              city: household.city,
              state: household.state,
              zipCode: household.zipCode,
            }
          : null,
        responses,
        sameCanvasserSameDay,
        differentCanvassers,
      };
    });

    // Most suspicious first (same-canvasser-same-day), then by how many responses.
    result.sort(
      (a, b) => b.sameCanvasserSameDay - a.sameCanvasserSameDay || b.count - a.count
    );

    res.json({ duplicates: result, total: result.length, timeZone: tz, tzAbbrev: tzAbbrev(tz) });
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
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, ...NOT_BULK };

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
          refused: 0,
          litDropped: 0,
          restricted: 0,
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
      else if (r._id.actionType === 'refused') u.refused = r.count;
      else if (r._id.actionType === 'lit_dropped') u.litDropped = r.count;
      else if (r._id.actionType === 'restricted') u.restricted = r.count;
      else if (r._id.actionType === 'survey_submitted') u.surveyKnocks = r.count;
      if (!u.firstActivityAt || r.firstAt < u.firstActivityAt) u.firstActivityAt = r.firstAt;
      if (!u.lastActivityAt || r.lastAt > u.lastActivityAt) u.lastActivityAt = r.lastAt;
    }
    for (const r of hoursAgg) {
      const u = ensure(r._id);
      u.hoursOnDoors = r.hoursOnDoors;
      u.daysActive = r.daysActive;
    }

    const userMap = await hydrateCanvassers(Array.from(byUser.keys()), activeOrgId(req), {
      fields: 'phone',
    });

    const headers = [
      'Rank', 'First name', 'Last name', 'Email', 'Phone', 'Status',
      'Knocks', 'Surveys', 'Lit drops', 'Not home', 'Wrong address',
      'Connection rate %', 'Hours on doors', 'Days active', 'Knocks/hr', 'Surveys/hr',
      'First activity', 'Last activity', 'Refused', 'Restricted',
    ];
    const enriched = Array.from(byUser.values())
      .map((u) => {
        const info = userMap.get(u.userId) || {};
        // Billable knocks = distinct (household, pass). Connection = completion knocks / knocks.
        const knocks = u.notHome + u.wrongAddress + u.refused + u.litDropped + u.surveyKnocks;
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
          status: info.status || 'deleted',
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
      // Was a yes/no "Active" column reading User.isActive — which only ever went false on
      // account DELETION, so a deactivated or departed canvasser exported as "yes". The named
      // standing is the honest column; their knocks are in this row either way.
      u.status,
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
      u.refused,
      u.restricted,
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-round billing report ("knocks by pass")
// ─────────────────────────────────────────────────────────────────────────────

// The rows an invoice is assembled from: walk list × round over the billing pipeline
// (distinct household×pass), plus campaign totals from the SAME pipeline — so the rows
// always sum exactly to the headline they break down. The round-blind Campaign.stats
// fast-path is never used here; everything is live aggregation.
//
// "New homes reached" (coverageGained) = households whose FIRST-EVER campaign knock
// landed in that round; a date window applies to WHEN that first knock happened. So a
// re-knocked R1 door adds a knock to R2 but never coverage, and Σ(coverageGained) over
// all time equals the campaign's distinct knocked-door coverage.
//
// ?groupBy=canvasser adds RAW per-user rows (NOT_BULK, never team-folded). A door two
// canvassers both knocked in the same round counts ONCE for the round but once per
// canvasser — the over-claim is reported as crossCanvasserDoors (the /team-breakdown
// convention), computed against a NOT_BULK round total so admin bulk marks can't
// masquerade as cross-canvasser overlap.
//
// Shared by the JSON and CSV handlers so the report and the export can't drift.
async function buildKnocksByPass(req) {
  if (!req.query.campaignId || !mongoose.isValidObjectId(req.query.campaignId)) {
    return { error: { status: 400, message: 'campaignId is required' } };
  }
  const cFilter = baseFilter(req); // organizationId + campaignId (+ optional effortId)
  const windowed = parseDateRange(req, 'timestamp');
  const match = { ...cFilter, ...windowed };
  const groupByCanvasser = req.query.groupBy === 'canvasser';

  // Org-scope the metadata lookups too — baseFilter org-scopes the activity aggregates,
  // but without organizationId here a foreign campaignId would still leak another org's
  // walk-list/round names and dates as zero-knock rows.
  const passFilter = { organizationId: cFilter.organizationId, campaignId: cFilter.campaignId };
  if (cFilter.effortId) passFilter.effortId = cFilter.effortId;

  const [perPass, totalRows, firstKnockRows, passes, efforts] = await Promise.all([
    CanvassActivity.aggregate(knocksPipeline(match, { byPass: true })),
    CanvassActivity.aggregate(knocksPipeline(match)),
    // First-ever knock per household scans the campaign LIFETIME — no date filter AND no
    // effortId: CanvassActivity.effortId is stamped at knock time and never restamped, so
    // an effort-scoped scan would call a force-claimed, previously-worked door "new" the
    // moment its old knocks sit under the old effort. First-ever means first-ever in the
    // CAMPAIGN; effortId only selects which rows are displayed. The window then narrows
    // to first-knocks that happened inside it.
    CanvassActivity.aggregate([
      {
        $match: {
          organizationId: cFilter.organizationId,
          campaignId: cFilter.campaignId,
          actionType: { $in: KNOCK_ACTIONS },
        },
      },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: '$householdId',
          firstAt: { $first: '$timestamp' },
          firstPassId: { $first: '$passId' },
        },
      },
      ...(windowed.timestamp ? [{ $match: { firstAt: windowed.timestamp } }] : []),
      { $group: { _id: '$firstPassId', coverageGained: { $sum: 1 } } },
    ]),
    Pass.find(passFilter, 'roundNumber name status effortId activatedAt archivedAt').lean(),
    Effort.find({ organizationId: cFilter.organizationId, campaignId: cFilter.campaignId }, 'name').lean(),
  ]);

  const effortName = new Map(efforts.map((e) => [String(e._id), e.name]));
  const passById = new Map(passes.map((p) => [String(p._id), p]));
  const countsByPass = new Map(perPass.map((r) => [String(r._id), r]));
  const coverageByPass = new Map(firstKnockRows.map((r) => [String(r._id), r.coverageGained]));

  // Row set = every round of the campaign/effort (even 0-knock ones — "R2 active, no
  // knocks yet" is real information) + any agg bucket without a Pass doc (legacy
  // passId:null, or a knock whose pass was deleted).
  const rowKeys = new Set([...passes.map((p) => String(p._id)), ...perPass.map((r) => String(r._id))]);
  const shapeRow = (key) => {
    const p = passById.get(key) || null;
    const k = countsByPass.get(key) || { knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0 };
    const legacy = key === 'null' || key === 'undefined';
    return {
      passId: legacy ? null : key,
      effortId: p ? String(p.effortId) : null,
      effortName: p ? effortName.get(String(p.effortId)) || null : null,
      roundNumber: p ? p.roundNumber : null,
      roundName: p ? p.name : null,
      roundLabel: p ? `Pass ${p.roundNumber} · ${p.name}` : 'Legacy / no round',
      status: p ? p.status : null,
      activatedAt: p?.activatedAt || null,
      archivedAt: p?.archivedAt || null,
      knocks: k.knocks,
      surveyedKnocks: k.surveyedKnocks,
      litKnocks: k.litKnocks,
      refusedKnocks: k.refusedKnocks,
      connectionRate: connectionRate(k),
      contactRate: contactRate(k),
      coverageGained: coverageByPass.get(key) || 0,
    };
  };
  const rounds = [...rowKeys].map(shapeRow).sort(
    (a, b) =>
      (a.effortName || '￿').localeCompare(b.effortName || '￿') ||
      (a.roundNumber ?? Infinity) - (b.roundNumber ?? Infinity)
  );

  const t = totalRows[0] || { knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0 };
  const totals = {
    knocks: t.knocks,
    surveyedKnocks: t.surveyedKnocks,
    litKnocks: t.litKnocks,
    refusedKnocks: t.refusedKnocks,
    connectionRate: connectionRate(t),
    contactRate: contactRate(t),
    // Sum the DISPLAYED rows, not every first-knock bucket — the scan is deliberately
    // effort-unscoped (see above), so under ?effortId other efforts' buckets exist but
    // aren't shown, and the TOTAL must stay the sum of the table.
    coverageGained: rounds.reduce((s, r) => s + r.coverageGained, 0),
  };

  let byCanvasser;
  let crossCanvasserDoors;
  if (groupByCanvasser) {
    const flag = (action) => ({ $max: { $cond: [{ $eq: ['$actionType', action] }, 1, 0] } });
    const [userRows, nonBulkPerPass] = await Promise.all([
      CanvassActivity.aggregate([
        { $match: { ...match, ...NOT_BULK, actionType: { $in: KNOCK_ACTIONS } } },
        {
          $group: {
            _id: { householdId: '$householdId', passId: '$passId', userId: '$userId' },
            hasSurvey: flag('survey_submitted'),
            hasLit: flag('lit_dropped'),
            hasRefused: flag('refused'),
          },
        },
        {
          $group: {
            _id: { passId: '$_id.passId', userId: '$_id.userId' },
            knocks: { $sum: 1 },
            surveyedKnocks: { $sum: '$hasSurvey' },
            litKnocks: { $sum: '$hasLit' },
            refusedKnocks: { $sum: '$hasRefused' },
          },
        },
      ]),
      CanvassActivity.aggregate(knocksPipeline({ ...match, ...NOT_BULK }, { byPass: true })),
    ]);
    const userMap = await hydrateCanvassers(
      userRows.filter((r) => r._id.userId != null).map((r) => String(r._id.userId)),
      activeOrgId(req),
    );
    byCanvasser = userRows
      .filter((r) => r._id.userId != null)
      .map((r) => {
        const key = String(r._id.passId);
        const p = passById.get(key) || null;
        const info = userMap.get(String(r._id.userId)) || {};
        return {
          passId: p ? key : null,
          roundNumber: p ? p.roundNumber : null,
          roundName: p ? p.name : null,
          roundLabel: p ? `Pass ${p.roundNumber} · ${p.name}` : 'Legacy / no round',
          effortName: p ? effortName.get(String(p.effortId)) || null : null,
          userId: String(r._id.userId),
          firstName: info.firstName || '',
          lastName: info.lastName || '',
          email: info.email || '',
          status: info.status || 'deleted',
          knocks: r.knocks,
          surveyedKnocks: r.surveyedKnocks,
          litKnocks: r.litKnocks,
          refusedKnocks: r.refusedKnocks,
          connectionRate: connectionRate(r),
          contactRate: contactRate(r),
        };
      })
      .sort(
        (a, b) =>
          (a.effortName || '￿').localeCompare(b.effortName || '￿') ||
          (a.roundNumber ?? Infinity) - (b.roundNumber ?? Infinity) ||
          b.knocks - a.knocks
      );
    const nonBulkByPass = new Map(nonBulkPerPass.map((r) => [String(r._id), r.knocks]));
    const sumByPass = new Map();
    for (const r of byCanvasser) {
      const key = r.passId ?? 'null';
      sumByPass.set(key, (sumByPass.get(key) || 0) + r.knocks);
    }
    crossCanvasserDoors = 0;
    for (const [key, sum] of sumByPass) {
      crossCanvasserDoors += Math.max(0, sum - (nonBulkByPass.get(key) || 0));
    }
  }

  return { cFilter, rounds, totals, byCanvasser, crossCanvasserDoors };
}

router.get('/knocks-by-pass', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const built = await buildKnocksByPass(req);
    if (built.error) return res.status(built.error.status).json({ error: built.error.message });
    res.json({
      campaignId: String(built.cFilter.campaignId),
      timeZone: tzOf(req),
      from: req.query.from || null,
      to: req.query.to || null,
      rounds: built.rounds,
      totals: built.totals,
      byCanvasser: built.byCanvasser,
      crossCanvasserDoors: built.crossCanvasserDoors,
    });
  } catch (err) {
    next(err);
  }
});

// The invoice-ready download. Default view: one row per walk list × round + a TOTAL row
// (checkable against the invoice at a glance). ?groupBy=canvasser swaps in the per-user
// per-round rows; coverage is omitted there — first-ever-knock coverage has no honest
// per-canvasser attribution.
router.get('/knocks-by-pass.csv', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const built = await buildKnocksByPass(req);
    if (built.error) return res.status(built.error.status).json({ error: built.error.message });

    let headers;
    let rows;
    if (built.byCanvasser) {
      headers = [
        'Walk list', 'Round', 'Round name', 'Canvasser first name', 'Canvasser last name',
        'Email', 'Status', 'Knocks', 'Survey doors', 'Lit knocks', 'Refused',
        'Connection rate %', 'Contact rate %',
      ];
      rows = built.byCanvasser.map((r) => [
        r.effortName || '', r.roundNumber ?? '', r.roundName ?? r.roundLabel,
        r.firstName, r.lastName, r.email, r.status,
        r.knocks, r.surveyedKnocks, r.litKnocks, r.refusedKnocks,
        r.connectionRate, r.contactRate,
      ]);
    } else {
      headers = [
        'Walk list', 'Round', 'Round name', 'Round status', 'Activated (ISO)', 'Archived (ISO)',
        'Knocks', 'Survey doors', 'Lit knocks', 'Refused',
        'Connection rate %', 'Contact rate %', 'New homes reached',
      ];
      rows = built.rounds.map((r) => [
        r.effortName || '', r.roundNumber ?? '',
        r.roundName ?? r.roundLabel, r.status || '',
        r.activatedAt ? new Date(r.activatedAt).toISOString() : '',
        r.archivedAt ? new Date(r.archivedAt).toISOString() : '',
        r.knocks, r.surveyedKnocks, r.litKnocks, r.refusedKnocks,
        r.connectionRate, r.contactRate, r.coverageGained,
      ]);
      const t = built.totals;
      rows.push([
        'TOTAL', '', '', '', '', '',
        t.knocks, t.surveyedKnocks, t.litKnocks, t.refusedKnocks,
        t.connectionRate, t.contactRate, t.coverageGained,
      ]);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="knocks-by-pass-${new Date().toISOString().slice(0, 10)}.csv"`
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
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, ...NOT_BULK };

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
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId, ...NOT_BULK };

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
          // Include 'restricted' so its time extends the per-day shift window (hoursOnDoors),
          // but keep homesKnocked knock-only (restricted is never a knock).
          { $match: { ...activityMatch, actionType: { $in: [...KNOCK_ACTIONS, 'restricted'] } } },
          {
            $group: {
              _id: dayBucketExpr('timestamp', tz),
              homesKnocked: { $sum: { $cond: [{ $eq: ['$actionType', 'restricted'] }, 0, 1] } },
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
                  $cond: [{ $gt: ['$distanceFromHouseMeters', FAR_WARN_M] }, 1, 0],
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

    const actions = { not_home: 0, wrong_address: 0, refused: 0, survey_submitted: 0, lit_dropped: 0, note_added: 0, restricted: 0 };
    for (const r of actionAgg) actions[r._id] = r.count;
    // The same knock definition as /canvassers: notHome + wrongAddress + REFUSED + lit + surveyed.
    // Refused was missing here (this endpoint predates the Refused disposition), which made this
    // panel read FEWER doors than the Timeline for the same person over the same range — and
    // inflated the rate below via the smaller denominator. Because the mobile write path keeps at
    // most one replaceable row per (canvasser, household, pass), this action sum IS the canvasser's
    // distinct door-pass count — no separate dedupe needed.
    const homesKnocked =
      actions.not_home + actions.wrong_address + actions.refused +
      actions.survey_submitted + actions.lit_dropped;

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
    // The SHARED rate helpers, so this panel can never disagree with the Timeline/leaderboard for
    // the same person over the same range. (It used to: a hand-rolled formula divided by a knock
    // count that omitted refused doors, so anyone with refusals read a higher rate here.)
    const connectionRatePct = connectionRate({
      knocks: homesKnocked,
      surveyedKnocks: actions.survey_submitted,
      litKnocks: actions.lit_dropped,
    });
    const contactRatePct = contactRate({
      knocks: homesKnocked,
      surveyedKnocks: actions.survey_submitted,
      refusedKnocks: actions.refused,
    });

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
        // TWO survey units, both named — one door can survey several voters, so these genuinely
        // differ and must never share a bare "Surveys" label. surveyDoors is the connection-rate
        // numerator; surveysSubmitted is voters (SurveyResponse rows).
        surveyDoors: actions.survey_submitted,
        surveysSubmitted,
        litDropped: actions.lit_dropped,
        notHome: actions.not_home,
        wrongAddress: actions.wrong_address,
        refused: actions.refused, // a real contact ("reached a person"), counted in the knocks
        notesAdded: actions.note_added,
        restricted: actions.restricted, // inaccessible-home marks — a tally, never a knock
        connectionRatePct,
        contactRatePct,
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
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId, ...NOT_BULK };

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
    const filter = { ...dateRange, ...cFilter, userId, ...NOT_BULK };

    if (req.query.actionType) {
      const types = String(req.query.actionType).split(',');
      filter.actionType = { $in: types };
    }
    if (req.query.flaggedOnly === 'true') {
      filter.$or = [
        { wasOfflineSubmission: true },
        { distanceFromHouseMeters: { $gt: FAR_WARN_M } },
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
    const match = { ...dateRange, ...cFilter, userId, ...NOT_BULK };

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
    const filter = { ...dateRange, ...cFilter, userId, ...NOT_BULK };

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
    const filter = { ...dateRange, ...cFilter, userId, ...NOT_BULK };

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
    const activityMatch = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId, ...NOT_BULK };
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
            { distanceFromHouseMeters: { $gt: FAR_WARN_M } },
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
    const filter = { ...parseDateRange(req, 'timestamp'), ...cFilter, userId, ...NOT_BULK };

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
      .populate('voterId', 'fullName party doNotContact.flagged')
      .lean();

    const headers = [
      'Timestamp', 'Action', 'Address', 'City', 'State', 'Zip', 'Voter', 'Party', 'Do not contact',
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
      a.voterId?.doNotContact?.flagged ? 'yes' : '',
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

// GPS canvassing-quality audit. Flags are computed LIVE from the CanvassActivity ledger
// (services/audit/flagDetection.js); only reviewer decisions are persisted (FlagReview).
// `summary` is the full picture for the scope (campaign/effort/date/userId in the match);
// reasonType/reviewStatus/severity narrow the paginated `entries` drill-in list.
const REASON_TYPES = ['far', 'rapid', 'one_spot', 'weak_gps', 'mock_gps'];

router.get('/flags', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const tz = tzOf(req);

    // Bound the scan the way the timeline does: an explicit from/to over 62 days is rejected.
    // (Relative presets send to:null → to defaults to today, so the span is still checked.
    // A fully open-ended range = campaign-bounded all-time, consistent with other reports.)
    const fromDay = req.query.from ? String(req.query.from).slice(0, 10) : null;
    if (fromDay) {
      const toDay = req.query.to ? String(req.query.to).slice(0, 10) : zonedDayStr(new Date(), tz);
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromDay) && /^\d{4}-\d{2}-\d{2}$/.test(toDay)) {
        if (fromDay > toDay) return res.status(400).json({ error: 'from must be on or before to' });
        if (ymdSpanDays(fromDay, toDay) > TIMELINE_MAX_DAYS) {
          return res.status(400).json({ error: `Date range too large (max ${TIMELINE_MAX_DAYS} days)` });
        }
      }
    }

    const match = { ...baseFilter(req), ...parseDateRange(req, 'timestamp') };
    if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) {
      match.userId = new mongoose.Types.ObjectId(req.query.userId);
    }

    // Guarantee a bounded scan even when `from` is absent — an open-ended range would otherwise pull
    // the whole campaign/org ledger into memory. Default the lower bound to TIMELINE_MAX_DAYS back.
    if (!match.timestamp || match.timestamp.$gte == null) {
      const upper = (match.timestamp && (match.timestamp.$lte || match.timestamp.$lt)) || new Date();
      const lower = new Date(new Date(upper).getTime() - TIMELINE_MAX_DAYS * 24 * 60 * 60 * 1000);
      match.timestamp = { ...(match.timestamp || {}), $gte: lower };
    }

    const { entries, summary, truncated, windowActionCount } = await detectFlags(match, { organizationId: orgId });

    // Drill-in filters (post-detection; note: 'open' is not a DB status, so review-status
    // filtering happens here after the live join).
    const reasonSet = csvSet(req.query.reasonType, REASON_TYPES);
    const statusSet = csvSet(req.query.reviewStatus, ['open', 'reviewed', 'dismissed', 'confirmed']);
    const minSev = SEVERITY_RANK[String(req.query.severity || '')] || null;

    let list = entries;
    if (reasonSet) list = list.filter((e) => e.reasons.some((r) => reasonSet.has(r.type)));
    if (statusSet) list = list.filter((e) => statusSet.has(e.review?.status || 'open'));
    if (minSev) list = list.filter((e) => (SEVERITY_RANK[e.maxSeverity] || 0) >= minSev);

    const total = list.length;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const page = req.query.view === 'summary' ? [] : list.slice(skip, skip + limit);

    res.json({
      summary,
      entries: page,
      total,
      limit,
      skip,
      timeZone: tz,
      tzAbbrev: tzAbbrev(tz),
      thresholds: FLAG_THRESHOLDS,
      // When the range is too large to audit in memory, entries are empty and this is set — the
      // client shows a "narrow the range" notice with windowActionCount rather than a false "0 flags".
      truncated: !!truncated,
      windowActionCount,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/flags/review', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { actionModel, actionId, status, note, reasonsAtReview } = req.body || {};

    if (!['CanvassActivity', 'SurveyResponse'].includes(actionModel)) {
      return res.status(400).json({ error: 'Invalid actionModel' });
    }
    if (!mongoose.isValidObjectId(actionId)) {
      return res.status(400).json({ error: 'Invalid actionId' });
    }
    if (!['open', 'reviewed', 'dismissed', 'confirmed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Load the flagged action to verify org + campaign ownership (defense in depth: a lead
    // must manage the action's campaign, re-derived from the action itself, not the query).
    const Model = actionModel === 'CanvassActivity' ? CanvassActivity : SurveyResponse;
    const action = await Model.findById(actionId, 'organizationId campaignId').lean();
    if (!action || String(action.organizationId) !== String(orgId)) {
      return res.status(404).json({ error: 'Flagged action not found' });
    }
    if (!isOrgAdmin(req) && !(await canManageCampaign(req, action.campaignId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Reopen = delete the decision (absence of a record IS 'open').
    if (status === 'open') {
      await FlagReview.deleteOne({ organizationId: orgId, actionModel, actionId });
      return res.json({ review: { status: 'open', note: null, reviewedBy: null, reviewedAt: null } });
    }

    const saved = await FlagReview.findOneAndUpdate(
      { organizationId: orgId, actionModel, actionId },
      {
        $set: {
          campaignId: action.campaignId,
          status,
          note: typeof note === 'string' ? note.slice(0, 2000) : null,
          reviewedBy: req.user._id,
          reviewedAt: new Date(),
          reasonsAtReview: Array.isArray(reasonsAtReview) ? reasonsAtReview.slice(0, 8) : [],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({
      review: {
        status: saved.status,
        note: saved.note || null,
        reviewedBy: String(saved.reviewedBy),
        reviewedAt: saved.reviewedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Centralized campaign notes — unify the three note sources into one searchable, filterable,
// VIEW-ONLY list: field door notes (CanvassActivity.note), survey notes (SurveyResponse.note), and
// admin/profile notes (VoterNote.body). VoterNote is org-level, so it's scoped to the campaign via
// voter → household. See docs/AUDIT.md sibling patterns; reuses voterProfile.js note shaping.
const NOTE_SOURCES = ['door', 'survey', 'voter'];
const NOTES_RESULT_CAP = 500;
const NOTE_NONEMPTY = { $exists: true, $ne: null, $not: /^\s*$/ };

// Escape user text so a search term can't inject regex metacharacters into a $regex.
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/notes', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const tz = tzOf(req);

    // campaignId is REQUIRED — the page is campaign-scoped, and the VoterNote lookup needs it.
    // (No org-wide fallback: baseFilter would otherwise return every campaign's notes.)
    const campaignId = req.query.campaignId;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'A campaignId is required.' });
    }
    const campaignObjId = new mongoose.Types.ObjectId(campaignId);
    const orgObjId = new mongoose.Types.ObjectId(orgId);

    const typeSet = csvSet(req.query.type, NOTE_SOURCES); // null = all three
    const wants = (t) => !typeSet || typeSet.has(t);
    const userId =
      req.query.userId && mongoose.isValidObjectId(req.query.userId)
        ? new mongoose.Types.ObjectId(req.query.userId)
        : null;
    const effortActive = !!(req.query.effortId && mongoose.isValidObjectId(req.query.effortId));
    const includeVoter = !effortActive; // VoterNote has no effort linkage

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rx = q ? new RegExp(escapeRegExp(q), 'i') : null;

    const cFilter = baseFilter(req); // org + campaignId + optional effortId
    const noteClause = rx ? { ...NOTE_NONEMPTY, $regex: rx } : NOTE_NONEMPTY;
    const bodyClause = rx ? { $exists: true, $ne: null, $regex: rx } : { $exists: true, $ne: null };

    const doorMatch = {
      ...cFilter,
      ...parseDateRange(req, 'timestamp'),
      actionType: { $ne: 'survey_submitted' }, // dedup: survey notes come from SurveyResponse
      note: noteClause,
      ...(userId ? { userId } : {}),
    };
    const surveyMatch = {
      ...cFilter,
      ...parseDateRange(req, 'submittedAt'),
      note: noteClause,
      ...(userId ? { userId } : {}),
    };
    // VoterNote → campaign via voter → household (inner $match campaignId). Returns the household
    // address + voter name in the join, so no second lookup for those.
    const voterBase = [
      {
        $match: {
          organizationId: orgObjId,
          ...parseDateRange(req, 'createdAt'),
          body: bodyClause,
          ...(userId ? { authorId: userId } : {}),
        },
      },
      {
        $lookup: {
          from: 'voters',
          localField: 'voterId',
          foreignField: '_id',
          pipeline: [
            { $match: { organizationId: orgObjId } },
            {
              $lookup: {
                from: 'households',
                localField: 'householdId',
                foreignField: '_id',
                pipeline: [
                  { $match: { campaignId: campaignObjId } },
                  { $project: { addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1 } },
                ],
                as: 'hh',
              },
            },
            { $unwind: '$hh' },
            { $project: { fullName: 1, hh: 1 } },
          ],
          as: 'v',
        },
      },
      { $unwind: '$v' },
    ];

    const [doorRows, surveyRows, voterRows, doorCount, surveyCount, voterCountArr] = await Promise.all([
      wants('door')
        ? CanvassActivity.find(doorMatch, '_id note timestamp actionType userId householdId voterId')
            .sort({ timestamp: -1 })
            .limit(NOTES_RESULT_CAP)
            .lean()
        : [],
      wants('survey')
        ? SurveyResponse.find(
            surveyMatch,
            '_id note submittedAt userId householdId voterId editedBy editedAt'
          )
            .sort({ submittedAt: -1 })
            .limit(NOTES_RESULT_CAP)
            .lean()
        : [],
      wants('voter') && includeVoter
        ? VoterNote.aggregate([...voterBase, { $sort: { createdAt: -1 } }, { $limit: NOTES_RESULT_CAP }])
        : [],
      // Counts ignore `type` so the filter chips stay accurate; they honor every other filter.
      CanvassActivity.countDocuments(doorMatch),
      SurveyResponse.countDocuments(surveyMatch),
      includeVoter ? VoterNote.aggregate([...voterBase, { $count: 'n' }]) : [{ n: 0 }],
    ]);
    const voterCount = voterCountArr?.[0]?.n || 0;

    // Resolve author/editor names in one query.
    const userIdSet = new Set();
    const addU = (id) => id && userIdSet.add(String(id));
    for (const r of doorRows) addU(r.userId);
    for (const r of surveyRows) { addU(r.userId); addU(r.editedBy); }
    for (const r of voterRows) { addU(r.authorId); addU(r.editedBy); }
    const users = userIdSet.size
      ? await User.find({ _id: { $in: [...userIdSet] } }, 'firstName lastName email').lean()
      : [];
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    const who = (id) => {
      const u = id && uMap.get(String(id));
      return u ? { id: String(id), name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email } : null;
    };

    // Batch households + voters for door/survey items (voter notes carry them from the join).
    const hhIdSet = new Set();
    const vIdSet = new Set();
    for (const r of [...doorRows, ...surveyRows]) {
      if (r.householdId) hhIdSet.add(String(r.householdId));
      if (r.voterId) vIdSet.add(String(r.voterId));
    }
    const [hhDocs, vDocs] = await Promise.all([
      hhIdSet.size
        ? Household.find({ _id: { $in: [...hhIdSet] } }, 'addressLine1 addressLine2 city state zipCode').lean()
        : [],
      vIdSet.size ? Voter.find({ _id: { $in: [...vIdSet] } }, 'fullName').lean() : [],
    ]);
    const hhMap = new Map(hhDocs.map((h) => [String(h._id), h]));
    const vMap = new Map(vDocs.map((v) => [String(v._id), v]));
    const hhItem = (id) => {
      const h = id && hhMap.get(String(id));
      return h ? { id: String(h._id), address: streetAddress(h) } : null;
    };
    const vItem = (id) => {
      const v = id && vMap.get(String(id));
      return v ? { id: String(id), name: v.fullName || '' } : null;
    };
    const editedItem = (by, at) => (by || at ? { by: who(by), at: at || null } : null);

    const items = [
      ...doorRows.map((r) => ({
        id: String(r._id),
        source: 'door',
        note: r.note,
        timestamp: r.timestamp,
        author: who(r.userId),
        actionType: r.actionType,
        household: hhItem(r.householdId),
        voter: vItem(r.voterId), // may be null (household-scoped)
        edited: null,
      })),
      ...surveyRows.map((r) => ({
        id: String(r._id),
        source: 'survey',
        note: r.note,
        timestamp: r.submittedAt,
        author: who(r.userId),
        actionType: 'survey_submitted',
        household: hhItem(r.householdId),
        voter: vItem(r.voterId),
        edited: editedItem(r.editedBy, r.editedAt),
      })),
      ...voterRows.map((r) => ({
        id: String(r._id),
        source: 'voter',
        note: r.body,
        timestamp: r.createdAt,
        author: who(r.authorId),
        actionType: null,
        household: r.v?.hh
          ? { id: String(r.v.hh._id), address: streetAddress(r.v.hh) }
          : null,
        voter: { id: String(r.voterId), name: r.v?.fullName || '' },
        edited: editedItem(r.editedBy, r.editedAt),
      })),
    ];
    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp) || (a.id < b.id ? 1 : -1));

    const counts = { door: doorCount, survey: surveyCount, voter: voterCount, total: doorCount + surveyCount + voterCount };

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    const total = items.length; // pageable (post-cap merged length)
    const pageItems = items.slice(page * limit, page * limit + limit);
    // `capped` = a wanted source hit RESULT_CAP (so you're not seeing everything of the wanted types).
    const capped =
      (wants('door') && doorCount > doorRows.length) ||
      (wants('survey') && surveyCount > surveyRows.length) ||
      (wants('voter') && includeVoter && voterCount > voterRows.length);

    res.json({
      notes: pageItems,
      total,
      counts,
      capped,
      page,
      limit,
      resultCap: NOTES_RESULT_CAP,
      timeZone: tz,
      tzAbbrev: tzAbbrev(tz),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
