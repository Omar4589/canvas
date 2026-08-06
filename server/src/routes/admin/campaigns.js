import { Router } from 'express';
import { NON_KNOCKED_STATUSES } from '../../services/reports/aggregations.js';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds, canManageCampaign } from '../../services/authz/campaignManagement.js';
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
import { isDeleting, maybeExpireStaleDeletion, campaignHasCanvassed } from '../../services/campaigns/deletionState.js';
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
  // TRI-STATE: null = inherit the org default, true/false = explicit override. `.nullable()`
  // is the whole point — a plain boolean would make "inherit" unexpressible from the UI.
  billRestrictedDoors: z.boolean().nullable().optional(),
});

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
  const [householdAgg, surveyAgg, activityAgg, summaries] = await Promise.all([
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
      // Undefined → null → inherit the org default. New campaigns never hard-code a value.
      billRestrictedDoors: data.billRestrictedDoors ?? null,
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
    // survey, and timezone — but archiving (isActive), the type, the state, the
    // key dates, and the billable-door policy stay with org admins.
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

    if (data.name !== undefined) campaign.name = data.name;
    if (data.state !== undefined) campaign.state = data.state;
    if (data.timeZone !== undefined) campaign.timeZone = data.timeZone;
    // Explicit null clears a date.
    if (data.electionDay !== undefined) campaign.electionDay = data.electionDay;
    if (data.earlyVotingStart !== undefined) campaign.earlyVotingStart = data.earlyVotingStart;
    if (data.earlyVotingEnd !== undefined) campaign.earlyVotingEnd = data.earlyVotingEnd;
    if (data.datesNote !== undefined) campaign.datesNote = data.datesNote;
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
      }
      campaign.surveyTemplateId = data.surveyTemplateId || null;
    }
    // No survey-required guard here — a survey campaign may exist without a template; the
    // requirement is enforced at round activation (passes.js) instead.
    await campaign.save();
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

export default router;
