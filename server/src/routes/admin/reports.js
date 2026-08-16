import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds, canManageCampaign } from '../../services/authz/campaignManagement.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { choiceKeyStages, mergeOptionRows, voterAnswerClause, answerTagClause } from '../../services/surveys/answerAgg.js';
import { currentVoterSetsByTag } from '../../services/surveys/currentTags.js';
import { OTHER_OPTION_ID } from '../../services/surveys/otherOption.js';
import { tagOptionMap, normalizeTag } from '../../services/surveys/tags.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Organization } from '../../models/Organization.js';
import { zonedDayRange, tzAbbrev, zonedDayStr } from '../../utils/timezone.js';
import {
  KNOCK_ACTIONS,
  BILLABLE_WITH_RESTRICTED,
  NOT_BULK,
  knocksPipeline,
  billableDoorsOf,
  connectionRate,
  contactRate,
  coverageBucketExpr,
  teamFoldStage,
  teamMatch,
  withTeam,
  NON_KNOCKED_STATUSES,
  NON_KNOCKED_BUCKETS,
} from '../../services/reports/aggregations.js';
import { billRestrictedFor, resolveBillRestricted } from '../../services/reports/billRestricted.js';
import { goalProgressFor } from '../../services/reports/goalProgress.js';
import {
  loadMeasuredHours,
  foldUserHours,
  aggregateSource,
  spanHours,
} from '../../services/reports/hoursSource.js';
import { campaignSummaries } from '../../services/reports/campaignSummaries.js';
import { computeOverlaps, computeOverlapDoors } from '../../services/reports/overlaps.js';
import { hydrateCanvassers } from '../../services/reports/canvasserIdentity.js';
import { buildKnocksByPassData } from '../../services/reports/knocksByPass.js';
import { detectFlags } from '../../services/audit/flagDetection.js';
import { computeFarKpi, farKpiForRows } from '../../services/audit/farKpi.js';
import { FLAG_THRESHOLDS, SEVERITY_RANK, AUDIT_WINDOW_MAX_DAYS } from '../../services/audit/flagThresholds.js';
import { FlagReview } from '../../models/FlagReview.js';
import { VoterNote } from '../../models/VoterNote.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

// Record-level audit tag: the /canvassers/:userId drills + export read ONE person's performance
// data — a staff read under a support grant logs whose (see routes/admin/voters.js).
router.param('userId', (req, res, next, userId) => {
  if (mongoose.isValidObjectId(userId)) addAuditSubjects(res, 'user', userId);
  next();
});

// Shared "far knock" threshold — the legacy far-counts/flagged feeds and the new GPS audit
// all key off ONE number (services/audit/flagThresholds.js), so "far" means one thing.
const FAR_WARN_M = FLAG_THRESHOLDS.FAR_WARN_M;

