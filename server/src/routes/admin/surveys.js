import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Campaign } from '../../models/Campaign.js';
import { Effort } from '../../models/Effort.js';
import { classifyQuestionEdits } from '../../services/surveys/diffQuestions.js';
import {
  blockName,
  clearRoutes,
  compileRouting,
  isAnswerable,
  isChoice,
  isClosingBlock,
  isStatement,
} from '../../services/surveys/routing.js';
import { fillScript, hasPlaceholderSyntax, unknownPlaceholders } from '../../services/surveys/scriptText.js';
import { canonicalizeTags } from '../../services/surveys/tags.js';
import { ensureTags } from '../../services/surveys/tagOps.js';
import {
  canManageSurvey,
  isOrgAdmin,
  managedCampaignIds,
  attachedSurveyTemplateIds,
} from '../../services/authz/campaignManagement.js';

const router = Router();
// Team leads author surveys for their campaigns: create is open (createdBy stamped),
// edit/duplicate gate on canManageSurvey, and their LIST is scoped below to what they
// authored or what's attached to a campaign they manage — a client-side lead must
// never read other clients' scripts, campaign names, or volumes. Lifecycle
// (archive/unarchive/delete) stays with org admins via requireOrgRole('admin').
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

// Every rule below that a person can trip carries its own plain-English sentence as a custom zod
// issue: team leads author surveys too, and zodErrorBody turns the first such sentence into the
// `error` the builder shows. zod's built-in checks keep the generic 'Invalid input', as before.
const NO_PLACEHOLDER_HERE =
  'Placeholders like {{canvasser}} can\'t go in a question\'s wording or an answer — they\'re stored with every answer.';

// A statement's title and a link's label show on the phone exactly as typed, never filled, so like
// a question's wording and an answer's text they may hold no `{{` at all (the builder's
// plainTextError).
const plainTextOnly = (what) =>
  `${what} can't contain "{{" — placeholders like {{canvasser}} work only in text that is read aloud.`;

// Script text (the opening, the default closing, a statement's read-aloud text, an answer's
// read-aloud script, a canvasser note) may hold the one known placeholder and nothing else
// brace-shaped. The test is "does any `{{` survive the phone's own fill", so this check and the
// door screen can never disagree about what a placeholder is, and no script text that passes
// reaches a phone as literal braces. A misspelt token is named back to the author. A retired
// block or answer is exempt from both rules (checkBlock says why).
const scriptTextError = (text) => {
  if (text == null || !hasPlaceholderSyntax(fillScript(text, { canvasserFirstName: 'x' }))) return null;
  const [unknown] = unknownPlaceholders(text);
  if (unknown != null) return `Unknown placeholder {{${unknown}}} — the only placeholder is {{canvasser}}.`;
  return 'Unfinished placeholder: every {{ needs a matching }} — the only placeholder is {{canvasser}}.';
};

