import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Campaign } from '../../models/Campaign.js';
import { classifyQuestionEdits } from '../../services/surveys/diffQuestions.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

const questionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['single_choice', 'multiple_choice', 'text']),
  options: z.array(z.string()).optional().default([]),
  required: z.boolean().optional().default(false),
  order: z.number().optional().default(0),
});

const upsertSchema = z.object({
  name: z.string().min(1),
  intro: z.string().optional().default(''),
  closing: z.string().optional().default(''),
  questions: z.array(questionSchema).default([]),
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

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const [surveys, campaigns, responseCounts] = await Promise.all([
      SurveyTemplate.find({ organizationId: orgId }).sort({ createdAt: -1 }).lean(),
      Campaign.find({ organizationId: orgId, surveyTemplateId: { $ne: null } })
        .select('name surveyTemplateId isActive')
        .lean(),
      SurveyResponse.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$surveyTemplateId', count: { $sum: 1 } } },
      ]),
    ]);
    const usedBy = new Map();
    for (const c of campaigns) {
      const k = String(c.surveyTemplateId);
      if (!usedBy.has(k)) usedBy.set(k, []);
      usedBy.get(k).push({ id: String(c._id), name: c.name, isActive: c.isActive });
    }
    const counts = new Map(responseCounts.map((r) => [String(r._id), r.count]));
    res.json({
      surveys: surveys.map((s) => {
        const responseCount = counts.get(String(s._id)) || 0;
        return {
          ...s,
          usedByCampaigns: usedBy.get(String(s._id)) || [],
          responseCount,
          hasResponses: responseCount > 0,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const data = upsertSchema.parse(req.body);
    const survey = await SurveyTemplate.create({
      ...data,
      organizationId: activeOrgId(req),
      createdBy: req.user._id,
      version: 1,
    });
    res.status(201).json({ survey });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:surveyId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const data = upsertSchema.partial().parse(req.body);
    const existing = await SurveyTemplate.findOne({
      _id: req.params.surveyId,
      organizationId: activeOrgId(req),
    });
    if (!existing) return res.status(404).json({ error: 'Survey not found' });

    // Guard: once responses exist, editing the question structure can corrupt
    // existing reports (answers join to the current questions by `key`). Block
    // destructive question edits; safe edits (name/intro/closing, add question,
    // add option, label/required, reorder) still go through. Duplicate to make
    // structural changes against a fresh template.
    if (data.questions) {
      const hasResponses = await SurveyResponse.exists({ surveyTemplateId: existing._id });
      if (hasResponses) {
        const reasons = classifyQuestionEdits(existing.questions, data.questions);
        if (reasons.length) {
          return res.status(409).json({
            error: 'This survey has responses, so its question structure is locked to protect existing reports. Duplicate it to make these changes.',
            code: 'survey-has-responses',
            reasons,
          });
        }
      }
    }

    Object.assign(existing, data);
    if (data.questions) existing.version = (existing.version || 1) + 1;
    await existing.save();

    res.json({ survey: existing });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Clone a survey into a fresh, fully-editable template (version reset, inactive,
// no campaign link). Used as the escape hatch when an in-use survey needs
// structural changes — the original stays intact so its reports keep working.
router.post('/:surveyId/duplicate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const original = await SurveyTemplate.findOne({
      _id: req.params.surveyId,
      organizationId: orgId,
    }).lean();
    if (!original) return res.status(404).json({ error: 'Survey not found' });

    const copy = await SurveyTemplate.create({
      organizationId: orgId,
      name: `${original.name} (Copy)`,
      isActive: false,
      version: 1,
      intro: original.intro || '',
      closing: original.closing || '',
      questions: original.questions || [],
      createdBy: req.user._id,
    });
    res.status(201).json({ survey: copy });
  } catch (err) {
    next(err);
  }
});

export default router;
