// The choices a human is offered for one survey question — including the synthetic
// "Other (specify)" write-in, which is NOT a row in `question.options`.
//
// `otherOption` is a boolean on the question; the write-in choice exists only at render time,
// under the reserved id `__other__`. Every surface that draws a question's choices therefore has
// to materialize it, and the ones that forgot are exactly the ones where Other went missing: the
// read-only preview showed a survey the phone doesn't ask, and the admin response editor couldn't
// represent an Other answer at all, so saving an edit de-classified it.
//
// Mirrors server/src/services/surveys/otherOption.js. The mobile field form
// (mobile/app/(app)/voter/[id]/survey.jsx) and the print model
// (client/src/lib/packet/surveyPrintModel.js) materialize it inline with their own labels and
// extra flags — deliberately left alone, since both are correct today and covered by tests.

export const OTHER_OPTION_ID = '__other__';

export const isOtherOptionId = (id) => id === OTHER_OPTION_ID;

/**
 * The renderable choices for a question, oldest-first, with the write-in appended last.
 *
 * options.includeRetired — retired options are hidden by default, EXCEPT any whose id is in
 *   `keepIds`. An editor must keep showing a retired option that the response actually selected,
 *   or saving silently de-selects it (the same data-loss shape as the Other bug).
 * options.otherLabel — 'Other (specify)' by default, matching the builder toggle and the phone.
 *
 * Returns [{ id, text, isOther }]. Non-choice questions return [].
 */
export function choicesFor(question, { includeRetired = false, keepIds = [], otherLabel = 'Other (specify)' } = {}) {
  if (!question || (question.type !== 'single_choice' && question.type !== 'multiple_choice')) return [];
  const keep = new Set(keepIds || []);
  const out = [];
  for (const opt of question.options || []) {
    // Legacy templates stored options as bare strings; treat the string as both id and text.
    if (typeof opt === 'string') {
      out.push({ id: opt, text: opt, isOther: false });
      continue;
    }
    if (!opt) continue;
    if (opt.retired && !includeRetired && !keep.has(opt.id)) continue;
    out.push({ id: opt.id, text: opt.text, isOther: false, retired: !!opt.retired });
  }
  if (question.otherOption) out.push({ id: OTHER_OPTION_ID, text: otherLabel, isOther: true });
  return out;
}
