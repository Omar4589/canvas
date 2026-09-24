import { OTHER_OPTION_ID } from '../surveys/otherOption.js';

// Answer columns for ONE survey template, plus the renderer that fills them. Lifted out of
// buildSurveyResultsWide so the Results by voter export spends the same logic instead of a second
// copy — two exports that disagreed about what a question is called, or about what an option id
// means, would put two different answers for one voter in front of the same client.
//
// A FACTORY, never module-level maps, and that is load-bearing rather than tidy: option ids are
// unique only WITHIN a question (services/surveys/otherOption.js, SurveyTemplate's questionSchema),
// question keys only within a template — `POST /admin/surveys/:id/duplicate` clones both verbatim —
// so one shared `${key}:${optionId}` map across templates cross-resolves option TEXT between two
// unrelated surveys. Per-template state makes that impossible instead of documented.

// The snapshot rendering of one answers[] entry — what was actually recorded at the door (the
// voters-by-answer.csv answerText contract, honest across option renames).
export const snapshotAnswerText = (a) => {
  const base = Array.isArray(a.answer) ? a.answer.join('; ') : a.answer ?? '';
  const embedded = Array.isArray(a.answer) ? a.answer.includes(a.otherText) : a.answer === a.otherText;
  return a.otherText && !embedded ? `${base} — ${a.otherText}` : base;
};

/**
 * @param template      the SurveyTemplate doc (lean), or null/undefined for a deleted template
 * @param orphanEntries [{ key, label }] question keys present in recorded answers but no longer on
 *                      the template (hard-deleted questions), labelled from their snapshot. The
 *                      CALLER discovers these, because it owns the response query they come from.
 *
 * Returns { cols, columnOf, renderAnswer, templateName }:
 *   cols        — current questions in template order, then orphans
 *   columnOf    — the column's BASE name: the label, or `label (key)` when this template uses one
 *                 label twice. Callers that group columns further (by round, by survey) decorate
 *                 this; they must not re-implement it, or one file's header stops matching another's.
 *   renderAnswer(questionKey, answers) — id-native against CURRENT option text with the recorded
 *                 snapshot as fallback, so a renamed option reads as what it means today while a
 *                 legacy row (no ids) still reads as what was said.
 */
export const templateAnswerPlan = (template, orphanEntries = []) => {
  const questions = (template?.questions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const known = new Set(questions.map((x) => x.key));
  const orphans = orphanEntries
    .filter((o) => o.key && !known.has(o.key))
    .map((o) => ({ key: o.key, label: o.label || o.key }));

  const labelCounts = new Map();
  for (const x of [...questions, ...orphans]) labelCounts.set(x.label, (labelCounts.get(x.label) || 0) + 1);
  const columnOf = (x) => ((labelCounts.get(x.label) || 0) > 1 ? `${x.label} (${x.key})` : x.label);

  const optionTextById = new Map();
  for (const question of questions) {
    for (const opt of question.options || []) optionTextById.set(`${question.key}:${opt.id}`, opt.text);
    // The write-in has no option row, so without this its ids resolve to nothing and the cell falls
    // back to the bare snapshot — a write-in of "potholes" printing byte-identically to a canonical
    // option named "potholes". Seeded, it reads "Other — potholes".
    if (question.otherOption) optionTextById.set(`${question.key}:${OTHER_OPTION_ID}`, 'Other');
  }

  const renderAnswer = (qk, answers) => {
    const entries = (answers || []).filter((a) => a.questionKey === qk);
    if (!entries.length) return '';
    return entries
      .map((a) => {
        const texts = (a.optionIds || []).map((id) => optionTextById.get(`${qk}:${id}`)).filter(Boolean);
        if (!texts.length) return snapshotAnswerText(a);
        const base = texts.join('; ');
        return a.otherText ? `${base} — ${a.otherText}` : base;
      })
      .join(' | ');
  };

  return { cols: [...questions, ...orphans], columnOf, renderAnswer, templateName: template?.name || '' };
};
