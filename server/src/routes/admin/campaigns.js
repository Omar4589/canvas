import { Router } from 'express';
import { NON_KNOCKED_STATUSES } from '../../services/reports/aggregations.js';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds, canManageCampaign, canManageSurvey } from '../../services/authz/campaignManagement.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Household } from '../../models/Household.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { defaultZoneForState } from '../../utils/usStateTimeZone.js';
import { usStateSchema, isoDateSchema } from '../../utils/validators.js';
import { campaignSummaries } from '../../services/reports/campaignSummaries.js';
import { recomputeCampaignStats } from '../../services/reports/campaignCounters.js';
import { resolveBillRestricted } from '../../services/reports/billRestricted.js';
import { goalProgressFor } from '../../services/reports/goalProgress.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { CoordinatorChange } from '../../models/CoordinatorChange.js';
import { hydrateCanvassers } from '../../services/reports/canvasserIdentity.js';
import { isDeleting, maybeExpireStaleDeletion, campaignHasCanvassed } from '../../services/campaigns/deletionState.js';
import { TOGGLEABLE_OUTCOMES } from '../../services/canvass/outcomeToggles.js';
import { ReclassifyRun } from '../../models/ReclassifyRun.js';
import {
  RECLASSIFIABLE_OUTCOMES,
  RECLASSIFY_MAX_IMPACT_ENTRIES,
  isRateNeutralPair,
  countConvertible,
  eligibleSources,
  eligibleTargets,
  validatePair,
  listEntries,
  resolveSelection,
  computeImpact,
  runReclassify,
  revertReclassify,
} from '../../services/canvass/reclassifyOutcomes.js';
import { Pass } from '../../models/Pass.js';
import { ImportJob } from '../../models/ImportJob.js';
import { ExportJob } from '../../models/ExportJob.js';
import { ACTIVE_STATUSES as IMPORT_ACTIVE_STATUSES } from '../../services/import/sweepStaleImports.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { bumpLive } from '../../services/platform/platformStats.js';

const router = Router();
// Team leads reach this router too, but scoped: the list returns only campaigns
// they manage, PATCH is limited to editable config, and create/archive/delete are
// gated to org admins inside the handlers below.
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['survey', 'lit_drop']),
  state: usStateSchema,
  surveyTemplateId: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  timeZone: z.string().optional(),
  // 'YYYY-MM-DD' civil-date strings (campaign timeZone); window ordering is checked
  // in the handlers so PATCH can validate against the stored other bound.
  electionDay: isoDateSchema.nullable().optional(),
  earlyVotingStart: isoDateSchema.nullable().optional(),
  earlyVotingEnd: isoDateSchema.nullable().optional(),
  datesNote: z.string().trim().max(280).optional(),
  // Door goal (billable doors) + its own deadline. goalDate is checked against the merged doc
  // in the handlers, same as the early-voting window, so a one-field PATCH validates against
  // what's already stored.
  doorGoal: z.number().int().min(1).max(10_000_000).nullable().optional(),
  goalDate: isoDateSchema.nullable().optional(),
  // TRI-STATE: null = inherit the org default, true/false = explicit override. `.nullable()`
  // is the whole point — a plain boolean would make "inherit" unexpressible from the UI.
  billRestrictedDoors: z.boolean().nullable().optional(),
  // Door outcomes turned OFF in the canvasser app. The enum is the whole gate: not_home and
  // the completion actions are not in TOGGLEABLE_OUTCOMES, so they can never be disabled.
  disabledOutcomes: z.array(z.enum(TOGGLEABLE_OUTCOMES)).optional(),
});

// A goal date with no goal is a dead field: nothing to count down to a target that doesn't
// exist. Checked on the MERGED values so clearing the goal and keeping the date is caught too.
const goalDateNeedsGoal = (doorGoal, goalDate) => Boolean(goalDate) && !(Number(doorGoal) > 0);

// Campaign fields whose edits are recorded to CampaignChange. The test is "could a silent change
// here mislead someone about money, a deadline, or what was promised?" — which is why
// `billRestrictedDoors` (moves the invoice figure) and `isActive` (archiving stops the billing
// clock) are in, alongside the goal and the key dates.
//
// `timeZone` and `surveyTemplateId` are deliberately OUT: a timezone edit already announces
// itself loudly (every day-bucketed number shifts, and the drawer warns before you do it), and
// the attached survey is visible on the campaign's own Survey tab. Logging them would put a
// harmless correction at the same weight as a halved contract number in the feed.
const AUDITED_FIELDS = [
  'doorGoal',
  'goalDate',
  'electionDay',
  'earlyVotingStart',
  'earlyVotingEnd',
  'datesNote',
  'billRestrictedDoors',
  'isActive',
  'name',
  'type',
  'state',
  // Which door outcomes canvassers can record — a silent flip changes what a client
  // report can ever show going forward, the same class of promise as the fields above.
  'disabledOutcomes',
];

