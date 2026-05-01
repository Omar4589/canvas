import { useEffect, useState } from 'react';
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

function TypePills({ value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-gray-300 bg-gray-50 p-0.5">
      {QUESTION_TYPES.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={
              'rounded px-3 py-1.5 text-xs font-medium transition ' +
              (active
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900')
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function OptionRow({ index, value, onChange, onRemove, canRemove }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-right text-xs font-medium text-gray-400">
        {index + 1}.
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Option ${index + 1}`}
        className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="rounded p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
        title="Remove option"
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
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="rounded bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
            Q{index + 1}
          </span>
          <span className="text-xs text-gray-500">
            {QUESTION_TYPES.find((t) => t.value === value.type)?.hint}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-white hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-transparent"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-white hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-transparent"
            title="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="ml-2 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Question
          </label>
          <input
            value={value.label}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            placeholder="What is your top issue?"
            className="w-full rounded border border-gray-300 px-3 py-2 text-base focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Type
            </label>
            <TypePills value={value.type} onChange={setType} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
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
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">
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
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addOption}
              className="mt-3 inline-flex items-center gap-1 rounded border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-brand-600 hover:text-brand-700"
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
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Survey settings
        </h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Survey name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Scott Berger Door-to-Door Survey"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
          <p className="mt-2 text-xs text-gray-500">
            Surveys are linked to campaigns on the Campaigns page.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Greeting
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          Shown to canvassers at the top of the survey. This is the script they read at the door.
        </p>
        <textarea
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          rows={4}
          placeholder="Hi, I'm out talking with voters today on behalf of…"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
        />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Questions
          </h2>
          <span className="text-xs text-gray-500">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </span>
        </div>
        <div className="space-y-3">
          {questions.map((q, i) => (
            <QuestionCard
              key={i}
              index={i}
              total={questions.length}
              value={q}
              onChange={(next) => updateQuestion(i, next)}
              onRemove={() => removeQuestion(i)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
            />
          ))}
          {!questions.length && (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
              No questions yet. Add your first one below.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={addQuestion}
          className="mt-3 w-full rounded-lg border-2 border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-600 hover:border-brand-600 hover:bg-brand-50 hover:text-brand-700"
        >
          + Add question
        </button>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Closing
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          Optional sign-off line shown to canvassers after the last question.
        </p>
        <textarea
          value={closing}
          onChange={(e) => setClosing(e.target.value)}
          rows={3}
          placeholder="Thanks so much for your time. Have a great day!"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
        />
      </section>

      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white px-6 py-3 shadow-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
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
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + New survey
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : !isEditing ? (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Used by campaigns</th>
                <th className="px-4 py-3 text-right">Questions</th>
                <th className="px-4 py-3 text-right">Version</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {surveys.map((s) => (
                <tr key={s._id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {s.usedByCampaigns?.length
                      ? s.usedByCampaigns.map((c) => c.name).join(', ')
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">{s.questions?.length || 0}</td>
                  <td className="px-4 py-3 text-right text-gray-500">v{s.version || 1}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedId(s._id)}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!surveys.length && (
                <tr>
                  <td colSpan="5" className="px-4 py-10 text-center text-gray-500">
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
            className="mb-4 text-sm text-brand-700 hover:underline"
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
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {(create.error || update.error).message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
