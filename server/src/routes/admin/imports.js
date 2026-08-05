import fs from 'node:fs';
import os from 'node:os';
import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds, canManageCampaign } from '../../services/authz/campaignManagement.js';
import { ImportJob } from '../../models/ImportJob.js';
import { ImportProfile } from '../../models/ImportProfile.js';
import { Campaign } from '../../models/Campaign.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { saveRawImportFromFile, deleteRawImport } from '../../services/import/rawImportStore.js';
import { maybeExpireStaleImportJob } from '../../services/import/sweepStaleImports.js';
import { buildImportRows } from '../../services/import/csvImporter.js';
import { peekUpload } from '../../services/import/peekUpload.js';
import { computeImportDiff } from '../../services/import/computeImportDiff.js';
import { undoFileImport } from '../../services/import/undoImport.js';
import {
  CANONICAL_FIELDS,
  REQUIRED_FIELDS,
  DEFAULT_PROFILE_MAPPING,
  suggestMapping,
} from '../../services/import/canonicalFields.js';

const router = Router();
// Imports target a campaign, so team leads may import — but only into a campaign
// they manage. Each campaign-targeted endpoint enforces that via manages() below.
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

// True if the requester may manage `campaignId` (super/admin always; lead only for
// a granted campaign); otherwise writes a 403 and returns false.
async function manages(req, res, campaignId) {
  if (await canManageCampaign(req, campaignId)) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

// Disk storage, not memoryStorage: a 50 MB upload used to sit in the web dyno's
// RSS for the whole request. Files land in the OS temp dir (ephemeral on Heroku)
// and every route deletes its file in a finally — see dropUpload.
const upload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Wrap multer so an oversized file returns a friendly 413 (with a code the client
// can detect) instead of bubbling to the generic 500 error handler.
function uploadCsv(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large — max 50 MB. Split it into smaller files (e.g. by region).',
        code: 'file-too-large',
      });
    }
    if (err) return next(err);
    // The uploaded temp file holds voter PII — its lifetime is the request,
    // success, failure, or client abort ('close' fires for all three). Routes
    // must therefore finish reading it before responding (they do — every
    // consumer is awaited). Best-effort: the dyno filesystem is ephemeral anyway.
    res.on('close', () => {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    });
    next();
  });
}

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

// Canonical schema + the built-in default mapping (for the mapping UI).
router.get('/fields', (req, res) => {
  res.json({ fields: CANONICAL_FIELDS, required: REQUIRED_FIELDS, defaultMapping: DEFAULT_PROFILE_MAPPING });
});

// Read a file's headers + a few sample rows and auto-suggest a mapping.
// peekUpload reads O(5 rows), not O(file) — parseUpload here materialized all
// 166k rows of a big xlsx on the web dyno (~620 MB, the R14s) to return five.
router.post('/preview-headers', uploadCsv, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const { headers, rows, estimatedRows, sheetName, otherSheets } = await peekUpload(req.file.path, req.file.originalname, { rows: 5 });
    // sheetName/otherSheets: only the first tab of a workbook is ever imported, so
    // the mapping step names the tab these columns came from and lists the ignored
    // ones — otherwise a data-on-the-second-tab file just looks like wrong columns.
    res.json({
      columns: headers,
      sample: rows,
      suggestedMapping: suggestMapping(headers),
      estimatedRows,
      sheetName,
      otherSheets,
    });
  } catch (err) {
    next(err);
  }
});

// Saved import profiles (reusable column mappings per vendor).
router.get('/profiles', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const profiles = await ImportProfile.find({ organizationId: activeOrgId(req) }).sort({ name: 1 });
    res.json({ profiles });
  } catch (err) {
    next(err);
  }
});

router.post('/profiles', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const { name, mapping, uidSource } = req.body || {};
    if (!name || !mapping || typeof mapping !== 'object') {
      return res.status(400).json({ error: 'name and mapping are required' });
    }
    const profile = await ImportProfile.findOneAndUpdate(
      { organizationId: activeOrgId(req), name: String(name).trim() },
      { $set: { mapping, uidSource: uidSource ? String(uidSource).trim() || null : null }, $setOnInsert: { createdBy: req.user._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ profile });
  } catch (err) {
    next(err);
  }
});

