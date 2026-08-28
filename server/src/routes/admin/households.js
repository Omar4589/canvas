import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, canManageCampaign } from '../../services/authz/campaignManagement.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { voterAnswerClause } from '../../services/surveys/answerAgg.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { ImportJob } from '../../models/ImportJob.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { Turf } from '../../models/Turf.js';
import { Pass } from '../../models/Pass.js';
import { getPassStatusMap, getUserStatusMap, statusCountsFromMap, emptyStatusCounts } from '../../services/passes/passStatus.js';
import { setDoNotKnock, clearDoNotKnock } from '../../services/dnc/doNotKnock.js';
import { currentDeskPassForDoor } from '../../services/canvass/deskRestrict.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { zonedDayRange } from '../../utils/timezone.js';

const router = Router();
// Team leads reach the campaign Map (and its household-activity popup), so both routes
// here allow leads — scoped per-request to a campaign they manage (see the gates below).
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

// Record-level audit tag for every :householdId drill (see routes/admin/voters.js for the
// pattern) — a staff read under a grant logs WHICH door was opened.
router.param('householdId', (req, res, next, householdId) => {
  if (mongoose.isValidObjectId(householdId)) addAuditSubjects(res, 'household', householdId);
  next();
});

function activeOrgId(req) {
  return req.activeOrg?._id;
}

// Anchor timezone for the map's date window: the campaign's, else the org's. Mirrors
// reports.js so the map narrows to the same campaign-day window as the dashboards.
async function resolveMapTz(orgId, campaignId) {
  if (campaignId) {
    const c = await Campaign.findOne({ _id: campaignId, organizationId: orgId }, { timeZone: 1 }).lean();
    if (c?.timeZone) return c.timeZone;
  }
  const org = await Organization.findById(orgId, { timeZone: 1 }).lean();
  return org?.timeZone || 'America/New_York';
}

// The canvassers to offer in the map's dropdown. Derived from the CAMPAIGN (never the
// transient status/date/user filters), so selecting a filter that yields zero households
// can't empty the options and wedge the control — we return it even on empty-result paths.
//
// Org-wide map (no campaignId — admins only): every active member. Historical behavior.
//
// Campaign-scoped map (the audit case): everyone whose data can appear on THIS campaign's
// map — anyone who knocked or submitted a survey in it — UNIONED with anyone currently
// rostered to it (so a just-assigned canvasser with zero knocks is still selectable).
// Deliberately does NOT gate on User.isActive: a since-deactivated canvasser still has pins
// on the map, so they must stay filterable — the dropdown must never drop a visible pin's owner.
// This is also what keeps a SELF-DELETED canvasser auditable: deletion scrubs their name to
// "Deleted user" and drops them from the org-wide dropdown, but the campaign map — the one an
// admin actually investigates GPS flags on — still lists them, so their pins can be isolated.
async function loadCanvasserRoster(orgId, campaignId = null) {
  if (!campaignId) {
    const memberIds = await Membership.find({ organizationId: orgId, isActive: true }).distinct('userId');
    const users = await User.find(
      { _id: { $in: memberIds }, isActive: true },
      'firstName lastName email'
    )
      .sort({ firstName: 1 })
      .lean();
    return users.map((u) => ({
      id: String(u._id),
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
    }));
  }

  const [activityIds, surveyIds, rosterIds] = await Promise.all([
    CanvassActivity.distinct('userId', { organizationId: orgId, campaignId, via: { $ne: 'bulk' } }),
    SurveyResponse.distinct('userId', { organizationId: orgId, campaignId }),
    CampaignAssignment.distinct('userId', { organizationId: orgId, campaignId }),
  ]);
  const ids = [...new Set([...activityIds, ...surveyIds, ...rosterIds].map(String))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const users = await User.find({ _id: { $in: ids } }, 'firstName lastName email')
    .sort({ firstName: 1 })
    .lean();
  return users.map((u) => ({
    id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
  }));
}

function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}

// Cap the map fetch so an unbounded org-/campaign-wide open can't pull every active household
// into memory + a multi-MB payload. Pass- and interaction-scoped opens are already bounded by
// _id:$in; this guards the default campaign/org open. Backed by {campaignId,isActive}. Shipped
// as `cap` beside `truncated` so the clients can say "first 50,000 only" without hard-coding it.
const MAP_HOUSEHOLD_CAP = 50000;

const oid = (v) => (v && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);

