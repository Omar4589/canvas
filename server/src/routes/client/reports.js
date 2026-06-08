import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireClientRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import {
  shapeReportForClient,
  shapeMapPoints,
  mapFilterSurvey,
} from '../../services/reports/clientReportView.js';

// Read-only client (candidate) portal. Serves ONLY frozen, published reports, and ONLY for
// the campaign(s) the client was granted (Membership.clientCampaignIds). No live data, no
// canvasser identity, no other campaigns. See docs/CLIENT_PORTAL.md.
const router = Router();
router.use(requireAuth, orgContext, requireClientRole);

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

// The campaign allow-list for this request. null = unrestricted (super admin viewing for
// support); otherwise the client's granted campaign ids as strings.
function allowedCampaignIds(req) {
  if (req.user.isSuperAdmin) return null;
  return (req.activeMembership?.clientCampaignIds || []).map(String);
}

function clientListRow(r) {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    title: r.title || '',
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    publishedAt: r.publishedAt || null,
    mapPointCount: r.mapPointCount || 0,
    showMap: r.visibility?.showMap !== false,
    headline: {
      cumulative: r.stats?.cumulative?.totals || {},
      period: r.stats?.period?.totals || {},
    },
  };
}

// Load a PUBLISHED report by id and enforce org + campaign scope before any handler runs.
async function loadPublishedReport(req, res, next) {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const report = await ClientReport.findOne({
      _id: req.params.id,
      organizationId: activeOrgId(req),
      status: 'published',
    });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const allowed = allowedCampaignIds(req);
    if (allowed !== null && !allowed.includes(String(report.campaignId))) {
      return res.status(403).json({ error: 'No access to this campaign' });
    }
    req.clientReport = report;
    next();
  } catch (err) {
    next(err);
  }
}

// The client's archive: every published weekly report across their granted campaign(s).
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const filter = { organizationId: activeOrgId(req), status: 'published' };
    const allowed = allowedCampaignIds(req);
    if (allowed !== null) {
      if (!allowed.length) return res.json({ reports: [] });
      filter.campaignId = { $in: allowed.map((id) => new mongoose.Types.ObjectId(id)) };
    }
    const reports = await ClientReport.find(filter).sort({ weekStart: -1, publishedAt: -1 }).lean();
    res.json({ reports: reports.map(clientListRow) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', loadPublishedReport, (req, res) => {
  res.json({
    report: shapeReportForClient(req.clientReport),
    survey: mapFilterSurvey(req.clientReport),
  });
});

router.get('/:id/map', loadPublishedReport, async (req, res, next) => {
  try {
    const points = await ClientReportMapPoint.find({ clientReportId: req.clientReport._id }).lean();
    res.json({ households: shapeMapPoints(points), canvassers: [], total: points.length });
  } catch (err) {
    next(err);
  }
});

export default router;