function missingMappingFields(mapping) {
  return REQUIRED_FIELDS.filter((f) => !mapping?.[f]);
}

// Resolve the field mapping (inline JSON → saved profile → default) and validate
// required fields. Shared by /csv and /csv/preview. Returns { mapping, importProfileId }
// or { error } for the caller to 400.
async function resolveImportMapping(req) {
  let mapping = DEFAULT_PROFILE_MAPPING;
  let importProfileId = null;
  // Vendor namespace for the uid column (shared voter DB matching). An inline override
  // wins; otherwise it's inherited from the saved profile.
  let uidSource = req.body?.uidSource ? String(req.body.uidSource).trim() || null : null;
  if (req.body?.mapping) {
    try {
      mapping = JSON.parse(req.body.mapping);
    } catch {
      return { error: 'mapping must be valid JSON' };
    }
  } else if (req.body?.importProfileId) {
    const profile = await ImportProfile.findOne({
      _id: req.body.importProfileId,
      organizationId: activeOrgId(req),
    });
    if (!profile) return { error: 'Import profile not found' };
    mapping = profile.mapping;
    importProfileId = profile._id;
    if (uidSource == null) uidSource = profile.uidSource || null;
  }
  const missing = missingMappingFields(mapping);
  if (missing.length) {
    return { error: `Mapping is missing required fields: ${missing.join(', ')}` };
  }
  return { mapping, importProfileId, uidSource };
}

// Enqueue a CSV import: validate synchronously, stash the file in GridFS, queue it.
router.post('/csv', uploadCsv, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const campaignId = req.body?.campaignId;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    if (!(await manages(req, res, campaignId))) return;

    // Resolve the field mapping: inline JSON, a saved profile, or the default.
    const resolved = await resolveImportMapping(req);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const { mapping, importProfileId } = resolved;

    // Campaign must exist + belong to the active org (preserves today's 400).
    const campaign = await Campaign.findOne({ _id: campaignId, organizationId: activeOrgId(req) });
    if (!campaign) return res.status(400).json({ error: 'Campaign not found' });

    const job = await ImportJob.create({
      organizationId: activeOrgId(req),
      campaignId: campaign._id,
      filename: req.file.originalname,
      uploadedBy: req.user._id,
      status: 'pending',
      fieldMapping: mapping,
      importProfileId,
      explode: req.body?.explode !== 'false',
      uidSource: resolved.uidSource ?? null,
      revisitNewVoters: req.body?.revisitNewVoters === 'true',
      overwriteHandEdits: req.body?.overwriteHandEdits === 'true',
    });
    await saveRawImportFromFile(job._id, req.file.originalname, req.file.path);
    await getQueue(QUEUE_NAMES.IMPORT).add(
      'csv-import',
      { importJobId: String(job._id) },
      { jobId: String(job._id) }
    );

    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
});

// Dry-run: parse + diff the file against the campaign's current data. No writes —
// powers the "review before you import" step. Apply is the unchanged POST /csv.
router.post('/csv/preview', uploadCsv, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const campaignId = req.body?.campaignId;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    if (!(await manages(req, res, campaignId))) return;
    const resolved = await resolveImportMapping(req);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const campaign = await Campaign.findOne({ _id: campaignId, organizationId: activeOrgId(req) });
    if (!campaign) return res.status(400).json({ error: 'Campaign not found' });

    const explode = req.body?.explode !== 'false';
    const { totalRows, errors, validRows, householdMap, dupSvids, dupRows, detection } =
      await buildImportRows(fs.readFileSync(req.file.path), req.file.originalname, resolved.mapping, { explode });
    const diff = await computeImportDiff(campaign, { validRows, householdMap, errors, dupSvids, dupRows, totalRows, uidSource: resolved.uidSource });
    diff.detection = detection;
    res.json({ diff });
  } catch (err) {
    // Oversized files refuse with the count + remedy, not a generic 500.
    if (err?.name === 'ImportTooLargeError') {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    next(err);
  }
});