// Every param the map family reads, validated exactly as before. Pure — no IO. Shared by /map
// (which adds the viewport + the stored-status clause back) and /map/counts (which ignores both),
// so the two routes can never disagree about what a filter means.
function parseMapQuery(req) {
  const rawStatus = Array.isArray(req.query.status)
    ? req.query.status
    : req.query.status
    ? String(req.query.status).split(',').filter(Boolean)
    : null;
  // Viewport bound: `bbox=west,south,east,north` → a $geoWithin polygon on the 2dsphere index,
  // or null. Absent/invalid/near-world boxes fall back to the unbounded (still capped) pull, so a
  // bad bbox can only widen, never wrongly narrow. Degenerate boxes are rejected, and a
  // near-whole-world viewport is treated as "no bound" — a full-span GeoJSON polygon risks the
  // smaller-area (inverted) interpretation.
  let geo = null;
  if (req.query.bbox) {
    const parts = String(req.query.bbox).split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const w = Math.max(parts[0], -180);
      const s = Math.max(parts[1], -90);
      const e = Math.min(parts[2], 180);
      const n = Math.min(parts[3], 90);
      if (w < e && s < n && e - w < 350 && n - s < 170) {
        geo = {
          $geoWithin: {
            $geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
          },
        };
      }
    }
  }
  return {
    orgId: activeOrgId(req),
    campaignId: oid(req.query.campaignId),
    // Scoped audit: narrow the map to one effort's doors, or one pass's books.
    effortId: oid(req.query.effortId),
    passId: oid(req.query.passId),
    // A single import's net-new doors ("View these homes on the map").
    importId: oid(req.query.importId),
    // A saved search's FROZEN householdIds — the door set the list actually holds, not what the
    // same filter would select today (SavedSearch.js decision 8).
    savedSearchId: oid(req.query.savedSearchId),
    userId: oid(req.query.userId),
    status: rawStatus && rawStatus.length ? rawStatus : null,
    questionKey: req.query.questionKey || null,
    answerOption: req.query.option || null,
    optionId: req.query.optionId || null,
    // Question keys / option ids are label slugs unique only WITHIN one survey template, so the
    // answer filter accepts an optional template scope. Optional for back-compat: clients that
    // don't send it (old mobile builds) keep the legacy cross-template union.
    surveyTemplateId: oid(req.query.surveyTemplateId),
    // Date window, date-only days in; resolved in the campaign's tz by buildMapScope.
    fromDay: req.query.from ? String(req.query.from).slice(0, 10) : null,
    toDay: req.query.to ? String(req.query.to).slice(0, 10) : null,
    geo,
    all: req.query.all === '1',
  };
}

// The lead / multi-campaign gate, shared by /map and /map/counts. A team lead may only pull the
// map for a campaign they manage — and never org-wide (no campaignId). Admins must scope too
// once the org runs 2+ campaigns (an unscoped pull would merge both campaigns' doors onto one
// map; every shipping client always sends campaignId) — `all=1` is the explicit org-wide escape
// hatch, and single-campaign orgs keep the legacy unscoped shape. Mirrors the reports guard.
// Returns null when allowed, else { status, error } for the route to send.
async function authorizeMapScope(req, q) {
  if (!isOrgAdmin(req)) {
    if (!q.campaignId) {
      return { status: 403, error: 'A team lead must scope the map to a campaign they manage.' };
    }
    if (!(await canManageCampaign(req, q.campaignId))) return { status: 403, error: 'Forbidden' };
  } else if (!q.campaignId && !q.all) {
    const campaignCount = await Campaign.countDocuments({ organizationId: q.orgId });
    if (campaignCount > 1) {
      return { status: 400, error: 'This organization runs multiple campaigns — pass campaignId, or all=1 for the org-wide map.' };
    }
  }
  return null;
}

