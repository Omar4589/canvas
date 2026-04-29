import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

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
  isActive: z.boolean().optional().default(false),
  intro: z.string().optional().default(''),
  closing: z.string().optional().default(''),
  questions: z.array(questionSchema).default([]),
});

router.get('/', async (req, res, next) => {
  try {
    const surveys = await SurveyTemplate.find().sort({ createdAt: -1 });
    res.json({ surveys });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = upsertSchema.parse(req.body);
    if (data.isActive) {
      await SurveyTemplate.updateMany({ isActive: true }, { $set: { isActive: false } });
    }
    const survey = await SurveyTemplate.create({
      ...data,
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
    const data = upsertSchema.partial().parse(req.body);
    const existing = await SurveyTemplate.findById(req.params.surveyId);
    if (!existing) return res.status(404).json({ error: 'Survey not found' });

    if (data.isActive === true) {
      await SurveyTemplate.updateMany(
        { _id: { $ne: existing._id }, isActive: true },
        { $set: { isActive: false } }
      );
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

export default router;
