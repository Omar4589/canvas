import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { makeCell, visibleQuestionKeys } from '../surveys/visibility.js';
import { OTHER_OPTION_ID, isOtherOptionId, otherBucketLabel } from '../surveys/otherOption.js';
import { isAnswerable, isStatement } from '../surveys/routing.js';
import { snapshotAnswerText } from '../surveys/normalizeAnswers.js';

// Editing survey ANSWERS on surveys that stay surveyed — the Door Outcomes "Edit answers…" tool,
// its one-person-at-a-time walkthrough and the voter profile's Edit, all through this one module.
// docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §C is the contract; every rule below is pinned by
// answerEdit.test.js.
//
// PURE: no database, no clock. The writer (answerEditWriter.js) reads and writes; this decides.
//
// The owner's rulings it encodes (2026-10-19):
//   1. who changes is decided by the caller (the selection), never here;
//   2. an answer the edit makes hidden (visible before, hidden after) is dropped — the phone posts
//      no row for a question it never showed — and reported, so the undo puts it back;
//   3. a bulk change applies only where the question has an answer: blanks stay blank;
//   4. the profile edit goes through the same applier, in `person` mode.

const { BSON, ObjectId } = mongoose.mongo;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export const PLAN_MESSAGES = Object.freeze({
  PLAN_EMPTY: 'Pick at least one question to change.',
  PLAN_ADJUST_EMPTY: 'Pick at least one answer to take out.',
  PLAN_UNKNOWN_QUESTION: "That question isn't on this survey.",
  PLAN_DUPLICATE_QUESTION: 'Each question can be changed only one way at a time.',
  PLAN_OP_TYPE: "That change doesn't fit that kind of question.",
  PLAN_RETIRED_QUESTION: 'A retired question can only be cleared, or have answers taken out.',
  PLAN_OPTION_INVALID: 'Pick a current answer for that question.',
  PLAN_ADJUST_OVERLAP: "An answer can't be taken out and put back in at once.",
});

/** A refusal of the plan itself, with the code the route sends and the question it concerns. */
export class PlanError extends Error {
  constructor(code, questionKey = null) {
    super(PLAN_MESSAGES[code] || 'That change is not valid.');
    this.name = 'PlanError';
    this.code = code;
    this.questionKey = questionKey;
  }
}

const uniqStrings = (v) => [...new Set((Array.isArray(v) ? v : []).filter((s) => typeof s === 'string' && s !== ''))];

const optionOrder = (q) => {
  const opts = q.options || [];
  return new Map(opts.map((o, i) => [o.id, Number.isFinite(o.order) ? o.order : i]));
};

/**
 * Validate a bulk plan against the run's frozen template and return it normalized: each entry
 * carries the question's label as the admin saw it, `replaceWith` in option order. Throws a
 * PlanError for every refusal — none is ever silently ignored.
 *
 *   { questionKey, op: 'clear' }
 *   { questionKey, op: 'set', optionIds: [id] }                       pick one: one live option
 *   { questionKey, op: 'adjust', remove: [ids], removeTexts: [texts], replaceWith: [ids] }
 *
 * `remove` may name any id the question has had — retired options and `__other__` included, and an
 * id the template has lost (an answer that comes up as an old bucket); `removeTexts` names old
 * answer texts that match no option. Neither can write anything: they only take picks out.
 */
