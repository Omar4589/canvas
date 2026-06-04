import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';

const STATUS_BADGE = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-400',
};

const SEG_COLORS = {
  surveyed: '#22c55e',
  lit_dropped: '#a855f7',
  not_home: '#3b82f6',
  wrong_address: '#ef4444',
  unknocked: '#e5e7eb',
};

function ProgressBar({ counts = {}, total = 0 }) {
  if (!total) return <span className="text-xs text-gray-400">no doors</span>;
  return (
    <div className="flex h-2 w-40 overflow-hidden rounded bg-gray-100">
      {['surveyed', 'lit_dropped', 'not_home', 'wrong_address', 'unknocked'].map((k) =>
        counts[k] ? (
          <div key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: SEG_COLORS[k] }} />
        ) : null
      )}
    </div>
  );
}

function PassProgress({ campaignId, passId }) {
  const q = useQuery({
    queryKey: ['pass-progress', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes/${passId}/progress`),
    enabled: !!campaignId && !!passId,
  });
  if (q.isLoading) return <span className="text-xs text-gray-400">…</span>;
  const { counts, total } = q.data || {};
  const done = total ? Math.round(((total - (counts?.unknocked || 0)) / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <ProgressBar counts={counts || {}} total={total || 0} />
      <span className="text-xs text-gray-500">{done}%</span>
    </div>
  );
}

export default function PassesPage() {
  const qc = useQueryClient();
  const { campaignId, setCampaignId, campaigns, isLoading } = useCampaignSelection();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [effortId, setEffortId] = useState(searchParams.get('effortId') || '');

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const efforts = (effortsQ.data?.efforts || []).filter((e) => e.status !== 'archived');

  // Default the effort once efforts load (URL ?effortId wins, else first effort).
  useEffect(() => {
    if (effortId || !efforts.length) return;
    setEffortId(String(efforts[0]._id));
  }, [effortId, efforts]);

  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId, effortId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes?effortId=${effortId}`),
    enabled: !!campaignId && !!effortId,
  });
  const passes = passesQ.data?.passes || [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'passes', campaignId] });

  const create = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/passes`, { method: 'POST', body: { name, effortId } }),
    onSuccess: () => { setName(''); invalidate(); },
  });
  const action = useMutation({
    mutationFn: ({ id, op }) => api(`/admin/campaigns/${campaignId}/passes/${id}/${op}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (id) => api(`/admin/campaigns/${campaignId}/passes/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Rounds</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Effort</span>
            <select
              value={effortId}
              onChange={(e) => setEffortId(e.target.value)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            >
              <option value="">Choose an effort…</option>
              {efforts.map((ef) => <option key={ef._id} value={ef._id}>{ef.name}</option>)}
            </select>
          </label>
          <CampaignSelector campaignId={campaignId} onChange={setCampaignId} campaigns={campaigns} isLoading={isLoading} />
        </div>
      </div>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-medium">New round</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-700">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GOTV round"
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
          </label>
          <button
            onClick={() => name && effortId && create.mutate()}
            disabled={!name || !effortId || create.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {create.isPending ? 'Creating…' : 'Create round'}
          </button>
        </div>
        {create.error && <div className="mt-2 text-xs text-red-700">{create.error.message}</div>}
        <p className="mt-2 text-xs text-gray-500">
          Rounds belong to the selected effort. Create a round → cut its books on the Turf Cutting page → Activate it here. Rounds are one-way (draft → active → archived); each effort can have one active round.
        </p>
      </section>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Round</th>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Books</th>
              <th className="px-4 py-2 text-left">Progress</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {passes.map((p) => (
              <tr key={p._id} className="border-t border-gray-100">
                <td className="px-4 py-2 text-gray-600">{p.roundNumber}</td>
                <td className="px-4 py-2">
                  {p.name}
                  {p.status === 'active' && (
                    <span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">ACTIVE</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[p.status] || ''}`}>{p.status}</span>
                </td>
                <td className="px-4 py-2 text-right">{p.turfCount}</td>
                <td className="px-4 py-2"><PassProgress campaignId={campaignId} passId={p._id} /></td>
                <td className="space-x-2 px-4 py-2 text-right">
                  {p.status === 'draft' && (
                    <button onClick={() => action.mutate({ id: p._id, op: 'activate' })} className="text-xs font-semibold text-green-700 hover:underline">
                      Activate
                    </button>
                  )}
                  {p.status === 'active' && (
                    <button onClick={() => action.mutate({ id: p._id, op: 'archive' })} className="text-xs text-gray-500 hover:underline">
                      Archive
                    </button>
                  )}
                  {p.status === 'draft' && (
                    <button onClick={() => del.mutate(p._id)} className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!passes.length && (
              <tr><td colSpan="6" className="px-4 py-6 text-center text-gray-500">No passes yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {action.error && <div className="mt-2 text-sm text-red-700">{action.error.message}</div>}
    </div>
  );
}
