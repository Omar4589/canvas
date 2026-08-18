import { choicesFor, OTHER_OPTION_ID } from '../../lib/surveyChoices.js';

// The input controls for one survey question set — the renderer half of the answer form.
//
// Shared by the admin response EDITOR (VoterDetailPage's SurveyCard) and the desk-entry COMPOSER
// (Door Outcomes → Surveyed), because a question has to be answerable the same way wherever it is
// answered. The synthetic "Other (specify)" choice is materialized by choicesFor — it is a
// question flag, never a row in options[], so a surface that draws options directly cannot
// represent an Other answer at all.
//
// `keepIds` per question keeps a SINCE-RETIRED option visible when this response actually selected
// it; without it, saving silently de-selects the answer.
export default function SurveyAnswerFields({ questions, vals, otherTexts, onChange, onOtherChange, idPrefix = 'q' }) {
  const setVal = (key, value) => onChange({ ...vals, [key]: value });
  const toggleMulti = (key, optId) => {
    const cur = Array.isArray(vals[key]) ? vals[key] : [];
    setVal(key, cur.includes(optId) ? cur.filter((o) => o !== optId) : [...cur, optId]);
  };

  return (
    <div className="space-y-3">
      {questions.map((q) => {
        const selected = Array.isArray(vals[q.key]) ? vals[q.key] : vals[q.key] ? [vals[q.key]] : [];
        const choices = choicesFor(q, { keepIds: selected });
        const otherPicked = selected.includes(OTHER_OPTION_ID);
        const id = `${idPrefix}-${q.key}`;
        return (
          <div key={q.key}>
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-fg-muted">
              {q.label}
            </label>
            {q.type === 'single_choice' ? (
              <select
                id={id}
                value={vals[q.key] ?? ''}
                onChange={(e) => setVal(q.key, e.target.value)}
                className="w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg"
              >
                <option value="">—</option>
                {choices.map((o) => (
                  <option key={o.id} value={o.id}>{o.text}</option>
                ))}
              </select>
            ) : q.type === 'multiple_choice' ? (
              <div className="flex flex-wrap gap-3">
                {choices.map((o) => (
                  <label key={o.id} className="flex items-center gap-1 text-sm text-fg">
                    <input
                      type="checkbox"
                      className="accent-brand-accent"
                      checked={Array.isArray(vals[q.key]) && vals[q.key].includes(o.id)}
                      onChange={() => toggleMulti(q.key, o.id)}
                    />
                    {o.text}
                  </label>
                ))}
              </div>
            ) : (
              <input
                id={id}
                value={vals[q.key] ?? ''}
                onChange={(e) => setVal(q.key, e.target.value)}
                className="w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg"
              />
            )}
            {otherPicked && (
              <input
                value={otherTexts[q.key] ?? ''}
                onChange={(e) => onOtherChange({ ...otherTexts, [q.key]: e.target.value })}
                placeholder="Please specify"
                className="mt-1 w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
