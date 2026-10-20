import crypto from 'node:crypto';
import { setMaxListeners } from 'node:events';
import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Pass } from '../../models/Pass.js';
import {
  buildEntryFilter,
  resolveSelection,
  narrowSelection,
  selectionSpansDirections,
  CONVERTIBLE_SOURCES,
  RECLASSIFY_MAX_IMPACT_ENTRIES,
} from './reclassifyOutcomes.js';
import { visitsClause } from './answerScope.js';
import { doorKey } from './doorKey.js';
import { ScopeError } from './entryScope.js';
import { applyEditPlan, fingerprint, keysOf, isAnsweredRow } from './answerEdit.js';
import {
  choiceKeyStagesForMany,
  mergeOptionRows,
  answerTagClause,
  latestAnswerKeyStages,
  currentTagVoterSets,
} from '../surveys/answerAgg.js';
import { tagOptionMap } from '../surveys/tags.js';
import { currentVoterSetsByTag } from '../surveys/currentTags.js';
import { formatAnswerCell } from '../surveys/answerDisplay.js';
import { OTHER_OPTION_ID } from '../surveys/otherOption.js';
import { isAnswerable } from '../surveys/routing.js';
import { hydrateCanvassers } from '../reports/canvasserIdentity.js';

// Which surveys a Door Outcomes answer edit touches, and what it would do to the numbers —
// docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §D and §E. ONE computation feeds the form (no plan), the
// review (a plan) and the create call's re-check (the digest), so the three can't disagree.
//
// The unit is the SURVEY at a selected visit: entries are selected the page's usual way, and each
// selected visit's surveys are read with the same triple join the conversions use. Under an answer
// filter only the surveys that matched it change (owner ruling 1); with none, every survey at the
// visits. Bounded memory: the visits are read 2,000 at a time and only counters, per-key deltas,
// the frozen items and the first 50 manifest rows are kept.

// Its own cap, env-overridable at call time (the answerScopeCap pattern), so tuning it never moves
// the conversions'. Up to this many surveys per run; one person at a time stops at 500 (D6).
export const ANSWER_EDIT_MAX_RESPONSES = 50000;
export const answerEditCap = () => Number(process.env.ANSWER_EDIT_MAX_RESPONSES) || ANSWER_EDIT_MAX_RESPONSES;
export const ANSWER_EDIT_QUEUE_MAX = 500;

const VISIT_BATCH = 2000;
const MANIFEST_CAP = 50;
const TAG_VOTER_BATCH = 1000;
// How many batches of voters the tag pass keeps going at once.
const TAG_BATCHES_IN_FLIGHT = 4;
// The most one $documents call ships; a batch over it splits by voter (the command limit is 16 MB).
const TAG_SHIP_MAX_BYTES = 8 * 1024 * 1024;
// How long, from the start of a review, its tag counts may take before the review goes out without
// them (it says they can't be previewed) — well inside the router's 30 s cut.
const TAG_PRICING_BUDGET_MS = 20_000;
// Both env-overridable at call time (the answerEditCap pattern), so a test can stand in for a database
// that can't make them.
const tagPricingBudgetMs = () => Number(process.env.ANSWER_EDIT_TAG_BUDGET_MS) || TAG_PRICING_BUDGET_MS;
// A review's whole budget, from the start of its request. Every read it makes carries the time left
// (maxTimeMS), so the database stops the work when the review stops waiting for it — round 4: the
// budget only stopped the waiting, and a slow database's reviews kept running past their answer, three
// presses deep, or answered past the router's cut. A scan that can't finish in it is refused
// (REVIEW_TOO_SLOW); results and tags that can't are said to be unavailable.
const REVIEW_BUDGET_MS = 25_000;
/** When a dry run that started at `startedAt` (epoch ms) must be done. */
export const reviewDeadline = (startedAt) => startedAt + (Number(process.env.ANSWER_EDIT_REVIEW_BUDGET_MS) || REVIEW_BUDGET_MS);
// Identified counts run this many at a time: each is a pass over the survey's results, and side by
// side they fought over the database's cores (16 at once: 10.5–14.7 s of server time against 2.9–3.6 s
// one after another — round 4).
const IDENTIFIED_IN_FLIGHT = 2;
// The most answer rows the scan keeps of the edited surveys for the tag pass (about 100 bytes each);
// past it the tag pass reads and re-edits those surveys itself.
const TAG_STASH_MAX_ROWS = 250_000;

const { BSON } = mongoose.mongo;
const oid = (v) => (v ? new mongoose.Types.ObjectId(String(v)) : null);

// The time a read may take before `deadline` (an epoch ms, or null for no limit), as the server's
// own limit: { maxTimeMS } — at least 1, so a read started at the deadline fails at once.
const timeLeft = (deadline) => (deadline ? { maxTimeMS: Math.max(1, deadline - Date.now()) } : {});
const ranOutOfTime = (err) => err?.code === 50 || err?.codeName === 'MaxTimeMSExpired';
export const REVIEW_TOO_SLOW_MESSAGE =
  'Working out this review is taking too long — the database is busy. Try again in a minute, or narrow the selection.';
const tooSlow = () => new ScopeError(503, 'REVIEW_TOO_SLOW', REVIEW_TOO_SLOW_MESSAGE);

/**
 * The selected Surveyed ENTRIES, refusing exactly where the page's other acts refuse: a truncated
 * answer or address scope without hand-ticked rows, a selection that mixes surveyed entries with
 * door outcomes, nothing selected, more than 25k entries.
 */
export const resolveEditEntries = async (campaign, q, actionIds = null) => {
  // An explicit empty list selects nothing (resolveSelection) — said before the truncation checks
  // below, which read a missing list as "the whole filter".
  if (Array.isArray(actionIds) && !actionIds.length) {
    throw new ScopeError(400, 'EMPTY_SELECTION', 'Nothing is selected — Edit answers works on Surveyed entries.');
  }
  if (q.answerScope?.truncated && !actionIds?.length) {
    throw new ScopeError(
      409,
      'ANSWER_SCOPE_TRUNCATED',
      `That answer filter matches more than ${q.answerScope.cap.toLocaleString()} answers — narrow it with a canvasser, round, walk list or date range before editing, or tick the rows you mean.`
    );
  }
  if (q.searchScope?.truncated && !actionIds?.length) {
    throw new ScopeError(
      409,
      'SEARCH_SCOPE_TRUNCATED',
      `That address search matches more than ${q.searchScope.cap.toLocaleString()} doors — narrow it before editing, or tick the rows you mean.`
    );
  }
  const wide = await resolveSelection(campaign._id, q, actionIds || null, CONVERTIBLE_SOURCES);
  if (selectionSpansDirections(wide)) {
    throw new ScopeError(
      409,
      'SELECTION_SPANS_DIRECTIONS',
      'Edit answers works on Surveyed entries only. Tick the Surveyed chip so the selection holds nothing else.'
    );
  }
  const sel = narrowSelection(wide, ['survey_submitted']);
  if (!sel.entries) throw new ScopeError(400, 'EMPTY_SELECTION', 'Nothing is selected — Edit answers works on Surveyed entries.');
  if (sel.entries > RECLASSIFY_MAX_IMPACT_ENTRIES) {
    throw new ScopeError(
      409,
      'SELECTION_TOO_LARGE',
      `That's ${sel.entries.toLocaleString()} entries — narrow the filter to ${RECLASSIFY_MAX_IMPACT_ENTRIES.toLocaleString()} or fewer.`
    );
  }
  return sel;
};

