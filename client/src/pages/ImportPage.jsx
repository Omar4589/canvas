import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function StatusBadge({ job }) {
  const cls = {
    pending: 'bg-gray-100 text-gray-700',
    parsing: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }[job.status] || 'bg-gray-100 text-gray-700';
  const showPct = (job.status === 'parsing' || job.status === 'pending') && job.progress != null;
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>
      {job.status}
      {showPct ? ` ${job.progress}%` : ''}
    </span>
  );
}

export default function ImportPage() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [campaignId, setCampaignId] = useState('');
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState({});
  const [profileName, setProfileName] = useState('');
  const [step, setStep] = useState('select'); // 'select' | 'map'

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });
  const fieldsQ = useQuery({
    queryKey: ['admin', 'imports', 'fields'],
    queryFn: () => api('/admin/imports/fields'),
  });
  const profilesQ = useQuery({
    queryKey: ['admin', 'imports', 'profiles'],
    queryFn: () => api('/admin/imports/profiles'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['imports'],
    queryFn: () => api('/admin/imports'),
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs || [];
      return jobs.some((j) => j.status === 'pending' || j.status === 'parsing') ? 1500 : false;
    },
  });

  const fields = fieldsQ.data?.fields || [];
  const requiredKeys = fieldsQ.data?.required || [];

  const preview = useMutation({
    mutationFn: async (f) => {
      const fd = new FormData();
      fd.append('file', f);
      return api('/admin/imports/preview-headers', { method: 'POST', formData: fd });
    },
    onSuccess: (res) => {
      setColumns(res.columns || []);
      setMapping(res.suggestedMapping || {});
      setStep('map');
    },
  });

  const saveProfile = useMutation({
    mutationFn: ({ name, mapping }) => api('/admin/imports/profiles', { method: 'POST', body: { name, mapping } }),
    onSuccess: () => {
      setProfileName('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'imports', 'profiles'] });
    },
  });

  const upload = useMutation({
    mutationFn: async ({ file, campaignId, mapping }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      fd.append('mapping', JSON.stringify(mapping));
      return api('/admin/imports/csv', { method: 'POST', formData: fd });
    },
    onSuccess: () => {
      resetSelection();
      queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
  });

  function resetSelection() {
    setFile(null);
    setColumns([]);
    setMapping({});
    setStep('select');
  }

  function onPickFile(f) {
    setFile(f);
    if (f) preview.mutate(f);
    else setStep('select');
  }

  function applyMapping(next) {
    // Keep only mappings whose column exists in this file's headers.
    const filtered = {};
    for (const [k, col] of Object.entries(next || {})) {
      if (columns.includes(col)) filtered[k] = col;
    }
    setMapping(filtered);
  }

  const campaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);
  const requiredUnmapped = requiredKeys.filter((k) => !mapping[k]);
  const canImport = file && campaignId && step === 'map' && requiredUnmapped.length === 0 && !upload.isPending;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">CSV Import</h1>

      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-medium">Upload voter CSV</h2>
        <p className="mb-4 text-sm text-gray-600">
          Each upload is scoped to a single campaign and runs in the background. Map your vendor's
          columns to our fields (i360, L2, a state file, …) — re-uploading is safe and won't lose
          canvass activity. New households fold in via the books editor, not automatically.
        </p>

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Campaign</label>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            >
              <option value="">— Choose a campaign —</option>
              {campaigns.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.state} · {c.type === 'survey' ? 'Survey' : 'Lit drop'})
                </option>
              ))}
            </select>
            {!campaignsQ.isLoading && !campaigns.length && (
              <p className="mt-1 text-xs text-amber-700">
                No active campaigns. Create one on the Campaigns page first.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">CSV file</label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              className="block w-full text-sm"
            />
            {preview.isPending && <p className="mt-1 text-xs text-gray-500">Reading columns…</p>}
            {preview.error && (
              <p className="mt-1 text-xs text-red-700">{preview.error.message}</p>
            )}
          </div>
        </div>

        {step === 'map' && (
          <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Map columns → fields</h3>
              <div className="flex items-center gap-2">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'default') applyMapping(fieldsQ.data?.defaultMapping);
                    else if (v) {
                      const p = (profilesQ.data?.profiles || []).find((x) => x._id === v);
                      if (p) applyMapping(p.mapping);
                    }
                    e.target.value = '';
                  }}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  <option value="">Apply a saved mapping…</option>
                  <option value="default">Built-in (current format)</option>
                  {(profilesQ.data?.profiles || []).map((p) => (
                    <option key={p._id} value={p._id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {fields.map((f) => {
                const isReqUnmapped = f.required && !mapping[f.key];
                return (
                  <div key={f.key} className="flex items-center gap-2 text-sm">
                    <label className="w-40 shrink-0 text-gray-700">
                      {f.label}
                      {f.required && <span className="text-red-600"> *</span>}
                    </label>
                    <select
                      value={mapping[f.key] || ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
                      className={`min-w-0 flex-1 rounded border px-2 py-1 text-xs ${
                        isReqUnmapped ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                    >
                      <option value="">— not mapped —</option>
                      {columns.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            {requiredUnmapped.length > 0 && (
              <p className="mt-3 text-xs text-red-700">
                Map all required (*) fields to continue: {requiredUnmapped.join(', ')}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Save this mapping as… (e.g. i360)"
                className="rounded border border-gray-300 px-2 py-1 text-xs"
              />
              <button
                onClick={() => profileName.trim() && saveProfile.mutate({ name: profileName.trim(), mapping })}
                disabled={!profileName.trim() || saveProfile.isPending}
                className="rounded border border-gray-300 px-3 py-1 text-xs font-medium hover:bg-gray-100 disabled:opacity-60"
              >
                {saveProfile.isPending ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => canImport && upload.mutate({ file, campaignId, mapping })}
          disabled={!canImport}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {upload.isPending ? 'Queuing…' : 'Import'}
        </button>
        {upload.error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {upload.error.message}
          </div>
        )}
        {upload.data?.job && (
          <div className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Import queued — processing in the background. Progress shows below.
          </div>
        )}
      </section>

      <h2 className="mb-3 text-base font-medium">Recent imports</h2>
      {isLoading ? (
        <div>Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Campaign</th>
                <th className="px-4 py-2 text-left">File</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Voters</th>
                <th className="px-4 py-2 text-right">Households</th>
                <th className="px-4 py-2 text-right">New</th>
                <th className="px-4 py-2 text-right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {(data?.jobs || []).map((j) => (
                <tr key={j._id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-600">{new Date(j.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{j.campaignId?.name || '—'}</td>
                  <td className="px-4 py-2">{j.filename || '—'}</td>
                  <td className="px-4 py-2"><StatusBadge job={j} /></td>
                  <td className="px-4 py-2 text-right">{fmt(j.uniqueVoters)}</td>
                  <td className="px-4 py-2 text-right">{fmt(j.uniqueHouseholds)}</td>
                  <td className="px-4 py-2 text-right">{fmt(j.newVoters)} v / {fmt(j.newHouseholds)} h</td>
                  <td className="px-4 py-2 text-right">{fmt(j.errorCount)}</td>
                </tr>
              ))}
              {!data?.jobs?.length && (
                <tr>
                  <td colSpan="8" className="px-4 py-6 text-center text-gray-500">No imports yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
