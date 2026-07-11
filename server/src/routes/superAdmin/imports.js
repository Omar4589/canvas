import { Router } from 'express';
import mongoose from 'mongoose';
import { ImportJob } from '../../models/ImportJob.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { geocodeCostCents, GEOCODE_COST_PER_1000_CENTS } from '../../services/import/geocode/geocodeService.js';

// Owner-only review of every voter-file import across every org and the geocoding cost each
// incurred. Cost is derived from the persisted, real per-import lookup counts (geocodedNew =
// billable Geocodio hits) — the client never sees any of this.
const router = Router();
router.use(requireAuth, requireSuperAdmin);

// Only real applied imports (not preview / geocode_check probes) — matches the admin history set.
// $nin also matches legacy docs with no `kind` field (they default to 'apply').
const APPLIED = { kind: { $nin: ['preview', 'geocode_check'] } };
const LIST_LIMIT = 500;

// "Arrived with coords" as an aggregation expression: prefer the exact persisted count; legacy
// rows (before the field existed) fall back to households minus the ones that needed geocoding.
const WITH_FILE_COORDS_EXPR = {
  $ifNull: [
    '$householdsWithFileCoords',
    {
      $max: [
        0,
        {
          $subtract: [
            { $ifNull: ['$uniqueHouseholds', 0] },
            { $add: [{ $ifNull: ['$geocodedNew', 0] }, { $ifNull: ['$geocodedCached', 0] }] },
          ],
        },
      ],
    },
  ],
};

// Per-import derived row for the table.
function shape(job) {
  const geocodedNew = job.geocodedNew || 0;
  const geocodedCached = job.geocodedCached || 0;
  const geocodeUnmatched = job.geocodeUnmatched || 0;
  const uniqueHouseholds = job.uniqueHouseholds || 0;
  const hasExact = job.householdsWithFileCoords != null;
  const withFileCoords = hasExact
    ? job.householdsWithFileCoords
    : Math.max(0, uniqueHouseholds - geocodedNew - geocodedCached);
  const uploader = job.uploadedBy
    ? `${job.uploadedBy.firstName || ''} ${job.uploadedBy.lastName || ''}`.trim() || job.uploadedBy.email
    : null;
  return {
    id: String(job._id),
    createdAt: job.createdAt,
    status: job.status,
    filename: job.filename,
    organizationName: job.organizationId?.name || '—',
    campaignName: job.campaignId?.name || null,
    uploadedByName: uploader,
    uniqueHouseholds,
    withFileCoords,
    withFileCoordsApprox: !hasExact,
    neededGeocoding: geocodedNew + geocodedCached + geocodeUnmatched,
    geocodedNew,
    geocodedCached,
    geocodeUnmatched,
    costCents: geocodeCostCents(geocodedNew),
  };
}

router.get('/', async (req, res, next) => {
  try {
    const filter = { ...APPLIED };
    const month = String(req.query.month || '').trim();
    if (/^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      filter.createdAt = { $gte: new Date(Date.UTC(y, m - 1, 1)), $lt: new Date(Date.UTC(y, m, 1)) };
    }
    if (req.query.orgId && mongoose.isValidObjectId(req.query.orgId)) {
      filter.organizationId = req.query.orgId;
    }

    const [total, jobs, aggRows] = await Promise.all([
      ImportJob.countDocuments(filter),
      ImportJob.find(filter)
        .sort({ createdAt: -1 })
        .limit(LIST_LIMIT)
        .populate({ path: 'organizationId', select: 'name' })
        .populate({ path: 'campaignId', select: 'name' })
        .populate({ path: 'uploadedBy', select: 'firstName lastName email' })
        .lean(),
      // Totals over the WHOLE filtered set (exact even when the list is truncated to LIST_LIMIT).
      ImportJob.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            imports: { $sum: 1 },
            households: { $sum: { $ifNull: ['$uniqueHouseholds', 0] } },
            geocodedNew: { $sum: { $ifNull: ['$geocodedNew', 0] } },
            geocodedCached: { $sum: { $ifNull: ['$geocodedCached', 0] } },
            geocodeUnmatched: { $sum: { $ifNull: ['$geocodeUnmatched', 0] } },
            withFileCoords: { $sum: WITH_FILE_COORDS_EXPR },
          },
        },
      ]),
    ]);

    const g = aggRows[0] || {
      imports: 0, households: 0, geocodedNew: 0, geocodedCached: 0, geocodeUnmatched: 0, withFileCoords: 0,
    };
    const totals = {
      imports: g.imports,
      households: g.households,
      withFileCoords: g.withFileCoords,
      neededGeocoding: g.geocodedNew + g.geocodedCached + g.geocodeUnmatched,
      geocodedNew: g.geocodedNew,
      geocodedCached: g.geocodedCached,
      geocodeUnmatched: g.geocodeUnmatched,
      costCents: geocodeCostCents(g.geocodedNew),
    };

    const imports = jobs.map(shape);
    res.json({
      totals,
      imports,
      total,
      listLimit: LIST_LIMIT,
      truncated: total > imports.length,
      ratePer1000Cents: GEOCODE_COST_PER_1000_CENTS,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