const scriptText = (schema) =>
  schema.superRefine((text, ctx) => {
    const message = scriptTextError(text);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

// '__end__' and '__other__' are sentinels. Every key and answer-id generator strips leading
// underscores, so only a hand-sent value can start with `__`, and one would make a sentinel
// ambiguous.
const isReserved = (id) => id.startsWith('__');

// A "then go to": null = the following live block, a later block's key, or '__end__'. An empty
// string is what a cleared select sends, so it reads as no route.
const routeSchema = z
  .string()
  .max(200)
  .nullable()
  .optional()
  .transform((route) => (route === '' ? null : route));

// How big one survey can be. Without a bound, one request from any lead could make the Script-flow
// compile (its output grows with blocks × branching) stall or crash the server for every org.
// Retired blocks and answers count: the builder sends every one back on each save, so a survey
// stored over a cap could never be saved again, and the PATCH holds what reconcile stores to the
// same caps (sizeError).
const MAX_BLOCKS = 500;
const MAX_ANSWERS = 200;
const TOO_MANY_BLOCKS = `A survey can have at most ${MAX_BLOCKS} blocks, retired ones included.`;
const TOO_MANY_ANSWERS = `A question can have at most ${MAX_ANSWERS} answers, retired ones included.`;

// An answer's placeholder rules are checked in checkBlock, which knows whether it is retired.
const optionSchema = z.object({
  id: z
    .string()
    .refine((id) => !isReserved(id), { message: 'An answer id can\'t start with "__" — that prefix is reserved.' })
    .optional(),
  text: z.string().trim().min(1).max(500),
  tag: z.string().nullable().optional(),
  script: z.string().max(5000).nullable().optional(),
  retired: z.boolean().optional(),
  order: z.number().optional(),
  goTo: routeSchema,
});

// A page the canvasser opens on a tap to show the voter. http(s) only: a javascript: or data: URL
// would run or render inside whatever opens it.
const linkSchema = z.object({
  label: z
    .string()
    .trim()
    .refine((label) => label.length <= 120, { message: 'A link label can be at most 120 characters.' })
    .optional()
    .default(''),
  url: z
    .string()
    .trim()
    .refine((url) => url.length <= 2000, { message: 'A link can be at most 2000 characters.' })
    .refine((url) => /^https?:\/\//i.test(url), { message: 'A link must start with http:// or https://.' }),
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

// The rules that depend on a block's type, or on whether it is retired. A question's wording and
// its answers' text are snapshotted onto every stored answer row (questionLabel / answer) and
// become results labels and CSV cells, none of which fill placeholders, so no `{{` there at all.
// A statement's label IS its read-aloud text, filled on the phone, so it follows the script-text
// rule and gets the longer cap. The placeholder rules skip a retired block or answer, as the
// builder does: neither reaches a phone or paper, its text is already snapshotted on the answers
// it collected, and the builder sends it back on every save, so a survey whose retired history
// predates these rules stays saveable. The caps and the reserved "__" prefix hold for every entry.
const checkBlock = (block, ctx) => {
  const refuse = (message, path = ['label']) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const statement = block.type === 'statement';
  if (statement && block.label.length > 5000) refuse('Read-aloud text can be at most 5000 characters.');
  if (!statement && block.label.length > 1000) refuse('A question\'s wording can be at most 1000 characters.');
  if (block.retired) return;
  if (statement) {
    const scriptError = scriptTextError(block.label);
    if (scriptError) refuse(scriptError);
    // Only a statement keeps its title (shapeBlock).
    if (hasPlaceholderSyntax(block.title)) refuse(plainTextOnly('A title'), ['title']);
  } else if (hasPlaceholderSyntax(block.label)) {
    refuse(NO_PLACEHOLDER_HERE);
  }
  const noteError = scriptTextError(block.note);
  if (noteError) refuse(noteError, ['note']);
  block.links.forEach((link, i) => {
    if (hasPlaceholderSyntax(link.label)) refuse(plainTextOnly('A link label'), ['links', i, 'label']);
  });
  block.options.forEach((option, i) => {
    if (option.retired) return;
    if (hasPlaceholderSyntax(option.text)) refuse(NO_PLACEHOLDER_HERE, ['options', i, 'text']);
    const scriptError = scriptTextError(option.script);
    if (scriptError) refuse(scriptError, ['options', i, 'script']);
  });
};

// What a block is stored as, whatever a client sent. Enforced here and not only in the builder,
// because every reader of stored answers relies on it: a statement records nothing, so it has no
// answers, is never required, offers no Other or Refused choice, and carries a role ('statement'
// unless it is a closing). A question carries no role (the model gives role no default on purpose)
// and no title, and an Other route only on a choice question while Other is on: the only place the
// compiler follows one (isBranching). An empty title or note is none.
const shapeBlock = (block) => {
  const note = block.note || null;
  if (block.type === 'statement') {
    return {
      ...block,
      role: block.role || 'statement',
      title: block.title || null,
      note,
      required: false,
      options: [],
      otherOption: false,
      refusalOption: false,
      otherGoTo: null,
    };
  }
  const otherGoTo = isChoice(block) && block.otherOption ? (block.otherGoTo ?? null) : null;
  const question = { ...block, note, otherGoTo };
  delete question.role;
  delete question.title;
  return question;
};

// One block: a question, or a statement (read aloud, records nothing). See
// docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §E1 for every field.
const questionSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(200)
      .refine((key) => !isReserved(key), { message: 'A block key can\'t start with "__" — that prefix is reserved.' }),
    // Capped in checkBlock, which knows the type: 5000 for a statement, 1000 for a question.
    label: z.string().trim().min(1),
    type: z.enum(['single_choice', 'multiple_choice', 'text', 'statement']),
    role: z.enum(['statement', 'closing']).nullable().optional(),
    title: z
      .string()
      .trim()
      .refine((title) => title.length <= 80, { message: 'A title can be at most 80 characters.' })
      .nullable()
      .optional(),
    // Script text, checked in checkBlock, which skips a retired block.
    note: z
      .string()
      .trim()
      .refine((note) => note.length <= 2000, { message: 'A note to the canvasser can be at most 2000 characters.' })
      .nullable()
      .optional(),
    links: z
      .array(linkSchema)
      .refine((links) => links.length <= 5, { message: 'A block can have at most 5 links.' })
      .optional()
      .default([]),
    goTo: routeSchema,
    otherGoTo: routeSchema,
    options: z
      .array(optionSchema)
      .refine((options) => options.length <= MAX_ANSWERS, { message: TOO_MANY_ANSWERS })
      .optional()
      .default([]),
    required: z.boolean().optional().default(false),
    order: z.number().optional().default(0),
    retired: z.boolean().optional(),
    visibleIf: z
      .object({ logic: z.enum(['all', 'any']), rules: z.array(ruleSchema).default([]) })
      .nullable()
      .optional(),
    otherOption: z.boolean().optional(),
    refusalOption: z.boolean().optional(),
  })
  .superRefine(checkBlock)
  .transform(shapeBlock);

// Every reader finds a block by its key (the stepper's screens, the compiler, the evaluator, the
// answer filters), so two blocks sharing one hide each other, a statement's key swallowing a
// question's answers, or hold the stepper on one screen. The builder mints unique keys; a
// hand-built payload is refused, retired blocks included.
const refuseSharedKeys = (questions, ctx) => {
  const seen = new Set();
  for (const [i, q] of questions.entries()) {
    if (seen.has(q.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'key'], message: `Two blocks share the key "${q.key}".` });
      return;
    }
    seen.add(q.key);
  }
};

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(200),
  intro: scriptText(z.string().max(5000)).optional().default(''),
  closing: scriptText(z.string().max(5000)).optional().default(''),
  questions: z
    .array(questionSchema)
    .refine((questions) => questions.length <= MAX_BLOCKS, { message: TOO_MANY_BLOCKS })
    .superRefine(refuseSharedKeys)
    .default([]),
  tags: z.array(z.string()).optional().default([]),
  // Both .optional().default(…), so the PATCH parser's .partial() leaves them alone when a body
  // omits them. The rules tying flow to other fields live in the handlers: a top-level superRefine
  // would turn this object into a ZodEffects, which has no .partial().
  flow: z.enum(['list', 'script']).optional().default('list'),
  presentation: z.enum(['scroll', 'steps']).optional().default('scroll'),
});

