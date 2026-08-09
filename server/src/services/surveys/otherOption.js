// The "Other: ___" write-in choice.
//
// `otherOption` is a BOOLEAN on the question (SurveyTemplate.js), not a row in `options[]`.
// The choice itself is materialized synthetically at render time under this reserved id, and a
// stored answer looks like:
//     { questionKey, answer: 'potholes', optionIds: ['__other__'], otherText: 'potholes' }
//
// That "flag, not a row" design is why the sentinel has to be seeded by hand into anything that
// reconciles answers against `question.options` — reporting buckets, the wide export's option
// lookup, the admin response editor. Every such site imports from here rather than re-typing the
// literal, so there is one place to look when the sentinel's behavior is in question.
//
// The id can never be minted by accident: all three option-id generators strip leading/trailing
// underscores, so a hand-typed option named "Other" slugs to `other`, never `__other__`.
// Mirrored on the client by client/src/lib/surveyChoices.js.

export const OTHER_OPTION_ID = '__other__';

export const isOtherOptionId = (id) => id === OTHER_OPTION_ID;

// What to call the write-in bucket on ADMIN surfaces. Nothing stops an operator authoring a real
// option whose text is literally "Other" alongside `otherOption: true` (there is no text-uniqueness
// check on save, deliberately — rejecting it would 400 an existing template on its next edit), and
// two rows sharing a label is what breaks React keys and expand-state on the surfaces that key on
// text. So when the label is already taken, the write-in bucket takes the longer name the builder
// and the phone already use for it.
export function otherBucketLabel(question) {
  const taken = (question?.options || []).some((o) => String(o?.text || '').trim() === 'Other');
  return taken ? 'Other (specify)' : 'Other';
}