export const validatePlan = (questions, rawPlan) => {
  const entries = Array.isArray(rawPlan) ? rawPlan : [];
  if (!entries.length) throw new PlanError('PLAN_EMPTY');
  const qByKey = new Map((questions || []).map((q) => [q.key, q]));
  const seen = new Set();
  const plan = [];
  for (const e of entries) {
    const q = qByKey.get(e?.questionKey);
    if (!q || !isAnswerable(q)) throw new PlanError('PLAN_UNKNOWN_QUESTION', e?.questionKey ?? null);
    if (seen.has(q.key)) throw new PlanError('PLAN_DUPLICATE_QUESTION', q.key);
    seen.add(q.key);
    const op = e.op;
    if (!['clear', 'set', 'adjust'].includes(op)) throw new PlanError('PLAN_OP_TYPE', q.key);
    // A written answer can only be cleared in bulk: the same text typed onto many surveys is
    // fabrication, not correction (D4–D5).
    if (q.type === 'text' && op !== 'clear') throw new PlanError('PLAN_OP_TYPE', q.key);
    if (op === 'set' && q.type !== 'single_choice') throw new PlanError('PLAN_OP_TYPE', q.key);
    if (op === 'adjust' && q.type !== 'multiple_choice') throw new PlanError('PLAN_OP_TYPE', q.key);
    const base = { questionKey: q.key, questionLabel: q.label, op };
    if (op === 'clear') {
      plan.push(base);
      continue;
    }
    const live = new Set((q.options || []).filter((o) => !o.retired).map((o) => o.id));
    if (op === 'set') {
      if (q.retired) throw new PlanError('PLAN_RETIRED_QUESTION', q.key);
      const ids = uniqStrings(e.optionIds);
      if (ids.length !== 1 || !live.has(ids[0]) || isOtherOptionId(ids[0])) {
        throw new PlanError('PLAN_OPTION_INVALID', q.key);
      }
      plan.push({ ...base, optionIds: [ids[0]] });
      continue;
    }
    const remove = uniqStrings(e.remove);
    const removeTexts = uniqStrings(e.removeTexts);
    const replaceWith = uniqStrings(e.replaceWith);
    if (!remove.length && !removeTexts.length) throw new PlanError('PLAN_ADJUST_EMPTY', q.key);
    if (q.retired && replaceWith.length) throw new PlanError('PLAN_RETIRED_QUESTION', q.key);
    if (replaceWith.some((id) => !live.has(id) || isOtherOptionId(id))) throw new PlanError('PLAN_OPTION_INVALID', q.key);
    if (replaceWith.some((id) => remove.includes(id))) throw new PlanError('PLAN_ADJUST_OVERLAP', q.key);
    const order = optionOrder(q);
    replaceWith.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    plan.push({ ...base, remove, removeTexts, replaceWith });
  }
  return plan;
};

// ---------------------------------------------------------------------------
// Reading a stored answer row
// ---------------------------------------------------------------------------

const isBlankText = (v) => v == null || v === '';

/**
 * The keys `/survey-results` counts a stored row under — the JavaScript twin of choiceKeyStages
 * (answerAgg.js): its optionIds when it has any, else its answer text (or texts), with null and
 * '' dropped (mergeOptionRows skips both). Used to decide "answered" and to price a change.
 */
export const keysOf = (row) => {
  if (!row) return [];
  const ids = Array.isArray(row.optionIds) ? row.optionIds : [];
  if (ids.length) return ids.filter((k) => !isBlankText(k));
  const texts = Array.isArray(row.answer) ? row.answer : [row.answer];
  return texts.filter((t) => !isBlankText(t));
};

/** Does this row answer its question, the way the results count it? */
export const isAnsweredRow = (q, row) => {
  if (!row) return false;
  if (q?.type === 'text') {
    if (Array.isArray(row.answer)) return row.answer.some((t) => !isBlankText(t));
    return !isBlankText(row.answer);
  }
  return keysOf(row).length > 0;
};

/**
 * The row the phone stores for a question the canvasser skipped (mobile/lib/surveyRunner.js
 * buildSubmitRows): pick-several posts `answer: []`, pick-one and written post `answer: null`.
 * Every reader treats `[]`, `null` and `''` alike, but writing the phone's own literal means a
 * cleared answer is byte-identical to a skip. Key order is the schema's.
 */
export const skipLiteral = (q) => ({
  questionKey: q.key,
  questionLabel: q.label,
  answer: q.type === 'multiple_choice' ? [] : null,
  optionIds: [],
  otherText: null,
});

const textToId = (q) => new Map((q.options || []).map((o) => [o.text, o.id]));

/**
 * The option ids a stored choice row means: its optionIds when it has any, else its text answer
 * (or texts) mapped to ids by exact text over every option, retired ones included — the editor's
 * seed rule (client/src/lib/surveyAnswerForm.js seedFromAnswers). `unmapped` lists old texts that
 * match no option at all.
 */
