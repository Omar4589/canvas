import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { signShareToken, verifyToken } from '../../services/auth/tokens.js';
import {
  shapeReportForClient,
  shapeReportListRow,
  shapeMapPoints,
  mapFilterSurvey,
} from '../../services/reports/clientReportView.js';

// PUBLIC report sharing — no login. A capability token in the URL (the SPA's /r/:token → /share/:token
// here) opens a campaign's PUBLISHED report hub (latest + history). An optional per-link password is
// exchanged for a short-lived share JWT that authorizes the reads. Mounted before the requireAuth gate.
// See docs/CLIENT_PORTAL.md.
const router = Router();

async function loadShare(req, res, next) {
  try {
    const share = await ReportShareLink.findOne({ token: req.params.token, isActive: true });
    if (!share) return res.status(404).json({ error: 'This report link is not available.' });
    req.share = share;
    // Best-effort access stamp — never block the read on it.
    ReportShareLink.updateOne({ _id: share._id }, { $set: { lastAccessedAt: new Date() } }).catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
}

// Open link → allowed. Password link → require a valid share JWT (X-Share-Token) for THIS share.
function requireShareAccess(req, res, next) {
  if (!req.share.passwordHash) return next();
  const raw = req.headers['x-share-token'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (token) {
    try {
      const payload = verifyToken(token);
      if (
        payload.kind === 'share' &&
        String(payload.shareId) === String(req.share._id) &&
        String(payload.campaignId) === String(req.share.campaignId)
      ) {
        return next();
      }
    } catch {
      /* fall through to 401 */
    }
  }
  return res.status(401).json({ error: 'Password required', code: 'password-required' });
}

const reportScope = (req) => ({
  organizationId: req.share.organizationId,
  campaignId: req.share.campaignId,
  status: 'published',
});

// Meta — drives the brand header + the password gate. (Reading meta needs no password.)
router.get('/:token', loadShare, async (req, res, next) => {
  try {
    const [campaign, org] = await Promise.all([
      Campaign.findById(req.share.campaignId, { name: 1 }).lean(),
      Organization.findById(req.share.organizationId, { name: 1 }).lean(),
    ]);
    res.json({
      campaignName: campaign?.name || 'Campaign',
      orgName: org?.name || '',
      label: req.share.label || '',
      requiresPassword: !!req.share.passwordHash,
    });
  } catch (err) {
    next(err);
  }
});

const unlockSchema = z.object({ password: z.string().min(1) });

router.post('/:token/unlock', loadShare, async (req, res, next) => {
  try {
    const issue = () =>
      res.json({ accessToken: signShareToken({ shareId: req.share._id, campaignId: req.share.campaignId }) });
    if (!req.share.passwordHash) return issue(); // open link — uniform client flow
    const { password } = unlockSchema.parse(req.body);
    const ok = await bcrypt.compare(password, req.share.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password' });
    return issue();
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Password required' });
    next(err);
  }
});

router.get('/:token/reports', loadShare, requireShareAccess, async (req, res, next) => {
  try {
    const reports = await ClientReport.find(reportScope(req))
      .sort({ weekStart: -1, publishedAt: -1 })
      .lean();
    res.json({ reports: reports.map(shapeReportListRow) });
  } catch (err) {
    next(err);
  }
});

async function loadReport(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const report = await ClientReport.findOne({ _id: req.params.id, ...reportScope(req) });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    req.report = report;
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/:token/reports/:id', loadShare, requireShareAccess, loadReport, (req, res) => {
  res.json({ report: shapeReportForClient(req.report), survey: mapFilterSurvey(req.report) });
});

router.get('/:token/reports/:id/map', loadShare, requireShareAccess, loadReport, async (req, res, next) => {
  try {
    const points = await ClientReportMapPoint.find({ clientReportId: req.report._id }).lean();
    res.json({ households: shapeMapPoints(points), canvassers: [], total: points.length });
  } catch (err) {
    next(err);
  }
});

router.get('/:token/mapbox-token', loadShare, requireShareAccess, (req, res) => {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || '';
  res.json({ token, isReady: Boolean(token && token.startsWith('pk.')) });
});

export default router;
