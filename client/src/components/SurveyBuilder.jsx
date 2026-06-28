import { useEffect, useMemo, useState } from 'react';
import TagPicker from './TagPicker.jsx';
import InfoHint from './InfoHint.jsx';

const QUESTION_TYPES = [
  { value: 'single_choice', label: 'Single choice', hint: 'Pick one' },
  { value: 'multiple_choice', label: 'Multiple choice', hint: 'Pick many' },
  { value: 'text', label: 'Free text', hint: 'Type a response' },
];

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function blankQuestion() {
  const used = new Set();
  return {
    key: '',
    label: '',
    type: 'single_choice',
    options: [{ id: optionId('', used), text: '' }, { id: optionId('', used), text: '' }],
    required: false,
    order: 0,
    retired: false,
    visibleIf: null, // Phase 2 (conditional display)
    otherOption: false,
    refusalOption: false,
  };
}

function reorder(qs) {
  return qs.map((q, i) => ({ ...q, order: i + 1 }));
}

function deriveKey(q, index, allQuestions) {
  const base = slugify(q.label) || `question_${index + 1}`;
  let key = base;
  let n = 2;
  while (allQuestions.some((other, i) => i !== index && other.key === key)) {
    key = `${base}_${n++}`;
  }
  return key;
}

// Mint a stable, unique-within-question option id (slug of text, else 'opt', with a
// numeric suffix on collision). New options get one at add-time so conditions can
// reference them before the survey is first saved; the server preserves sent ids.
function optionId(text, used) {
  const base = slugify(text) || 'opt';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

// Validate one question's visibleIf against the questions BEFORE it. Returns an
// error string (shown live + on save) or null. Conditions may only reference an
// earlier, keyed, non-retired question; the op must fit that question's type; and
// is/is_not target exactly one existing option, any_of at least one (retired ids +
// '__other__' allowed when that question enables Other).
function ruleError(q, index, questions) {
  const vi = q.visibleIf;
  if (!vi || !(vi.rules || []).length) return null;
  const earlier = new Map(
    questions.slice(0, index).filter((x) => !x.retired && x.key).map((x) => [x.key, x])
  );
  for (const r of vi.rules) {
    const refQ = earlier.get(r.questionKey);
    if (!refQ) return 'A condition references a question that does not come before this one.';
    const validOps = refQ.type === 'text'
      ? ['answered', 'not_answered']
      : ['is', 'is_not', 'any_of', 'answered', 'not_answered'];
    if (!validOps.includes(r.op)) return `A condition uses an operator that doesn’t fit “${refQ.label || 'that question'}”.`;
    if (r.op === 'is' || r.op === 'is_not' || r.op === 'any_of') {
      const ids = r.optionIds || [];
      if (!ids.length) return 'A condition is missing its answer selection.';
      if ((r.op === 'is' || r.op === 'is_not') && ids.length !== 1) return 'A condition should target exactly one answer.';
      const valid = new Set([
        ...(refQ.options || []).map((o) => o.id),
        ...(refQ.otherOption ? ['__other__'] : []),
      ]);
      if (!ids.every((id) => valid.has(id))) return 'A condition points at an answer that no longer exists.';
    }
  }
  return null;
}

function TypePills({ value, onChange, disabled }) {
  return (
    <div className="inline-flex rounded-md border border-border-strong bg-sunken p-0.5">
      {QUESTION_TYPES.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            disabled={disabled && !active}
            className={
              'rounded px-3 py-1.5 text-xs font-medium transition ' +
              (active
                ? 'bg-card text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-fg-muted')
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function OptionRow({ index, value, onChange, onRemove, tags = [], onCreateTag }) {
  const retired = !!value.retired;
  const [showScript, setShowScript] = useState(!!value.script);
  const [showTag, setShowTag] = useState(!!value.tag);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="w-6 text-right text-xs font-medium text-fg-subtle">{index + 1}.</span>
        <input
          value={value.text || ''}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          readOnly={retired}
          placeholder={`Option ${index + 1}`}
          className={
            'flex-1 rounded border border-border-strong px-3 py-2 text-sm placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ' +
            (retired ? 'bg-sunken text-fg-subtle line-through' : 'bg-card text-fg')
          }
        />
        {retired ? (
          <button
            type="button"
            onClick={() => onChange({ ...value, retired: false })}
            className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-brand-accent hover:bg-brand-tint"
            title="Restore option"
          >
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-2 text-fg-subtle hover:bg-danger-tint hover:text-danger"
            title="Remove / retire option"
          >
            ×
          </button>
        )}
      </div>
      {!retired && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8">
          {showScript || value.script ? null : (
            <button
              type="button"
              onClick={() => setShowScript(true)}
              className="text-[11px] text-fg-subtle hover:text-brand-accent"
            >
              + read-aloud script
            </button>
          )}
          {showTag || value.tag ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Tag</span>
              <InfoHint label="What are tags?">
                <b>Optional.</b> Tag an answer — like “Supporter” — so reports roll up everyone who picked
                it across questions, and you can build or export voter lists by tag. Pick an existing tag
                from your org or create a new one; manage them all on the <b>Tags</b> page.
              </InfoHint>
              <TagPicker
                value={value.tag || ''}
                onChange={(name) => onChange({ ...value, tag: name })}
                tags={tags}
                onCreate={onCreateTag}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowTag(true)}
              className="text-[11px] text-fg-subtle hover:text-brand-accent"
            >
              + tag
            </button>
          )}
        </div>
      )}
      {!retired && (showScript || value.script) && (
        <div className="pl-8">
          <textarea
            value={value.script || ''}
            onChange={(e) => onChange({ ...value, script: e.target.value })}
            rows={2}
            placeholder="Read aloud when this answer is picked (optional)"
            className="w-full rounded border border-border-strong bg-card px-2 py-1.5 text-xs leading-relaxed text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
      )}
    </div>
  );
}

const OPS = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'any_of', label: 'is any of' },
  { value: 'answered', label: 'is answered' },
  { value: 'not_answered', label: 'is not answered' },
];