const idsOfRow = (q, row) => {
  const stored = Array.isArray(row?.optionIds) ? row.optionIds.filter((id) => !isBlankText(id)) : [];
  if (stored.length) return { ids: stored.slice(), unmapped: [] };
  const byText = textToId(q);
  const texts = (Array.isArray(row?.answer) ? row.answer : [row?.answer]).filter((t) => !isBlankText(t));
  const ids = [];
  const unmapped = [];
  for (const t of texts) {
    const id = byText.get(t);
    if (id != null) ids.push(id);
    else unmapped.push(t);
  }
  return { ids, unmapped };
};

const choiceRow = (q, ids, otherText) => ({
  questionKey: q.key,
  questionLabel: q.label,
  answer: snapshotAnswerText(q, ids, otherText),
  optionIds: ids,
  otherText: ids.includes(OTHER_OPTION_ID) ? (otherText ?? null) : null,
});

// The evaluator's cell for one stored row, built exactly as normalizeAndFilterAnswers builds it:
// ids (or text mapped to ids), filtered to ids the question knows, through the canonical makeCell.
const stringifyAnswer = (a) => (a == null ? null : Array.isArray(a) ? a.join(' ') : String(a));
const cellOf = (q, row) => {
  const valid = new Set((q.options || []).map((o) => o.id));
  if (q.otherOption) valid.add(OTHER_OPTION_ID);
  let optionIds = Array.isArray(row.optionIds) ? row.optionIds.slice() : [];
  if (optionIds.length === 0 && row.answer != null) {
    const byText = textToId(q);
    const texts = Array.isArray(row.answer) ? row.answer : [row.answer];
    optionIds = texts.map((t) => byText.get(t)).filter((id) => id != null);
  }
  optionIds = optionIds.filter((id) => valid.has(id));
  return makeCell(q.type, optionIds, stringifyAnswer(row.answer));
};
const cellsOf = (qByKey, rows) => {
  const cells = {};
  for (const r of rows) {
    const q = r && qByKey.get(r.questionKey);
    if (!q || isStatement(q)) continue;
    cells[r.questionKey] = cellOf(q, r);
  }
  return cells;
};

// ---------------------------------------------------------------------------
// The applier
// ---------------------------------------------------------------------------

/**
 * One plan entry against one question's stored row. Returns `{ next, kind, removedIds, addedIds,
 * removedTexts }` or `{ skip: reason }`.
 */
const applyOne = (q, row, entry, mode) => {
  const answered = isAnsweredRow(q, row);
  if (entry.op === 'clear') {
    if (!answered) return { skip: 'already_blank' };
    return { next: skipLiteral(q), kind: 'cleared' };
  }

  if (mode === 'person' && entry.op === 'set') {
    // One person at a time and the profile: the posted answer for this question, which may fill
    // a blank (only the ghost guard below can stop that) and may carry free text or "Other".
    if (q.type === 'text') {
      const text = typeof entry.answer === 'string' ? entry.answer.trim() : '';
      if (!text) return answered ? { next: skipLiteral(q), kind: 'cleared' } : { skip: 'already_blank' };
      if (answered && String(row.answer).trim() === text) return { skip: 'same_answer' };
      return {
        next: { questionKey: q.key, questionLabel: q.label, answer: text, optionIds: [], otherText: null },
        kind: 'changed',
        filled: !answered,
      };
    }
    const ids = uniqStrings(entry.optionIds);
    if (!ids.length) return answered ? { next: skipLiteral(q), kind: 'cleared' } : { skip: 'already_blank' };
    const otherText = ids.includes(OTHER_OPTION_ID) ? (String(entry.otherText ?? '').trim() || null) : null;
    return { next: choiceRow(q, ids, otherText), kind: 'changed', filled: !answered };
  }

  // Bulk: only where the question has an answer (ruling 3).
  if (!answered) return { skip: 'not_answered' };

  if (entry.op === 'set') {
    const target = entry.optionIds[0];
    const { ids, unmapped } = idsOfRow(q, row);
    if (!unmapped.length && ids.length === 1 && ids[0] === target) return { skip: 'same_answer' };
    return { next: choiceRow(q, [target], null), kind: 'changed' };
  }

  // adjust — pick several
  const removeSet = new Set(entry.remove || []);
  const removeTexts = new Set(entry.removeTexts || []);
  const { ids, unmapped } = idsOfRow(q, row);
  const removedTexts = unmapped.filter((t) => removeTexts.has(t));
  // An old text that still matches nothing would have to be thrown away to write the row back
  // id-native — skip the survey rather than lose part of its answer.
  if (unmapped.some((t) => !removeTexts.has(t))) return { skip: 'legacy_answer' };
  const removedIds = ids.filter((id) => removeSet.has(id));
  if (!removedIds.length && !removedTexts.length) return { skip: 'no_matching_picks' };
  const kept = ids.filter((id) => !removeSet.has(id));
  const addedIds = (entry.replaceWith || []).filter((id) => !kept.includes(id));
  const nextIds = [...kept, ...addedIds];
  if (!nextIds.length) return { next: skipLiteral(q), kind: 'cleared', removedIds, addedIds: [], removedTexts };
  return {
    next: choiceRow(q, nextIds, nextIds.includes(OTHER_OPTION_ID) ? (row.otherText ?? null) : null),
    kind: 'changed',
    removedIds,
    addedIds,
    removedTexts,
  };
};