// A ZodError's 400: the first plain-English sentence above (a custom issue) becomes `error`.
const zodErrorBody = (err) => ({
  error: err.issues.find((issue) => issue.code === z.ZodIssueCode.custom)?.message || 'Invalid input',
  issues: err.issues,
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

    // Re-append existing options that the payload dropped, as retired. Never onto a statement: it
    // records nothing (the zod transform empties its options), and a question retyped into one
    // would otherwise come back carrying retired, possibly tagged, answers.
    if (prev && !isStatement(inc)) {
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

// The payload's caps (upsertSchema) on what a PATCH stores, which also holds every block and
// answer the payload left out: the builder sends them all back on the next save. The message for
// a 400, or null.
const sizeError = (questions) => {
  if (questions.length > MAX_BLOCKS) return TOO_MANY_BLOCKS;
  if (questions.some((q) => (q.options || []).length > MAX_ANSWERS)) return TOO_MANY_ANSWERS;
  return null;
};

// Cross-question integrity for visibleIf, run on the FINAL (reconciled, and in Script flow
// compiled) questions, so a compiler bug fails loudly as a 400 instead of reaching a phone.
// Every rule on a non-retired block must reference a STRICTLY EARLIER non-retired
// question (forward/self/dangling => error, which also makes cycles impossible) that is
// not a statement (it has no answer: `answered` on one is always false and
// `is_not`/`not_answered` always true), the op must suit the referenced question's type
// (text questions support only answered/not_answered), and is/is_not/any_of optionIds must
// exist on the referenced question (retired-inclusive) or be '__other__' when it allows Other.
// A statement is named by its title or first words (blockName), never its whole read-aloud
// text; the messages for a question are unchanged.
// Returns an error message string, or null when valid.
function validateVisibleIfIntegrity(questions = []) {
  const active = questions.filter((q) => q && !q.retired);
  const posByKey = new Map(active.map((q, i) => [q.key, i]));
  const qByKey = new Map(active.map((q) => [q.key, q]));

  for (let i = 0; i < active.length; i++) {
    const q = active[i];
    const subject = isStatement(q)
      ? `${isClosingBlock(q) ? 'Closing' : 'Statement'} "${blockName(q)}"`
      : `Question "${q.label}"`;
    const rules = (q.visibleIf && q.visibleIf.rules) || [];
    for (const rule of rules) {
      const refPos = posByKey.get(rule.questionKey);
      if (refPos == null) {
        return `${subject} has a condition referencing an unknown or retired question "${rule.questionKey}".`;
      }
      if (refPos >= i) {
        return `${subject} has a condition referencing question "${rule.questionKey}", which must come earlier in the survey.`;
      }
      const ref = qByKey.get(rule.questionKey);
      if (isStatement(ref)) {
        const named = `${isClosingBlock(ref) ? 'closing' : 'statement'} "${blockName(ref)}"`;
        return `${subject} has a condition on ${named}, which is read aloud and has no answer — condition on the answers that led there instead.`;
      }
      if (ref.type === 'text' && rule.op !== 'answered' && rule.op !== 'not_answered') {
        return `${subject} has a condition on text question "${ref.label}", which only supports answered / not answered.`;
      }
      if (rule.op === 'is' || rule.op === 'is_not' || rule.op === 'any_of') {
        const validIds = new Set((ref.options || []).map((o) => o.id));
        if (ref.otherOption) validIds.add('__other__');
        for (const id of rule.optionIds || []) {
          if (!validIds.has(id)) {
            return `${subject} has a condition referencing an option "${id}" that doesn't exist on question "${ref.label}".`;
          }
        }
      }
    }
  }
  return null;
}

const FLOW_NEEDS_QUESTIONS = 'Send the questions with a flow change.';
const ROUTE_IN_LIST_FLOW = 'Go to is only available in Script flow.';
const HAND_CONDITIONS = 'Remove the Show-only-if conditions before switching to Go to.';
const NO_ANSWERABLE_QUESTION = 'Add at least one question that records an answer.';
const SCRIPT_HAS_RESPONSES =
  'This survey has responses, so it can\'t switch to Go to routing. Duplicate it to build the scripted version.';

// Script flow's own bounds, on top of MAX_BLOCKS: the live blocks the compile walks, and the answer
// ids its conditions may hold in all. A continue carries its source's whole condition forward, so
// under the caps alone 100 questions whose 200 answers lead to one block, with 99 blocks after it,
// would compile to two million ids (26 MB, past MongoDB's 16 MB document limit). The Burton script
// compiles to 20.
const MAX_SCRIPT_BLOCKS = 200;
const MAX_COMPILED_ANSWERS = 50000;
const TOO_MANY_SCRIPT_BLOCKS = `A survey in Script flow can have at most ${MAX_SCRIPT_BLOCKS} blocks.`;
const SCRIPT_TOO_TANGLED = 'This script branches too much to save. Split it into two surveys.';

const isLive = (entry) => !!entry && !entry.retired;
const hasRoute = (route) => route != null && route !== '';

// How many answer ids the live blocks' compiled conditions hold in all.
const compiledAnswerCount = (questions) =>
  questions
    .filter((q) => isLive(q) && q.visibleIf)
    .reduce((sum, q) => sum + q.visibleIf.rules.reduce((n, rule) => n + rule.optionIds.length, 0), 0);

// What a save does with routes and conditions, by the template's flow. Runs on the FINAL
// questions (ids assigned; on a PATCH, retired history re-appended), so every route is judged
// exactly as it will be stored. Returns { questions } to store, or { body } for a 400.
//   Script flow: the routes compile into visibleIf (services/surveys/routing.js), overwriting any
//     incoming visibleIf on a live block: on a template already in Script flow that is just the
//     compiled output a GET handed back. ENTERING Script flow (stored list or absent and incoming
//     script, which every POST in Script flow is) with a hand-authored condition still on a live
//     block is refused instead, because overwriting it would silently delete logic the compiler
//     can't express. So is a script over MAX_SCRIPT_BLOCKS live blocks, before the compile, and
//     one that compiles to more than MAX_COMPILED_ANSWERS answer ids, before anything is stored.
//   List flow: visibleIf is hand-authored and kept as sent. A route on a live block or answer is
//     refused: no phone follows one, and a later switch into Script flow would revive it. One on
//     a retired block or answer is dropped silently, since nobody can see or edit it there.
const applyFlow = (questions, { flow, entering }) => {
  if (flow === 'script') {
    if (entering && questions.some((q) => isLive(q) && q.visibleIf?.rules?.length)) {
      return { body: { error: HAND_CONDITIONS } };
    }
    if (questions.filter(isLive).length > MAX_SCRIPT_BLOCKS) return { body: { error: TOO_MANY_SCRIPT_BLOCKS } };
    const { questions: compiled, errors } = compileRouting(questions);
    if (errors.length) return { body: { error: errors[0].message, routeErrors: errors } };
    if (compiledAnswerCount(compiled) > MAX_COMPILED_ANSWERS) return { body: { error: SCRIPT_TOO_TANGLED } };
    return { questions: compiled };
  }
  const routed = questions.some(
    (q) =>
      isLive(q) &&
      (hasRoute(q.goTo) ||
        hasRoute(q.otherGoTo) ||
        (q.options || []).some((o) => isLive(o) && hasRoute(o.goTo)))
  );
  if (routed) return { body: { error: ROUTE_IN_LIST_FLOW } };
  // Every live route is null by now, so this clears only the retired ones.
  return { questions: clearRoutes(questions) };
};

// A survey of statements and closings alone would file empty completed surveys. An empty survey
// stays allowed, as before: a template is often created blank and filled in later.
const lacksAnswerableQuestion = (questions) => {
  const live = questions.filter(isLive);
  return live.length > 0 && !live.some(isAnswerable);
};

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
    // A LEAD's library is scoped: templates they authored, or attached to a campaign
    // they manage (the set form of canManageSurvey). managedSet doubles as the
    // narrowing key for the usage maps below — null means admin, no narrowing.
    let templateFilter = { organizationId: orgId };
    let managedSet = null;
    if (!isOrgAdmin(req)) {
      const managed = await managedCampaignIds(req);
      managedSet = new Set(managed.map(String));
      const attached = await attachedSurveyTemplateIds(req, managed);
      templateFilter = {
        organizationId: orgId,
        $or: [{ createdBy: req.user._id }, { _id: { $in: attached } }],
      };
    }
    // All org campaigns (not just default-attached) — the id→name map also labels
    // walk-list overrides and per-campaign response counts below.
    const [surveys, campaigns, efforts, responseCounts, responseByCampaign] = await Promise.all([
      SurveyTemplate.find(templateFilter).sort({ createdAt: -1 }).lean(),
      Campaign.find({ organizationId: orgId }).select('name surveyTemplateId isActive').lean(),
      Effort.find({ organizationId: orgId, surveyTemplateId: { $ne: null } })
        .select('name surveyTemplateId campaignId')
        .lean(),
      SurveyResponse.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: '$surveyTemplateId', count: { $sum: 1 } } },
      ]),
      SurveyResponse.aggregate([
        { $match: { organizationId: orgId } },
        { $group: { _id: { s: '$surveyTemplateId', c: '$campaignId' }, count: { $sum: 1 } } },
      ]),
    ]);
    const campaignNameById = new Map(campaigns.map((c) => [String(c._id), c.name]));

    // Campaign DEFAULT attachments (unchanged shape).
    const usedBy = new Map();
    for (const c of campaigns) {
      if (!c.surveyTemplateId) continue;
      const k = String(c.surveyTemplateId);
      if (!usedBy.has(k)) usedBy.set(k, []);
      usedBy.get(k).push({ id: String(c._id), name: c.name, isActive: c.isActive });
    }

    // Walk-list (Effort) OVERRIDES — a survey used only as an override previously
    // showed no usage at all.
    const usedByWalk = new Map();
    for (const e of efforts) {
      const k = String(e.surveyTemplateId);
      if (!usedByWalk.has(k)) usedByWalk.set(k, []);
      usedByWalk.get(k).push({
        campaignId: String(e.campaignId),
        campaignName: campaignNameById.get(String(e.campaignId)) || 'Unknown campaign',
        effortId: String(e._id),
        effortName: e.name,
      });
    }

    const counts = new Map(responseCounts.map((r) => [String(r._id), r.count]));

    // Per-survey → per-campaign response split (drawer detail; null campaignId =
    // legacy rows without one).
    const byCampaign = new Map();
    for (const r of responseByCampaign) {
      const sid = String(r._id.s);
      const cid = r._id.c ? String(r._id.c) : null;
      if (!byCampaign.has(sid)) byCampaign.set(sid, []);
      byCampaign.get(sid).push({
        campaignId: cid,
        campaignName: cid ? campaignNameById.get(cid) || 'Unknown campaign' : 'No campaign',
        count: r.count,
      });
    }

    res.json({
      surveys: surveys.map((s) => {
        const id = String(s._id);
        const allCampaignUses = usedBy.get(id) || [];
        const allWalkUses = usedByWalk.get(id) || [];
        const allByCampaign = byCampaign.get(id) || [];
        if (!managedSet) {
          const responseCount = counts.get(id) || 0;
          return {
            ...s,
            usedByCampaigns: allCampaignUses,
            usedByWalkLists: allWalkUses,
            responseCount,
            hasResponses: responseCount > 0,
            responseCountByCampaign: allByCampaign,
          };
        }
        // Lead view: usage and volumes narrowed to their campaigns (the null-campaign
        // legacy bucket drops too — it's unattributable org-wide volume). One bare
        // boolean says "also used beyond your campaigns" so the shared-edit warning
        // can still fire without leaking whose campaigns or how much.
        const usedByCampaigns = allCampaignUses.filter((c) => managedSet.has(c.id));
        const usedByWalkLists = allWalkUses.filter((w) => managedSet.has(w.campaignId));
        const responseCountByCampaign = allByCampaign.filter(
          (b) => b.campaignId && managedSet.has(b.campaignId)
        );
        const responseCount = responseCountByCampaign.reduce((sum, b) => sum + b.count, 0);
        return {
          ...s,
          usedByCampaigns,
          usedByWalkLists,
          responseCount,
          hasResponses: responseCount > 0,
          responseCountByCampaign,
          usedElsewhere:
            usedByCampaigns.length < allCampaignUses.length ||
            usedByWalkLists.length < allWalkUses.length,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Create is open to leads too: a new template is org-level but reached only via the
// lead's campaign, createdBy is stamped below, and attaching it (campaign/effort PATCH)
// is separately campaign-manager-scoped. So no per-survey scope check here.
router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const data = upsertSchema.parse(req.body);
    const withIds = assignOptionIds(data.questions);
    // A new survey has no stored flow, so one created in Script flow is entering it (with no
    // responses possible yet, only the hand-condition check applies).
    const flowed = applyFlow(withIds, { flow: data.flow, entering: data.flow === 'script' });
    if (flowed.body) return res.status(400).json(flowed.body);
    if (lacksAnswerableQuestion(flowed.questions)) {
      return res.status(400).json({ error: NO_ANSWERABLE_QUESTION });
    }
    const integrityError = validateVisibleIfIntegrity(flowed.questions);
    if (integrityError) return res.status(400).json({ error: integrityError });
    const { tags, questions: finalQuestions } = canonicalizeTags(flowed.questions, data.tags);
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
    if (err.name === 'ZodError') return res.status(400).json(zodErrorBody(err));
    next(err);
  }
});

router.patch('/:surveyId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const data = upsertSchema.partial().parse(req.body);
    // The compile and the version bump both key off the questions array, so a flow change on its
    // own would have nothing to apply to.
    if (data.flow !== undefined && !data.questions) {
      return res.status(400).json({ error: FLOW_NEEDS_QUESTIONS });
    }
    const existing = await SurveyTemplate.findOne({
      _id: req.params.surveyId,
      organizationId: activeOrgId(req),
    });
    if (!existing) return res.status(404).json({ error: 'Survey not found' });
    // Leads may edit only a survey they authored or one attached to a campaign they manage.
    if (!(await canManageSurvey(req, existing))) return res.status(403).json({ error: 'Forbidden' });

    // The flow this save stores, and whether it ENTERS Script flow. A template saved before
    // Script flow existed has no stored flow and reads as List flow.
    const storedFlow = existing.flow || 'list';
    const flow = data.flow ?? storedFlow;
    const entering = storedFlow !== 'script' && flow === 'script';

    // Question edits are now reconciled, not blocked: removed questions/options
    // are soft-retired (kept with their stable ids) so existing reports keep
    // working, and new options get fresh ids. The hard blocks once responses exist are
    // changing a question's TYPE — the stored answer shape no longer aggregates — and
    // entering Script flow. Duplicate to make either change against a fresh template.
    if (data.questions) {
      const hasResponses = await SurveyResponse.exists({ surveyTemplateId: existing._id });
      if (hasResponses) {
        // Leaving Script flow is always allowed: the compiled conditions stay as hand ones, so
        // recording can't change. Entering it re-expresses the branching, which could make later
        // visits record differently from earlier ones. Its own check and sentence, because
        // classifyQuestionEdits only compares two question arrays.
        if (entering) {
          return res.status(409).json({ error: SCRIPT_HAS_RESPONSES, code: 'survey-has-responses' });
        }
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
      const tooBig = sizeError(reconciled);
      if (tooBig) return res.status(400).json({ error: tooBig });
      // A questions-only PATCH on a Script-flow template compiles too (flow falls back to the
      // stored one), so it can never store ungated blocks.
      const flowed = applyFlow(reconciled, { flow, entering });
      if (flowed.body) return res.status(400).json(flowed.body);
      if (lacksAnswerableQuestion(flowed.questions)) {
        return res.status(400).json({ error: NO_ANSWERABLE_QUESTION });
      }
      const integrityError = validateVisibleIfIntegrity(flowed.questions);
      if (integrityError) return res.status(400).json({ error: integrityError });
      const { tags, questions } = canonicalizeTags(flowed.questions, data.tags ?? existing.tags);
      existing.questions = questions;
      existing.tags = tags;
      existing.version = (existing.version || 1) + 1;
    }
    await existing.save();
    await ensureTags(activeOrgId(req), existing.tags, req.user._id);

    res.json({ survey: existing });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json(zodErrorBody(err));
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
    // Same scope as edit — the answer-type-change escape hatch must work for leads
    // on their own campaign's surveys.
    if (!(await canManageSurvey(req, original))) return res.status(403).json({ error: 'Forbidden' });

    const copy = await SurveyTemplate.create({
      organizationId: orgId,
      name: `${original.name} (Copy)`,
      isActive: false,
      version: 1,
      intro: original.intro || '',
      closing: original.closing || '',
      // Verbatim, so routes, titles, notes and links travel with the copy.
      questions: original.questions || [],
      // Copied, never defaulted: an uncopied flow would leave a scripted copy's routes ungated
      // (List flow, its compiled conditions read as hand-written), and an uncopied presentation
      // would put it back on a single page. Tags used to be dropped here.
      flow: original.flow || 'list',
      presentation: original.presentation || 'scroll',
      tags: original.tags || [],
      createdBy: req.user._id,
    });
    res.status(201).json({ survey: copy });
  } catch (err) {
    next(err);
  }
});

// Soft-archive: hide from the default library list and from pickers (unless currently
// selected) without touching responses or attachments. Idempotent. Separate POSTs
// (not a PATCH flag) so the upsert/version-bump path never sees archive state.
router.post('/:surveyId/archive', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const survey = await SurveyTemplate.findOne({
      _id: req.params.surveyId,
      organizationId: activeOrgId(req),
    });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    if (!survey.archivedAt) {
      survey.archivedAt = new Date();
      await survey.save();
    }
    res.json({ survey });
  } catch (err) {
    next(err);
  }
});

