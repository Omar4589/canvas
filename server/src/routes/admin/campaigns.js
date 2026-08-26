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
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { Voter } from '../../models/Voter.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { defaultZoneForState } from '../../utils/usStateTimeZone.js';
import { usStateSchema, isoDateSchema } from '../../utils/validators.js';
import { campaignSummaries } from '../../services/reports/campaignSummaries.js';
import { recomputeCampaignStats } from '../../services/reports/campaignCounters.js';
import { resolveEntryScope, sendScopeError, ScopeError } from '../../services/canvass/entryScope.js';
import { describeScope } from '../../services/canvass/scopeSummary.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import {
  computeUnknockImpact,
  computeUnknockAnswers,
  runUnknock,
  revertUnknock,
} from '../../services/canvass/unknock.js';
import { resolveBillRestricted } from '../../services/reports/billRestricted.js';
import { goalProgressFor } from '../../services/reports/goalProgress.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { CoordinatorChange } from '../../models/CoordinatorChange.js';
import { hydrateCanvassers } from '../../services/reports/canvasserIdentity.js';
import { Effort } from '../../models/Effort.js';
import { hydrateSurveyEvidence } from '../../services/canvass/answerScope.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { csvCell, UTF8_BOM } from '../../services/export/csvWriter.js';
import { tzAbbrev } from '../../utils/timezone.js';
import { isDeleting, maybeExpireStaleDeletion, campaignHasCanvassed } from '../../services/campaigns/deletionState.js';
import { TOGGLEABLE_OUTCOMES } from '../../services/canvass/outcomeToggles.js';
import { ReclassifyRun } from '../../models/ReclassifyRun.js';
import {
  RECLASSIFIABLE_OUTCOMES,
  CONVERTIBLE_SOURCES,
  UNKNOCKABLE_SOURCES,
  RECLASSIFY_MAX_IMPACT_ENTRIES,
  isRateNeutralPair,
  countConvertible,
  eligibleSources,
  eligibleTargets,
  validatePair,
  buildEntryFilter,
  listEntries,
  resolveSelection,
  narrowSelection,
  selectionSpansDirections,
  computeImpact,
  runReclassify,
  revertReclassify,
} from '../../services/canvass/reclassifyOutcomes.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import {
  surveyConvertCap,
  MAX_VOTERS_PER_DOOR_SYNC,
  validateConversion,
  SOURCES_FOR,
  resolveSelectionTemplate,
  computeSurveyImpact,
  executeConversionRun,
  applyDoorToRun,
  closeConversionRun,
  revertConversionRun,
} from '../../services/canvass/surveyConversion.js';
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
  // CONVERTIBLE_SOURCES, not RECLASSIFIABLE_OUTCOMES: the same scope object drives the entries
  // TABLE, which lists surveyed rows so they can be handed to the survey-conversion routes below.
  // The plain reclassify path stays safe without a second schema — buildEntryFilter intersects
  // these against its own RECLASSIFIABLE_OUTCOMES default, so asking it for surveyed rows resolves
  // to an empty selection (a 400) rather than to a bare flip.
  outcomes: z.array(z.enum(CONVERTIBLE_SOURCES)).optional(),
  userId: objectIdish.optional(),
  effortId: objectIdish.optional(),
  passId: objectIdish.optional(),
  // isoDateSchema, not a bare string: these are civil 'YYYY-MM-DD' days resolved in the
  // campaign's timezone, and an unparseable one used to reach Mongoose as an Invalid Date and
  // surface as a 500. A malformed filter must refuse, never silently become "no filter" — that
  // shows MORE rows than the filter claims, and under "Select all N" writes them.
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
  // The survey-answer filter. Wire shape B — the AnswerFilters.jsx / SavedSearch shape — so the
  // picker component and answerFilterClause consume it untranslated. surveyTemplateId scopes the
  // match to the RESPONSE's template (slugs are unique only within one survey); required-with-
  // answers is enforced in resolveEntryScope, not here, so the refusal carries a real code.
  surveyTemplateId: objectIdish.optional(),
  answerFilters: z
    .array(
      z.object({
        questionKey: z.string().min(1),
        values: z.array(z.string()).max(200).default([]),
        texts: z.array(z.string()).max(200).optional(),
      })
    )
    .max(25)
    .optional(),
  answerTagFilters: z.array(z.object({ tag: z.string().min(1) })).max(25).optional(),
  // Address search — resolved to door ids inside resolveEntryScope (it NARROWS, so it must ride
  // the scope every write re-resolves, never be a table-only nicety).
  search: z.string().trim().min(1).max(120).optional(),
});

/**
 * The entries table's query string as the SAME wire scope the POST bodies carry.
 *
 * Empty keys are omitted rather than passed as '' so every field can stay `.optional()` — an
 * empty string would fail objectIdish and refuse a request that simply isn't filtering.
 */
const scopeFromQuery = (query = {}) => {
  const out = {};
  const outcomes = query.outcomes ? String(query.outcomes).split(',').filter(Boolean) : [];
  if (outcomes.length) out.outcomes = outcomes;
  for (const k of ['userId', 'effortId', 'passId', 'dateFrom', 'dateTo', 'surveyTemplateId', 'search']) {
    if (query[k]) out[k] = String(query[k]);
  }
  // The two structured filters ride the query string as JSON (the client derives them from the
  // same scope object the POST bodies carry). A parse failure REFUSES — never "no filter".
  for (const k of ['answerFilters', 'answerTagFilters']) {
    if (!query[k]) continue;
    try {
      out[k] = JSON.parse(String(query[k]));
    } catch {
      throw new ScopeError(400, 'INVALID_SCOPE', "That filter isn't readable — reload the page and try again.");
    }
  }
  return out;
};

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

// Unknock takes no `to`: it has no target outcome, which is the whole point — the entry stops
// existing rather than becoming something else.
const unknockSchema = z.object({
  dryRun: z.boolean().optional(),
  scope: entryScopeSchema.optional(),
  actionIds: z.array(objectIdish).max(RECLASSIFY_MAX_IMPACT_ENTRIES).optional(),
});