/**
 * Apply a validated plan to one survey's stored answers.
 *
 *   mode 'bulk'   — the Door Outcomes tool: `set`/`adjust` only where answered (ruling 3).
 *   mode 'person' — the walkthrough and the profile: `set` writes the posted answer, may fill a
 *                   blank, and the ghost guard discards a fill the survey's logic would hide.
 *
 * Returns { answers, changed, rows, skipped, endsScript }:
 *   rows    — [{ questionKey, kind: 'cleared'|'changed'|'dropped', before, after, removedIds,
 *              addedIds, removedTexts }], `before`/`after` the whole stored rows (null = no row)
 *   skipped — [{ questionKey, reason }] for every plan entry that changed nothing here
 *
 * Untouched rows are carried EXACTLY — never re-normalized, relabelled or reordered, so an old
 * 3-key row stays a 3-key row. Only an edited row is rebuilt (schema key order, current label).
 */
export const applyEditPlan = (questions, answers, plan, { mode = 'bulk', flow = null } = {}) => {
  const qs = questions || [];
  const qByKey = new Map(qs.map((q) => [q.key, q]));
  const position = new Map(qs.map((q, i) => [q.key, i]));
  const stored = Array.isArray(answers) ? answers : [];
  const out = stored.slice();
  const changes = new Map(); // questionKey -> change record
  const fills = []; // [{ key, row }] new rows for questions that had none (person mode only)
  const skipped = [];

  for (const entry of plan || []) {
    const q = qByKey.get(entry.questionKey);
    if (!q || !isAnswerable(q)) continue;
    const idx = out.findIndex((r) => r && r.questionKey === q.key);
    const row = idx >= 0 ? out[idx] : null;
    const res = applyOne(q, row, entry, mode);
    if (res.skip) {
      skipped.push({ questionKey: q.key, reason: res.skip });
      continue;
    }
    if (idx >= 0) out[idx] = res.next;
    else fills.push({ key: q.key, row: res.next });
    changes.set(q.key, {
      questionKey: q.key,
      kind: res.kind,
      before: row,
      after: res.next,
      removedIds: res.removedIds || [],
      addedIds: res.addedIds || [],
      removedTexts: res.removedTexts || [],
      filled: !!res.filled,
    });
  }

  // New rows go where the survey would have put them: before the first stored row of a later
  // question (authoring order — the evaluator's order), else at the end.
  for (const { key, row } of fills) {
    const at = position.get(key) ?? Infinity;
    const before = out.findIndex((r) => r && (position.get(r.questionKey) ?? Infinity) > at);
    if (before === -1) out.push(row);
    else out.splice(before, 0, row);
  }

  // Follow-ups, ruling 2: what the survey's own logic shows before and after the edit, through the
  // canonical evaluator with cells built the way normalizeAndFilterAnswers builds them.
  const visibleBefore = visibleQuestionKeys(qs, cellsOf(qByKey, stored));
  let visibleAfter = visibleQuestionKeys(qs, cellsOf(qByKey, out));

  // Ghost guard (person mode): filling a blank on a question this person's path doesn't reach
  // would store an answer the phone could never have posted. The fill is discarded.
  if (mode === 'person') {
    let discarded = false;
    for (const [key, c] of changes) {
      if (!c.filled || visibleAfter.has(key)) continue;
      const i = out.indexOf(c.after);
      if (c.before) out[i] = c.before;
      else out.splice(i, 1);
      changes.delete(key);
      skipped.push({ questionKey: key, reason: 'hidden_on_path' });
      discarded = true;
    }
    if (discarded) visibleAfter = visibleQuestionKeys(qs, cellsOf(qByKey, out));
  }

  const dropped = [];
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const r = out[i];
    const q = r && qByKey.get(r.questionKey);
    if (!q || isStatement(q)) continue;
    if (!visibleBefore.has(q.key) || visibleAfter.has(q.key)) continue;
    if (!isAnsweredRow(q, r)) continue;
    out.splice(i, 1);
    const prior = changes.get(q.key);
    const before = prior ? prior.before : r;
    changes.set(q.key, {
      questionKey: q.key,
      kind: 'dropped',
      before,
      after: null,
      removedIds: [],
      addedIds: [],
      removedTexts: [],
      filled: false,
    });
    dropped.push(q.key);
  }

  const rows = [...changes.values()]
    .sort((a, b) => (position.get(a.questionKey) ?? 0) - (position.get(b.questionKey) ?? 0))
    .map(({ filled, ...rest }) => rest);
  return {
    answers: out,
    changed: rows.length > 0,
    rows,
    skipped,
    // A blank or changed answer that cuts a Script-flow survey short drops the rest of that path
    // (D7) — the review names it in red.
    endsScript: flow === 'script' && dropped.length > 0,
  };
};

