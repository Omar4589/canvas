import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds } from '../../services/authz/campaignManagement.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { PacePause } from '../../models/PacePause.js';
import { Membership } from '../../models/Membership.js';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Household } from '../../models/Household.js';
import { Organization } from '../../models/Organization.js';
import { hydrateCanvassers } from '../../services/reports/canvasserIdentity.js';
import {
  switchCovers,
  orgEnabled,
  pauseIsBlocking,
  unpause,
  resolveAllOpen,
} from '../../services/audit/pacePause.js';
import { paceConfig, entriesOf, visitsOf, judgeVisits, summarize, JUDGED_RESULTS } from '../../services/audit/paceRule.js';
import { PACE_ROW_FIELDS, loadUnitFacts } from '../../services/audit/paceTimeline.js';
import { zonedDayRange, zonedDayStr } from '../../utils/timezone.js';

// Automatic pause — review, unpause, delete and settings (docs/PROPOSAL_PACE_PAUSE.md §G, §H). The in-product
// preview (§I.1) was removed on 2026-10-25, after go-live; the console replay (§I.2) stays.
// Mounted at /admin/pace-pauses. Org admins see the org; a team lead sees pauses on the campaigns they
// manage, with every other campaign's doors redacted — a lead can be the paying client (ROLES.md), and
// leads are walled per campaign everywhere else (reports.js, memberships.js).
//
// Every lookup carries organizationId: canManageCampaign passes any org admin without checking which org a
// campaign is in, so the org filter is what keeps one org's pauses from another's admins.

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

const orgOf = (req, res) => {
  if (!req.activeOrg?._id) {
    res.status(400).json({ error: 'Active organization required' });
    return null;
  }
  return req.activeOrg;
};

// The viewer's reach: org admins (and super admins) everything; a lead their grant set.
const viewerScope = async (req) => {
  if (isOrgAdmin(req)) return { admin: true, managed: null };
  return { admin: false, managed: new Set((await managedCampaignIds(req)).map(String)) };
};
const sees = (scope, campaignId) => scope.admin || (campaignId != null && scope.managed.has(String(campaignId)));

const nameOf = (uMap, id) => {
  const u = id ? uMap.get(String(id)) : null;
  return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
};

const addressOf = (h) =>
  h ? `${h.addressLine1 || ''}${h.addressLine2 ? ` ${h.addressLine2}` : ''}${h.city ? `, ${h.city}` : ''}`.trim() : null;

const mph = (meters, gapSec) => (gapSec > 0 && meters != null ? (meters / gapSec) * 2.23694 : null);

// One frozen window visit as a viewer may see it. A row on a campaign they don't manage keeps only its time
// and verdict; a hop whose other end they can't see keeps only its seconds and verdict — two hops between
// known houses would otherwise locate the hidden door (review round 2).
const shapeWindowVisit = (v, scope, households) => {
  if (!sees(scope, v.campaignId)) return { at: v.at, fail: v.fail, otherCampaign: true };
  const prevVisible = v.prevHouseholdId == null || sees(scope, v.prevCampaignId);
  return {
    householdId: String(v.householdId),
    address: addressOf(households.get(String(v.householdId))),
    result: v.result,
    at: v.at,
    fail: v.fail,
    pattern: prevVisible ? v.pattern : null,
    gapSec: v.gapSec,
    ...(prevVisible
      ? {
          prevAddress: v.prevHouseholdId ? addressOf(households.get(String(v.prevHouseholdId))) : null,
          prevResult: v.prevResult,
          prevAt: v.prevAt,
          meters: v.meters,
          effectiveMeters: v.effectiveMeters,
          neededSec: v.neededSec,
          mph: mph(v.meters, v.gapSec),
          surveyCheck: v.surveyCheck,
        }
      : { prevOtherCampaign: true, surveyCheck: v.surveyCheck ? { at: v.surveyCheck.at, gapSec: v.surveyCheck.gapSec, fail: v.surveyCheck.fail } : null }),
  };
};