// Reports are campaign-scoped via ?campaignId. Historically baseFilter trusted any
// campaignId with no ownership check. Team leads may pull reports ONLY for a campaign
// they manage — and never org-wide (no campaignId), which would span other campaigns.
// (This also closes the trust-any-campaignId gap.)
//
// Org admins were historically unscoped: no campaignId meant "the whole org", which for a
// single-campaign org is the same numbers. With 2+ campaigns it silently BLENDS them into
// figures that read like one campaign's — and every shipping client always sends
// campaignId, so an omission is a forgotten filter, not a request for a blend. Enforced
// only for multi-campaign orgs (single-campaign orgs keep the legacy shape, so nothing in
// the field can break), with `all=1` as the explicit org-wide escape hatch.
router.use(async (req, res, next) => {
  try {
    // The cross-campaign rollup is the per-campaign LIST (web Overview, mobile admin
    // landing; a lead's self-scopes to their managed campaigns below), so it's allowed
    // without a single campaignId — unlike every other (per-campaign) report.
    if (req.path === '/campaign-rollup') return next();
    // POST /flags/review scopes ITSELF: it loads the flagged action, checks org ownership,
    // re-derives campaignId from the record and re-checks canManageCampaign. It never reads
    // ?campaignId — and neither client sends one (docs/AUDIT.md documents it as body-only).
    // A read-scoping guard that demands one therefore 400s admins in multi-campaign orgs
    // and 403s leads in EVERY org. Exempted by exact method+path rather than "any non-GET",
    // so a future write still gets scoped — and POST /flags/review-bulk is that write: it
    // carries its scope in the QUERY on purpose so this guard vets it (a lead gets the
    // canManageCampaign check right here). Do not exempt it.
    if (req.method === 'POST' && req.path === '/flags/review') return next();
    const campaignId = req.query.campaignId;
    const hasCampaign = campaignId && mongoose.isValidObjectId(campaignId);
    if (isOrgAdmin(req)) {
      if (hasCampaign || req.query.all === '1') return next();
      const orgId = req.activeOrg?._id;
      const campaigns = orgId ? await Campaign.countDocuments({ organizationId: orgId }) : 0;
      if (campaigns > 1) {
        return res.status(400).json({ error: 'This organization runs multiple campaigns — pass campaignId, or all=1 for an org-wide total.' });
      }
      return next();
    }
    if (!hasCampaign) {
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

// Optional per-ROUND scoping for the SURVEY surfaces — deliberately NOT part of baseFilter().
//
// A walk-list filter is not a substitute: `roundNumber` auto-increments per EFFORT (models/Pass.js),
// so "Pass 2" names a different round in every walk list, and filtering to an effort still merges
// that effort's rounds. Nor is a date range: rounds in different efforts can be active at the same
// time, so one window can straddle several.
//
// Kept out of baseFilter because /knocks-by-pass builds its ROW SET from every Pass of the campaign
// while counting through the same filter — narrowing the counts there would render every other
// round as a real-looking zero. Only surfaces that show one scope at a time may spread this in.
function passFilterOf(req) {
  // `?passId=legacy` selects the pre-turf bucket — rows whose passId is null. Without it, those
  // responses belong to "All passes" and to no selectable pass, so Σ(passes) would silently fall
  // short of the all-passes total on any org with pre-turf history. /knocks-by-pass has always
  // surfaced this bucket as a "Legacy / no pass" row for exactly the same reason.
  //
  // NOTE the sentinel below is the literal string 'legacy' — an API value the clients send, not a
  // label. The DISPLAY text changed from "round" to "pass"; this must not.
  if (req.query.passId === 'legacy') return { passId: null };
  if (req.query.passId && mongoose.isValidObjectId(req.query.passId)) {
    return { passId: new mongoose.Types.ObjectId(req.query.passId) };
  }
  return {};
}

// Optional TEAM (coordinator) scoping — deliberately NOT part of baseFilter().
//
// baseFilter's result is spread into HOUSEHOLD queries (see /overview: `{ isActive: true,
// ...cFilter }`), and a household has no team — a door doesn't belong to a crew. Putting the key
// there would make every household query match zero documents and silently ZERO OUT Coverage.
// effortId only gets away with living in baseFilter because it IS denormalized onto Household.
//
// So this is opt-in, merged via withTeam (NEVER a spread) into CanvassActivity / SurveyResponse
// matches only. Wired on: /canvasser-timeline, /campaign-rollup, /canvassers, /survey-results,
// /voters-by-answer (+.csv), /answer-canvassers, /canvassers/:userId/responses, and
// /knocks-by-pass (+.csv, via the buildKnocksByPass adapter → team param).
//
//   ?coordinatorId=<id>   → that team
//   ?coordinatorId=none   → the "No team" bucket (a candidate knocking their own district, etc.)
//
// teamMatch and withTeam live in services/reports/aggregations.js (imported above) — the
// knocks-by-pass service needs them too, and it can't import from a route file. Re-exported
// here so the export surface of this module is unchanged.
export { teamMatch };

// The users who run a crew in this scope — i.e. whose OWN unstamped doors should fold onto their
// own team row, and who the "No team" bucket must therefore exclude (or their doors count twice).
//
// DERIVED FROM THE LEDGER, deliberately, and this is load-bearing. The obvious sources are both
// wrong now that a crew is per-campaign:
//   · Membership — has no campaign, so it answers org-wide and would fold a lead's doors onto
//     their own team in campaigns where they run no crew at all.
//   · CampaignAssignment — is a roster GATE that is hard-DELETED when somebody is removed from a
//     campaign (services/users/deleteAccount.js). Sourcing the lead set from it means a lead loses
//     their own folded doors the moment their last crew member comes off the roster: exactly the
//     bug the frozen stamp was introduced to fix, reintroduced through the back door.
// The stamp already on the ledger says who supervised each door and cannot be un-said, so it
// survives departure, org removal and roster churn — the three cases that broke the alternatives.
//
// Scope carries campaignId when the caller sent one, and omits it for the unscoped admin calls
// (which reproduce the org-wide set, so those keep working unchanged).
async function leadIdsForScope(scope) {
  const filter = { ...scope, ...NOT_BULK, coordinatorId: { $ne: null } };
  const [fromDoors, fromSurveys] = await Promise.all([
    CanvassActivity.distinct('coordinatorId', filter),
    // The survey ledger can name a team the door ledger does not — a re-stamp that half-landed, or
    // legacy rows. teamFoldStage is applied to BOTH aggregates, so the lead set has to cover both
    // or the two halves of /team-breakdown fold differently, which no sum check can see.
    SurveyResponse.distinct('coordinatorId', { ...scope, coordinatorId: { $ne: null } }),
  ]);
  return [...new Set([...fromDoors, ...fromSurveys].map(String))];
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
  // The `none` bucket has to exclude whoever runs a crew HERE, in the same scope the caller is
  // asking about — a lead's own doors already belong to their own team row, and counting them in
  // "No team" too would double them. baseFilter carries campaignId when one was sent.
  const leads = raw === 'none' ? await leadIdsForScope(baseFilter(req)) : [];
  return teamMatch(raw, leads);
}

// The human-readable crew scope for a frozen export's stamp. Empty string (falsy, so it drops
// out of the preamble) when no crew filter was applied — an unfiltered file should not carry a
// row saying so, since that is the normal case and every export would grow noise.
async function crewStampLabel(raw) {
  if (!raw) return '';
  if (raw === 'none') return 'Crew: no coordinator';
  if (!mongoose.isValidObjectId(raw)) return '';
  const u = await User.findById(raw, 'firstName lastName').lean();
  const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
  return `Crew: ${name || 'unknown coordinator'}`;
}

// KNOCK_ACTIONS, knocksPipeline, connectionRate, coverageBucketExpr, teamMatch, withTeam now
// live in services/reports/aggregations.js (shared with the client report builder and the
// knocks-by-pass service).

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

// The campaign scope for measured-hours attribution (hoursSource.js header
// rule): campaign-scoped requests charge a canvasser's clocked-but-no-knocks
// days here only inside their stint and never on days knocked elsewhere.
// Same validation as baseFilter; null (org-wide) = every clocked day counts.
function scopedCampaignId(req) {
  return req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)
    ? req.query.campaignId
    : null;
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
      const [statDocs, orgDefaults] = await Promise.all([
        Campaign.find(scopeFilter, { stats: 1, billRestrictedDoors: 1 }).lean(),
        Organization.findById(orgId, { billRestrictedDoors: 1 }).lean(),
      ]);
      if (statDocs.length && statDocs.every((d) => d.stats?.reconciledAt)) {
        statTotals = statDocs.reduce(
          (acc, d) => ({
            knocks: acc.knocks + (d.stats.knockCount || 0),
            surveyedKnocks: acc.surveyedKnocks + (d.stats.surveyedKnockCount || 0),
            litKnocks: acc.litKnocks + (d.stats.litKnockCount || 0),
            refusedKnocks: acc.refusedKnocks + (d.stats.refusedKnockCount || 0),
            surveysSubmitted: acc.surveysSubmitted + (d.stats.surveyCount || 0),
            // Resolved PER CAMPAIGN, then summed: an org-wide rollup can span campaigns that
            // disagree about the policy, and a single org-level check would silently apply one
            // campaign's answer to all of them. A campaign that doesn't bill restricted doors
            // contributes only its knocks — which is exactly `billableDoors === knocks` there.
            billableDoors:
              acc.billableDoors +
              (d.stats.knockCount || 0) +
              (resolveBillRestricted(d, orgDefaults) ? d.stats.restrictedDoorCount || 0 : 0),
            restrictedDoors: acc.restrictedDoors + (d.stats.restrictedDoorCount || 0),
          }),
          {
            knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0,
            surveysSubmitted: 0, billableDoors: 0, restrictedDoors: 0,
          }
        );
      }
    }

    // Only needed by the live fallback below — the counter path already resolved the flag PER
    // CAMPAIGN while summing, which the single scalar here couldn't express for an org-wide scope.
    const liveBillRestricted = statTotals ? false : await billRestrictedFor(orgId, cFilter.campaignId);

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
      Household.countDocuments({ ...householdMatch, status: { $nin: NON_KNOCKED_STATUSES } }),
      Household.aggregate([
        { $match: householdMatch },
        { $group: { _id: coverageBucketExpr, count: { $sum: 1 } } },
      ]),
      CanvassActivity.aggregate([
        { $match: cFilter },
        { $group: { _id: '$actionType', count: { $sum: 1 } } },
      ]),
      // Billable knocks: distinct (household, pass). See knocksPipeline. The live fallback runs
      // with includeRestricted so it yields the same pair of numbers the counter path does —
      // `knocks` is identical either way, so nothing else on this response shifts.
      statTotals ? [] : CanvassActivity.aggregate(knocksPipeline(cFilter, { includeRestricted: true })),
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
      no_soliciting: 0, // a sign ended the visit — reached the door, so it IS "knocked"
      voted: 0,
      dnc: 0, // fully do-not-contact doors — suppressed, never to be knocked
    };
    for (const r of statusAgg) canvass[r._id] = r.count;

    const events = { notHome: 0, wrongAddress: 0, surveySubmitted: 0, litDropped: 0, refused: 0, restricted: 0, noSoliciting: 0 };
    for (const r of eventAgg) {
      if (r._id === 'not_home') events.notHome = r.count;
      else if (r._id === 'wrong_address') events.wrongAddress = r.count;
      else if (r._id === 'survey_submitted') events.surveySubmitted = r.count;
      else if (r._id === 'lit_dropped') events.litDropped = r.count;
      else if (r._id === 'refused') events.refused = r.count;
      else if (r._id === 'restricted') events.restricted = r.count;
      else if (r._id === 'no_soliciting') events.noSoliciting = r.count;
    }

    const k = statTotals ||
      knockAgg[0] || {
        knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0, billableDoors: 0, restrictedDoors: 0,
      };
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
        // Equal to `knocks` unless the campaign(s) in scope bill restricted doors. Rates
        // (below) and homesKnocked (above) stay knock-based in every case. The counter path
        // already applied each campaign's own policy while summing; only the live single-scope
        // fallback still needs the helper.
        billableDoors: statTotals ? k.billableDoors : billableDoorsOf(k, liveBillRestricted),
        // PRECONDITION before you render this or build on it: on the COUNTER path (statTotals)
        // this is only guaranteed once the billable-door policy has been enabled, because that
        // transition is what recomputes stats.restrictedDoorCount from the ledger. For a campaign
        // that predates the feature and has never opted in, it can be partial.
        //
        // That is safe today precisely because nothing reads it in that state — billableDoors is
        // plain `knocks` while the policy is off. Adding a "restricted homes" tile fed from here
        // would break that, and would do so silently. Use the live-aggregated surfaces
        // (/knocks-by-pass, /canvasser-timeline, the billing statement) if you need it
        // unconditionally: they never touch the cache.
        restrictedDoors: k.restrictedDoors ?? 0,
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

    // NOT_DELETING: a mid-delete campaign is out of every rollup scope, including an
    // explicit ?campaignId (services/campaigns/deletionState.js).
    const filter = { organizationId, ...NOT_DELETING };
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

    const campaigns = await Campaign.find(filter, { name: 1, type: 1, isActive: 1, timeZone: 1, surveyTemplateId: 1, electionDay: 1, earlyVotingStart: 1, earlyVotingEnd: 1, datesNote: 1, doorGoal: 1, goalDate: 1, stats: 1, billRestrictedDoors: 1 }).lean();
    const ids = campaigns.map((c) => c._id);
    // Org default for the billable-door policy; each row resolves its own override against it,
    // because a rollup can legitimately span campaigns that answer differently.
    const orgDefaults = await Organization.findById(organizationId, { billRestrictedDoors: 1 }).lean();

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
          billableDoors: 0,
          restrictedDoors: 0,
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
    // Optional crew scope (?coordinatorId) — applied to the ACTIVITY/SURVEY matches only, never
    // the Household coverage aggregation below: doors don't belong to a crew, so Coverage stays
    // campaign-wide by design (the clients caption it). withTeam, never a spread — dateMatch can
    // return the cross-timezone $or, and the `none` shape carries a userId key.
    const team = await crewFilter(req);
    const activityMatch = withTeam({ ...match, ...dateMatch('timestamp') }, team);
    const surveyMatch = withTeam({ ...match, ...dateMatch('submittedAt') }, team);

    // All-time, whole-campaign scope with every campaign's stats trusted → read the
    // CanvassActivity numbers straight off Campaign.stats (maintained write-side by
    // services/reports/campaignCounters.js) and skip every CanvassActivity aggregation below.
    // Any date window, effort scoping, crew scoping, or unseeded legacy campaign
    // (stats.reconciledAt null, pre-migrate:campaign-stats) falls back to the live pipelines —
    // stats are exact or unused, never approximate. (A crew has no counter equivalent.)
    const useStats =
      !fromDay && !toDay && !req.query.effortId && !req.query.coordinatorId &&
      campaigns.every((c) => c.stats?.reconciledAt);

    const [coverageAgg, eventAgg, knockAgg, surveyAgg, canvasserAgg, cumulativeCanvassers, goals] =
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
        useStats
          ? []
          : CanvassActivity.aggregate(
              // includeRestricted unconditionally: the rows below apply each campaign's own
              // policy when picking billableDoors, so the pipeline just has to SUPPLY both
              // numbers. `knocks` is unaffected by the wider action set (see knocksPipeline).
              knocksPipeline(activityMatch, { byCampaign: true, includeRestricted: true })
            ),
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
        // Door-goal progress. Deliberately takes `campaigns` and NOT the match objects above:
        // this block is ALL-TIME and campaign-wide even when the caller passed from/to,
        // effortId or coordinatorId, because a goal is a whole-campaign contract number. The
        // clients caption the card accordingly. Costs zero queries when no campaign in scope
        // carries a goal — which is what keeps the useStats fast path above genuinely fast.
        goalProgressFor({ organizationId, campaigns, orgDefaults }),
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
          no_soliciting: 0,
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
        restrictedDoors: 0,
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
      // NON_KNOCKED_BUCKETS, not a hand-rolled list: the old one skipped `dnc`, so a
      // do-not-contact door nobody ever visited counted as knocked here.
      if (!NON_KNOCKED_BUCKETS.includes(bucket)) c.homesKnocked += r.count;
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
        c.restrictedDoors = s.restrictedDoorCount || 0;
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
      c.restrictedDoors = r.restrictedDoors;
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
          // ALL-TIME + campaign-wide, unlike every other number on this row (see the
          // goalProgressFor call above). null when no goal is set.
          goal: goals.get(String(campaign._id)) || null,
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
          // This campaign's own answer — a rollup can span campaigns that disagree, so the
          // policy is resolved per row rather than once for the response.
          billRestrictedDoors: resolveBillRestricted(campaign, orgDefaults),
          // Same precondition as /overview: on the counter path (useStats) this is only
          // guaranteed once this campaign's billable-door policy has been enabled. Safe today
          // because nothing renders it while the policy is off — see the note on /overview.
          restrictedDoors: c.restrictedDoors,
          billableDoors:
            c.knocks + (resolveBillRestricted(campaign, orgDefaults) ? c.restrictedDoors : 0),
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
      // Sums the PER-ROW billableDoors, so a mixed-policy org totals each campaign under its
      // own rule rather than applying one campaign's answer to the whole org.
      billableDoors: sum('billableDoors'),
      restrictedDoors: sum('restrictedDoors'),
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
    // Optional crew scope (?coordinatorId): both ledgers take the identical clause so a
    // crew-scoped leaderboard row's knocks AND surveys agree (aggregation context — see teamMatch).
    const team = await crewFilter(req);
    const surveyMatch = withTeam({ ...parseDateRange(req, 'submittedAt'), ...cFilter }, team);
    const activityMatch = withTeam({ ...parseDateRange(req, 'timestamp'), ...cFilter, ...NOT_BULK }, team);

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
        // Per-DAY rows now leave the pipeline; the per-user fold happens in JS via
        // services/reports/hoursSource.js, because each day's denominator may come
        // from a different source — the measured FbTime row where one exists, the
        // knock span where none does — and that choice cannot be expressed in a
        // $group. The sum is still a sum of per-DAY spans, never a calendar span.
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
          noSoliciting: 0,
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
      // No soliciting: reached the door, a sign ended the visit. A knock (see the sum below),
      // never a contact — so it lifts doors/hour but not the contact rate.
      else if (row._id.actionType === 'no_soliciting') u.noSoliciting = row.count;
      else if (row._id.actionType === 'survey_submitted') u.surveyKnocks = row.count;
      if (row.lastAt && (!u.lastActivityAt || row.lastAt > u.lastActivityAt)) {
        u.lastActivityAt = row.lastAt;
      }
    }
    // Fold the per-day rows per user, merging in measured hours where the org
    // has connected FbTime. from/to are the same day strings the $match window
    // was built from, so the measured overlay covers exactly the report range.
    const measured = await loadMeasuredHours({
      organizationId: activeOrgId(req),
      from: req.query.from ? String(req.query.from).slice(0, 10) : null,
      to: req.query.to ? String(req.query.to).slice(0, 10) : null,
      tz: tzOf(req),
      campaignId: scopedCampaignId(req),
    });

    const dayRowsByUser = new Map();
    const coordSetsByUser = new Map();
    for (const row of rangeAgg) {
      const uid = String(row._id.userId);
      if (!dayRowsByUser.has(uid)) dayRowsByUser.set(uid, []);
      dayRowsByUser.get(uid).push({
        day: row._id.day,
        spanHours: spanHours(row.first, row.last),
      });

      const u = ensure(row._id.userId);
      if (!u.firstActivityAt || row.first < u.firstActivityAt) u.firstActivityAt = row.first;
      if (row.last && (!u.lastActivityAt || row.last > u.lastActivityAt)) {
        u.lastActivityAt = row.last;
      }
      u.daysActive += 1; // knock-days, unchanged in meaning

      if (!coordSetsByUser.has(uid)) coordSetsByUser.set(uid, new Set());
      const set = coordSetsByUser.get(uid);
      for (const c of row.coordinatorIds || []) set.add(c ? String(c) : null);
    }

    const foldByUser = new Map();
    for (const [uid, perDayRows] of dayRowsByUser) {
      foldByUser.set(uid, foldUserHours({ userId: uid, perDayRows, measured }));
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
        const fold = foldByUser.get(u.userId);
        // Billable knocks = this canvasser's distinct (household, pass) door interactions.
        // surveyKnocks/litDropped are mutually exclusive by campaign type, so they're the
        // completion-action numerator for the connection rate.
        const knocks = u.notHome + u.wrongAddress + u.refused + u.noSoliciting + u.litDropped + u.surveyKnocks;
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
          noSoliciting: u.noSoliciting, // a sign ended the visit — shown, and IS in `knocks`
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
          // Sum of per-DAY denominators — measured FbTime hours where the org has
          // connected and that day has a usable row, the knock span otherwise. Same
          // method as the timeline and the CSV, so the three surfaces agree. Clients
          // must NOT re-derive this from first/last: that is a calendar span, and it
          // under-reports pace by ~3x over a multi-day range.
          hoursOnDoors: fold ? fold.hoursOnDoors : 0,
          daysActive: u.daysActive || 0,
          doorsPerHour:
            fold && fold.hoursOnDoors > 0
              ? Math.round((knocks / fold.hoursOnDoors) * 100) / 100
              : 0,
          // Provenance: 'measured' | 'estimated' | 'mixed' (mixed only ever at this
          // per-person grain), plus the provider's trust flags rolled up so a UI can
          // say WHY a measured number moved ("includes an open shift").
          hoursSource: fold ? fold.hoursSource : 'estimated',
          // WHY it is not measured — 'not-connected' | 'not-linked' | 'stale-shift' |
          // 'no-hours', null when it IS measured. No fold means no knock-days in the
          // window, so there is no rate on screen to explain: null, not a reason.
          hoursReason: fold ? fold.hoursReason : null,
          hoursFlags: fold
            ? {
                hasOpenShift: fold.hasOpenShift,
                hasStaleShift: fold.hasStaleShift,
                hasManualEntry: fold.hasManualEntry,
              }
            : { hasOpenShift: false, hasStaleShift: false, hasManualEntry: false },
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
    // Optional crew scope (?coordinatorId) — wrapped into baseMatch once, so every per-question
    // pipeline, the totals, the org comparison, and the tag distinct-voter queries all inherit it.
    // ($and composition: the userId spread below stays an intersection, never a clobber.)
    const baseMatch = withTeam(
      { surveyTemplateId: template._id, ...dateRange, ...cFilter, ...passFilterOf(req) },
      await crewFilter(req)
    );
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
    // Two units per tag, both voter-unit: `voterCount` ("identified") = distinct voters EVER
    // tagged, from a per-tag distinct-voter query (answerTagClause); `currentVoterCount` =
    // voters whose LATEST in-scope answer still carries the tag (currentTags.js — latest
    // ANSWER wins, so a later response that skipped the question via branching changes
    // nothing). Current ⊆ identified. Both inherit `match`, so ?userId/?passId/?coordinatorId
    // narrow both numbers together. The contributing options + their counts are pulled from
    // the per-question breakdown built above (response-unit — a deliberately different unit,
    // labelled as such in the UIs).
    const tagMap = tagOptionMap(template);
    const currentByTag = tagMap.size ? await currentVoterSetsByTag(match, template) : new Map();
    const tags = [];
    for (const entry of tagMap.values()) {
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
      tags.push({
        tag: entry.display,
        voterCount: voterIds.length,
        currentVoterCount: (currentByTag.get(normalizeTag(entry.display)) || new Set()).size,
        options: tagOptions,
      });
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
  const filter = {
    ...parseDateRange(req, 'submittedAt'),
    ...baseFilter(req),
    ...passFilterOf(req),
    ...answerClause,
  };
  if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
    filter.surveyTemplateId = new mongoose.Types.ObjectId(surveyTemplateId);
  }
  if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) {
    filter.userId = new mongoose.Types.ObjectId(req.query.userId);
  }
  // Optional crew scope (?coordinatorId) — wrapped LAST, after the userId key above, so the
  // team clause lands in $and and intersects with (never replaces) a canvasser drill. The
  // answerClause is itself $or-shaped, which is why $and composition is mandatory here.
  return { filter: withTeam(filter, await crewFilter(req)), template, wantsTag };
}

