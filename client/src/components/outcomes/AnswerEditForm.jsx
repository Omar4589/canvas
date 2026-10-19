import { useState } from 'react';
import { Button, Modal, Select } from '../ui/index.js';
import { LEAVE, pickKey, pickLabel, canReview, suggestedTakeOut, suggestionLabel, OTHER_OPTION_ID } from '../../lib/answerEditPlan.js';

// Door Outcomes → Edit answers…, step 1: what to change, question by question
// (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md, Part 1 Design §2). Every count here is over the selected
// surveys only, from the dry run. Take out is what keeps genuine picks: on a pick-several question,
// Clear every pick takes them too, and the form says so in red.
const TYPE_WORD = { single_choice: 'pick one', multiple_choice: 'pick several', text: 'written' };

// "asked only after Support or Likely Support", from the question's own visibleIf.
const askedOnlyAfter = (q, questions) => {
  const rules = q.visibleIf?.rules || [];
  if (!rules.length) return null;
  const texts = [];
  for (const r of rules) {
    const src = questions.find((x) => x.key === r.questionKey);
    for (const id of r.optionIds || []) {
      const t = (src?.options || []).find((o) => o.id === id)?.text;
      if (t) texts.push(t);
    }
  }
  return texts.length ? `asked only after ${texts.join(' or ')}` : 'asked only on some paths';
};

const Radio = ({ name, checked, onChange, children, disabled }) => (
  <label className={`flex items-center gap-1.5 text-sm ${disabled ? 'text-fg-subtle' : 'text-fg'}`}>
    <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="accent-brand-accent" />
    {children}
  </label>
);

