import { Router } from 'express';
import mongoose from 'mongoose';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds, canManageCampaign } from '../../services/authz/campaignManagement.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Effort } from '../../models/Effort.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { zonedDayRange } from '../../utils/timezone.js';
import { computeWindowStats, buildFrozenMapPoints } from '../../services/reports/computeReport.js';
import { countOpenMockFlags } from '../../services/reports/campaignSummaries.js';
import {
  shapeReportForClient,
  shapeMapPoints,
  mapFilterSurvey,
} from '../../services/reports/clientReportView.js';

// Admin report BUILDER. Create a weekly draft (pre-computes the dual-window stats), edit the
// observations / visibility / support question, preview it exactly as the client will see it,
// then publish — which FREEZES the numbers and snapshots the map. See docs/CLIENT_PORTAL.md.
const router = Router();
// Client reports are per-campaign, so team leads may build them — but only for a
// campaign they manage. Each handler authorizes via manages() on the report/share/
// campaign's campaignId (admins/super are unscoped).
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}

// True if the requester may manage `campaignId`; otherwise writes 403 and returns false.
async function manages(req, res, campaignId) {
  if (await canManageCampaign(req, campaignId)) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
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
  // Optional walk-list scope; omitted = the whole campaign (every pre-existing report).
  effortId: z.string().optional(),
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
  // NOT_DELETING: a mid-delete campaign reads as gone (services/campaigns/deletionState.js).
  return Campaign.findOne({ _id: campaignId, organizationId: orgId, ...NOT_DELETING }).lean();
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
  // Walk-list scope rides on the report itself, so create AND recompute stay scoped.
  const effortId = report.effortId || null;
  const [cumulative, period] = await Promise.all([
    computeWindowStats({
      orgId,
      campaignId,
      effortId,
      range: { $lt: report.rangeEndUtc },
      campaignType: campaign.type,
      template,
      supportQuestionKey: report.supportQuestionKey,
    }),
    computeWindowStats({
      orgId,
      campaignId,
      effortId,
      range: { $gte: report.rangeStartUtc, $lt: report.rangeEndUtc },
      campaignType: campaign.type,
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
    effortName: r.effortName || null, // walk-list scope label; null = whole campaign
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
    expiresAt: s.expiresAt || null,
    // Flags a link created before password+expiry were required, so the UI can nag rather than
    // silently break a client's live URL.
    isLegacyOpen: !s.passwordHash || !s.expiresAt,
    isActive: s.isActive,
    lastAccessedAt: s.lastAccessedAt || null,
    createdAt: s.createdAt,
  };
}

// How long a new share link lives. 90 days comfortably outlasts a reporting cycle; rotating is one
// click. Override per-link with `expiresInDays`.
const SHARE_DEFAULT_DAYS = Number(process.env.SHARE_LINK_DEFAULT_DAYS || 90);
const SHARE_MAX_DAYS = 365;

// A readable, high-entropy password for the operator to hand the client. Generated when they don't
// supply one, because "optional password" in practice meant "no password" — and the report behind
// the link carries street addresses with survey answers attached.
// ~62^12 ≈ 3e21 combinations; the ambiguous glyphs are dropped so it survives being read aloud.
function generateSharePassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const shareCreateSchema = z.object({
  campaignId: z.string(),
  label: z.string().max(120).optional(),
  // Still optional in the API — but the ROUTE now generates one when it's absent, rather than
  // creating an open link. See generateSharePassword.
  password: z.string().min(1).max(200).optional(),
  expiresInDays: z.number().int().min(1).max(SHARE_MAX_DAYS).optional(),
});
const shareUpdateSchema = z.object({
  label: z.string().max(120).optional(),
  // password: a non-empty string sets/replaces it; omitted = unchanged. REMOVAL IS NOT SUPPORTED:
  // the published privacy policy says report links "are protected by a password", and a link that
  // can be quietly un-passworded after creation would falsify that sentence. Rotate the password
  // (or the whole link) instead. Null is still accepted by the schema so the guard below can
  // return a specific error rather than a generic zod 400.
  password: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.get('/shares', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.query.campaignId || !mongoose.isValidObjectId(req.query.campaignId)) {
      return res.status(400).json({ error: 'campaignId required' });
    }
    if (!(await manages(req, res, req.query.campaignId))) return;
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
    if (!(await manages(req, res, campaign._id))) return;
    // Every new link gets a password and an expiry. If the operator didn't set a password we mint
    // one and return it ONCE, in the clear, in this response — it is bcrypt-hashed at rest and can
    // never be shown again. Rotating the link is how you recover a lost one.
    const generated = data.password ? null : generateSharePassword();
    const password = data.password || generated;
    const days = data.expiresInDays || SHARE_DEFAULT_DAYS;

    const share = await ReportShareLink.create({
      organizationId: orgId,
      campaignId: campaign._id,
      token: newShareToken(),
      label: data.label || '',
      passwordHash: await bcrypt.hash(password, 10),
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      createdBy: req.user._id,
    });
    res.status(201).json({
      share: shareRow(share),
      // Present only when WE generated it. Show it to the operator once, then it's gone.
      ...(generated ? { generatedPassword: generated } : {}),
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Kill every pre-existing OPEN link — no password, or no expiry — in one action.
//
// Deliberately NOT automatic. Auto-expiring links created before the rules changed would take a
// client's live report offline with no warning, under their feet, from a deploy they didn't know
// about. So legacy links keep working and are flagged `isLegacyOpen`; this is the operator's switch
// to kill them once they've told their customers. The decision of WHEN is a business one.
router.post('/shares/revoke-legacy', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const filter = {
      organizationId: orgId,
      isActive: true,
      $or: [{ passwordHash: null }, { expiresAt: null }],
    };
    const doomed = await ReportShareLink.find(filter, 'label campaignId token').lean();

    // Dry run unless explicitly confirmed — you should be able to see what you're about to break.
    if (req.body?.confirm !== true) {
      return res.json({
        dryRun: true,
        wouldRevoke: doomed.length,
        links: doomed.map((s) => ({ id: String(s._id), label: s.label, campaignId: String(s.campaignId) })),
      });
    }

    const r = await ReportShareLink.updateMany(filter, { $set: { isActive: false } });
    res.json({ revoked: r.modifiedCount || 0 });
  } catch (err) {
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
  if (!(await manages(req, res, share.campaignId))) return null;
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
      if (!data.password) {
        return res.status(400).json({
          error: 'A password cannot be removed from a link — replace it, or rotate the link.',
          code: 'SHARE_PASSWORD_REQUIRED',
        });
      }
      share.passwordHash = await bcrypt.hash(data.password, 10);
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
    if (!(await manages(req, res, campaign._id))) return;

    const tz = campaign.timeZone || 'America/New_York';
    const range = zonedDayRange(data.weekStart, data.weekEnd, tz);
    if (!range.$gte || !range.$lt) {
      return res.status(400).json({ error: 'Invalid week range' });
    }
    // Optional walk-list scope — the effort must belong to THIS campaign. Its name is frozen
    // onto the report so the public page never needs a live Effort lookup (see the model).
    let effort = null;
    if (data.effortId) {
      if (!mongoose.isValidObjectId(data.effortId)) {
        return res.status(400).json({ error: 'Invalid effortId' });
      }
      effort = await Effort.findOne({ _id: data.effortId, campaignId: campaign._id }, { name: 1 }).lean();
      if (!effort) return res.status(400).json({ error: 'Walk list not found in this campaign' });
    }

    const template = await resolveTemplate(orgId, campaign);
    const keys = choiceQuestionKeys(template);

    const report = new ClientReport({
      organizationId: orgId,
      campaignId: campaign._id,
      campaignType: campaign.type,
      title: data.title || '',
      effortId: effort ? effort._id : null,
      effortName: effort ? effort.name : null,
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
      if (!isOrgAdmin(req) && !(await canManageCampaign(req, req.query.campaignId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      filter.campaignId = new mongoose.Types.ObjectId(req.query.campaignId);
    } else if (!isOrgAdmin(req)) {
      // A lead's report list spans only the campaigns they manage.
      filter.campaignId = { $in: await managedCampaignIds(req) };
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
    if (!(await manages(req, res, report.campaignId))) return;
    // Campaign + org names let the builder's PDF export carry the same header the client sees.
    const campaign = await Campaign.findById(report.campaignId, { name: 1 }).lean();
    // Soft publish gate: unreviewed mock-GPS flags inside this report's CUMULATIVE window.
    // A response sibling on purpose — a live count stored on the doc would go stale; the
    // only persisted copy is openMockFlagsAtPublish, stamped at freeze time. Never shaped
    // into the client view (shapeReportForClient enumerates its fields).
    const openMockFlags = await countOpenMockFlags({
      organizationId: activeOrgId(req),
      campaignId: report.campaignId,
      timestamp: { $lt: report.rangeEndUtc },
    });
    res.json({ report, campaignName: campaign?.name || '', orgName: req.activeOrg?.name || '', openMockFlags });
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
    if (!(await manages(req, res, report.campaignId))) return;
    if (report.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft reports can be edited. Unpublish first.' });
    }
    const data = updateSchema.parse(req.body);
    if (data.title !== undefined) report.title = data.title;
    if (data.observations !== undefined) report.observations = data.observations;
    if (data.visibility) {
      if (data.visibility.visibleQuestionKeys !== undefined)
        report.visibility.visibleQuestionKeys = data.visibility.visibleQuestionKeys;

      // mapAnswerKeys pins an answer to a household's STREET ADDRESS on a public, unauthenticated
      // link. A free-text answer there publishes whatever a canvasser typed, verbatim, next to
      // somebody's home — so the map may only ever carry CHOICE answers, whose value set the
      // operator picked in advance.
      //
      // The default already did the right thing (line ~297 seeds these from choiceQuestionKeys).
      // The bug was that nothing enforced it on the WRITE path: the zod schema took
      // `z.array(z.string())`, and buildFrozenMapPoints filters purely on key membership — so any
      // key an operator sent, including a text question's, was published. Same helper, now used as
      // the guard it should always have been.
      if (data.visibility.mapAnswerKeys !== undefined) {
        const campaign = await Campaign.findById(report.campaignId).lean();
        const template = await resolveTemplate(activeOrgId(req), campaign);
        const allowed = new Set(choiceQuestionKeys(template));
        const rejected = data.visibility.mapAnswerKeys.filter((k) => !allowed.has(k));
        if (rejected.length) {
          return res.status(400).json({
            error:
              'The report map can only show multiple-choice answers. These are free-text (or unknown) ' +
              `questions and cannot be pinned to an address: ${rejected.join(', ')}`,
            code: 'MAP_ANSWER_KEYS_NOT_CHOICE',
            rejected,
          });
        }
        report.visibility.mapAnswerKeys = data.visibility.mapAnswerKeys;
      }

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
    if (!(await manages(req, res, report.campaignId))) return;
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
    if (!(await manages(req, res, report.campaignId))) return;
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
    if (!(await manages(req, res, report.campaignId))) return;
    const campaign = await loadCampaignInOrg(orgId, report.campaignId);
    if (!campaign) return res.status(400).json({ error: 'Campaign no longer exists' });
    const template = await resolveTemplate(orgId, campaign);
    const { points } = await buildFrozenMapPoints({
      report,
      campaign,
      template,
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
    if (!(await manages(req, res, report.campaignId))) return;
    const campaign = await loadCampaignInOrg(orgId, report.campaignId);
    if (!campaign) return res.status(400).json({ error: 'Campaign no longer exists' });
    const template = await resolveTemplate(orgId, campaign);

    report.campaignType = campaign.type; // backfill on (re)publish for older drafts
    await computeBothWindows(report, campaign, template);
    reflagSupport(report);

    // Soft gate audit trail: how many unreviewed mock-GPS flags sat inside this report's
    // cumulative window at the moment of freeze. Publish is never blocked — a mock flag
    // can be a false alarm (QA phone, dev mode) — but the number is recorded.
    report.openMockFlagsAtPublish = await countOpenMockFlags({
      organizationId: orgId,
      campaignId: report.campaignId,
      timestamp: { $lt: report.rangeEndUtc },
    });

    const { points, coverage, count } = await buildFrozenMapPoints({
      report,
      campaign,
      template,
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
    const orgId = activeOrgId(req);
    // Authorize on the report's campaign BEFORE mutating it.
    const existing = await ClientReport.findOne(
      { _id: req.params.id, organizationId: orgId },
      { campaignId: 1 }
    ).lean();
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    if (!(await manages(req, res, existing.campaignId))) return;
    const report = await ClientReport.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { status: 'draft', publishedAt: null, publishedBy: null },
      { new: true }
    );
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
    if (!(await manages(req, res, report.campaignId))) return;
    await ClientReportMapPoint.deleteMany({ clientReportId: report._id });
    await ClientReport.deleteOne({ _id: report._id, organizationId: orgId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
