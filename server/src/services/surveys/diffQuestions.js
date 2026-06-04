// Classify a survey-question edit as safe or destructive relative to existing
// responses. Survey reports join answers to the CURRENT template by question
// `key` (see routes/admin/reports.js survey-results), so only changes that
// orphan or mismatch already-stored answers are destructive:
//
//   - removing a question (its key disappears, or the key itself changed)
//   - changing a question's type (the stored answer shape no longer aggregates)
//   - removing/renaming an existing option (stored answers for it become orphan
//     buckets that no longer line up with the current option set)
//
// Everything else is safe and may be applied even after responses exist:
//   - editing name / intro / closing
//   - adding a new question, adding a new option
//   - editing a question's label or `required` flag
//   - reordering questions
//
// Returns an array of human-readable reason strings; empty array = safe.
export function classifyQuestionEdits(oldQuestions = [], newQuestions = []) {
  const reasons = [];
  const newByKey = new Map((newQuestions || []).map((q) => [q.key, q]));

  for (const oq of oldQuestions || []) {
    const nq = newByKey.get(oq.key);
    if (!nq) {
      reasons.push(`Question "${oq.label}" was removed (or its key changed).`);
      continue;
    }
    if (nq.type !== oq.type) {
      reasons.push(`Question "${oq.label}" changed type (${oq.type} → ${nq.type}).`);
    }
    const newOpts = new Set(nq.options || []);
    const removed = (oq.options || []).filter((o) => !newOpts.has(o));
    if (removed.length) {
      reasons.push(
        `Question "${oq.label}" removed or renamed option(s): ${removed
          .map((o) => `"${o}"`)
          .join(', ')}.`
      );
    }
  }

  return reasons;
}
