import crypto from 'node:crypto';
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
import { resolveEntryScope, sendScopeError, ScopeError } from '../../services/canvass/entryScope.js';
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
  reviewDeadline,
  REVIEW_TOO_SLOW_MESSAGE,
} from '../../services/canvass/answerEditScope.js';
import { writeOneSurvey, fold, emptyCounts } from '../../services/canvass/answerEditWriter.js';
import { sweepIfDeleting, sweptAfter } from '../../services/platform/lateWriteSweep.js';
import { stepIn, STEP_OUT, STEPPING, NO_FRESH_STEP, stepStillSaving } from '../../services/canvass/stepCount.js';
import {
  freezeTemplate,
  createAnswerEditRun,
  enqueueApply,
  enqueueUndo,
  otherChangeRunning,
  rollUp,
  writeRunHistory,
  markNothingOnFile,
  queueSummary,
  answerEditRunWire,
  parkUnqueued,
  parkUnqueuedUndo,
  undoWords,
} from '../../services/canvass/answerEditRuns.js';
import { hydrateCanvassers } from '../../services/reports/canvasserIdentity.js';
import { addAuditSubjects } from '../../services/access/supportAccess.js';
import { formatAnswerCell } from '../../services/surveys/answerDisplay.js';
import { makeCell, visibleQuestionKeys } from '../../services/surveys/visibility.js';
import { isAnswerable } from '../../services/surveys/routing.js';

// The review's digest of a bulk change, bound to the plan it priced (canonical JSON of the validated
// plan), so Confirm can only write what Review showed.
const canonicalJson = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonicalJson).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
      : JSON.stringify(v ?? null);
const planDigest = (digest, plan) => `${digest}:${crypto.createHash('sha1').update(canonicalJson(plan || [])).digest('hex')}`;

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
  // A dry run's read that ran out of its time (maxTimeMS) outside the scan's own handling.
  if (err?.code === 50 || err?.codeName === 'MaxTimeMSExpired') {
    res.status(503).json({ error: REVIEW_TOO_SLOW_MESSAGE, code: 'REVIEW_TOO_SLOW' });
    return true;
  }
  return sendScopeError(res, err);
};

// ---------------------------------------------------------------------------
// Dry run and create
// ---------------------------------------------------------------------------

