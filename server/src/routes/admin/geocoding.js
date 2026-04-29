import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { GeocodingJob } from '../../models/GeocodingJob.js';
import { Household } from '../../models/Household.js';
import { runCensusGeocoding, runMapboxFallback } from '../../services/geocode/orchestrator.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.post('/census/start', async (req, res, next) => {
  try {
    const running = await GeocodingJob.findOne({ status: { $in: ['pending', 'running'] } });
    if (running) {
      return res.status(409).json({ error: 'Geocoding job already in progress', job: running });
    }
    const job = await GeocodingJob.create({
      provider: 'census',
      status: 'pending',
      startedBy: req.user._id,
    });
    runCensusGeocoding(job._id).catch((err) => console.error('census job error:', err));
    res.status(202).json({ job });
  } catch (err) {
    next(err);
  }
});

router.post('/mapbox-fallback', async (req, res, next) => {
  try {
    if (!process.env.MAPBOX_SECRET_TOKEN) {
      return res.status(400).json({ error: 'MAPBOX_SECRET_TOKEN not configured on the server' });
    }
    const running = await GeocodingJob.findOne({ status: { $in: ['pending', 'running'] } });
    if (running) {
      return res.status(409).json({ error: 'Geocoding job already in progress', job: running });
    }
    const job = await GeocodingJob.create({
      provider: 'mapbox',
      status: 'pending',
      startedBy: req.user._id,
    });
    runMapboxFallback(job._id).catch((err) => console.error('mapbox job error:', err));
    res.status(202).json({ job });
  } catch (err) {
    next(err);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const [latestJob, statusCounts, providerCounts] = await Promise.all([
      GeocodingJob.findOne().sort({ createdAt: -1 }),
      Household.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$geocodeStatus', count: { $sum: 1 } } },
      ]),
      Household.aggregate([
        { $match: { isActive: true, geocodeStatus: 'success' } },
        { $group: { _id: '$geocodeProvider', count: { $sum: 1 } } },
      ]),
    ]);

    const counts = { pending: 0, success: 0, failed: 0 };
    for (const r of statusCounts) counts[r._id] = r.count;

    const byProvider = { census: 0, mapbox: 0 };
    for (const r of providerCounts) byProvider[r._id || 'unknown'] = r.count;

    res.json({ latestJob, counts, byProvider });
  } catch (err) {
    next(err);
  }
});

router.post('/retry-failed', async (req, res, next) => {
  try {
    const result = await Household.updateMany(
      { geocodeStatus: 'failed', isActive: true },
      { $set: { geocodeStatus: 'pending', geocodeProvider: null, geocodeRaw: null } }
    );
    res.json({ reset: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

router.get('/jobs', async (req, res, next) => {
  try {
    const jobs = await GeocodingJob.find().sort({ createdAt: -1 }).limit(20);
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
});

export default router;