// ---------------------------------------------------------------------------
// One person's posted answers → a plan
// ---------------------------------------------------------------------------

const trimmedOrNull = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

const sameAnswer = (q, a, b) => {
  if (q.type === 'text') return (trimmedOrNull(a?.answer) ?? '') === (trimmedOrNull(b?.answer) ?? '');
  const x = new Set(idsOfRow(q, a).ids);
  const y = new Set(idsOfRow(q, b).ids);
  if (x.size !== y.size || [...x].some((id) => !y.has(id))) return false;
  if (!x.has(OTHER_OPTION_ID)) return true;
  return trimmedOrNull(a?.otherText) === trimmedOrNull(b?.otherText);
};

/**
 * The per-person plan: a per-question diff of the posted answer set against the stored one.
 *
 * Unanswered on both sides is no change, whatever the row looks like (missing, `null`, `[]`,
 * `''`). Otherwise ids compare as a SET (an old text mapped to ids the way the editor seeds it),
 * a written answer trimmed, an "Other" text trimmed with '' read as null. Label and snapshot-text
 * drift and keys the template doesn't know are ignored, and a question the post leaves out is
 * left alone — so an untouched save is no change, and writes nothing.
 *
 * A retired question can only be cleared here: the editor shows it read-only.
 */
export const planFromAnswers = (questions, stored, posted) => {
  const plan = [];
  for (const q of questions || []) {
    if (!isAnswerable(q)) continue;
    const p = (posted || []).find((r) => r && r.questionKey === q.key);
    if (!p) continue;
    const s = (stored || []).find((r) => r && r.questionKey === q.key) || null;
    const sAns = isAnsweredRow(q, s);
    const pAns = isAnsweredRow(q, p);
    if (!sAns && !pAns) continue;
    if (sAns && pAns && sameAnswer(q, s, p)) continue;
    const base = { questionKey: q.key, questionLabel: q.label };
    if (!pAns) {
      plan.push({ ...base, op: 'clear' });
      continue;
    }
    if (q.retired) continue;
    if (q.type === 'text') {
      plan.push({ ...base, op: 'set', answer: String(p.answer).trim() });
      continue;
    }
    const valid = new Set((q.options || []).map((o) => o.id));
    if (q.otherOption || idsOfRow(q, s).ids.includes(OTHER_OPTION_ID)) valid.add(OTHER_OPTION_ID);
    let ids = [...new Set(idsOfRow(q, p).ids)].filter((id) => valid.has(id));
    if (q.type === 'single_choice') ids = ids.slice(0, 1);
    if (!ids.length) {
      if (sAns) plan.push({ ...base, op: 'clear' });
      continue;
    }
    plan.push({
      ...base,
      op: 'set',
      optionIds: ids,
      otherText: ids.includes(OTHER_OPTION_ID) ? trimmedOrNull(p.otherText) : null,
    });
  }
  return plan;
};

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

