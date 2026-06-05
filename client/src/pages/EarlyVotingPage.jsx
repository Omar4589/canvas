import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent || 'text-fg'}`}>{value}</div>
    </div>
  );
}

export default function EarlyVotingPage() {
  const qc = useQueryClient();
  const orgTz = useOrgTimeZone();
  const [campaignId, setCampaignId] = useState('');
  const [file, setFile] = useState(null);
  const [unmarkId, setUnmarkId] = useState('');

  const campaignsQ = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api('/admin/campaigns') });
  const campaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);
  // Early-voting uploads belong to the selected campaign → show times in its tz (fallback org).
  const tz = campaigns.find((c) => String(c._id) === String(campaignId))?.timeZone || orgTz;

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
      <p className="mb-6 text-sm text-fg-muted">
        Upload a list of voters who have <strong>already voted</strong> (matched by Voter ID). They get a ✓ next to
        their name in the app, and a door drops off the books only once <strong>everyone</strong> there has voted.
        Nothing is re-cut — every upload is reversible.
      </p>

      <section className="mb-8 rounded-lg border border-border bg-card p-5">
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Campaign</label>
            <select
              value={campaignId}
              onChange={(e) => { setCampaignId(e.target.value); setFile(null); preview.reset(); apply.reset(); }}
              className="w-full rounded border border-border-strong px-3 py-2 text-sm focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
            <label className="mb-1 block text-xs font-medium text-fg-muted">Voted-voters CSV</label>
            <input
              type="file"
              accept=".csv"
              disabled={!campaignId}
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              className="block w-full text-sm disabled:opacity-50"
            />
            {preview.isPending && <p className="mt-1 text-xs text-fg-muted">Matching…</p>}
            {preview.error && <p className="mt-1 text-xs text-danger">{preview.error.message}</p>}
          </div>
        </div>

        {pv && (
          <div className="mb-4 rounded border border-border bg-sunken p-4 text-sm">
            <div className="mb-2 text-xs text-fg-muted">
              Matched on column <span className="font-mono font-medium">{pv.idColumn}</span> · {fmt(pv.idsInFile)} IDs in file
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><span className="text-fg-muted">Will mark voted</span><div className="text-lg font-semibold text-success">{fmt(pv.willMark)}</div></div>
              <div><span className="text-fg-muted">Already voted</span><div className="text-lg font-semibold text-fg-muted">{fmt(pv.alreadyVoted)}</div></div>
              <div><span className="text-fg-muted">Doors that will drop</span><div className="text-lg font-semibold text-warning-fg">{fmt(pv.doorsWillDrop)}</div></div>
              <div><span className="text-fg-muted">Not in this campaign</span><div className="text-lg font-semibold text-fg-subtle">{fmt(pv.notFound)}</div></div>
            </div>
            {pv.notFound > 0 && (
              <div className="mt-3">
                <p className="text-xs text-fg-muted">
                  Not in this campaign yet — these are <strong>saved</strong>. If those voters get imported into this
                  campaign later, they're marked voted automatically (and their door drops once everyone there has voted).
                </p>
                <button
                  type="button"
                  onClick={downloadUnmatched}
                  className="mt-1 text-xs font-semibold text-brand-accent hover:underline"
                >
                  Download {fmt(pv.notFound)} unmatched ID{pv.notFound === 1 ? '' : 's'}
                </button>
              </div>
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
          <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{apply.error.message}</div>
        )}
        {apply.data && (
          <div className="mt-3 rounded border border-success/30 bg-success-tint px-3 py-2 text-sm text-green-800">
            Marked {fmt(apply.data.marked)} voters voted · {fmt(apply.data.doorsDropped)} doors dropped
            {apply.data.notFound ? ` · ${fmt(apply.data.notFound)} not in this campaign` : ''}.
            {apply.data.notFound ? (
              <span className="mt-1 block text-xs text-success">
                The {fmt(apply.data.notFound)} not in this campaign are saved — they'll be marked automatically when
                those voters are imported into this campaign.
              </span>
            ) : null}
          </div>
        )}
      </section>

      {campaignId && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Voters marked voted" value={fmt(historyQ.data?.totalVoted)} accent="text-success" />
            <Stat label="Doors fully voted" value={fmt(historyQ.data?.fullyVotedDoors)} accent="text-warning-fg" />
          </div>

          <h2 className="mb-3 text-base font-medium">Upload history</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
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
                  <tr key={u._id} className={`border-t border-border ${u.undone ? 'text-fg-subtle' : ''}`}>
                    <td className="px-4 py-2">{formatInTz(u.createdAt, tz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }, true)}</td>
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
                          className="text-xs font-semibold text-brand-accent hover:underline disabled:opacity-60"
                        >
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!historyQ.data?.uploads?.length && (
                  <tr><td colSpan="6" className="px-4 py-6 text-center text-fg-muted">No uploads yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            <strong>Not found</strong> voters aren't lost — they're saved and marked automatically if those voters are
            later imported into this campaign.
          </p>

          <section className="mt-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-1 text-base font-medium">Un-mark a voter</h2>
            <p className="mb-3 text-xs text-fg-muted">
              Marked someone voted by mistake? Enter their Voter ID to un-mark them — the door
              re-opens if everyone there is no longer voted.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={unmarkId}
                onChange={(e) => setUnmarkId(e.target.value)}
                placeholder="Voter ID"
                className="rounded border border-border-strong px-3 py-2 text-sm focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              />
              <button
                onClick={() => unmarkId.trim() && unmark.mutate(unmarkId.trim())}
                disabled={!unmarkId.trim() || unmark.isPending}
                className="rounded-md bg-fg px-3 py-2 text-sm font-semibold text-card transition-colors hover:bg-fg-muted disabled:opacity-60"
              >
                {unmark.isPending ? 'Un-marking…' : 'Un-mark'}
              </button>
            </div>
            {unmark.error && <p className="mt-2 text-xs text-danger">{unmark.error.message}</p>}
            {unmark.data && (
              <p className="mt-2 text-xs text-success">
                Un-marked.{unmark.data.reopened ? ' Door re-opened.' : ''}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