// Async preview for LARGE files: same diff as /csv/preview, but stash the file and
// run the parse+diff on the worker (off the 30s request clock). The client polls
// GET /:importId for job.diff. Mirrors POST /csv but kind:'preview'.
router.post('/csv/preview-enqueue', uploadCsv, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const campaignId = req.body?.campaignId;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    if (!(await manages(req, res, campaignId))) return;
    const resolved = await resolveImportMapping(req);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const { mapping, importProfileId } = resolved;
    const campaign = await Campaign.findOne({ _id: campaignId, organizationId: activeOrgId(req) });
    if (!campaign) return res.status(400).json({ error: 'Campaign not found' });

    const job = await ImportJob.create({
      organizationId: activeOrgId(req),
      campaignId: campaign._id,
      filename: req.file.originalname,
      uploadedBy: req.user._id,
      status: 'pending',
      kind: 'preview',
      fieldMapping: mapping,
      importProfileId,
      explode: req.body?.explode !== 'false',
      uidSource: resolved.uidSource ?? null,
    });
    await saveRawImportFromFile(job._id, req.file.originalname, req.file.path);
    await getQueue(QUEUE_NAMES.IMPORT).add(
      'csv-preview',
      { importJobId: String(job._id) },
      { jobId: String(job._id) }
    );

    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
});

// Opt-in "See exact placement": geocode the file's missing-coord addresses NOW (caching
// them, so a later import is free) and report the EXACT placeable/unplaceable counts.
// Worker-backed like preview-enqueue; the client polls GET /:importId for job.geocodeCheck.
router.post('/geocode-check', uploadCsv, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (process.env.GEOCODE_ENABLED !== 'true') {
      return res.status(400).json({ error: 'Geocoding is not enabled.', code: 'geocoding-disabled' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const campaignId = req.body?.campaignId;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    if (!(await manages(req, res, campaignId))) return;
    const resolved = await resolveImportMapping(req);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const { mapping, importProfileId } = resolved;
    const campaign = await Campaign.findOne({ _id: campaignId, organizationId: activeOrgId(req) });
    if (!campaign) return res.status(400).json({ error: 'Campaign not found' });

    const job = await ImportJob.create({
      organizationId: activeOrgId(req),
      campaignId: campaign._id,
      filename: req.file.originalname,
      uploadedBy: req.user._id,
      status: 'pending',
      kind: 'geocode_check',
      fieldMapping: mapping,
      importProfileId,
      explode: req.body?.explode !== 'false',
      uidSource: resolved.uidSource ?? null,
    });
    await saveRawImportFromFile(job._id, req.file.originalname, req.file.path);
    await getQueue(QUEUE_NAMES.IMPORT).add('geocode-check', { importJobId: String(job._id) }, { jobId: String(job._id) });
    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
});

// Health: is a worker actually consuming the import queue? Powers the Import
// page's "worker offline" banner so a stopped worker dyno isn't a silent failure.
// Registered BEFORE `/:importId` so the literal path wins over the param route.
// Redis commands here must be time-bounded: with `maxRetriesPerRequest: null`
// (required by BullMQ) ioredis queues commands FOREVER against a dead Redis and
// never rejects — so an unbounded await rides to the router's H12 and the
// offline banner never renders in the one case it exists for.
const raceTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('redis-timeout')), ms).unref?.()),
  ]);