// One stored answer rendered for a human — the drill-in list, its CSV, and any other
// per-response readout. Shared so the screen and the export can never disagree.
//
// The capture flow embeds an "Other: ___" write-in INTO the answer snapshot as one of its
// entries, so a raw cell reads "potholes" — indistinguishable from a canonical option someone
// happened to name "potholes". Label just that entry, leaving a multi-select's other picks alone.
export function formatAnswerCell(a) {
  const parts = Array.isArray(a.answer) ? a.answer : a.answer != null ? [a.answer] : [];
  if ((a.optionIds || []).includes(OTHER_OPTION_ID)) {
    const typed = a.otherText || '';
    if (!typed) return parts.join('; ') || 'Other';
    const labeled = parts.map((p) => (p === typed ? `Other — ${typed}` : p));
    if (!parts.includes(typed)) labeled.push(`Other — ${typed}`);
    return labeled.join('; ');
  }
  // Legacy belt-and-braces: only append otherText when it isn't already in the snapshot.
  const base = parts.join('; ');
  return a.otherText && !parts.includes(a.otherText) ? `${base} — ${a.otherText}` : base;
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
        // What this voter actually answered on the drilled question. Without it, drilling the
        // write-in bucket listed 12 voters and none of what any of them typed — the one bucket
        // where the answer IS the free text, so the list was unreadable without opening each row.
        answer: (r.answers || [])
          .filter((a) => a.questionKey === req.query.questionKey)
          .map(formatAnswerCell)
          .filter(Boolean)
          .join(' | ') || null,
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
      // The ROUND each response was taken in. Without it, a voter surveyed in two passes produces
      // two rows distinguishable only by date — and the whole point of a second pass is comparing
      // the rounds. `roundNumber` restarts per walk list, so the effort name goes in the column too.
      .populate({ path: 'passId', select: 'roundNumber name effortId' })
      .lean();

    // Walk-list names for the Round column, looked up by the effortIds actually present in THESE
    // rows. Scoping to the returned set rather than to `filter.campaignId` matters because this
    // route serves org-wide drills too: Mongoose strips an undefined `campaignId` from a query, so a
    // campaign-scoped lookup would silently widen to every effort in the org on exactly the request
    // where the result set is largest. Still org-scoped, so a foreign id can never resolve to a
    // name. An empty id set skips the query entirely.
    const rowEffortIds = [
      ...new Set(responses.map((r) => r.passId?.effortId).filter(Boolean).map(String)),
    ];
    const effortNameById = new Map(
      rowEffortIds.length
        ? (
            await Effort.find(
              { organizationId: activeOrgId(req), _id: { $in: rowEffortIds } },
              'name'
            ).lean()
          ).map((e) => [String(e._id), e.name])
        : []
    );

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
    const answerText = formatAnswerCell;

    const dateFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });

    const headers = [
      'Submitted (ISO)', 'Date', `Time (${tzAbbrev(tz) || tz})`,
      'Voter', 'Party', 'Do not contact', 'Address', 'City', 'State', 'Zip',
      'Canvasser first name', 'Canvasser last name', 'Walk list', 'Pass',
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
        effortNameById.get(String(r.passId?.effortId)) || '',
        r.passId ? `Pass ${r.passId.roundNumber}` : 'Legacy / no pass',
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
    // Optional crew scope (?coordinatorId): the identical clause /survey-results wraps into its
    // baseMatch, so the counting contract (these rows sum to the option's count) holds under a
    // crew filter too. Rows stay RAW per-user — filtering the response set is not folding credit.
    const match = withTeam(
      { ...parseDateRange(req, 'submittedAt'), ...baseFilter(req), ...passFilterOf(req) },
      await crewFilter(req)
    );
    if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
      match.surveyTemplateId = new mongoose.Types.ObjectId(surveyTemplateId);
    }
    // Id + legacy display text, so a pre-option-id row still counts. NOT for the write-in
    // bucket: its `answer` is the typed text, so the label lane would never find a real write-in
    // while it DOES pull in rows filed under a different bucket by mergeOptionRows — breaking the
    // contract above that these per-canvasser counts sum to the option's /survey-results count.
    const keys =
      optionId === OTHER_OPTION_ID ? [OTHER_OPTION_ID] : [optionId, option].filter((v) => v != null && v !== '');

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
    const populates = (q) =>
      q
        .populate('voterId', 'fullName party gender precinct')
        .populate('householdId', 'addressLine1 addressLine2 city state zipCode location')
        .populate('userId', 'firstName lastName email')
        .populate('passId', 'roundNumber name')
        .populate('editedBy', 'firstName lastName')
        .lean();
    let r = await populates(SurveyResponse.findOne({ _id: responseId, organizationId: orgId }));
    let archived = null;
    if (!r) {
      // Archived fallback: the id may be a PRESERVED (overwritten) response — the duplicate
      // surveys report lists them under the archive id, and this screen is where an admin
      // inspects (and on mobile, restores) one. Same campaign gate as the live path.
      archived = await populates(
        SurveyResponseArchive.findOne({ _id: responseId, organizationId: orgId }).populate(
          'overwrittenBy',
          'firstName lastName'
        )
      );
      if (archived) r = archived;
    }
    if (!r) return res.status(404).json({ error: 'Response not found' });
    if (!isOrgAdmin(req) && !(await canManageCampaign(req, r.campaignId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // On the LIVE path, say whether this response replaced a preserved earlier one (the
    // "replaced X's earlier answers" line + the pointer the restore UI needs).
    let replacedEarlier = null;
    if (!archived) {
      const prior = await SurveyResponseArchive.findOne(
        { voterId: r.voterId?._id || r.voterId, passId: r.passId?._id || r.passId || null },
        'userId submittedAt overwrittenAt'
      )
        .sort({ overwrittenAt: -1 })
        .populate('userId', 'firstName lastName')
        .lean();
      if (prior) {
        replacedEarlier = {
          overwriteId: String(prior._id),
          by: prior.userId
            ? { id: String(prior.userId._id), firstName: prior.userId.firstName, lastName: prior.userId.lastName }
            : null,
          submittedAt: prior.submittedAt,
          overwrittenAt: prior.overwrittenAt,
        };
      }
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
        replacedEarlier,
        ...(archived
          ? {
              archived: true,
              overwrittenAt: archived.overwrittenAt,
              overwrittenVia: archived.overwrittenVia,
              overwrittenBy: archived.overwrittenBy
                ? {
                    id: String(archived.overwrittenBy._id),
                    firstName: archived.overwrittenBy.firstName,
                    lastName: archived.overwrittenBy.lastName,
                  }
                : null,
              voterId: String(archived.voterId?._id || archived.voterId),
            }
          : {}),
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

// Overlap set for the map / household-panel indicator: the households where 2+ distinct
// canvassers knocked the same (household, pass). DATE-SCOPED like every other map layer (owner
// decision 2026-07-19 — a filtered view whose layer ignored the filter read as a bug), but the
// service still groups over the whole pass so it can report `outOfRangeTotal`: the same-pass
// collisions your window hides, which the date-scoped /overlaps above structurally cannot see.
// ?userId narrows to collisions INVOLVING that canvasser (applied post-grouping — see the service).
// campaignId is REQUIRED: unscoped this aggregates the org's entire activity ledger.
router.get('/overlap-doors', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.query.campaignId || !mongoose.isValidObjectId(req.query.campaignId)) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    const match = { ...baseFilter(req) };
    if (req.query.passId && mongoose.isValidObjectId(req.query.passId)) {
      match.passId = new mongoose.Types.ObjectId(req.query.passId);
    }
    // The window is NOT spread into `match` — the pipeline needs the whole pass to count what the
    // window hides. It travels separately as an in-range test.
    const { timestamp: range } = parseDateRange(req, 'timestamp');
    const userId =
      req.query.userId && mongoose.isValidObjectId(req.query.userId)
        ? new mongoose.Types.ObjectId(req.query.userId)
        : null;
    const result = await computeOverlapDoors(match, {
      dateRange: range ? { from: range.$gte || null, to: range.$lt || null } : null,
      userId,
      organizationId: activeOrgId(req), // org guard on the address lookup
    });
    res.json(result);
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
// Request cap for the timeline's range mode. Wider than the day-bucket bound below because
// ranges past that bound render WEEK columns (~27 at this cap); must match the client-side
// guards (web TimelinePage.jsx, mobile admin/timeline.jsx) — changing it is a three-line
// edit: here and the two clients.
const TIMELINE_RANGE_MAX_DAYS = 183;
// Past this span the grid switches to week columns and the per-door overlap cards are skipped
// (computeOverlaps $pushes every event — 100MB $group risk on long windows). Deliberately NOT
// AUDIT_WINDOW_MAX_DAYS any more: that 62 is detectFlags' OOM guard, this 62 is a rendering
// bound. Same number today, free to drift.
const TIMELINE_DAY_BUCKET_MAX_DAYS = 62;

function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Monday of the week containing `ymd` (Monday-start weeks, matching the pickers' quick chips).
function weekStartYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return addDaysYmd(ymd, -((dow + 6) % 7));
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

    // Same scope the aggregates below run on, so the fold and the rows it folds agree. A campaign-
    // scoped call gets that campaign's crews; an unscoped admin call gets the org-wide set, which
    // is what it got before crews became per-campaign.
    const leadIds = await leadIdsForScope(scope);
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
          // RESPONSE-unit, and named for it. This was `votersSurveyed`, which promised distinct
          // PEOPLE while counting rows — identical numbers in a one-round campaign (one response
          // per voter per round) and different the moment a second round re-surveys anyone.
          // The row count is also the only unit that partitions: teamFoldStage puts each response
          // on exactly one team, so Σ(teams) === the campaign's response total, always. A distinct
          // column could not — a voter surveyed by two teams belongs to both rows.
          surveysTaken: votersByTeam.get(String(id)) || 0,
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

// One tag's voter rollup split by team — "this team identified N supporters, M still are."
//
// FIRST-FINDER attribution (owner ruling, Aug 2026): the voter is credited to the team on their
// EARLIEST in-scope tag-carrying response (min submittedAt, tie-break _id). That team stamp is
// the frozen-then-restamped coordinatorId the whole teams contract runs on, so credit follows
// the row and the row follows the canvasser's current crew — a reassignment moves found voters
// exactly like it moves doors. Because each voter resolves to exactly ONE team, both units
// PARTITION: Σ(teams) + noTeam === totals, for identified AND current. This is the one
// distinct-voter team surface that is allowed to exist — the teamFoldStage-only shape cannot
// partition (a voter surveyed by two teams belongs to both rows; see /team-breakdown's
// surveysTaken note), which is also why /answer-canvassers still 400s tag mode: no first-finder
// ruling exists for CANVASSERS, so a per-person split would still be a lie.
//
// `leadIdsForScope(baseFilter(req))` is deliberately UN-windowed (org/campaign/effort only) —
// crewFilter's own precedent. A windowed scope would need per-collection date keys (timestamp
// vs submittedAt) and would let a lead's fold flicker with the report range.
router.get('/tag-teams', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);

    if (!req.query.tag) return res.status(400).json({ error: 'tag is required' });

    // Template resolution mirrors /survey-results: explicit ?surveyTemplateId (in-org), else the
    // campaign's attached survey. Unlike survey-results there is no empty-200 fallback — the tag
    // param is mandatory, so with no template there is nothing meaningful to return.
    let template = null;
    const { surveyTemplateId } = req.query;
    if (surveyTemplateId && mongoose.isValidObjectId(surveyTemplateId)) {
      template = await SurveyTemplate.findOne({ _id: surveyTemplateId, organizationId: orgId }).lean();
    }
    const cFilter = baseFilter(req);
    if (!template && cFilter.campaignId) {
      const campaign = await Campaign.findOne({ _id: cFilter.campaignId, organizationId: orgId }).lean();
      if (campaign?.surveyTemplateId) {
        template = await SurveyTemplate.findOne({
          _id: campaign.surveyTemplateId,
          organizationId: orgId,
        }).lean();
      }
    }
    if (!template) return res.status(404).json({ error: 'Survey not found' });

    const entry = tagOptionMap(template).get(normalizeTag(req.query.tag));
    // 404, not an empty 200 — a typo'd tag must not read as an honest zero.
    if (!entry) return res.status(404).json({ error: 'Tag not found on this survey' });

    // Same refuse-rather-than-mislead gate as /team-breakdown: before the backfill, history has
    // no team stamp and every voter would land in "No team", which looks like data.
    const org = await Organization.findById(orgId, 'teamAttributionReadyAt').lean();
    if (!org?.teamAttributionReadyAt) {
      return res.json({ ready: false, tag: entry.display, teams: [], noTeam: null, totals: null });
    }

    // Identical fold order to /survey-results' baseMatch, so this table always reconciles with
    // the tag row that opened it. Team clause via withTeam (never baseFilter — the household-
    // poisoning rule); ?passId=legacy → {passId: null} via passFilterOf.
    const match = withTeam(
      {
        surveyTemplateId: template._id,
        ...parseDateRange(req, 'submittedAt'),
        ...cFilter,
        ...passFilterOf(req),
      },
      await crewFilter(req)
    );
    const leadIds = await leadIdsForScope(cFilter);

    const [firstFinder, currentByTag] = await Promise.all([
      // One row per voter: their earliest tag-carrying response's folded team. Per-voter rows,
      // never per-team $push arrays — no 16MB document risk at any campaign size.
      SurveyResponse.aggregate([
        { $match: { ...match, ...answerTagClause(template, entry.display) } },
        teamFoldStage(leadIds),
        { $project: { voterId: 1, submittedAt: 1, team: 1 } },
        { $sort: { submittedAt: 1, _id: 1 } },
        { $group: { _id: '$voterId', team: { $first: '$team' } } },
      ]),
      currentVoterSetsByTag(match, template, [entry.display]),
    ]);
    const currentSet = currentByTag.get(normalizeTag(entry.display)) || new Set();

    const buckets = new Map(); // teamId string | null → { identifiedVoters, currentVoters }
    for (const row of firstFinder) {
      const key = row.team ? String(row.team) : null;
      const b = buckets.get(key) || { identifiedVoters: 0, currentVoters: 0 };
      b.identifiedVoters += 1;
      if (currentSet.has(String(row._id))) b.currentVoters += 1;
      buckets.set(key, b);
    }
    const noTeam = buckets.get(null) || { identifiedVoters: 0, currentVoters: 0 };
    buckets.delete(null);

    const teamIds = [...buckets.keys()];
    const names = teamIds.length
      ? await User.find({ _id: { $in: teamIds } }, 'firstName lastName').lean()
      : [];
    const nameById = new Map(names.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));

    const teams = teamIds
      .map((id) => ({
        coordinatorId: id,
        coordinatorName: nameById.get(id) || 'Unknown',
        ...buckets.get(id),
      }))
      .sort((a, b) => b.identifiedVoters - a.identifiedVoters);

    res.json({
      ready: true,
      tag: entry.display,
      surveyTemplate: { id: String(template._id), name: template.name, version: template.version },
      teams,
      // A dedicated sibling rather than a null-id row, so the client's partition arithmetic
      // (Σ teams + noTeam === totals) cannot be gotten wrong by a missed null check.
      noTeam,
      totals: {
        identifiedVoters: firstFinder.length, // one row per voter, by construction
        currentVoters: currentSet.size, // current ⊆ identified, so the set IS the total
      },
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
    //   ?from&to    — a range: DAY buckets up to TIMELINE_DAY_BUCKET_MAX_DAYS, WEEK buckets
    //                 past that, capped at TIMELINE_RANGE_MAX_DAYS.
    //   ?totals=1   — campaign-to-date. No time buckets, so no columns, so NO CAP: the range
    //                 limits exist only because a range renders one grid column per bucket.
    //                 This is the only way to see a whole campaign — including the people who
    //                 worked it and have since left, whose knocks are in the totals either way.
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
      if (!totalsMode && ymdSpanDays(from, to) > TIMELINE_RANGE_MAX_DAYS) {
        return res.status(400).json({ error: `Date range too large (max ${TIMELINE_RANGE_MAX_DAYS} days)` });
      }
    } else if (!totalsMode) {
      from = validYmd(req.query.date) || zonedDayStr(new Date(), tz);
      to = from;
    }
    const singleDay = !totalsMode && from === to;
    // Past the day-bucket bound the response folds to WEEK columns. The Mongo aggregation below
    // still buckets BY DAY either way (bucketExpr is untouched) — hoursOnDoors sums per-DAY
    // (last − first) spans, and a week-sized bucket would inflate it ~7×. Only the Node
    // assembly loop folds day keys to their Monday.
    const weekMode = !totalsMode && !singleDay && ymdSpanDays(from, to) > TIMELINE_DAY_BUCKET_MAX_DAYS;

    // Campaign-to-date with no bounds = the whole ledger for this campaign: no timestamp filter.
    const window = totalsMode && !hasRange ? null : zonedDayRange(from, to, tz);
    // Team scope rides on the LEDGER (coordinatorId is frozen onto each knock), so scoping here
    // makes EVERY number below team-correct at once — the rows, the raw totals, and crucially
    // `billableKnocks`, which is deduped server-side and can never be derived client-side.
    const scoped = withTeam(
      { ...baseFilter(req), ...(window ? { timestamp: window } : {}) },
      await crewFilter(req)
    );
    // Does this campaign invoice restricted doors? Only widens `billableDoors` below — every
    // per-canvasser number on this screen is knock-based either way.
    const billRestricted = await billRestrictedFor(orgId, baseFilter(req).campaignId);

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
            //   · the 62-day day-bucket bound protects the CLIENT GRID's day columns and
            //     computeOverlaps, not this aggregation. Grouping a whole campaign by day is
            //     cheap; rendering 300 columns is not. (Week mode leans on the same per-day
            //     invariant: it folds these day buckets to Mondays in the assembly loop.)
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
            noSoliciting: { $sum: { $cond: [{ $eq: ['$actionType', 'no_soliciting'] }, 1, 0] } },
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
      //
      // includeRestricted yields BOTH numbers from this one pass: `knocks` is untouched by the
      // flag (see knocksPipeline), so billableKnocks — and the overlapDoors subtraction built on
      // it — keep their exact meaning, while `billableDoors` carries the invoice figure.
      CanvassActivity.aggregate(knocksPipeline(scoped, { includeRestricted: true })),
      // Overlaps $push every event into per-door arrays, which over a whole campaign can breach
      // Mongo's 100MB per-stage limit. Reconciling overlaps is a "what happened this week" job
      // anyway — it needs a bounded window, so totals mode AND week mode (a >62-day window has
      // the same unbounded-events problem) skip it rather than risk the query.
      totalsMode || weekMode
        ? Promise.resolve({ overlaps: [], total: 0, householdIds: [], overlapUserIds: [] })
        : computeOverlaps(scoped, { organizationId: orgId }),
    ]);

    const billableKnocks = knockAgg[0]?.knocks || 0;

    // Per-(user, bucket) tally → per-canvasser rows.
    const byUser = new Map();
    const activeHours = new Set(); // single-day only
    // Per-(user, DAY) span rows, kept alongside the fold above so the measured-hours
    // overlay can be merged per day — its grain — without touching the derived sums.
    const dayRowsByUser = new Map();
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
          dayNoSoliciting: 0,
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
        // Week mode folds day buckets to their Monday — ACCUMULATE, never assign: seven day
        // buckets share one week key (assignment would keep only the last). Accumulation is a
        // no-op in day mode (one bucket per key), so one path serves both.
        const key = weekMode ? weekStartYmd(r._id.bucket) : r._id.bucket;
        if (r.knocks) row.knocksByDay[key] = (row.knocksByDay[key] || 0) + r.knocks;
        if (r.surveys) row.surveysByDay[key] = (row.surveysByDay[key] || 0) + r.surveys;
        // Aggregation buckets ARE days (even in week mode), so summing per-bucket (last - first)
        // is exactly the canvasser-summary endpoint's "sum of per-day active spans" method.
        // Restricted marks are in the bucket, so their time counts toward shift hours (by design).
        row.hoursOnDoors += (r.last - r.first) / 3600000;
        // r._id.bucket is the DAY even in week mode (folding to Mondays happens above,
        // on the key — not in the aggregation), which is exactly the grain measured
        // hours arrive at.
        if (!dayRowsByUser.has(uid)) dayRowsByUser.set(uid, []);
        dayRowsByUser.get(uid).push({
          day: r._id.bucket,
          spanHours: (r.last - r.first) / 3600000,
        });
      }
      row.dayKnocks += r.knocks;
      row.daySurveys += r.surveys;
      row.dayLit += r.lit;
      row.refused += r.refused;
      row.notHome += r.notHome;
      row.wrongAddress += r.wrongAddress;
      row.dayRestricted += r.restricted;
      row.dayNoSoliciting += r.noSoliciting;
      if (!row.first || r.first < row.first) row.first = r.first;
      if (!row.last || r.last > row.last) row.last = r.last;
    }

    // Single day: buckets are hours, so the active span is (overall last - first) —
    // summing per-hour spans would drop the gaps between active hours.
    if (singleDay) {
      for (const [uid, row] of byUser) {
        if (row.first && row.last) row.hoursOnDoors = (row.last - row.first) / 3600000;
        dayRowsByUser.set(uid, [{ day: from, spanHours: row.hoursOnDoors }]);
      }
    }

    // The measured-hours overlay for the window. Totals mode aggregates an
    // unbounded window while from/to still hold a date, so it loads unbounded
    // too — the overlay must cover every day the span rows cover, or real
    // measured days would read as estimated for a reason nobody could see.
    const measured = await loadMeasuredHours({
      organizationId: orgId,
      from: totalsMode ? null : from,
      to: totalsMode ? null : to,
      tz,
      campaignId: scopedCampaignId(req),
    });
    const foldByUser = new Map();
    for (const [uid, perDayRows] of dayRowsByUser) {
      foldByUser.set(uid, foldUserHours({ userId: uid, perDayRows, measured }));
    }

    // Contiguous active-hour window (min..max) so the grid has no gaps; [] when no activity.
    const hours = [];
    if (singleDay && activeHours.size) {
      const min = Math.min(...activeHours);
      const max = Math.max(...activeHours);
      for (let h = min; h <= max; h++) hours.push(h);
    }

    // Every day of the range, inclusive — pure calendar-string math (the tz-aware
    // bucketing above already put each knock on its wall-clock day). Week mode walks
    // MONDAYS instead — the first may precede `from` (a mid-week start makes a partial
    // first column; the aggregation window still clips to [from..to]). Totals mode ships
    // no grid, so it ships no columns (and an unbounded totals request has no from/to to
    // walk in the first place).
    const days = [];
    if (!singleDay && !totalsMode) {
      if (weekMode) {
        for (let d = weekStartYmd(from); d <= to; d = addDaysYmd(d, 7)) days.push(d);
      } else {
        for (let d = from; d <= to; d = addDaysYmd(d, 1)) days.push(d);
      }
    }

    // Uncapped: computeOverlaps' card list truncates at 200 (worst first), but the flag
    // must cover every colliding canvasser in the window — range mode can exceed the cap.
    // Empty in week/totals mode (computeOverlaps is skipped), so `inOverlap` is only
    // meaningful with bucket:'day'.
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
          // DELIBERATELY still the derived span, not the merged figure. Both clients
          // sum this field across rows into the KPI tile; replacing its value would
          // make ALREADY-SHIPPED builds silently blend measured and estimated hours
          // in one rate — the exact thing the contract forbids. Measured arrives
          // additively below; new clients prefer it, old clients keep exactly the
          // number they had.
          hoursOnDoors: Math.round(rawHours * 100) / 100,
          // Divide by the RAW hours and round only the quotient (matches the canvasser
          // summary endpoint). One-knock windows have a zero span: 0, never Infinity.
          doorsPerHour: rawHours > 0 ? Math.round((row.dayKnocks / rawHours) * 100) / 100 : 0,
          // The merged per-person figure (measured days where usable, span days
          // otherwise) and its provenance. null when the org has no live connection.
          measuredHoursOnDoors: measured.enabled ? (foldByUser.get(uid)?.hoursOnDoors ?? null) : null,
          hoursSource: foldByUser.get(uid)?.hoursSource ?? 'estimated',
          // Why not measured — see /canvassers. Same four values, same null-when-measured.
          hoursReason: foldByUser.get(uid)?.hoursReason ?? null,
          hoursFlags: {
            hasOpenShift: foldByUser.get(uid)?.hasOpenShift ?? false,
            hasStaleShift: foldByUser.get(uid)?.hasStaleShift ?? false,
            hasManualEntry: foldByUser.get(uid)?.hasManualEntry ?? false,
          },
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
        // In week mode `days` holds Mondays and the per-row maps are week-keyed, so this
        // walk yields week totals with no extra code.
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
      // `bucket` says what a range column IS: past the day-bucket bound, days[] carries
      // Monday week-starts and the maps are keyed by them — same plumbing, coarser columns.
      ...(totalsMode
        ? {}
        : singleDay
          ? { date: from, hours, hourTotals }
          : { days, dayTotals, bucket: weekMode ? 'week' : 'day' }),
      tz,
      tzAbbrev: tzAbbrev(tz),
      canvassers,
      // THE AGGREGATE RULE, decided server-side (the billRestrictedDoors echo
      // pattern — the server says which label applies, clients render it):
      // hoursOnDoors is non-null ONLY when every canvasser in the window is
      // fully measured; then it is the sum of their measured hours and the KPI
      // tile may divide by it. Anything less and it is null + 'estimated' —
      // the tile keeps the derived sum it computes today. A rate that mixes
      // measured and estimated contributors is never offered.
      measuredKpi: (() => {
        const folds = [...foldByUser.values()];
        if (!measured.enabled || !folds.length || aggregateSource(folds) !== 'measured') {
          return { hoursOnDoors: null, hoursSource: 'estimated' };
        }
        const total = folds.reduce((n, f) => n + f.hoursOnDoors, 0);
        return { hoursOnDoors: Math.round(total * 100) / 100, hoursSource: 'measured' };
      })(),
      grandKnocks,
      grandSurveys,
      billableKnocks,
      // Survey DOORS, deduped (household, pass) — the survey-side twin of billableKnocks, and the
      // number to quote a client. grandSurveys above is the raw EVENT count: it sums the
      // per-canvasser column, so a door two canvassers both surveyed lands in it twice. The KPI
      // cards used to sum that column client-side and label the result "Doors with a survey",
      // which over-reported by exactly the cross-canvasser overlap. Like billableKnocks, it cannot
      // be derived client-side — the dedup needs the ledger.
      billableSurveyDoors: knockAgg[0]?.surveyedKnocks || 0,
      // Lit DOORS, same dedup — and it ships for the same reason. The connection rate is
      // (surveyDoors + litDoors) / doors; when only the survey term was deduped the clients still
      // summed `dayLit` across canvassers, putting a RAW numerator term over a DEDUPED denominator.
      // Invisible on a survey campaign (lit ≈ 0) and live on a lit-drop one, which is exactly the
      // kind of bug that waits. Both numerator terms now come from this one pipeline row.
      billableLitDoors: knockAgg[0]?.litKnocks || 0,
      // The invoice figure when this campaign bills for restricted doors; equal to
      // billableKnocks otherwise. Deliberately a SEPARATE field: billableKnocks feeds the
      // overlap subtraction below, whose other side (grandKnocks) counts knock events only.
      billableDoors: billableDoorsOf(knockAgg[0], billRestricted),
      restrictedDoors: knockAgg[0]?.restrictedDoors || 0,
      billRestrictedDoors: billRestricted,
      // Pure arithmetic on two numbers we already have, so the overlap DOOR COUNT is honest
      // in every mode — it's only the per-door reconciliation CARDS that need a bounded
      // window (see the computeOverlaps skip above).
      overlapDoors: Math.max(0, grandKnocks - billableKnocks),
      overlaps: overlapRes.overlaps,
      overlapCount: overlapRes.total,
      // Totals and week modes deliberately ship no overlap cards; the clients say so rather
      // than implying a campaign had zero overlaps.
      overlapsOmitted: totalsMode || weekMode,
    });
  } catch (err) {
    next(err);
  }
});

