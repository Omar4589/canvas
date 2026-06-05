import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

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
  return {
    key: '',
    label: '',
    type: 'single_choice',
    options: ['', ''],
    required: false,
    order: 0,
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

function OptionRow({ index, value, onChange, onRemove, canRemove, locked }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-right text-xs font-medium text-fg-subtle">
        {index + 1}.
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={locked}
        placeholder={`Option ${index + 1}`}
        className={
          'flex-1 rounded border border-border-strong px-3 py-2 text-sm focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ' +
          (locked ? 'bg-sunken text-fg-muted' : '')
        }
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove || locked}
        className="rounded p-2 text-fg-subtle hover:bg-danger-tint hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-subtle"
        title={locked ? 'Locked — survey has responses' : 'Remove option'}
      >
        ×
      </button>
    </div>
  );
}

function QuestionCard({
  index,
  total,
  value,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  locked = false,
  lockedOptionCount = 0,
}) {
  const isChoice = value.type === 'single_choice' || value.type === 'multiple_choice';

  function updateOption(optIdx, next) {
    const options = value.options.slice();
    options[optIdx] = next;
    onChange({ ...value, options });
  }

  function addOption() {
    onChange({ ...value, options: [...value.options, ''] });
  }

  function removeOption(optIdx) {
    onChange({ ...value, options: value.options.filter((_, i) => i !== optIdx) });
  }

  function setType(t) {
    if (t === 'text') {
      onChange({ ...value, type: t, options: [] });
    } else if (!isChoice) {
      // switching from text -> choice, give them two starter slots
      onChange({ ...value, type: t, options: ['', ''] });
    } else {
      onChange({ ...value, type: t });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border bg-sunken px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="rounded bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
            Q{index + 1}
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
            disabled={locked}
            className="ml-2 rounded px-2 py-1 text-xs text-danger hover:bg-danger-tint disabled:cursor-not-allowed disabled:text-fg-subtle disabled:hover:bg-transparent"
            title={locked ? 'Locked — survey has responses (Duplicate to remove)' : 'Remove question'}
          >
            Remove
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
            className="w-full rounded border border-border-strong px-3 py-2 text-base focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">
              Type
            </label>
            <TypePills value={value.type} onChange={setType} disabled={locked} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded border border-border bg-sunken px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={value.required}
              onChange={(e) => onChange({ ...value, required: e.target.checked })}
            />
            Required
          </label>
        </div>

        {isChoice && (
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-fg-muted">
              Answer options
            </label>
            <div className="space-y-2">
              {value.options.map((opt, i) => (
                <OptionRow
                  key={i}
                  index={i}
                  value={opt}
                  onChange={(v) => updateOption(i, v)}
                  onRemove={() => removeOption(i)}
                  canRemove={value.options.length > 1}
                  locked={locked && i < lockedOptionCount}
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
          </div>
        )}
      </div>
    </div>
  );
}

function SurveyForm({ initial, onSave, onCancel, saving }) {
  const [name, setName] = useState(initial?.name || '');
  const [intro, setIntro] = useState(initial?.intro || '');
  const [closing, setClosing] = useState(initial?.closing || '');
  const [questions, setQuestions] = useState(initial?.questions || []);

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
    setQuestions((prev) => prev.map((p, i) => (i === index ? q : p)));
  }

  function removeQuestion(index) {
    setQuestions((prev) => reorder(prev.filter((_, i) => i !== index)));
  }

  function addQuestion() {
    setQuestions((prev) => reorder([...prev, blankQuestion()]));
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

  function submit(e) {
    e.preventDefault();
    const cleaned = questions.map((q, i, all) => {
      const key = q.key && q.key.trim() ? q.key : deriveKey(q, i, all);
      const isChoice = q.type === 'single_choice' || q.type === 'multiple_choice';
      const options = isChoice
        ? q.options.map((o) => o.trim()).filter(Boolean)
        : [];
      return { ...q, key, options };
    });
    onSave({ name, intro, closing, questions: reorder(cleaned) });
  }

  return (
    <form onSubmit={submit} className="space-y-6 pb-24">
      {locked && (
        <div className="rounded-lg border-l-4 border-warning/40 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <p className="font-medium">
            This survey has {initial.responseCount} response
            {initial.responseCount === 1 ? '' : 's'} — question structure is locked to protect existing
            reports.
          </p>
          <p className="mt-1 text-warning-fg">
            You can still rename it, edit the greeting/closing, reword a question, toggle Required,
            reorder, add new questions, and add new options. To remove a question or option, change a
            question's type, or rename an option, use <strong>Duplicate</strong> from the survey list to
            edit a fresh copy.
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
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Scott Berger Door-to-Door Survey"
            className="w-full rounded border border-border-strong px-3 py-2 text-sm focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <p className="mt-2 text-xs text-fg-muted">
            Surveys are linked to campaigns on the Campaigns page.
          </p>
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
          className="w-full rounded border border-border-strong px-3 py-2 text-sm leading-relaxed focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
        <div className="space-y-3">
          {questions.map((q, i) => {
            const original = originalByKey.get(q.key);
            return (
              <QuestionCard
                key={i}
                index={i}
                total={questions.length}
                value={q}
                onChange={(next) => updateQuestion(i, next)}
                onRemove={() => removeQuestion(i)}
                onMoveUp={() => move(i, -1)}
                onMoveDown={() => move(i, 1)}
                locked={locked && !!original}
                lockedOptionCount={original?.options?.length || 0}
              />
            );
          })}
          {!questions.length && (
            <div className="rounded-lg border-2 border-dashed border-border bg-card px-4 py-10 text-center text-sm text-fg-muted">
              No questions yet. Add your first one below.
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
          className="w-full rounded border border-border-strong px-3 py-2 text-sm leading-relaxed focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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

export default function SurveysPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['surveys'],
    queryFn: () => api('/admin/surveys'),
  });
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);

  const surveys = data?.surveys || [];
  const selected = surveys.find((s) => s._id === selectedId) || null;

  const create = useMutation({
    mutationFn: (body) => api('/admin/surveys', { method: 'POST', body }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      setCreating(false);
      setSelectedId(res.survey._id);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }) => api(`/admin/surveys/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['surveys'] }),
  });

  const duplicate = useMutation({
    mutationFn: (id) => api(`/admin/surveys/${id}/duplicate`, { method: 'POST' }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['surveys'] });
      setCreating(false);
      setSelectedId(res.survey._id);
    },
  });

  const isEditing = creating || !!selected;

  function closeEditor() {
    setCreating(false);
    setSelectedId(null);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Surveys</h1>
        {!isEditing && (
          <button
            onClick={() => {
              setSelectedId(null);
              setCreating(true);
            }}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            + New survey
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-fg-muted">Loading…</div>
      ) : !isEditing ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Used by campaigns</th>
                <th className="px-4 py-3 text-right">Questions</th>
                <th className="px-4 py-3 text-right">Responses</th>
                <th className="px-4 py-3 text-right">Version</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {surveys.map((s) => (
                <tr key={s._id} className="border-t border-border hover:bg-sunken">
                  <td className="px-4 py-3 font-medium text-fg">{s.name}</td>
                  <td className="px-4 py-3 text-fg-muted">
                    {s.usedByCampaigns?.length
                      ? s.usedByCampaigns.map((c) => c.name).join(', ')
                      : <span className="text-fg-subtle">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">{s.questions?.length || 0}</td>
                  <td className="px-4 py-3 text-right text-fg-muted">
                    {s.responseCount > 0 ? (
                      <span title="Editing question structure is locked while responses exist">
                        {s.responseCount.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-fg-muted">v{s.version || 1}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => setSelectedId(s._id)}
                        className="text-xs font-medium text-brand-accent hover:underline"
                      >
                        {s.responseCount > 0 ? 'View / edit' : 'Edit'}
                      </button>
                      <button
                        onClick={() => duplicate.mutate(s._id)}
                        disabled={duplicate.isPending}
                        className="text-xs font-medium text-fg-muted hover:underline disabled:opacity-50"
                      >
                        Duplicate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!surveys.length && (
                <tr>
                  <td colSpan="6" className="px-4 py-10 text-center text-fg-muted">
                    No surveys yet. Click <strong>New survey</strong> to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <button
            onClick={closeEditor}
            className="mb-4 text-sm text-brand-accent hover:underline"
          >
            ← Back to list
          </button>

          {creating ? (
            <SurveyForm
              initial={{ name: '', intro: '', closing: '', questions: [] }}
              onSave={(body) => create.mutate(body)}
              onCancel={closeEditor}
              saving={create.isPending}
            />
          ) : (
            <SurveyForm
              initial={selected}
              onSave={(body) => update.mutate({ id: selected._id, body })}
              onCancel={closeEditor}
              saving={update.isPending}
            />
          )}
          {(create.error || update.error) && (
            <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
              <p>{(create.error || update.error).message}</p>
              {(update.error?.data?.reasons?.length > 0) && (
                <ul className="mt-1 list-inside list-disc text-danger">
                  {update.error.data.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
