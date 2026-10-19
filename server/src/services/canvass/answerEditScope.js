import crypto from 'node:crypto';
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
import { tripleClause } from './answerScope.js';
import { doorKey } from './doorKey.js';
import { ScopeError } from './entryScope.js';
import { applyEditPlan, fingerprint, keysOf, isAnsweredRow } from './answerEdit.js';
import {
  choiceKeyStages,
  mergeOptionRows,
  answerTagClause,
  latestAnswerKeyStages,
  currentTagVoterSet,
} from '../surveys/answerAgg.js';
import { tagOptionMap, normalizeTag } from '../surveys/tags.js';
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
// The most one $documents call ships; a batch over it splits by voter (the command limit is 16 MB).
const TAG_SHIP_MAX_BYTES = 8 * 1024 * 1024;

const { BSON } = mongoose.mongo;
const oid = (v) => (v ? new mongoose.Types.ObjectId(String(v)) : null);

/**
 * The selected Surveyed ENTRIES, refusing exactly where the page's other acts refuse: a truncated
 * answer or address scope without hand-ticked rows, a selection that mixes surveyed entries with
 * door outcomes, nothing selected, more than 25k entries.
 */
export const resolveEditEntries = async (campaign, q, actionIds = null) => {
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
export const countHeldByRuns = async (campaign, q) => {
  const filter = buildEntryFilter(campaign._id, q, ['survey_submitted']);
  return CanvassActivity.countDocuments({ ...filter, reclassified: { $exists: true } });
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
export const surveysAtVisits = async (campaign, q, sel, asOf) => {
  const visits = visitsOf(sel);
  const counts = new Map();
  for (let i = 0; i < visits.length; i += VISIT_BATCH) {
    const clause = tripleClause(visits.slice(i, i + VISIT_BATCH));
    const rows = await SurveyResponse.find(
      { campaignId: campaign._id, ...clause },
      { surveyTemplateId: 1, submittedAt: 1, createdAt: 1 }
    ).lean();
    for (const r of rows) {
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

/**
 * Walk every survey at the selected visits once.
 *
 * Returns the counts the form and the review show, the frozen items (when `collectItems`), the
 * digest, and — with a plan — what the plan does to each survey, folded. `onChanged` (optional)
 * sees each changed survey's id and voter (the tag pass needs the voters).
 */
export const scanEditTargets = async ({ campaign, q, sel, template, asOf, plan = null, collectItems = false }) => {
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
    manifest: [],
  };

  const pushManifest = (entry) => {
    out.manifest.push(entry);
    out.manifest.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    if (out.manifest.length > MANIFEST_CAP) out.manifest.pop();
  };

  for (let i = 0; i < visits.length; i += VISIT_BATCH) {
    const clause = tripleClause(visits.slice(i, i + VISIT_BATCH));
    const rows = await SurveyResponse.find(
      { campaignId: campaign._id, ...clause },
      {
        voterId: 1, householdId: 1, passId: 1, userId: 1, surveyTemplateId: 1, submittedAt: 1,
        createdAt: 1, answers: 1, editedBy: 1, editedAt: 1,
      }
    ).lean();

    const candidates = [];
    for (const r of rows) {
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
      matched = new Set(
        (
          await SurveyResponse.find({ _id: { $in: candidates.map((r) => r._id) }, $and: q.answerMatch }, { _id: 1 }).lean()
        ).map((r) => String(r._id))
      );
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
      bump(out.recordedBy, String(r.userId));
      if (res.endsScript) out.endsScript += 1;
      for (const c of res.rows) {
        const qq = qByKey.get(c.questionKey);
        if (!qq) continue;
        if (c.kind === 'dropped') bump(out.dropped, c.questionKey);
        if (qq.type === 'text') {
          bump(out.textCleared, c.questionKey);
          continue;
        }
        // Campaign-wide pricing: the results count each key once per survey, so the delta is
        // −1 for every key the row held and +1 for every key it holds after.
        if (!out.deltas.has(c.questionKey)) out.deltas.set(c.questionKey, new Map());
        const d = out.deltas.get(c.questionKey);
        for (const k of keysOf(c.before)) bump(d, k, -1);
        for (const k of keysOf(c.after)) bump(d, k, 1);
        if (c.kind === 'dropped') continue;
        if (!out.changedByQuestion.has(c.questionKey)) {
          out.changedByQuestion.set(c.questionKey, {
            surveys: 0, cleared: 0, multi: 0, removedById: new Map(), removedByText: new Map(), addedById: new Map(), keptById: new Map(), setTo: new Map(),
          });
        }
        const cq = out.changedByQuestion.get(c.questionKey);
        cq.surveys += 1;
        if (c.kind === 'cleared') cq.cleared += 1;
        if (c.removedIds.length + c.removedTexts.length > 1) cq.multi += 1;
        for (const id of c.removedIds) bump(cq.removedById, id);
        for (const t of c.removedTexts) bump(cq.removedByText, t);
        for (const id of c.addedIds) bump(cq.addedById, id);
        if (c.kind === 'changed') {
          for (const id of c.after?.optionIds || []) if (!c.addedIds.includes(id)) bump(cq.keptById, id);
          if (qq.type === 'single_choice') for (const id of c.after?.optionIds || []) bump(cq.setTo, id);
        }
      }
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

/**
 * Each changed choice question's results, campaign-wide, before → after: `before` is the
 * /survey-results aggregation itself (choiceKeyStages + $group + mergeOptionRows), `after` is
 * before plus the in-memory delta keyed the same way, compared as keyed maps with a missing key
 * counting as 0 — so the review's numbers are the results card's numbers.
 */
const priceQuestions = async (campaign, template, deltas) => {
  const qByKey = new Map((template.questions || []).map((x) => [x.key, x]));
  const out = [];
  for (const [key, delta] of deltas) {
    const qq = qByKey.get(key);
    if (!qq || qq.type === 'text') continue;
    const rows = await SurveyResponse.aggregate([
      { $match: resultsMatch(campaign, template) },
      ...choiceKeyStages(key),
      { $group: { _id: '$_answerKeys', count: { $sum: 1 } } },
    ]);
    const beforeCounts = new Map(rows.map((r) => [r._id, r.count]));
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
    out.push({
      questionKey: key,
      label: qq.label,
      options,
      totalBefore: options.reduce((s, o) => s + o.before, 0),
      totalAfter: options.reduce((s, o) => s + o.after, 0),
    });
  }
  return out;
};

// The tags a set of raw keys touches: a key is an option id, or an old answer's text (an option's
// text matches its id's bucket, as mergeOptionRows matches it).
const tagsTouched = (template, deltas) => {
  const touched = new Set();
  const qByKey = new Map((template.questions || []).map((x) => [x.key, x]));
  for (const [key, delta] of deltas) {
    const qq = qByKey.get(key);
    for (const [k, n] of delta) {
      if (!n) continue;
      const o = (qq?.options || []).find((x) => x.id === k || x.text === k);
      if (o?.tag && normalizeTag(o.tag)) touched.add(normalizeTag(o.tag));
    }
  }
  return touched;
};

// What the tag stages read of one survey, and nothing more: its id, voter and time, and its
// answers to the tag questions (questionKey, optionIds, answer — every field answerTagClause and
// latestAnswerKeyStages look at). `_v` says which version it is. The answers go in $literal:
// $documents EVALUATES its documents as expressions, so a bare answer text starting with "$"
// ("$50 or more") would be read as a field path and silently dropped — measured on MongoDB 7.0.2.
const shippedForTags = (d, v, qKeySet) => ({
  _id: d._id,
  voterId: d.voterId,
  submittedAt: d.submittedAt ?? null,
  _v: v,
  answers: {
    $literal: (d.answers || [])
      .filter((a) => a && qKeySet.has(a.questionKey))
      .map((a) => ({ questionKey: a.questionKey, optionIds: a.optionIds ?? [], answer: a.answer ?? null })),
  },
});

// Every touched tag, before ('b') and after ('a'), through the REAL stages, as one $facet.
const tagFacets = (template, entries) => {
  const facet = {};
  entries.forEach(([, entry], i) => {
    const qKeys = [...new Set(entry.members.map((m) => m.questionKey))];
    const clause = answerTagClause(template, entry.display);
    for (const v of ['b', 'a']) {
      facet[`id${i}${v}`] = [{ $match: { _v: v } }, { $match: clause }, { $group: { _id: '$voterId' } }, { $count: 'n' }];
      facet[`cur${i}${v}`] = [{ $match: { _v: v, 'answers.questionKey': { $in: qKeys } } }, ...latestAnswerKeyStages(qKeys)];
    }
  });
  return facet;
};

// One batch of voters' surveys, both versions, in one call — split by voter while it is over the
// shipping limit. Each voter's surveys stay together: "identified" and "current" are per voter, so
// the batches' counts add up.
const shipTagBatch = async (facet, qKeySet, before, after) => {
  if (!before.length) return [];
  const docs = [...before.map((d) => shippedForTags(d, 'b', qKeySet)), ...after.map((d) => shippedForTags(d, 'a', qKeySet))];
  const voters = [...new Set(before.map((d) => String(d.voterId)))];
  if (voters.length > 1 && BSON.calculateObjectSize({ docs }) > TAG_SHIP_MAX_BYTES) {
    const half = new Set(voters.slice(0, Math.ceil(voters.length / 2)));
    const inHalf = (d) => half.has(String(d.voterId));
    const notInHalf = (d) => !inHalf(d);
    return [
      ...(await shipTagBatch(facet, qKeySet, before.filter(inHalf), after.filter(inHalf))),
      ...(await shipTagBatch(facet, qKeySet, before.filter(notInHalf), after.filter(notInHalf))),
    ];
  }
  return mongoose.connection.db.aggregate([{ $documents: docs }, { $facet: facet }]).toArray();
};

/**
 * Tag counts before → after, for the tags the change actually touches. Only the affected voters
 * can move, so: their template responses are read, the edits substituted in memory, and both
 * versions run through the REAL stages via $documents (answerTagClause + a voter $group for
 * "identified", latestAnswerKeyStages + currentTagVoterSet for "current") — then after = before −
 * the affected voters' before + their after. One call per batch of voters carries both versions
 * of every touched tag (four calls per tag per batch took 15 s at the 50k cap). Needs MongoDB 5.1+
 * ($documents); on an older server this fails soft: the review says the tag impact is unavailable
 * rather than guessing.
 */
const priceTags = async (campaign, template, plan, scan) => {
  const touched = tagsTouched(template, scan.deltas);
  if (!touched.size) return { tags: [], unavailable: false };
  const map = tagOptionMap(template);
  const entries = [...touched].map((t) => [t, map.get(t)]).filter(([, e]) => e);
  const base = resultsMatch(campaign, template);
  const result = [];
  try {
    const voters = [...scan.changedVoterIds].map((v) => new mongoose.Types.ObjectId(v));
    const affected = new Map(entries.map(([t]) => [t, { idBefore: 0, idAfter: 0, curBefore: 0, curAfter: 0 }]));
    const facet = tagFacets(template, entries);
    const qKeySet = new Set(entries.flatMap(([, e]) => e.members.map((m) => m.questionKey)));
    for (let i = 0; i < voters.length; i += TAG_VOTER_BATCH) {
      const chunk = voters.slice(i, i + TAG_VOTER_BATCH);
      const docs = await SurveyResponse.find({ ...base, voterId: { $in: chunk } }, { voterId: 1, submittedAt: 1, answers: 1 }).lean();
      const afterDocs = docs.map((d) => {
        if (!scan.changedResponseIds.has(String(d._id))) return d;
        const res = applyEditPlan(template.questions || [], d.answers || [], plan, { mode: 'bulk', flow: template.flow });
        return res.changed ? { ...d, answers: res.answers } : d;
      });
      for (const out of await shipTagBatch(facet, qKeySet, docs, afterDocs)) {
        entries.forEach(([tag, entry], t) => {
          const a = affected.get(tag);
          a.idBefore += out[`id${t}b`][0]?.n || 0;
          a.idAfter += out[`id${t}a`][0]?.n || 0;
          a.curBefore += currentTagVoterSet(out[`cur${t}b`], entry).size;
          a.curAfter += currentTagVoterSet(out[`cur${t}a`], entry).size;
        });
      }
    }
    const currentAll = await currentVoterSetsByTag(base, template, entries.map(([, e]) => e.display));
    for (const [tag, entry] of entries) {
      const identifiedBefore = (await SurveyResponse.distinct('voterId', { ...base, ...answerTagClause(template, entry.display) })).length;
      const currentBefore = (currentAll.get(tag) || new Set()).size;
      const a = affected.get(tag);
      result.push({
        tag: entry.display,
        identified: { before: identifiedBefore, after: identifiedBefore - a.idBefore + a.idAfter },
        current: { before: currentBefore, after: currentBefore - a.curBefore + a.curAfter },
      });
    }
    return { tags: result.filter((t) => t.identified.before !== t.identified.after || t.current.before !== t.current.after), unavailable: false };
  } catch (err) {
    console.error('[answer-edits] tag pricing unavailable:', err?.message || err);
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
export const buildEditPreview = async ({ campaign, q, sel, template, asOf, plan, matchedNotSelectedOf }) => {
  const scan = await scanEditTargets({ campaign, q, sel, template, asOf, plan });
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
    priceQuestions(campaign, template, scan.deltas),
    priceTags(campaign, template, plan, scan),
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
    results: priced,
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
