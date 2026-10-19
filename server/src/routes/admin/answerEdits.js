import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin } from '../../services/authz/campaignManagement.js';
import { Campaign } from '../../models/Campaign.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Pass } from '../../models/Pass.js';
import { AnswerEditRun } from '../../models/AnswerEditRun.js';
import { AnswerEditRunChunk, ANSWER_EDIT_CHUNK_ITEMS } from '../../models/AnswerEditRunChunk.js';
import { isDeleting } from '../../services/campaigns/deletionState.js';
import { resolveEntryScope, sendScopeError } from '../../services/canvass/entryScope.js';
import { objectIdish, entryScopeSchema } from '../../services/canvass/entryScopeSchema.js';
import { describeScope } from '../../services/canvass/scopeSummary.js';
import { RECLASSIFY_MAX_IMPACT_ENTRIES } from '../../services/canvass/reclassifyOutcomes.js';
import {
  validatePlan,
  applyEditPlan,
  planFromAnswers,
  summarizePlan,
  editorVersion,
  fingerprint,
  keysOf,
  PlanError,
} from '../../services/canvass/answerEdit.js';
import {
  resolveEditEntries,
  countHeldByRuns,
  surveysAtVisits,
  scanEditTargets,
  buildEditPreview,
  answerEditCap,
  ANSWER_EDIT_QUEUE_MAX,
} from '../../services/canvass/answerEditScope.js';
import { writeOneSurvey, fold, emptyCounts } from '../../services/canvass/answerEditWriter.js';
import {
  freezeTemplate,
  createAnswerEditRun,
  enqueueApply,
  enqueueUndo,
  otherChangeRunning,
  rollUp,
  writeRunHistory,
  queueSummary,
  answerEditRunWire,
} from '../../services/canvass/answerEditRuns.js';
import { hydrateCanvassers } from '../../services/reports/canvasserIdentity.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { formatAnswerCell } from '../../services/surveys/answerDisplay.js';
import { makeCell, visibleQuestionKeys } from '../../services/surveys/visibility.js';
import { isAnswerable } from '../../services/surveys/routing.js';

// Door Outcomes → Edit answers… — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §M. Change, clear or take
// picks out of answers on surveys that stay surveyed, priced first, undoable. ORG ADMINS ONLY, like
// every other Door Outcomes act, and every run is scoped { _id, campaignId, organizationId }, so a
// foreign run id reads as 404 by construction.
const router = Router({ mergeParams: true });
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

const activeOrgId = (req) => req.activeOrg?._id;
const WAIT_MS = 10 * 60 * 1000;

/** The Door Outcomes preamble (routes/admin/campaigns.js loadForReclassify): org admins, mid-delete quarantine. */
const loadForAnswerEdit = async (req, res) => {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return null;
  }
  if (!isOrgAdmin(req)) {
    res.status(403).json({ error: "Only an org admin can change a campaign's recorded survey answers." });
    return null;
  }
  if (!mongoose.isValidObjectId(req.params.campaignId)) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }
  const campaign = await Campaign.findOne({ _id: req.params.campaignId, organizationId: activeOrgId(req) });
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }
  if (isDeleting(campaign)) {
    res.status(409).json({ error: 'This campaign is being deleted.', code: 'campaign-deleting' });
    return null;
  }
  return campaign;
};

const loadEditRun = async (req, res, campaign) => {
  if (!mongoose.isValidObjectId(req.params.runId)) {
    res.status(404).json({ error: 'Answer edit not found' });
    return null;
  }
  const run = await AnswerEditRun.findOne({ _id: req.params.runId, campaignId: campaign._id, organizationId: activeOrgId(req) }).lean();
  if (!run) res.status(404).json({ error: 'Answer edit not found' });
  return run;
};

const byName = async (runs, orgId) => {
  const people = await hydrateCanvassers(runs.map((r) => r.byUserId).filter(Boolean), orgId);
  return (r) => {
    const p = r.byUserId ? people.get(String(r.byUserId)) : null;
    return p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Unknown user' : null;
  };
};

