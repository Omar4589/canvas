// Per-question survey-answer filter chips → answerFilters:
//   [{ questionKey, values:[optionIds], texts:[optionTexts] }].
// Shared by the Walk Lists builder and the Turf Cutting targeted-round panel.
// `questions` come from /admin/reports/survey-results:
//   [{ key, label, options:[{ option:<text>, id, retired, count }] }]
// (plain string options and bare {option} are also accepted). resolveWalkList
// matches id-native via `values` AND legacy text via `texts`. Orphan options
// (id null) carry their text in BOTH the values-fallback and `texts`.
// Multi-select per question; emits only questions with at least one selection.
export default function AnswerFilters({ questions = [], value = [], onChange }) {
  // Normalise a raw option (string | {option} | {option,id,retired,count}) to a
  // consistent shape. `selKey` is the stable selection key: the option id when
  // present, otherwise the text (orphan fallback).
  function normOpt(o) {
    if (typeof o === 'string') return { text: o, id: null, retired: false, count: null };
    return {
      text: o.option,
      id: o.id ?? null,
      retired: !!o.retired,
      count: o.count != null ? o.count : null,
    };
  }
  const selKeyOf = (n) => (n.id != null ? n.id : n.text);

  // Rebuild the per-question selection sets (keyed by selKey) from the incoming
  // value's `values` (ids + orphan-text fallback) and `texts`.
  const byKey = new Map(
    (value || []).map((af) => [
      af.questionKey,
      new Set([...(af.values || []), ...(af.texts || [])]),
    ])
  );

  function toggle(qKey, n) {
    const key = selKeyOf(n);
    const set = new Set(byKey.get(qKey) || []);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    byKey.set(qKey, set);

    const next = questions
      .map((q) => {
        const chosen = byKey.get(q.key);
        if (!chosen || !chosen.size) return null;
        const values = [];
        const texts = [];
        for (const o of q.options || []) {
          const opt = normOpt(o);
          if (!chosen.has(selKeyOf(opt))) continue;
          if (opt.id != null) {
            values.push(opt.id);
          } else {
            // Orphan option: no stable id → match on text in BOTH lanes.
            values.push(opt.text);
            texts.push(opt.text);
          }
        }
        return values.length || texts.length
          ? { questionKey: q.key, values, texts }
          : null;
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
                const n = normOpt(o);
                const key = selKeyOf(n);
                const active = sel.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(q.key, n)}
                    className={
                      'rounded-full px-2.5 py-1 text-xs transition-colors ' +
                      (active ? 'bg-brand-600 text-white' : 'border border-border bg-card text-fg-muted hover:bg-sunken')
                    }
                  >
                    {n.text}
                    {n.retired ? (
                      <span
                        className={
                          'ml-1 rounded px-1 text-[10px] ' +
                          (active ? 'bg-white/20 text-white' : 'bg-sunken text-fg-subtle')
                        }
                      >
                        retired
                      </span>
                    ) : null}
                    {n.count != null ? (
                      <span className={active ? 'ml-1 opacity-80' : 'ml-1 text-fg-subtle'}>{n.count}</span>
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
