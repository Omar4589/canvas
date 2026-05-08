import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { runImport } from '../../services/import/csvImporter.js';
import { ImportJob } from '../../models/ImportJob.js';

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

router.post('/csv', upload.single('file'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: "file")' });
    const campaignId = req.body?.campaignId;
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    const job = await runImport({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      userId: req.user._id,
      campaignId,
      organizationId: activeOrgId(req),
    });
    res.status(201).json({ job });
  } catch (err) {
    if (err.message === 'Campaign not found' || err.message === 'campaignId is required') {
      return res.status(400).json({ error: err.message });
    }
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
