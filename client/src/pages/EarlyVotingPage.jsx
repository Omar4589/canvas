import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

export default function EarlyVotingPage() {
  const qc = useQueryClient();
  const [campaignId, setCampaignId] = useState('');
  const [file, setFile] = useState(null);
  const [unmarkId, setUnmarkId] = useState('');

  const campaignsQ = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api('/admin/campaigns') });
  const campaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);

  const historyQ = useQuery({
    queryKey: ['voted', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/voted`),
    enabled: !!campaignId,
  });

  const preview = useMutation({
    mutationFn: async (f) => {
      const fd = new FormData();
      fd.append('file', f);
      return api(`/admin/campaigns/${campaignId}/voted/preview`, { method: 'POST', formData: fd });
    },
  });

  const apply = useMutation({
    mutationFn: async (f) => {
      const fd = new FormData();
      fd.append('file', f);
      return api(`/admin/campaigns/${campaignId}/voted/import`, { method: 'POST', formData: fd });
    },
    onSuccess: () => {
      setFile(null);
      preview.reset();
      qc.invalidateQueries({ queryKey: ['voted', campaignId] });
    },
  });

  const undo = useMutation({
    mutationFn: (uploadId) => api(`/admin/campaigns/${campaignId}/voted/undo`, { method: 'POST', body: { uploadId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voted', campaignId] }),
  });

  const unmark = useMutation({
    mutationFn: (stateVoterId) =>
      api(`/admin/campaigns/${campaignId}/voted/unmark`, { method: 'POST', body: { stateVoterId } }),
    onSuccess: () => {
      setUnmarkId('');
      qc.invalidateQueries({ queryKey: ['voted', campaignId] });
    },
  });

  function onPickFile(f) {
    setFile(f);
    apply.reset();
    if (f && campaignId) preview.mutate(f);
    else preview.reset();
  }

  function downloadUnmatched() {
    const ids = preview.data?.notFoundIds || [];
    if (!ids.length) return;
    const blob = new Blob([`voterId\n${ids.join('\n')}\n`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'unmatched-voter-ids.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const pv = preview.data;
  const canApply = file && campaignId && pv && pv.willMark > 0 && !apply.isPending;

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 text-2xl font-semibold">Early Voting</h1>
      <p className="mb-6 text-sm text-gray-600">
        Upload a list of voters who have <strong>already voted</strong> (matched by Voter ID). They get a ✓ next to
        their name in the app, and a door drops off the books only once <strong>everyone</strong> there has voted.
        Nothing is re-cut — every upload is reversible.
      </p>

      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Campaign</label>
            <select
              value={campaignId}
              onChange={(e) => { setCampaignId(e.target.value); setFile(null); preview.reset(); apply.reset(); }}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            >
              <option value="">— Choose a campaign —</option>
              {campaigns.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.state} · {c.type === 'survey' ? 'Survey' : 'Lit drop'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Voted-voters CSV</label>
            <input
              type="file"
              accept=".csv"
              disabled={!campaignId}
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              className="block w-full text-sm disabled:opacity-50"
            />
            {preview.isPending && <p className="mt-1 text-xs text-gray-500">Matching…</p>}
            {preview.error && <p className="mt-1 text-xs text-red-700">{preview.error.message}</p>}
          </div>
        </div>

        {pv && (
          <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-4 text-sm">
            <div className="mb-2 text-xs text-gray-500">
              Matched on column <span className="font-mono font-medium">{pv.idColumn}</span> · {fmt(pv.idsInFile)} IDs in file
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><span className="text-gray-500">Will mark voted</span><div className="text-lg font-semibold text-green-700">{fmt(pv.willMark)}</div></div>
              <div><span className="text-gray-500">Already voted</span><div className="text-lg font-semibold text-gray-700">{fmt(pv.alreadyVoted)}</div></div>
              <div><span className="text-gray-500">Doors that will drop</span><div className="text-lg font-semibold text-amber-700">{fmt(pv.doorsWillDrop)}</div></div>
              <div><span className="text-gray-500">Not in this campaign</span><div className="text-lg font-semibold text-gray-400">{fmt(pv.notFound)}</div></div>
            </div>
            {pv.notFound > 0 && (
              <button
                type="button"
                onClick={downloadUnmatched}
                className="mt-3 text-xs font-semibold text-brand-700 hover:underline"
              >
                Download {fmt(pv.notFound)} unmatched ID{pv.notFound === 1 ? '' : 's'}
              </button>
            )}
          </div>
        )}

        <button
          onClick={() => canApply && apply.mutate(file)}
          disabled={!canApply}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {apply.isPending ? 'Applying…' : 'Mark these voters voted'}
        </button>
        {apply.error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{apply.error.message}</div>
        )}
        {apply.data && (
          <div className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Marked {fmt(apply.data.marked)} voters voted · {fmt(apply.data.doorsDropped)} doors dropped
            {apply.data.notFound ? ` · ${fmt(apply.data.notFound)} not in this campaign` : ''}.
          </div>
        )}
      </section>

      {campaignId && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Voters marked voted" value={fmt(historyQ.data?.totalVoted)} accent="text-green-700" />
            <Stat label="Doors fully voted" value={fmt(historyQ.data?.fullyVotedDoors)} accent="text-amber-700" />
          </div>

          <h2 className="mb-3 text-base font-medium">Upload history</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">When</th>
                  <th className="px-4 py-2 text-left">File</th>
                  <th className="px-4 py-2 text-right">Marked</th>
                  <th className="px-4 py-2 text-right">Doors dropped</th>
                  <th className="px-4 py-2 text-right">Not found</th>
                  <th className="px-4 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {(historyQ.data?.uploads || []).map((u) => (
                  <tr key={u._id} className={`border-t border-gray-100 ${u.undone ? 'text-gray-400' : ''}`}>
                    <td className="px-4 py-2">{new Date(u.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2">{u.fileName || '—'}</td>
                    <td className="px-4 py-2 text-right">{fmt(u.matched)}</td>
                    <td className="px-4 py-2 text-right">{fmt(u.doorsDropped)}</td>
                    <td className="px-4 py-2 text-right">{fmt(u.notFound)}</td>
                    <td className="px-4 py-2 text-right">
                      {u.undone ? (
                        <span className="text-xs italic">undone</span>
                      ) : (
                        <button
                          onClick={() => undo.mutate(u._id)}
                          disabled={undo.isPending}
                          className="text-xs font-semibold text-brand-700 hover:underline disabled:opacity-60"
                        >
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!historyQ.data?.uploads?.length && (
                  <tr><td colSpan="6" className="px-4 py-6 text-center text-gray-500">No uploads yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-1 text-base font-medium">Un-mark a voter</h2>
            <p className="mb-3 text-xs text-gray-600">
              Marked someone voted by mistake? Enter their Voter ID to un-mark them — the door
              re-opens if everyone there is no longer voted.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={unmarkId}
                onChange={(e) => setUnmarkId(e.target.value)}
                placeholder="Voter ID"
                className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
              />
              <button
                onClick={() => unmarkId.trim() && unmark.mutate(unmarkId.trim())}
                disabled={!unmarkId.trim() || unmark.isPending}
                className="rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:opacity-60"
              >
                {unmark.isPending ? 'Un-marking…' : 'Un-mark'}
              </button>
            </div>
            {unmark.error && <p className="mt-2 text-xs text-red-700">{unmark.error.message}</p>}
            {unmark.data && (
              <p className="mt-2 text-xs text-green-700">
                Un-marked.{unmark.data.reopened ? ' Door re-opened.' : ''}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
