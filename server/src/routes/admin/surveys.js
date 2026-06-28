import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Campaign } from '../../models/Campaign.js';
import { classifyQuestionEdits } from '../../services/surveys/diffQuestions.js';
import { canonicalizeTags } from '../../services/surveys/tags.js';
import { ensureTags } from '../../services/surveys/tagOps.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

const optionSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1),
  tag: z.string().nullable().optional(),
  script: z.string().nullable().optional(),
  retired: z.boolean().optional(),
  order: z.number().optional(),
});

// One visibleIf rule. is/is_not compare against exactly one option; any_of needs
// at least one; answered/not_answered carry no optionIds. Cross-question integrity
// (earlier-reference, op-vs-type, optionId existence) is enforced after reconcile.
const ruleSchema = z
  .object({
    questionKey: z.string().min(1),
    op: z.enum(['is', 'is_not', 'any_of', 'answered', 'not_answered']),
    optionIds: z.array(z.string()).default([]),
  })
  .refine(
    (r) => {
      if (r.op === 'is' || r.op === 'is_not') return r.optionIds.length === 1;
      if (r.op === 'any_of') return r.optionIds.length >= 1;
      return true;
    },
    { message: "Rule op 'is'/'is_not' needs exactly one optionId; 'any_of' needs at least one." }
  );

const questionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['single_choice', 'multiple_choice', 'text']),
  options: z.array(optionSchema).optional().default([]),
  required: z.boolean().optional().default(false),
  order: z.number().optional().default(0),
  retired: z.boolean().optional(),
  visibleIf: z
    .object({ logic: z.enum(['all', 'any']), rules: z.array(ruleSchema).default([]) })
    .nullable()
    .optional(),
  otherOption: z.boolean().optional(),
  refusalOption: z.boolean().optional(),
});

const upsertSchema = z.object({
  name: z.string().min(1),
  intro: z.string().optional().default(''),
  closing: z.string().optional().default(''),
  questions: z.array(questionSchema).default([]),
  tags: z.array(z.string()).optional().default([]),
});

