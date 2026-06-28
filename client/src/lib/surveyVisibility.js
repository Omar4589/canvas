// MIRROR of server/src/services/surveys/visibility.js — keep the body (everything
// below the marker) BYTE-IDENTICAL. Do not edit here without editing the canonical.
// A server drift-guard test (visibility.test.js) fails CI if these diverge.
// ==== BEGIN MIRRORED BODY ====

// Build the normalized answer "cell" the evaluator reasons about. CRITICAL:
// choice questions NEVER carry text into the evaluator (only text-type questions
// do) so `answered`/`not_answered`/`is_not` agree across server, web and mobile
// even when a choice answer's optionIds were filtered to empty.
export function makeCell(type, optionIds, text) {
  return {
    optionIds: Array.isArray(optionIds) ? optionIds : [],
    text: type === 'text' ? (text == null ? null : String(text)) : null,
  };
}

function cellIsAnswered(cell) {
  if (!cell) return false;
  if (cell.optionIds && cell.optionIds.length > 0) return true;
  return cell.text != null && String(cell.text).trim() !== '';
}

function evalRule(rule, cell) {
  const ids = (cell && cell.optionIds) || [];
  switch (rule.op) {
    case 'is':
      return rule.optionIds.length > 0 && ids.includes(rule.optionIds[0]);
    case 'is_not':
      return rule.optionIds.length > 0 && !ids.includes(rule.optionIds[0]);
    case 'any_of':
      return rule.optionIds.some((id) => ids.includes(id));
    case 'answered':
      return cellIsAnswered(cell);
    case 'not_answered':
      return !cellIsAnswered(cell);
    default:
      return true; // unknown op fails OPEN (visible) so a future op can't strand a question
  }
}

// Pure: evaluate one question's visibleIf against an answers map (key -> cell).
// A missing answer is treated as absent (empty cell). Exported for fixtures; the
// driver below layers on forward-reference protection.
export function evaluateVisibleIf(visibleIf, answersByKey) {
  if (!visibleIf) return true;
  const rules = visibleIf.rules || [];
  if (rules.length === 0) return true;
  const get = (k) => (answersByKey instanceof Map ? answersByKey.get(k) : answersByKey[k]);
  const results = rules.map((r) => evalRule(r, get(r.questionKey)));
  return visibleIf.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
}

// Order-aware driver. Walks NON-retired questions in array (authoring) order,
// exposing each visible question's answer only to questions AFTER it — so a hidden
// parent's stale answer can never satisfy a child. A rule referencing a LATER or
// SELF question (a corrupt forward reference the builder normally prevents) fails
// closed (the question hides) rather than silently reading an absent answer.
export function visibleQuestionKeys(questions, rawAnswersByKey) {
  const raw =
    rawAnswersByKey instanceof Map
      ? rawAnswersByKey
      : new Map(Object.entries(rawAnswersByKey || {}));
  const active = (questions || []).filter((q) => q && !q.retired);
  const posByKey = new Map(active.map((q, i) => [q.key, i]));
  const visible = new Set();
  const effective = new Map();
  active.forEach((q, i) => {
    const rules = (q.visibleIf && q.visibleIf.rules) || [];
    const forwardRef = rules.some((r) => {
      const p = posByKey.get(r.questionKey);
      return p != null && p >= i; // references a later-or-self ACTIVE question
    });
    const ok = forwardRef ? false : evaluateVisibleIf(q.visibleIf, effective);
    if (ok) {
      visible.add(q.key);
      if (raw.has(q.key)) effective.set(q.key, raw.get(q.key));
    }
  });
  return visible;
}
