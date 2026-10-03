// The two pure halves of "edit a survey answer set in a form": seed the form from stored answers,
// and turn form state back into answer rows.
//
// Extracted from VoterDetailPage's SurveyCard so the DESK-ENTRY composer (Door Outcomes →
// Surveyed) authors answers exactly the way the editor edits them. The bug this prevents is
// specific and has bitten before: the `__other__` write-in is a question FLAG, not a row in
// options[], so any surface that rebuilds answers without this logic de-classifies an Other answer
// — optionIds goes empty, otherText goes null, and the write-in drops out of its reporting bucket
// into a junk bucket named after the typed text.
//
// Pure on purpose: no JSX, no hooks. The renderer is components/surveys/SurveyAnswerFields.jsx.
//
// A STATEMENT (type 'statement', docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §I) is script read aloud at
// the door and records nothing, so all three halves below skip it: no form slot, no answer row,
// no evaluator cell. The server drops a statement row anyway (normalizeAnswers.js); skipping it
// here keeps every caller of these helpers honest without leaning on that backstop. isAnswerable
// is the phone's own test (surveyRunner.js), so desk entry and the door agree on what a statement is.
import { OTHER_OPTION_ID } from './surveyChoices.js';
import { makeCell } from './surveyVisibility.js';
import { isAnswerable } from './surveyRunner.js';

/**
 * Form state from stored answers.
 *
 * Prefers stored `optionIds`; falls back to mapping a legacy snapshot's TEXT back to ids, which is
 * the only way responses recorded before stable option ids existed can still be edited.
 * Returns { vals, otherTexts } — `vals[key]` is a string for single-choice/text, an array for multi.
 */
export function seedFromAnswers(questions, answers = []) {
  const vals = {};
  const otherTexts = {};
  for (const q of questions || []) {
    if (!isAnswerable(q)) continue;
    const a = (answers || []).find((x) => x.questionKey === q.key);
    if (q.type === 'text') {
      vals[q.key] = a?.answer ?? '';
      continue;
    }
    let ids = Array.isArray(a?.optionIds) && a.optionIds.length ? a.optionIds : null;
    if (!ids && a?.answer != null) {
      const byText = new Map((q.options || []).map((o) => [o.text, o.id]));
      const texts = Array.isArray(a.answer) ? a.answer : [a.answer];
      ids = texts.map((t) => byText.get(t)).filter(Boolean);
    }
    ids = ids || [];
    vals[q.key] = q.type === 'multiple_choice' ? ids : ids[0] ?? '';
    otherTexts[q.key] = a?.otherText ?? '';
  }
  return { vals, otherTexts };
}

/**
 * Answer rows from form state.
 *
 * `carryThrough` — answers to questions NOT in `questions` (retired or since-removed) are appended
 * unchanged. The editor passes the response's own answers so editing a live question can't silently
 * drop history; the composer passes nothing, because it is authoring, not preserving.
 *
 * The `answer` text snapshot is still built here for display, but the SERVER rebuilds it from
 * optionIds on the desk-entry path (services/surveys/normalizeAnswers.js snapshotAnswerText) —
 * so a mismatch is corrected rather than stored.
 */
export function buildAnswers(questions, vals, otherTexts = {}, { carryThrough = [] } = {}) {
  const editable = (questions || []).filter((q) => !q.retired);
  // A statement gets no row. Its key still lands in `seen` below, so a stray stored row for it is
  // not carried through either.
  const answers = editable.filter(isAnswerable).map((q) => {
    const v = vals[q.key];
    if (q.type === 'text') {
      return { questionKey: q.key, questionLabel: q.label, answer: v ?? null, optionIds: [] };
    }
    const ids = q.type === 'multiple_choice' ? (Array.isArray(v) ? v : []) : v ? [v] : [];
    const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
    // The sentinel has no option label, so its snapshot IS the typed text (falling back to
    // 'Other' when nothing was typed) — exactly what the capture flow stores.
    const otherText = ids.includes(OTHER_OPTION_ID) ? (otherTexts[q.key] || '').trim() || null : null;
    const texts = ids
      .map((id) => (id === OTHER_OPTION_ID ? otherText || 'Other' : byId.get(id)))
      .filter((t) => t != null);
    const answer = q.type === 'multiple_choice' ? texts : texts[0] ?? null;
    return { questionKey: q.key, questionLabel: q.label, answer, optionIds: ids, otherText };
  });

  const seen = new Set(editable.map((q) => q.key));
  for (const a of carryThrough) if (!seen.has(a.questionKey)) answers.push(a);
  return answers;
}

/** Answer rows minus the ones nobody filled in — partial entry is legal, empty rows are noise. */
export const dropEmptyAnswers = (answers) =>
  (answers || []).filter((a) =>
    a.optionIds?.length ? true : typeof a.answer === 'string' ? a.answer.trim() !== '' : a.answer != null
  );

/**
 * The evaluator cells surveyVisibility expects, built from live form state.
 *
 * Built with the canonical makeCell rather than a hand-rolled object: its contract is that choice
 * questions never carry text into the evaluator, and re-typing that rule here is exactly how the
 * three mirrors (server/web/mobile) would drift.
 */
export const cellsFromVals = (questions, vals) => {
  const cells = {};
  for (const q of questions || []) {
    // No cell for a statement: the evaluator reads an absent cell as empty, which is all a
    // statement could ever hold, and no rule may reference one.
    if (!isAnswerable(q)) continue;
    const v = vals[q.key];
    // A text question's value is TEXT, never an option id — treating it as one made a free-text
    // answer look like a chosen option to every visibleIf rule reading optionIds.
    const optionIds =
      q.type === 'text' ? [] : q.type === 'multiple_choice' ? (Array.isArray(v) ? v : []) : v ? [v] : [];
    cells[q.key] = makeCell(q.type, optionIds, q.type === 'text' ? v ?? '' : null);
  }
  return cells;
};
