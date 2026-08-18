// Centralizes survey-answer normalization so the canvasser submit path and the
// admin in-place edit path can never drift. Both call this; the only difference
// is dropHidden (submit drops ghost answers to hidden questions, admin edit
// keeps them to preserve recorded history). NEVER throws / never 400s — unknown
// option ids are pruned and unknown-question rows are dropped silently.
import { makeCell, visibleQuestionKeys } from './visibility.js';
import { OTHER_OPTION_ID, isOtherOptionId } from './otherOption.js';

// Collapse an answer snapshot (string | string[] | null) to a single string or null.
function stringifyAnswer(a) {
  if (a == null) return null;
  if (Array.isArray(a)) return a.join(' ');
  return String(a);
}

/**
 * Rebuild the human-readable `answer` snapshot from the id-native `optionIds`.
 *
 * Until now nothing server-side derived this — both clients built it themselves before POSTing
 * (VoterDetailPage's SurveyCard, the mobile survey screen). That was tolerable while every writer
 * was a client. It stopped being tolerable once a WORKER writes responses: the bulk answer set is
 * stored on the run doc and replayed with no client in the loop.
 *
 * Deriving it here also closes a gap that already existed — a hand-rolled API call could store an
 * `answer` text disagreeing with its own `optionIds`, and reporting believes `optionIds`.
 *
 * `__other__` resolves to the typed text, matching how the phone stores a write-in.
 * Free-text questions have no options, so their `answer` passes through untouched.
 */
export function snapshotAnswerText(question, optionIds, otherText, fallback = null) {
  if (!question) return fallback ?? null;
  if (question.type === 'text') return fallback ?? null;

  const ids = Array.isArray(optionIds) ? optionIds : [];
  if (!ids.length) return null;

  const textById = new Map((question.options || []).map((o) => [o.id, o.text]));
  const texts = ids.map((id) => (isOtherOptionId(id) ? (otherText ?? null) : (textById.get(id) ?? null)));

  if (question.type === 'multiple_choice') return texts.filter((t) => t != null);
  return texts.find((t) => t != null) ?? null;
}

// `rebuildAnswerText` is opt-in rather than always-on: the two existing callers receive `answer`
// from a client that just built it from the same optionIds, and silently rewriting it for them
// would be a behavior change to two shipped write paths for no gain. The conversion service opts
// in because its writer is a worker with no client to build it.
export function normalizeAndFilterAnswers(
  template,
  rawAnswers,
  { dropHidden = true, rebuildAnswerText = false } = {}
) {
  const questions = (template && template.questions) || [];
  const questionByKey = new Map(questions.map((q) => [q.key, q]));

  // Normalize every row that maps to a KNOWN template question; drop unknown-key rows.
  const normalized = [];
  for (const row of rawAnswers || []) {
    const q = questionByKey.get(row.questionKey);
    if (!q) continue; // unknown question — never carried

    const validIds = new Set((q.options || []).map((o) => o.id));
    if (q.otherOption) validIds.add(OTHER_OPTION_ID);

    let optionIds = Array.isArray(row.optionIds) ? row.optionIds.slice() : [];
    // Phase-1 backfill: no optionIds but an answer snapshot — best-effort map
    // each answer text to an option id by EXACT text match before filtering.
    if (optionIds.length === 0 && row.answer != null) {
      const textToId = new Map((q.options || []).map((o) => [o.text, o.id]));
      const texts = Array.isArray(row.answer) ? row.answer : [row.answer];
      optionIds = texts.map((t) => textToId.get(t)).filter((id) => id != null);
    }
    // Keep retired ids; drop ids the template doesn't know about (never throw).
    optionIds = optionIds.filter((id) => validIds.has(id));

    const otherText =
      q.otherOption && optionIds.includes(OTHER_OPTION_ID) ? (row.otherText ?? null) : null;

    normalized.push({
      questionKey: row.questionKey,
      questionLabel: q.label,
      answer: rebuildAnswerText
        ? snapshotAnswerText(q, optionIds, otherText, row.answer ?? null)
        : (row.answer ?? null),
      optionIds,
      otherText,
    });
  }

  // Build the evaluator's answer map and compute which questions are visible.
  const rawAnswersByKey = {};
  for (const row of normalized) {
    const q = questionByKey.get(row.questionKey);
    rawAnswersByKey[row.questionKey] = makeCell(q.type, row.optionIds, stringifyAnswer(row.answer));
  }
  const visible = visibleQuestionKeys(questions, rawAnswersByKey);

  return dropHidden ? normalized.filter((row) => visible.has(row.questionKey)) : normalized;
}