// Voters with MORE THAN ONE survey response (a "Surveys taken" count above "Voters surveyed" means
// someone was surveyed twice). Live rows are always cross-round (the unique {voterId, passId}
// index); preserved SAME-round overwrites join via $unionWith from SurveyResponseArchive as the
// worst kind, `sameRoundOverwritten` — a second canvasser's submit replaced the first's answers
// (preserved; restorable from the voter profile). Surfaces who/when/round/where for each so the
// operator can tell a legit revisit (different canvassers, later round) from a mistake (same
// canvasser, same day) from a destroyed-and-preserved pair. Paged (skip/limit, `total` = full
// matching-group count) and filterable by ?userId= (groups containing that canvasser — either
// participant of an overwrite) and ?kind=. Fix paths: delete the extra response, or restore the
// preserved one. See METRICS.md §Surveys.
router.get('/duplicate-surveys', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const cFilter = baseFilter(req);
    const dateRange = parseDateRange(req, 'submittedAt');
    const tz = req.anchorTz || 'UTC';

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    // Optional canvasser filter — matched AFTER grouping (a group qualifies when ANY of its
    // responses is theirs), so filtering never changes what counts as a duplicate.
    let userFilter = null;
    if (req.query.userId !== undefined) {
      if (!mongoose.isValidObjectId(req.query.userId)) {
        return res.status(400).json({ error: 'Invalid userId' });
      }
      userFilter = new mongoose.Types.ObjectId(req.query.userId);
    }

    const kind = req.query.kind || 'all';
    if (!['all', 'sameRoundOverwritten', 'sameCanvasserSameDay', 'differentCanvassers'].includes(kind)) {
      return res.status(400).json({ error: 'Invalid kind' });
    }

    const [facets] = await SurveyResponse.aggregate([
      { $match: { ...cFilter, ...dateRange } },
      { $set: { overwritten: false } },
      // Preserved (overwritten) responses join the report as rows of their voter's group — the
      // "same round · overwritten" kind. Same campaign scope, same submittedAt window.
      {
        $unionWith: {
          coll: SurveyResponseArchive.collection.name,
          pipeline: [
            { $match: { ...cFilter, ...dateRange } },
            { $set: { overwritten: true } },
          ],
        },
      },
      { $set: { day: dayBucketExpr('submittedAt', tz) } },
      {
        $group: {
          _id: '$voterId',
          count: { $sum: 1 },
          liveCount: { $sum: { $cond: ['$overwritten', 0, 1] } },
          responses: {
            $push: {
              responseId: '$_id',
              submittedAt: '$submittedAt',
              passId: '$passId',
              userId: '$userId',
              day: '$day',
              overwritten: '$overwritten',
              overwrittenAt: '$overwrittenAt',
              overwrittenById: '$overwrittenBy',
            },
          },
          // LIVE rows only (archived rows contribute null, stripped below), so the two existing
          // flags keep their exact meaning — a same-round overwrite pair must NOT light
          // "different canvassers", which is the cross-round revisit badge.
          // A repeated (user, local-day) key collapses in the set, so set < count ⇔ a repeat.
          userDays: {
            $addToSet: {
              $cond: ['$overwritten', null, { $concat: [{ $toString: '$userId' }, '|', '$day'] }],
            },
          },
          users: { $addToSet: { $cond: ['$overwritten', null, '$userId'] } },
          hasOverwrite: { $max: '$overwritten' },
        },
      },
      { $match: { count: { $gt: 1 } } },
      ...(userFilter ? [{ $match: { 'responses.userId': userFilter } }] : []),
      {
        $set: {
          userDays: { $setDifference: ['$userDays', [null]] },
          users: { $setDifference: ['$users', [null]] },
        },
      },
      {
        $set: {
          sameCanvasserSameDay: { $gt: ['$liveCount', { $size: '$userDays' }] },
          differentCanvassers: { $gt: [{ $size: '$users' }, 1] },
          sameRoundOverwritten: '$hasOverwrite',
        },
      },
      ...(kind === 'sameRoundOverwritten' ? [{ $match: { sameRoundOverwritten: true } }] : []),
      ...(kind === 'sameCanvasserSameDay' ? [{ $match: { sameCanvasserSameDay: true } }] : []),
      ...(kind === 'differentCanvassers' ? [{ $match: { differentCanvassers: true } }] : []),
      { $unset: ['userDays', 'users', 'liveCount', 'hasOverwrite'] },
      // Most suspicious first: destroyed-answers pairs, then same-day repeats (false < true in
      // BSON), then by count; voterId keeps pages stable.
      { $sort: { sameRoundOverwritten: -1, sameCanvasserSameDay: -1, count: -1, _id: 1 } },
      { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } },
    ]);
    const dupes = facets?.items || [];
    const total = facets?.total?.[0]?.n || 0;

    if (!dupes.length) {
      return res.json({ duplicates: [], total, limit, skip, timeZone: tz, tzAbbrev: tzAbbrev(tz) });
    }

    const voterIds = dupes.map((d) => d._id);
    const userIds = [
      ...new Set(
        dupes.flatMap((d) =>
          d.responses.flatMap((r) => [String(r.userId), ...(r.overwrittenById ? [String(r.overwrittenById)] : [])])
        )
      ),
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
          const ow = r.overwritten ? uMap.get(String(r.overwrittenById)) : null;
          return {
            responseId: String(r.responseId),
            submittedAt: r.submittedAt,
            day: r.day,
            canvasser: {
              userId: String(r.userId),
              firstName: u?.firstName || '',
              lastName: u?.lastName || '',
              email: u?.email || '',
            },
            passId: r.passId ? String(r.passId) : null,
            roundLabel: pass ? `Pass ${pass.roundNumber} · ${pass.name}` : 'Legacy / no pass',
            // Archived rows only: responseId is the ARCHIVE id (response-details serves it via
            // the archived fallback; a stale mobile Delete 404s into "Already deleted").
            ...(r.overwritten
              ? {
                  overwritten: true,
                  overwrittenAt: r.overwrittenAt,
                  overwrittenBy: {
                    userId: String(r.overwrittenById),
                    firstName: ow?.firstName || '',
                    lastName: ow?.lastName || '',
                    email: ow?.email || '',
                  },
                }
              : {}),
          };
        })
        .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));

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
        sameRoundOverwritten: d.sameRoundOverwritten,
        sameCanvasserSameDay: d.sameCanvasserSameDay,
        differentCanvassers: d.differentCanvassers,
      };
    });

    res.json({ duplicates: result, total, limit, skip, timeZone: tz, tzAbbrev: tzAbbrev(tz) });
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
    // Optional crew scope (?coordinatorId): with a crew selected on the Dashboard, the
    // leaderboard row this modal drills is crew-scoped — unscoped, the modal would disagree
    // with the row for anyone who knocked for two crews in the window. withTeam is $and-based,
    // so the `none` shape's userId key intersects with (never replaces) the drilled userId.
    const filter = withTeam(
      {
        userId: new mongoose.Types.ObjectId(userId),
        ...dateRange,
        ...cFilter,
      },
      await crewFilter(req)
    );

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
//
// "Same shape" has to include the SCOPE, and for a long time it did not: /canvassers honored
// ?coordinatorId and this route silently dropped it, so filtering the Timeline to one crew and
// pressing Export handed you every canvasser in the campaign with nothing on screen or in the
// file to say so. A download that disagrees with the table it sits under is worse than no
// download. Both matches now take the identical crew clause, exactly as /canvassers does.
router.get('/canvassers.csv', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const cFilter = baseFilter(req);
    const tz = tzOf(req);
    const team = await crewFilter(req);
    const surveyMatch = withTeam({ ...parseDateRange(req, 'submittedAt'), ...cFilter }, team);
    const activityMatch = withTeam({ ...parseDateRange(req, 'timestamp'), ...cFilter, ...NOT_BULK }, team);

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
        // Per-DAY rows out; the per-user fold happens in JS so each day can take
        // its denominator from the measured FbTime row where one exists (see
        // services/reports/hoursSource.js — same merge as /canvassers).
      ]),
    ]);

    const measured = await loadMeasuredHours({
      organizationId: activeOrgId(req),
      from: req.query.from ? String(req.query.from).slice(0, 10) : null,
      to: req.query.to ? String(req.query.to).slice(0, 10) : null,
      tz,
      campaignId: scopedCampaignId(req),
    });

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
          noSoliciting: 0,
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
      else if (r._id.actionType === 'no_soliciting') u.noSoliciting = r.count;
      else if (r._id.actionType === 'survey_submitted') u.surveyKnocks = r.count;
      if (!u.firstActivityAt || r.firstAt < u.firstActivityAt) u.firstActivityAt = r.firstAt;
      if (!u.lastActivityAt || r.lastAt > u.lastActivityAt) u.lastActivityAt = r.lastAt;
    }
    const csvDayRows = new Map();
    for (const r of hoursAgg) {
      const uid = String(r._id.userId);
      if (!csvDayRows.has(uid)) csvDayRows.set(uid, []);
      csvDayRows.get(uid).push({ day: r._id.day, spanHours: spanHours(r.first, r.last) });
      ensure(r._id.userId).daysActive += 1; // knock-days, unchanged in meaning
    }
    for (const [uid, perDayRows] of csvDayRows) {
      const fold = foldUserHours({ userId: uid, perDayRows, measured });
      const u = ensure(uid);
      u.hoursOnDoors = fold.hoursOnDoors;
      u.hoursSource = fold.hoursSource;
    }

    const userMap = await hydrateCanvassers(Array.from(byUser.keys()), activeOrgId(req), {
      fields: 'phone',
    });

    const headers = [
      'Rank', 'First name', 'Last name', 'Email', 'Phone', 'Status',
      'Knocks', 'Surveys taken', 'Lit drops', 'Not home', 'Wrong address',
      'Connection rate %', 'Hours on doors', 'Days active', 'Knocks/hr', 'Surveys taken/hr',
      'First activity', 'Last activity', 'Refused', 'Restricted', 'No soliciting',
      // APPENDED LAST so existing column positions never shift under anyone's
      // saved import script. Present for every org — 'Estimated' when FbTime was
      // never connected — because a conditional column is a different file shape.
      'Hours source',
    ];
    const enriched = Array.from(byUser.values())
      .map((u) => {
        const info = userMap.get(u.userId) || {};
        // Billable knocks = distinct (household, pass). Connection = completion knocks / knocks.
        const knocks = u.notHome + u.wrongAddress + u.refused + u.noSoliciting + u.litDropped + u.surveyKnocks;
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
      u.noSoliciting,
      u.hoursSource === 'measured' ? 'Measured' : u.hoursSource === 'mixed' ? 'Mixed' : 'Estimated',
    ]);

    // The in-file stamp (owner-ruled, snapshot-and-stamp): a frozen artifact must
    // say ON ITS FACE when its hours were true — the person who opens this file in
    // six months has no database row to consult. Two preamble rows above the
    // header (the billing statement CSV's precedent), then a blank line. Anyone's
    // import script that assumed row 1 was the header skips 3 rows now; the
    // per-row 'Hours source' column is appended last so nothing else moved.
    const rangeLabel =
      req.query.from || req.query.to
        ? `${String(req.query.from || '').slice(0, 10) || 'start'} to ${String(req.query.to || '').slice(0, 10) || 'today'}`
        : 'all time';
    // The crew scope joins the stamp for the same reason the range and the as-of time are
    // there: a file holding one crew's rows and a file holding the whole campaign look
    // identical once they are on someone's desktop. Named, so the reader does not have to
    // recognise a 24-hex id — and resolved through the same User lookup the report rows use,
    // so a departed coordinator still prints as a person.
    const crewLabel = await crewStampLabel(req.query.coordinatorId);
    const preamble = [
      ['Canvasser export', rangeLabel, `hours as of ${new Date().toISOString()}`, crewLabel]
        .filter(Boolean)
        .map(csvCell)
        .join(','),
      '',
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="canvassers-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(`${preamble}\n${toCsv(headers, rows)}`);
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
// Shared by the JSON and CSV handlers so the report and the export can't drift. The whole
// computation lives in services/reports/knocksByPass.js (buildKnocksByPassData) so the
// Export Center's knocks-by-round file rides the exact same pipeline; this adapter only
// translates the request (validation, baseFilter, anchor-tz date window) into its inputs.
async function buildKnocksByPass(req) {
  if (!req.query.campaignId || !mongoose.isValidObjectId(req.query.campaignId)) {
    return { error: { status: 400, message: 'campaignId is required' } };
  }
  const cFilter = baseFilter(req); // organizationId + campaignId (+ optional effortId)
  const windowed = parseDateRange(req, 'timestamp');
  return buildKnocksByPassData({
    organizationId: cFilter.organizationId,
    campaignId: cFilter.campaignId,
    effortId: cFilter.effortId || null,
    timestampRange: windowed.timestamp || null,
    groupByCanvasser: req.query.groupBy === 'canvasser',
    // Optional crew scope (?coordinatorId) — threads to the JSON route AND the CSV through
    // this one adapter. The Export Center's full-backup calls the service directly, no team.
    team: await crewFilter(req),
  });
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
      // Tells the client whether billableDoors is a distinct number worth showing, or just a
      // duplicate of knocks. Clients must not re-derive it — the tri-state lives server-side.
      billRestrictedDoors: built.billRestricted,
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

    // The two billable-door columns appear ONLY for a campaign that invoices restricted doors.
    // An org that never opts in keeps a byte-identical export — nobody's invoicing spreadsheet
    // gains a column it didn't ask for, and where the columns DO appear they carry a number that
    // differs from Knocks (rather than a confusing duplicate of it).
    const doorCols = built.billRestricted ? ['Restricted doors', 'Billable doors'] : [];
    const doorVals = (r) => (built.billRestricted ? [r.restrictedDoors, r.billableDoors] : []);

    let headers;
    let rows;
    if (built.byCanvasser) {
      headers = [
        'Walk list', 'Pass', 'Pass name', 'Canvasser first name', 'Canvasser last name',
        'Email', 'Status', 'Knocks', 'Survey doors', 'Surveys taken', 'Lit knocks', 'Refused',
        'No soliciting', ...doorCols, 'Connection rate %', 'Contact rate %',
      ];
      rows = built.byCanvasser.map((r) => [
        r.effortName || '', r.roundNumber ?? '', r.roundName ?? r.roundLabel,
        r.firstName, r.lastName, r.email, r.status,
        r.knocks, r.surveyedKnocks, r.surveysTaken, r.litKnocks, r.refusedKnocks,
        r.noSolicitingKnocks,
        ...doorVals(r), r.connectionRate, r.contactRate,
      ]);
    } else {
      // 'Surveys taken' sits immediately after 'Survey doors' on purpose: the two survey units
      // are only ever misread when they are far apart, and the invoice reader needs to see that
      // the DOOR column is the one the connection rate is built from.
      headers = [
        'Walk list', 'Pass', 'Pass name', 'Pass status', 'Activated (ISO)', 'Archived (ISO)',
        'Knocks', 'Survey doors', 'Surveys taken', 'Lit knocks', 'Refused', 'No soliciting',
        ...doorCols, 'Connection rate %', 'Contact rate %', 'New homes reached',
      ];
      rows = built.rounds.map((r) => [
        r.effortName || '', r.roundNumber ?? '',
        r.roundName ?? r.roundLabel, r.status || '',
        r.activatedAt ? new Date(r.activatedAt).toISOString() : '',
        r.archivedAt ? new Date(r.archivedAt).toISOString() : '',
        r.knocks, r.surveyedKnocks, r.surveysTaken, r.litKnocks, r.refusedKnocks,
        r.noSolicitingKnocks,
        ...doorVals(r), r.connectionRate, r.contactRate, r.coverageGained,
      ]);
      const t = built.totals;
      rows.push([
        'TOTAL', '', '', '', '', '',
        t.knocks, t.surveyedKnocks, t.surveysTaken, t.litKnocks, t.refusedKnocks,
        t.noSolicitingKnocks,
        ...doorVals(t), t.connectionRate, t.contactRate, t.coverageGained,
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
        // Per-DAY rows out — see services/reports/hoursSource.js. The averages
        // below apply the aggregate all-or-nothing rule: measured only when
        // EVERY canvasser is fully measured, span-based for everyone otherwise.
      ]),
    ]);

    const measured = await loadMeasuredHours({
      organizationId: activeOrgId(req),
      from: req.query.from ? String(req.query.from).slice(0, 10) : null,
      to: req.query.to ? String(req.query.to).slice(0, 10) : null,
      tz,
      campaignId: scopedCampaignId(req),
    });

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
    const taDayRows = new Map();
    for (const r of perUserHours) {
      const k = String(r._id.userId);
      if (!byUser.has(k)) byUser.set(k, blank());
      byUser.get(k).daysActive += 1; // knock-days, unchanged in meaning
      if (!taDayRows.has(k)) taDayRows.set(k, []);
      taDayRows.get(k).push({ day: r._id.day, spanHours: spanHours(r.first, r.last) });
    }

    // THE AGGREGATE RULE: the team average divides by measured hours only when
    // every canvasser with hours is fully measured. One estimated (or mixed)
    // contributor and the whole average stays span-based — a mean of two
    // different instruments is a number nobody can defend to a client.
    const taFolds = new Map(
      [...taDayRows].map(([uid, perDayRows]) => [uid, foldUserHours({ userId: uid, perDayRows, measured })])
    );
    const teamSource = measured.enabled && taFolds.size ? aggregateSource(taFolds.values()) : 'estimated';
    for (const [uid, fold] of taFolds) {
      const u = byUser.get(uid);
      u.hoursOnDoors =
        teamSource === 'measured'
          ? fold.hoursOnDoors
          : (taDayRows.get(uid) || []).reduce((n, d) => n + d.spanHours, 0);
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
      // 'measured' only when every canvasser's hours are (the all-or-nothing
      // rule above); clients label the averages accordingly.
      hoursSource: teamSource,
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

    const [user, memberships, actionAgg, hourAgg, dowAgg, dailyAgg, surveysCount, qualityAgg, distanceHist, farKpi] =
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
        // The far count is NOT a raw aggregation anymore: it's the detector's own rule
        // (farAssessment via services/audit/farKpi.js) — effective distance minus accuracy,
        // honest corrections and post-knock pin fixes forgiven. Same activityMatch object as
        // the aggregations above, so the date/campaign window can never drift.
        computeFarKpi(activityMatch, { organizationId: orgId }),
      ]);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const actions = { not_home: 0, wrong_address: 0, refused: 0, survey_submitted: 0, lit_dropped: 0, note_added: 0, restricted: 0, no_soliciting: 0 };
    for (const r of actionAgg) actions[r._id] = r.count;
    // The same knock definition as /canvassers: notHome + wrongAddress + REFUSED + lit + surveyed.
    // Refused was missing here (this endpoint predates the Refused disposition), which made this
    // panel read FEWER doors than the Timeline for the same person over the same range — and
    // inflated the rate below via the smaller denominator. Because the mobile write path keeps at
    // most one replaceable row per (canvasser, household, pass), this action sum IS the canvasser's
    // distinct door-pass count — no separate dedupe needed.
    const homesKnocked =
      actions.not_home + actions.wrong_address + actions.refused + actions.no_soliciting +
      actions.survey_submitted + actions.lit_dropped;

    const surveysSubmitted = surveysCount;

    // Per-day denominators: the measured FbTime row where the org has connected
    // and the day has a usable one, the shift span otherwise (one fold for the
    // KPI, per-day sources for the row lists below — services/reports/hoursSource.js).
    const dailySorted = [...dailyAgg].sort((a, b) => (a._id < b._id ? -1 : 1));
    const measured = await loadMeasuredHours({
      organizationId: orgId,
      from: req.query.from ? String(req.query.from).slice(0, 10) : null,
      to: req.query.to ? String(req.query.to).slice(0, 10) : null,
      tz,
      campaignId: scopedCampaignId(req),
    });
    const fold = foldUserHours({
      userId,
      perDayRows: dailySorted.map((d) => ({ day: d._id, spanHours: spanHours(d.first, d.last) })),
      measured,
    });
    const hoursOnDoors = fold.hoursOnDoors;
    const daysActive = dailySorted.length;
    const measuredDayOf = (day) => {
      const m = measured.enabled ? measured.byUserDay.get(`${String(userId)}|${day}`) : null;
      return m && m.hours > 0 && !m.isStale ? m : null;
    };

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

    const lastSevenDays = dailySorted.slice(-7).map((d) => {
      const m = measuredDayOf(d._id);
      return {
        date: d._id,
        homesKnocked: d.homesKnocked,
        hoursOnDoors: m
          ? Math.round(m.hours * 100) / 100
          : Math.round(((new Date(d.last) - new Date(d.first)) / 3600000) * 100) / 100,
        // Exactly one source per DAY — 'mixed' exists only at range grain.
        hoursSource: m ? 'measured' : 'estimated',
        firstActivityAt: d.first,
        lastActivityAt: d.last,
      };
    });

    const qual = qualityAgg[0] || {
      total: 0,
      offlineCount: 0,
      avgDistance: null,
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
        // numerator (door-unit); surveysSubmitted is the RESPONSE unit — SurveyResponse rows,
        // a countDocuments, surfaced as "Surveys taken". It is NOT the voter unit: that is
        // `surveyedVoters`, a distinct voterId count, and the two part company the moment a
        // campaign runs a second round. See docs/METRICS.md's three-units box.
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
        // Provenance for every hours-derived figure above (all four divide by the
        // same merged hoursOnDoors, so one label covers them).
        hoursSource: fold.hoursSource,
        hoursFlags: {
          hasOpenShift: fold.hasOpenShift,
          hasStaleShift: fold.hasStaleShift,
          hasManualEntry: fold.hasManualEntry,
        },
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
        // Detector-rule far (see farKpi.js). Denominator deliberately stays qual.total — the
        // percent's meaning ("share of all field activity") is unchanged; only the numerator
        // got honest. farForgivenByPinCount explains the number's movement after a pin fix.
        farFromHouseCount: farKpi.farCount,
        farFromHousePercent:
          qual.total > 0 ? Math.round((farKpi.farCount / qual.total) * 1000) / 10 : 0,
        farForgivenByPinCount: farKpi.farForgivenByPinCount,
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
          noSoliciting: 0,
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
      else if (at === 'no_soliciting') d.noSoliciting = r.count;
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

    // The measured overlay — each day takes exactly one source ('mixed' exists
    // only at range grain; a single day is measured or it is not).
    // No campaignId on purpose: this route's rows are knock-days only (byDay
    // comes from the activity aggregation), and knock-days always measure —
    // the attribution rule only decides union days, which never appear here.
    const measured = await loadMeasuredHours({
      organizationId: activeOrgId(req),
      from: req.query.from ? String(req.query.from).slice(0, 10) : null,
      to: req.query.to ? String(req.query.to).slice(0, 10) : null,
      tz,
    });

    const rows = Array.from(byDay.values())
      .map((d) => {
        const m = measured.enabled ? measured.byUserDay.get(`${String(userId)}|${d.date}`) : null;
        const usable = m && m.hours > 0 && !m.isStale;
        const hoursOnDoors = usable
          ? m.hours
          : d.firstActivityAt && d.lastActivityAt
            ? (new Date(d.lastActivityAt) - new Date(d.firstActivityAt)) / 3600000
            : 0;
        const connectionRatePct =
          d.homesKnocked > 0
            ? ((d.surveyKnocks + d.litDropped) / d.homesKnocked) * 100
            : 0;
        return {
          ...d,
          hoursOnDoors: Math.round(hoursOnDoors * 100) / 100,
          hoursSource: usable ? 'measured' : 'estimated',
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

    // Per-page pin-forgiveness annotation. The DB filter and pagination stay untouched — the
    // flaggedOnly $or is deliberately a raw superset (effective-distance/pin logic isn't an
    // indexable query), and post-FILTERING a page would make `total` lie and pages come up
    // short. Annotate-not-filter: a forgiven row still appears, marked.
    const { assessmentsByActionId } = await farKpiForRows(activities, {
      organizationId: activeOrgId(req),
    });

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
        pinForgiven: !!assessmentsByActionId.get(String(a._id))?.detail?.pinDowngraded,
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

    const [distAgg, offlineAgg, syncAgg, flaggedList, lastSync, farKpi] = await Promise.all([
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
      // Detector-rule far count — same helper as /summary, same activityMatch object, so the
      // two screens can't disagree (and the old hardcoded-50 count here, which contradicted
      // this route's own 75-based flagged list, is gone).
      computeFarKpi(activityMatch, { organizationId: activeOrgId(req) }),
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
    };

    res.json({
      totalActivities: q.total,
      offlineCount: q.offlineCount,
      offlinePercent: q.total > 0 ? Math.round((q.offlineCount / q.total) * 1000) / 10 : 0,
      avgDistanceFromHouseMeters:
        q.avgDistance != null ? Math.round(q.avgDistance * 10) / 10 : null,
      farFromHouseCount: farKpi.farCount,
      farFromHousePercent:
        q.total > 0 ? Math.round((farKpi.farCount / q.total) * 1000) / 10 : 0,
      farForgivenByPinCount: farKpi.farForgivenByPinCount,
      distanceHistogram,
      syncLagHistogram,
      lastSyncAt: lastSync?.syncedAt || null,
      // The list stays the raw FAR_WARN_M-or-offline SUPERSET (annotate, never post-filter):
      // pin-forgiven rows remain visible, marked, so forgiveness is reviewable rather than
      // silent — same downgrade-never-suppress posture as the audit queue.
      flaggedActivities: flaggedList.map((a) => ({
        id: String(a._id),
        actionType: a.actionType,
        timestamp: a.timestamp,
        wasOfflineSubmission: !!a.wasOfflineSubmission,
        distanceFromHouseMeters: a.distanceFromHouseMeters,
        location: a.location,
        pinForgiven: !!farKpi.assessmentsByActionId.get(String(a._id))?.detail?.pinDowngraded,
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

// Everything between "parse the request" and "page the list", shared VERBATIM by GET /flags
// and POST /flags/review-bulk — so the set a bulk decision writes is exactly the set the
// same query string showed. Validates the range, builds the match, runs detectFlags, then
// applies the drill-in filters (reasonType / reviewStatus / severity — post-detection: 'open'
// is not a DB status, so status filtering happens after the live join). Returns
// { error, status } on a bad range, else { list, summary, truncated, windowActionCount, tz }.
async function resolveFlagScope(req) {
  const orgId = activeOrgId(req);
  const tz = tzOf(req);

  // Bound the scan: an explicit from/to over AUDIT_WINDOW_MAX_DAYS is rejected — detectFlags
  // loads every matched row into Node, so this cap is an OOM guard, not a rendering bound
  // (the Timeline's range cap is now separate and wider).
  // (Relative presets send to:null → to defaults to today, so the span is still checked.
  // A fully open-ended range = campaign-bounded all-time, consistent with other reports.)
  const fromDay = req.query.from ? String(req.query.from).slice(0, 10) : null;
  if (fromDay) {
    const toDay = req.query.to ? String(req.query.to).slice(0, 10) : zonedDayStr(new Date(), tz);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromDay) && /^\d{4}-\d{2}-\d{2}$/.test(toDay)) {
      if (fromDay > toDay) return { error: 'from must be on or before to', status: 400 };
      if (ymdSpanDays(fromDay, toDay) > AUDIT_WINDOW_MAX_DAYS) {
        return { error: `Date range too large (max ${AUDIT_WINDOW_MAX_DAYS} days)`, status: 400 };
      }
    }
  }

  const match = { ...baseFilter(req), ...parseDateRange(req, 'timestamp') };
  if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) {
    match.userId = new mongoose.Types.ObjectId(req.query.userId);
  }

  // Guarantee a bounded scan even when `from` is absent — an open-ended range would otherwise pull
  // the whole campaign/org ledger into memory. Default the lower bound to AUDIT_WINDOW_MAX_DAYS back.
  if (!match.timestamp || match.timestamp.$gte == null) {
    const upper = (match.timestamp && (match.timestamp.$lte || match.timestamp.$lt)) || new Date();
    const lower = new Date(new Date(upper).getTime() - AUDIT_WINDOW_MAX_DAYS * 24 * 60 * 60 * 1000);
    match.timestamp = { ...(match.timestamp || {}), $gte: lower };
  }

  const { entries, summary, truncated, windowActionCount } = await detectFlags(match, { organizationId: orgId });

  const reasonSet = csvSet(req.query.reasonType, REASON_TYPES);
  const statusSet = csvSet(req.query.reviewStatus, ['open', 'reviewed', 'dismissed', 'confirmed']);
  const minSev = SEVERITY_RANK[String(req.query.severity || '')] || null;

  let list = entries;
  if (reasonSet) list = list.filter((e) => e.reasons.some((r) => reasonSet.has(r.type)));
  if (statusSet) list = list.filter((e) => statusSet.has(e.review?.status || 'open'));
  if (minSev) list = list.filter((e) => (SEVERITY_RANK[e.maxSeverity] || 0) >= minSev);

  return { list, summary, truncated: !!truncated, windowActionCount, tz };
}

router.get('/flags', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const scope = await resolveFlagScope(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const { list, summary, truncated, windowActionCount, tz } = scope;

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
      truncated,
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

// Bulk review — ONE decision applied to every flag matching a /flags query scope. Scope
// lives in the QUERY STRING deliberately: unlike /flags/review this route is NOT exempt
// from the router's campaign-scope guard (an admin must name a campaignId, a lead must
// manage it), and resolveFlagScope reads req.query verbatim — so the set written is exactly
// the set the same query showed. Body: { status, note?, actionIds?, dryRun? }.
//   - actionIds NARROWS the resolved set (checkbox selection); ids outside it are ignored,
//     never written — every decision provably lands on a currently-flagged, in-scope action,
//     and reasonsAtReview is snapshotted from the server's own detection, not the client.
//   - dryRun returns { matched } without writing (exact counts for confirm dialogs when the
//     client's shown list is capped or client-side-filtered).
//   - status 'open' bulk-REOPENS: deletes the matched decisions (absence = open).
//   - The response splits createdActionIds (were open — safe to undo by reopening) from
//     overwrittenActionIds (had a prior decision the bulk replaced; "undoing" those would
//     DELETE the earlier reviewer's decision, not restore it, so clients offer Undo only
//     over the created ones).
// No transactions (the test harness runs a standalone mongod) — one unordered bulkWrite of
// independent idempotent upserts; a partial failure leaves valid single decisions behind.
export const BULK_REVIEW_CAP = 2000;

router.post('/flags/review-bulk', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);

    // Always campaign-scoped, even in single-campaign orgs where the router guard lets a
    // bare request through — there is deliberately no org-wide bulk decision.
    if (req.query.all === '1' || !mongoose.isValidObjectId(req.query.campaignId)) {
      return res.status(400).json({ error: 'Bulk review requires a campaignId — org-wide bulk is not supported.' });
    }

    const { status, note, actionIds, dryRun } = req.body || {};
    if (!['open', 'reviewed', 'dismissed', 'confirmed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const scope = await resolveFlagScope(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    if (scope.truncated) {
      // Never partial-apply: a window too big to detect in memory is too big to decide on.
      return res.status(409).json({
        error: 'This range has too many events to bulk-review at once — narrow the date range.',
        windowActionCount: scope.windowActionCount,
      });
    }

    let targets = scope.list;
    if (Array.isArray(actionIds)) {
      const idSet = new Set(actionIds.filter((id) => mongoose.isValidObjectId(id)).map(String));
      targets = targets.filter((e) => idSet.has(e.actionId));
    }

    const matched = targets.length;
    if (matched > BULK_REVIEW_CAP) {
      return res.status(409).json({
        error: `That matches ${matched} flags — more than the ${BULK_REVIEW_CAP} one bulk action can take. Narrow the filters.`,
        matched,
      });
    }
    if (dryRun) return res.json({ matched, dryRun: true });
    if (!matched) {
      return res.json({ matched: 0, deleted: 0, createdActionIds: [], overwrittenActionIds: [], status });
    }

    if (status === 'open') {
      // Bulk reopen = delete the matched decisions ('open' is never stored).
      const r = await FlagReview.deleteMany({
        organizationId: orgId,
        actionModel: 'CanvassActivity',
        actionId: { $in: targets.map((e) => new mongoose.Types.ObjectId(e.actionId)) },
      });
      return res.json({ matched, deleted: r.deletedCount, createdActionIds: [], overwrittenActionIds: [], status });
    }

    const now = new Date();
    const noteText = typeof note === 'string' && note.trim() ? note.trim().slice(0, 2000) : null;
    const ops = targets.map((e) => ({
      updateOne: {
        filter: {
          organizationId: orgId,
          actionModel: e.actionModel,
          actionId: new mongoose.Types.ObjectId(e.actionId),
        },
        update: {
          $set: {
            campaignId: new mongoose.Types.ObjectId(e.campaignId),
            status,
            reviewedBy: req.user._id,
            reviewedAt: now,
            reasonsAtReview: e.reasons.map((r) => r.type).slice(0, 8),
            // An empty shared note leaves each entry's existing note alone — a bulk sweep
            // must not wipe a per-entry note someone wrote. On inserts the field simply
            // stays absent, which every reader already treats as null.
            ...(noteText ? { note: noteText } : {}),
          },
        },
        upsert: true,
      },
    }));
    const result = await FlagReview.bulkWrite(ops, { ordered: false });

    // upsertedIds is keyed by op index → split created (was open) from overwritten (had a
    // prior decision). See the route comment: Undo is only offered over created ones.
    const upserted = result.upsertedIds || {};
    const createdActionIds = [];
    const overwrittenActionIds = [];
    targets.forEach((e, i) => {
      (upserted[i] !== undefined ? createdActionIds : overwrittenActionIds).push(e.actionId);
    });

    res.json({ matched, createdActionIds, overwrittenActionIds, status });
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
