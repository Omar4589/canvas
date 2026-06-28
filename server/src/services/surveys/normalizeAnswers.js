// Centralizes survey-answer normalization so the canvasser submit path and the
// admin in-place edit path can never drift. Both call this; the only difference
// is dropHidden (submit drops ghost answers to hidden questions, admin edit
// keeps them to preserve recorded history). NEVER throws / never 400s — unknown
// option ids are pruned and unknown-question rows are dropped silently.
import { makeCell, visibleQuestionKeys } from './visibility.js';

// Collapse an answer snapshot (string | string[] | null) to a single string or null.
function stringifyAnswer(a) {
  if (a == null) return null;
  if (Array.isArray(a)) return a.join(' ');
  return String(a);
}

export function normalizeAndFilterAnswers(template, rawAnswers, { dropHidden = true } = {}) {
  const questions = (template && template.questions) || [];
  const questionByKey = new Map(questions.map((q) => [q.key, q]));

  // Normalize every row that maps to a KNOWN template question; drop unknown-key rows.
  const normalized = [];
  for (const row of rawAnswers || []) {
    const q = questionByKey.get(row.questionKey);
    if (!q) continue; // unknown question — never carried

    const validIds = new Set((q.options || []).map((o) => o.id));
    if (q.otherOption) validIds.add('__other__');

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
      q.otherOption && optionIds.includes('__other__') ? (row.otherText ?? null) : null;

    normalized.push({
      questionKey: row.questionKey,
      questionLabel: q.label,
      answer: row.answer ?? null,
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
