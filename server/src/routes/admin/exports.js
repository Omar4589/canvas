import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds, canManageCampaign } from '../../services/authz/campaignManagement.js';
import { ExportJob } from '../../models/ExportJob.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { EXPORT_TYPES } from '../../services/export/exportTypes.js';
import { ExportUserError } from '../../services/export/exportErrors.js';
import { loadDncVoterIdSet } from '../../services/export/exportScope.js';
import { openArtifactDownloadStream, deleteArtifact } from '../../services/export/exportArtifactStore.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';

// The Export Center API. Jobs are built in the background (services/export/exportProcessor
// on the worker dyno) and downloaded from here until they expire.
//
// Entitlement: POST / and POST /estimate are the ONLY writes a read-only (suspended /
// expired-trial / canceled) org may perform — the carve-out lives in
// middleware/entitlement.js, because the published wind-down promise ("your data is …
// available to export") is meaningless if creating an export 402s, and /estimate is the
// read-only preview of that same create (counts only, no artifact). Every GET below
// already passes for read-only orgs (reads always pass). DELETE is deliberately NOT
// carved out: leftovers expire via the TTL sweep.
//
// This router must stay mounted AFTER requireEntitlement and accessLog in routes/index.js —
// mounting it earlier would create an unlogged path into voter data.

const router = Router();
// Exports target a campaign, so team leads may export — but only from a campaign they
// manage (the imports/reports posture). Org-wide and admin-only types check isOrgAdmin.
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

const MAX_ACTIVE = Number(process.env.EXPORT_MAX_ACTIVE_PER_ORG || 3);

// Queue calls are time-bounded: ioredis buffers commands while disconnected, so without
// this a wedged/absent Redis would HANG the request rather than failing it — the 503 path
// below would be unreachable exactly when it matters.
const queueOp = (promise, ms = Number(process.env.EXPORT_ENQUEUE_TIMEOUT_MS || 5000)) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('queue timeout')), ms).unref?.()),
  ]);

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

// Admin: org match is enough. Lead: must manage the job's campaign — org-wide jobs
// (campaignId null) are admin-only by construction, so a lead is always denied there.
async function canSeeJob(req, job) {
  if (isOrgAdmin(req)) return true;
  return job.campaignId ? canManageCampaign(req, job.campaignId) : false;
}

// The shared type/campaign/params gate, factored so POST / and POST /estimate cannot
// drift: the preview can never see (or count) a campaign the create would refuse.
// Responds itself and returns null on any failure.
async function resolveExportScope(req, res) {
  const orgId = activeOrgId(req);
  const { type, campaignId } = req.body || {};
  const def = EXPORT_TYPES[type];
  if (!def) {
    res.status(400).json({ error: 'Unknown export type.' });
    return null;
  }

  let campaign = null;
  if (def.requiresCampaign || campaignId) {
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      res.status(400).json({ error: 'campaignId is required.' });
      return null;
    }
    // NOT_DELETING: no new exports against a mid-delete campaign (deletionState.js).
    campaign = await Campaign.findOne({ _id: campaignId, organizationId: orgId, ...NOT_DELETING }).lean();
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return null;
    }
    if (!(await canManageCampaign(req, campaignId))) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
  }
  // Admin-only types, and the org-wide scope (campaignId null), are never lead territory.
  if ((def.adminOnly || !campaign) && !isOrgAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  let params;
  try {
    params = await def.validateParams(req.body?.params || {}, {
      organizationId: orgId,
      campaignId: campaign ? campaign._id : null,
    });
  } catch (err) {
    if (err instanceof ExportUserError || err?.isExportUserError) {
      res.status(400).json({ error: err.message });
      return null;
    }
    throw err;
  }
  return { def, type, campaign, params };
}

