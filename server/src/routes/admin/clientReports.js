import { Router } from 'express';
import mongoose from 'mongoose';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { Campaign } from '../../models/Campaign.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { zonedDayRange } from '../../utils/timezone.js';
import { computeWindowStats, buildFrozenMapPoints } from '../../services/reports/computeReport.js';
import {
  shapeReportForClient,
  shapeMapPoints,
  mapFilterSurvey,
} from '../../services/reports/clientReportView.js';

// Admin report BUILDER. Create a weekly draft (pre-computes the dual-window stats), edit the
// observations / visibility / support question, preview it exactly as the client will see it,
// then publish — which FREEZES the numbers and snapshots the map. See docs/CLIENT_PORTAL.md.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

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

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const createSchema = z.object({
  campaignId: z.string(),
  weekStart: z.string().regex(dateRe),
  weekEnd: z.string().regex(dateRe),
  title: z.string().max(200).optional(),
});
const sectionSchema = z.object({ heading: z.string().min(1).max(200), body: z.string().max(20000).default('') });
const updateSchema = z.object({
  title: z.string().max(200).optional(),
  observations: z.array(sectionSchema).optional(),
  supportQuestionKey: z.string().nullable().optional(),
  visibility: z
    .object({
      visibleQuestionKeys: z.array(z.string()).optional(),
      mapAnswerKeys: z.array(z.string()).optional(),
      showMap: z.boolean().optional(),
    })
    .optional(),
});

async function loadCampaignInOrg(orgId, campaignId) {
  if (!mongoose.isValidObjectId(campaignId)) return null;
  return Campaign.findOne({ _id: campaignId, organizationId: orgId }).lean();
}
async function resolveTemplate(orgId, campaign) {
  if (!campaign?.surveyTemplateId) return null;
  return SurveyTemplate.findOne({ _id: campaign.surveyTemplateId, organizationId: orgId }).lean();
}
function choiceQuestionKeys(template) {
  if (!template) return [];
  return (template.questions || [])
    .filter((q) => q.type === 'single_choice' || q.type === 'multiple_choice')
    .map((q) => q.key);
}

// Compute both windows into report.stats: cumulative = everything through the week's end;
// period = just the week. Same aggregation code, two ranges.
async function computeBothWindows(report, campaign, template) {
  const orgId = report.organizationId;
  const campaignId = report.campaignId;
  const [cumulative, period] = await Promise.all([
    computeWindowStats({
      orgId,
      campaignId,
      range: { $lt: report.rangeEndUtc },
      template,
      supportQuestionKey: report.supportQuestionKey,
    }),
    computeWindowStats({
      orgId,
      campaignId,
      range: { $gte: report.rangeStartUtc, $lt: report.rangeEndUtc },
      template,
      supportQuestionKey: report.supportQuestionKey,
    }),
  ]);
  report.stats = { cumulative, period };
  report.markModified('stats');
}

function reflagSupport(report) {
  for (const win of ['cumulative', 'period']) {
    const arr = report.stats?.[win]?.surveyBreakdowns || [];
    for (const b of arr) {
      b.isSupportQuestion = report.supportQuestionKey
        ? b.questionKey === report.supportQuestionKey
        : false;
    }
  }
  report.markModified('stats');
}

// Compact row for the report list (drops the heavy per-window breakdowns).
function adminListRow(r) {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    title: r.title || '',
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    timeZone: r.timeZone,
    status: r.status,
    mapPointCount: r.mapPointCount || 0,
    viewCount: r.viewCount || 0,
    lastViewedAt: r.lastViewedAt || null,
    publishedAt: r.publishedAt || null,
    updatedAt: r.updatedAt,
    headline: {
      cumulative: r.stats?.cumulative?.totals || {},
      period: r.stats?.period?.totals || {},
    },
  };
}

// ── Share links ──────────────────────────────────────────────────────────────
// Public, revocable per-campaign links to the campaign's published reports (see routes/public/share.js).
// NOTE: these literal `/shares` routes are declared BEFORE the `/:id` report routes below, or Express
// would match `:id = "shares"` first.

