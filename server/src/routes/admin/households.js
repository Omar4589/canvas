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
import { getPassStatusMap, getUserStatusMap } from '../../services/passes/passStatus.js';
import { setDoNotKnock, clearDoNotKnock } from '../../services/dnc/doNotKnock.js';
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

router.get('/map', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const userId =
      req.query.userId && mongoose.isValidObjectId(req.query.userId)
        ? new mongoose.Types.ObjectId(req.query.userId)
        : null;
    const status = Array.isArray(req.query.status)
      ? req.query.status
      : req.query.status
      ? String(req.query.status).split(',').filter(Boolean)
      : null;
    const questionKey = req.query.questionKey || null;
    const answerOption = req.query.option || null;
    const optionId = req.query.optionId || null;
    // Question keys / option ids are label slugs unique only WITHIN one survey template,
    // so the answer filter accepts an optional template scope. Optional for back-compat:
    // clients that don't send it (old mobile builds) keep the legacy cross-template union.
    const surveyTemplateId =
      req.query.surveyTemplateId && mongoose.isValidObjectId(req.query.surveyTemplateId)
        ? new mongoose.Types.ObjectId(req.query.surveyTemplateId)
        : null;

    const campaignId =
      req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)
        ? new mongoose.Types.ObjectId(req.query.campaignId)
        : null;

    // A team lead may only pull the map for a campaign they manage — and never org-wide
    // (no campaignId). Admins must scope too once the org runs 2+ campaigns (an unscoped
    // pull would merge both campaigns' doors onto one map; every shipping client always
    // sends campaignId) — `all=1` is the explicit org-wide escape hatch, and
    // single-campaign orgs keep the legacy unscoped shape. Mirrors the reports guard.
    if (!isOrgAdmin(req)) {
      if (!campaignId) {
        return res.status(403).json({ error: 'A team lead must scope the map to a campaign they manage.' });
      }
      if (!(await canManageCampaign(req, campaignId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else if (!campaignId && req.query.all !== '1') {
      const campaignCount = await Campaign.countDocuments({ organizationId: orgId });
      if (campaignCount > 1) {
        return res.status(400).json({ error: 'This organization runs multiple campaigns — pass campaignId, or all=1 for the org-wide map.' });
      }
    }

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

    // Scoped audit: narrow the map to one effort's doors, or one pass's books.
    const effortId =
      req.query.effortId && mongoose.isValidObjectId(req.query.effortId)
        ? new mongoose.Types.ObjectId(req.query.effortId)
        : null;
    const passId =
      req.query.passId && mongoose.isValidObjectId(req.query.passId)
        ? new mongoose.Types.ObjectId(req.query.passId)
        : null;
    // Narrow the map to a single import's net-new doors ("View these homes on the map").
    const importId =
      req.query.importId && mongoose.isValidObjectId(req.query.importId)
        ? new mongoose.Types.ObjectId(req.query.importId)
        : null;
    // Same idea for a saved search — its frozen householdIds are already exactly the door set,
    // so this reads the snapshot rather than re-resolving the filter. That is the point of a
    // saved search being frozen (SavedSearch.js decision 8): the map must show the doors the
    // list actually holds, not what the same filter would select today.
    const savedSearchId =
      req.query.savedSearchId && mongoose.isValidObjectId(req.query.savedSearchId)
        ? new mongoose.Types.ObjectId(req.query.savedSearchId)
        : null;

    // Date window in the campaign's (or org's) timezone — date-only days in, half-open
    // [start(fromDay), start(toDay+1)) out — so the map narrows to the same day window as
    // the dashboards. See docs/TIMEZONES.md.
    const fromDay = req.query.from ? String(req.query.from).slice(0, 10) : null;
    const toDay = req.query.to ? String(req.query.to).slice(0, 10) : null;
    const dateWindow = zonedDayRange(fromDay, toDay, await resolveMapTz(orgId, campaignId));

    const householdFilter = {
      organizationId: orgId,
      isActive: true,
      'location.coordinates': { $exists: true, $ne: null },
    };
    // Viewport bound: `bbox=west,south,east,north` narrows the pull to the visible map area via
    // $geoWithin on the 2dsphere index — both clients send it on pan/zoom so the periodic live
    // refetch never re-pulls the whole universe. Absent/invalid/near-world boxes fall back to the
    // unbounded (still capped) pull, so a bad bbox can only widen, never wrongly narrow.
    if (req.query.bbox) {
      const parts = String(req.query.bbox).split(',').map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        const w = Math.max(parts[0], -180);
        const s = Math.max(parts[1], -90);
        const e = Math.min(parts[2], 180);
        const n = Math.min(parts[3], 90);
        // Reject degenerate boxes, and treat a near-whole-world viewport as "no bound" — a
        // full-span GeoJSON polygon risks the smaller-area (inverted) interpretation.
        if (w < e && s < n && e - w < 350 && n - s < 170) {
          householdFilter.location = {
            $geoWithin: {
              $geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
            },
          };
        }
      }
    }
    // When scoped to a round (passId) or a single canvasser (userId) we filter by that
    // scope's resolved status (below), not the global Household.status — so the door set
    // matches the colors shown. Only a pure global view filters the stored status here.
    if (status && status.length && !passId && !userId) householdFilter.status = { $in: status };
    if (campaignId) householdFilter.campaignId = campaignId;
    if (effortId) householdFilter.effortId = effortId;
    if (importId) {
      const job = await ImportJob.findOne({ _id: importId, organizationId: orgId }, 'insertedHouseholdIds').lean();
      const ids = job?.insertedHouseholdIds || [];
      if (!ids.length) {
        return res.json(withBounds({ households: [], canvassers: await loadCanvasserRoster(orgId, campaignId), activities: [], total: 0 }));
      }
      householdFilter._id = { $in: ids };
    }
    if (savedSearchId) {
      const ss = await SavedSearch.findOne(
        { _id: savedSearchId, campaignId, organizationId: orgId },
        'householdIds'
      ).lean();
      const ids = ss?.householdIds || [];
      if (!ids.length) {
        return res.json(withBounds({ households: [], canvassers: await loadCanvasserRoster(orgId, campaignId), activities: [], total: 0 }));
      }
      // Intersect rather than overwrite: importId above may already have narrowed _id, and a
      // deep link carrying both must show the overlap, not whichever clause ran last.
      householdFilter._id = householdFilter._id
        ? { $in: ids.filter((id) => householdFilter._id.$in.some((x) => String(x) === String(id))) }
        : { $in: ids };
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
    // Scope activity/surveys to the selected round so "showing Pass N" reflects
    // that round's status + activity, not the global latest across all rounds.
    if (passId) {
      surveyMatch.passId = passId;
      activityMatch.passId = passId;
    }
    if (questionKey && (optionId || answerOption)) {
      // Dual-read: match by stable option id (id-native) OR legacy answer text,
      // so a renamed option still selects its earlier responses.
      Object.assign(surveyMatch, voterAnswerClause(questionKey, optionId, answerOption));
      if (surveyTemplateId) surveyMatch.surveyTemplateId = surveyTemplateId;
    }

    // Pass scoping: limit to households that sit in this pass's books (Turf.householdIds).
    let passHhSet = null;
    if (passId) {
      const turfDocs = await Turf.find({ passId }, 'householdIds').lean();
      passHhSet = new Set();
      for (const t of turfDocs) for (const id of t.householdIds || []) passHhSet.add(String(id));
      if (passHhSet.size === 0) {
        return res.json(withBounds({ households: [], canvassers: await loadCanvasserRoster(orgId, campaignId), activities: [], total: 0 }));
      }
    }

    const filteringInteractions =
      Boolean(fromDay || toDay || userId || (questionKey && (optionId || answerOption)));

    if (filteringInteractions || passHhSet) {
      let idStrings;
      if (filteringInteractions) {
        const [surveyHIds, activityHIds] = await Promise.all([
          SurveyResponse.distinct('householdId', surveyMatch),
          questionKey && (optionId || answerOption)
            ? Promise.resolve([])
            : CanvassActivity.distinct('householdId', activityMatch),
        ]);
        idStrings = [...new Set([...surveyHIds, ...activityHIds].map(String))];
        // Intersect the interaction set with the pass's households when both apply.
        if (passHhSet) idStrings = idStrings.filter((id) => passHhSet.has(id));
      } else {
        idStrings = [...passHhSet];
      }
      if (!idStrings.length) {
        return res.json(withBounds({ households: [], canvassers: await loadCanvasserRoster(orgId, campaignId), activities: [], total: 0 }));
      }
      householdFilter._id = { $in: idStrings.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    // Cap the map fetch so an unbounded org-/campaign-wide open can't pull every active household
    // into memory + a multi-MB payload. Pass- and interaction-scoped opens are already bounded by
    // _id:$in above; this guards the default campaign/org open. Backed by {campaignId,isActive}.
    const MAP_HOUSEHOLD_CAP = 50000;
    let households = await Household.find(
      householdFilter,
      'addressLine1 addressLine2 city state zipCode location status lastActionAt lastActionBy coordSource coordConfidence correctedAt doNotKnock excludedFromTurf'
    )
      .limit(MAP_HOUSEHOLD_CAP)
      .lean();
    const mapTruncated = households.length === MAP_HOUSEHOLD_CAP;

    if (!households.length) {
      return res.json(withBounds({ households: [], canvassers: await loadCanvasserRoster(orgId, campaignId), activities: [], total: 0 }));
    }

    let householdIds = households.map((h) => h._id);
    const includeActivities = req.query.includeActivities === '1';

    // Door status: filtered to one canvasser → THAT canvasser's own status; else scoped
    // to a pass → per-round status; else the global Household.status. A per-user or
    // per-pass status map recolors the house AND re-narrows the status-chip filter so the
    // door set matches the colors shown.
    let statusMap = null;
    if (userId || passId) {
      const camp = campaignId ? await Campaign.findById(campaignId, { type: 1 }).lean() : null;
      statusMap = userId
        ? await getUserStatusMap(userId, householdIds, camp?.type, passId)
        : await getPassStatusMap(passId, householdIds, camp?.type);
      if (status && status.length) {
        const wanted = new Set(status);
        households = households.filter((h) => wanted.has(statusMap.get(String(h._id))?.status || 'unknocked'));
        householdIds = households.map((h) => h._id);
      }
    }

    const canvassers = await loadCanvasserRoster(orgId, campaignId);

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
          },
        },
      ]),
      includeActivities
        ? CanvassActivity.find(
            // Ping trail only — bulk marks would draw N same-second pings at
            // house coords. The date-narrowing above stays inclusive, so a
            // Today-filtered map still surfaces just-bulk-marked doors.
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
        lastActionAt: ((passId || userId) ? last?.timestamp : h.lastActionAt) || last?.timestamp || null,
        lastAction: last
          ? {
              actionType: last.actionType,
              timestamp: last.timestamp,
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
      total: mapTruncated ? await Household.countDocuments(householdFilter) : result.length,
      truncated: mapTruncated,
    }));
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
      'submittedAt note answers voterId userId'
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
    // A lead may only see activity for a household in a campaign they manage.
    if (!isOrgAdmin(req)) {
      const hh = await Household.findOne({ _id: hid, organizationId: orgId }, { campaignId: 1 }).lean();
      if (!hh) return res.status(404).json({ error: 'Household not found' });
      if (!(await canManageCampaign(req, hh.campaignId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    const name = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : null);

    const [acts, surveys] = await Promise.all([
      CanvassActivity.find(
        { householdId: hid, organizationId: orgId, actionType: { $ne: 'note_added' } },
        'actionType timestamp userId passId note'
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
        .map((a) => ({ kind: 'knock', actionType: a.actionType, at: a.timestamp, passId: a.passId ? String(a.passId) : null, canvasser: name(a.userId), canvasserId: idOf(a.userId), note: a.note && a.note.trim() ? a.note : null })),
      ...surveys.map((s) => ({ kind: 'survey', actionType: 'survey_submitted', at: s.submittedAt, passId: s.passId ? String(s.passId) : null, canvasser: name(s.userId), canvasserId: idOf(s.userId), voter: s.voterId?.fullName || null })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    const passIds = [...new Set(entries.map((e) => e.passId).filter(Boolean))];
    const passes = passIds.length ? await Pass.find({ _id: { $in: passIds } }, 'roundNumber name').lean() : [];
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
          entries: items,
        };
      })
      .sort((a, b) => (b.roundNumber ?? -1) - (a.roundNumber ?? -1));

    res.json({ rounds });
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