/**
 * Surveyed entries this filter matches that an earlier correction already stamped — the same
 * entry filter with the stamp rule inverted, every other clause kept (the answer clause included),
 * so the count matches the filter the admin set. Their surveys aren't included; the review says
 * so ("undo that change first, or edit those surveys on the voter's profile").
 */
export const countHeldByRuns = async (campaign, q, { deadline = null } = {}) => {
  const filter = buildEntryFilter(campaign._id, q, ['survey_submitted']);
  return CanvassActivity.countDocuments({ ...filter, reclassified: { $exists: true } }).setOptions(timeLeft(deadline));
};

// The selection's visits, deduplicated — one per (door, round, canvasser).
const visitsOf = (sel) => {
  const byKey = new Map();
  for (const r of sel.rows) {
    const k = doorKey(r);
    if (!byKey.has(k)) byKey.set(k, { householdId: r.householdId, passId: r.passId ?? null, userId: r.userId ?? null });
  }
  return [...byKey.values()];
};

const inWindow = (window, at) => {
  if (!window) return true;
  const t = at ? new Date(at).getTime() : NaN;
  if (window.$gte && !(t >= new Date(window.$gte).getTime())) return false;
  if (window.$lt && !(t < new Date(window.$lt).getTime())) return false;
  return true;
};

/**
 * Which surveys the selected visits hold, by survey (template), counting only those in the date
 * window and recorded by `asOf`. The form asks which one to edit when there are several.
 */
