// Classify a survey-question edit as safe or destructive relative to existing
// responses. Survey reports join answers to the CURRENT template by question
// `key` (see routes/admin/reports.js survey-results) and to options by STABLE
// option id, so with soft-retire reconcile (see surveys.js) the only change
// that still orphans / mismatches already-stored answers is:
//
//   - changing a question's type (the stored answer shape no longer aggregates)
//
// Removing a question or removing/renaming an option are now SAFE: the reconcile
// keeps the absent question/option as retired:true (id preserved) so past
// answers still report.
//
// Everything else is safe and may be applied even after responses exist:
//   - editing name / intro / closing
//   - adding a new question, adding a new option
//   - editing a question's label or `required` flag
//   - reordering questions
//   - removing a question, removing/renaming an option (soft-retired)
//
// Returns an array of human-readable reason strings; empty array = safe.
export function classifyQuestionEdits(oldQuestions = [], newQuestions = []) {
  const reasons = [];
  const newByKey = new Map((newQuestions || []).map((q) => [q.key, q]));

  for (const oq of oldQuestions || []) {
    const nq = newByKey.get(oq.key);
    if (!nq) continue;
    if (nq.type !== oq.type) {
      reasons.push(`Question "${oq.label}" changed type (${oq.type} → ${nq.type}).`);
    }
  }

  return reasons;
}