const planEntrySchema = z.object({
  questionKey: z.string().min(1).max(200),
  op: z.enum(['clear', 'set', 'adjust']),
  optionIds: z.array(z.string().max(200)).max(50).optional(),
  remove: z.array(z.string().max(500)).max(200).optional(),
  removeTexts: z.array(z.string().max(2000)).max(200).optional(),
  replaceWith: z.array(z.string().max(200)).max(50).optional(),
});

const createSchema = z.object({
  scope: entryScopeSchema.optional(),
  // Narrows `scope` only — ids outside the filter are dropped, never written.
  actionIds: z.array(objectIdish).max(RECLASSIFY_MAX_IMPACT_ENTRIES).optional(),
  surveyTemplateId: objectIdish.optional(),
  mode: z.enum(['bulk', 'queue']).default('bulk'),
  plan: z.array(planEntrySchema).max(100).optional(),
  dryRun: z.boolean().optional(),
  // What was reviewed — the create call re-derives both under the same `asOf` and refuses on any
  // difference (409 REVIEW_STALE), writing nothing.
  digest: z.string().max(200).optional(),
  asOf: z.string().datetime().optional(),
  templateVersion: z.number().int().optional(),
});

const answerInputSchema = z.object({
  questionKey: z.string().min(1).max(200),
  questionLabel: z.string().max(5000).optional(),
  answer: z.any().optional(),
  optionIds: z.array(z.string().max(200)).max(100).optional(),
  otherText: z.string().max(2000).nullable().optional(),
});

const sendError = (res, err) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', issues: err.issues });
    return true;
  }
  if (err instanceof PlanError) {
    res.status(400).json({ error: err.message, code: err.code, questionKey: err.questionKey });
    return true;
  }
  return sendScopeError(res, err);
};

// ---------------------------------------------------------------------------
// Dry run and create
// ---------------------------------------------------------------------------