router.post('/:surveyId/unarchive', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const survey = await SurveyTemplate.findOne({
      _id: req.params.surveyId,
      organizationId: activeOrgId(req),
    });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    if (survey.archivedAt) {
      survey.archivedAt = null;
      await survey.save();
    }
    res.json({ survey });
  } catch (err) {
    next(err);
  }
});

// Hard-delete, only when truly unused: no responses, not any campaign's default,
// not any walk list's override. Anything in use gets a 409 pointing at Archive.
router.delete('/:surveyId', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const survey = await SurveyTemplate.findOne({ _id: req.params.surveyId, organizationId: orgId });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });

    const [hasResponses, campaignRef, effortRef] = await Promise.all([
      SurveyResponse.exists({ surveyTemplateId: survey._id, organizationId: orgId }),
      Campaign.exists({ organizationId: orgId, surveyTemplateId: survey._id }),
      Effort.exists({ organizationId: orgId, surveyTemplateId: survey._id }),
    ]);
    if (hasResponses || campaignRef || effortRef) {
      const reasons = [];
      if (hasResponses) reasons.push('It has survey responses.');
      if (campaignRef) reasons.push('It is attached to a campaign.');
      if (effortRef) reasons.push('It is a walk-list survey override.');
      return res.status(409).json({
        error: 'This survey can’t be deleted because it is in use. Archive it instead.',
        code: 'survey-in-use',
        reasons,
      });
    }

    await SurveyTemplate.deleteOne({ _id: survey._id, organizationId: orgId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
