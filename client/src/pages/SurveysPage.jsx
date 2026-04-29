import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

const QUESTION_TYPES = [
  { value: 'single_choice', label: 'Single choice' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'text', label: 'Free text' },
];

function blankQuestion() {
  return {
    key: '',
    label: '',
    type: 'single_choice',
    options: [],
    required: false,
    order: 0,
  };
}

function reorderKeys(qs) {
  return qs.map((q, i) => ({ ...q, order: i + 1 }));
}

function QuestionEditor({ value, onChange, onRemove, onMoveUp, onMoveDown, isFirst, isLast }) {
  const isChoice = value.type === 'single_choice' || value.type === 'multiple_choice';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className="rounded border border-gray-300 px-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className="rounded border border-gray-300 px-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30"
          >
            ↓
          </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-red-600 hover:underline"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700">Question label</label>
          <input
            value={value.label}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="What is your top issue?"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Key (slug)</label>
          <input
            value={value.key}
            onChange={(e) => onChange({ ...value, key: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
            placeholder="top_issue"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Type</label>
          <select
            value={value.type}
            onChange={(e) => onChange({ ...value, type: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center text-sm">
            <input
              type="checkbox"
              checked={value.required}
              onChange={(e) => onChange({ ...value, required: e.target.checked })}
              className="mr-2"
            />
            Required
          </label>
        </div>
      </div>

      {isChoice && (
        <div className="mt-3">
          <label className="block text-xs font-medium text-gray-700">
            Options (one per line)
          </label>
          <textarea
            value={value.options.join('\n')}
            onChange={(e) =>
              onChange({
                ...value,
                options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
              })
            }
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
            rows={Math.max(3, value.options.length + 1)}
            placeholder="Yes\nMaybe\nNo\nUndecided"
          />
        </div>
      )}
    </div>
  );
}

function SurveyForm({ initial, onSave, saving }) {
  const [name, setName] = useState(initial?.name || '');
  const [isActive, setIsActive] = useState(!!initial?.isActive);
  const [questions, setQuestions] = useState(initial?.questions || []);

  useEffect(() => {
    setName(initial?.name || '');
    setIsActive(!!initial?.isActive);
    setQuestions(initial?.questions || []);
  }, [initial?._id]);

  function updateQuestion(index, q) {
    setQuestions((prev) => prev.map((p, i) => (i === index ? q : p)));
  }

  function removeQuestion(index) {
    setQuestions((prev) => reorderKeys(prev.filter((_, i) => i !== index)));
  }

  function addQuestion() {
    setQuestions((prev) => reorderKeys([...prev, blankQuestion()]));
  }

  function move(index, delta) {
    setQuestions((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return reorderKeys(next);
    });
  }

  function submit(e) {
    e.preventDefault();
    onSave({ name, isActive, questions: reorderKeys(questions) });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700">Survey name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="mr-2"
              />
              Active (only one survey can be active)
            </label>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuestionEditor
            key={i}
            value={q}
            onChange={(next) => updateQuestion(i, next)}
            onRemove={() => removeQuestion(i)}
            onMoveUp={() => move(i, -1)}
            onMoveDown={() => move(i, 1)}
            isFirst={i === 0}
            isLast={i === questions.length - 1}
          />
        ))}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={addQuestion}
          className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          + Add question
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save survey'}
        </button>
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Surveys</h1>
        {!creating && (
          <button
            onClick={() => {
              setSelectedId(null);
              setCreating(true);
            }}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            New survey
          </button>
        )}
      </div>

      {isLoading ? (
        <div>Loading…</div>
      ) : !isEditing ? (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Active</th>
                <th className="px-4 py-2 text-right">Questions</th>
                <th className="px-4 py-2 text-right">Version</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {surveys.map((s) => (
                <tr key={s._id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{s.name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        s.isActive
                          ? 'rounded bg-green-100 px-2 py-0.5 text-xs text-green-700'
                          : 'rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600'
                      }
                    >
                      {s.isActive ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">{s.questions?.length || 0}</td>
                  <td className="px-4 py-2 text-right">{s.version || 1}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => setSelectedId(s._id)}
                      className="text-xs text-brand-700 hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!surveys.length && (
                <tr>
                  <td colSpan="5" className="px-4 py-6 text-center text-gray-500">
                    No surveys yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <button
            onClick={() => {
              setCreating(false);
              setSelectedId(null);
            }}
            className="mb-4 text-sm text-brand-700 hover:underline"
          >
            ← Back to list
          </button>

          {creating ? (
            <SurveyForm
              initial={{ name: '', isActive: false, questions: [] }}
              onSave={(body) => create.mutate(body)}
              saving={create.isPending}
            />
          ) : (
            <SurveyForm
              initial={selected}
              onSave={(body) => update.mutate({ id: selected._id, body })}
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