router.post('/', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const body = createSchema.parse(req.body);
    const q = await resolveEntryScope(campaign, body.scope || {});
    const sel = await resolveEditEntries(campaign, q, body.actionIds || null);
    const asOf = body.asOf ? new Date(body.asOf) : new Date();

    // Which survey: the one asked for, else the answer filter's own, else the one most of these
    // surveys were recorded under.
    const present = await surveysAtVisits(campaign, q, sel, asOf);
    const chosenId = body.surveyTemplateId || q.answerScope?.surveyTemplateId || present[0]?.surveyTemplateId || null;
    if (!chosenId) {
      return res.status(400).json({ error: 'None of these entries holds survey answers to edit.', code: 'NO_SURVEYS' });
    }
    const templateDoc = await SurveyTemplate.findOne({ _id: chosenId, organizationId: campaign.organizationId }).lean();
    if (!templateDoc) return res.status(404).json({ error: 'Survey not found' });
    const template = freezeTemplate(templateDoc);

    const plan = body.mode === 'bulk' && body.plan ? validatePlan(template.questions, body.plan) : null;
    if (body.mode === 'bulk' && !body.dryRun && !plan) throw new PlanError('PLAN_EMPTY');

    if (body.dryRun) {
      const [heldByRuns, names] = await Promise.all([
        countHeldByRuns(campaign, q),
        SurveyTemplate.find({ _id: { $in: present.map((p) => p.surveyTemplateId) } }, { name: 1 }).lean(),
      ]);
      const nameOf = new Map(names.map((t) => [String(t._id), t.name]));
      // Matched surveys at visits the selection left out: the entry's date is its LATEST survey's
      // time, so a door re-surveyed after the window has matching surveys the table can't show.
      // Only meaningful for a whole-filter selection the answer scope saw entirely.
      const matchedNotSelectedOf = (responses) =>
        q.answerMatch && !body.actionIds?.length && !body.scope?.effortId && q.answerScope && !q.answerScope.truncated
          ? Math.max(0, q.answerScope.responses - responses)
          : 0;
      const { payload } = await buildEditPreview({ campaign, q, sel, template, asOf, plan, matchedNotSelectedOf });
      const overCap = payload.responses > answerEditCap();
      const overQueue = body.mode === 'queue' && payload.responses > ANSWER_EDIT_QUEUE_MAX;
      return res.json({
        dryRun: true,
        mode: body.mode,
        entries: sel.entries,
        doors: sel.doors,
        heldByRuns,
        surveys: present.map((p) => ({ id: p.surveyTemplateId, name: nameOf.get(p.surveyTemplateId) || 'Survey', responses: p.responses })),
        template: { id: String(templateDoc._id), name: templateDoc.name, version: template.version, flow: template.flow },
        planSummary: plan ? summarizePlan(template.questions, plan) : null,
        scopeSummary: await describeScope(campaign, body.scope || {}),
        limits: {
          maxResponses: answerEditCap(),
          maxQueue: ANSWER_EDIT_QUEUE_MAX,
          tooMany: overCap,
          tooManyForQueue: overQueue,
        },
        ...payload,
        asOf: asOf.toISOString(),
      });
    }

    // ---- create ----
    if (!body.digest || !body.asOf) {
      return res.status(400).json({ error: 'Review the change first.', code: 'REVIEW_REQUIRED' });
    }
    const busy = await otherChangeRunning(campaign._id);
    if (busy) return res.status(409).json(busy);

    const scan = await scanEditTargets({ campaign, q, sel, template, asOf, plan: null, collectItems: true });
    if (body.templateVersion !== template.version || body.digest !== scan.digest) {
      return res.status(409).json({ error: 'Something changed since you reviewed this — review again.', code: 'REVIEW_STALE' });
    }
    if (!scan.responses) return res.status(400).json({ error: 'There are no surveys to change here.', code: 'NOTHING_TO_EDIT' });
    if (scan.responses > answerEditCap()) {
      return res.status(409).json({
        error: `That's ${scan.responses.toLocaleString()} surveys — narrow the selection to ${answerEditCap().toLocaleString()} or fewer.`,
        code: 'TOO_MANY_RESPONSES',
      });
    }
    if (body.mode === 'queue' && scan.responses > ANSWER_EDIT_QUEUE_MAX) {
      return res.status(409).json({
        error: `One person at a time takes up to ${ANSWER_EDIT_QUEUE_MAX} surveys — narrow the selection, or use the same change for everyone.`,
        code: 'QUEUE_TOO_LARGE',
      });
    }

    const run = await createAnswerEditRun({
      campaign,
      byUserId: req.user._id,
      mode: body.mode,
      template,
      plan: plan || [],
      planSummary: plan ? summarizePlan(template.questions, plan) : null,
      selection: { scope: body.scope || {}, byIds: !!body.actionIds?.length, digest: scan.digest, asOf, total: scan.responses },
      scopeSummary: await describeScope(campaign, body.scope || {}),
      items: scan.items,
    });
    const by = await byName([run], activeOrgId(req));

    if (body.mode === 'queue') {
      const current = await stepPayload(req, res, campaign, run.toObject(), 0);
      return res.status(201).json({ run: answerEditRunWire(run.toObject(), by(run)), current });
    }
    try {
      await enqueueApply(run);
    } catch {
      const failed = await AnswerEditRun.findByIdAndUpdate(
        run._id,
        { $set: { status: 'failed', error: 'Could not start the change. Nothing has been changed — press Pick up where it stopped to try again.' } },
        { new: true }
      ).lean();
      return res.status(503).json({ error: failed.error, code: 'QUEUE_UNAVAILABLE', run: answerEditRunWire(failed, by(failed)) });
    }
    const fresh = await AnswerEditRun.findById(run._id).lean();
    res.status(201).json({ run: answerEditRunWire(fresh, by(fresh)) });
  } catch (err) {
    if (sendError(res, err)) return;
    next(err);
  }
});

// ---------------------------------------------------------------------------
// The list, the poll, Details
// ---------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    // A finished run that changed nothing (an opened-and-abandoned session) is not a change.
    const runs = await AnswerEditRun.find(
      {
        campaignId: campaign._id,
        organizationId: activeOrgId(req),
        $nor: [{ status: 'completed', 'counts.surveysChanged': 0, 'undo.status': null }],
      },
      { 'template.questions': 0 }
    )
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const by = await byName(runs, activeOrgId(req));
    res.json({ runs: runs.map((r) => answerEditRunWire(r, by(r))) });
  } catch (err) {
    next(err);
  }
});

