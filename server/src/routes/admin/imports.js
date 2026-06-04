import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import Papa from 'papaparse';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { ImportJob } from '../../models/ImportJob.js';
import { ImportProfile } from '../../models/ImportProfile.js';
import { Campaign } from '../../models/Campaign.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { saveRawImport } from '../../services/import/rawImportStore.js';
import { parseAndValidate } from '../../services/import/csvImporter.js';
import { computeImportDiff } from '../../services/import/computeImportDiff.js';
import {
  CANONICAL_FIELDS,
  REQUIRED_FIELDS,
  DEFAULT_PROFILE_MAPPING,
  suggestMapping,
} from '../../services/import/canonicalFields.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
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

// Canonical schema + the built-in default mapping (for the mapping UI).
router.get('/fields', (req, res) => {
  res.json({ fields: CANONICAL_FIELDS, required: REQUIRED_FIELDS, defaultMapping: DEFAULT_PROFILE_MAPPING });
});

// Read a file's headers + a few sample rows and auto-suggest a mapping.
router.post('/preview-headers', upload.single('file'), (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const csv = req.file.buffer.toString('utf8');
    const parsed = Papa.parse(csv, {
      header: true,
      skipEmptyLines: true,
      preview: 5,
      transformHeader: (h) => h.trim(),
    });
    const columns = parsed.meta?.fields || [];
    res.json({ columns, sample: parsed.data, suggestedMapping: suggestMapping(columns) });
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
    const { name, mapping } = req.body || {};
    if (!name || !mapping || typeof mapping !== 'object') {
      return res.status(400).json({ error: 'name and mapping are required' });
    }
    const profile = await ImportProfile.findOneAndUpdate(
      { organizationId: activeOrgId(req), name: String(name).trim() },
      { $set: { mapping }, $setOnInsert: { createdBy: req.user._id } },
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
  }
  const missing = missingMappingFields(mapping);
  if (missing.length) {
    return { error: `Mapping is missing required fields: ${missing.join(', ')}` };
  }
  return { mapping, importProfileId };
}

// Enqueue a CSV import: validate synchronously, stash the file in GridFS, queue it.
router.post('/csv', upload.single('file'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const campaignId = req.body?.campaignId;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId is required' });
    }

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
    });
    await saveRawImport(job._id, req.file.originalname, req.file.buffer);
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
router.post('/csv/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const campaignId = req.body?.campaignId;
    if (!campaignId || !mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    const resolved = await resolveImportMapping(req);
    if (resolved.error) return res.status(400).json({ error: resolved.error });
    const campaign = await Campaign.findOne({ _id: campaignId, organizationId: activeOrgId(req) });
    if (!campaign) return res.status(400).json({ error: 'Campaign not found' });

    const csv = req.file.buffer.toString('utf8');
    const { totalRows, errors, validRows, householdMap, dupSvids } = parseAndValidate(csv, resolved.mapping);
    const diff = await computeImportDiff(campaign, { validRows, householdMap, errors, dupSvids, totalRows });
    res.json({ diff });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const filter = { organizationId: activeOrgId(req) };
    if (req.query.campaignId) filter.campaignId = req.query.campaignId;
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

router.get('/:importId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const job = await ImportJob.findOne({
      _id: req.params.importId,
      organizationId: activeOrgId(req),
    }).populate('uploadedBy', 'firstName lastName email');
    if (!job) return res.status(404).json({ error: 'Import not found' });
    res.json({ job });
  } catch (err) {
    next(err);
  }
});

router.get('/:importId/errors', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const job = await ImportJob.findOne(
      { _id: req.params.importId, organizationId: activeOrgId(req) },
      { errors: 1, errorCount: 1 }
    );
    if (!job) return res.status(404).json({ error: 'Import not found' });
    res.json({ errors: job.errors, total: job.errorCount });
  } catch (err) {
    next(err);
  }
});

export default router;