function opsForType(type) {
  return type === 'text' ? OPS.filter((o) => o.value === 'answered' || o.value === 'not_answered') : OPS;
}

function starterRule(priorQuestions) {
  const q = priorQuestions[0];
  return { questionKey: q.key, op: q.type === 'text' ? 'answered' : 'is', optionIds: [] };
}

// Per-question "Show only if…" editor. Rules may reference only EARLIER keyed
// questions (acyclic by construction). For is/is_not/any_of it resolves the
// referenced question's current options (+ "Other" when enabled) as pickable
// targets, writing stable option ids into the rule.
function ConditionEditor({ value, onChange, priorQuestions }) {
  const byKey = new Map(priorQuestions.map((q) => [q.key, q]));
  const selectCls =
    'rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg focus:border-brand-accent focus:outline-none';

  if (!value) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!priorQuestions.length}
          onClick={() => onChange({ logic: 'all', rules: [starterRule(priorQuestions)] })}
          className="inline-flex items-center gap-1 rounded border border-dashed border-border-strong px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-brand-600 hover:text-brand-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-strong disabled:hover:text-fg-muted"
        >
          + Show only if…
        </button>
        {!priorQuestions.length && (
          <span className="text-[11px] text-fg-subtle">Conditions can only reference earlier questions.</span>
        )}
      </div>
    );
  }

  const rules = value.rules || [];
  const setRule = (idx, next) => onChange({ ...value, rules: rules.map((r, i) => (i === idx ? next : r)) });
  const addRule = () => onChange({ ...value, rules: [...rules, starterRule(priorQuestions)] });
  const removeRule = (idx) => {
    const next = rules.filter((_, i) => i !== idx);
    onChange(next.length ? { ...value, rules: next } : null);
  };

  return (
    <div className="rounded-md border border-border bg-sunken p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Shown only if</span>
        <button type="button" onClick={() => onChange(null)} className="text-[11px] text-fg-subtle hover:text-danger">
          Remove condition
        </button>
      </div>

      {rules.length > 1 && (
        <div className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
          Match
          <select value={value.logic} onChange={(e) => onChange({ ...value, logic: e.target.value })} className={selectCls}>
            <option value="all">ALL</option>
            <option value="any">ANY</option>
          </select>
          of these rules
        </div>
      )}

      <div className="space-y-2">
        {rules.map((r, i) => {
          const refQ = byKey.get(r.questionKey);
          const needsOptions = r.op === 'is' || r.op === 'is_not' || r.op === 'any_of';
          const single = r.op === 'is' || r.op === 'is_not';
          const opts = refQ
            ? [
                ...(refQ.options || []).filter((o) => !o.retired),
                ...(refQ.otherOption ? [{ id: '__other__', text: 'Other (specify)' }] : []),
              ]
            : [];
          return (
            <div key={i} className="rounded border border-border bg-card p-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={r.questionKey}
                  onChange={(e) => {
                    const nq = byKey.get(e.target.value);
                    setRule(i, { questionKey: e.target.value, op: nq && nq.type === 'text' ? 'answered' : 'is', optionIds: [] });
                  }}
                  className={selectCls}
                >
                  {priorQuestions.map((q) => (
                    <option key={q.key} value={q.key}>
                      {q.label || '(untitled)'}
                    </option>
                  ))}
                </select>
                <select
                  value={r.op}
                  onChange={(e) => {
                    const op = e.target.value;
                    const optionIds = op === 'is' || op === 'is_not' ? (r.optionIds || []).slice(0, 1) : r.optionIds || [];
                    setRule(i, { ...r, op, optionIds });
                  }}
                  className={selectCls}
                >
                  {opsForType(refQ?.type).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  className="ml-auto rounded p-1 text-fg-subtle hover:bg-danger-tint hover:text-danger"
                  title="Remove rule"
                >
                  ×
                </button>
              </div>
              {needsOptions && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {opts.map((o) => {
                    const on = (r.optionIds || []).includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() =>
                          setRule(i, {
                            ...r,
                            optionIds: single
                              ? [o.id]
                              : on
                                ? r.optionIds.filter((x) => x !== o.id)
                                : [...(r.optionIds || []), o.id],
                          })
                        }
                        className={
                          'rounded-full px-2.5 py-1 text-xs transition-colors ' +
                          (on ? 'bg-brand-600 text-white' : 'border border-border bg-card text-fg-muted hover:bg-sunken')
                        }
                      >
                        {o.text || '(untitled)'}
                      </button>
                    );
                  })}
                  {!opts.length && <span className="text-[11px] text-fg-subtle">That question has no options to match.</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" onClick={addRule} className="mt-2 text-[11px] font-medium text-brand-accent hover:underline">
        + Add rule
      </button>
    </div>
  );
}

function QuestionCard({ index, displayNum, total, value, onChange, onRemove, onMoveUp, onMoveDown, hasResponses = false, priorQuestions = [], tags = [], onCreateTag, error }) {
  const isChoice = value.type === 'single_choice' || value.type === 'multiple_choice';

  function updateOption(optIdx, next) {
    const options = value.options.slice();
    options[optIdx] = next;
    onChange({ ...value, options });
  }

  function addOption() {
    const used = new Set(value.options.map((o) => o.id).filter(Boolean));
    onChange({ ...value, options: [...value.options, { id: optionId('', used), text: '' }] });
  }

  function removeOption(optIdx) {
    const o = value.options[optIdx];
    if (hasResponses && o.id) {
      // Soft-retire an existing option — kept so its past answers still report.
      const options = value.options.slice();
      options[optIdx] = { ...o, retired: true };
      onChange({ ...value, options });
    } else {
      onChange({ ...value, options: value.options.filter((_, i) => i !== optIdx) });
    }
  }

  function setType(t) {
    if (t === 'text') onChange({ ...value, type: t, options: [] });
    else if (!isChoice) {
      const used = new Set();
      onChange({ ...value, type: t, options: [{ id: optionId('', used), text: '' }, { id: optionId('', used), text: '' }] });
    } else onChange({ ...value, type: t });
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border bg-sunken px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="rounded bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
            Q{displayNum ?? index + 1}
          </span>
          <span className="text-xs text-fg-muted">
            {QUESTION_TYPES.find((t) => t.value === value.type)?.hint}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded px-2 py-1 text-sm text-fg-muted hover:bg-card hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded px-2 py-1 text-sm text-fg-muted hover:bg-card hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
            title="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="ml-2 rounded px-2 py-1 text-xs text-danger hover:bg-danger-tint"
            title={hasResponses ? 'Retire question — kept for reports' : 'Remove question'}
          >
            {hasResponses ? 'Retire' : 'Remove'}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">
            Question
          </label>
          <input
            value={value.label}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            placeholder="What is your top issue?"
            className={`w-full rounded border bg-card px-3 py-2 text-base text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${error?.label ? 'border-danger' : 'border-border-strong focus:border-brand-accent'}`}
          />
          {error?.label && <p className="mt-1 text-xs text-danger">{error.label}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">
              Type
            </label>
            <TypePills value={value.type} onChange={setType} disabled={hasResponses} />
            {hasResponses && (
              <p className="mt-1 text-[11px] text-fg-subtle">Type is locked once there are responses — Duplicate to change it.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded border border-border bg-sunken px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={value.required}
                onChange={(e) => onChange({ ...value, required: e.target.checked })}
              />
              Required
            </label>
            {isChoice && (
              <label className="flex cursor-pointer items-center gap-2 rounded border border-border bg-sunken px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!value.otherOption}
                  onChange={(e) => onChange({ ...value, otherOption: e.target.checked })}
                />
                Other (specify)
              </label>
            )}
          </div>
        </div>

        {isChoice && (
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-fg-muted">
              Answer options
            </label>
            <div className="space-y-2">
              {value.options.map((opt, i) => (
                <OptionRow
                  key={opt.id || i}
                  index={i}
                  value={opt}
                  onChange={(v) => updateOption(i, v)}
                  onRemove={() => removeOption(i)}
                  tags={tags}
                  onCreateTag={onCreateTag}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addOption}
              className="mt-3 inline-flex items-center gap-1 rounded border border-dashed border-border-strong px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-brand-600 hover:text-brand-accent"
            >
              + Add option
            </button>
            {error?.options && <p className="mt-2 text-xs text-danger">{error.options}</p>}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">
            Conditional display
          </label>
          <ConditionEditor
            value={value.visibleIf}
            onChange={(vi) => onChange({ ...value, visibleIf: vi })}
            priorQuestions={priorQuestions}
          />
          {error?.condition && <p className="mt-1 text-xs text-danger">{error.condition}</p>}
        </div>
      </div>
    </div>
  );
}

function SurveyForm({ initial, onSave, onCancel, saving, orgTags = [], onCreateTag }) {
  const [name, setName] = useState(initial?.name || '');
  const [intro, setIntro] = useState(initial?.intro || '');
  const [closing, setClosing] = useState(initial?.closing || '');
  const [questions, setQuestions] = useState(initial?.questions || []);
  const [errors, setErrors] = useState({ questions: {} });

  useEffect(() => {
    setName(initial?.name || '');
    setIntro(initial?.intro || '');
    setClosing(initial?.closing || '');
    setQuestions(initial?.questions || []);
  }, [initial?._id]);

  // Once responses exist, the existing question structure is locked to protect
  // reports (mirrors the server guard). Safe edits stay open: rename, greeting/
  // closing, label/required, reorder, ADD questions, ADD options. Destructive
  // ones (remove question/option, rename option, change type) are locked per
  // existing question; brand-new questions added here are fully editable.
  const locked = !!initial?.hasResponses;
  const originalByKey = useMemo(() => {
    const m = new Map();
    if (initial?.hasResponses) {
      for (const q of initial.questions || []) m.set(q.key, q);
    }
    return m;
  }, [initial?._id]);

  function updateQuestion(index, q) {
    setQuestions((prev) =>
      prev.map((p, i) => {
        if (i !== index) return p;
        // Mint the stable question key the first time it gets a label, then keep it
        // immutable — conditions reference questions by key, so it can't churn.
        if (!q.key && (q.label || '').trim()) return { ...q, key: deriveKey(q, index, prev) };
        return q;
      })
    );
    if (errors.questions[index]) {
      setErrors((p) => {
        const nq = { ...p.questions };
        delete nq[index];
        return { ...p, questions: nq };
      });
    }
  }

  function removeQuestion(index) {
    setQuestions((prev) => {
      const q = prev[index];
      if (initial?.hasResponses && q?.key) {
        // Soft-retire an existing question — kept so its past answers still report.
        return prev.map((p, i) => (i === index ? { ...p, retired: true } : p));
      }
      return reorder(prev.filter((_, i) => i !== index));
    });
  }

  function addQuestion() {
    setQuestions((prev) => reorder([...prev, blankQuestion()]));
    if (errors.noQuestions) setErrors((p) => ({ ...p, noQuestions: undefined }));
  }

  function move(index, delta) {
    setQuestions((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return reorder(next);
    });
  }

  function validate() {
    const e = { questions: {} };
    if (!name.trim()) e.name = 'Give your survey a name.';
    if (!questions.length) e.noQuestions = 'Add at least one question before saving.';
    questions.forEach((q, i) => {
      if (q.retired) return; // retired questions are kept for reports, not edited
      const qe = {};
      if (!q.label.trim()) qe.label = 'This question needs a label.';
      const isChoice = q.type === 'single_choice' || q.type === 'multiple_choice';
      if (isChoice && !(q.options || []).some((o) => !o.retired && (o.text || '').trim()))
        qe.options = 'Add at least one answer option.';
      const ce = ruleError(q, i, questions);
      if (ce) qe.condition = ce;
      if (Object.keys(qe).length) e.questions[i] = qe;
    });
    return e;
  }

  function submit(e) {
    e.preventDefault();
    const v = validate();
    if (v.name || v.noQuestions || Object.keys(v.questions).length) {
      setErrors(v);
      return;
    }
    setErrors({ questions: {} });
    const cleaned = questions.map((q, i, all) => {
      const key = q.key && q.key.trim() ? q.key : deriveKey(q, i, all);
      const isChoice = q.type === 'single_choice' || q.type === 'multiple_choice';
      // Keep text-bearing + retired options; drop brand-new blank ones. Stable ids
      // (minted at add-time) round-trip untouched. Per-option scripts trim to null.
      const options = isChoice
        ? q.options
            .map((o) => ({
              ...o,
              text: (o.text || '').trim(),
              script: (o.script || '').trim() || null,
              tag: (o.tag || '').trim() || null,
            }))
            .filter((o) => o.text || o.retired)
        : [];
      const visibleIf = q.visibleIf && (q.visibleIf.rules || []).length ? q.visibleIf : null;
      return { ...q, key, options, visibleIf };
    });
    // The org Tag library is the managed picklist now, but each survey still
    // carries the distinct set of tags its options reference (server upserts
    // them by normalized name). Dedupe case-insensitively, first-casing wins.
    const seen = new Map();
    for (const q of cleaned) {
      for (const o of q.options || []) {
        const t = (o.tag || '').trim();
        if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
      }
    }
    onSave({ name, intro, closing, questions: reorder(cleaned), tags: Array.from(seen.values()) });
  }

  return (
    <form onSubmit={submit} className="space-y-6 pb-24">
      {locked && (
        <div className="rounded-lg border-l-4 border-warning/40 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <p className="font-medium">
            This survey has {initial.responseCount} response{initial.responseCount === 1 ? '' : 's'}.
          </p>
          <p className="mt-1 text-warning-fg">
            You can freely rename it, reword questions and options, reorder, add questions or options, and
            retire ones you no longer ask (retired items stay in your reports). The only change that needs a
            fresh copy is changing a question's <strong>type</strong> — use <strong>Duplicate</strong> from
            the survey list for that.
          </p>
        </div>
      )}
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Survey settings
        </h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">
            Survey name
          </label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((p) => ({ ...p, name: undefined })); }}
            placeholder="Scott Berger Door-to-Door Survey"
            className={`w-full rounded border bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${errors.name ? 'border-danger' : 'border-border-strong focus:border-brand-accent'}`}
          />
          {errors.name
            ? <p className="mt-1 text-xs text-danger">{errors.name}</p>
            : <p className="mt-2 text-xs text-fg-muted">Surveys are linked to campaigns on the Campaigns page.</p>}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Greeting
        </h2>
        <p className="mb-3 text-xs text-fg-muted">
          Shown to canvassers at the top of the survey. This is the script they read at the door.
        </p>
        <textarea
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          rows={4}
          placeholder="Hi, I'm out talking with voters today on behalf of…"
          className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Questions
          </h2>
          <span className="text-xs text-fg-muted">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </span>
        </div>
        <p className="-mt-1 mb-3 text-xs text-fg-muted">
          Each answer can carry an optional <strong>tag</strong> (like “Supporter”) to group answers across
          questions in reports and build lists by tag.{' '}
          <a href="/tags" target="_blank" rel="noopener" className="text-brand-accent hover:underline">
            Manage tags →
          </a>
        </p>
        <div className="space-y-3">
          {questions.map((q, i) => {
            if (q.retired) {
              return (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-dashed border-border bg-sunken px-4 py-2.5 text-sm text-fg-subtle"
                >
                  <span className="line-through">{q.label || 'Untitled question'}</span>
                  <button
                    type="button"
                    onClick={() => updateQuestion(i, { ...q, retired: false })}
                    className="rounded px-2 py-1 text-[11px] font-medium text-brand-accent hover:bg-brand-tint"
                  >
                    Restore
                  </button>
                </div>
              );
            }
            const displayNum = questions.slice(0, i).filter((x) => !x.retired).length + 1;
            const priorQuestions = questions.slice(0, i).filter((x) => !x.retired && x.key);
            const condition = ruleError(q, i, questions);
            return (
              <QuestionCard
                key={i}
                index={i}
                displayNum={displayNum}
                total={questions.length}
                value={q}
                onChange={(next) => updateQuestion(i, next)}
                onRemove={() => removeQuestion(i)}
                onMoveUp={() => move(i, -1)}
                onMoveDown={() => move(i, 1)}
                hasResponses={locked}
                priorQuestions={priorQuestions}
                tags={orgTags}
                onCreateTag={onCreateTag}
                error={{ ...(errors.questions[i] || {}), condition: errors.questions[i]?.condition || condition }}
              />
            );
          })}
          {!questions.length && (
            <div className={`rounded-lg border-2 border-dashed px-4 py-10 text-center text-sm ${errors.noQuestions ? 'border-danger text-danger' : 'border-border bg-card text-fg-muted'}`}>
              {errors.noQuestions || 'No questions yet. Add your first one below.'}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={addQuestion}
          className="mt-3 w-full rounded-lg border-2 border-dashed border-border-strong px-4 py-3 text-sm font-medium text-fg-muted hover:border-brand-600 hover:bg-brand-tint hover:text-brand-accent"
        >
          + Add question
        </button>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Closing
        </h2>
        <p className="mb-3 text-xs text-fg-muted">
          Optional sign-off line shown to canvassers after the last question.
        </p>
        <textarea
          value={closing}
          onChange={(e) => setClosing(e.target.value)}
          rows={3}
          placeholder="Thanks so much for your time. Have a great day!"
          className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </section>

      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card px-6 py-3 shadow-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-sunken"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save survey'}
          </button>
        </div>
      </div>
    </form>
  );
}

export default SurveyForm;