const canonRows = (answers) =>
  (Array.isArray(answers) ? answers : []).map((a) => ({
    questionKey: a?.questionKey ?? null,
    questionLabel: a?.questionLabel ?? null,
    answer: a?.answer ?? null,
    optionIds: Array.isArray(a?.optionIds) ? a.optionIds : [],
    otherText: a?.otherText ?? null,
  }));
const oidOrNull = (v) => (v ? new ObjectId(String(v)) : null);
const dateOrNull = (v) => (v ? new Date(v) : null);

/**
 * What a survey's answers ARE, independent of how they were read: a sha1 over a canonical BSON
 * of the rows (fixed key order, every missing field read as its default), who recorded them and
 * the edit stamp. Stable across a Mongoose re-cast, a string id against an ObjectId and re-ordered
 * keys — a raw-bytes hash broke on exactly those (review round 2). Changes whenever the answers,
 * the canvasser or the edit stamp change; a team re-stamp (coordinatorId) and the note don't move
 * it.
 */
export const fingerprint = (r) =>
  crypto
    .createHash('sha1')
    .update(
      BSON.serialize(
        { a: canonRows(r?.answers), u: oidOrNull(r?.userId), eb: oidOrNull(r?.editedBy), ea: dateOrNull(r?.editedAt) },
        { ignoreUndefined: false }
      )
    )
    .digest('hex');

/**
 * The editors' version: the fingerprint plus the note and its own stamp, so an editor left open
 * can't write back stale answers OR a stale note.
 */
export const editorVersion = (r) =>
  crypto
    .createHash('sha1')
    .update(JSON.stringify([fingerprint(r), r?.note ?? null, r?.noteEditedAt ? new Date(r.noteEditedAt).toISOString() : null]))
    .digest('hex');

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** What an option id is called on admin surfaces: its text, the write-in's bucket name, or the id. */
export const optionLabel = (q, id) => {
  if (isOtherOptionId(id)) return otherBucketLabel(q);
  const o = (q?.options || []).find((x) => x.id === id);
  return o ? o.text : String(id);
};

const list = (xs) => xs.join(', ');

/**
 * One plain sentence for a plan, frozen onto the run (like scopeSummary): it quotes the survey's
 * own wording as the admin saw it, which a label built later could not.
 *   "Could you help us by taking a yard sign?: took out Candidate Follow-Up, Volunteer Request"
 */
export const summarizePlan = (questions, plan) => {
  const qByKey = new Map((questions || []).map((q) => [q.key, q]));
  return (plan || [])
    .map((e) => {
      const q = qByKey.get(e.questionKey);
      const label = e.questionLabel || q?.label || e.questionKey;
      if (e.op === 'clear') return `${label}: cleared`;
      if (e.op === 'set' && q?.type === 'text') return `${label}: changed`;
      if (e.op === 'set') return `${label}: changed to ${list((e.optionIds || []).map((id) => optionLabel(q, id)))}`;
      const taken = [...(e.remove || []).map((id) => optionLabel(q, id)), ...(e.removeTexts || []).map((t) => `old answer "${t}"`)];
      const put = (e.replaceWith || []).map((id) => optionLabel(q, id));
      return `${label}: took out ${list(taken)}${put.length ? `; put in ${list(put)} where one came out` : ''}`;
    })
    .join(' · ');
};