router.get('/worker-status', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const q = getQueue(QUEUE_NAMES.IMPORT);
    let workers = null;
    try {
      const list = await raceTimeout(q.getWorkers(), 3000);
      workers = Array.isArray(list) ? list.length : null;
    } catch {
      workers = null; // some managed Redis restrict the CLIENT introspection getWorkers uses
    }
    let counts;
    try {
      counts = await raceTimeout(q.getJobCounts('waiting', 'active', 'delayed', 'failed'), 3000);
    } catch {
      // Redis unreachable — the queue is effectively down, which IS "worker offline".
      return res.json({ online: false, workers: null, waiting: null, active: null, reason: 'redis-unreachable' });
    }
    const waiting = counts.waiting || 0;
    const active = counts.active || 0;
    // With a worker count, trust it; otherwise flag only a genuine stuck backlog.
    const online = workers != null ? workers > 0 : !(waiting > 0 && active === 0);
    res.json({ online, workers, waiting, active });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    // Exclude preview jobs ($ne also matches legacy docs with no `kind`) so the
    // ephemeral large-file previews don't clutter the import history.
    const filter = { organizationId: activeOrgId(req), kind: { $nin: ['preview', 'geocode_check'] } };
    if (req.query.campaignId) filter.campaignId = req.query.campaignId;
    // A lead only sees import history for the campaigns they manage.
    if (!isOrgAdmin(req)) {
      const managed = (await managedCampaignIds(req)).map(String);
      if (req.query.campaignId) {
        if (!managed.includes(String(req.query.campaignId))) return res.status(403).json({ error: 'Forbidden' });
      } else {
        filter.campaignId = { $in: managed };
      }
    }
    const jobs = await ImportJob.find(filter, { errors: 0 })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('uploadedBy', 'firstName lastName email')
      .populate('campaignId', 'name type state');
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
});

// Big-array fields the 1.5s poller must not re-download every tick; undo reads
// them from the DB, never from this response. (On a 100k-row import the inserted-id
// arrays alone are ~5 MB of JSON.)
const IMPORT_DETAIL_PROJECTION = {
  insertedHouseholdIds: 0,
  insertedVoterIds: 0,
  sourceHouseholdIds: 0,
  duplicateStateVoterIds: 0,
};

router.get('/:importId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.importId)) {
      return res.status(400).json({ error: 'Invalid import id' });
    }
    let job = await ImportJob.findOne(
      { _id: req.params.importId, organizationId: activeOrgId(req) },
      IMPORT_DETAIL_PROJECTION
    ).populate('uploadedBy', 'firstName lastName email');
    if (!job) return res.status(404).json({ error: 'Import not found' });
    if (!(await manages(req, res, job.campaignId))) return;
    // Stuck-job expiry runs HERE, on the web dyno, because the failure it exists
    // for is a dead worker: an OOM-abort skips every catch and freezes the doc in
    // an active status while the client polls forever. The poll itself is the
    // watchdog — a stranded job self-fails within minutes with a real message.
    if (await maybeExpireStaleImportJob(job)) {
      job = await ImportJob.findById(job._id, IMPORT_DETAIL_PROJECTION).populate(
        'uploadedBy',
        'firstName lastName email'
      );
    }
    res.json({ job });
  } catch (err) {
    next(err);
  }
});

// Cancel a queued (not yet running) import/preview: pull it from the queue, fail
// the doc, drop the raw upload. A job a worker is actively heartbeating returns
// 409 — cancelling one mid-write would let the processor's completion overwrite
// the cancel, so we only cancel what is provably not running.
router.post('/:importId/cancel', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.importId)) {
      return res.status(400).json({ error: 'Invalid import id' });
    }
    const job = await ImportJob.findOne({
      _id: req.params.importId,
      organizationId: activeOrgId(req),
    });
    if (!job) return res.status(404).json({ error: 'Import not found' });
    if (!(await manages(req, res, job.campaignId))) return;
    if (['completed', 'failed'].includes(job.status)) {
      return res.json({ job }); // already terminal — nothing to cancel
    }

    // Bull jobId === String(ImportJob._id) (set at enqueue). remove() throws on a
    // locked/active job — that means a worker holds it, so refuse unless the
    // heartbeat shows the worker is dead (then the stale expiry takes it).
    let removedFromQueue = false;
    try {
      const bullJob = await raceTimeout(getQueue(QUEUE_NAMES.IMPORT).getJob(String(job._id)), 3000);
      if (bullJob) {
        await bullJob.remove();
        removedFromQueue = true;
      } else {
        removedFromQueue = true; // nothing queued (already consumed + reconciled, or Redis lost it)
      }
    } catch {
      removedFromQueue = false;
    }
    if (!removedFromQueue && !(await maybeExpireStaleImportJob(job))) {
      return res.status(409).json({ error: 'Import is running — it can only be cancelled once it stops responding.' });
    }

    await ImportJob.updateOne(
      { _id: job._id, status: job.status },
      {
        $set: { status: 'failed', lastError: 'cancelled', completedAt: new Date() },
        $push: { errors: { reason: 'Cancelled before it ran.' } },
        $inc: { errorCount: 1 },
      }
    );
    await deleteRawImport(job._id).catch(() => {});
    const fresh = await ImportJob.findById(job._id, IMPORT_DETAIL_PROJECTION);
    res.json({ job: fresh });
  } catch (err) {
    next(err);
  }
});