const QuestionBlock = ({ q, number, total, form, setChoice, questions, suggestion }) => {
  const c = form[q.key] || LEAVE;
  const picks = q.picks || [];
  const liveOptions = (q.options || []).filter((o) => !o.retired);
  const name = `ae-${q.key}`;
  const hint = askedOnlyAfter(q, questions);
  const nowLine = picks.map((p) => `${p.legacy ? `old answer: “${p.label}”` : p.label} ${p.count.toLocaleString()}`).join(' · ');
  return (
    <div className="border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-fg">
          {number != null ? <span className="mr-2 text-fg-subtle">{number}</span> : null}
          {q.label} <span className="font-normal text-fg-subtle">({TYPE_WORD[q.type] || q.type})</span>
        </div>
        <span className="text-xs text-fg-muted">answered on {q.answered.toLocaleString()} of {total.toLocaleString()}</span>
      </div>
      {hint && <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div>}
      {q.type !== 'text' && picks.length > 0 && (
        <div className={`mt-1 text-xs ${c.mode === 'clear' && q.type === 'multiple_choice' ? 'text-danger' : 'text-fg-muted'}`}>
          {c.mode === 'clear' && q.type === 'multiple_choice'
            ? `Clearing removes every pick on these surveys: ${nowLine}. To keep some of them, use Take out picks.`
            : `Now on these surveys: ${nowLine}`}
        </div>
      )}
      {suggestion && (c.mode !== 'takeOut' || (c.take || []).join() !== suggestion.take.join()) && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => setChoice(q.key, { ...LEAVE, mode: 'takeOut', take: suggestion.take })}
        >
          {suggestionLabel(q, suggestion.take)}
        </Button>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Radio name={name} checked={c.mode === 'leave'} onChange={() => setChoice(q.key, LEAVE)}>Leave as recorded</Radio>
        {q.type === 'multiple_choice' && (
          <Radio name={name} checked={c.mode === 'takeOut'} onChange={() => setChoice(q.key, { ...LEAVE, mode: 'takeOut' })} disabled={!picks.length}>
            Take out picks
          </Radio>
        )}
        <Radio name={name} checked={c.mode === 'clear'} onChange={() => setChoice(q.key, { ...LEAVE, mode: 'clear' })} disabled={!q.answered}>
          {q.type === 'multiple_choice' ? 'Clear every pick' : 'Clear the answer'}
        </Radio>
        {q.type === 'single_choice' && !q.retired && (
          <span className="flex items-center gap-1.5">
            <Radio name={name} checked={c.mode === 'set'} onChange={() => setChoice(q.key, { ...LEAVE, mode: 'set' })} disabled={!q.answered}>
              Change it to
            </Radio>
            <Select
              value={c.mode === 'set' ? c.setTo : ''}
              onChange={(e) => setChoice(q.key, { ...LEAVE, mode: 'set', setTo: e.target.value })}
              className="w-48"
              disabled={!q.answered}
            >
              <option value="">—</option>
              {liveOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.text}</option>
              ))}
            </Select>
          </span>
        )}
      </div>

      {c.mode === 'takeOut' && (
        <div className="mt-2 rounded border border-border bg-sunken/40 p-2.5">
          <div className="mb-1 text-xs font-medium text-fg-muted">Take out</div>
          <div className="flex flex-wrap gap-1.5">
            {picks.map((p) => {
              const k = pickKey(p);
              const on = (c.take || []).includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setChoice(q.key, { ...c, take: on ? c.take.filter((x) => x !== k) : [...(c.take || []), k] })
                  }
                  className={[
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    on ? 'border-brand-accent bg-brand-tint text-brand-tint-fg' : 'border-border bg-card text-fg-muted hover:bg-sunken',
                  ].join(' ')}
                >
                  {on ? '✓ ' : ''}
                  {p.legacy ? `old answer: “${p.label}”` : p.label} {p.count.toLocaleString()}
                </button>
              );
            })}
          </div>
          {!q.retired && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              Replace them with
              <Select value={c.replaceWith || ''} onChange={(e) => setChoice(q.key, { ...c, replaceWith: e.target.value })} className="w-48">
                <option value="">none</option>
                {liveOptions
                  .filter((o) => o.id !== OTHER_OPTION_ID && !(c.take || []).includes(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>{o.text}</option>
                  ))}
              </Select>
              <span className="text-fg-subtle">(only on surveys that lose a pick)</span>
            </div>
          )}
          {(c.take || []).length > 0 && (
            <p className="mt-2 text-xs text-fg-muted">
              A survey left with no picks reads exactly as if the question was skipped.
              {picks.filter((p) => !(c.take || []).includes(pickKey(p))).length > 0 &&
                ` ${picks
                  .filter((p) => !(c.take || []).includes(pickKey(p)))
                  .map((p) => pickLabel(q, pickKey(p)))
                  .join(', ')} stays on the surveys that have it.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const AnswerEditForm = ({ dry, answerFilters, form, setForm, mode, setMode, busy, error, onCancel, onReview, onStart, onChooseSurvey }) => {
  const [retiredOpen, setRetiredOpen] = useState(false);
  const questions = dry.questions || [];
  const live = questions.filter((q) => !q.retired);
  const retired = questions.filter((q) => q.retired);
  const suggestions = suggestedTakeOut(questions, answerFilters);
  const setChoice = (key, choice) => setForm({ ...form, [key]: choice });
  const filtered = (answerFilters || []).length > 0;
  const total = dry.responses || 0;
  const reviewable = canReview(questions, form);

  return (
    <Modal
      onClose={onCancel}
      title="Edit survey answers"
      subtitle={`${total.toLocaleString()} ${total === 1 ? 'survey' : 'surveys'} ${filtered ? 'matched your filter' : ''} at the ${dry.entries.toLocaleString()} ${dry.entries === 1 ? 'entry' : 'entries'} you selected`}
      size="2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          {mode === 'queue' ? (
            <Button onClick={onStart} disabled={busy || !total || dry.limits?.tooManyForQueue}>{busy ? 'Starting…' : 'Start'}</Button>
          ) : (
            <Button onClick={onReview} disabled={busy || !reviewable || dry.limits?.tooMany}>{busy ? 'Checking…' : 'Review changes'}</Button>
          )}
        </>
      }
    >
      <div className="mb-3 text-sm text-fg">
        <div className="text-fg-muted">
          {dry.template?.name || 'Survey'}
          {dry.scopeSummary ? ` · Filtered to: ${dry.scopeSummary}` : ''}
        </div>
        {dry.notMatched > 0 && (
          <div className="mt-1 text-fg-muted">
            {dry.notMatched.toLocaleString()} other {dry.notMatched === 1 ? 'person' : 'people'} surveyed at these
            visits didn&rsquo;t match and stay as they are.
          </div>
        )}
        {(dry.surveys || []).length > 1 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-fg-muted">
            These entries hold answers from {dry.surveys.length} surveys. Edit answers from:
            <Select value={dry.template?.id || ''} onChange={(e) => onChooseSurvey(e.target.value)} className="w-64">
              {dry.surveys.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.responses.toLocaleString()})</option>
              ))}
            </Select>
          </div>
        )}
        {dry.heldByRuns > 0 && (
          <div className="mt-1 text-xs text-fg-muted">
            {dry.heldByRuns.toLocaleString()} {dry.heldByRuns === 1 ? 'entry' : 'entries'} an earlier change converted
            {dry.heldByRuns === 1 ? ' isn’t' : ' aren’t'} included — undo that change first, or edit those surveys on the
            voter&rsquo;s profile.
          </div>
        )}
        {dry.limits?.tooMany && (
          <div className="mt-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            That&rsquo;s more than {dry.limits.maxResponses.toLocaleString()} surveys — narrow the selection first.
          </div>
        )}
      </div>

      <p className="mb-3 text-sm text-fg">
        Pick what to change. Every other answer, the note and the knock itself stay exactly as recorded, and
        these voters stay surveyed.
      </p>

      <div className="mb-2 flex flex-wrap gap-4">
        <Radio name="ae-mode" checked={mode === 'bulk'} onChange={() => setMode('bulk')}>Same change for everyone</Radio>
        <Radio name="ae-mode" checked={mode === 'queue'} onChange={() => setMode('queue')} disabled={dry.limits?.tooManyForQueue}>
          One person at a time
        </Radio>
      </div>
      {mode === 'queue' && (
        <p className="mb-2 text-xs text-fg-muted">
          {dry.limits?.tooManyForQueue
            ? `One person at a time takes up to ${dry.limits.maxQueue.toLocaleString()} surveys — narrow the selection, or use the same change for everyone.`
            : 'Each survey opens with its recorded answers; you fix what’s wrong and move on. The whole session undoes as one change.'}
        </p>
      )}

      {mode === 'bulk' && (
        <>
          {live.map((q, i) => (
            <QuestionBlock
              key={q.key}
              q={q}
              number={i + 1}
              total={total}
              form={form}
              setChoice={setChoice}
              questions={questions}
              suggestion={suggestions.find((s) => s.questionKey === q.key)}
            />
          ))}
          {retired.length > 0 && (
            <div className="mt-2">
              <button type="button" className="text-sm font-medium text-fg-muted" aria-expanded={retiredOpen} onClick={() => setRetiredOpen((o) => !o)}>
                {retiredOpen ? '▾' : '▸'} Retired questions ({retired.length})
              </button>
              {retiredOpen &&
                retired.map((q) => (
                  <QuestionBlock key={q.key} q={q} number={null} total={total} form={form} setChoice={setChoice} questions={questions} suggestion={null} />
                ))}
            </div>
          )}
        </>
      )}

      {error && <p className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
    </Modal>
  );
};

export default AnswerEditForm;