// The members behind a set of pauses, for `blocking` and "member no longer active".
const membersOf = async (organizationId, userIds) => {
  const rows = await Membership.find({ organizationId, userId: { $in: userIds } }, 'userId role isActive').lean();
  return new Map(rows.map((m) => [String(m.userId), m]));
};

const listItemOf = (p, { org, members, uMap, campaignNames }) => {
  const member = members.get(String(p.userId));
  return {
    id: String(p._id),
    campaignId: String(p.campaignId),
    campaignName: campaignNames.get(String(p.campaignId)) || '',
    userId: String(p.userId),
    name: nameOf(uMap, p.userId),
    status: p.status,
    blocking: pauseIsBlocking(org, member, p),
    memberActive: Boolean(member?.isActive) && member?.role === 'canvasser',
    firedAt: p.firedAt,
    day: p.day,
    timeZone: p.timeZone,
    fails: (p.window || []).filter((v) => v.fail).length,
    alert: p.alert,
    resolvedAt: p.resolvedAt,
    resolvedVia: p.resolvedVia,
    resolvedByName: nameOf(uMap, p.resolvedBy),
  };
};

// ── GET / ───────────────────────────────────────────────────────────────────────────────────────────
const listQuerySchema = z.object({
  status: z.enum(['paused', 'resolved', 'all']).optional().default('all'),
  campaignId: z.string().optional(),
  userId: z.string().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const org = orgOf(req, res);
    if (!org) return;
    const q = listQuerySchema.parse(req.query);
    const scope = await viewerScope(req);
    const filter = { organizationId: org._id };
    if (q.status !== 'all') filter.status = q.status;
    if (q.userId) {
      if (!mongoose.isValidObjectId(q.userId)) return res.status(400).json({ error: 'Invalid userId' });
      filter.userId = q.userId;
    }
    if (q.campaignId) {
      if (!mongoose.isValidObjectId(q.campaignId)) return res.status(400).json({ error: 'Invalid campaignId' });
      if (!sees(scope, q.campaignId)) return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN_ROLE' });
      filter.campaignId = q.campaignId;
    } else if (!scope.admin) {
      filter.campaignId = { $in: [...scope.managed] };
    }
    const pauses = await PacePause.find(filter, '-window.surveyCheck').sort({ firedAt: -1 }).limit(200).lean();

    // The roster line (§G.1): a canvasser on this lead's roster blocked by a pause on a campaign the lead
    // doesn't manage. Named (the lead already sees the name on their roster), nothing about the other campaign.
    let rosterLines = [];
    if (!scope.admin && scope.managed.size) {
      const roster = await CampaignAssignment.distinct('userId', { organizationId: org._id, campaignId: { $in: [...scope.managed] } });
      const elsewhere = roster.length
        ? await PacePause.find(
            { organizationId: org._id, status: 'paused', userId: { $in: roster }, campaignId: { $nin: [...scope.managed] } },
            'userId status'
          ).lean()
        : [];
      if (elsewhere.length) {
        const m = await membersOf(org._id, elsewhere.map((p) => p.userId));
        const blocked = elsewhere.filter((p) => pauseIsBlocking(org, m.get(String(p.userId)), p));
        const uMap = await hydrateCanvassers(blocked.map((p) => p.userId), org._id);
        rosterLines = blocked.map((p) => ({ userId: String(p.userId), name: nameOf(uMap, p.userId), paused: true, elsewhere: true }));
      }
    }

    const members = await membersOf(org._id, pauses.map((p) => p.userId));
    const uMap = await hydrateCanvassers([...pauses.map((p) => p.userId), ...pauses.map((p) => p.resolvedBy).filter(Boolean)], org._id);
    const campaigns = await Campaign.find({ _id: { $in: [...new Set(pauses.map((p) => String(p.campaignId)))] }, organizationId: org._id }, 'name').lean();
    const campaignNames = new Map(campaigns.map((c) => [String(c._id), c.name]));
    res.json({
      pauses: pauses.map((p) => listItemOf(p, { org, members, uMap, campaignNames })),
      rosterLines,
      enabled: orgEnabled(org),
      live: switchCovers(org),
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// ── Settings (§H) — before /:id ─────────────────────────────────────────────────────────────────────
// Org admins only: the picker lists every admin and lead, which a lead must not see. Editing needs the admin
// role AND billing access (billingAccess is not cleared on demotion, so the role is checked too).
const canEditSettings = (req) =>
  Boolean(req.user?.isSuperAdmin) || (req.activeMembership?.role === 'admin' && req.activeMembership?.billingAccess === true);

const settingsOf = async (org, req) => {
  const fresh = await Organization.findById(org._id, 'slug isInternal pacePause').lean();
  const s = fresh?.pacePause || {};
  const eligibleMembers = await Membership.find({ organizationId: org._id, isActive: true, role: { $in: ['admin', 'lead'] } }, 'userId role billingAccess').lean();
  const chosenIds = (s.alertUserIds || []).map(String);
  const eligibleIds = new Set(eligibleMembers.map((m) => String(m.userId)));
  // A stored pick who is no longer an admin or team lead (or no longer in the org at all) is still
  // named, so the Settings page can say "Not emailed: no longer an admin or team lead" and a billing
  // admin's Save can drop them — before, such a pick was invisible and made every Save fail.
  const stale = chosenIds.filter((id) => !eligibleIds.has(id));
  const staleMembers = stale.length ? await Membership.find({ organizationId: org._id, userId: { $in: stale } }, 'userId role').lean() : [];
  const roleOf = new Map([...eligibleMembers, ...staleMembers].map((m) => [String(m.userId), m.role]));
  const uMap = await hydrateCanvassers([...eligibleMembers.map((m) => m.userId), ...stale, s.changedBy].filter(Boolean), org._id);
  return {
    enabled: s.enabled !== false,
    billingAdmins: s.billingAdmins !== false,
    alertUserIds: chosenIds,
    chosen: chosenIds.map((id) => ({ userId: id, name: nameOf(uMap, id) || 'Unknown user', role: roleOf.get(id) || null, eligible: eligibleIds.has(id) })),
    live: switchCovers(fresh),
    changedAt: s.changedAt || null,
    changedByName: nameOf(uMap, s.changedBy),
    canEdit: canEditSettings(req),
    eligible: eligibleMembers
      .map((m) => ({ userId: String(m.userId), name: nameOf(uMap, m.userId), role: m.role, billingAdmin: m.role === 'admin' && m.billingAccess === true }))
      .filter((m) => m.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
    openPauses: await PacePause.countDocuments({ organizationId: org._id, status: 'paused' }),
  };
};

router.get('/settings', async (req, res, next) => {
  try {
    const org = orgOf(req, res);
    if (!org) return;
    if (!isOrgAdmin(req)) return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN_ROLE' });
    res.json(await settingsOf(org, req));
  } catch (err) {
    next(err);
  }
});

const MAX_ALERT_USERS = 25;
const settingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    billingAdmins: z.boolean().optional(),
    alertUserIds: z.array(z.string()).max(MAX_ALERT_USERS).optional(),
  })
  .strict();

router.patch('/settings', async (req, res, next) => {
  try {
    const org = orgOf(req, res);
    if (!org) return;
    if (!isOrgAdmin(req)) return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN_ROLE' });
    if (!canEditSettings(req)) {
      return res.status(403).json({ error: 'Only a billing admin can change automatic pause.', code: 'billing-access-required' });
    }
    const data = settingsSchema.parse(req.body);
    const now = new Date();
    const by = req.user._id;
    // Dotted paths only: assigning the pacePause object would wipe its sibling fields.
    const set = { 'pacePause.changedAt': now, 'pacePause.changedBy': by };
    const unset = {};
    if (data.billingAdmins !== undefined) set['pacePause.billingAdmins'] = data.billingAdmins;
    if (data.alertUserIds !== undefined) {
      const ids = [...new Set(data.alertUserIds)];
      if (!ids.every((id) => mongoose.isValidObjectId(id))) return res.status(400).json({ error: 'Invalid user id' });
      const ok = ids.length
        ? await Membership.countDocuments({ organizationId: org._id, userId: { $in: ids }, isActive: true, role: { $in: ['admin', 'lead'] } })
        : 0;
      if (ok !== ids.length) return res.status(400).json({ error: 'Alerts can only go to active org admins and team leads.' });
      if (ids.length) set['pacePause.alertUserIds'] = ids;
      else unset['pacePause.alertUserIds'] = '';
    }
    await Organization.updateOne({ _id: org._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });

    if (data.enabled === false) {
      // Off: no checks and no blocks for this org, and anyone paused is unpaused (their restart point moves).
      const r = await Organization.updateOne({ _id: org._id, 'pacePause.enabled': { $ne: false } }, { $set: { 'pacePause.enabled': false } });
      if (r.modifiedCount) await resolveAllOpen({ organizationId: org._id, by, via: 'setting_off' });
    } else if (data.enabled === true) {
      // On: only an off → on change stamps enabledAt (restarting every count), so saving recipients never
      // does. A check still in flight when it was turned off may have created a pause: resolve leftovers first.
      const wasOff = await Organization.exists({ _id: org._id, 'pacePause.enabled': false });
      if (wasOff) {
        await resolveAllOpen({ organizationId: org._id, by, via: 'setting_off' });
        await Organization.updateOne(
          { _id: org._id, 'pacePause.enabled': false },
          { $set: { 'pacePause.enabled': true, 'pacePause.enabledAt': new Date() } }
        );
      }
    }
    res.json(await settingsOf(org, req));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// ── /:id ────────────────────────────────────────────────────────────────────────────────────────────
const loadPause = async (req, res) => {
  const org = orgOf(req, res);
  if (!org) return null;
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'Pause not found' });
    return null;
  }
  const pause = await PacePause.findOne({ _id: req.params.id, organizationId: org._id }).lean();
  if (!pause) {
    res.status(404).json({ error: 'Pause not found' });
    return null;
  }
  const scope = await viewerScope(req);
  if (!sees(scope, pause.campaignId)) {
    res.status(403).json({ error: 'You no longer manage this campaign.', code: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { org, pause, scope };
};

// A failing hop faster than any car in a neighborhood: two phones on one account do this.
const IMPLAUSIBLE_MPS = 44.7; // 100 mph

router.get('/:id', async (req, res, next) => {
  try {
    const loaded = await loadPause(req, res);
    if (!loaded) return;
    const { org, pause, scope } = loaded;
    addAuditSubjects(res, 'user', pause.userId);

    // The day as it stands now, judged live with the same rule: every door saved that day, marked.
    const range = zonedDayRange(pause.day, pause.day, pause.timeZone);
    const dayRows = await CanvassActivity.find(
      { organizationId: org._id, userId: pause.userId, timestamp: range },
      `${PACE_ROW_FIELDS.join(' ')} distanceFromHouseMeters`
    )
      .sort({ timestamp: 1, _id: 1 })
      .lean();
    const units = await loadUnitFacts(dayRows.map((r) => r.householdId));
    const config = paceConfig();
    const entries = entriesOf(dayRows);
    const verdicts = judgeVisits(visitsOf(entries, config), entries, { households: units, config }).filter(
      (v) => zonedDayStr(new Date(v.visit.first.at), pause.timeZone) === pause.day
    );
    const inWindow = new Set((pause.window || []).map((v) => String(v.activityId)));
    const firedAt = new Date(pause.firedAt).getTime();

    const hhIds = [
      ...(pause.window || []).flatMap((v) => [v.householdId, v.prevHouseholdId]),
      ...dayRows.map((r) => r.householdId),
    ].filter(Boolean).map(String);
    const households = new Map(
      (await Household.find({ _id: { $in: [...new Set(hhIds)] }, organizationId: org._id }, 'addressLine1 addressLine2 city').lean()).map((h) => [String(h._id), h])
    );
    const window = (pause.window || []).map((v) => shapeWindowVisit(v, scope, households));
    const visibleWindow = (pause.window || []).filter((v) => sees(scope, v.campaignId) && (v.prevHouseholdId == null || sees(scope, v.prevCampaignId)));
    const summary = summarize(visibleWindow);

    const dayEntries = verdicts.map((v) => {
      if (!sees(scope, v.visit.campaignId)) return { at: new Date(v.visit.first.at), otherCampaign: true };
      const mark = inWindow.has(v.visit.standingRowId)
        ? 'pause'
        : v.visit.first.at > firedAt
          ? 'after'
          : !v.judged
            ? 'not_judged'
            : v.fail
              ? 'failed'
              : 'passed';
      return {
        at: new Date(v.visit.first.at),
        householdId: v.visit.householdId,
        address: addressOf(households.get(v.visit.householdId)),
        result: v.visit.result,
        mark,
        why: v.judged ? null : v.why,
      };
    });

    const median = (xs) => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const distances = dayRows
      .filter((r) => sees(scope, r.campaignId) && r.distanceFromHouseMeters != null && JUDGED_RESULTS.has(r.reclassified?.from ?? r.actionType))
      .map((r) => r.distanceFromHouseMeters);

    const member = await Membership.findOne({ organizationId: org._id, userId: pause.userId }, 'userId role isActive').lean();
    const uMap = await hydrateCanvassers([pause.userId, pause.resolvedBy].filter(Boolean), org._id);
    const campaign = await Campaign.findOne({ _id: pause.campaignId, organizationId: org._id }, 'name').lean();
    res.json({
      id: String(pause._id),
      campaignId: String(pause.campaignId),
      campaignName: campaign?.name || '',
      userId: String(pause.userId),
      name: nameOf(uMap, pause.userId),
      status: pause.status,
      blocking: pauseIsBlocking(org, member, pause),
      memberActive: Boolean(member?.isActive) && member?.role === 'canvasser',
      firedAt: pause.firedAt,
      triggerAt: pause.triggerAt,
      day: pause.day,
      timeZone: pause.timeZone,
      config: pause.config,
      alert: pause.alert,
      resolvedAt: pause.resolvedAt,
      resolvedVia: pause.resolvedVia,
      resolvedByName: nameOf(uMap, pause.resolvedBy),
      window,
      summary,
      implausible: visibleWindow.some((v) => v.fail && v.gapSec > 0 && v.meters > 200 && v.meters / v.gapSec > IMPLAUSIBLE_MPS),
      medianDistanceFromHouseM: median(distances),
      dayEntries,
      canUnpause: pause.status === 'paused',
      canDelete: pause.status === 'resolved' && isOrgAdmin(req),
      doorOutcomesUrl: isOrgAdmin(req)
        ? `/campaigns/${pause.campaignId}/outcomes?userId=${pause.userId}&dateFrom=${pause.day}&dateTo=${pause.day}`
        : null,
      mapUrl: `/campaigns/${pause.campaignId}/map?flag=1&userId=${pause.userId}&from=${pause.day}&to=${pause.day}`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/unpause', async (req, res, next) => {
  try {
    const loaded = await loadPause(req, res);
    if (!loaded) return;
    const ok = await unpause({ pause: loaded.pause, by: req.user._id });
    if (!ok) return res.status(409).json({ error: 'This pause is no longer open.', code: 'NOT_OPEN' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const loaded = await loadPause(req, res);
    if (!loaded) return;
    if (!isOrgAdmin(req)) return res.status(403).json({ error: 'Only an org admin can delete a pause record.', code: 'FORBIDDEN_ROLE' });
    // Resolved only: an open pause is lifted with Unpause, never by deleting its record. The restart point
    // lives on the membership, so deleting this record brings nothing back.
    const r = await PacePause.deleteOne({ _id: loaded.pause._id, organizationId: loaded.org._id, status: 'resolved' });
    if (!r.deletedCount) return res.status(409).json({ error: 'Unpause it first; only a resolved pause can be deleted.', code: 'NOT_RESOLVED' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