// The same priced review pressed again on this server — a double click, a retry after the router
// cut the first — joins the one running and answers with its result (code review round 4: three presses
// of a slow review ran three campaign-wide passes at once, each about three times slower than alone).
// Only the SAME review: a different one runs at once, never waiting inside its own time budget behind
// another (round 5: a review that succeeded alone was refused after waiting behind a quicker one).
// At most two DIFFERENT reviews work at once on this server: side by side they shared the connection
// pool and the event loop, three lost their tag prices together, and two heavy ones took a web dyno near
// its memory (round 6). A heavy one — over ANSWER_EDIT_HEAVY_REVIEW surveys — takes both places, so it
// runs alone (round 7: two of them still took 1 GB and held other requests waiting for a connection),
// and the form's own reads (opening Edit answers…, Check again, another survey) take a place too: they
// read every survey just the same (round 7). So does a priced review of a campaign holding over
// ANSWER_EDIT_HEAVY_CAMPAIGN surveys, whatever its selection: its campaign-wide pricing is campaign-sized
// (round 8: two one-entry reviews of a 50,000-survey campaign took as much memory as one heavy one, and
// lost their tag prices together). The next one is refused at once rather than queued inside its own time
// budget (round 5's lesson). A press takes its place as it arrives, before it reads anything, and a heavy
// one its second as soon as its surveys are counted (round 8: places were taken only once a press had read
// its selection, so the form's first open, or a heavy press beside one other review, was refused after
// reading everything, and a lighter press made later took the place a heavy one pressed first was about to
// need); a press joining one already running is not another, and gives its place back.
const REVIEWS_AT_ONCE = () => Number(process.env.ANSWER_EDIT_REVIEWS_AT_ONCE) || 2;
const HEAVY_REVIEW = () => Number(process.env.ANSWER_EDIT_HEAVY_REVIEW) || 10000;
const HEAVY_CAMPAIGN = () => Number(process.env.ANSWER_EDIT_HEAVY_CAMPAIGN) || 25000;
const REVIEW_BUSY_MESSAGE = 'Another review is being worked out on this server right now. Try again in a few seconds.';
const reviewsRunning = new Map(); // key -> the review's promise
// The same priced review pressed twice at the same moment — a double press, two admins — met nothing
// running yet to join: each took its places on arrival, and one was refused while the other worked
// (round 9: its retry joined). A priced review names its survey, so its key is known on arrival: the
// first press is answering under it from then on, and a second arriving meanwhile takes no place, reads
// nothing, and answers with the first's answer — its own audit line written all the same.
const reviewsAnswering = new Map(); // key -> promise of the first press's { status, json }
let placesHeld = 0;
const reviewBusy = () => new ScopeError(503, 'REVIEW_BUSY', REVIEW_BUSY_MESSAGE);
// One press's places: taken up to `n` (refused when they aren't free), given back once it has answered.
const reviewPlaces = () => {
  let held = 0;
  return {
    take(n = 1) {
      const more = Math.min(n, REVIEWS_AT_ONCE()) - held;
      if (more <= 0) return;
      if (placesHeld + more > REVIEWS_AT_ONCE()) throw reviewBusy();
      placesHeld += more;
      held += more;
    },
    release() {
      placesHeld -= held;
      held = 0;
    },
  };
};
const reviewOnce = async (key, run, places, weight = 1) => {
  const running = reviewsRunning.get(key);
  if (running) {
    places.release();
    return running;
  }
  // A press that came to join one which finished meanwhile takes its own places now — both for a heavy one
  // (round 9: it ran on one, beside a light review).
  places.take(weight);
  const promise = run();
  reviewsRunning.set(key, promise);
  try {
    return await promise;
  } finally {
    if (reviewsRunning.get(key) === promise) reviewsRunning.delete(key);
  }
};
// The same selection ticked in another order is the same review — in the same mode: One person at a time
// reads no plan, so a priced review must never join it (round 8: it answered with no price).
const reviewKey = (campaign, body, template) =>
  crypto
    .createHash('sha1')
    .update(
      JSON.stringify([
        String(campaign._id), body.mode, body.scope || {}, body.actionIds ? [...body.actionIds].map(String).sort() : null,
        String(template.surveyTemplateId), template.version, body.plan || null, body.asOf || null,
      ])
    )
    .digest('hex');