// Never ships `activities` — the frozen originals can be 25k documents (the same rule the
// exports list follows for its subject ids).
const unknockWire = (r) => ({
  id: String(r._id),
  status: r.status,
  counts: r.counts,
  scopeSummary: r.scopeSummary || null,
  byIds: !!r.selection?.byIds,
  createdAt: r.createdAt,
  revertedAt: r.revertedAt,
});

const revertSchema = z.object({
  runId: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid run id'),
});

/**
 * Address / canvasser / round hydration for a page of stamped activity rows — the outcome-entries
 * treatment, shared by the run-detail endpoints so all three lists read identically.
 */
async function hydrateRunEntries(req, campaign, rows) {
  const doorIds = [...new Set(rows.map((r) => String(r.householdId)))];
  const [doors, people, passes] = await Promise.all([
    Household.find({ _id: { $in: doorIds } }, { addressLine1: 1, unit: 1, city: 1 }).lean(),
    hydrateCanvassers(rows.map((r) => r.userId).filter(Boolean), activeOrgId(req)),
    Pass.find({ campaignId: campaign._id }, { name: 1, roundNumber: 1 }).lean(),
  ]);
  const doorById = new Map(doors.map((d) => [String(d._id), d]));
  const passById = new Map(passes.map((p) => [String(p._id), p]));
  return {
    entries: rows.map((r) => {
      const d = doorById.get(String(r.householdId));
      const p = r.userId ? people.get(String(r.userId)) : null;
      const pass = r.passId ? passById.get(String(r.passId)) : null;
      return {
        id: String(r._id),
        address: d ? [d.addressLine1, d.unit ? `#${d.unit}` : null].filter(Boolean).join(' ') : '(door removed)',
        city: d?.city || '',
        from: r.reclassified?.from || null,
        to: r.actionType,
        canvasser: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user' : 'Unknown user',
        round: pass ? pass.name || `Round ${pass.roundNumber}` : null,
        timestamp: r.timestamp,
      };
    }),
  };
}

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
          scopeSummary: r.scopeSummary || null,
          byIds: !!r.selection?.byIds,
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

    // Through the SAME schema the POST bodies use, so the table and the write cannot disagree
    // about what a scope means. It also replaces the old `isValidObjectId(x) ? x : null` reads,
    // which turned a malformed filter into NO filter — listing more rows than the filter claimed.
    const scope = entryScopeSchema.parse(scopeFromQuery(req.query));
    const q = await resolveEntryScope(campaign, scope);
    // Whitelisted sorts only, each with the `_id` tiebreaker (Mongo gives ties no stable order
    // across separate skip/limit queries — pages duplicate or drop rows without it). Anything
    // else falls back to newest; the selection paths never sort — a selection is a SET.
    const SORTS = {
      newest: { timestamp: -1, _id: 1 },
      oldest: { timestamp: 1, _id: 1 },
    };
    const sort = SORTS[req.query.sort] || SORTS.newest;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    // CONVERTIBLE_SOURCES so surveyed rows are listable and selectable — they route to the
    // survey-conversion endpoints, which can archive their answers, rather than to the plain
    // reclassify POST, which still refuses them.
    const { entries, total, doors, facets, sources } = await listEntries(campaign._id, q, {
      skip,
      limit,
      outcomes: CONVERTIBLE_SOURCES,
      sort,
    });
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
      doors,
      facets,
      // What the matching set is MADE OF. The client reads the selection's direction off this
      // under "select all N" instead of guessing from which chips happen to be ticked — the
      // guess broke the moment an answer filter could imply Surveyed without the chip.
      sources,
      limit,
      skip,
      // Present only under their filters. `truncated` on either means the resolution hit its
      // cap, so `total` is a LOWER BOUND — the client renders "N+" and withdraws "Select all N
      // matching", whose entire meaning is that N is the truth.
      ...(q.answerScope ? { answerScope: q.answerScope } : {}),
      ...(q.searchScope ? { searchScope: q.searchScope } : {}),
      ...(q.answerScope?.truncated || q.searchScope?.truncated ? { totalIsLowerBound: true } : {}),
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