// Resolve the map's door SCOPE from the parsed params — everything /map and /map/counts share.
//   universeFilter  — every active geocoded door in the campaign (or the selected walk list when
//                     effortId is set; or the org when neither). Frozen BEFORE any _id narrowing:
//                     pass / import / saved search / date / canvasser / answer never touch it.
//                     This is the header's "of N doors" denominator.
//   householdFilter — universeFilter + the _id narrowing (import, saved search, date-window /
//                     canvasser / answer interactions, pass books). NO viewport, NO status clause:
//                     /map adds both back; /map/counts never does.
//   surveyMatch / activityMatch — the ledger filters /map uses for survey meta + pings.
//   passHhSet, statusMode ('global' | 'user' | 'pass'), campaignType, dateWindow.
//   empty — false, or WHY the door set is known-empty ('import' | 'savedSearch' | 'pass' |
//           'interactions') so /map can send its empty body while counts still answer with a
//           real universe.
async function buildMapScope(q) {
  const { orgId, campaignId, effortId, passId, importId, savedSearchId, userId } = q;
  // One campaign read serves both the date-window anchor and the status-map flavor.
  const camp = campaignId
    ? await Campaign.findOne({ _id: campaignId, organizationId: orgId }, { timeZone: 1, type: 1 }).lean()
    : null;
  // Date window in the campaign's (or org's) timezone — date-only days in, half-open
  // [start(fromDay), start(toDay+1)) out — so the map narrows to the same day window as the
  // dashboards. See docs/TIMEZONES.md.
  const tz = camp?.timeZone || (await resolveMapTz(orgId, null));
  const dateWindow = zonedDayRange(q.fromDay, q.toDay, tz);

  const universeFilter = {
    organizationId: orgId,
    isActive: true,
    'location.coordinates': { $exists: true, $ne: null },
  };
  if (campaignId) universeFilter.campaignId = campaignId;
  if (effortId) universeFilter.effortId = effortId;

  const householdFilter = { ...universeFilter };
  // Every _id narrowing INTERSECTS with what is already there — never overwrites. A deep link
  // carrying an import (or a saved search) AND a date window must show the imported doors touched
  // in that window, not whichever clause ran last. (The interaction narrowing used to overwrite
  // the import/saved-search set, so "View these homes on the map" opened on Today showed today's
  // work instead of the import.)
  const narrowTo = (ids) => {
    if (!householdFilter._id) {
      householdFilter._id = { $in: ids };
      return;
    }
    const keep = new Set(householdFilter._id.$in.map(String));
    householdFilter._id = { $in: ids.filter((id) => keep.has(String(id))) };
  };

  const scope = {
    universeFilter,
    householdFilter,
    surveyMatch: null,
    activityMatch: null,
    passHhSet: null,
    // Filtered to one canvasser → THAT canvasser's own status; else scoped to a pass →
    // per-round status; else the global Household.status. userId wins over passId (and the
    // per-user map still honors the round when both are set).
    statusMode: userId ? 'user' : passId ? 'pass' : 'global',
    campaignType: camp?.type || null,
    dateWindow,
    tz,
    empty: false,
  };

  if (importId) {
    const job = await ImportJob.findOne({ _id: importId, organizationId: orgId }, 'insertedHouseholdIds').lean();
    const ids = job?.insertedHouseholdIds || [];
    if (!ids.length) return { ...scope, empty: 'import' };
    narrowTo(ids);
  }
  if (savedSearchId) {
    const ss = await SavedSearch.findOne(
      { _id: savedSearchId, campaignId, organizationId: orgId },
      'householdIds'
    ).lean();
    const ids = ss?.householdIds || [];
    if (!ids.length) return { ...scope, empty: 'savedSearch' };
    narrowTo(ids);
    if (!householdFilter._id.$in.length) return { ...scope, empty: 'savedSearch' };
  }

  const surveyMatch = { organizationId: orgId };
  const activityMatch = { organizationId: orgId };
  if (dateWindow.$gte || dateWindow.$lt) {
    surveyMatch.submittedAt = dateWindow;
    activityMatch.timestamp = dateWindow;
  }
  if (userId) {
    surveyMatch.userId = userId;
    activityMatch.userId = userId;
  }
  if (campaignId) {
    surveyMatch.campaignId = campaignId;
    activityMatch.campaignId = campaignId;
  }
  // Scope activity/surveys to the selected round so "showing Pass N" reflects that round's
  // status + activity, not the global latest across all rounds.
  if (passId) {
    surveyMatch.passId = passId;
    activityMatch.passId = passId;
  }
  const answerFilter = Boolean(q.questionKey && (q.optionId || q.answerOption));
  if (answerFilter) {
    // Dual-read: match by stable option id (id-native) OR legacy answer text, so a renamed
    // option still selects its earlier responses.
    Object.assign(surveyMatch, voterAnswerClause(q.questionKey, q.optionId, q.answerOption));
    if (q.surveyTemplateId) surveyMatch.surveyTemplateId = q.surveyTemplateId;
  }
  scope.surveyMatch = surveyMatch;
  scope.activityMatch = activityMatch;

  // Pass scoping: limit to households that sit in this pass's books (Turf.householdIds).
  let passHhSet = null;
  if (passId) {
    const turfDocs = await Turf.find({ passId }, 'householdIds').lean();
    passHhSet = new Set();
    for (const t of turfDocs) for (const id of t.householdIds || []) passHhSet.add(String(id));
    if (passHhSet.size === 0) return { ...scope, empty: 'pass' };
    scope.passHhSet = passHhSet;
  }

  const filteringInteractions = Boolean(q.fromDay || q.toDay || userId || answerFilter);
  if (filteringInteractions || passHhSet) {
    let idStrings;
    if (filteringInteractions) {
      const [surveyHIds, activityHIds] = await Promise.all([
        SurveyResponse.distinct('householdId', surveyMatch),
        answerFilter ? Promise.resolve([]) : CanvassActivity.distinct('householdId', activityMatch),
      ]);
      idStrings = [...new Set([...surveyHIds, ...activityHIds].map(String))];
      // Intersect the interaction set with the pass's households when both apply.
      if (passHhSet) idStrings = idStrings.filter((id) => passHhSet.has(id));
    } else {
      idStrings = [...passHhSet];
    }
    if (!idStrings.length) return { ...scope, empty: 'interactions' };
    narrowTo(idStrings.map((id) => new mongoose.Types.ObjectId(id)));
  }
  if (householdFilter._id && !householdFilter._id.$in.length) return { ...scope, empty: 'interactions' };
  return scope;
}