// Stable option-id helpers — mirror src/migrations/migrateSurveyOptionIds.js
// (and the builder's deriveKey collision rule) so ids generated here line up
// with everything else that references them.
function slugify(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

// Unique option id within one question.
function optionId(text, used) {
  const base = slugify(text) || 'opt';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

// Give every option in every question a stable id, generating one only for
// options that lack it (existing ids are preserved and reserved against
// collisions). Mutates/returns the questions array shape unchanged otherwise.
function assignOptionIds(questions = []) {
  return (questions || []).map((q) => {
    const used = new Set();
    for (const o of q.options || []) {
      if (o && o.id) used.add(o.id);
    }
    const options = (q.options || []).map((o) => {
      if (o && o.id) return o;
      return { ...o, id: optionId(o?.text, used) };
    });
    return { ...q, options };
  });
}

// Reconcile incoming questions against the existing survey so soft-retired
// history is never lost: match by question key, preserve existing option ids,
// generate ids for new (id-less) options, and re-append anything the payload
// dropped as retired:true (existing options absent from a question, and
// existing questions absent from the array) keeping their ids + text.
function reconcileQuestions(existingQuestions = [], incomingQuestions = []) {
  const existingByKey = new Map((existingQuestions || []).map((q) => [q.key, q]));
  const incomingKeys = new Set((incomingQuestions || []).map((q) => q.key));

  const reconciled = (incomingQuestions || []).map((inc) => {
    const prev = existingByKey.get(inc.key);
    const used = new Set();
    for (const o of inc.options || []) {
      if (o && o.id) used.add(o.id);
    }
    const options = (inc.options || []).map((o) => {
      if (o && o.id) return o;
      return { ...o, id: optionId(o?.text, used) };
    });

    // Re-append existing options that the payload dropped, as retired.
    if (prev) {
      const incomingOptionIds = new Set(options.map((o) => o.id));
      for (const po of prev.options || []) {
        const plain = po && po.toObject ? po.toObject() : po;
        const pid = plain && typeof plain === 'object' ? plain.id : null;
        if (pid && !incomingOptionIds.has(pid)) {
          options.push({ ...plain, retired: true });
        }
      }
    }

    return { ...inc, options };
  });

  // Re-append existing questions the payload dropped, as retired.
  for (const eq of existingQuestions || []) {
    if (!incomingKeys.has(eq.key)) {
      reconciled.push({ ...(eq.toObject ? eq.toObject() : eq), retired: true });
    }
  }

  return reconciled;
}

// Cross-question integrity for visibleIf, run on the FINAL (reconciled) questions.
// Every rule on a non-retired question must reference a STRICTLY EARLIER non-retired
// question (forward/self/dangling => error, which also makes cycles impossible),
// the op must suit the referenced question's type (text questions support only
// answered/not_answered), and is/is_not/any_of optionIds must exist on the
// referenced question (retired-inclusive) or be '__other__' when it allows Other.
// Returns an error message string, or null when valid.
function validateVisibleIfIntegrity(questions = []) {
  const active = questions.filter((q) => q && !q.retired);
  const posByKey = new Map(active.map((q, i) => [q.key, i]));
  const qByKey = new Map(active.map((q) => [q.key, q]));

  for (let i = 0; i < active.length; i++) {
    const q = active[i];
    const rules = (q.visibleIf && q.visibleIf.rules) || [];
    for (const rule of rules) {
      const refPos = posByKey.get(rule.questionKey);
      if (refPos == null) {
        return `Question "${q.label}" has a condition referencing an unknown or retired question "${rule.questionKey}".`;
      }
      if (refPos >= i) {
        return `Question "${q.label}" has a condition referencing question "${rule.questionKey}", which must come earlier in the survey.`;
      }
      const ref = qByKey.get(rule.questionKey);
      if (ref.type === 'text' && rule.op !== 'answered' && rule.op !== 'not_answered') {
        return `Question "${q.label}" has a condition on text question "${ref.label}", which only supports answered / not answered.`;
      }
      if (rule.op === 'is' || rule.op === 'is_not' || rule.op === 'any_of') {
        const validIds = new Set((ref.options || []).map((o) => o.id));
        if (ref.otherOption) validIds.add('__other__');
        for (const id of rule.optionIds || []) {
          if (!validIds.has(id)) {
            return `Question "${q.label}" has a condition referencing an option "${id}" that doesn't exist on question "${ref.label}".`;
          }
        }
      }
    }
  }
  return null;
}

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
    const withIds = assignOptionIds(data.questions);
    const integrityError = validateVisibleIfIntegrity(withIds);
    if (integrityError) return res.status(400).json({ error: integrityError });
    const { tags, questions: finalQuestions } = canonicalizeTags(withIds, data.tags);
    const survey = await SurveyTemplate.create({
      ...data,
      questions: finalQuestions,
      tags,
      organizationId: activeOrgId(req),
      createdBy: req.user._id,
      version: 1,
    });
    await ensureTags(activeOrgId(req), tags, req.user._id);
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

    // Question edits are now reconciled, not blocked: removed questions/options
    // are soft-retired (kept with their stable ids) so existing reports keep
    // working, and new options get fresh ids. The ONLY remaining hard block is
    // changing a question's TYPE once responses exist — the stored answer shape
    // no longer aggregates. Duplicate to make that change against a fresh template.
    if (data.questions) {
      const hasResponses = await SurveyResponse.exists({ surveyTemplateId: existing._id });
      if (hasResponses) {
        const reasons = classifyQuestionEdits(existing.questions, data.questions);
        if (reasons.length) {
          return res.status(409).json({
            error: 'This survey has responses, so a question\'s answer type can\'t change. Duplicate it to make these changes.',
            code: 'survey-has-responses',
            reasons,
          });
        }
      }
    }

    const priorQuestions = existing.questions;
    Object.assign(existing, data);
    if (data.questions) {
      const reconciled = reconcileQuestions(priorQuestions, data.questions);
      const integrityError = validateVisibleIfIntegrity(reconciled);
      if (integrityError) return res.status(400).json({ error: integrityError });
      const { tags, questions } = canonicalizeTags(reconciled, data.tags ?? existing.tags);
      existing.questions = questions;
      existing.tags = tags;
      existing.version = (existing.version || 1) + 1;
    }
    await existing.save();
    await ensureTags(activeOrgId(req), existing.tags, req.user._id);

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