function newShareToken() {
  return randomBytes(24).toString('base64url'); // ~32 url-safe chars
}
function shareRow(s) {
  return {
    id: String(s._id),
    campaignId: String(s.campaignId),
    token: s.token,
    label: s.label || '',
    hasPassword: !!s.passwordHash,
    isActive: s.isActive,
    lastAccessedAt: s.lastAccessedAt || null,
    createdAt: s.createdAt,
  };
}
const shareCreateSchema = z.object({
  campaignId: z.string(),
  label: z.string().max(120).optional(),
  password: z.string().min(1).max(200).optional(),
});
const shareUpdateSchema = z.object({
  label: z.string().max(120).optional(),
  // password: a string sets/replaces it; null or '' clears it; omitted = unchanged.
  password: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.get('/shares', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.query.campaignId || !mongoose.isValidObjectId(req.query.campaignId)) {
      return res.status(400).json({ error: 'campaignId required' });
    }
    const shares = await ReportShareLink.find({
      organizationId: activeOrgId(req),
      campaignId: req.query.campaignId,
    })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ shares: shares.map(shareRow) });
  } catch (err) {
    next(err);
  }
});

router.post('/shares', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = shareCreateSchema.parse(req.body);
    const campaign = await loadCampaignInOrg(orgId, data.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found in this org' });
    const share = await ReportShareLink.create({
      organizationId: orgId,
      campaignId: campaign._id,
      token: newShareToken(),
      label: data.label || '',
      passwordHash: data.password ? await bcrypt.hash(data.password, 10) : null,
      createdBy: req.user._id,
    });
    res.status(201).json({ share: shareRow(share) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

async function loadShareInOrg(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const share = await ReportShareLink.findOne({ _id: req.params.id, organizationId: activeOrgId(req) });
  if (!share) {
    res.status(404).json({ error: 'Share link not found' });
    return null;
  }
  return share;
}

router.patch('/shares/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    const data = shareUpdateSchema.parse(req.body);
    if (data.label !== undefined) share.label = data.label;
    if (data.isActive !== undefined) share.isActive = data.isActive;
    if (data.password !== undefined) {
      share.passwordHash = data.password ? await bcrypt.hash(data.password, 10) : null;
    }
    await share.save();
    res.json({ share: shareRow(share) });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.post('/shares/:id/rotate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    share.token = newShareToken(); // invalidates the old URL
    await share.save();
    res.json({ share: shareRow(share) });
  } catch (err) {
    next(err);
  }
});

router.delete('/shares/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    await ReportShareLink.deleteOne({ _id: share._id, organizationId: activeOrgId(req) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Create a draft for a campaign + week.
router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = createSchema.parse(req.body);
    if (data.weekStart > data.weekEnd) {
      return res.status(400).json({ error: 'weekStart must be on or before weekEnd' });
    }
    const campaign = await loadCampaignInOrg(orgId, data.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found in this org' });

    const tz = campaign.timeZone || 'America/New_York';
    const range = zonedDayRange(data.weekStart, data.weekEnd, tz);
    if (!range.$gte || !range.$lt) {
      return res.status(400).json({ error: 'Invalid week range' });
    }
    const template = await resolveTemplate(orgId, campaign);
    const keys = choiceQuestionKeys(template);

    const report = new ClientReport({
      organizationId: orgId,
      campaignId: campaign._id,
      campaignType: campaign.type,
      title: data.title || '',
      weekStart: data.weekStart,
      weekEnd: data.weekEnd,
      timeZone: tz,
      rangeStartUtc: range.$gte,
      rangeEndUtc: range.$lt,
      status: 'draft',
      supportQuestionKey: null,
      visibility: { visibleQuestionKeys: keys, mapAnswerKeys: keys, showMap: true },
      createdBy: req.user._id,
    });
    await computeBothWindows(report, campaign, template);
    await report.save();
    res.status(201).json({ report });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// List reports (optionally for one campaign), newest week first.
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const filter = { organizationId: orgId };
    if (req.query.campaignId) {
      if (!mongoose.isValidObjectId(req.query.campaignId)) {
        return res.status(400).json({ error: 'Invalid campaignId' });
      }
      filter.campaignId = new mongoose.Types.ObjectId(req.query.campaignId);
    }
    const reports = await ClientReport.find(filter).sort({ weekStart: -1, createdAt: -1 }).lean();
    res.json({ reports: reports.map(adminListRow) });
  } catch (err) {
    next(err);
  }
});

// Full draft/published doc (admin view).
router.get('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const report = await ClientReport.findOne({ _id: req.params.id, organizationId: activeOrgId(req) });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    // Campaign + org names let the builder's PDF export carry the same header the client sees.
    const campaign = await Campaign.findById(report.campaignId, { name: 1 }).lean();
    res.json({ report, campaignName: campaign?.name || '', orgName: req.activeOrg?.name || '' });
  } catch (err) {
    next(err);
  }
});