router.post('/', async (req, res, next) => {
  // A dry run's time budget runs from here (answerEditScope.js REVIEW_BUDGET_MS).
  const startedAt = Date.now();
  const places = reviewPlaces();
  let answered = null;
  let answeringKey = null;
  let answeringPromise = null;
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    const body = createSchema.parse(req.body);
    // A review's place, before it reads anything: refused at once when none is free on this server —
    // unless it joins the same review already running (its survey named; Review always names it). A
    // priced review of a big campaign is heavy whatever it selects, so it takes both now (round 9: it took
    // its second only after reading its selection, and was refused then).
    const bigCampaign = (campaign.stats?.surveyCount || 0) > HEAVY_CAMPAIGN();
    if (body.dryRun) {
      const named = body.surveyTemplateId
        ? await SurveyTemplate.findOne({ _id: body.surveyTemplateId, organizationId: campaign.organizationId }).lean()
        : null;
      const key = named ? reviewKey(campaign, body, freezeTemplate(named)) : null;
      const first = key ? reviewsAnswering.get(key) : null;
      if (first) {
        const answer = await first;
        if (answer.json?.price?.manifest) addAuditSubjects(res, 'voter', answer.json.price.manifest.map((m) => String(m.voterId)));
        return res.status(answer.status).json(answer.json);
      }
      if (!(named && reviewsRunning.has(key))) {
        places.take(body.mode === 'bulk' && body.plan && bigCampaign ? 2 : 1);
      }
      if (key) {
        // Answering from here: whatever this press sends is the twin's answer too; a press that ends in
        // a throw hands the twin the throw (below).
        const answering = new Promise((resolve, reject) => { answered = { resolve, reject }; });
        answering.catch(() => {});
        reviewsAnswering.set(key, answering);
        answeringKey = key;
        answeringPromise = answering;
        const sendJson = res.json.bind(res);
        res.json = (json) => {
          answered.resolve({ status: res.statusCode, json });
          return sendJson(json);
        };
      }
    }
    const q = await resolveEntryScope(campaign, body.scope || {});
    const sel = await resolveEditEntries(campaign, q, body.actionIds || null);
    const asOf = body.asOf ? new Date(body.asOf) : new Date();

    // Which survey: the one asked for, else the answer filter's own, else the one most of these
    // surveys were recorded under.
    const present = await surveysAtVisits(campaign, q, sel, asOf, { deadline: body.dryRun ? reviewDeadline(startedAt) : null });
    const chosenId = body.surveyTemplateId || q.answerScope?.surveyTemplateId || present[0]?.surveyTemplateId || null;
    if (!chosenId) {
      return res.status(400).json({ error: 'None of these entries holds survey answers to edit.', code: 'NO_SURVEYS' });
    }
    const templateDoc = await SurveyTemplate.findOne({ _id: chosenId, organizationId: campaign.organizationId }).lean();
    if (!templateDoc) return res.status(404).json({ error: 'Survey not found' });
    const template = freezeTemplate(templateDoc);

    const plan = body.mode === 'bulk' && body.plan ? validatePlan(template.questions, body.plan) : null;
    if (body.mode === 'bulk' && !body.dryRun && !plan) throw new PlanError('PLAN_EMPTY');

    let heavy = false;
    if (body.dryRun) {
      // A heavy review runs alone: its second place now, before anything more is read.
      const surveysRead = present.reduce((n, p) => n + (p.responses || 0), 0);
      heavy = surveysRead > HEAVY_REVIEW() || (!!plan && bigCampaign);
      if (heavy && !reviewsRunning.has(reviewKey(campaign, body, template))) places.take(2);
      const [heldByRuns, names] = await Promise.all([
        countHeldByRuns(campaign, q, { deadline: reviewDeadline(startedAt) }),
        SurveyTemplate.find({ _id: { $in: present.map((p) => p.surveyTemplateId) } }, { name: 1 }).lean(),
      ]);
      const nameOf = new Map(names.map((t) => [String(t._id), t.name]));
      // Matched surveys at visits the selection left out: the entry's date is its LATEST survey's
      // time, so a door re-surveyed after the window has matching surveys the table can't show.
      // Only meaningful for a whole-filter selection the answer scope saw entirely — and only when
      // the edit is of the filter's own survey: its matches are counted in that survey, so set against
      // another survey's they named surveys "left out" that were never there (code review round 2).
      const matchedNotSelectedOf = (responses) =>
        q.answerMatch &&
        !body.actionIds?.length &&
        !body.scope?.effortId &&
        q.answerScope &&
        !q.answerScope.truncated &&
        String(q.answerScope.surveyTemplateId) === String(template.surveyTemplateId)
          ? Math.max(0, q.answerScope.responses - responses)
          : 0;
      const preview = () =>
        buildEditPreview({ campaign, q, sel, template, asOf, plan, matchedNotSelectedOf, startedAt }).then(({ payload: p }) => ({ payload: p, asOf }));
      // A joined review answers with ITS asOf: its digest is of the surveys on file then.
      const { payload, asOf: pricedAsOf } = await reviewOnce(reviewKey(campaign, body, template), preview, places, heavy ? 2 : 1);
      // A priced review names the voters whose surveys change (its manifest): the access log names
      // them too — on every request, a joined one included (round 4).
      if (payload.price) addAuditSubjects(res, 'voter', payload.price.manifest.map((m) => String(m.voterId)));
      const overCap = payload.responses > answerEditCap();
      // Whether One person at a time CAN take this selection — asked before the admin picks it.
      const overQueue = payload.responses > ANSWER_EDIT_QUEUE_MAX;
      // Another change already running on the campaign: the form says so before Review, not after Confirm.
      const blocked = await otherChangeRunning(campaign._id);
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
        blocked: blocked ? { error: blocked.error, code: blocked.code } : null,
        ...payload,
        // A priced review's digest covers its plan too: a create sending any other plan is stale.
        digest: plan ? planDigest(payload.digest, plan) : payload.digest,
        asOf: pricedAsOf.toISOString(),
      });
    }

    // ---- create ----
    if (!body.digest || !body.asOf) {
      return res.status(400).json({ error: 'Review the change first.', code: 'REVIEW_REQUIRED' });
    }
    const busy = await otherChangeRunning(campaign._id);
    if (busy) return res.status(409).json(busy);

    const scan = await scanEditTargets({ campaign, q, sel, template, asOf, plan: null, collectItems: true });
    // A bulk change is created only with the plan its review priced (round 3: a plan changed after
    // Review was priced as one thing and written as another).
    const expected = body.mode === 'bulk' ? planDigest(scan.digest, plan) : scan.digest;
    if (body.templateVersion !== template.version || body.digest !== expected) {
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

    // Swept after even when it throws part-way: its chunks go in before the run (round 4).
    const scopeSummary = await describeScope(campaign, body.scope || {});
    const run = await sweptAfter({ campaignId: campaign._id, organizationId: campaign.organizationId }, () => createAnswerEditRun({
      campaign,
      byUserId: req.user._id,
      mode: body.mode,
      template,
      plan: plan || [],
      planSummary: plan ? summarizePlan(template.questions, plan) : null,
      selection: { scope: body.scope || {}, byIds: !!body.actionIds?.length, digest: scan.digest, asOf, total: scan.responses },
      scopeSummary,
      items: scan.items,
    }));
    // One change at a time, made atomic: the check above can race another admin's create (a
    // conversion or an unknock scanning at the same moment — this create takes seconds at scale), so
    // with this run on file it runs again; whichever create checks second sees the other and steps
    // back (code review 2026-10-19: two changes at once undid an edit silently).
    const raced = await otherChangeRunning(campaign._id, { exceptRunId: run._id });
    if (raced) {
      await Promise.all([AnswerEditRun.deleteOne({ _id: run._id }), AnswerEditRunChunk.deleteMany({ runId: run._id })]);
      return res.status(409).json(raced);
    }
    // A deletion of the campaign or its organization whose cascade passed these collections while this
    // create was in flight: the run and its chunks go with the tenant's rows (round 4: a one-person
    // session, with no job to sweep after it, outlived its organization — its chunk naming a canvasser).
    if (await sweepIfDeleting(run)) return res.status(409).json({ error: 'This campaign is being deleted.', code: 'campaign-deleting' });
    const by = await byName([run], activeOrgId(req));

    if (body.mode === 'queue') {
      const current = await stepPayload(req, res, campaign, run.toObject(), 0);
      return res.status(201).json({ run: answerEditRunWire(run.toObject(), by(run)), current });
    }
    try {
      await enqueueApply(run);
    } catch {
      // Parked only if its job never started, and with the job id forgotten, so a late delivery
      // can't apply a change the admin was told didn't happen.
      const failed = await parkUnqueued(run._id, 'Could not start the change. Nothing has been changed — press Pick up where it stopped to try again.');
      if (failed) {
        await markNothingOnFile([failed]);
        return res.status(503).json({ error: failed.error, code: 'QUEUE_UNAVAILABLE', run: answerEditRunWire(failed, by(failed)) });
      }
    }
    const fresh = await AnswerEditRun.findById(run._id).lean();
    res.status(201).json({ run: answerEditRunWire(fresh, by(fresh)) });
  } catch (err) {
    answered?.reject(err);
    if (sendError(res, err)) return;
    next(err);
  } finally {
    places.release();
    if (answeringKey && reviewsAnswering.get(answeringKey) === answeringPromise) reviewsAnswering.delete(answeringKey);
  }
});