// Create a job and enqueue it.
router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const scope = await resolveExportScope(req, res);
    if (!scope) return;
    const { type, campaign, params } = scope;
    // The worker has no req — freeze the anchor timezone into the job so every dated
    // column renders in the campaign's zone, never UTC (docs/DATE_FILTERS.md).
    params.anchorTz = campaign?.timeZone || req.activeOrg?.timeZone || 'America/New_York';

    const active = await ExportJob.countDocuments({
      organizationId: orgId,
      status: { $in: ['pending', 'running'] },
    });
    if (active >= MAX_ACTIVE) {
      return res.status(429).json({
        error: `This organization already has ${active} exports in progress — wait for one to finish.`,
        code: 'export-throttled',
      });
    }

    const job = await ExportJob.create({
      organizationId: orgId,
      campaignId: campaign ? campaign._id : null,
      type,
      params,
      requestedBy: req.user._id,
    });
    try {
      await queueOp(
        getQueue(QUEUE_NAMES.EXPORT).add(
          'export',
          { exportJobId: String(job._id) },
          { jobId: String(job._id) } // stable id so a duplicate submit can't double-run
        )
      );
    } catch (err) {
      // No orphaned forever-pending doc: mark it failed and tell the caller honestly.
      console.error('[exports] enqueue failed:', err?.message || err);
      await ExportJob.updateOne(
        { _id: job._id },
        { $set: { status: 'failed', error: 'Could not queue the export — try again in a moment.', completedAt: new Date() } }
      ).catch(() => {});
      return res.status(503).json({ error: 'Could not queue the export — try again in a moment.', code: 'queue-unavailable' });
    }
    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
});