router.get('/:importId/errors', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const job = await ImportJob.findOne(
      { _id: req.params.importId, organizationId: activeOrgId(req) },
      { errors: 1, errorCount: 1, campaignId: 1 }
    );
    if (!job) return res.status(404).json({ error: 'Import not found' });
    if (!(await manages(req, res, job.campaignId))) return;
    res.json({ errors: job.errors, total: job.errorCount });
  } catch (err) {
    next(err);
  }
});

// Undo an import: delete the records it inserted that are still untouched (not claimed,
// cut, canvassed, surveyed, voted, or sharing a door). Skips + reports the rest. Does
// not revert updates to pre-existing records.
router.post('/:importId/undo', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.importId)) {
      return res.status(400).json({ error: 'Invalid import id' });
    }
    // A lead may only undo an import into a campaign they manage — check before
    // claiming (admins skip this fast path; the claim query is org-scoped anyway).
    if (!isOrgAdmin(req)) {
      const pre = await ImportJob.findOne(
        { _id: req.params.importId, organizationId: activeOrgId(req) },
        { campaignId: 1 }
      ).lean();
      if (!pre) return res.status(404).json({ error: 'Import not found' });
      if (!(await manages(req, res, pre.campaignId))) return;
    }
    // Atomically claim the undo (compare-and-set on `undone`) so two concurrent
    // requests can't both run it — only the winner gets a non-null job.
    const job = await ImportJob.findOneAndUpdate(
      { _id: req.params.importId, organizationId: activeOrgId(req), status: 'completed', undone: { $ne: true } },
      { $set: { undone: true, undoneAt: new Date(), undoneBy: req.user._id } },
      { new: true }
    );
    if (!job) {
      const exists = await ImportJob.findOne(
        { _id: req.params.importId, organizationId: activeOrgId(req) },
        { status: 1, undone: 1 }
      );
      if (!exists) return res.status(404).json({ error: 'Import not found' });
      if (exists.status !== 'completed') return res.status(400).json({ error: 'Only a completed import can be undone' });
      return res.status(400).json({ error: 'This import was already undone' });
    }
    try {
      // Undo the whole file across all its (crash-retry) upload attempts, not just this job.
      const enriched = await undoFileImport(job, activeOrgId(req), req.user._id);
      // Remove any auto-generated "revisit" saved search for this file — it's an import
      // artifact, so undoing the import should take it with it. Safe even if it was already
      // claimed into a walk list (the effort keeps its doors via effortId, not this list).
      if (job.filename) {
        const fileJobs = await ImportJob.find(
          { organizationId: activeOrgId(req), campaignId: job.campaignId, filename: job.filename, kind: 'apply' },
          { _id: 1 }
        ).lean();
        await SavedSearch.deleteMany({
          campaignId: job.campaignId,
          source: 'import',
          'sourceMeta.importJobId': { $in: fileJobs.map((j) => j._id) },
        });
      }
      await ImportJob.updateOne(
        { _id: job._id },
        {
          $set: {
            undoResult: {
              doorsDeleted: enriched.doorsDeleted,
              doorsSkipped: enriched.doorsSkipped,
              votersDeleted: enriched.votersDeleted,
              votersSkipped: enriched.votersSkipped,
            },
          },
        }
      );
      res.json(enriched);
    } catch (err) {
      // Roll the clicked job's claim back (undoFileImport rolls back the siblings itself).
      await ImportJob.updateOne(
        { _id: job._id },
        { $set: { undone: false, undoneAt: null, undoneBy: null } }
      );
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

export default router;