// ---------------------------------------------------------------------------
// The list, the poll, Details
// ---------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const campaign = await loadForAnswerEdit(req, res);
    if (!campaign) return;
    // A finished run that changed nothing (an opened-and-abandoned session) is not a change — judged
    // by its copies, not its counts (round 3: a run whose counts missed a landed copy was hidden, and
    // could not be undone).
    const found = await AnswerEditRun.find({ campaignId: campaign._id, organizationId: activeOrgId(req) }, { 'template.questions': 0 })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    await markNothingOnFile(found);
    const runs = found.filter((r) => !(r.status === 'completed' && r.nothingOnFile)).slice(0, 50);
    const by = await byName(runs, activeOrgId(req));
    // Each row names voters — its samples and the surveys its undo left — and the Details screen reads
    // them from here: the access log names them too, as the single run's poll does (round 4).
    addAuditSubjects(
      res,
      'voter',
      [...new Set(runs.flatMap((r) => [...(r.samples || []), ...(r.undo?.summary?.names || [])]).map((n) => n.voterId).filter(Boolean).map(String))]
    );
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
    await markNothingOnFile([run]);
    const wire = answerEditRunWire(run, by(run));
    // The card names voters — its samples and the surveys an undo didn't put back: the access log
    // names them too (round 3), and the undo's words are written now.
    addAuditSubjects(res, 'voter', [...(run.samples || []), ...(run.undo?.summary?.names || [])].map((n) => n.voterId).filter(Boolean).map(String));
    if (wire.undo?.summary?.names?.length) wire.undo.summary.names = await undoWords(run, run.undo.summary.names);
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
      const page = names.slice(skip, skip + limit);
      // The access log names the voters this page shows (round 3: only the changes branch did).
      addAuditSubjects(res, 'voter', page.map((n) => n.voterId).filter(Boolean).map(String));
      // `total` pages over the names the undo STORED (the first 200); `namesTotal` is how many
      // weren't put back in all — a page past the stored names used to read "every survey put back".
      return res.json({
        kind: 'undo',
        entries: await undoWords(run, page),
        total: names.length,
        namesTotal: run.undo.summary.namesTotal || names.length,
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
  // Re-surveyed under a different survey since the session started: this session's questions don't
  // apply to it — never show, or write, one survey's answers over another's.
  if (String(live.surveyTemplateId) !== String(run.template?.surveyTemplateId)) return { ...base, missing: true, reason: 'other_survey' };
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
    if (!live || String(live.surveyTemplateId) !== String(run.template?.surveyTemplateId)) {
      const nextRun = await advance();
      return res.json({
        skipped: true,
        reason: live ? 'other_survey' : 'not_found',
        run: answerEditRunWire(nextRun),
        current: await stepPayload(req, res, campaign, nextRun, nextRun.cursor),
      });
    }
    // The access log names the voter this save reads and writes (the step payload adds the next one).
    addAuditSubjects(res, 'voter', [String(live.voterId)]);
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
    // Counted in for the write and its bookkeeping, so a stop, an Erase or a change starting meanwhile
    // sees this step (round 3) — and only while the session is still open, so an Undo, which waits out
    // a step still counted in, never starts beside one (stepCount.js, round 4).
    const counted = await AnswerEditRun.updateOne({ _id: run._id, status: 'open' }, stepIn());
    if (counted.matchedCount !== 1) return res.status(409).json({ error: 'That session is already finished.', code: 'RUN_NOT_OPEN' });
    let w;
    try {
      w = await writeOneSurvey({ live, nextAnswers: res1.answers, byUserId: req.user._id, at: new Date(), runId: run._id });
      if (!w.conflict) {
        // The step's counts land on its chunk (rollUp sums chunks for both modes) and its landed row
        // on its frozen item, which is what "12 of 30 done" and the undo read. Compare-and-swap on
        // the chunk's revision, retried: two admins stepping one session at once must not lose each
        // other's step. Each retry re-reads, so only a step landing on this chunk in every one of
        // those few milliseconds could outlast them; that is logged, never silent. The item is
        // written by its position, never the whole list from the read — and never once an undo has
        // fenced the chunk: the list from the read wiped the undo's record of what it had put back
        // (round 4).
        let recorded = false;
        let fenced = false;
        // What earlier saves of this survey counted: their `cq`, or — saves from before it existed (the
        // first build) recorded only their copies — what each of this run's copies of the survey differs by
        // from the survey just after that save: the next copy of the survey made after it (a teammate's
        // overwrite, a profile edit, another save), else the survey as this step read it (round 6; round 7:
        // read against the survey now, a teammate's edit in between counted as the session's, and that
        // question was never counted). A copy erased since can't be read: its save's questions count again.
        let derivedCq = null;
        let slotCopies = null;
        const copiesOfSlot = async () => {
          if (!slotCopies) {
            slotCopies = await SurveyResponseArchive.collection
              .find({ voterId: live.voterId, passId: live.passId ?? null }, { projection: { answers: 1, answerEditRunId: 1, overwrittenAt: 1 } })
              .sort({ overwrittenAt: 1, _id: 1 })
              .toArray();
          }
          return slotCopies;
        };
        const countedBefore = async (prior) => {
          if (!prior?.a) return null;
          if (prior.cq) return new Set(prior.cq);
          if (!derivedCq) {
            const all = await copiesOfSlot();
            const keys = new Set();
            all.forEach((c, i) => {
              if (String(c.answerEditRunId) !== String(run._id) || String(c._id) === String(w.rowId)) return;
              const next = all[i + 1]?.answers ?? live.answers ?? [];
              for (const p of planFromAnswers(questions, c.answers || [], next)) keys.add(p.questionKey);
            });
            derivedCq = [...keys];
          }
          return new Set(derivedCq);
        };
        // Every copy this session's saves made of the survey (`as`; the undo's erased reading, round 6) —
        // for one the first build saved, every copy of it this run has on file, never only its latest (round
        // 7: the first build kept only `a`, and an earlier copy erased later read "put back").
        const savedBefore = async (prior) => {
          if (prior?.as) return prior.as.map(String);
          if (!prior?.a) return [];
          const all = await copiesOfSlot();
          const mine = all.filter((c) => String(c.answerEditRunId) === String(run._id)).map((c) => String(c._id));
          // ...and the marks on the survey made while this session was open whose copies are gone — one erased
          // before this save was this session's too, read as a session with no `as` reads it (round 8: left
          // out, the undo read "put back" while the survey held the session's first save).
          const onFile = new Set(all.map((c) => String(c._id)));
          const since = new Date(run.createdAt || 0).getTime() - 1000;
          const gone = (live.answerEditMarks || []).map(String).filter((m) => !onFile.has(m) && new mongoose.Types.ObjectId(m).getTimestamp().getTime() >= since);
          return [String(prior.a), ...mine, ...gone];
        };
        for (let attempt = 0; attempt < 30 && !recorded && !fenced; attempt += 1) {
          const chunk = await AnswerEditRunChunk.findById(item.chunkId).lean();
          if (chunk.fenced) {
            fenced = true;
            break;
          }
          const counts = chunk.counts || emptyCounts();
          const at = (chunk.items || []).findIndex((it) => String(it.r) === String(item.r));
          const prior = at >= 0 ? chunk.items[at] : null;
          // A survey this session already changed is still one survey changed, and each question one
          // survey, however many times it is saved (round 5: saved twice, it read "2 surveys changed").
          const already = await countedBefore(prior);
          fold(counts, questions, res1, already);
          const counted = [...new Set([...(already || []), ...res1.rows.map((c) => c.questionKey)])];
          const copies = [...new Set([...(await savedBefore(prior)), String(w.rowId)])].map((id) => new mongoose.Types.ObjectId(id));
          const rev = chunk.stepRev || 0;
          const swapped = await AnswerEditRunChunk.updateOne(
            { _id: item.chunkId, stepRev: rev === 0 ? { $in: [0, null] } : rev, fenced: { $ne: true } },
            {
              $set: { counts, ...(at >= 0 ? { [`items.${at}.a`]: w.rowId, [`items.${at}.cq`]: counted, [`items.${at}.as`]: copies } : {}) },
              $inc: { stepRev: 1 },
            }
          );
          recorded = swapped.matchedCount === 1;
        }
        if (!recorded && !fenced) console.error(`[answer-edits] step on run ${run._id} landed, but its counts could not be recorded on chunk ${item.chunkId}`);
        const rolled = await rollUp(run._id);
        // Stopped by someone else while this step was saving: the session's History row is already
        // written, so this step is reported as one more — before the step counts out, so the row
        // can't land after an Undo's (round 4).
        if (rolled && rolled.status !== 'open') await writeRunHistory(run._id);
      }
    } finally {
      await AnswerEditRun.updateOne({ _id: run._id, ...STEPPING }, STEP_OUT).catch(() => {});
    }
    // Deleted while this step wrote: what it wrote goes with the tenant (lateWriteSweep.js, round 3).
    if (await sweepIfDeleting(run)) return res.status(409).json({ error: 'This campaign is being deleted.', code: 'campaign-deleting' });
    if (w.conflict) {
      return res.status(409).json({
        error: 'This survey changed while you were editing. The latest answers are shown — make your change again.',
        code: 'RESPONSE_CHANGED',
        current: await stepPayload(req, res, campaign, run, item.position),
      });
    }
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
    const prior = await AnswerEditRun.findOneAndUpdate(
      {
        _id: run._id,
        mode: 'bulk',
        'undo.status': null,
        // Stopped part-way; or Start again on one still waiting for the worker, or one RUNNING with
        // no heartbeat for ten minutes (its job is gone — a lost queue entry, a stop that left it).
        $or: [{ status: 'failed' }, { status: 'pending', updatedAt: { $lt: stale } }, { status: 'running', updatedAt: { $lt: stale } }],
      },
      { $set: { status: 'pending', error: null } },
      { new: false }
    ).lean();
    if (!prior) {
      return res.status(409).json({ error: 'Only a change that stopped part-way, or one still waiting for the worker, can be picked up.', code: 'NOT_RESUMABLE' });
    }
    // One change at a time, made atomic like the creates (code review round 2): with this run
    // claimed, a start on the other side that checks after this sees it; one that checked before
    // is on file now, and this steps back to where it was.
    const raced = await otherChangeRunning(campaign._id, { exceptRunId: run._id });
    if (raced) {
      await AnswerEditRun.updateOne(
        { _id: run._id, status: 'pending', queueJobId: prior.queueJobId ?? null },
        { $set: { status: prior.status, error: prior.error ?? null } }
      );
      return res.status(409).json(raced);
    }
    const claimed = await AnswerEditRun.findById(run._id);
    const by = await byName([run], activeOrgId(req));
    try {
      await enqueueApply(claimed);
    } catch {
      const failed = await parkUnqueued(run._id, 'Could not restart the change. Nothing more has been changed — try again shortly.');
      if (failed) {
        await markNothingOnFile([failed]);
        return res.status(503).json({ error: failed.error, code: 'QUEUE_UNAVAILABLE', run: answerEditRunWire(failed, by(failed)) });
      }
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
    // A change none of whose edits is on file has nothing to undo (an undo of it would log "0 surveys
    // put back" for a change History never listed) — judged by its copies, never its counts, which a
    // race can leave short (round 3). One that never started is run by Pick up.
    if (!run.undo?.status && !(await SurveyResponseArchive.exists({ answerEditRunId: run._id }))) {
      return res.status(409).json({
        error:
          run.status === 'failed' && !run.startedAt
            ? 'This change never started, so there is nothing to undo. Press Pick up where it stopped to run it.'
            : 'None of this change’s edits are on file, so there is nothing to undo.',
        code: 'NOTHING_TO_UNDO',
      });
    }
    const busy = await otherChangeRunning(campaign._id, { exceptRunId: run._id });
    if (busy) return res.status(409).json(busy);
    const stale = new Date(Date.now() - WAIT_MS);
    const prior = {
      status: run.undo?.status ?? null,
      requestedAt: run.undo?.requestedAt ?? null,
      requestedBy: run.undo?.requestedBy ?? null,
      jobId: run.undo?.jobId ?? null,
    };
    // An undo the first build began and that died inside its first pass (running or failed, no
    // lastRunAt, no receipts) is read the first build's way — kept on the run here, because this claim
    // overwrites the status it was recognised by (round 5).
    const firstBuildBegan = !run.undo?.receipts && !run.undo?.writesReceipts && !run.undo?.lastRunAt && ['running', 'failed'].includes(run.undo?.status);
    const claimed = await AnswerEditRun.findOneAndUpdate(
      {
        _id: run._id,
        status: { $in: ['completed', 'failed'] },
        // Never while one of its own one-person steps is still saving (the session stopped under it):
        // the step wrote its chunk over the undo's record of what it put back, and its History row
        // after the undo's (round 4).
        $and: [NO_FRESH_STEP()],
        $or: [
          { 'undo.status': { $in: [null, 'done', 'failed'] } },
          { 'undo.status': 'pending', 'undo.requestedAt': { $lt: stale } },
          // An undo RUNNING with no heartbeat for ten minutes: its job is gone.
          { 'undo.status': 'running', 'undo.lastRunAt': { $lt: stale } },
          // ...and one left running by the first build, which kept no heartbeat: judged as the card
          // judges it, by when it started (round 2: Start again was offered and refused forever).
          {
            'undo.status': 'running',
            'undo.lastRunAt': null,
            $or: [{ 'undo.startedAt': { $lt: stale } }, { 'undo.startedAt': null, updatedAt: { $lt: stale } }],
          },
        ],
      },
      {
        $set: {
          'undo.status': 'pending', 'undo.requestedAt': new Date(), 'undo.requestedBy': req.user._id, 'undo.error': null,
          'undo.writesReceipts': true,
          ...(firstBuildBegan ? { 'undo.legacy': true } : {}),
        },
      },
      { new: true }
    );
    if (!claimed) {
      const now = await AnswerEditRun.findById(run._id, { stepping: 1, steppingAt: 1 }).lean();
      if (stepStillSaving(now)) return res.status(409).json({ error: 'A survey in this session is still saving. Try again in a moment.', code: 'RUN_BUSY' });
      return res.status(409).json({ error: 'That undo is still running.', code: 'RUN_BUSY' });
    }
    // Claimed, then checked again — the same atomic step as Pick up's.
    const raced = await otherChangeRunning(campaign._id, { exceptRunId: run._id });
    if (raced) {
      await parkUnqueuedUndo(run._id, prior);
      return res.status(409).json(raced);
    }
    const by = await byName([run], activeOrgId(req));
    try {
      await enqueueUndo(claimed);
    } catch {
      // Back to what it was — the job id too, so a late delivery of this undo can't claim it — unless
      // the pass already started (then it's running; say that instead).
      const restored = await parkUnqueuedUndo(run._id, prior);
      if (restored) {
        return res.status(503).json({
          error: 'Could not start the undo. Nothing has been changed — try again shortly.',
          code: 'QUEUE_UNAVAILABLE',
          run: answerEditRunWire(restored, by(restored)),
        });
      }
    }
    const fresh = await AnswerEditRun.findById(run._id).lean();
    res.status(202).json({ run: answerEditRunWire(fresh, by(fresh)) });
  } catch (err) {
    next(err);
  }
});

export default router;