// Compare-and-store form. Mongoose hands back a String object for enum/String paths and `undefined`
// for a path never set; both must compare equal to their plain/null counterparts or a no-op PATCH
// would log a phantom change. Numbers and Booleans pass through so the feed can format them.
// Arrays (disabledOutcomes) store as a SORTED comma-join: sorted so a reorder is a no-op, and
// empty ≡ never-set ≡ null so legacy docs don't log phantom rows either. Must branch before the
// String fallback — String([an, array]) would join UNsorted and log those phantoms.
function normalizeAudited(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length ? [...v].sort().join(',') : null;
  const s = String(v);
  return s === '' ? null : s;
}

const updateSchema = createSchema.partial();

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

// campaignHasCanvassed moved to services/campaigns/deletionState.js — the background
// delete processor re-checks it at claim time, and routes must not import from routes.

// Queue calls are time-bounded: ioredis buffers commands while disconnected, so without
// this a wedged/absent Redis would HANG the request rather than failing it — the 503 path
// below would be unreachable exactly when it matters (the exports enqueue pattern).
const queueOp = (promise, ms = Number(process.env.CAMPAIGN_DELETE_ENQUEUE_TIMEOUT_MS || 5000)) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('queue timeout')), ms).unref?.()),
  ]);

async function withCounts(campaigns, organizationId) {
  const ids = campaigns.map((c) => c._id);
  const [householdAgg, surveyAgg, activityAgg, summaries, goals] = await Promise.all([
    Household.aggregate([
      // isActive: true matches the canonical count in reports.js — soft-deleted
      // (voterless) doors are excluded so this list agrees with the dashboard.
      { $match: { campaignId: { $in: ids }, isActive: true } },
      { $group: { _id: { campaignId: '$campaignId', status: '$status' }, count: { $sum: 1 } } },
    ]),
    SurveyResponse.aggregate([
      { $match: { campaignId: { $in: ids } } },
      { $group: { _id: '$campaignId', count: { $sum: 1 } } },
    ]),
    CanvassActivity.aggregate([
      { $match: { campaignId: { $in: ids }, actionType: 'lit_dropped' } },
      { $group: { _id: '$campaignId', count: { $sum: 1 } } },
    ]),
    // Setup progress + management flags (setupComplete, hasCanvassed, deletable,
    // canEditType) so the Campaigns list can gate edit/archive/delete by progress.
    campaignSummaries({ organizationId, campaigns }),
    // Door-goal progress + pace. Issues NO queries at all when nothing in this list carries a
    // goal, which is the common case for an org that never sets one.
    goalProgressFor({ organizationId, campaigns }),
  ]);

  const byCampaign = new Map();
  for (const c of campaigns) {
    byCampaign.set(String(c._id), {
      households: 0,
      knocked: 0,
      surveysSubmitted: 0,
      litDropped: 0,
    });
  }
  for (const row of householdAgg) {
    const k = String(row._id.campaignId);
    const slot = byCampaign.get(k);
    if (!slot) continue;
    slot.households += row.count;
    // NOT `status !== 'unknocked'` — that swept `restricted` in, presenting doors nobody
    // could knock as "Houses knocked" (owner ruling 2026-07-29; the dashboard and rollup
    // already excluded them, so this page ran 20 points hot on a real campaign).
    if (!NON_KNOCKED_STATUSES.includes(row._id.status)) slot.knocked += row.count;
  }
  for (const row of surveyAgg) {
    const slot = byCampaign.get(String(row._id));
    if (slot) slot.surveysSubmitted = row.count;
  }
  for (const row of activityAgg) {
    const slot = byCampaign.get(String(row._id));
    if (slot) slot.litDropped = row.count;
  }
  return campaigns.map((c) => ({
    ...c,
    counts: byCampaign.get(String(c._id)) || {
      households: 0,
      knocked: 0,
      surveysSubmitted: 0,
      litDropped: 0,
    },
    // ALL-TIME and campaign-wide by construction (services/reports/goalProgress.js), unlike
    // `counts` above. null when no goal is set.
    goal: goals.get(String(c._id)) || null,
    ...(summaries.get(String(c._id)) || {}),
  }));
}

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const filter = { organizationId: activeOrgId(req) };
    // A lead sees only the campaigns they manage; admins/super see the whole org.
    if (!isOrgAdmin(req)) {
      filter._id = { $in: await managedCampaignIds(req) };
    }
    const campaigns = await Campaign.find(filter)
      .sort({ isActive: -1, createdAt: -1 })
      .populate('surveyTemplateId', 'name version')
      .lean();
    // Stuck-deletion watchdog rides this poll (the imports GET /:importId pattern): the web
    // dyno expires a run whose worker died so the row flips to failed + Retry instead of
    // reading "Deleting…" forever. Re-read on expiry so the response carries the reason.
    for (const c of campaigns) {
      if (isDeleting(c) && (await maybeExpireStaleDeletion(c))) {
        const fresh = await Campaign.findById(c._id, { deletion: 1 }).lean();
        if (fresh) c.deletion = fresh.deletion;
      }
    }
    const withMetrics = await withCounts(campaigns, activeOrgId(req));
    // Deleting campaigns ship in their OWN array, not flagged inline: ~20 client surfaces
    // (pickers, drill-in resolvers, KPI sums, mobile CampaignChip) read `campaigns` and must
    // treat a deleting campaign as gone — only the Campaigns page renders these, as
    // "Deleting…" cards (or failed + Retry). The raw deletion subdoc stays server-side.
    const live = [];
    const deleting = [];
    for (const c of withMetrics) {
      const { deletion, ...row } = c;
      if (deletion?.requestedAt) {
        deleting.push({ ...row, deletionStatus: deletion.status || 'pending', deletionError: deletion.error || null });
      } else {
        live.push(row);
      }
    }
    // The org default for the billable-door policy, so the edit drawer can LABEL what
    // "use the organization default" currently resolves to. Every campaign row already
    // carries its own tri-state override via the lean spread.
    const org = await Organization.findById(activeOrgId(req), { billRestrictedDoors: 1 }).lean();
    res.json({ campaigns: live, deletingCampaigns: deleting, orgBillRestrictedDoors: Boolean(org?.billRestrictedDoors) });
  } catch (err) {
    next(err);
  }
});

