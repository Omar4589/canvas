import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Campaign } from '../../models/Campaign.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Household } from '../../models/Household.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['survey', 'lit_drop']),
  state: z.string().min(2).max(2),
  surveyTemplateId: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

const updateSchema = createSchema.partial();

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

async function withCounts(campaigns) {
  const ids = campaigns.map((c) => c._id);
  const [householdAgg, surveyAgg, activityAgg] = await Promise.all([
    Household.aggregate([
      { $match: { campaignId: { $in: ids } } },
      { $group: { _id: { campaignId: '$campaignId', status: '$status' }, count: { $sum: 1 } } },
    ]),
    SurveyResponse.aggregate([
      { $match: { campaignId: { $in: ids } } },
      { $group: { _id: '$campaignId', count: { $sum: 1 } } },
    ]),
    CanvassActivity.aggregate([
      { $match: { campaignId: { $in: ids }, actionType: 'lit_dropped' } },
      { $group: { _id: '$campaignId', count: { $sum: 1 } } },
    ]),
  ]);

  const byCampaign = new Map();
  for (const c of campaigns) {
    byCampaign.set(String(c._id), {
      households: 0,
      knocked: 0,
      surveysSubmitted: 0,
      litDropped: 0,
    });
  }
  for (const row of householdAgg) {
    const k = String(row._id.campaignId);
    const slot = byCampaign.get(k);
    if (!slot) continue;
    slot.households += row.count;
    if (row._id.status !== 'unknocked') slot.knocked += row.count;
  }
  for (const row of surveyAgg) {
    const slot = byCampaign.get(String(row._id));
    if (slot) slot.surveysSubmitted = row.count;
  }
  for (const row of activityAgg) {
    const slot = byCampaign.get(String(row._id));
    if (slot) slot.litDropped = row.count;
  }
  return campaigns.map((c) => ({
    ...c,
    counts: byCampaign.get(String(c._id)) || {
      households: 0,
      knocked: 0,
      surveysSubmitted: 0,
      litDropped: 0,
    },
  }));
}

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const campaigns = await Campaign.find({ organizationId: activeOrgId(req) })
      .sort({ isActive: -1, createdAt: -1 })
      .populate('surveyTemplateId', 'name version')
      .lean();
    const withMetrics = await withCounts(campaigns);
    res.json({ campaigns: withMetrics });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = createSchema.parse(req.body);
    if (data.type === 'survey') {
      if (!data.surveyTemplateId || !mongoose.isValidObjectId(data.surveyTemplateId)) {
        return res.status(400).json({ error: 'Survey campaigns require a surveyTemplateId.' });
      }
      const tmpl = await SurveyTemplate.findOne({ _id: data.surveyTemplateId, organizationId: orgId });
      if (!tmpl) return res.status(400).json({ error: 'Survey template not found in this org.' });
    }
    const campaign = await Campaign.create({
      organizationId: orgId,
      name: data.name,
      type: data.type,
      state: data.state,
      surveyTemplateId: data.type === 'survey' ? data.surveyTemplateId : null,
      isActive: data.isActive,
      createdBy: req.user._id,
    });
    res.status(201).json({ campaign });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:campaignId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = updateSchema.parse(req.body);
    const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: orgId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    if (data.name !== undefined) campaign.name = data.name;
    if (data.state !== undefined) campaign.state = data.state;
    if (data.isActive !== undefined) campaign.isActive = data.isActive;
    if (data.type !== undefined) campaign.type = data.type;
    if (data.surveyTemplateId !== undefined) {
      if (data.surveyTemplateId) {
        if (!mongoose.isValidObjectId(data.surveyTemplateId)) {
          return res.status(400).json({ error: 'Invalid surveyTemplateId.' });
        }
        const tmpl = await SurveyTemplate.findOne({
          _id: data.surveyTemplateId,
          organizationId: orgId,
        });
        if (!tmpl) return res.status(400).json({ error: 'Survey template not found in this org.' });
      }
      campaign.surveyTemplateId = data.surveyTemplateId || null;
    }
    if (campaign.type === 'survey' && !campaign.surveyTemplateId) {
      return res.status(400).json({ error: 'Survey campaigns require a surveyTemplateId.' });
    }
    await campaign.save();
    res.json({ campaign });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
