import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import CampaignAssignmentsModal from '../components/CampaignAssignmentsModal.jsx';
import NextStepBanner from '../components/NextStepBanner.jsx';
import { setStoredCampaignId } from '../components/CampaignSelector.jsx';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Mountain — no DST (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
];

function CampaignForm({ initial, surveys, onSave, onCancel, saving, error }) {
  const isEdit = !!initial?._id;
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'survey');
  const [state, setState] = useState(initial?.state || '');
  const [surveyTemplateId, setSurveyTemplateId] = useState(
    initial?.surveyTemplateId?._id || initial?.surveyTemplateId || ''
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [timeZone, setTimeZone] = useState(initial?.timeZone || '');

  function submit(e) {
    e.preventDefault();
    onSave({
      name: name.trim(),
      type,
      state: state.trim().toUpperCase(),
      surveyTemplateId: type === 'survey' ? surveyTemplateId : null,
      isActive,
      timeZone: timeZone || undefined, // empty → server defaults from state
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div>
        <label className="mb-1 block text-xs font-medium text-fg-muted">
          Campaign name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Kentucky 2026"
          className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">Type</label>
          <div className="flex gap-2">
            {[
              { value: 'survey', label: 'Survey' },
              { value: 'lit_drop', label: 'Lit drop' },
            ].map((t) => (
              <label
                key={t.value}
                className={`flex flex-1 cursor-pointer items-center justify-center rounded border px-3 py-2 text-sm ${
                  type === t.value
                    ? 'border-brand-600 bg-brand-tint text-brand-accent'
                    : 'border-border-strong text-fg-muted hover:bg-sunken'
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
          <label className="mb-1 block text-xs font-medium text-fg-muted">
            State (2-letter)
          </label>
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            required
            maxLength={2}
            placeholder="KY"
            className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm uppercase text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-fg-muted">Timezone</label>
        <select
          value={timeZone}
          onChange={(e) => setTimeZone(e.target.value)}
          className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="">Auto (from state)</option>
          {US_TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-fg-muted">
          Anchors every date &amp; time for this campaign — all admins see the same numbers and clock times,
          regardless of their own timezone.
        </p>
      </div>

      {type === 'survey' && (
        <div>
          <label className="mb-1 block text-xs font-medium text-fg-muted">
            Survey template
          </label>
          <select
            value={surveyTemplateId}
            onChange={(e) => setSurveyTemplateId(e.target.value)}
            required
            className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="">— Choose a survey —</option>
            {(surveys || []).map((s) => (
              <option key={s._id} value={s._id}>
                {s.name} (v{s.version || 1})
              </option>
            ))}
          </select>
          {!surveys?.length && (
            <p className="mt-1 text-xs text-fg-muted">
              No surveys exist yet. Create one on the Surveys page first.
            </p>
          )}
          {(() => {
            const chosen = (surveys || []).find((s) => s._id === surveyTemplateId);
            return chosen?.responseCount > 0 ? (
              <p className="mt-1 text-xs text-warning-fg">
                Heads up: this survey already has {chosen.responseCount.toLocaleString()} response
                {chosen.responseCount === 1 ? '' : 's'}. New answers will report under it alongside the
                existing ones. To run different questions, duplicate it on the Surveys page and pick the copy.
              </p>
            ) : null;
          })()}
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
        <div className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {error.message}
        </div>
      )}

      <div className="flex justify-end gap-2">
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
  const [assigningCampaign, setAssigningCampaign] = useState(null);
  const [justCreated, setJustCreated] = useState(null);

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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
      setCreating(false);
      setJustCreated(data?.campaign || null);
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

      {justCreated && (
        <NextStepBanner
          tone="success"
          className="mb-6"
          title={`“${justCreated.name}” created.`}
          action={{
            label: 'Import voters',
            to: '/import',
            onClick: () => setStoredCampaignId(justCreated.id || justCreated._id),
          }}
        >
          Next: import a voter CSV to populate it.
        </NextStepBanner>
      )}

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
        <div className="text-sm text-fg-muted">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
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
                <tr key={c._id} className="border-t border-border hover:bg-sunken">
                  <td className="px-4 py-3 font-medium text-fg">{c.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        c.type === 'survey'
                          ? 'rounded-full bg-info-tint px-2 py-0.5 text-xs font-medium text-info-fg'
                          : 'rounded-full bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-500'
                      }
                    >
                      {c.type === 'survey' ? 'Survey' : 'Lit drop'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.state}</td>
                  <td className="px-4 py-3 text-fg-muted">
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
                          ? 'rounded-full bg-success-tint px-2.5 py-0.5 text-xs font-medium text-success'
                          : 'rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-fg-muted'
                      }
                    >
                      {c.isActive ? 'Active' : 'Archived'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      to={`/dashboard/${c._id}`}
                      className="mr-3 text-xs font-medium text-brand-accent hover:underline"
                    >
                      View data
                    </Link>
                    <button
                      onClick={() => setAssigningCampaign(c)}
                      className="mr-3 text-xs font-medium text-brand-accent hover:underline"
                    >
                      Assignments
                    </button>
                    <button
                      onClick={() => setEditing(c)}
                      className="text-xs font-medium text-brand-accent hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!campaigns.length && (
                <tr>
                  <td colSpan="10" className="px-4 py-10 text-center text-fg-muted">
                    No campaigns yet. Click <strong>New campaign</strong> to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {assigningCampaign && (
        <CampaignAssignmentsModal
          campaign={assigningCampaign}
          onClose={() => setAssigningCampaign(null)}
        />
      )}
    </div>
  );
}
