import { useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import IdColumnPicker from '../components/IdColumnPicker.jsx';
import { saveTextFile } from '../lib/downloadFile.js';
import { formatInTz } from '../lib/datetime.js';
import { describeIdsInFile, zeroMatchLine, historySubtitle } from '../lib/idListPreview.js';

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
  const { campaignId } = useParams();
  const { selected, isLoading: campaignLoading } = useCampaignSelection(campaignId);
  const [file, setFile] = useState(null);
  // The admin's column override ('' = let the server detect). The APPLY never sends this: it
  // sends the column the last preview RESPONSE matched on, so what was previewed is what runs.
  const [idColumn, setIdColumn] = useState('');
  const [unmarkId, setUnmarkId] = useState('');

  // Early-voting uploads belong to this campaign → show times in its tz (fallback org).
  const tz = selected?.timeZone || orgTz;

  const historyQ = useQuery({
    queryKey: ['voted', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/voted`),
    enabled: !!campaignId,
  });

  const formOf = (f, col) => {
    const fd = new FormData();
    fd.append('file', f);
    if (col) fd.append('idColumn', col);
    return fd;
  };
  const preview = useMutation({
    mutationFn: ({ file: f, idColumn: col }) =>
      api(`/admin/campaigns/${campaignId}/voted/preview`, { method: 'POST', formData: formOf(f, col) }),
  });

  const apply = useMutation({
    mutationFn: ({ file: f, idColumn: col }) =>
      api(`/admin/campaigns/${campaignId}/voted/import`, { method: 'POST', formData: formOf(f, col) }),
    onSuccess: () => {
      setFile(null);
      setIdColumn('');
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
    setIdColumn('');
    apply.reset();
    if (f && campaignId) preview.mutate({ file: f, idColumn: '' });
    else preview.reset();
  }
  // Changing the column re-runs the preview on it; the preview's response then owns the value.
  function onChangeColumn(col) {
    setIdColumn(col);
    if (file && col) preview.mutate({ file, idColumn: col });
  }

  function downloadUnmatched() {
    const ids = preview.data?.notFoundIds || [];
    if (!ids.length) return;
    saveTextFile(`voterId\n${ids.join('\n')}\n`, 'unmatched-voter-ids.csv');
  }

  const pv = preview.data;
  // The server could not detect a column: it 400s with the column list, so the admin can pick one.
  const undetected = preview.error?.data?.columns?.length ? preview.error.data : null;
  const canApply = file && campaignId && pv && pv.willMark > 0 && !apply.isPending;

  if (!campaignLoading && !selected) return <Navigate to="/campaigns" replace />;

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 text-2xl font-semibold">Early Voting</h1>
      <p className="mb-6 text-sm text-fg-muted">
        Upload a list of voters who have <strong>already voted</strong>. They&apos;re matched by Voter ID, with or
        without leading zeros, so a list that went through Excel still matches. They get a ✓ next to their name in
        the app, and a door drops off the books only once <strong>everyone</strong> there has voted. Nothing is
        re-cut — every upload is reversible.
      </p>

      <section className="mb-8 rounded-lg border border-border bg-card p-5">
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Campaign</label>
            <div className="rounded border border-border bg-sunken px-3 py-2 text-sm text-fg">
              {selected
                ? `${selected.name} (${selected.state} · ${selected.type === 'survey' ? 'Survey' : 'Lit drop'})`
                : 'Loading…'}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Voted-voters CSV</label>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xls"
              disabled={!campaignId}
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              className="block w-full text-sm disabled:opacity-50"
            />
            {preview.isPending && <p className="mt-1 text-xs text-fg-muted">Matching…</p>}
            {undetected && (
              <IdColumnPicker
                undetected
                columns={undetected.columns}
                value={idColumn}
                onChange={setIdColumn}
                onMatch={() => file && idColumn && preview.mutate({ file, idColumn })}
                busy={preview.isPending}
              />
            )}
            {preview.error && !undetected && <p className="mt-1 text-xs text-danger">{preview.error.message}</p>}
          </div>
        </div>

        {pv && (
          <div className="mb-4 rounded border border-border bg-sunken p-4 text-sm">
            <div className="mb-1 text-xs text-fg-muted">
              <IdColumnPicker columns={pv.columns || []} value={pv.idColumn} onChange={onChangeColumn} busy={preview.isPending} />
              {' · '}
              {describeIdsInFile(pv)}
            </div>
            {pv.sampleIds?.length > 0 && (
              <p className="mb-2 text-[11px] text-fg-subtle">e.g. {pv.sampleIds.join(' · ')}</p>
            )}
            {zeroMatchLine(pv) && <p className="mb-3 text-xs text-fg-muted">{zeroMatchLine(pv)}</p>}
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
                  campaign later, they&apos;re marked voted automatically, however the import spells their ID (and
                  their door drops once everyone there has voted).
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
          onClick={() => canApply && apply.mutate({ file, idColumn: pv.idColumn })}
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
            {apply.data.matchedViaZeros ? (
              <span className="mt-1 block text-xs text-success">
                {fmt(apply.data.matchedViaZeros)} matched only after ignoring leading zeros.
              </span>
            ) : null}
            {apply.data.notFound ? (
              <span className="mt-1 block text-xs text-success">
                The {fmt(apply.data.notFound)} not in this campaign are saved — they&apos;ll be marked automatically when
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
                    <td className="px-4 py-2">
                      {u.fileName || '—'}
                      {historySubtitle(u) && <div className="text-[11px] text-fg-subtle">{historySubtitle(u)}</div>}
                    </td>
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
            <strong>Not found</strong> voters aren&apos;t lost — they&apos;re saved and marked automatically if those voters are
            later imported into this campaign.
          </p>

          <section className="mt-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-1 text-base font-medium">Un-mark a voter</h2>
            <p className="mb-3 text-xs text-fg-muted">
              Marked someone voted by mistake? Enter their Voter ID (with or without its leading zeros) to un-mark
              them — the door re-opens if everyone there is no longer voted.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={unmarkId}
                onChange={(e) => setUnmarkId(e.target.value)}
                placeholder="Voter ID"
                className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
