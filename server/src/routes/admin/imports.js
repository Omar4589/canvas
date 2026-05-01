import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { runImport } from '../../services/import/csvImporter.js';
import { ImportJob } from '../../models/ImportJob.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

router.post('/csv', upload.single('file'), async (req, res, next) => {
  try {
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
    const filter = {};
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
    const job = await ImportJob.findById(req.params.importId).populate(
      'uploadedBy',
      'firstName lastName email'
    );
    if (!job) return res.status(404).json({ error: 'Import not found' });
    res.json({ job });
  } catch (err) {
    next(err);
  }
});

router.get('/:importId/errors', async (req, res, next) => {
  try {
    const job = await ImportJob.findById(req.params.importId, { errors: 1, errorCount: 1 });
    if (!job) return res.status(404).json({ error: 'Import not found' });
    res.json({ errors: job.errors, total: job.errorCount });
  } catch (err) {
    next(err);
  }
});

export default router;
