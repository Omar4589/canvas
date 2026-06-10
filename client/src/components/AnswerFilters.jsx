// Per-question survey-answer filter chips → answerFilters: [{ questionKey, values }].
// Shared by the Walk Lists builder and the Turf Cutting targeted-round panel.
// `questions` come from /admin/reports/survey-results: [{ key, label, options:[{option,count}] }]
// (string options are also accepted). Multi-select per question; emits only
// questions with at least one selected value.
export default function AnswerFilters({ questions = [], value = [], onChange }) {
  const byKey = new Map((value || []).map((af) => [af.questionKey, new Set(af.values || [])]));

  function toggle(qKey, opt) {
    const set = new Set(byKey.get(qKey) || []);
    if (set.has(opt)) set.delete(opt);
    else set.add(opt);
    byKey.set(qKey, set);
    const next = questions
      .map((q) => {
        const vals = [...(byKey.get(q.key) || [])];
        return vals.length ? { questionKey: q.key, values: vals } : null;
      })
      .filter(Boolean);
    onChange(next);
  }

  if (!questions.length) return null;
  return (
    <div className="space-y-3">
      {questions.map((q) => {
        const sel = byKey.get(q.key) || new Set();
        return (
          <div key={q.key}>
            <div className="mb-1 text-xs font-medium text-fg-muted">{q.label}</div>
            <div className="flex flex-wrap gap-1">
              {(q.options || []).map((o) => {
                const opt = typeof o === 'string' ? o : o.option;
                const active = sel.has(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(q.key, opt)}
                    className={
                      'rounded-full px-2.5 py-1 text-xs transition-colors ' +
                      (active ? 'bg-brand-600 text-white' : 'border border-border bg-card text-fg-muted hover:bg-sunken')
                    }
                  >
                    {opt}
                    {typeof o === 'object' && o.count != null ? (
                      <span className={active ? 'ml-1 opacity-80' : 'ml-1 text-fg-subtle'}>{o.count}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