router.get('/:runId', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const run = await loadEditRun(req, res, campaign);
    if (!run) return;
    const by = await byName([run], activeOrgId(req));
    const wire = answerEditRunWire(run, by(run));
    // An open session must come back USABLE from a cold page load: the survey at its cursor.
    if (run.mode === 'queue' && run.status === 'open') wire.current = await stepPayload(req, res, campaign, run, run.cursor || 0);
    res.json({ run: wire });
  } catch (err) {
    next(err);
  }
});

const PAGE_MAX = 100;

// What one survey's answers changed, question by question, in the survey's own words.
const diffAnswers = (questions, before, after) => {
  const qs = (questions || []).filter(isAnswerable);
  const out = [];
  for (const q of qs) {
    const b = (before || []).find((a) => a?.questionKey === q.key) || null;
    const a = (after || []).find((x) => x?.questionKey === q.key) || null;
    const kb = keysOf(b).join('\u0001');
    const ka = keysOf(a).join('\u0001');
    const tb = b ? formatAnswerCell(b) : '';
    const ta = a ? formatAnswerCell(a) : '';
    if (kb === ka && tb === ta) continue;
    out.push({ questionKey: q.key, label: q.label, before: tb, after: ta, dropped: !!b && !a });
  }
  return out;
};

router.get('/:runId/entries', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const run = await loadEditRun(req, res, campaign);
    if (!run) return;
    const limit = Math.min(Number(req.query.limit) || 50, PAGE_MAX);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    // After an undo the list is what the undo didn't put back, with its reason — read from the
    // STORED summary, never from the rows (a re-cut or an Erase removes rows without undoing).
    if (run.undo?.status && run.undo.status !== 'pending' && run.undo.summary) {
      const names = run.undo.summary.names || [];
      return res.json({
        kind: 'undo',
        entries: names.slice(skip, skip + limit).map((n) => ({ voterId: n.voterId ? String(n.voterId) : null, voterName: n.voterName, reason: n.reason, detail: n.detail || null })),
        total: run.undo.summary.namesTotal || names.length,
        truncated: (run.undo.summary.namesTotal || 0) > names.length,
      });
    }

    const filter = { answerEditRunId: run._id };
    const [rows, total] = await Promise.all([
      SurveyResponseArchive.collection.find(filter).sort({ overwrittenAt: -1, _id: 1 }).skip(skip).limit(limit).toArray(),
      SurveyResponseArchive.countDocuments(filter),
    ]);
    const slots = rows.map((r) => ({ voterId: r.voterId, passId: r.passId ?? null }));
    const [lives, voters, doors, passes, people] = await Promise.all([
      slots.length ? SurveyResponse.collection.find({ $or: slots }).toArray() : [],
      Voter.find({ _id: { $in: rows.map((r) => r.voterId) } }, { fullName: 1 }).lean(),
      Household.find({ _id: { $in: rows.map((r) => r.householdId) } }, { addressLine1: 1, unit: 1, city: 1 }).lean(),
      Pass.find({ campaignId: campaign._id }, { name: 1, roundNumber: 1 }).lean(),
      hydrateCanvassers(rows.map((r) => r.userId).filter(Boolean), activeOrgId(req)),
    ]);
    const liveBySlot = new Map(lives.map((l) => [`${l.voterId}|${l.passId ?? 'null'}`, l]));
    const vById = new Map(voters.map((v) => [String(v._id), v]));
    const dById = new Map(doors.map((d) => [String(d._id), d]));
    const pById = new Map(passes.map((p) => [String(p._id), p]));
    const questions = run.template?.questions || [];
    addAuditSubjects(res, 'voter', rows.map((r) => String(r.voterId)));
    res.json({
      kind: 'changes',
      entries: rows.map((r) => {
        const live = liveBySlot.get(`${r.voterId}|${r.passId ?? 'null'}`);
        // What the edit wrote: a bulk run's plan replayed over the snapshot (deterministic), or —
        // one person at a time — the survey itself while it still carries this edit's mark.
        let after = null;
        let changedSince = false;
        if (run.mode === 'bulk') {
          after = applyEditPlan(questions, r.answers || [], run.plan || [], { mode: 'bulk', flow: run.template?.flow }).answers;
          changedSince = !live || fingerprint(live) !== r.appliedHash;
        } else if (live && fingerprint(live) === r.appliedHash) {
          after = live.answers || [];
        } else {
          changedSince = true;
          after = live?.answers || [];
        }
        const d = dById.get(String(r.householdId));
        const p = r.passId ? pById.get(String(r.passId)) : null;
        const u = r.userId ? people.get(String(r.userId)) : null;
        return {
          id: String(r._id),
          voterId: String(r.voterId),
          voterName: vById.get(String(r.voterId))?.fullName || 'Unknown voter',
          address: d ? [d.addressLine1, d.unit ? `#${d.unit}` : null].filter(Boolean).join(' ') : '(door removed)',
          round: p ? p.name || `Round ${p.roundNumber}` : null,
          recordedBy: u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown user' : 'Unknown user',
          submittedAt: r.submittedAt,
          deskEntered: !!r.deskEntry,
          changedSince,
          changes: diffAnswers(questions, r.answers || [], after),
        };
      }),
      total,
      left: { skipped: run.counts?.skipped || {}, samples: (run.samples || []).map((s) => ({ voterId: s.voterId ? String(s.voterId) : null, voterName: s.voterName, reason: s.reason })) },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// One person at a time
// ---------------------------------------------------------------------------

/** The frozen item at a position, or null. */
const itemAt = async (runId, position) => {
  if (position < 0) return null;
  const chunk = await AnswerEditRunChunk.findOne({ runId, seq: Math.floor(position / ANSWER_EDIT_CHUNK_ITEMS) }).lean();
  if (!chunk) return null;
  const item = chunk.items?.[position % ANSWER_EDIT_CHUNK_ITEMS];
  return item ? { ...item, position, chunkId: chunk._id } : null;
};

/** The frozen item for a response id, or null. A session is at most 500 surveys, one chunk. */
const itemFor = async (runId, responseId) => {
  const chunks = await AnswerEditRunChunk.find({ runId }).sort({ seq: 1 }).lean();
  for (const c of chunks) {
    const i = (c.items || []).findIndex((it) => String(it.r) === String(responseId));
    if (i >= 0) return { ...c.items[i], position: c.seq * ANSWER_EDIT_CHUNK_ITEMS + i, chunkId: c._id };
  }
  return null;
};

/**
 * One survey of a session, as the editor needs it: who and where, the stored answers, what's on
 * file but off this person's path (shown read-only, kept), old texts that match no option, and the
 * editors' version the save is checked against.
 */
const stepPayload = async (req, res, campaign, run, position) => {
  const total = run.progress?.total || run.selection?.total || 0;
  if (position >= total) return null;
  const item = await itemAt(run._id, position);
  if (!item) return null;
  const live = await SurveyResponse.collection.findOne({ voterId: item.v, passId: item.p ?? null });
  const base = { position, total, responseId: String(item.r), done: !!item.a };
  if (!live) return { ...base, missing: true };
  const [voter, door, pass, people] = await Promise.all([
    Voter.findById(live.voterId, { fullName: 1 }).lean(),
    Household.findById(live.householdId, { addressLine1: 1, unit: 1, city: 1 }).lean(),
    live.passId ? Pass.findById(live.passId, { name: 1, roundNumber: 1 }).lean() : null,
    hydrateCanvassers([live.userId, live.editedBy, live.deskEntry?.byUserId].filter(Boolean), activeOrgId(req)),
  ]);
  const nameOf = (id) => {
    const u = id ? people.get(String(id)) : null;
    return u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown user' : null;
  };
  const questions = (run.template?.questions || []).filter(isAnswerable);
  const qByKey = new Map(questions.map((q) => [q.key, q]));
  const cells = {};
  for (const a of live.answers || []) {
    const q = qByKey.get(a?.questionKey);
    if (!q) continue;
    cells[a.questionKey] = makeCell(q.type, Array.isArray(a.optionIds) ? a.optionIds : [], a.answer == null ? null : Array.isArray(a.answer) ? a.answer.join(' ') : String(a.answer));
  }
  const visible = visibleQuestionKeys(run.template?.questions || [], cells);
  addAuditSubjects(res, 'voter', [String(live.voterId)]);
  return {
    ...base,
    voter: { id: String(live.voterId), name: voter?.fullName || 'Unknown voter' },
    address: door ? [door.addressLine1, door.unit ? `#${door.unit}` : null].filter(Boolean).join(' ') : '(door removed)',
    round: pass ? pass.name || `Round ${pass.roundNumber}` : null,
    recordedBy: nameOf(live.userId),
    submittedAt: live.submittedAt,
    deskEntry: live.deskEntry ? { by: nameOf(live.deskEntry.byUserId), at: live.deskEntry.at } : null,
    edited: live.editedAt ? { by: nameOf(live.editedBy), at: live.editedAt } : null,
    answers: (live.answers || []).map((a) => ({
      questionKey: a.questionKey,
      questionLabel: a.questionLabel,
      answer: a.answer ?? null,
      optionIds: a.optionIds || [],
      otherText: a.otherText ?? null,
    })),
    offPath: (live.answers || [])
      .filter((a) => qByKey.has(a?.questionKey) && !visible.has(a.questionKey) && keysOf(a).length)
      .map((a) => ({ questionKey: a.questionKey, label: qByKey.get(a.questionKey).label, text: formatAnswerCell(a) })),
    questions: questions.map((q) => ({
      key: q.key,
      label: q.label,
      type: q.type,
      retired: !!q.retired,
      required: !!q.required,
      otherOption: !!q.otherOption,
      visibleIf: q.visibleIf || null,
      options: (q.options || []).map((o) => ({ id: o.id, text: o.text, retired: !!o.retired })),
    })),
    version: editorVersion(live),
  };
};

router.get('/:runId/response/:responseId', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const run = await loadEditRun(req, res, campaign);
    if (!run) return;
    if (run.mode !== 'queue') return res.status(404).json({ error: 'Not a one-person-at-a-time session' });
    const item = await itemFor(run._id, req.params.responseId);
    if (!item) return res.status(404).json({ error: 'That survey is not part of this session.', code: 'NOT_IN_SELECTION' });
    res.json({ current: await stepPayload(req, res, campaign, run, item.position) });
  } catch (err) {
    next(err);
  }
});

const stepSchema = z.object({
  responseId: objectIdish,
  version: z.string().max(100),
  answers: z.array(answerInputSchema).max(200),
});

router.post('/:runId/response', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const run = await loadEditRun(req, res, campaign);
    if (!run) return;
    if (run.mode !== 'queue' || run.status !== 'open') {
      return res.status(409).json({ error: 'That session is already finished.', code: 'RUN_NOT_OPEN' });
    }
    const body = stepSchema.parse(req.body);
    const item = await itemFor(run._id, body.responseId);
    if (!item) return res.status(400).json({ error: 'That survey is not part of this session.', code: 'NOT_IN_SELECTION' });
    const advance = async () => {
      const next = await AnswerEditRun.findOneAndUpdate(
        { _id: run._id, status: 'open' },
        { $max: { cursor: item.position + 1 } },
        { new: true }
      ).lean();
      return next || run;
    };

    const live = await SurveyResponse.collection.findOne({ voterId: item.v, passId: item.p ?? null });
    if (!live) {
      const nextRun = await advance();
      return res.json({ skipped: true, reason: 'not_found', run: answerEditRunWire(nextRun), current: await stepPayload(req, res, campaign, nextRun, nextRun.cursor) });
    }
    const questions = run.template?.questions || [];
    // A double-submitted Save & next: this step already landed, and what was posted is what's on
    // file now. A no-op, not a conflict.
    if (
      item.a &&
      (live.answerEditMarks || []).some((m) => String(m) === String(item.a)) &&
      !planFromAnswers(questions, live.answers || [], body.answers).length
    ) {
      const nextRun = await advance();
      return res.json({ saved: true, already: true, run: answerEditRunWire(nextRun), current: await stepPayload(req, res, campaign, nextRun, nextRun.cursor) });
    }
    if (editorVersion(live) !== body.version) {
      return res.status(409).json({
        error: 'This survey changed while you were editing. The latest answers are shown — make your change again.',
        code: 'RESPONSE_CHANGED',
        current: await stepPayload(req, res, campaign, run, item.position),
      });
    }
    const plan = planFromAnswers(questions, live.answers || [], body.answers);
    const res1 = plan.length ? applyEditPlan(questions, live.answers || [], plan, { mode: 'person', flow: run.template?.flow }) : null;
    if (!res1?.changed) {
      // Save & next with nothing changed is a skip.
      const nextRun = await advance();
      return res.json({ skipped: true, run: answerEditRunWire(nextRun), current: await stepPayload(req, res, campaign, nextRun, nextRun.cursor) });
    }
    const w = await writeOneSurvey({ live, nextAnswers: res1.answers, byUserId: req.user._id, at: new Date(), runId: run._id });
    if (w.conflict) {
      return res.status(409).json({
        error: 'This survey changed while you were editing. The latest answers are shown — make your change again.',
        code: 'RESPONSE_CHANGED',
        current: await stepPayload(req, res, campaign, run, item.position),
      });
    }
    // The step's counts land on its chunk (rollUp sums chunks for both modes) and its landed row on
    // the frozen item, which is what "12 of 30 done" and the undo read.
    const chunk = await AnswerEditRunChunk.findById(item.chunkId).lean();
    const counts = chunk.counts || emptyCounts();
    fold(counts, questions, res1);
    const items = (chunk.items || []).map((it) => (String(it.r) === String(item.r) ? { ...it, a: w.rowId } : it));
    await AnswerEditRunChunk.updateOne({ _id: item.chunkId }, { $set: { counts, items } });
    await rollUp(run._id);
    const nextRun = await advance();
    res.json({ saved: true, run: answerEditRunWire(nextRun), current: await stepPayload(req, res, campaign, nextRun, nextRun.cursor) });
  } catch (err) {
    if (sendError(res, err)) return;
    next(err);
  }
});