// Pre-queue row-count preview: the same auth, scoping, and validated params as POST /,
// then the registry's estimate (exportEstimates.js — estimate==build). Counts only: no
// artifact, no audit subjects (nothing record-level leaves; the access log still
// classifies this under exports). Read-only, so it neither checks nor counts toward the
// active-job throttle.
router.post('/estimate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const scope = await resolveExportScope(req, res);
    if (!scope) return;
    const { def, type, campaign, params } = scope;
    if (!def.estimate) {
      return res.status(400).json({ error: 'No preview is available for this export type.' });
    }
    const ctx = {
      organizationId: activeOrgId(req),
      campaignId: campaign ? campaign._id : null,
      campaign,
      params,
      anchorTz: campaign?.timeZone || req.activeOrg?.timeZone || 'America/New_York',
      dnc: await loadDncVoterIdSet(activeOrgId(req)),
    };
    let est;
    try {
      est = await def.estimate(ctx);
    } catch (err) {
      if (err instanceof ExportUserError || err?.isExportUserError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
    const contentKind = await def.contentKind(ctx);
    res.json({
      type,
      contentKind,
      rows: est.rows,
      dncWithheld: est.dncWithheld,
      approx: !!est.approx,
      ...(est.files ? { files: est.files } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// The registry's user-facing metadata, role-filtered — the single source both clients
// render type pickers from (labels, descriptions, filter groups). Copy only, no data.
// Registered BEFORE `/:id` so the literal path wins over the param route.
router.get('/types', (req, res) => {
  if (!ensureOrgScoped(req, res)) return;
  const admin = isOrgAdmin(req);
  const types = Object.entries(EXPORT_TYPES)
    .filter(([, def]) => admin || !def.adminOnly)
    .map(([id, def]) => ({
      id,
      label: def.label,
      desc: def.desc,
      oneRowIs: def.oneRowIs || null,
      adminOnly: !!def.adminOnly,
      requiresCampaign: !!def.requiresCampaign,
      filters: def.filters || [],
      estimate: typeof def.estimate === 'function',
    }));
  res.json({ types });
});

// Health: is a worker consuming the export queue? (The imports worker-status pattern.)
// Registered BEFORE `/:id` so the literal path wins over the param route.
router.get('/worker-status', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const q = getQueue(QUEUE_NAMES.EXPORT);
    let workers = null;
    try {
      const list = await q.getWorkers();
      workers = Array.isArray(list) ? list.length : null;
    } catch {
      workers = null; // some managed Redis restrict the CLIENT introspection getWorkers uses
    }
    const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
    const waiting = counts.waiting || 0;
    const active = counts.active || 0;
    const online = workers != null ? workers > 0 : !(waiting > 0 && active === 0);
    res.json({ online, workers, waiting, active });
  } catch (err) {
    next(err);
  }
});

// Export history, newest first, paged. Admins also see org-wide (campaignId null) rows;
// a lead's filter is $in their managed campaigns, which never matches null.
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const filter = { organizationId: activeOrgId(req) };
    const wantCampaign = req.query.campaignId && mongoose.isValidObjectId(req.query.campaignId)
      ? req.query.campaignId
      : null;
    if (!isOrgAdmin(req)) {
      const managed = (await managedCampaignIds(req)).map(String);
      if (wantCampaign) {
        if (!managed.includes(String(wantCampaign))) return res.status(403).json({ error: 'Forbidden' });
        filter.campaignId = wantCampaign;
      } else {
        filter.campaignId = { $in: managed };
      }
    } else if (wantCampaign) {
      filter.$or = [{ campaignId: wantCampaign }, { campaignId: null }];
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const [jobs, total] = await Promise.all([
      // subjectIds can be 20k ObjectIds — never ship them on a list.
      ExportJob.find(filter, { 'audit.subjectIds': 0 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('requestedBy', 'firstName lastName')
        .lean(),
      ExportJob.countDocuments(filter),
    ]);
    res.json({ jobs, total });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const job = await ExportJob.findOne(
      { _id: req.params.id, organizationId: activeOrgId(req) },
      { 'audit.subjectIds': 0 }
    )
      .populate('requestedBy', 'firstName lastName')
      .lean();
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (!(await canSeeJob(req, job))) return res.status(403).json({ error: 'Forbidden' });
    res.json({ job });
  } catch (err) {
    next(err);
  }
});

// Stream the artifact. AccessLog cannot count rows on a chunked response (rows:null on the
// AccessLog row) — the ExportJob doc is the durable record of magnitude; the per-record
// subjects the processor persisted are tagged here BEFORE streaming so a vendor-grant
// download carries the exact id set that was written to the file.
router.get('/:id/download', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const job = await ExportJob.findOne({ _id: req.params.id, organizationId: activeOrgId(req) }).lean();
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (!(await canSeeJob(req, job))) return res.status(403).json({ error: 'Forbidden' });
    // Expired outranks not-ready: a swept job's status is 'expired', and "queue a fresh
    // one" is the actionable answer there — not "wait".
    if (
      job.status === 'expired' ||
      (job.status === 'completed' && (!job.artifact?.gridFsId || (job.expiresAt && job.expiresAt <= new Date())))
    ) {
      return res.status(410).json({ error: 'This export has expired — queue a fresh one.', code: 'export-expired' });
    }
    if (job.status !== 'completed') {
      return res.status(409).json({ error: 'Export is not ready yet.', code: 'export-not-ready' });
    }
    addAuditSubjects(res, job.audit?.subjectType || 'voter', job.audit?.subjectIds || []);
    res.setHeader('Content-Type', job.artifact.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${job.artifact.filename || 'export'}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    // compression() gzips text/csv and strips Content-Length; a ZIP passes through
    // untouched, so the length gives the browser a real progress bar.
    if (job.artifact.contentType === 'application/zip' && job.bytes) {
      res.setHeader('Content-Length', job.bytes);
    }
    const stream = openArtifactDownloadStream(job._id);
    stream.on('error', (err) => {
      console.error(`[exports] download stream error for ${job._id}:`, err?.message || err);
      if (!res.headersSent) res.status(404).json({ error: 'Artifact not found' });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// Delete a job (and its artifact — an admin can purge a sensitive file before the TTL).
// A running job can't be deleted (no mid-run cancel; the processor's stale-status check
// makes a deleted-while-queued job a safe no-op).
router.delete('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const job = await ExportJob.findOne({ _id: req.params.id, organizationId: activeOrgId(req) }).lean();
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (!(await canSeeJob(req, job))) return res.status(403).json({ error: 'Forbidden' });
    if (job.status === 'running') {
      return res.status(409).json({ error: 'Export is running — wait for it to finish.' });
    }
    if (job.status === 'pending') {
      try {
        const queued = await queueOp(getQueue(QUEUE_NAMES.EXPORT).getJob(String(job._id)), 2000);
        if (queued) await queueOp(queued.remove(), 2000);
      } catch { /* best effort — the processor no-ops on a missing doc anyway */ }
    }
    await deleteArtifact(job._id);
    await ExportJob.deleteOne({ _id: job._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
