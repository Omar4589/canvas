import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';
import StatCard from '../components/StatCard.jsx';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

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

// Stacked initials avatars for a book's assigned canvassers (hover = full names).
function Avatars({ users = [] }) {
  if (!users.length) return <span className="text-xs text-gray-400">Unassigned</span>;
  const shown = users.slice(0, 3);
  return (
    <span
      className="flex items-center -space-x-1"
      title={users.map((u) => `${u.firstName} ${u.lastName}`).join(', ')}
    >
      {shown.map((u) => (
        <span
          key={u.id}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[9px] font-semibold text-brand-700 ring-1 ring-white"
        >
          {((u.firstName?.[0] || '') + (u.lastName?.[0] || '')).toUpperCase()}
        </span>
      ))}
      {users.length > 3 && <span className="pl-1.5 text-[10px] text-gray-500">+{users.length - 3}</span>}
    </span>
  );
}

// Expanded detail for a pass: its books (with assignees) + quick-nav buttons.
function PassDetail({ campaignId, pass, tz }) {
  const turfsQ = useQuery({
    queryKey: ['turfs', campaignId, pass._id],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs?passId=${pass._id}`),
    enabled: !!campaignId,
  });
  const asgQ = useQuery({
    queryKey: ['turf-pass-assignments', campaignId, pass._id],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/assignments?passId=${pass._id}`),
    enabled: !!campaignId,
  });
  const turfs = turfsQ.data?.turfs || [];
  const byTurf = new Map();
  for (const a of asgQ.data?.assignments || []) {
    const key = String(a.turfId);
    const arr = byTurf.get(key) || [];
    arr.push(a.user);
    byTurf.set(key, arr);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        {pass.activatedAt && (
          <span>Activated {formatInTz(pass.activatedAt, tz, { month: 'short', day: 'numeric', year: 'numeric' }, false)}</span>
        )}
        <a href={`/turfs?passId=${pass._id}`} className="font-medium text-brand-700 hover:underline">Cut / assign books →</a>
        <a href={`/map?passId=${pass._id}`} className="font-medium text-brand-700 hover:underline">Audit →</a>
      </div>
      {turfsQ.isLoading ? (
        <div className="text-xs text-gray-500">Loading books…</div>
      ) : !turfs.length ? (
        <div className="text-xs text-gray-500">
          No books cut yet.{' '}
          <a href={`/turfs?passId=${pass._id}`} className="font-medium text-brand-700 hover:underline">Cut books →</a>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-white">
          {turfs.map((t) => (
            <li key={t._id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-gray-900">{t.name}</span>
                <span className="ml-2 text-xs text-gray-500">{(t.doorCount || 0).toLocaleString()} doors</span>
              </div>
              <div className="flex items-center gap-3">
                <Avatars users={byTurf.get(String(t._id)) || []} />
                <a href={`/turfs?passId=${pass._id}`} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Open in Turf →</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PassesPage() {
  const qc = useQueryClient();
  const { campaignId, setCampaignId, campaigns, selected, isLoading } = useCampaignSelection();
  const orgTz = useOrgTimeZone();
  const tz = selected?.timeZone || orgTz;
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [effortId, setEffortId] = useState(searchParams.get('effortId') || '');
  const [openId, setOpenId] = useState(null);

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

  const totalBooks = useMemo(() => passes.reduce((s, p) => s + (p.turfCount || 0), 0), [passes]);
  const activePass = passes.find((p) => p.status === 'active');

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
        <h1 className="text-2xl font-semibold">Passes</h1>
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

      {effortId && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Passes" value={passes.length.toLocaleString()} />
          <StatCard
            label="Active pass"
            value={activePass ? `Pass ${activePass.roundNumber}` : '—'}
            accent={activePass ? 'green' : undefined}
            hint={activePass ? activePass.name : undefined}
          />
          <StatCard label="Total books" value={totalBooks.toLocaleString()} />
        </div>
      )}

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-medium">New pass</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-700">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GOTV pass"
              className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
          </label>
          <button
            onClick={() => name && effortId && create.mutate()}
            disabled={!name || !effortId || create.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {create.isPending ? 'Creating…' : 'Create pass'}
          </button>
        </div>
        {create.error && <div className="mt-2 text-xs text-red-700">{create.error.message}</div>}
        <p className="mt-2 text-xs text-gray-500">
          Passes belong to the selected effort. Create a pass → cut its books on the Turf Cutting page → Activate it here. Passes are one-way (draft → active → archived); each effort can have one active pass.
        </p>
      </section>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Pass</th>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Books</th>
              <th className="px-4 py-2 text-left">Progress</th>
              <th className="px-4 py-2 text-left">Created</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {passes.map((p) => {
              const open = openId === p._id;
              return (
                <Fragment key={p._id}>
                  <tr
                    onClick={() => setOpenId(open ? null : p._id)}
                    className="cursor-pointer border-t border-gray-100 transition-colors hover:bg-gray-50"
                  >
                    <td className="px-4 py-2 text-gray-600">
                      <span className="mr-1.5 inline-block text-gray-400">{open ? '▾' : '▸'}</span>
                      {p.roundNumber}
                    </td>
                    <td className="px-4 py-2">
                      {p.name}
                      {p.status === 'active' && (
                        <span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">ACTIVE</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[p.status] || ''}`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.turfCount}</td>
                    <td className="px-4 py-2"><PassProgress campaignId={campaignId} passId={p._id} /></td>
                    <td className="px-4 py-2 text-gray-600">
                      {p.createdAt ? formatInTz(p.createdAt, tz, { month: 'short', day: 'numeric', year: 'numeric' }, false) : '—'}
                    </td>
                    <td className="space-x-2 px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
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
                  {open && (
                    <tr className="border-t border-gray-50 bg-gray-50/50">
                      <td colSpan="7" className="px-4 py-3">
                        <PassDetail campaignId={campaignId} pass={p} tz={tz} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!passes.length && (
              <tr><td colSpan="7" className="px-4 py-6 text-center text-gray-500">No passes yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {action.error && <div className="mt-2 text-sm text-red-700">{action.error.message}</div>}
    </div>
  );
}
