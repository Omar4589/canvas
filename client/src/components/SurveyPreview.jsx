// Read-only render of a survey template (intro · questions · closing). Used by the
// in-campaign Survey screen to preview the attached template without pulling in the
// editable builder (QuestionCard is module-local to SurveysPage). Question shape:
// { key, label, type: 'single_choice'|'multiple_choice'|'text', options[], required, order }.

const TYPE_HINT = {
  single_choice: 'Pick one',
  multiple_choice: 'Pick many',
  text: 'Type a response',
};

export default function SurveyPreview({ survey }) {
  if (!survey) return null;
  // Retired questions are hidden in the field, so the preview hides them too
  // (mirrors the retired-option filter below).
  const questions = (survey.questions || [])
    .filter((q) => !q.retired)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <div className="space-y-4">
      {survey.intro ? (
        <p className="rounded-md bg-sunken px-3 py-2 text-sm italic text-fg-muted">{survey.intro}</p>
      ) : null}

      <ol className="space-y-3">
        {questions.map((q, i) => {
          const isChoice = q.type === 'single_choice' || q.type === 'multiple_choice';
          return (
            <li key={q.key || i} className="rounded-md border border-border bg-card p-3">
              <div className="text-sm font-medium text-fg">
                <span className="mr-2 text-fg-subtle">{i + 1}.</span>
                {q.label || <span className="text-fg-subtle">Untitled question</span>}
                {q.required ? <span className="ml-1 text-danger" title="Required">*</span> : null}
              </div>
              <div className="mt-0.5 text-xs text-fg-subtle">{TYPE_HINT[q.type] || q.type}</div>

              {isChoice && (q.options || []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {(q.options || [])
                    .filter((opt) => typeof opt === 'string' || !opt.retired)
                    .map((opt, oi) => {
                      const text = typeof opt === 'string' ? opt : opt?.text;
                      return (
                        <li key={oi} className="flex items-center gap-2 text-sm text-fg-muted">
                          <span
                            className={
                              'inline-block h-3 w-3 shrink-0 border border-border-strong ' +
                              (q.type === 'single_choice' ? 'rounded-full' : 'rounded-sm')
                            }
                          />
                          {text || <span className="text-fg-subtle">(empty option)</span>}
                        </li>
                      );
                    })}
                </ul>
              )}
              {q.type === 'text' && (
                <div className="mt-2 rounded border border-dashed border-border-strong px-3 py-2 text-xs text-fg-subtle">
                  Free-text answer
                </div>
              )}
            </li>
          );
        })}
        {!questions.length && (
          <li className="text-sm text-fg-muted">This survey has no questions yet.</li>
        )}
      </ol>

      {survey.closing ? (
        <p className="rounded-md bg-sunken px-3 py-2 text-sm italic text-fg-muted">{survey.closing}</p>
      ) : null}
    </div>
  );
}