// The filtered table as a file — the fraud journey's deliverable ("here is exactly what we are
// removing, and from whom"). A DIRECT-download CSV on the voters-by-answer.csv pattern, not an
// Export Center registry type: correction batches cap at 25k entries, half this route's cap, and
// the direct shape inherits the page's exact scope semantics for free — the same entryScopeSchema,
// one resolveEntryScope, the same buildEntryFilter behind the same __resolved throw, so the file
// can never disagree with the table that previewed it. Registry treatment (background job, GridFS
// artifact) buys nothing at this size.
router.get('/:campaignId/outcome-entries.csv', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;

    const scope = entryScopeSchema.parse(scopeFromQuery(req.query));
    const q = await resolveEntryScope(campaign, scope);
    const EXPORT_CAP = 50000;
    const tz = campaign.timeZone || req.activeOrg?.timeZone || 'America/New_York';

    const rows = await CanvassActivity.find(
      buildEntryFilter(campaign._id, q, CONVERTIBLE_SOURCES),
      { householdId: 1, actionType: 1, userId: 1, timestamp: 1, passId: 1, effortId: 1 }
    )
      .sort({ timestamp: -1, _id: 1 })
      .limit(EXPORT_CAP)
      .lean();

    const [doors, people, passes, efforts, surveyByRow] = await Promise.all([
      Household.find(
        { _id: { $in: [...new Set(rows.map((r) => String(r.householdId)))] } },
        { addressLine1: 1, unit: 1, city: 1, state: 1, zipCode: 1 }
      ).lean(),
      hydrateCanvassers(rows.map((r) => r.userId).filter(Boolean), activeOrgId(req)),
      Pass.find({ campaignId: campaign._id }, { name: 1, roundNumber: 1 }).lean(),
      Effort.find({ campaignId: campaign._id }, { name: 1 }).lean(),
      // Uncapped, id-carrying survey evidence: the file lists every voter whose answers a
      // conversion of these rows would take, with their DNC standing — the record-of-past-contact
      // posture voters-by-answer.csv uses (rows stay, marked), never a silent drop.
      hydrateSurveyEvidence(rows, q, { matchedCap: Infinity, namesCap: Infinity, withVoterDetail: true }),
    ]);
    const doorById = new Map(doors.map((d) => [String(d._id), d]));
    const passById = new Map(passes.map((p) => [String(p._id), p]));
    const effortById = new Map(efforts.map((e) => [String(e._id), e]));

    // Record-level audit: an export's subjects are what was actually WRITTEN to the file — every
    // door row, plus every voter the survey evidence names (middleware/accessLog.js persists them
    // for staff access under a grant).
    addAuditSubjects(res, 'household', [...new Set(rows.map((r) => String(r.householdId)))]);
    const namedVoterIds = new Set();
    for (const ev of surveyByRow.values()) {
      for (const m of ev.matched) namedVoterIds.add(m.voterId);
      for (const o of ev.others) namedVoterIds.add(o.voterId);
    }
    addAuditSubjects(res, 'voter', [...namedVoterIds]);

    const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const headers = [
      'Recorded (ISO)', 'Date', `Time (${tzAbbrev(tz) || tz})`,
      'Address', 'Unit', 'City', 'State', 'Zip',
      'Outcome', 'Canvasser', 'Round', 'Walk list',
      'Voters at visit', 'Answers at visit', 'Matched voters', 'Matched answers', 'Do not contact',
    ];
    const lines = [headers.map(csvCell).join(',')];
    for (const r of rows) {
      const d = doorById.get(String(r.householdId));
      const person = r.userId ? people.get(String(r.userId)) : null;
      const pass = r.passId ? passById.get(String(r.passId)) : null;
      const ev = surveyByRow.get(String(r._id));
      const allNamed = ev ? [...ev.matched, ...ev.others] : [];
      lines.push(
        [
          r.timestamp ? new Date(r.timestamp).toISOString() : '',
          r.timestamp ? dateFmt.format(new Date(r.timestamp)) : '',
          r.timestamp ? timeFmt.format(new Date(r.timestamp)) : '',
          d?.addressLine1 || '(door removed)',
          d?.unit || '',
          d?.city || '',
          d?.state || '',
          d?.zipCode || '',
          r.actionType,
          person ? [person.firstName, person.lastName].filter(Boolean).join(' ') || 'Unknown user' : 'Unknown user',
          pass ? pass.name || `Round ${pass.roundNumber}` : '',
          r.effortId ? effortById.get(String(r.effortId))?.name || '' : '',
          ev ? ev.voters : '',
          ev ? ev.answers : '',
          ev ? ev.matched.map((m) => m.voterName).join('; ') : '',
          ev ? ev.matched.map((m) => m.answers.map((a) => a.text).join(' / ')).join('; ') : '',
          allNamed.filter((v) => v.dnc).map((v) => v.voterName || v.name).join('; '),
        ].map(csvCell).join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="door-outcomes-${campaign._id}-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    // Buffered on purpose (the voters-by-answer.csv shape): the access log's finish listener can
    // then record honest row counts, and the cap above bounds the buffer.
    res.send(UTF8_BOM + lines.join('\r\n'));
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (sendScopeError(res, err)) return;
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
      const q = await resolveEntryScope(campaign, scope || {});
      // A truncated answer scope refuses the FILTER-scoped write: the resolution is an arbitrary
      // cap-sized subset of what the admin described, so writing it would write something nobody
      // saw. An id-scoped write stays legal — the table only renders rows inside the resolved
      // set, so a ticked row is by construction inside it.
      if (q.answerScope?.truncated && !actionIds?.length) {
        return res.status(409).json({
          error: `That answer filter matches more than ${q.answerScope.cap.toLocaleString()} answers — narrow it with a canvasser, round, walk list or date range before converting.`,
          code: 'ANSWER_SCOPE_TRUNCATED',
        });
      }
      // Same invariant for the address search: a truncated resolution is an arbitrary cap-sized
      // subset of what the admin described — never a write scope.
      if (q.searchScope?.truncated && !actionIds?.length) {
        return res.status(409).json({
          error: `That address search matches more than ${q.searchScope.cap.toLocaleString()} doors — narrow it before converting, or tick the rows you mean.`,
          code: 'SEARCH_SCOPE_TRUNCATED',
        });
      }
      // Resolve WIDE first: a selection straddling the surveyed boundary used to be silently
      // truncated here (this path kept only the door outcomes), so the bar said 12 and the run
      // wrote 10. Refuse it instead, then narrow to this path's legal sources — provably the
      // same set the old RECLASSIFIABLE-scoped resolution produced.
      const wide = await resolveSelection(campaign._id, q, actionIds, CONVERTIBLE_SOURCES);
      if (selectionSpansDirections(wide)) {
        return res.status(409).json({
          error:
            'That selection mixes surveyed entries with door outcomes, and the two are corrected by different tools. Filter to one side — the Surveyed chip on or off — and convert each separately.',
          code: 'SELECTION_SPANS_DIRECTIONS',
        });
      }
      const sel = narrowSelection(wide, RECLASSIFIABLE_OUTCOMES);
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
        selection: { scope: scope || {}, byIds: !!actionIds?.length },
        scopeSummary: await describeScope(campaign, scope || {}),
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
    if (sendScopeError(res, err)) return;
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

// UNKNOCK — strike entries from the record so the doors read `unknocked` again and can be knocked
// for real, in the round they are already in. The one Door Outcomes act that REMOVES rows: a
// relabel leaves a fabricated knock counted and billed, and only frees the door for the next
// round's cut. See services/canvass/unknock.js for the freeze-first safety model.
router.post('/:campaignId/unknock-entries', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const { dryRun, scope, actionIds } = unknockSchema.parse(req.body);

    const q = await resolveEntryScope(campaign, scope || {});
    // A truncated resolution is an arbitrary cap-sized subset of what the admin described — never
    // a write scope, and least of all for the write that deletes. Same rule as the other paths.
    if (q.answerScope?.truncated && !actionIds?.length) {
      return res.status(409).json({
        error: `That answer filter matches more than ${q.answerScope.cap.toLocaleString()} answers — narrow it before unknocking.`,
        code: 'ANSWER_SCOPE_TRUNCATED',
      });
    }
    if (q.searchScope?.truncated && !actionIds?.length) {
      return res.status(409).json({
        error: `That address search matches more than ${q.searchScope.cap.toLocaleString()} doors — narrow it before unknocking, or tick the rows you mean.`,
        code: 'SEARCH_SCOPE_TRUNCATED',
      });
    }

    // UNKNOCKABLE_SOURCES, not CONVERTIBLE_SOURCES: `lit_dropped` is excluded from the RELABEL
    // path because a completion action carries data a bare flip would fabricate or orphan — but a
    // delete fabricates nothing, and a faked lit drop is a billable knock that needs no answers to
    // invent, so it is the EASIEST entry to fake. Leaving it out would mean lit-drop campaigns had
    // no fraud cleanup at all.
    //
    // And deliberately NO selectionSpansDirections check: unknock has no direction, so a selection
    // mixing surveyed rows with door outcomes is the normal fraud batch, not a contradiction —
    // every one of them is an entry that should not exist.
    const sel = await resolveSelection(campaign._id, q, actionIds || null, UNKNOCKABLE_SOURCES);
    if (!sel.entries) {
      return res.status(400).json({ error: 'Nothing matches that selection.', code: 'EMPTY_SELECTION' });
    }
    if (sel.entries > RECLASSIFY_MAX_IMPACT_ENTRIES) {
      return res.status(409).json({
        error: `That's ${sel.entries.toLocaleString()} entries — narrow the filter to ${RECLASSIFY_MAX_IMPACT_ENTRIES.toLocaleString()} or fewer.`,
        code: 'SELECTION_TOO_LARGE',
      });
    }

    const org = await Organization.findById(activeOrgId(req), { billRestrictedDoors: 1 }).lean();
    const billRestricted = resolveBillRestricted(campaign, org);
    const [impact, survey] = await Promise.all([
      computeUnknockImpact({ campaign, ids: sel.ids, billRestricted }),
      computeUnknockAnswers({ rows: sel.rows }),
    ]);

    if (dryRun) {
      // Rows this scope matches but CANNOT take: a row an earlier correction run already stamped
      // is out of scope everywhere (convertibleMatch's single-level provenance rule), and that is
      // exactly the population most likely to need unknocking — fraud somebody already "cleaned"
      // with the relabel tool, which left the knock billed. Without this count the admin sees a
      // smaller number than they expect and nothing says why.
      const heldByRuns = await CanvassActivity.countDocuments({
        campaignId: campaign._id,
        actionType: { $in: UNKNOCKABLE_SOURCES },
        via: { $ne: 'bulk' },
        reclassified: { $exists: true },
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.passId ? { passId: q.passId } : {}),
        ...(q.effortId ? { effortId: q.effortId } : {}),
        ...(q.timestamp ? { timestamp: q.timestamp } : {}),
      });
      // Doors that will NOT read unknocked afterwards, because rows outside the selection
      // survive there — an older outcome the chips filtered away, another canvasser's visit, or
      // a desk restrict mark (which correctly keeps the door reading `restricted`). The promise
      // on the button is "knock them again"; this is the honest asterisk on it.
      const stillRecorded = await CanvassActivity.distinct('householdId', {
        campaignId: campaign._id,
        householdId: { $in: sel.householdIds },
        _id: { $nin: sel.ids },
        actionType: { $ne: 'note_added' },
      });
      return res.json({
        dryRun: true,
        entries: sel.entries,
        doors: sel.doors,
        sources: sel.sources,
        impact,
        survey,
        heldByRuns,
        doorsStillRecorded: stillRecorded.length,
      });
    }

    const run = await runUnknock({
      campaign,
      rows: sel.rows,
      byUserId: req.user._id,
      scope: scope || {},
      byIds: !!actionIds?.length,
      scopeSummary: await describeScope(campaign, scope || {}),
    });
    return res.status(201).json({ run: unknockWire(run) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

// The runs list — rendered beside the reclassify and conversion runs, because from an admin's
// point of view they are the same act at different depths.
router.get('/:campaignId/unknock-entries', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const runs = await UnknockRun.find({ campaignId: campaign._id })
      // The frozen originals can be 25k documents — never ship them on a list.
      .select('-activities')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const people = await hydrateCanvassers(runs.map((r) => r.byUserId).filter(Boolean), activeOrgId(req));
    res.json({
      runs: runs.map((r) => {
        const p = r.byUserId ? people.get(String(r.byUserId)) : null;
        return {
          ...unknockWire(r),
          by: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user' : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:campaignId/unknock-entries/revert', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const { runId } = revertSchema.parse(req.body);
    const run = await UnknockRun.findOne({ _id: runId, campaignId: campaign._id });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.revertedAt) {
      return res.status(409).json({ error: 'That unknock was already undone.', code: 'ALREADY_REVERTED' });
    }
    // A `pending` run crashed between freezing and deleting: its rows may still be live, so
    // "restoring" them would raw-insert duplicates of rows that never left. Undo is for a run
    // that actually landed. (This inverts runReclassify's stamp-first ordering out of necessity —
    // you cannot freeze a deleted row — so the status field carries the guarantee instead.)
    if (run.status !== 'completed') {
      return res.status(409).json({
        error: 'That unknock did not finish, so there is nothing to undo — its entries were never removed.',
        code: 'RUN_NOT_COMPLETED',
      });
    }
    const reverted = await revertUnknock({ campaign, run, byUserId: req.user._id });
    res.json({ run: unknockWire(reverted) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// The exact rows one reclassify run changed — read off the stamps, which are the run's own
// record. Honest limitation, stated to the client rather than papered over: REVERT REMOVES THE
// STAMPS (that is what makes provenance single-level and revert exact), so a reverted run has no
// per-row detail left. The summary row survives; the itemization does not.
router.get('/:campaignId/reclassify-outcomes/:runId/entries', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    if (!mongoose.isValidObjectId(req.params.runId)) {
      return res.status(404).json({ error: 'Reclassification not found' });
    }
    const run = await ReclassifyRun.findOne({
      _id: req.params.runId,
      campaignId: campaign._id,
      organizationId: activeOrgId(req),
    }).lean();
    if (!run) return res.status(404).json({ error: 'Reclassification not found' });
    if (run.revertedAt) {
      return res.json({ reverted: true, to: run.to, entries: [], total: 0, limit: 0, skip: 0 });
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    // kind-scoped for legibility (run ids can't collide across collections, but the intent should
    // read) — the same guard revertReclassify uses.
    const filter = {
      campaignId: campaign._id,
      'reclassified.runId': run._id,
      'reclassified.kind': { $in: [null, 'outcome'] },
    };
    const [rows, total] = await Promise.all([
      CanvassActivity.find(filter, {
        householdId: 1, actionType: 1, userId: 1, passId: 1, timestamp: 1, 'reclassified.from': 1,
      })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CanvassActivity.countDocuments(filter),
    ]);
    res.json({ reverted: false, to: run.to, ...(await hydrateRunEntries(req, campaign, rows)), total, limit, skip });
  } catch (err) {
    next(err);
  }
});

// ── Converting a door outcome to/from Surveyed ──────────────────────────────
// The Surveyed direction of the same page. Same org-admin gate (loadForReclassify), same
// scope+actionIds selection, same price-before-you-run rule — but it also writes real survey
// answers, so it carries its own service, its own run doc and its own queue. The reason the plain
// reclassify route above still REFUSES these outcomes is not squeamishness: it has no answer
// composer and no archive, so a bare flip there would fabricate or orphan answers.
// See services/canvass/surveyConversion.js.

const answerInputSchema = z.object({
  questionKey: z.string().min(1),
  questionLabel: z.string().optional(),
  answer: z.any().optional(),
  optionIds: z.array(z.string()).optional(),
  otherText: z.string().nullable().optional(),
});

const conversionSchema = z.object({
  direction: z.enum(['to_survey', 'from_survey']),
  mode: z.enum(['bulk', 'single', 'queue']).default('bulk'),
  // 'survey_submitted' going in; a door outcome coming back out. Validated per-direction in
  // validateConversion, which is also where the retired-target rule lives.
  to: z.string(),
  dryRun: z.boolean().optional(),
  scope: entryScopeSchema.optional(),
  actionIds: z.array(objectIdish).max(RECLASSIFY_MAX_IMPACT_ENTRIES).optional(),
  // The one answer set a bulk run replays for every eligible voter. Empty for single/queue, where
  // each door carries its own.
  answers: z.array(answerInputSchema).optional(),
  note: z.string().max(2000).nullable().optional(),
});

const doorApplySchema = z.object({
  actionId: objectIdish,
  // { [voterId]: { answers, note } | null } — absent or null means "leave this voter alone",
  // which is how the per-voter skip checkboxes work.
  voterPlans: z
    .record(
      z.string(),
      z
        .object({ answers: z.array(answerInputSchema).optional(), note: z.string().max(2000).nullable().optional() })
        .nullable()
    )
    .optional(),
});

/** Load a run scoped to this campaign AND org — a foreign run id reads as 404, never as ours. */
async function loadRun(req, res, campaign) {
  if (!mongoose.isValidObjectId(req.params.runId)) {
    res.status(404).json({ error: 'Conversion not found' });
    return null;
  }
  const run = await SurveyConversionRun.findOne({
    _id: req.params.runId,
    campaignId: campaign._id,
    organizationId: activeOrgId(req),
  });
  if (!run) {
    res.status(404).json({ error: 'Conversion not found' });
    return null;
  }
  return run;
}

const runWire = (r, by = null) => ({
  id: String(r._id),
  direction: r.direction,
  mode: r.mode,
  sources: r.sources,
  to: r.to,
  status: r.status,
  progress: r.progress,
  counts: r.counts,
  samples: (r.samples || []).map((s) => ({ voterId: String(s.voterId), voterName: s.voterName, reason: s.reason })),
  samplesTruncated: r.samplesTruncated,
  samplesTotal: r.samplesTotal,
  surveyTemplateId: r.surveyTemplateId ? String(r.surveyTemplateId) : null,
  scopeSummary: r.scopeSummary || null,
  byIds: !!r.selection?.byIds,
  // null means NOT LOADED, never "none left" — the walkthrough distinguishes the two, because
  // treating null as an empty queue is what made a fresh session close itself instantly.
  doorsRemaining: null,
  error: r.error,
  createdAt: r.createdAt,
  completedAt: r.completedAt,
  revertedAt: r.revertedAt,
  by,
});

// The template the composer must be built against, resolved from the SELECTION rather than from
// the campaign — per-effort survey overrides mean "the campaign's survey" has no single answer.
router.post('/:campaignId/survey-conversions/template', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const body = conversionSchema.partial({ direction: true, to: true }).parse(req.body);

    const q = await resolveEntryScope(campaign, body.scope || {});
    const wide = await resolveSelection(campaign._id, q, body.actionIds || null, CONVERTIBLE_SOURCES);
    if (selectionSpansDirections(wide)) {
      return res.status(409).json({
        error:
          'That selection mixes surveyed entries with door outcomes, and the two are corrected by different tools. Filter to one side — the Surveyed chip on or off — and convert each separately.',
        code: 'SELECTION_SPANS_DIRECTIONS',
      });
    }
    const sel = narrowSelection(wide, SOURCES_FOR('to_survey'));
    if (!sel.entries) {
      return res.status(400).json({ error: 'Nothing is selected.', code: 'EMPTY_SELECTION' });
    }
    const { template, error } = await resolveSelectionTemplate(campaign, sel.householdIds);
    if (error) return res.status(error.status).json(error.body);

    res.json({
      template: {
        id: String(template._id),
        name: template.name,
        version: template.version,
        intro: template.intro,
        questions: template.questions,
      },
      entries: sel.entries,
      doors: sel.doors,
      sources: sel.sources,
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

// dryRun: the full price — the campaign's own before/after AND the response-ledger consequences
// (how many answers get created or archived, and every voter we will NOT touch). Otherwise: create
// the run and either enqueue it (bulk) or hand it back open for door-by-door entry.
router.post('/:campaignId/survey-conversions', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const body = conversionSchema.parse(req.body);

    const invalid = validateConversion(campaign, body);
    if (invalid) return res.status(invalid.status).json(invalid.body);

    const q = await resolveEntryScope(campaign, body.scope || {});
    // Same rule as the reclassify write: a truncated answer scope may only be acted on by ids.
    if (q.answerScope?.truncated && !body.actionIds?.length) {
      return res.status(409).json({
        error: `That answer filter matches more than ${q.answerScope.cap.toLocaleString()} answers — narrow it with a canvasser, round, walk list or date range before converting.`,
        code: 'ANSWER_SCOPE_TRUNCATED',
      });
    }
    if (q.searchScope?.truncated && !body.actionIds?.length) {
      return res.status(409).json({
        error: `That address search matches more than ${q.searchScope.cap.toLocaleString()} doors — narrow it before converting, or tick the rows you mean.`,
        code: 'SEARCH_SCOPE_TRUNCATED',
      });
    }
    const wide = await resolveSelection(campaign._id, q, body.actionIds || null, CONVERTIBLE_SOURCES);
    if (selectionSpansDirections(wide)) {
      return res.status(409).json({
        error:
          'That selection mixes surveyed entries with door outcomes, and the two are corrected by different tools. Filter to one side — the Surveyed chip on or off — and convert each separately.',
        code: 'SELECTION_SPANS_DIRECTIONS',
      });
    }
    const sel = narrowSelection(wide, SOURCES_FOR(body.direction));
    if (!sel.entries) {
      return res.status(400).json({ error: 'Nothing is selected.', code: 'EMPTY_SELECTION' });
    }
    if (sel.entries > RECLASSIFY_MAX_IMPACT_ENTRIES) {
      return res.status(409).json({
        error: `That's ${sel.entries.toLocaleString()} entries — narrow the filter to ${RECLASSIFY_MAX_IMPACT_ENTRIES.toLocaleString()} or fewer.`,
        code: 'SELECTION_TOO_LARGE',
      });
    }

    let template = null;
    if (body.direction === 'to_survey') {
      const resolved = await resolveSelectionTemplate(campaign, sel.householdIds);
      if (resolved.error) return res.status(resolved.error.status).json(resolved.error.body);
      template = resolved.template;
    }

    const org = await Organization.findById(activeOrgId(req), { billRestrictedDoors: 1 }).lean();
    const billRestricted = resolveBillRestricted(campaign, org);
    const [impact, survey] = await Promise.all([
      computeImpact({ campaign, ids: sel.ids, to: body.to, billRestricted }),
      computeSurveyImpact({ campaign, rows: sel.rows, direction: body.direction, answerMatch: q.answerMatch }),
    ]);

    if (body.direction === 'to_survey' && survey.responsesToCreate > surveyConvertCap()) {
      return res.status(409).json({
        error: `That would create ${survey.responsesToCreate.toLocaleString()} survey responses — narrow the selection to ${surveyConvertCap().toLocaleString()} or fewer.`,
        code: 'TOO_MANY_RESPONSES',
      });
    }
    // The reverse direction had NO volume guard — only the forward one did — so past the read
    // cap the preview reported responsesToArchive/manifestTotal as totals when they were silent
    // lower bounds, and entriesNoResponses over-counted rows whose responses fell outside the
    // capped read. Refusing here (before the dryRun return, like its twin above) means the
    // truncated numbers never render at all.
    if (body.direction === 'from_survey' && survey.responsesToArchive > surveyConvertCap()) {
      return res.status(409).json({
        error: `That would remove more than ${surveyConvertCap().toLocaleString()} survey answers in one change — narrow the selection and remove them in parts.`,
        code: 'TOO_MANY_RESPONSES',
      });
    }
    if (body.mode !== 'bulk' && sel.doors === 1) {
      const perDoor = survey.votersEligible ?? 0;
      if (perDoor > MAX_VOTERS_PER_DOOR_SYNC) {
        return res.status(409).json({
          error: `That door has ${perDoor} voters — more than this tool records in one go.`,
          code: 'TOO_MANY_VOTERS_AT_DOOR',
        });
      }
    }

    if (body.dryRun) {
      return res.json({
        dryRun: true,
        direction: body.direction,
        to: body.to,
        sources: sel.sources,
        entries: sel.entries,
        doors: sel.doors,
        // A conversion touching a completion action is NEVER rate-neutral — it always moves the
        // survey rate at minimum — so the confirm step always shows the figures in red.
        rateNeutral: false,
        impact,
        survey,
        template: template
          ? { id: String(template._id), name: template.name, version: template.version, questions: template.questions }
          : null,
      });
    }

    const run = await SurveyConversionRun.create({
      organizationId: campaign.organizationId,
      campaignId: campaign._id,
      byUserId: req.user._id,
      direction: body.direction,
      mode: body.mode,
      sources: sel.sources,
      to: body.to,
      surveyTemplateId: template?._id || null,
      surveyTemplateVersion: template?.version ?? null,
      answers: body.mode === 'bulk' && template ? (body.answers || []) : [],
      note: body.note ?? null,
      selection: { scope: body.scope || {}, actionIds: sel.ids, byIds: !!body.actionIds?.length },
      scopeSummary: await describeScope(campaign, body.scope || {}),
      // A door-by-door session stays OPEN between steps; a bulk run goes straight to the worker.
      status: body.mode === 'bulk' ? 'pending' : 'open',
      progress: { phase: null, pct: 0, doorsDone: 0, doorsTotal: sel.doors },
      counts: { entriesTargeted: sel.entries, doorsTargeted: sel.doors },
    });

    // ...and with the survey attached, for the same reason.
    // A queue session must come back USABLE from the call that creates it. At creation nothing is
    // stamped yet, so the remaining set IS the whole selection — no extra query, and no dependence
    // on the client making a second call before it can render the first door.
    const created = runWire(run);
    if (body.mode === 'queue') {
      created.doorsRemaining = sel.ids.map(String);
      created.template = template
        ? { id: String(template._id), name: template.name, version: template.version, intro: template.intro, questions: template.questions }
        : null;
    }

    if (body.mode === 'bulk') {
      // Time-bounded like every other enqueue in this file: ioredis buffers commands while
      // disconnected, so an unbounded .add() would HANG the request against a wedged Redis. The run
      // doc already exists and is stamped `pending`, so a failed enqueue is recoverable — Resume
      // re-enqueues it — rather than a lost request.
      try {
        const job = await queueOp(
          getQueue(QUEUE_NAMES.OUTCOME_CONVERT).add('convert', { runId: String(run._id) }),
          Number(process.env.OUTCOME_CONVERT_ENQUEUE_TIMEOUT_MS || 5000)
        );
        run.queueJobId = String(job.id);
        await run.save();
      } catch {
        run.status = 'failed';
        run.error = 'Could not start the conversion. Nothing has been changed — press Resume to try again.';
        await run.save();
        return res.status(503).json({
          error: run.error,
          code: 'QUEUE_UNAVAILABLE',
          run: created,
        });
      }
    }

    res.status(201).json({ run: created });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (sendScopeError(res, err)) return;
    next(err);
  }
});

// The next door's people, as the RUN sees them — not a generic voter list. It applies the same
// eligibility rule the write applies (every voter at the door minus do-not-contact) and flags who
// already answered this round, so the composer can't offer to record an answer the run would then
// silently skip.
router.get('/:campaignId/survey-conversions/:runId/door/:actionId', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const run = await loadRun(req, res, campaign);
    if (!run) return;
    if (!mongoose.isValidObjectId(req.params.actionId)) {
      return res.status(404).json({ error: 'Door not found' });
    }

    const row = await CanvassActivity.findOne(
      { _id: req.params.actionId, campaignId: campaign._id },
      'householdId passId userId actionType timestamp'
    ).lean();
    if (!row) return res.status(404).json({ error: 'Door not found' });

    const [door, voters, answered] = await Promise.all([
      Household.findById(row.householdId, 'addressLine1 unit city').lean(),
      Voter.find({ householdId: row.householdId, campaignId: campaign._id }, 'fullName doNotContact.flagged')
        .sort({ _id: 1 })
        .lean(),
      SurveyResponse.find({ householdId: row.householdId, passId: row.passId ?? null }, 'voterId').lean(),
    ]);
    const answeredIds = new Set(answered.map((a) => String(a.voterId)));

    res.json({
      door: {
        actionId: String(row._id),
        householdId: String(row.householdId),
        address: door
          ? [door.addressLine1, door.unit ? `#${door.unit}` : null].filter(Boolean).join(' ')
          : '(door removed)',
        city: door?.city || '',
        actionType: row.actionType,
        timestamp: row.timestamp,
      },
      voters: voters.map((v) => ({
        id: String(v._id),
        fullName: v.fullName,
        dnc: !!v.doNotContact?.flagged,
        alreadyAnswered: answeredIds.has(String(v._id)),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// One door, applied synchronously — the single fix, and every step of the queue walkthrough. Both
// go through the same service call; a single fix is just a queue of one that closes immediately.
router.post('/:campaignId/survey-conversions/:runId/door', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const run = await loadRun(req, res, campaign);
    if (!run) return;
    if (run.status !== 'open') {
      return res.status(409).json({ error: 'That desk-entry session is already finished.', code: 'RUN_NOT_OPEN' });
    }
    const body = doorApplySchema.parse(req.body);
    if (!run.selection.actionIds.some((id) => String(id) === String(body.actionId))) {
      return res.status(400).json({ error: 'That door is not part of this session.', code: 'NOT_IN_SELECTION' });
    }
    // This path writes inline, so one pathological address must not outlive the request budget.
    // The composer never sends this many; a hand-rolled call could.
    if (Object.keys(body.voterPlans || {}).length > MAX_VOTERS_PER_DOOR_SYNC) {
      return res.status(409).json({
        error: `That door has more than ${MAX_VOTERS_PER_DOOR_SYNC} voters — more than this tool records in one go.`,
        code: 'TOO_MANY_VOTERS_AT_DOOR',
      });
    }

    const result = await applyDoorToRun({
      run,
      campaign,
      actionId: body.actionId,
      voterPlans: body.voterPlans || {},
    });
    res.json({ ...result, run: runWire(run) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.post('/:campaignId/survey-conversions/:runId/close', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const run = await loadRun(req, res, campaign);
    if (!run) return;
    await closeConversionRun({ run, campaign });
    res.json({ run: runWire(run) });
  } catch (err) {
    next(err);
  }
});

// Re-enqueue a run that failed part-way. What already landed stays landed — the job re-reads its
// work set and skips every row it already stamped, so this picks up exactly where it stopped.
router.post('/:campaignId/survey-conversions/:runId/resume', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const run = await loadRun(req, res, campaign);
    if (!run) return;
    if (run.status !== 'failed') {
      return res.status(409).json({ error: 'Only a failed conversion can be resumed.', code: 'NOT_RESUMABLE' });
    }
    run.status = 'pending';
    run.error = null;
    await run.save();
    try {
      const job = await queueOp(
        getQueue(QUEUE_NAMES.OUTCOME_CONVERT).add('convert', { runId: String(run._id) }),
        Number(process.env.OUTCOME_CONVERT_ENQUEUE_TIMEOUT_MS || 5000)
      );
      run.queueJobId = String(job.id);
      await run.save();
    } catch {
      run.status = 'failed';
      run.error = 'Could not restart the conversion. Nothing has been changed — try again shortly.';
      await run.save();
      return res.status(503).json({ error: run.error, code: 'QUEUE_UNAVAILABLE', run: runWire(run) });
    }
    res.json({ run: runWire(run) });
  } catch (err) {
    next(err);
  }
});

router.post('/:campaignId/survey-conversions/:runId/revert', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const run = await loadRun(req, res, campaign);
    if (!run) return;
    if (run.revertedAt) {
      return res.status(409).json({ error: 'That conversion was already reverted.', code: 'ALREADY_REVERTED' });
    }
    if (run.status === 'running' || run.status === 'reverting') {
      return res.status(409).json({ error: 'That conversion is still running.', code: 'RUN_BUSY' });
    }

    // A small run is undone inline so the page can show the result immediately; anything large
    // enough to have been a job going forward is a job coming back.
    if (run.counts.entriesConverted > 500) {
      run.status = 'reverting';
      await run.save();
      try {
        const job = await queueOp(
          getQueue(QUEUE_NAMES.OUTCOME_CONVERT).add('revert', { runId: String(run._id) }),
          Number(process.env.OUTCOME_CONVERT_ENQUEUE_TIMEOUT_MS || 5000)
        );
        run.queueJobId = String(job.id);
        await run.save();
      } catch {
        // Put the status back: `reverting` with no job would offer neither Revert nor Resume.
        run.status = 'completed';
        await run.save();
        return res.status(503).json({
          error: 'Could not start the undo. Nothing has been changed — try again shortly.',
          code: 'QUEUE_UNAVAILABLE',
        });
      }
      return res.status(202).json({ run: runWire(run) });
    }

    await revertConversionRun({ run, campaign });
    res.json({ run: runWire(run) });
  } catch (err) {
    next(err);
  }
});

router.get('/:campaignId/survey-conversions', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    // A COMPLETED run that touched nothing is not a change — it is the residue of an opened-and-
    // abandoned session, and listing it as "Survey answer changes · 0 entries" with an Undo that
    // has nothing to undo is noise at best and alarming at worst. Open and failed runs stay listed
    // whatever their counts (one is resumable, the other needs attention).
    const runs = await SurveyConversionRun.find({
      campaignId: campaign._id,
      $nor: [
        {
          status: { $in: ['completed', 'reverted'] },
          'counts.entriesConverted': 0,
          'counts.responsesCreated': 0,
          'counts.responsesArchived': 0,
        },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const people = await hydrateCanvassers(runs.map((r) => r.byUserId).filter(Boolean), activeOrgId(req));
    res.json({
      runs: runs.map((r) => {
        const p = r.byUserId ? people.get(String(r.byUserId)) : null;
        return runWire(r, p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user' : null);
      }),
    });
  } catch (err) {
    next(err);
  }
});

// The exact changes one conversion run made. Two kinds, because it writes two ledgers:
//   ?kind=doors    — the activity rows it flipped (was → now), off the reclassified stamp
//   ?kind=answers  — the survey responses it created (to_survey, off deskEntry.runId) or
//                    archived (from_survey, off conversionRunId), with the answers themselves
// Same honest limitation as the reclassify detail: revert consumes the stamps, so an undone run
// keeps its summary but loses the itemization — EXCEPT reverse-run archives a revert could not
// restore (a newer field answer took the slot), which remain and are exactly what an admin
// investigating needs to find.
router.get('/:campaignId/survey-conversions/:runId/entries', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const run = await loadRun(req, res, campaign);
    if (!run) return;

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const kind = req.query.kind === 'answers' ? 'answers' : 'doors';
    const reverted = !!run.revertedAt;

    if (kind === 'doors') {
      const filter = { campaignId: campaign._id, 'reclassified.runId': run._id };
      const [rows, total] = await Promise.all([
        CanvassActivity.find(filter, {
          householdId: 1, actionType: 1, userId: 1, passId: 1, timestamp: 1, 'reclassified.from': 1,
        })
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        CanvassActivity.countDocuments(filter),
      ]);
      return res.json({ reverted, kind, ...(await hydrateRunEntries(req, campaign, rows)), total, limit, skip });
    }

    // kind === 'answers' — voter-unit rows, so the shape differs: who, what they answered, where.
    const isForward = run.direction === 'to_survey';
    const Model = isForward ? SurveyResponse : SurveyResponseArchive;
    const filter = isForward
      ? { 'deskEntry.runId': run._id }
      : { conversionRunId: run._id };
    const [rows, total] = await Promise.all([
      Model.find(filter, { voterId: 1, householdId: 1, answers: 1, submittedAt: 1, userId: 1 })
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('voterId', 'fullName')
        .lean(),
      Model.countDocuments(filter),
    ]);
    const doorIds = [...new Set(rows.map((r) => String(r.householdId)))];
    const [doors, people] = await Promise.all([
      Household.find({ _id: { $in: doorIds } }, { addressLine1: 1, unit: 1 }).lean(),
      hydrateCanvassers(rows.map((r) => r.userId).filter(Boolean), activeOrgId(req)),
    ]);
    const doorById = new Map(doors.map((d) => [String(d._id), d]));
    res.json({
      reverted,
      kind,
      entries: rows.map((r) => {
        const d = doorById.get(String(r.householdId));
        const p = r.userId ? people.get(String(r.userId)) : null;
        return {
          id: String(r._id),
          voterName: r.voterId?.fullName || 'Unknown voter',
          address: d ? [d.addressLine1, d.unit ? `#${d.unit}` : null].filter(Boolean).join(' ') : '(door removed)',
          canvasser: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user' : 'Unknown user',
          submittedAt: r.submittedAt,
          answers: (r.answers || []).map((a) => ({
            questionLabel: a.questionLabel,
            answer: a.answer,
            otherText: a.otherText ?? null,
          })),
        };
      }),
      total,
      limit,
      skip,
    });
  } catch (err) {
    next(err);
  }
});

// The poll target. Reads the RUN DOC, not BullMQ: scoping by {_id, campaignId, organizationId}
// makes a cross-org id walk structurally impossible rather than dependent on an ownership check.
router.get('/:campaignId/survey-conversions/:runId', async (req, res, next) => {
  try {
    const campaign = await loadForReclassify(req, res);
    if (!campaign) return;
    const run = await loadRun(req, res, campaign);
    if (!run) return;

    const wire = runWire(run);
    if (run.status === 'open') {
      // DERIVED, never stored: the frozen selection minus the rows this session already stamped.
      // An abandoned session therefore has no cursor that can go stale or disagree with the data.
      const done = await CanvassActivity.find(
        { 'reclassified.runId': run._id },
        { _id: 1 }
      ).lean();
      const doneIds = new Set(done.map((r) => String(r._id)));
      wire.doorsRemaining = run.selection.actionIds
        .map(String)
        .filter((id) => !doneIds.has(id));

      // An open session must be RESUMABLE from a cold page load, so this one call has to carry
      // everything the walkthrough needs — the remaining doors AND the survey to answer. Resolving
      // the template from the selection again would be wrong as well as wasteful: the run froze
      // which survey it is at creation, and a walk list re-pointed since then must not silently
      // change the questions half a session in.
      if (run.surveyTemplateId) {
        const t = await SurveyTemplate.findOne(
          { _id: run.surveyTemplateId, organizationId: activeOrgId(req) },
          'name version intro questions'
        ).lean();
        wire.template = t
          ? { id: String(t._id), name: t.name, version: t.version, intro: t.intro, questions: t.questions }
          : null;
      }
    }
    res.json({ run: wire });
  } catch (err) {
    next(err);
  }
});

export default router;