export const surveysAtVisits = async (campaign, q, sel, asOf, { deadline = null } = {}) => {
  const visits = visitsOf(sel);
  const counts = new Map();
  for (let i = 0; i < visits.length; i += VISIT_BATCH) {
    // One clause for the batch's doors and rounds; its own visits are kept here (round 8).
    const batch = visits.slice(i, i + VISIT_BATCH);
    const keys = new Set(batch.map(doorKey));
    let rows;
    try {
      rows = await SurveyResponse.find(
        { campaignId: campaign._id, ...visitsClause(batch) },
        { householdId: 1, passId: 1, userId: 1, surveyTemplateId: 1, submittedAt: 1, createdAt: 1 },
        timeLeft(deadline)
      ).lean();
    } catch (err) {
      throw ranOutOfTime(err) ? tooSlow() : err;
    }
    for (const r of rows) {
      if (!keys.has(doorKey(r))) continue;
      if (!inWindow(q.timestamp, r.submittedAt)) continue;
      if (asOf && r.createdAt && new Date(r.createdAt) > asOf) continue;
      const k = String(r.surveyTemplateId);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts.entries()].map(([surveyTemplateId, responses]) => ({ surveyTemplateId, responses })).sort((a, b) => b.responses - a.responses);
};

// An order-independent fold of the reviewed (survey, fingerprint) pairs: XOR of their sha1s, so the
// create call can re-derive it from a fresh read in any order and compare.
const xorInto = (acc, hex) => {
  const b = Buffer.from(hex, 'hex');
  for (let i = 0; i < acc.length; i += 1) acc[i] ^= b[i];
};
const pairHash = (id, fp) => crypto.createHash('sha1').update(`${id}:${fp}`).digest('hex');

// One question's picks as the results card would bucket them: mergeOptionRows over {key: count}.
// A write-in under a question whose "Other" was later switched off still reads as the write-in.
const bucketsOf = (q, keyCounts) => {
  const rows = [...keyCounts.entries()].map(([key, count]) => ({ _id: key, count }));
  return mergeOptionRows(q, rows).map((o) => {
    if (o.id == null && o.text === OTHER_OPTION_ID) return { id: OTHER_OPTION_ID, text: 'Other', retired: true, count: o.count };
    return o;
  });
};
const bump = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
// One answer row as the tag stages read it.
const tagRow = (a) => ({ questionKey: a.questionKey, optionIds: a.optionIds ?? [], answer: a.answer ?? null });

/**
 * Walk every survey at the selected visits once.
 *
 * Returns the counts the form and the review show, the frozen items (when `collectItems`), the
 * digest, and — with a plan — what the plan does to each survey, folded. With `stashQuestions` (the
 * questions of the tags the plan can reach), each changed survey's edited answers to those questions
 * are kept for the tag pass (`stash`), so it neither reads the surveys again nor applies the plan a
 * second time (round 3: the two together were a third of a heavy review's time); past
 * TAG_STASH_MAX_ROWS rows the stash is dropped and the tag pass does both itself.
 */
export const scanEditTargets = async ({
  campaign, q, sel, template, asOf, plan = null, collectItems = false, stashQuestions = null, stashAfterFirst = null, deadline = null, afterBatch = null,
}) => {
  const questions = template.questions || [];
  const answerable = questions.filter(isAnswerable);
  const qByKey = new Map(answerable.map((x) => [x.key, x]));
  const visits = visitsOf(sel);
  const out = {
    visits: visits.length,
    responses: 0,
    notMatched: 0,
    outsideDates: 0,
    otherSurvey: 0,
    afterReview: 0,
    items: collectItems ? [] : null,
    perQuestion: new Map(answerable.map((x) => [x.key, { answered: 0, keyCounts: new Map() }])),
    digestAcc: Buffer.alloc(20),
    // with a plan
    changed: 0,
    unchanged: new Map(), // first reason -> surveys
    skippedByQuestion: new Map(), // key -> Map(reason -> n)
    changedByQuestion: new Map(), // key -> { surveys, cleared, removedById: Map, addedById: Map, multi, keptById: Map, setTo: Map, droppedFollowUps }
    deltas: new Map(), // key -> Map(rawKey -> delta), campaign-wide pricing
    textCleared: new Map(),
    dropped: new Map(),
    endsScript: 0,
    recordedBy: new Map(),
    changedVoterIds: new Set(),
    changedResponseIds: new Set(),
    // responseId -> { _id, voterId, submittedAt, answers } — the edited version, tag questions only
    stash: stashQuestions ? new Map() : null,
    // The questions EVERY stashed survey has its rows of — the tag pass uses the stash only for tags
    // reading nothing else.
    stashCovers: stashQuestions,
    manifest: [],
  };
  let stashedRows = 0;
  let keepForTags = stashQuestions;

  // The 50 newest changed surveys, newest first (ties in the order they were read). A survey older
  // than all 50 is never built into a row: sorting the list on every changed survey cost half a second
  // at 50,000 (round 3).
  const manifestAt = []; // the entries' times, in step with out.manifest
  const manifestTakes = (at) => out.manifest.length < MANIFEST_CAP || new Date(at).getTime() > manifestAt[manifestAt.length - 1];
  const pushManifest = (entry) => {
    const at = new Date(entry.submittedAt).getTime();
    let i = manifestAt.length;
    while (i > 0 && manifestAt[i - 1] < at) i -= 1;
    out.manifest.splice(i, 0, entry);
    manifestAt.splice(i, 0, at);
    if (out.manifest.length > MANIFEST_CAP) {
      out.manifest.pop();
      manifestAt.pop();
    }
  };

  // Each batch of visits is read while the one before it is worked through. Handled at once, so a read
  // that fails while the scan is busy is reported where it is awaited. One clause for the batch's doors and
  // rounds; its own visits are kept below (round 8).
  const readBatch = (i) => {
    const read = SurveyResponse.find(
      { campaignId: campaign._id, ...visitsClause(visits.slice(i, i + VISIT_BATCH)) },
      {
        voterId: 1, householdId: 1, passId: 1, userId: 1, surveyTemplateId: 1, submittedAt: 1,
        createdAt: 1, answers: 1, editedBy: 1, editedAt: 1,
      },
      timeLeft(deadline)
    )
      .lean()
      .exec();
    read.catch(() => {});
    return read;
  };
  let nextRead = visits.length ? readBatch(0) : null;

  for (let i = 0; i < visits.length; i += VISIT_BATCH) {
    // A review past its budget stops here — the database's reads stop themselves (timeLeft), and so
    // does the work on this side.
    if (deadline && Date.now() > deadline) throw tooSlow();
    let rows;
    try {
      rows = await nextRead;
    } catch (err) {
      throw ranOutOfTime(err) ? tooSlow() : err;
    }
    nextRead = i + VISIT_BATCH < visits.length ? readBatch(i + VISIT_BATCH) : null;

    const keys = new Set(visits.slice(i, i + VISIT_BATCH).map(doorKey));
    const candidates = [];
    for (const r of rows) {
      // Another canvasser's survey at one of these doors in one of these rounds: not a selected visit.
      if (!keys.has(doorKey(r))) continue;
      if (String(r.surveyTemplateId) !== String(template.surveyTemplateId)) {
        out.otherSurvey += 1;
        continue;
      }
      if (!inWindow(q.timestamp, r.submittedAt)) {
        out.outsideDates += 1;
        continue;
      }
      if (asOf && r.createdAt && new Date(r.createdAt) > asOf) {
        // Recorded after the review: simply not included (never a refusal).
        out.afterReview += 1;
        continue;
      }
      candidates.push(r);
    }

    // Under an answer filter only the surveys that matched it change — re-applied with the
    // resolved clause itself (exact dual-read semantics), never a JavaScript copy of it.
    let matched = null;
    if (q.answerMatch && candidates.length) {
      try {
        matched = new Set(
          (
            await SurveyResponse.find({ _id: { $in: candidates.map((r) => r._id) }, $and: q.answerMatch }, { _id: 1 }, timeLeft(deadline)).lean()
          ).map((r) => String(r._id))
        );
      } catch (err) {
        throw ranOutOfTime(err) ? tooSlow() : err;
      }
    }

    for (const r of candidates) {
      if (matched && !matched.has(String(r._id))) {
        out.notMatched += 1;
        continue;
      }
      out.responses += 1;
      const fp = fingerprint(r);
      xorInto(out.digestAcc, pairHash(String(r._id), fp));
      if (out.items) out.items.push({ r: r._id, h: fp, v: r.voterId, p: r.passId ?? null });

      for (const a of r.answers || []) {
        const stat = out.perQuestion.get(a?.questionKey);
        const qq = stat && qByKey.get(a.questionKey);
        if (!qq || !isAnsweredRow(qq, a)) continue;
        stat.answered += 1;
        if (qq.type !== 'text') for (const k of keysOf(a)) bump(stat.keyCounts, k);
      }

      if (!plan) continue;
      const res = applyEditPlan(questions, r.answers || [], plan, { mode: 'bulk', flow: template.flow });
      for (const s of res.skipped) {
        if (!out.skippedByQuestion.has(s.questionKey)) out.skippedByQuestion.set(s.questionKey, new Map());
        bump(out.skippedByQuestion.get(s.questionKey), s.reason);
      }
      if (!res.changed) {
        bump(out.unchanged, res.skipped[0]?.reason || 'same_answer');
        continue;
      }
      out.changed += 1;
      out.changedVoterIds.add(String(r.voterId));
      out.changedResponseIds.add(String(r._id));
      if (out.stash) {
        const answers = res.answers.filter((a) => a && keepForTags.has(a.questionKey)).map(tagRow);
        stashedRows += answers.length + 1;
        if (stashedRows > TAG_STASH_MAX_ROWS) out.stash = null;
        else out.stash.set(String(r._id), { _id: r._id, voterId: r.voterId, submittedAt: r.submittedAt, answers });
      }
      bump(out.recordedBy, String(r.userId));
      if (res.endsScript) out.endsScript += 1;
      for (const c of res.rows) {
        const qq = qByKey.get(c.questionKey);
        if (!qq) continue;
        if (c.kind === 'dropped') bump(out.dropped, c.questionKey);
        if (qq.type === 'text') {
          // A written follow-up the change drops is listed once, under the dropped answers.
          if (c.kind !== 'dropped') bump(out.textCleared, c.questionKey);
          continue;
        }
        // Campaign-wide pricing: the results count every pick of every row of the question (the
        // aggregation unwinds rows, then picks), so the delta is the survey's own picks after minus
        // before, over ALL its rows of the question — one row's picks under-priced a question held
        // twice whose answers the change dropped (code review round 4).
        if (!out.deltas.has(c.questionKey)) out.deltas.set(c.questionKey, new Map());
        const d = out.deltas.get(c.questionKey);
        for (const row of r.answers || []) if (row?.questionKey === c.questionKey) for (const k of keysOf(row)) bump(d, k, -1);
        for (const row of res.answers || []) if (row?.questionKey === c.questionKey) for (const k of keysOf(row)) bump(d, k, 1);
        if (c.kind === 'dropped') continue;
        if (!out.changedByQuestion.has(c.questionKey)) {
          out.changedByQuestion.set(c.questionKey, {
            surveys: 0, cleared: 0, multi: 0, keptAny: 0, removedById: new Map(), removedByText: new Map(), addedById: new Map(), keptById: new Map(), setTo: new Map(),
          });
        }
        const cq = out.changedByQuestion.get(c.questionKey);
        cq.surveys += 1;
        if (c.kind === 'cleared') cq.cleared += 1;
        // Surveys per pick, so each pick once per survey — an id stored twice, or a pick beside an
        // "Other" typed as its name, is one survey that had it, the run card's count (round 4).
        const removedIds = [...new Set(c.removedIds)];
        const removedTexts = [...new Set(c.removedTexts)];
        if (removedIds.length + removedTexts.length > 1) cq.multi += 1;
        for (const id of removedIds) bump(cq.removedById, id);
        for (const t of removedTexts) bump(cq.removedByText, t);
        for (const id of new Set(c.addedIds)) bump(cq.addedById, id);
        if (c.kind === 'changed') {
          const keptOriginal = [...new Set((c.after?.optionIds || []).filter((id) => !c.addedIds.includes(id)))];
          // Surveys that kept at least one ORIGINAL pick — with Replace them with, "not left blank"
          // also counts surveys that only got the replacement.
          if (keptOriginal.length) cq.keptAny += 1;
          for (const id of keptOriginal) bump(cq.keptById, id);
          if (qq.type === 'single_choice') for (const id of new Set(c.after?.optionIds || [])) bump(cq.setTo, id);
        }
      }
      if (!manifestTakes(r.submittedAt)) continue;
      pushManifest({
        responseId: r._id,
        voterId: r.voterId,
        householdId: r.householdId,
        passId: r.passId ?? null,
        userId: r.userId,
        submittedAt: r.submittedAt,
        rows: res.rows.map((c) => ({
          questionKey: c.questionKey,
          label: qByKey.get(c.questionKey)?.label || c.questionKey,
          kind: c.kind,
          before: c.before ? formatAnswerCell(c.before) : '',
          after: c.after ? formatAnswerCell(c.after) : '',
        })),
      });
    }
    // After the first batch the stash keeps only the questions of the tags it is likely to need — the
    // plan's own and those on what that batch dropped (`stashAfterFirst`) — and a tag on a follow-up
    // that turns up later is priced from the surveys themselves (`stashCovers`). Keeping every
    // reachable question's rows overflowed the stash at 50,000 surveys: a Script flow's first question
    // (round 4), and a change that re-routes past tagged follow-ups (round 5).
    if (i === 0 && out.stash && stashAfterFirst) {
      keepForTags = stashAfterFirst([...out.dropped.keys()]);
      out.stashCovers = keepForTags;
    }
    // What the scan has found so far, for work that can start before it ends (buildEditPreview).
    if (afterBatch) afterBatch(out, i / VISIT_BATCH);
  }

  out.digest = `${out.digestAcc.toString('hex')}:${out.responses}`;
  delete out.digestAcc;
  return out;
};

// ---------------------------------------------------------------------------
// Pricing, campaign-wide
// ---------------------------------------------------------------------------

const resultsMatch = (campaign, template) => ({
  organizationId: campaign.organizationId,
  campaignId: campaign._id,
  surveyTemplateId: oid(template.surveyTemplateId),
});

// Promises started ahead of the code that awaits them are handled at once, so one that fails while
// other work runs is reported where it is awaited, never as an unhandled rejection.
const handled = (promise) => {
  promise.catch(() => {});
  return promise;
};

// Run `fn` over `items`, at most `n` at a time; the first failure — or the review's stop — keeps the
// rest from starting.
const inFlight = async (n, items, fn, signal = null) => {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && !signal?.aborted && next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await fn(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
};

/**
 * The questions a plan can change: its own, and every question whose visibility follows one of them,
 * transitively (visibleIf — a Script flow's routes are compiled to it). applyEditPlan drops only an
 * answer the edit makes hidden, so this holds every question any one survey's change touches, and it
 * is known before a single survey is read. It decides only what the scan keeps for the tag pass —
 * never what is priced up front (round 4).
 */
const questionsPlanCanReach = (template, plan) => {
  const reach = new Set((plan || []).map((p) => p.questionKey));
  let grew = true;
  while (grew) {
    grew = false;
    for (const qq of template.questions || []) {
      if (reach.has(qq.key) || !(qq.visibleIf?.rules || []).some((r) => reach.has(r.questionKey))) continue;
      reach.add(qq.key);
      grew = true;
    }
  }
  return reach;
};

// Questions' results campaign-wide, keyed the way the results card keys them — the /survey-results
// aggregation itself (choiceKeyStages + $group), several questions in one pass:
// Map<questionKey, Map<key, count>>.
const questionCountsForMany = async (campaign, template, keys, deadline = null, signal = null) => {
  const rows = await SurveyResponse.aggregate([
    { $match: { ...resultsMatch(campaign, template), 'answers.questionKey': { $in: keys } } },
    ...choiceKeyStagesForMany(keys),
    { $group: { _id: { qk: '$answers.questionKey', key: '$_answerKeys' }, count: { $sum: 1 } } },
  ]).option({ ...timeLeft(deadline), ...(signal ? { signal } : {}) });
  const out = new Map(keys.map((k) => [k, new Map()]));
  for (const r of rows) out.get(r._id.qk)?.set(r._id.key, r.count);
  return out;
};

/**
 * Each changed choice question's results, campaign-wide, before → after: `before` is the
 * /survey-results aggregation itself (choiceKeyStages + $group + mergeOptionRows), `after` is
 * before plus the in-memory delta keyed the same way, compared as keyed maps with a missing key
 * counting as 0 — so the review's numbers are the results card's numbers. The plan's own questions
 * come from the counts read while the scan ran (`early`); a follow-up the change dropped is read now.
 * `{ results, unavailable }`: past the review's budget the results can't be previewed, never guessed.
 */
const priceQuestions = async (campaign, template, deltas, early = null, deadline = null, signal = null) => {
  try {
    return { results: await priceEachQuestion(campaign, template, deltas, early, deadline, signal), unavailable: false };
  } catch (err) {
    if (!ranOutOfTime(err)) throw err;
    console.warn('[answer-edits] results pricing stopped at the review budget; the review says it is unavailable');
    return { results: [], unavailable: true };
  }
};
const priceEachQuestion = async (campaign, template, deltas, early, deadline, signal = null) => {
  const qByKey = new Map((template.questions || []).map((x) => [x.key, x]));
  // Any question whose counts weren't started while the scan ran: one pass for all of them.
  const missing = [...deltas.keys()].filter((key) => !early?.get(key) && qByKey.get(key) && qByKey.get(key).type !== 'text');
  const late = missing.length ? handled(questionCountsForMany(campaign, template, missing, deadline, signal)) : null;
  const priced = await Promise.all(
    [...deltas].map(async ([key, delta]) => {
      const qq = qByKey.get(key);
      if (!qq || qq.type === 'text') return null;
      const beforeCounts = (await (early?.get(key) || late.then((all) => all.get(key)))) || new Map();
      const afterCounts = new Map(beforeCounts);
      for (const [k, n] of delta) afterCounts.set(k, (afterCounts.get(k) || 0) + n);
      const keyOf = (o) => o.id || `legacy:${o.text}`;
      const before = new Map(bucketsOf(qq, beforeCounts).map((o) => [keyOf(o), o]));
      const after = new Map(bucketsOf(qq, afterCounts).map((o) => [keyOf(o), o]));
      const keys = [...new Set([...before.keys(), ...after.keys()])];
      const options = keys
        .map((k) => {
          const b = before.get(k);
          const a = after.get(k);
          const o = b || a;
          return { id: o.id, label: o.text, retired: !!o.retired, before: b?.count || 0, after: Math.max(0, a?.count || 0) };
        })
        .filter((o) => o.before || o.after)
        .sort((x, y) => y.before - x.before || y.after - x.after);
      return {
        questionKey: key,
        label: qq.label,
        options,
        totalBefore: options.reduce((s, o) => s + o.before, 0),
        totalAfter: options.reduce((s, o) => s + o.after, 0),
      };
    })
  );
  return priced.filter(Boolean);
};

// The tags a change can move: every tag with an option on a question the change touched — changed,
// cleared or dropped — not just the tags of the picks that moved. "Current" is the latest ANSWER, so
// clearing a voter's latest answer brings an older answer back into force, and its tags with it; a
// two-entry change can net a pick to zero while moving it between voters; an "Other" write-in that
// reads like an option is caught by that option's tag. Pricing only the moved picks' tags left those
// numbers unpriced (code review 2026-10-19). Tags that turn out not to move are hidden after pricing.
const tagsOnQuestions = (template, questions) => {
  const touched = new Set();
  for (const [key, entry] of tagOptionMap(template)) {
    if (entry.members.some((m) => questions.has(m.questionKey))) touched.add(key);
  }
  return touched;
};
const tagsTouched = (template, scan) =>
  tagsOnQuestions(template, new Set([...scan.deltas.keys(), ...scan.dropped.keys(), ...scan.changedByQuestion.keys()]));

// Tags' campaign-wide counts: "current" as voter sets (currentVoterSetsByTag, the results card's own
// pass — the tag pass takes the changed voters' share off them), "identified" as counts, each tag
// through its own answerTagClause, IDENTIFIED_IN_FLIGHT at a time (one $facet of every tag ran them one
// after another on one core: 2.6 s for 16 tags at 50,000 surveys; all at once fought over the cores).
// `limit` runs a function under the review's shared cap on identified counts (makeLimiter): every
// pass a review starts — up front, mid-scan, after it — draws on the same two slots (round 5: each pass
// had its own two, and five or six ran at once). Nothing starts past `deadline`.
const campaignTagCounts = async (base, template, entries, deadline = null, limit = makeLimiter(IDENTIFIED_IN_FLIGHT), signal = null) => {
  const identified = new Array(entries.length).fill(0);
  const [current] = await Promise.all([
    currentVoterSetsByTag(base, template, entries.map(([, e]) => e.display), { ...timeLeft(deadline), deadline, signal }),
    Promise.all(
      entries.map(([, entry], i) =>
        limit(async () => {
          if ((deadline && Date.now() > deadline) || signal?.aborted) throw new TagBudgetError();
          const [row] = await SurveyResponse.aggregate([
            { $match: { ...base, ...answerTagClause(template, entry.display) } },
            { $group: { _id: '$voterId' } },
            { $count: 'n' },
          ]).option({ ...timeLeft(deadline), ...(signal ? { signal } : {}) });
          identified[i] = row?.n || 0;
        })
      )
    ),
  ]);
  return { current, identified: new Map(entries.map(([tag], i) => [tag, identified[i]])) };
};

// At most `n` of the functions given to it running at once, the rest queued in order.
const makeLimiter = (n) => {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
};

/**
 * The campaign-wide "before" numbers a priced review is sure to need, started BEFORE the scan: those of
 * the plan's OWN questions — their results and their tags' counts — which no survey's change can leave
 * out. Read while the scan runs instead of after it (round 3: in sequence, a review pricing 9 questions
 * and 16 tags over 50,000 surveys took 28 s). A follow-up whose answers the change drops is priced after
 * the scan, only when some survey's answers to it actually went: reading every question the plan could
 * reach made a gate question — a Script flow's first, say — price the whole survey up front, 35 tags
 * and 12 questions at once, for a change that moved 2 tags (round 4).
 */
const startCampaignBefore = (campaign, template, plan, { deadline = null, tagDeadline = deadline, signal = null } = {}) => {
  const qByKey = new Map((template.questions || []).map((qq) => [qq.key, qq]));
  const map = tagOptionMap(template);
  const base = resultsMatch(campaign, template);
  // The tags' counts stop at the TAG deadline, when the review stops waiting for them — not at the
  // review's, which left them running after the review had answered (round 5).
  const limit = makeLimiter(IDENTIFIED_IN_FLIGHT);
  // Stopped once the review has answered (`signal`, buildEditPreview's): a review that priced nothing (a
  // change that moves no survey) answered at once while these campaign-wide counts ran on, and pressed
  // again they stacked (round 6).
  const questions = new Map(); // questionKey -> Promise<Map<key, count>>
  const tagCounts = new Map(); // tag -> Promise<{ current, identified }>
  const seen = new Set();
  // Start the before-counts of these questions and their tags, one pass for each kind, unless started.
  const add = (keys) => {
    const fresh = keys.filter((k) => !seen.has(k));
    if (!fresh.length) return;
    for (const k of fresh) seen.add(k);
    const choice = fresh.filter((k) => qByKey.get(k) && isAnswerable(qByKey.get(k)) && qByKey.get(k).type !== 'text');
    if (choice.length) {
      const counts = handled(questionCountsForMany(campaign, template, choice, deadline, signal));
      for (const k of choice) questions.set(k, handled(counts.then((all) => all.get(k))));
    }
    const entries = [...tagsOnQuestions(template, new Set(fresh))].filter((t) => !tagCounts.has(t)).map((t) => [t, map.get(t)]).filter(([, e]) => e);
    if (entries.length) {
      const counts = handled(campaignTagCounts(base, template, entries, tagDeadline, limit, signal));
      for (const [t] of entries) tagCounts.set(t, counts);
    }
  };
  add([...new Set((plan || []).map((p) => p.questionKey))]);
  // What the scan keeps of each edited survey for the tag pass: its rows of every question a tag the
  // plan can reach reads — the edited version, so a change that drops follow-ups keeps little, and
  // past TAG_STASH_MAX_ROWS the tag pass reads the surveys itself.
  const questionsOf = (tags) => new Set(tags.map((t) => map.get(t)).filter(Boolean).flatMap((e) => e.members.map((m) => m.questionKey)));
  const reachTags = [...tagsOnQuestions(template, questionsPlanCanReach(template, plan))];
  const ownTags = [...tagCounts.keys()];
  return {
    questions,
    tagCounts,
    limit,
    // Follow-ups the change drops, as the scan finds them (afterBatch).
    add,
    tagQuestions: reachTags.length ? questionsOf(reachTags) : null,
    // ...and after the first batch, only the questions of the plan's own tags and of the tags on what
    // that batch dropped (round 5: a change that dropped follow-ups kept every reachable question).
    stashAfterFirst: (dropped) => questionsOf([...new Set([...ownTags, ...tagsOnQuestions(template, new Set(dropped))])]),
  };
};

// What the tag stages read of one survey, and nothing more: its id, voter and time, and its
// answers to the tag questions (questionKey, optionIds, answer — every field answerTagClause and
// latestAnswerKeyStages look at). The answers go in $literal: $documents EVALUATES its documents as
// expressions, so a bare answer text starting with "$" ("$50 or more") would be read as a field path
// and silently dropped — measured on MongoDB 7.0.2.
const shippedForTags = (d, qKeySet) => ({
  _id: d._id,
  voterId: d.voterId,
  submittedAt: d.submittedAt ?? null,
  answers: { $literal: (d.answers || []).filter((a) => a && qKeySet.has(a.questionKey)).map(tagRow) },
});

// Each tag's "identified" match, and ONE "latest answer" pass over every touched tag's questions —
// folded per tag afterwards, so the cost doesn't grow with the number of tags on a question.
const identifiedFacet = (clauses) =>
  Object.fromEntries(clauses.map((c, i) => [`id${i}`, [{ $match: c }, { $group: { _id: '$voterId' } }, { $count: 'n' }]]));
const tagFacet = (clauses, qKeys) => ({
  ...identifiedFacet(clauses),
  cur: [{ $match: { 'answers.questionKey': { $in: qKeys } } }, ...latestAnswerKeyStages(qKeys)],
});

// How many of these voters each tag identifies on file now, through the clauses themselves, on the
// stored surveys (nothing shipped).
const identifiedAmong = async (base, clauses, voterIds, deadline = null, signal = null) => {
  const [out] = await SurveyResponse.aggregate([
    { $match: { ...base, voterId: { $in: voterIds } } },
    { $project: { voterId: 1, answers: 1 } },
    { $facet: identifiedFacet(clauses) },
  ]).option({ ...timeLeft(deadline), ...(signal ? { signal } : {}) });
  return clauses.map((_, i) => out?.[`id${i}`]?.[0]?.n || 0);
};

// One batch of voters' edited surveys through the tag stages in one call — split by voter while it is
// over the shipping limit. Each voter's surveys stay together: "identified" and "current" are per
// voter, so the batches' counts add up.
const shipTagBatch = async (facet, qKeySet, docs, deadline = null, signal = null) => {
  if (!docs.length || signal?.aborted) return [];
  const shipped = docs.map((d) => shippedForTags(d, qKeySet));
  const voters = [...new Set(docs.map((d) => String(d.voterId)))];
  if (voters.length > 1 && BSON.calculateObjectSize({ docs: shipped }) > TAG_SHIP_MAX_BYTES) {
    const half = new Set(voters.slice(0, Math.ceil(voters.length / 2)));
    const inHalf = (d) => half.has(String(d.voterId));
    return [
      ...(await shipTagBatch(facet, qKeySet, docs.filter(inHalf), deadline, signal)),
      ...(await shipTagBatch(facet, qKeySet, docs.filter((d) => !inHalf(d)), deadline, signal)),
    ];
  }
  return mongoose.connection.db.aggregate([{ $documents: shipped }, { $facet: facet }], { ...timeLeft(deadline), ...(signal ? { signal } : {}) }).toArray();
};

class TagBudgetError extends Error {}
// Settles with `promise`, or fails with TagBudgetError once `deadline` passes (and `promise` is
// left to finish on its own, handled).
const byDeadline = (promise, deadline) => {
  handled(promise);
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(new TagBudgetError());
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TagBudgetError()), left);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

/**
 * Tag counts before → after, for the tags the change actually touches. Only the changed voters can
 * move, so after = before − their share before + their share after. Before is campaign-wide, read
 * while the scan ran (startCampaignBefore); the changed voters' share before is read off those
 * counts — "current" from its voter sets, "identified" by the tag clauses over their stored surveys
 * (identifiedAmong) — and their share after runs their surveys, with the edits substituted in
 * memory, through the REAL stages via $documents (answerTagClause + a voter $group for "identified",
 * latestAnswerKeyStages + currentTagVoterSets for "current"). Only the edited versions are shipped,
 * four batches of voters at a time. Needs MongoDB 5.1+ ($documents); on an older server, or once the
 * review has spent TAG_PRICING_BUDGET_MS, this fails soft: the review says the tag impact can't be
 * previewed rather than guessing — or running into the router's 30 s limit (round 3).
 */
const priceTags = async (campaign, template, plan, scan, early, deadline, signal = null) => {
  const touched = tagsTouched(template, scan);
  if (!touched.size) return { tags: [], unavailable: false };
  if (Date.now() > deadline) {
    console.warn('[answer-edits] tag pricing had no time left; the review says it is unavailable');
    return { tags: [], unavailable: true };
  }
  const map = tagOptionMap(template);
  const entries = [...touched].map((t) => [t, map.get(t)]).filter(([, e]) => e);
  const base = resultsMatch(campaign, template);
  try {
    const qKeySet = new Set(entries.flatMap(([, e]) => e.members.map((m) => m.questionKey)));
    const qKeys = [...qKeySet];
    const entryList = entries.map(([, entry]) => entry);
    const clauses = entryList.map((entry) => answerTagClause(template, entry.display));
    const facet = tagFacet(clauses, qKeys);
    const affected = entries.map(() => ({ idBefore: 0, idAfter: 0, curAfter: 0 }));
    const voters = [...scan.changedVoterIds].map((v) => new mongoose.Types.ObjectId(v));
    const batches = [];
    for (let i = 0; i < voters.length; i += TAG_VOTER_BATCH) batches.push(voters.slice(i, i + TAG_VOTER_BATCH));
    // The changed voters' edited surveys, from the scan when it kept them (stashedOf) — only when it
    // kept every question these tags read: a tag on a follow-up the change dropped reads a question
    // the scan didn't keep, and those surveys are read and edited here instead. Their other surveys
    // are read as they are.
    const stash = scan.stash && scan.stashCovers && qKeys.every((k) => scan.stashCovers.has(k)) ? scan.stash : null;
    const stashedOf = new Map();
    for (const doc of stash?.values() || []) {
      const v = String(doc.voterId);
      if (!stashedOf.has(v)) stashedOf.set(v, []);
      stashedOf.get(v).push(doc);
    }
    const editedVersions = async (chunk) => {
      if (stash) {
        const stashed = chunk.flatMap((v) => stashedOf.get(String(v)) || []);
        const others = await SurveyResponse.find(
          { ...base, voterId: { $in: chunk }, _id: { $nin: stashed.map((d) => d._id) } },
          { voterId: 1, submittedAt: 1, answers: 1 },
          timeLeft(deadline)
        ).lean();
        return [...stashed, ...others];
      }
      const docs = await SurveyResponse.find({ ...base, voterId: { $in: chunk } }, { voterId: 1, submittedAt: 1, answers: 1 }, timeLeft(deadline)).lean();
      return docs.map((d) => {
        if (!scan.changedResponseIds.has(String(d._id))) return d;
        const res = applyEditPlan(template.questions || [], d.answers || [], plan, { mode: 'bulk', flow: template.flow });
        return res.changed ? { ...d, answers: res.answers } : d;
      });
    };
    const shares = inFlight(TAG_BATCHES_IN_FLIGHT, batches, async (chunk) => {
      if (Date.now() > deadline) throw new TagBudgetError();
      if (signal?.aborted) return;
      const afterDocs = await editedVersions(chunk);
      if (signal?.aborted) return;
      const [idBefore, outs] = await Promise.all([identifiedAmong(base, clauses, chunk, deadline, signal), shipTagBatch(facet, qKeySet, afterDocs, deadline, signal)]);
      for (const out of outs) {
        const current = currentTagVoterSets(out.cur, entryList);
        entries.forEach((_, t) => {
          affected[t].idAfter += out[`id${t}`][0]?.n || 0;
          affected[t].curAfter += current[t].size;
        });
      }
      entries.forEach((_, t) => {
        affected[t].idBefore += idBefore[t];
      });
    }, signal);
    // Before: from the counts started while the scan ran (the plan's own tags, and a dropped
    // follow-up's from the batch it first showed up in); any other, read now.
    const late = entries.filter(([t]) => !early?.tagCounts.has(t));
    const started = [...new Set(entries.filter(([t]) => early?.tagCounts.has(t)).map(([t]) => early.tagCounts.get(t)))];
    const parts = await Promise.all([
      byDeadline(shares, deadline),
      ...started.map((p) => byDeadline(p, deadline)),
      ...(late.length ? [byDeadline(campaignTagCounts(base, template, late, deadline, early?.limit, signal), deadline)] : []),
    ]);
    const counted = parts.slice(1);
    const before = {
      current: new Map(counted.flatMap((c) => [...c.current])),
      identified: new Map(counted.flatMap((c) => [...c.identified])),
    };
    const result = entries.map(([tag, entry], t) => {
      const current = before.current.get(tag) || new Set();
      let curBefore = 0;
      for (const v of scan.changedVoterIds) if (current.has(v)) curBefore += 1;
      const identifiedBefore = before.identified.get(tag) || 0;
      return {
        tag: entry.display,
        identified: { before: identifiedBefore, after: identifiedBefore - affected[t].idBefore + affected[t].idAfter },
        current: { before: current.size, after: current.size - curBefore + affected[t].curAfter },
      };
    });
    return { tags: result.filter((t) => t.identified.before !== t.identified.after || t.current.before !== t.current.after), unavailable: false };
  } catch (err) {
    if (err instanceof TagBudgetError) console.warn('[answer-edits] tag pricing stopped at its time budget; the review says it is unavailable');
    else console.error('[answer-edits] tag pricing unavailable:', err?.message || err);
    return { tags: [], unavailable: true };
  }
};

// ---------------------------------------------------------------------------
// The dry run's payload
// ---------------------------------------------------------------------------

const mapToObj = (m) => Object.fromEntries([...m.entries()]);

const hydrateManifest = async (campaign, rows) => {
  if (!rows.length) return [];
  const [voters, doors, passes, people] = await Promise.all([
    Voter.find({ _id: { $in: rows.map((r) => r.voterId) } }, { fullName: 1 }).lean(),
    Household.find({ _id: { $in: rows.map((r) => r.householdId) } }, { addressLine1: 1, unit: 1, city: 1 }).lean(),
    Pass.find({ campaignId: campaign._id }, { name: 1, roundNumber: 1 }).lean(),
    hydrateCanvassers(rows.map((r) => r.userId).filter(Boolean), campaign.organizationId),
  ]);
  const vById = new Map(voters.map((v) => [String(v._id), v]));
  const dById = new Map(doors.map((d) => [String(d._id), d]));
  const pById = new Map(passes.map((p) => [String(p._id), p]));
  return rows.map((r) => {
    const d = dById.get(String(r.householdId));
    const p = r.passId ? pById.get(String(r.passId)) : null;
    const u = r.userId ? people.get(String(r.userId)) : null;
    return {
      responseId: String(r.responseId),
      voterId: String(r.voterId),
      voterName: vById.get(String(r.voterId))?.fullName || 'Unknown voter',
      address: d ? [d.addressLine1, d.unit ? `#${d.unit}` : null].filter(Boolean).join(' ') : '(door removed)',
      round: p ? p.name || `Round ${p.roundNumber}` : null,
      recordedBy: u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown user' : 'Unknown user',
      submittedAt: r.submittedAt,
      changes: r.rows,
    };
  });
};

/**
 * The whole dry run: the surveys present, the chosen survey's questions with their counts, every
 * reason a survey is left alone, and — with a plan — the price.
 */
const previewWith = async ({ campaign, q, sel, template, asOf, plan, matchedNotSelectedOf, deadline, tagDeadline, early, signal }) => {
  const scan = await scanEditTargets({
    campaign, q, sel, template, asOf, plan, stashQuestions: early?.tagQuestions || null, stashAfterFirst: early?.stashAfterFirst || null, deadline,
    // Follow-ups dropped so far start their counts after the first batch and every fourth one after —
    // a pass per batch that found a new one ran a dozen campaign-wide passes (round 5); what is left
    // is priced after the scan.
    afterBatch: early ? (found, batch) => (batch === 0 || batch % 4 === 3) && early.add([...found.dropped.keys()]) : null,
  });
  const qList = (template.questions || []).filter(isAnswerable);
  const questions = qList.map((qq) => {
    const stat = scan.perQuestion.get(qq.key);
    const picks =
      qq.type === 'text'
        ? []
        : bucketsOf(qq, stat.keyCounts).map((o) => ({ id: o.id, label: o.text, retired: !!o.retired, legacy: o.id == null, count: o.count }));
    return {
      key: qq.key,
      label: qq.label,
      type: qq.type,
      retired: !!qq.retired,
      visibleIf: qq.visibleIf || null,
      otherOption: !!qq.otherOption,
      options: (qq.options || []).map((o) => ({ id: o.id, text: o.text, retired: !!o.retired, tag: o.tag || null })),
      answered: stat.answered,
      picks,
    };
  });
  const payload = {
    responses: scan.responses,
    visits: scan.visits,
    notMatched: scan.notMatched,
    outsideDates: scan.outsideDates,
    otherSurvey: scan.otherSurvey,
    matchedNotSelected: matchedNotSelectedOf ? matchedNotSelectedOf(scan.responses) : 0,
    questions,
    digest: scan.digest,
    asOf,
  };
  if (!plan) return { payload, scan };

  const [priced, tags, recordedBy, manifest] = await Promise.all([
    priceQuestions(campaign, template, scan.deltas, early.questions, deadline, signal),
    priceTags(campaign, template, plan, scan, early, tagDeadline, signal),
    hydrateCanvassers([...scan.recordedBy.keys()], campaign.organizationId),
    hydrateManifest(campaign, scan.manifest),
  ]);
  const qByKey = new Map(qList.map((x) => [x.key, x]));
  const labelOf = (key, id) => {
    const qq = qByKey.get(key);
    if (id === OTHER_OPTION_ID) return 'Other';
    return (qq?.options || []).find((o) => o.id === id)?.text || id;
  };
  payload.price = {
    surveysChanged: scan.changed,
    unchanged: mapToObj(scan.unchanged),
    byQuestion: [...scan.changedByQuestion.entries()].map(([key, cq]) => ({
      questionKey: key,
      label: qByKey.get(key)?.label || key,
      surveys: cq.surveys,
      leftBlank: cq.cleared,
      multi: cq.multi,
      keptAny: cq.keptAny,
      removed: [
        ...[...cq.removedById.entries()].map(([id, n]) => ({ id, label: labelOf(key, id), surveys: n })),
        ...[...cq.removedByText.entries()].map(([t, n]) => ({ id: null, label: `old answer "${t}"`, surveys: n })),
      ],
      added: [...cq.addedById.entries()].map(([id, n]) => ({ id, label: labelOf(key, id), surveys: n })),
      kept: [...cq.keptById.entries()].map(([id, n]) => ({ id, label: labelOf(key, id), surveys: n })).sort((a, b) => b.surveys - a.surveys),
      setTo: [...cq.setTo.entries()].map(([id, n]) => ({ id, label: labelOf(key, id), surveys: n })),
    })),
    skippedByQuestion: [...scan.skippedByQuestion.entries()].map(([key, m]) => ({ questionKey: key, reasons: mapToObj(m) })),
    dropped: [...scan.dropped.entries()].map(([key, n]) => ({ questionKey: key, label: qByKey.get(key)?.label || key, answers: n })),
    endsScript: scan.endsScript,
    textCleared: [...scan.textCleared.entries()].map(([key, n]) => ({ questionKey: key, label: qByKey.get(key)?.label || key, answers: n })),
    results: priced.results,
    resultsUnavailable: priced.unavailable,
    tags: tags.tags,
    tagsUnavailable: tags.unavailable,
    recordedBy: [...scan.recordedBy.entries()]
      .map(([id, n]) => {
        const u = recordedBy.get(id);
        return { userId: id, name: u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown user' : 'Unknown user', surveys: n };
      })
      .sort((a, b) => b.surveys - a.surveys),
    manifest,
    manifestTotal: scan.changed,
  };
  return { payload, scan };
};

export const buildEditPreview = async ({ campaign, q, sel, template, asOf, plan, matchedNotSelectedOf, startedAt = Date.now() }) => {
  const deadline = reviewDeadline(startedAt);
  const tagDeadline = Math.min(deadline, startedAt + tagPricingBudgetMs());
  // One stop for everything the review starts — the up-front counts, and the pricing's own reads: once it
  // has its answer, or has failed, nothing it began starts after it (round 6; round 7: a review that
  // answered 500 went on starting its tag pass's reads, 146 of them). Many reads listen on it at once.
  const review = new AbortController();
  setMaxListeners(0, review.signal);
  const early = plan ? startCampaignBefore(campaign, template, plan, { deadline, tagDeadline, signal: review.signal }) : null;
  try {
    return await previewWith({ campaign, q, sel, template, asOf, plan, matchedNotSelectedOf, deadline, tagDeadline, early, signal: review.signal });
  } finally {
    review.abort();
  }
};