router.post('/:runId/skip', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const run = await loadEditRun(req, res, campaign);
    if (!run) return;
    if (run.mode !== 'queue' || run.status !== 'open') {
      return res.status(409).json({ error: 'That session is already finished.', code: 'RUN_NOT_OPEN' });
    }
    const { responseId } = z.object({ responseId: objectIdish }).parse(req.body);
    const item = await itemFor(run._id, responseId);
    if (!item) return res.status(400).json({ error: 'That survey is not part of this session.', code: 'NOT_IN_SELECTION' });
    const nextRun = (await AnswerEditRun.findOneAndUpdate({ _id: run._id, status: 'open' }, { $max: { cursor: item.position + 1 } }, { new: true }).lean()) || run;
    res.json({ run: answerEditRunWire(nextRun), current: await stepPayload(req, res, campaign, nextRun, nextRun.cursor) });
  } catch (err) {
    if (sendError(res, err)) return;
    next(err);
  }
});

// Stop here: the session completes and its one history row is written if it changed anything.
router.post('/:runId/close', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const run = await loadEditRun(req, res, campaign);
    if (!run) return;
    if (run.mode !== 'queue' || run.status !== 'open') {
      return res.status(409).json({ error: 'That session is already finished.', code: 'RUN_NOT_OPEN' });
    }
    const closed = await AnswerEditRun.findOneAndUpdate(
      { _id: run._id, status: 'open' },
      { $set: { status: 'completed', completedAt: new Date(), planSummary: queueSummary(run) } },
      { new: true }
    ).lean();
    if (closed) await writeRunHistory(closed._id);
    const fresh = await AnswerEditRun.findById(run._id).lean();
    const by = await byName([fresh], activeOrgId(req));
    res.json({ run: answerEditRunWire(fresh, by(fresh)) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Pick up, Start again, Undo
// ---------------------------------------------------------------------------

// The apply phase again: from `failed` with no undo ever started, or — Start again — a run still
// `pending` ten minutes after it was queued. Once an undo has started, never.
router.post('/:runId/resume', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const run = await loadEditRun(req, res, campaign);
    if (!run) return;
    if (run.undo?.status) {
      return res.status(409).json({ error: 'That change has been undone, so it can never be applied again.', code: 'NOT_RESUMABLE' });
    }
    const busy = await otherChangeRunning(campaign._id, { exceptRunId: run._id });
    if (busy) return res.status(409).json(busy);
    const stale = new Date(Date.now() - WAIT_MS);
    const claimed = await AnswerEditRun.findOneAndUpdate(
      {
        _id: run._id,
        mode: 'bulk',
        'undo.status': null,
        $or: [{ status: 'failed' }, { status: 'pending', updatedAt: { $lt: stale } }],
      },
      { $set: { status: 'pending', error: null } },
      { new: true }
    );
    if (!claimed) {
      return res.status(409).json({ error: 'Only a change that stopped part-way, or one still waiting for the worker, can be picked up.', code: 'NOT_RESUMABLE' });
    }
    const by = await byName([run], activeOrgId(req));
    try {
      await enqueueApply(claimed);
    } catch {
      const failed = await AnswerEditRun.findByIdAndUpdate(
        run._id,
        { $set: { status: 'failed', error: 'Could not restart the change. Nothing more has been changed — try again shortly.' } },
        { new: true }
      ).lean();
      return res.status(503).json({ error: failed.error, code: 'QUEUE_UNAVAILABLE', run: answerEditRunWire(failed, by(failed)) });
    }
    const fresh = await AnswerEditRun.findById(run._id).lean();
    res.json({ run: answerEditRunWire(fresh, by(fresh)) });
  } catch (err) {
    next(err);
  }
});

// Undo, Undo again (some surveys kept newer answers or waited on a later change), Retry undo (a
// stopped undo), and Start again on an undo still waiting for the worker. Never while a phase
// runs or a one-person session is open.
router.post('/:runId/revert', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const run = await loadEditRun(req, res, campaign);
    if (!run) return;
    if (run.status === 'open') {
      return res.status(409).json({ error: 'Stop the session first, then undo it.', code: 'RUN_OPEN' });
    }
    if (!['completed', 'failed'].includes(run.status)) {
      return res.status(409).json({ error: 'That change is still running.', code: 'RUN_BUSY' });
    }
    const busy = await otherChangeRunning(campaign._id, { exceptRunId: run._id });
    if (busy) return res.status(409).json(busy);
    const stale = new Date(Date.now() - WAIT_MS);
    const prior = {
      status: run.undo?.status ?? null,
      requestedAt: run.undo?.requestedAt ?? null,
      requestedBy: run.undo?.requestedBy ?? null,
    };
    const claimed = await AnswerEditRun.findOneAndUpdate(
      {
        _id: run._id,
        status: { $in: ['completed', 'failed'] },
        $or: [
          { 'undo.status': { $in: [null, 'done', 'failed'] } },
          { 'undo.status': 'pending', 'undo.requestedAt': { $lt: stale } },
        ],
      },
      { $set: { 'undo.status': 'pending', 'undo.requestedAt': new Date(), 'undo.requestedBy': req.user._id, 'undo.error': null } },
      { new: true }
    );
    if (!claimed) return res.status(409).json({ error: 'That undo is still running.', code: 'RUN_BUSY' });
    const by = await byName([run], activeOrgId(req));
    try {
      await enqueueUndo(claimed);
    } catch {
      // Back to what it was: an undo marked pending with no job would offer nothing.
      const restored = await AnswerEditRun.findByIdAndUpdate(
        run._id,
        { $set: { 'undo.status': prior.status, 'undo.requestedAt': prior.requestedAt, 'undo.requestedBy': prior.requestedBy } },
        { new: true }
      ).lean();
      return res.status(503).json({
        error: 'Could not start the undo. Nothing has been changed — try again shortly.',
        code: 'QUEUE_UNAVAILABLE',
        run: answerEditRunWire(restored, by(restored)),
      });
    }
    const fresh = await AnswerEditRun.findById(run._id).lean();
    res.status(202).json({ run: answerEditRunWire(fresh, by(fresh)) });
  } catch (err) {
    next(err);
  }
});

export default router;
