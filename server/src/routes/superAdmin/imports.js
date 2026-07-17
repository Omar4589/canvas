import { Router } from 'express';
import mongoose from 'mongoose';
import { ImportJob } from '../../models/ImportJob.js';
import { Organization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
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
    organizationId: job.organizationId?._id ? String(job.organizationId._id) : null,
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
    // Transient provider failures — a run that couldn't geocode a batch should not look clean.
    geocodeFailed: job.geocodeFailed || 0,
    // A reversed import still incurred its lookups; flagged so the UI can badge it (and the
    // excludeUndone toggle can drop it from the cost math).
    undone: !!job.undone,
    undoneAt: job.undoneAt || null,
    costCents: geocodeCostCents(geocodedNew),
  };
}

// Group sums shared by the totals block and the groupBy rollups.
const GROUP_SUMS = {
  imports: { $sum: 1 },
  households: { $sum: { $ifNull: ['$uniqueHouseholds', 0] } },
  geocodedNew: { $sum: { $ifNull: ['$geocodedNew', 0] } },
  geocodedCached: { $sum: { $ifNull: ['$geocodedCached', 0] } },
  geocodeUnmatched: { $sum: { $ifNull: ['$geocodeUnmatched', 0] } },
  geocodeFailed: { $sum: { $ifNull: ['$geocodeFailed', 0] } },
  withFileCoords: { $sum: WITH_FILE_COORDS_EXPR },
};

function shapeGroup(g) {
  return {
    imports: g.imports,
    households: g.households,
    withFileCoords: g.withFileCoords,
    neededGeocoding: g.geocodedNew + g.geocodedCached + g.geocodeUnmatched,
    geocodedNew: g.geocodedNew,
    geocodedCached: g.geocodedCached,
    geocodeUnmatched: g.geocodeUnmatched,
    geocodeFailed: g.geocodeFailed || 0,
    costCents: geocodeCostCents(g.geocodedNew),
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
    // A reversed import still incurred its lookups; the toggle drops it from BOTH the list and
    // the totals so "what did Geocodio actually bill me" and "what did live imports cost" are
    // each answerable.
    if (req.query.excludeUndone === '1') {
      filter.undone = { $ne: true };
    }
    // Server-side search across the three things an operator greps history for: file name,
    // uploader, org. Uploader/org are refs, so their name matches resolve to id sets first.
    const qText = (req.query.q || '').toString().trim();
    if (qText) {
      const rx = new RegExp(qText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const [uids, oids] = await Promise.all([
        User.find({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] }, '_id').lean(),
        Organization.find({ name: rx }, '_id').lean(),
      ]);
      filter.$or = [
        { filename: rx },
        { uploadedBy: { $in: uids.map((u) => u._id) } },
        { organizationId: { $in: oids.map((o) => o._id) } },
      ];
    }

    // sort=cost and sort=new both order by geocodedNew — cost is a rounded function of it, so the
    // orders are identical; both names are accepted for the UI's benefit. Default: newest first.
    const sortSpec = ['cost', 'new'].includes(req.query.sort)
      ? { geocodedNew: -1, createdAt: -1 }
      : { createdAt: -1 };

    // Opt-in paging: parameterless requests keep the legacy newest-500 window.
    const paged = req.query.skip !== undefined || req.query.limit !== undefined;
    const limit = paged ? Math.min(Math.max(Number(req.query.limit) || 50, 1), 200) : LIST_LIMIT;
    const skip = paged ? Math.max(Number(req.query.skip) || 0, 0) : 0;

    const wantGroups = ['month', 'org'].includes(req.query.groupBy) ? req.query.groupBy : null;

    const [total, jobs, aggRows, groupRows] = await Promise.all([
      ImportJob.countDocuments(filter),
      ImportJob.find(filter)
        .sort(sortSpec)
        .skip(skip)
        .limit(limit)
        .populate({ path: 'organizationId', select: 'name' })
        .populate({ path: 'campaignId', select: 'name' })
        .populate({ path: 'uploadedBy', select: 'firstName lastName email' })
        .lean(),
      // Totals over the WHOLE filtered set (exact even when the list is truncated/paged).
      ImportJob.aggregate([{ $match: filter }, { $group: { _id: null, ...GROUP_SUMS } }]),
      // Optional rollup over the same filtered set — the shapes a Geocodio invoice reconciles
      // against: cost by calendar month (UTC, matching the month filter) or by org.
      wantGroups
        ? ImportJob.aggregate([
          { $match: filter },
          {
            $group: {
              _id: wantGroups === 'month'
                ? { $dateToString: { format: '%Y-%m', date: '$createdAt' } }
                : '$organizationId',
              ...GROUP_SUMS,
            },
          },
        ])
        : Promise.resolve(null),
    ]);

    const g = aggRows[0] || {
      imports: 0, households: 0, geocodedNew: 0, geocodedCached: 0, geocodeUnmatched: 0, geocodeFailed: 0, withFileCoords: 0,
    };
    const totals = shapeGroup(g);

    let groups = null;
    if (groupRows) {
      if (wantGroups === 'org') {
        const orgNames = await Organization.find(
          { _id: { $in: groupRows.map((r) => r._id).filter(Boolean) } },
          'name'
        ).lean();
        const nameById = new Map(orgNames.map((o) => [String(o._id), o.name]));
        groups = groupRows
          .map((r) => ({
            key: r._id ? String(r._id) : 'unknown',
            label: r._id ? nameById.get(String(r._id)) || 'deleted org' : 'unknown',
            ...shapeGroup(r),
          }))
          .sort((a, b) => b.costCents - a.costCents);
      } else {
        groups = groupRows
          .map((r) => ({ key: r._id, label: r._id, ...shapeGroup(r) }))
          .sort((a, b) => (a.key < b.key ? 1 : -1)); // newest month first
      }
    }

    const imports = jobs.map(shape);
    res.json({
      totals,
      imports,
      total,
      groups,
      listLimit: LIST_LIMIT,
      truncated: total > skip + imports.length,
      ratePer1000Cents: GEOCODE_COST_PER_1000_CENTS,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