// The numbers behind the map header + sidebar chips, over the shared scope and WITHOUT the
// viewport — see the /map/counts route comment for what each field means.
async function computeMapCounts(scope, q) {
  const cond = (field) => ({ $sum: { $cond: [{ $eq: [`$${field}`, true] }, 1, 0] } });
  // One $group beats three countDocuments here: the coords clause isn't index-covered, so each
  // count would be its own doc scan; the group is one.
  const universeP = Household.aggregate([
    { $match: scope.universeFilter },
    { $group: { _id: null, total: { $sum: 1 }, excludedFromTurf: cond('excludedFromTurf'), doNotKnock: cond('doNotKnock') } },
  ]);

  const byStatus = emptyStatusCounts();
  const excludedBy = emptyStatusCounts();
  const dnkBy = emptyStatusCounts();
  let matchingP = Promise.resolve();
  if (!scope.empty) {
    if (scope.statusMode === 'global') {
      // $group by the STORED status — exactly what /map filters on in this mode. Only present
      // buckets come back, hence the zero-filled shape above.
      matchingP = Household.aggregate([
        { $match: scope.householdFilter },
        { $group: { _id: '$status', n: { $sum: 1 }, excluded: cond('excludedFromTurf'), dnk: cond('doNotKnock') } },
      ]).then((rows) => {
        for (const r of rows) {
          if (!(r._id in byStatus)) continue;
          byStatus[r._id] = r.n;
          excludedBy[r._id] = r.excluded;
          dnkBy[r._id] = r.dnk;
        }
      });
    } else {
      // Per-user / per-pass: the status is DERIVED, so resolve it for the whole scope through the
      // same oracle /map uses to color the pins (and to apply its status filter), then tally.
      matchingP = Household.find(scope.householdFilter, '_id excludedFromTurf doNotKnock')
        .lean()
        .then(async (docs) => {
          const ids = docs.map((d) => d._id);
          const statusMap =
            scope.statusMode === 'user'
              ? await getUserStatusMap(q.userId, ids, scope.campaignType, q.passId)
              : await getPassStatusMap(q.passId, ids, scope.campaignType);
          Object.assign(byStatus, statusCountsFromMap(statusMap, ids));
          for (const d of docs) {
            // Same fallback as /map: a door untouched in scope reads 'unknocked'.
            const s = statusMap.get(String(d._id))?.status || 'unknocked';
            if (d.excludedFromTurf === true) excludedBy[s] = (excludedBy[s] || 0) + 1;
            if (d.doNotKnock === true) dnkBy[s] = (dnkBy[s] || 0) + 1;
          }
        });
    }
  }
  const [uRows] = await Promise.all([universeP, matchingP]);
  const u = uRows[0];

  // `matching` honors the status filter; `byStatus` deliberately doesn't (it answers "what would
  // I get if I clicked this chip?"). Statuses are mutually exclusive per door, so matching is a
  // straight sum over the selected chips — derived HERE so web and mobile print the same number.
  const selected = q.status ? q.status.filter((s) => s in byStatus) : Object.keys(byStatus);
  const sum = (o) => selected.reduce((a, s) => a + (o[s] || 0), 0);
  return {
    universe: {
      total: u?.total ?? 0,
      excludedFromTurf: u?.excludedFromTurf ?? 0,
      doNotKnock: u?.doNotKnock ?? 0,
    },
    matching: { total: sum(byStatus), excludedFromTurf: sum(excludedBy), doNotKnock: sum(dnkBy) },
    byStatus,
    statusMode: scope.statusMode,
  };
}