// Edit observations / visibility / support question (drafts only).
router.patch('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const report = await ClientReport.findOne({ _id: req.params.id, organizationId: activeOrgId(req) });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft reports can be edited. Unpublish first.' });
    }
    const data = updateSchema.parse(req.body);
    if (data.title !== undefined) report.title = data.title;
    if (data.observations !== undefined) report.observations = data.observations;
    if (data.visibility) {
      if (data.visibility.visibleQuestionKeys !== undefined)
        report.visibility.visibleQuestionKeys = data.visibility.visibleQuestionKeys;
      if (data.visibility.mapAnswerKeys !== undefined)
        report.visibility.mapAnswerKeys = data.visibility.mapAnswerKeys;
      if (data.visibility.showMap !== undefined) report.visibility.showMap = data.visibility.showMap;
    }
    if (data.supportQuestionKey !== undefined) {
      report.supportQuestionKey = data.supportQuestionKey || null;
      reflagSupport(report);
    }
    await report.save();
    res.json({ report });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Re-run the aggregations into both windows (drafts only).
router.post('/:id/recompute', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const orgId = activeOrgId(req);
    const report = await ClientReport.findOne({ _id: req.params.id, organizationId: orgId });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft reports can be recomputed. Unpublish first.' });
    }
    const campaign = await loadCampaignInOrg(orgId, report.campaignId);
    if (!campaign) return res.status(400).json({ error: 'Campaign no longer exists' });
    const template = await resolveTemplate(orgId, campaign);
    await computeBothWindows(report, campaign, template);
    reflagSupport(report);
    await report.save();
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

// Preview EXACTLY what the client will see (shaped + visibility-filtered).
router.get('/:id/preview', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const report = await ClientReport.findOne({ _id: req.params.id, organizationId: activeOrgId(req) });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json({ report: shapeReportForClient(report), survey: mapFilterSurvey(report) });
  } catch (err) {
    next(err);
  }
});

// Preview the map BEFORE publish — builds points live (not persisted) so the operator can
// see coverage while still editing.
router.get('/:id/preview/map', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const orgId = activeOrgId(req);
    const report = await ClientReport.findOne({ _id: req.params.id, organizationId: orgId });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const campaign = await loadCampaignInOrg(orgId, report.campaignId);
    if (!campaign) return res.status(400).json({ error: 'Campaign no longer exists' });
    const { points } = await buildFrozenMapPoints({
      report,
      campaign,
      mapAnswerKeys: report.visibility?.mapAnswerKeys || [],
    });
    res.json({ households: shapeMapPoints(points), total: points.length });
  } catch (err) {
    next(err);
  }
});

// Publish = freeze. Final recompute + snapshot the map points (canvasser-stripped, status
// as-of week end), then lock the report to 'published'.
router.post('/:id/publish', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const orgId = activeOrgId(req);
    const report = await ClientReport.findOne({ _id: req.params.id, organizationId: orgId });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const campaign = await loadCampaignInOrg(orgId, report.campaignId);
    if (!campaign) return res.status(400).json({ error: 'Campaign no longer exists' });
    const template = await resolveTemplate(orgId, campaign);

    report.campaignType = campaign.type; // backfill on (re)publish for older drafts
    await computeBothWindows(report, campaign, template);
    reflagSupport(report);

    const { points, coverage, count } = await buildFrozenMapPoints({
      report,
      campaign,
      mapAnswerKeys: report.visibility?.mapAnswerKeys || [],
    });
    await ClientReportMapPoint.deleteMany({ clientReportId: report._id });
    if (points.length) await ClientReportMapPoint.insertMany(points);

    report.stats.cumulative.coverage = coverage;
    report.markModified('stats');
    report.mapPointCount = count;
    report.status = 'published';
    report.publishedAt = new Date();
    report.publishedBy = req.user._id;
    await report.save();
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

// Back to draft (keeps the frozen points; republishing rebuilds them).
router.post('/:id/unpublish', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const report = await ClientReport.findOneAndUpdate(
      { _id: req.params.id, organizationId: activeOrgId(req) },
      { status: 'draft', publishedAt: null, publishedBy: null },
      { new: true }
    );
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const orgId = activeOrgId(req);
    const report = await ClientReport.findOne({ _id: req.params.id, organizationId: orgId });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    await ClientReportMapPoint.deleteMany({ clientReportId: report._id });
    await ClientReport.deleteOne({ _id: report._id, organizationId: orgId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
