import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function CampaignForm({ initial, surveys, onSave, onCancel, saving, error }) {
  const isEdit = !!initial?._id;
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'survey');
  const [state, setState] = useState(initial?.state || '');
  const [surveyTemplateId, setSurveyTemplateId] = useState(
    initial?.surveyTemplateId?._id || initial?.surveyTemplateId || ''
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  function submit(e) {
    e.preventDefault();
    onSave({
      name: name.trim(),
      type,
      state: state.trim().toUpperCase(),
      surveyTemplateId: type === 'survey' ? surveyTemplateId : null,
      isActive,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">
          Campaign name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Kentucky 2026"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Type</label>
          <div className="flex gap-2">
            {[
              { value: 'survey', label: 'Survey' },
              { value: 'lit_drop', label: 'Lit drop' },
            ].map((t) => (
              <label
                key={t.value}
                className={`flex flex-1 cursor-pointer items-center justify-center rounded border px-3 py-2 text-sm ${
                  type === t.value
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={t.value}
                  checked={type === t.value}
                  onChange={() => setType(t.value)}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            State (2-letter)
          </label>
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            required
            maxLength={2}
            placeholder="KY"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm uppercase focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
        </div>
      </div>

      {type === 'survey' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Survey template
          </label>
          <select
            value={surveyTemplateId}
            onChange={(e) => setSurveyTemplateId(e.target.value)}
            required
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          >
            <option value="">— Choose a survey —</option>
            {(surveys || []).map((s) => (
              <option key={s._id} value={s._id}>
                {s.name} (v{s.version || 1})
              </option>
            ))}
          </select>
          {!surveys?.length && (
            <p className="mt-1 text-xs text-gray-500">
              No surveys exist yet. Create one on the Surveys page first.
            </p>
          )}
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Active (visible to canvassers)
      </label>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create campaign'}
        </button>
      </div>
    </form>
  );
}

export default function CampaignsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });

  const surveysQ = useQuery({
    queryKey: ['admin', 'surveys'],
    queryFn: () => api('/admin/surveys'),
  });

  const create = useMutation({
    mutationFn: (body) => api('/admin/campaigns', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      setCreating(false);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, body }) =>
      api(`/admin/campaigns/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      setEditing(null);
    },
  });

  const campaigns = campaignsQ.data?.campaigns || [];
  const surveys = surveysQ.data?.surveys || [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        {!creating && !editing && (
          <button
            onClick={() => setCreating(true)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            + New campaign
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-6">
          <CampaignForm
            initial={null}
            surveys={surveys}
            onSave={(body) => create.mutate(body)}
            onCancel={() => setCreating(false)}
            saving={create.isPending}
            error={create.error}
          />
        </div>
      )}

      {editing && (
        <div className="mb-6">
          <CampaignForm
            initial={editing}
            surveys={surveys}
            onSave={(body) => update.mutate({ id: editing._id, body })}
            onCancel={() => setEditing(null)}
            saving={update.isPending}
            error={update.error}
          />
        </div>
      )}

      {campaignsQ.isLoading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">State</th>
                <th className="px-4 py-3 text-left">Survey</th>
                <th className="px-4 py-3 text-right">Households</th>
                <th className="px-4 py-3 text-right">Knocked</th>
                <th className="px-4 py-3 text-right">Surveys</th>
                <th className="px-4 py-3 text-right">Lit drops</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c._id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        c.type === 'survey'
                          ? 'rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700'
                          : 'rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700'
                      }
                    >
                      {c.type === 'survey' ? 'Survey' : 'Lit drop'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.state}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {c.surveyTemplateId?.name || (c.type === 'lit_drop' ? '—' : '⚠️ none')}
                  </td>
                  <td className="px-4 py-3 text-right">{fmt(c.counts?.households)}</td>
                  <td className="px-4 py-3 text-right">{fmt(c.counts?.knocked)}</td>
                  <td className="px-4 py-3 text-right">
                    {c.type === 'survey' ? fmt(c.counts?.surveysSubmitted) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.type === 'lit_drop' ? fmt(c.counts?.litDropped) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        c.isActive
                          ? 'rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700'
                          : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600'
                      }
                    >
                      {c.isActive ? 'Active' : 'Archived'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(c)}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!campaigns.length && (
                <tr>
                  <td colSpan="10" className="px-4 py-10 text-center text-gray-500">
                    No campaigns yet. Click <strong>New campaign</strong> to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