router.get('/map', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const q = parseMapQuery(req);
    const deny = await authorizeMapScope(req, q);
    if (deny) return res.status(deny.status).json({ error: deny.error });
    const { orgId, campaignId, userId, passId, status } = q;

    // Optional: a date-INDEPENDENT bounding box over the campaign's (or org's) geocoded
    // doors, so a client can frame the camera on the real neighborhood even when the
    // date-filtered door set is empty (e.g. "today" before anyone has knocked). Computed
    // once — the client sends the flag on mount, not on every pan/filter.
    const includeBounds = req.query.includeBounds === '1';
    let bounds = null;
    if (includeBounds) {
      const [ext] = await Household.aggregate([
        {
          $match: {
            organizationId: orgId,
            isActive: true,
            'location.coordinates': { $exists: true, $ne: null },
            ...(campaignId ? { campaignId } : {}),
          },
        },
        {
          $group: {
            _id: null,
            minLng: { $min: { $arrayElemAt: ['$location.coordinates', 0] } },
            maxLng: { $max: { $arrayElemAt: ['$location.coordinates', 0] } },
            minLat: { $min: { $arrayElemAt: ['$location.coordinates', 1] } },
            maxLat: { $max: { $arrayElemAt: ['$location.coordinates', 1] } },
          },
        },
      ]);
      if (ext && Number.isFinite(ext.minLng)) {
        bounds = { minLng: ext.minLng, minLat: ext.minLat, maxLng: ext.maxLng, maxLat: ext.maxLat };
      }
    }
    // Merge the extent into any response shape (null unless requested).
    const withBounds = (payload) => (includeBounds ? { ...payload, bounds } : payload);
    const emptyBody = async () =>
      withBounds({
        households: [],
        canvassers: await loadCanvasserRoster(orgId, campaignId),
        activities: [],
        total: 0,
        truncated: false,
        cap: MAP_HOUSEHOLD_CAP,
      });

    const scope = await buildMapScope(q);
    if (scope.empty) return res.json(await emptyBody());

    // The two things THIS route adds to the shared scope — and /map/counts deliberately doesn't:
    // the viewport, and (in the global-status mode only) the stored-status clause. In the
    // per-user / per-pass modes the status filter is applied against the resolved status below,
    // so the door set matches the colors shown.
    const mapFilter = { ...scope.householdFilter };
    if (q.geo) mapFilter.location = q.geo;
    if (scope.statusMode === 'global' && status) mapFilter.status = { $in: status };

    let households = await Household.find(
      mapFilter,
      'addressLine1 addressLine2 city state zipCode location status lastActionAt lastActionBy coordSource coordConfidence correctedAt locationConfirmedAt doNotKnock excludedFromTurf effortId'
    )
      .limit(MAP_HOUSEHOLD_CAP)
      .lean();
    const mapTruncated = households.length === MAP_HOUSEHOLD_CAP;

    if (!households.length) return res.json(await emptyBody());

    let householdIds = households.map((h) => h._id);
    const includeActivities = req.query.includeActivities === '1';

    // Door status: filtered to one canvasser → THAT canvasser's own status; else scoped
    // to a pass → per-round status; else the global Household.status. A per-user or
    // per-pass status map recolors the house AND re-narrows the status-chip filter so the
    // door set matches the colors shown.
    let statusMap = null;
    if (scope.statusMode !== 'global') {
      statusMap =
        scope.statusMode === 'user'
          ? await getUserStatusMap(userId, householdIds, scope.campaignType, passId)
          : await getPassStatusMap(passId, householdIds, scope.campaignType);
      if (status) {
        const wanted = new Set(status);
        households = households.filter((h) => wanted.has(statusMap.get(String(h._id))?.status || 'unknocked'));
        householdIds = households.map((h) => h._id);
      }
    }

    const canvassers = await loadCanvasserRoster(orgId, campaignId);
    const { activityMatch } = scope;

    const [voters, surveys, lastActivities, activities] = await Promise.all([
      Voter.find(
        { householdId: { $in: householdIds }, organizationId: orgId },
        'householdId fullName surveyStatus party'
      ).lean(),
      // `answers` is deliberately NOT fetched or shipped here — it's the heaviest field of the
      // whole map payload. The detail panel lazy-loads it per household on open
      // (GET /:householdId/surveys below).
      SurveyResponse.find(
        { householdId: { $in: householdIds }, organizationId: orgId, ...(passId ? { passId } : {}) },
        'householdId submittedAt note voterId userId'
      )
        .populate('voterId', 'fullName')
        .populate('userId', 'firstName lastName')
        .lean(),
      CanvassActivity.aggregate([
        // Filtered to one canvasser → their own last action (matches the per-user color);
        // else the latest by anyone (optionally pass-scoped).
        { $match: { householdId: { $in: householdIds }, organizationId: orgId, ...(passId ? { passId } : {}), ...(userId ? { userId } : {}) } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$householdId',
            actionType: { $first: '$actionType' },
            timestamp: { $first: '$timestamp' },
            userId: { $first: '$userId' },
            // Desk marks are NOT excluded here (they are the door's latest action), so the
            // panel needs the provenance to label one as desk work rather than the admin's
            // field work.
            via: { $first: '$via' },
          },
        },
      ]),
      includeActivities
        ? CanvassActivity.find(
            // Ping trail only — desk marks (bulk or single-home) would draw N same-second
            // pings at house coords. The date-narrowing above stays inclusive, so a
            // Today-filtered map still surfaces just-desk-marked doors.
            { ...activityMatch, householdId: { $in: householdIds }, via: { $ne: 'bulk' } },
            'householdId userId actionType timestamp location distanceFromHouseMeters'
          )
            .populate('userId', 'firstName lastName')
            .lean()
        : Promise.resolve([]),
    ]);

    const votersByHh = new Map();
    for (const v of voters) {
      const k = String(v.householdId);
      if (!votersByHh.has(k)) votersByHh.set(k, []);
      votersByHh.get(k).push({
        id: String(v._id),
        fullName: v.fullName,
        surveyStatus: v.surveyStatus,
        party: v.party || null,
      });
    }

    const surveysByHh = new Map();
    for (const s of surveys) {
      const k = String(s.householdId);
      if (!surveysByHh.has(k)) surveysByHh.set(k, []);
      surveysByHh.get(k).push({
        id: String(s._id),
        submittedAt: s.submittedAt,
        voter: s.voterId
          ? { id: String(s.voterId._id), fullName: s.voterId.fullName }
          : null,
        canvasser: s.userId
          ? {
              id: String(s.userId._id),
              firstName: s.userId.firstName,
              lastName: s.userId.lastName,
            }
          : null,
        note: s.note || null,
      });
    }

    const lastActByHh = new Map();
    for (const a of lastActivities) lastActByHh.set(String(a._id), a);

    const userIds = [...new Set(lastActivities.map((a) => String(a.userId)).filter(Boolean))];
    const lastUsers = await User.find(
      { _id: { $in: userIds } },
      'firstName lastName'
    ).lean();
    const userMap = new Map(lastUsers.map((u) => [String(u._id), u]));

    const result = households.map((h) => {
      const last = lastActByHh.get(String(h._id));
      const lastUser = last && userMap.get(String(last.userId));
      return {
        id: String(h._id),
        addressLine1: h.addressLine1,
        addressLine2: h.addressLine2 || null,
        city: h.city,
        state: h.state,
        zipCode: h.zipCode,
        location: h.location?.coordinates
          ? { lng: h.location.coordinates[0], lat: h.location.coordinates[1] }
          : null,
        // Filtered to a canvasser or a round → that scope's resolved status (a door
        // untouched in scope reads 'unknocked'); else the global "ever surveyed" status.
        status: statusMap ? statusMap.get(String(h._id))?.status || 'unknocked' : h.status,
        // Suppressed doors stay ON the admin map by design (this map is the record of work
        // performed and billed) — the flag rides along so the panel can badge them and offer
        // the lift. Never a filter here.
        doNotKnock: h.doNotKnock === true,
        // Same rule, second flag: a door the cut held back ("remove apartments"). It rides along
        // so the map can count it, dim it on request, and badge it in the panel — the SERVER
        // never filters on it. Read it as CAMPAIGN-WIDE and provenance-free: the stamp records no
        // effort/pass/actor (Household.js), so a client may say "not in books" and must never say
        // "excluded from THIS walk list" — a door can be re-carved into another effort and keep
        // the flag. See docs/MAPS.md §I.
        excludedFromTurf: h.excludedFromTurf === true,
        // The door's walk list (null = Intake), so a panel can pre-check "can this be desk-
        // marked at all" and narrow a round picker to the door's own effort.
        effortId: h.effortId ? String(h.effortId) : null,
        lastActionAt: ((passId || userId) ? last?.timestamp : h.lastActionAt) || last?.timestamp || null,
        lastAction: last
          ? {
              actionType: last.actionType,
              timestamp: last.timestamp,
              // 'bulk' = a desk mark (deskRestrict.js); null = recorded in the field.
              via: last.via || null,
              canvasser: lastUser
                ? {
                    id: String(lastUser._id),
                    firstName: lastUser.firstName,
                    lastName: lastUser.lastName,
                  }
                : null,
            }
          : null,
        voters: votersByHh.get(String(h._id)) || [],
        surveys: surveysByHh.get(String(h._id)) || [],
        coordSource: h.coordSource || null,
        coordConfidence: h.coordConfidence || null,
        correctedAt: h.correctedAt || null,
        // Confirm-in-place stamp (Pin Fixes): an interpolated pin a manager vouched for. The
        // ring layers skip these; the detail badge reads "Location confirmed".
        locationConfirmedAt: h.locationConfirmedAt || null,
      };
    });

    res.json(withBounds({
      households: result,
      canvassers,
      activities: activities.map((a) => ({
        id: String(a._id),
        householdId: String(a.householdId),
        actionType: a.actionType,
        timestamp: a.timestamp,
        location: a.location
          ? { lng: a.location.lng, lat: a.location.lat, accuracy: a.location.accuracy }
          : null,
        distanceFromHouseMeters: a.distanceFromHouseMeters,
        canvasser: a.userId
          ? {
              id: String(a.userId._id),
              firstName: a.userId.firstName,
              lastName: a.userId.lastName,
            }
          : null,
      })),
      // The viewport-bounded count behind this payload. Campaign-wide figures (never bbox'd)
      // live on /map/counts — that is the header's number.
      total: mapTruncated ? await Household.countDocuments(mapFilter) : result.length,
      truncated: mapTruncated,
      cap: MAP_HOUSEHOLD_CAP,
    }));
  } catch (err) {
    next(err);
  }
});