// Per-campaign change history: configuration edits (CampaignChange) merged with team
// reassignments (CoordinatorChange) into one feed, newest first.
//
// CoordinatorChange rows have existed since the re-stamp feature shipped and were readable only
// from a database console — this is the first surface that reads them. Rows written before crews
// became per-campaign carry no `campaignId` and are deliberately NOT swept in here: they are
// org-wide under the old model, and guessing which campaign they belonged to would invent history.
//
// Both sources are low-volume by nature (a campaign sees a handful of config edits and crew moves
// in its life), so the feed reads a bounded slice of each and merges in memory rather than
// carrying a cross-collection cursor. `truncated` says plainly when a cap was hit.
const HISTORY_CAP = 200;

router.get('/:campaignId/history', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    // Same gate as the PATCH that writes these rows: a lead reads the history of a campaign they
    // manage, and of no other.
    if (!(await canManageCampaign(req, req.params.campaignId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const campaign = await Campaign.findOne(
      { _id: req.params.campaignId, organizationId: orgId },
      { name: 1, createdAt: 1, createdBy: 1 }
    ).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const [configRows, teamRows] = await Promise.all([
      CampaignChange.find({ campaignId: campaign._id, organizationId: orgId })
        .sort({ createdAt: -1 })
        .limit(HISTORY_CAP)
        .lean(),
      CoordinatorChange.find({ campaignId: campaign._id, organizationId: orgId })
        .sort({ createdAt: -1 })
        .limit(HISTORY_CAP)
        .lean(),
    ]);

    // hydrateCanvassers, not a bare User.find: it never drops an id, so a change made by someone
    // since deleted or removed from the org still renders with a name and a standing instead of
    // silently losing its actor.
    const ids = [campaign.createdBy];
    for (const r of configRows) ids.push(r.byUserId);
    for (const r of teamRows) ids.push(r.byUserId, r.userId, r.fromCoordinatorId, r.toCoordinatorId);
    const people = await hydrateCanvassers(ids.filter(Boolean), orgId);
    const who = (id) => {
      if (!id) return null;
      const p = people.get(String(id));
      if (!p) return { id: String(id), name: 'Unknown user', status: 'deleted' };
      return {
        id: String(id),
        name: [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user',
        status: p.status,
      };
    };

    const items = [
      ...configRows.map((r) => ({
        id: String(r._id),
        kind: 'config',
        at: r.createdAt,
        by: who(r.byUserId),
        field: r.field,
        fromValue: r.fromValue ?? null,
        toValue: r.toValue ?? null,
      })),
      ...teamRows.map((r) => ({
        id: String(r._id),
        kind: 'team',
        at: r.createdAt,
        by: who(r.byUserId),
        user: who(r.userId),
        fromCoordinator: who(r.fromCoordinatorId),
        toCoordinator: who(r.toCoordinatorId),
        activitiesMoved: r.activitiesMoved || 0,
        surveysMoved: r.surveysMoved || 0,
        // A torn re-stamp (membership written, ledger move threw) is the one case where the
        // number on screen legitimately disagrees with the row — surface it, don't hide it.
        restampError: r.restampError || null,
      })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    res.json({
      items,
      truncated: configRows.length >= HISTORY_CAP || teamRows.length >= HISTORY_CAP,
      // Anchors the bottom of the feed, so a campaign with no edits still reads as a timeline
      // rather than an empty box.
      createdAt: campaign.createdAt,
      createdBy: who(campaign.createdBy),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    // Creating a campaign is an org-admin act — a lead is handed campaigns, not
    // allowed to spin up new ones.
    if (!isOrgAdmin(req)) return res.status(403).json({ error: 'Only an org admin can create a campaign.' });
    const orgId = activeOrgId(req);
    const data = createSchema.parse(req.body);
    // Survey template is OPTIONAL at creation — create the campaign now, attach a survey
    // later (the guard moves to round activation). If one IS supplied it must be valid.
    if (data.type === 'survey' && data.surveyTemplateId) {
      if (!mongoose.isValidObjectId(data.surveyTemplateId)) {
        return res.status(400).json({ error: 'Invalid surveyTemplateId.' });
      }
      const tmpl = await SurveyTemplate.findOne({ _id: data.surveyTemplateId, organizationId: orgId });
      if (!tmpl) return res.status(400).json({ error: 'Survey template not found in this org.' });
    }
    // Lexicographic comparison is chronological for 'YYYY-MM-DD' strings.
    if (data.earlyVotingStart && data.earlyVotingEnd && data.earlyVotingEnd < data.earlyVotingStart) {
      return res.status(400).json({ error: 'Early voting end date cannot be before the start date.' });
    }
    if (goalDateNeedsGoal(data.doorGoal, data.goalDate)) {
      return res.status(400).json({ error: 'Set a door goal before a goal date.', code: 'goal-date-without-goal' });
    }
    const campaign = await Campaign.create({
      organizationId: orgId,
      name: data.name,
      type: data.type,
      state: data.state,
      surveyTemplateId: data.type === 'survey' ? (data.surveyTemplateId || null) : null,
      isActive: data.isActive,
      // Default the timezone from the state's dominant zone (overridable in the UI).
      timeZone: data.timeZone || defaultZoneForState(data.state),
      electionDay: data.electionDay ?? null,
      earlyVotingStart: data.earlyVotingStart ?? null,
      earlyVotingEnd: data.earlyVotingEnd ?? null,
      datesNote: data.datesNote ?? '',
      doorGoal: data.doorGoal ?? null,
      goalDate: data.goalDate ?? null,
      // Undefined → null → inherit the org default. New campaigns never hard-code a value.
      billRestrictedDoors: data.billRestrictedDoors ?? null,
      // Must be wired here explicitly — Campaign.create builds from named fields, so a key
      // that only exists in createSchema would be silently dropped.
      disabledOutcomes: data.disabledOutcomes ? [...new Set(data.disabledOutcomes)] : [],
      createdBy: req.user._id,
    });
    // Lifetime marketing counter. req.subscription is attached by the entitlement middleware, so the
    // internal-org check is free here.
    await bumpLive('campaigns', 1, { isInternal: req.subscription?.status === 'internal' });
    res.status(201).json({ campaign });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:campaignId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    // Leads may only PATCH a campaign they manage; admins/super any in the org.
    if (!(await canManageCampaign(req, req.params.campaignId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = updateSchema.parse(req.body);
    // A lead is a campaign-scoped admin: they can edit their campaign's name,
    // survey, timezone and DOOR GOAL — but archiving (isActive), the type, the state,
    // the key dates, and the billable-door policy stay with org admins.
    //
    // doorGoal/goalDate are absent from this list on purpose (owner ruling 2026-08-14): a lead
    // running a campaign owns its target, even though every other date here is admin-only.
    // Do not "tidy" them in — campaignGoal.int.test.js asserts a lead can set them.
    // disabledOutcomes is absent for the same reason (owner ruling 2026-08-16): a lead running
    // a campaign owns which outcome buttons its canvassers see. disabledOutcomes.int.test.js
    // asserts a lead can set it.
    if (!isOrgAdmin(req)) {
      for (const field of ['isActive', 'type', 'state', 'electionDay', 'earlyVotingStart', 'earlyVotingEnd', 'datesNote', 'billRestrictedDoors']) {
        if (data[field] !== undefined) {
          return res.status(403).json({ error: `Only an org admin can change a campaign's ${field}.` });
        }
      }
    }
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    // Mid-delete (or failed-delete, possibly half-destroyed) campaigns take no edits —
    // the only exits from that state are Retry or the row disappearing.
    if (isDeleting(campaign)) {
      return res.status(409).json({ error: 'This campaign is being deleted.', code: 'campaign-deleting' });
    }

    // Type is locked once canvassing has started: flipping survey⇄lit_drop would
    // corrupt door-status resolution and orphan SurveyResponse rows.
    if (data.type !== undefined && data.type !== campaign.type && (await campaignHasCanvassed(campaign._id))) {
      return res.status(400).json({
        error: 'Type cannot change after canvassing has started — create a new campaign instead.',
        code: 'type-locked',
      });
    }

    // Validate the early-voting window against the MERGED values — a PATCH that
    // sets only one bound must still respect the stored other bound.
    const evStart = data.earlyVotingStart !== undefined ? data.earlyVotingStart : campaign.earlyVotingStart;
    const evEnd = data.earlyVotingEnd !== undefined ? data.earlyVotingEnd : campaign.earlyVotingEnd;
    if (evStart && evEnd && evEnd < evStart) {
      return res.status(400).json({ error: 'Early voting end date cannot be before the start date.' });
    }

    // Snapshot the audited fields BEFORE any mutation below — this is the only moment the old
    // values still exist. See AUDITED_FIELDS and the write after save().
    const beforeAudit = {};
    for (const f of AUDITED_FIELDS) beforeAudit[f] = campaign[f];

    // Same merged-value treatment for the goal pair: clearing the goal while leaving a goal
    // date stored would leave a countdown to nothing.
    const mergedGoal = data.doorGoal !== undefined ? data.doorGoal : campaign.doorGoal;
    const mergedGoalDate = data.goalDate !== undefined ? data.goalDate : campaign.goalDate;
    if (goalDateNeedsGoal(mergedGoal, mergedGoalDate)) {
      return res.status(400).json({ error: 'Set a door goal before a goal date.', code: 'goal-date-without-goal' });
    }

    if (data.name !== undefined) campaign.name = data.name;
    if (data.state !== undefined) campaign.state = data.state;
    if (data.timeZone !== undefined) campaign.timeZone = data.timeZone;
    // Explicit null clears a date.
    if (data.electionDay !== undefined) campaign.electionDay = data.electionDay;
    if (data.earlyVotingStart !== undefined) campaign.earlyVotingStart = data.earlyVotingStart;
    if (data.earlyVotingEnd !== undefined) campaign.earlyVotingEnd = data.earlyVotingEnd;
    if (data.datesNote !== undefined) campaign.datesNote = data.datesNote;
    // Explicit null clears the goal (and, with the merged check above, its date).
    if (data.doorGoal !== undefined) campaign.doorGoal = data.doorGoal;
    if (data.goalDate !== undefined) campaign.goalDate = data.goalDate;
    // Explicit null restores "inherit the org default". Deliberately NOT locked by
    // hasCanvassed like `type` is: this is a read-time reporting policy — no stored count
    // changes — so flipping it mid-campaign is legitimate and fully reversible.
    //
    // `restrictedDoorsChanged` may trigger a counter recompute AFTER the save (below). A campaign
    // that predates this feature has trusted stats with NO restrictedDoorCount, so the
    // counter-backed dashboard would report billableDoors = knocks while the live-aggregated
    // invoice export reported the real, higher number — the toggle would look broken on one
    // screen and work on another. Self-healing here beats a deploy-time migration nobody
    // remembers to run before flipping the switch.
    let restrictedDoorsChanged = false;
    if (data.billRestrictedDoors !== undefined) {
      restrictedDoorsChanged = campaign.billRestrictedDoors !== data.billRestrictedDoors;
      campaign.billRestrictedDoors = data.billRestrictedDoors;
    }
    // Wholesale array assignment — atomic, and a NEW array so the beforeAudit snapshot
    // (which holds the old array by reference) can't alias the after value. Recording
    // policy only: no counter recompute — rows already recorded keep counting.
    if (data.disabledOutcomes !== undefined) campaign.disabledOutcomes = [...new Set(data.disabledOutcomes)];
    if (data.isActive !== undefined && data.isActive !== campaign.isActive) {
      campaign.isActive = data.isActive;
      // Billing reads this: a campaign bills through its ARCHIVE month, not
      // beyond (services/billing/statement.js). Reactivating clears it.
      campaign.archivedAt = data.isActive ? null : new Date();
    }
    if (data.type !== undefined) campaign.type = data.type;
    if (data.surveyTemplateId !== undefined) {
      if (data.surveyTemplateId) {
        if (!mongoose.isValidObjectId(data.surveyTemplateId)) {
          return res.status(400).json({ error: 'Invalid surveyTemplateId.' });
        }
        const tmpl = await SurveyTemplate.findOne({
          _id: data.surveyTemplateId,
          organizationId: orgId,
        });
        if (!tmpl) return res.status(400).json({ error: 'Survey template not found in this org.' });
        // A lead attaches only what they could edit: authored, or already attached to
        // a campaign they manage. Their list (surveys.js GET /) is scoped the same
        // way, so this only fires on a hand-crafted id. Detach (null) stays free.
        if (!(await canManageSurvey(req, tmpl))) {
          return res.status(403).json({
            error: 'You can only attach a survey you authored or one already attached to a campaign you manage.',
            code: 'survey-out-of-scope',
          });
        }
      }
      campaign.surveyTemplateId = data.surveyTemplateId || null;
    }
    // No survey-required guard here — a survey campaign may exist without a template; the
    // requirement is enforced at round activation (passes.js) instead.
    await campaign.save();

    // Configuration audit trail — one row per field that actually moved. Read back by
    // GET /admin/campaigns/:campaignId/history.
    //
    // Written AFTER save on purpose: a row here must mean "this change landed", so it can never
    // be written ahead of the write it describes. The cost of that ordering is a narrow window
    // where the save commits and the insert throws, leaving one edit unlogged and the request a
    // 500 — accepted, and preferred over the alternative (logging a change a failed save never
    // made). `await`ed rather than fire-and-forget for the same reason CoordinatorChange is: an
    // audit trail that silently drops rows is not one.
    const changes = [];
    for (const f of AUDITED_FIELDS) {
      const from = normalizeAudited(beforeAudit[f]);
      const to = normalizeAudited(campaign[f]);
      if (from === to) continue;
      changes.push({
        organizationId: orgId,
        campaignId: campaign._id,
        field: f,
        fromValue: from,
        toValue: to,
        byUserId: req.user._id,
        source: 'admin_campaigns',
      });
    }
    if (changes.length) await CampaignChange.insertMany(changes);
    // Recompute ONLY on a transition INTO "restricted doors are billed" — not on every flip.
    // `stats.restrictedDoorCount` is read only while the policy resolves true, so a stale value
    // under an off policy is harmless, and the next turn-on is what repairs it. Turning the
    // setting OFF is therefore free, and an admin toggling back and forth doesn't re-aggregate
    // the ledger each time.
    //
    // The obvious cheaper guard — "skip if the field already exists" — does NOT work: an
    // unrelated .save() materializes subdoc defaults, so merely renaming a pre-feature campaign
    // stamps a WRONG restrictedDoorCount of 0 while leaving reconciledAt trusted (the same trap
    // the reconciledAt comment in models/Campaign.js documents). Nor can the field default to
    // null to make absence detectable: bumpCampaignStats $incs it on the canvasser hot path, and
    // $inc throws on null. Keying off the transition sidesteps both.
    //
    // Rare admin op → full recompute, the same hook re-cut/bulk-restrict use. swallowErrors
    // because counters are a read optimization: a failed recompute must not fail a save that
    // already committed (the next reconcile repairs it).
    if (restrictedDoorsChanged) {
      const org = await Organization.findById(orgId, { billRestrictedDoors: 1 }).lean();
      if (resolveBillRestricted(campaign, org)) {
        await recomputeCampaignStats(campaign._id, { swallowErrors: true });
      }
    }
    res.json({ campaign });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Hard delete — allowed ONLY before any canvassing (no knocks/surveys). Otherwise: archive.
// Runs as a BACKGROUND JOB on the worker dyno (services/campaigns/deleteCampaignProcessor.js):
// a 100k-door cascade takes minutes, and inline it blew Heroku's 30s router limit — the
// request 503'd while the dyno finished the delete anyway. This route stamps
// campaign.deletion, enqueues, and answers 202 in well under a second; the Campaigns page
// polls the list until the row disappears (success) or reads failed (Retry re-enters here).
router.delete('/:campaignId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    // Deleting a campaign is destructive + org-wide — org admins only.
    if (!isOrgAdmin(req)) return res.status(403).json({ error: 'Only an org admin can delete a campaign.' });
    const orgId = activeOrgId(req);
    if (!mongoose.isValidObjectId(req.params.campaignId)) {
      return res.status(400).json({ error: 'Invalid campaignId' });
    }
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Already deleting: a double-click / second tab is a harmless idempotent 202 (the stable
    // jobId dedupes in the queue too). Expire a stale run first so a dead worker's stamp
    // can't wedge the retry path; `failed` falls through to re-stamp + re-enqueue.
    if (isDeleting(campaign)) {
      const expired = await maybeExpireStaleDeletion(campaign);
      if (!expired && ['pending', 'running'].includes(campaign.deletion.status)) {
        return res.status(202).json({ queued: true });
      }
    }

    if (await campaignHasCanvassed(campaign._id)) {
      return res.status(400).json({
        error: 'This campaign has canvassing activity; archive it instead of deleting.',
        code: 'has-activity',
      });
    }

    // An import writing rows mid-cascade would orphan voters into a half-deleted campaign
    // (and a running export would read garbage) — wait jobs out rather than racing them.
    const [importBusy, exportBusy] = await Promise.all([
      ImportJob.exists({ campaignId: campaign._id, status: { $in: IMPORT_ACTIVE_STATUSES } }),
      ExportJob.exists({ campaignId: campaign._id, status: { $in: ['pending', 'running'] } }),
    ]);
    if (importBusy || exportBusy) {
      return res.status(409).json({
        error: 'An import or export is still running for this campaign — wait for it to finish, then delete.',
        code: 'campaign-busy',
      });
    }

    // If we fell through holding an existing stamp, it is (by the gate above) a failed run —
    // remember it so an enqueue failure restores the quarantine instead of silently lifting
    // it off a possibly half-deleted campaign.
    const prevDeletion = isDeleting(campaign)
      ? {
          requestedAt: campaign.deletion.requestedAt,
          requestedBy: campaign.deletion.requestedBy || null,
          status: 'failed',
          heartbeatAt: campaign.deletion.heartbeatAt || null,
          error: campaign.deletion.error || null,
        }
      : null;

    // Stamp (CAS): the $or admits a fresh request and a failed-run retry, and refuses to
    // stomp a concurrent pending/running stamp from another admin — that race is a 202 too.
    const requestedAt = new Date();
    const stamped = await Campaign.findOneAndUpdate(
      {
        _id: campaign._id,
        organizationId: orgId,
        $or: [{ 'deletion.requestedAt': null }, { 'deletion.status': 'failed' }],
      },
      {
        $set: {
          deletion: {
            requestedAt,
            requestedBy: req.user._id,
            status: 'pending',
            heartbeatAt: null,
            error: null,
          },
        },
      },
      { new: true }
    );
    if (!stamped) return res.status(202).json({ queued: true });

    try {
      await queueOp(
        getQueue(QUEUE_NAMES.CAMPAIGN_DELETE).add(
          'campaign-delete',
          { campaignId: String(campaign._id), organizationId: String(orgId) },
          // Stable id so a duplicate submit can't double-run. removeOnComplete/Fail matter:
          // a finished job squatting on this id would make the NEXT add a silent no-op —
          // which is exactly what Retry is.
          { jobId: String(campaign._id), removeOnComplete: true, removeOnFail: true }
        )
      );
    } catch (err) {
      // No wedged "Deleting…" for a job that never entered the queue: restore whatever the
      // stamp replaced (nothing for a fresh delete, the failed quarantine for a retry) and
      // say so honestly. Guarded on our own stamp so a racing worker claim is left alone.
      console.error('[campaigns] delete enqueue failed:', err?.message || err);
      await Campaign.updateOne(
        { _id: campaign._id, 'deletion.requestedAt': requestedAt, 'deletion.status': 'pending' },
        {
          $set: {
            deletion: prevDeletion || {
              requestedAt: null,
              requestedBy: null,
              status: null,
              heartbeatAt: null,
              error: null,
            },
          },
        }
      ).catch(() => {});
      return res
        .status(503)
        .json({ error: 'Could not queue the delete — try again in a moment.', code: 'queue-unavailable' });
    }

    res.status(202).json({ queued: true });
  } catch (err) {
    next(err);
  }
});

// ── Reclassifying a retired outcome's history ───────────────────────────────
// Turning an outcome off stops FUTURE recording; these three fold what was already recorded into
// another outcome. ORG ADMINS ONLY, deliberately stricter than the toggle itself (which a lead
// owns): a lead decides what their canvassers see going forward, but rewriting recorded history
// is an org-admin act. The safety argument for why this can't move a number lives in
// services/canvass/reclassifyOutcomes.js.

// Date bounds are `dateFrom`/`dateTo`, NOT from/to — those two already name the OUTCOMES being
// converted, and one body carries both.
const objectIdish = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const entryScopeSchema = z.object({
  outcomes: z.array(z.enum(RECLASSIFIABLE_OUTCOMES)).optional(),
  userId: objectIdish.optional(),
  effortId: objectIdish.optional(),
  passId: objectIdish.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const reclassifySchema = z.object({
  // Optional on a SCOPED run: the selection can span several outcomes, and each row's own origin
  // is what gets stamped. Required on a whole-outcome fold (the card), which has no selection.
  from: z.enum(RECLASSIFIABLE_OUTCOMES).optional(),
  to: z.enum(RECLASSIFIABLE_OUTCOMES),
  dryRun: z.boolean().optional(),
  scope: entryScopeSchema.optional(),
  // Narrows `scope` only — ids outside the filter are dropped, never written (the flag
  // bulk-review rule), so a stale checkbox can't reach a row the current filter doesn't show.
  actionIds: z.array(objectIdish).max(RECLASSIFY_MAX_IMPACT_ENTRIES).optional(),
});

const revertSchema = z.object({
  runId: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid run id'),
});

/** Shared preamble: org-admin gate, campaign lookup, mid-delete quarantine. */
async function loadForReclassify(req, res) {
  if (!ensureOrgScoped(req, res)) return null;
  if (!isOrgAdmin(req)) {
    res.status(403).json({ error: "Only an org admin can reclassify a campaign's recorded outcomes." });
    return null;
  }
  const campaign = await Campaign.findOne({
    _id: req.params.campaignId,
    organizationId: activeOrgId(req),
  });
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }
  if (isDeleting(campaign)) {
    res.status(409).json({ error: 'This campaign is being deleted.', code: 'campaign-deleting' });
    return null;
  }
  return campaign;
}

// What could be folded right now, and what already was. Feeds the outcomes card in one call.
router.get('/:campaignId/reclassify-outcomes', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;

    const [counts, runs] = await Promise.all([
      eligibleSources(campaign),
      ReclassifyRun.find({ campaignId: campaign._id }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    // Same identity treatment as the history feed: an actor since deleted still gets named.
    const people = await hydrateCanvassers(runs.map((r) => r.byUserId).filter(Boolean), activeOrgId(req));

    res.json({
      counts,
      targets: eligibleTargets(campaign),
      runs: runs.map((r) => {
        const p = r.byUserId ? people.get(String(r.byUserId)) : null;
        return {
          id: String(r._id),
          from: r.from,
          to: r.to,
          count: r.count,
          doorCount: r.doorCount,
          createdAt: r.createdAt,
          revertedAt: r.revertedAt,
          by: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user' : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// The Door Outcomes page's table: one filtered page of convertible entries, plus per-outcome
// totals for the whole filtered set (so the chips can show what else is in there).
router.get('/:campaignId/outcome-entries', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;

    const q = {
      outcomes: req.query.outcomes ? String(req.query.outcomes).split(',').filter(Boolean) : [],
      userId: mongoose.isValidObjectId(req.query.userId) ? req.query.userId : null,
      effortId: mongoose.isValidObjectId(req.query.effortId) ? req.query.effortId : null,
      passId: mongoose.isValidObjectId(req.query.passId) ? req.query.passId : null,
      from: req.query.dateFrom || null,
      to: req.query.dateTo || null,
    };
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const { entries, total, facets } = await listEntries(campaign._id, q, { skip, limit });
    const [people, passes] = await Promise.all([
      hydrateCanvassers(entries.map((e) => e.userId).filter(Boolean), activeOrgId(req)),
      Pass.find({ campaignId: campaign._id }, { name: 1, roundNumber: 1 }).lean(),
    ]);
    const passById = new Map(passes.map((p) => [String(p._id), p]));

    res.json({
      entries: entries.map((e) => {
        const p = e.userId ? people.get(String(e.userId)) : null;
        const pass = e.passId ? passById.get(e.passId) : null;
        return {
          ...e,
          canvasser: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user' : 'Unknown user',
          round: pass ? pass.name || `Round ${pass.roundNumber}` : null,
        };
      }),
      total,
      facets,
      limit,
      skip,
    });
  } catch (err) {
    next(err);
  }
});

// dryRun: the numbers (and the price) the confirm step shows, nothing written. Otherwise:
// convert, stamp, audit. Two shapes share this route — a SCOPED run from the Door Outcomes page
// (`scope`/`actionIds`, possibly spanning outcomes) and a whole-outcome fold from the App
// Customization card (`from` alone, deliberately id-free so it stays unbounded).
router.post('/:campaignId/reclassify-outcomes', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const { from, to, dryRun, scope, actionIds } = reclassifySchema.parse(req.body);
    const scoped = !!(scope || actionIds);

    if (scoped) {
      const q = scope
        ? { ...scope, from: scope.dateFrom, to: scope.dateTo }
        : {};
      const sel = await resolveSelection(campaign._id, q, actionIds);
      if (!sel.entries) {
        return res.status(400).json({ error: 'Nothing matches that selection.', code: 'EMPTY_SELECTION' });
      }
      // Every source in the selection must be legal against the target, one at a time — a mixed
      // selection is only as legal as its least legal row.
      for (const src of sel.sources) {
        const bad = validatePair(campaign, src, to);
        if (bad) return res.status(bad.status).json(bad.body);
      }

      const neutral = sel.sources.every((s) => isRateNeutralPair(s, to));
      if (!neutral && sel.entries > RECLASSIFY_MAX_IMPACT_ENTRIES) {
        return res.status(409).json({
          error: `That selection changes reported numbers and is too large to price in one pass (${sel.entries.toLocaleString()} entries, limit ${RECLASSIFY_MAX_IMPACT_ENTRIES.toLocaleString()}). Narrow it with the filters.`,
          code: 'SELECTION_TOO_LARGE',
        });
      }

      // Only a money-moving pair is simulated: a rate-neutral one provably moves nothing, and
      // scanning the ledger to rediscover that would put a delay in front of the common case.
      let impact = null;
      if (!neutral) {
        const org = await Organization.findById(activeOrgId(req), { billRestrictedDoors: 1 }).lean();
        impact = await computeImpact({
          campaign,
          ids: sel.ids,
          to,
          billRestricted: resolveBillRestricted(campaign, org),
        });
      }

      if (dryRun) {
        return res.json({
          dryRun: true,
          to,
          sources: sel.sources,
          entries: sel.entries,
          doors: sel.doors,
          rateNeutral: neutral,
          impact,
        });
      }

      const run = await runReclassify({
        campaign,
        from: sel.sources.length === 1 ? sel.sources[0] : 'mixed',
        to,
        ids: sel.ids,
        byUserId: req.user._id,
      });
      return res.status(201).json({
        run: {
          id: String(run._id),
          from: run.from,
          to: run.to,
          count: run.count,
          doorCount: run.doorCount,
          createdAt: run.createdAt,
          revertedAt: null,
        },
      });
    }

    if (!from) {
      return res.status(400).json({ error: 'Pick which outcome to convert.', code: 'OUTCOME_MISSING' });
    }
    const invalid = validatePair(campaign, from, to);
    if (invalid) return res.status(invalid.status).json(invalid.body);

    if (dryRun) return res.json({ dryRun: true, from, to, ...(await countConvertible(campaign._id, from)) });

    const run = await runReclassify({ campaign, from, to, byUserId: req.user._id });
    res.status(201).json({
      run: {
        id: String(run._id),
        from: run.from,
        to: run.to,
        count: run.count,
        doorCount: run.doorCount,
        createdAt: run.createdAt,
        revertedAt: null,
      },
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.post('/:campaignId/reclassify-outcomes/revert', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const { runId } = revertSchema.parse(req.body);

    // Scoped to this campaign AND org: a run id from elsewhere reads as missing, never as
    // something to undo here.
    const run = await ReclassifyRun.findOne({
      _id: runId,
      campaignId: campaign._id,
      organizationId: activeOrgId(req),
    });
    if (!run) return res.status(404).json({ error: 'Reclassification not found' });
    if (run.revertedAt) {
      return res.status(409).json({ error: 'That reclassification was already reverted.', code: 'ALREADY_REVERTED' });
    }

    await revertReclassify({ campaign, run, byUserId: req.user._id });
    res.json({ reverted: true, runId: String(run._id), revertedAt: run.revertedAt });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
