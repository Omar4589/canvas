import { useMemo } from 'react';
import SurveyAnswerFields from '../surveys/SurveyAnswerFields.jsx';
import { visibleQuestionKeys } from '../../lib/surveyVisibility.js';
import { cellsFromVals } from '../../lib/surveyAnswerForm.js';

// The answers an admin is recording on a canvasser's behalf.
//
// CRITICAL difference from the response EDITOR (VoterDetailPage's SurveyCard): this applies
// `visibleIf` LIVE, hiding child questions whose parent answer doesn't reveal them. The editor
// deliberately shows every non-retired question because it is editing recorded history; this is
// authoring a FIELD submission, and the server drops hidden answers (dropHidden: true) exactly as
// it does for the phone. Without the live filter an admin could fill a child question, watch the
// server discard it, and be told a different number of answers was recorded than they typed.
//
// Partial entry is legal and deliberate (owner ruling): answering one question and leaving the
// rest blank records only what is actually known. Required questions are NOT enforced.
export default function SurveyAnswerComposer({ template, vals, otherTexts, onChange, onOtherChange, idPrefix }) {
  const questions = useMemo(
    () => (template?.questions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).filter((q) => !q.retired),
    [template]
  );
  const visible = useMemo(() => {
    const keys = visibleQuestionKeys(questions, cellsFromVals(questions, vals));
    return questions.filter((q) => keys.has(q.key));
  }, [questions, vals]);

  const answered = visible.filter((q) => {
    const v = vals[q.key];
    return Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '';
  }).length;

  if (!template) return null;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-fg">{template.name}</span>
        <span className="text-xs text-fg-muted">
          {answered} of {visible.length} answered
        </span>
      </div>
      <SurveyAnswerFields
        questions={visible}
        vals={vals}
        otherTexts={otherTexts}
        onChange={onChange}
        onOtherChange={onOtherChange}
        idPrefix={idPrefix}
      />
      {answered === 0 && (
        <p className="mt-3 rounded border border-border bg-sunken px-3 py-2 text-xs text-fg-muted">
          You can leave answers blank — the response will be recorded with nothing filled in. Only
          record what you actually know.
        </p>
      )}
    </div>
  );
}