// Campaign-wide counts for the map header + sidebar — the SAME scope as /map (shared helpers
// above) minus the viewport, so the number never moves when the admin pans:
//   universe — every active geocoded door in the campaign (or the selected walk list): the
//              filter-independent "of N doors" denominator, with its excluded-from-books and
//              do-not-knock sub-counts. Pass / import / saved-search / date / canvasser / answer
//              scopes never move it. Deliberately NOT the knockable set (KNOCKABLE_DOOR_FILTER):
//              the map is the record of what exists, so the denominator is what the map can show.
//   matching — doors matching EVERY filter incl. status (no bbox) — the header's primary number.
//   byStatus — doors per status under every filter EXCEPT status — the sidebar chip counts
//              ("what you'd get if you clicked this"). Σ byStatus == matching.total with no
//              status filter; matching == Σ byStatus over the selected statuses otherwise.
// Per-user / per-pass modes resolve status through the same getUserStatusMap / getPassStatusMap
// as /map, so the chips agree with the pin colors. Polled at 20s under the Live pill like /map.
// Lead-gated identically. Registered before the /:householdId routes on purpose.
router.get('/map/counts', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const q = parseMapQuery(req);
    const deny = await authorizeMapScope(req, q);
    if (deny) return res.status(deny.status).json({ error: deny.error });
    const scope = await buildMapScope(q);
    res.json(await computeMapCounts(scope, q));
  } catch (err) {
    next(err);
  }
});

// One door's surveys WITH answers — the map detail panel lazy-loads this on open. The bulk /map
// payload ships each survey's meta only (id/when/who/note); `answers` is its heaviest field, so
// it moves per-door on demand instead of riding every 20s live refetch. `passId` mirrors the
// map's round scoping so the panel shows the same survey set as the pins.
router.get('/:householdId/surveys', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { householdId } = req.params;
    if (!mongoose.isValidObjectId(householdId)) return res.status(400).json({ error: 'Invalid id' });
    const hid = new mongoose.Types.ObjectId(householdId);
    // A lead may only read surveys for a household in a campaign they manage.
    if (!isOrgAdmin(req)) {
      const hh = await Household.findOne({ _id: hid, organizationId: orgId }, { campaignId: 1 }).lean();
      if (!hh) return res.status(404).json({ error: 'Household not found' });
      if (!(await canManageCampaign(req, hh.campaignId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    const passId =
      req.query.passId && mongoose.isValidObjectId(req.query.passId)
        ? new mongoose.Types.ObjectId(req.query.passId)
        : null;

    const surveys = await SurveyResponse.find(
      { householdId: hid, organizationId: orgId, ...(passId ? { passId } : {}) },
      'submittedAt note answers voterId userId deskEntry'
    )
      .populate('voterId', 'fullName')
      .populate('userId', 'firstName lastName')
      .lean();

    res.json({
      surveys: surveys.map((s) => ({
        id: String(s._id),
        submittedAt: s.submittedAt,
        voter: s.voterId ? { id: String(s.voterId._id), fullName: s.voterId.fullName } : null,
        canvasser: s.userId
          ? { id: String(s.userId._id), firstName: s.userId.firstName, lastName: s.userId.lastName }
          : null,
        answers: s.answers || [],
        note: s.note || null,
        deskEntry: s.deskEntry ? { at: s.deskEntry.at, fromOutcome: s.deskEntry.fromOutcome || null } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Per-door activity history across ALL rounds, grouped by round — powers the
// audit door-detail "History by round" so you can see a door worked in Round 1
// AND Round 2 (the latest-only map view hides this).
router.get('/:householdId/activity', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { householdId } = req.params;
    if (!mongoose.isValidObjectId(householdId)) return res.status(400).json({ error: 'Invalid id' });
    const hid = new mongoose.Types.ObjectId(householdId);
    // Loaded for everyone (campaignId + effortId feed `currentPassId` below); the
    // existence / management checks stay lead-only, as before.
    const hh = await Household.findOne({ _id: hid, organizationId: orgId }, { campaignId: 1, effortId: 1 }).lean();
    // A lead may only see activity for a household in a campaign they manage.
    if (!isOrgAdmin(req)) {
      if (!hh) return res.status(404).json({ error: 'Household not found' });
      if (!(await canManageCampaign(req, hh.campaignId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    const name = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : null);

    const [acts, surveys] = await Promise.all([
      CanvassActivity.find(
        { householdId: hid, organizationId: orgId, actionType: { $ne: 'note_added' } },
        'actionType timestamp userId passId note via'
      )
        .populate('userId', 'firstName lastName')
        .lean(),
      SurveyResponse.find(
        { householdId: hid, organizationId: orgId },
        'submittedAt userId passId voterId'
      )
        .populate('userId', 'firstName lastName')
        .populate('voterId', 'fullName')
        .lean(),
    ]);

    // A survey is written to BOTH ledgers (a survey_submitted CanvassActivity + a
    // SurveyResponse), so listing both would show every survey twice. The SurveyResponse
    // line is the richer one (it names the voter), so suppress the survey_submitted knock
    // entry when a matching SurveyResponse exists for the same door+pass+canvasser; keep it
    // only if genuinely orphaned (legacy/partial data).
    const surveyKeys = new Set(surveys.map((s) => `${s.passId ? String(s.passId) : 'none'}|${String(s.userId?._id || s.userId)}`));
    // canvasserId (stable) so the client overlap badge dedupes distinct canvassers the same
    // way the authoritative /overlap-doors set does (by id, not display name).
    const idOf = (u) => (u ? String(u._id || u) : null);
    const entries = [
      ...acts
        .filter((a) => !(a.actionType === 'survey_submitted' && surveyKeys.has(`${a.passId ? String(a.passId) : 'none'}|${String(a.userId?._id || a.userId)}`)))
        // `via`: 'bulk' = a desk mark (deskRestrict.js), null = recorded in the field. Survey
        // entries carry none — clients treat undefined as non-desk.
        .map((a) => ({ kind: 'knock', actionType: a.actionType, at: a.timestamp, passId: a.passId ? String(a.passId) : null, canvasser: name(a.userId), canvasserId: idOf(a.userId), note: a.note && a.note.trim() ? a.note : null, via: a.via || null })),
      ...surveys.map((s) => ({ kind: 'survey', actionType: 'survey_submitted', at: s.submittedAt, passId: s.passId ? String(s.passId) : null, canvasser: name(s.userId), canvasserId: idOf(s.userId), voter: s.voterId?.fullName || null })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    const passIds = [...new Set(entries.map((e) => e.passId).filter(Boolean))];
    const passes = passIds.length ? await Pass.find({ _id: { $in: passIds } }, 'roundNumber name status').lean() : [];
    const passMap = new Map(passes.map((p) => [String(p._id), p]));

    const byPass = new Map();
    for (const e of entries) {
      const key = e.passId || 'none';
      if (!byPass.has(key)) byPass.set(key, []);
      byPass.get(key).push(e);
    }
    const rounds = [...byPass.entries()]
      .map(([key, items]) => {
        const p = key === 'none' ? null : passMap.get(key);
        return {
          passId: key === 'none' ? null : key,
          roundNumber: p?.roundNumber ?? null,
          name: p?.name || (key === 'none' ? 'Before passes' : 'Pass'),
          status: p?.status ?? null,
          entries: items,
        };
      })
      .sort((a, b) => (b.roundNumber ?? -1) - (a.roundNumber ?? -1));

    // The round a desk mark with NO explicit passId lands on for THIS door (effort's active
    // round → its single draft → null; Intake → null) — the same rule restrict-doors applies,
    // so a client keys its "is this door desk-restricted this round" read on
    // `scopePassId || currentPassId` rather than guessing newest/active (rounds above list
    // ONLY rounds with entries).
    const currentPassId = hh
      ? await currentDeskPassForDoor({ campaignId: hh.campaignId, effortId: hh.effortId })
      : null;

    res.json({ rounds, currentPassId: currentPassId ? String(currentPassId) : null });
  } catch (err) {
    next(err);
  }
});

// ── Do not knock ────────────────────────────────────────────────────────────────────────
// Address-level suppression: "nobody comes to this door again". Distinct from the person-level
// DNC flag in routes/admin/voters.js, which needs EVERY voter at a door flagged before the door
// itself drops.
//
// ROLE GATE — a deliberate divergence from DNC. The DNC routes are org-ADMIN-only (routes/index.js
// mounts /admin/dnc outside the lead-admitting gate, on purpose). These admit LEADS too, scoped to
// a campaign they manage, because a lead runs the walk and is who a canvasser reports the request
// to. What no role can do is set it from the canvasser app: the request reaches us at the door,
// but darkening an address org-wide and permanently is a management decision (ruling, Aug 2026).
//
// Writes go through services/dnc/doNotKnock.js so the org-level record and the per-campaign
// Household mirrors can never drift.

// Load the door + enforce the lead's campaign scope. Returns null (after responding) on failure.
async function loadDoorForDnk(req, res) {
  const orgId = activeOrgId(req);
  const { householdId } = req.params;
  if (!mongoose.isValidObjectId(householdId)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const hh = await Household.findOne(
    { _id: householdId, organizationId: orgId },
    {
      campaignId: 1, normalizedAddress: 1, addressLine1: 1, addressLine2: 1,
      city: 1, state: 1, zipCode: 1, doNotKnock: 1,
    }
  ).lean();
  // 404 rather than 403 for a wrong-org id — same concealment the rest of this router uses.
  if (!hh) {
    res.status(404).json({ error: 'Household not found' });
    return null;
  }
  if (!isOrgAdmin(req) && !(await canManageCampaign(req, hh.campaignId))) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return hh;
}

// Which management role is acting — recorded on the request so a review can tell a lead's
// suppression from an admin's.
function dnkSource(req) {
  if (req.user?.isSuperAdmin) return 'super';
  return req.activeMembership?.role === 'lead' ? 'lead' : 'admin';
}

router.post('/:householdId/do-not-knock', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const hh = await loadDoorForDnk(req, res);
    if (!hh) return;

    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) {
      return res.status(400).json({ error: 'A reason is required (at least 3 characters).' });
    }

    const result = await setDoNotKnock({
      organizationId: activeOrgId(req),
      household: hh,
      reason,
      source: dnkSource(req),
      byUserId: req.user._id,
      campaignIdAtSet: hh.campaignId,
    });
    // doorsAffected counts EVERY campaign's row for this address, not just this one — the caller
    // shows it because suppressing from one campaign silently darkening a door in another would
    // otherwise be a surprise.
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:householdId/do-not-knock', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const hh = await loadDoorForDnk(req, res);
    if (!hh) return;

    const result = await clearDoNotKnock({
      organizationId: activeOrgId(req),
      normalizedAddress: hh.normalizedAddress,
    });
    if (!result.cleared) return res.status(404).json({ error: 'This address is not marked do-not-knock.' });
    res.json({ cleared: true, doorsAffected: result.doorsAffected });
  } catch (err) {
    next(err);
  }
});

export default router;
