import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { saveTextFile } from '../lib/downloadFile.js';
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

export default function DoNotContactPage() {
  const qc = useQueryClient();
  // Do-not-contact is ORG-WIDE (no campaign selector) → times in the org tz.
  const tz = useOrgTimeZone();
  const [file, setFile] = useState(null);

  const historyQ = useQuery({
    queryKey: ['dnc'],
    queryFn: () => api('/admin/dnc'),
  });

  const preview = useMutation({
    mutationFn: async (f) => {
      const fd = new FormData();
      fd.append('file', f);
      return api('/admin/dnc/preview', { method: 'POST', formData: fd });
    },
  });

  const apply = useMutation({
    mutationFn: async (f) => {
      const fd = new FormData();
      fd.append('file', f);
      return api('/admin/dnc/import', { method: 'POST', formData: fd });
    },
    onSuccess: () => {
      setFile(null);
      preview.reset();
      qc.invalidateQueries({ queryKey: ['dnc'] });
    },
  });

  const undo = useMutation({
    mutationFn: (uploadId) => api('/admin/dnc/undo', { method: 'POST', body: { uploadId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dnc'] }),
  });

  function onPickFile(f) {
    setFile(f);
    apply.reset();
    if (f) preview.mutate(f);
    else preview.reset();
  }

  function downloadUnmatched() {
    const ids = preview.data?.notFoundIds || [];
    if (!ids.length) return;
    saveTextFile(`voterId\n${ids.join('\n')}\n`, 'unmatched-voter-ids.csv');
  }

  const pv = preview.data;
  const canApply = file && pv && pv.willFlag > 0 && !apply.isPending;

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 text-2xl font-semibold">Do Not Contact</h1>
      <p className="mb-6 text-sm text-fg-muted">
        Upload a list of voters who must <strong>not be contacted</strong> (matched by Voter ID). The flag is{' '}
        <strong>org-wide</strong>: it applies across <strong>every</strong> campaign and every campaign type —
        including lit drop — excluding flagged voters from walk-list exports and surveys, and a door drops off
        the books once <strong>everyone</strong> there is flagged. Flags are <strong>permanent until removed</strong> —
        undo an upload below, or remove a single voter's flag from their profile on <Link to="/voters" className="font-medium text-brand-accent hover:underline">Voters</Link>.
      </p>

      <section className="mb-8 rounded-lg border border-border bg-card p-5">
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-fg-muted">Do-not-contact CSV</label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => onPickFile(e.target.files?.[0] || null)}
            className="block w-full text-sm"
          />
          {preview.isPending && <p className="mt-1 text-xs text-fg-muted">Matching…</p>}
          {preview.error && <p className="mt-1 text-xs text-danger">{preview.error.message}</p>}
        </div>

        {pv && (
          <div className="mb-4 rounded border border-border bg-sunken p-4 text-sm">
            <div className="mb-2 text-xs text-fg-muted">
              Matched on column <span className="font-mono font-medium">{pv.idColumn}</span> · {fmt(pv.idsInFile)} IDs in file
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><span className="text-fg-muted">Will flag</span><div className="text-lg font-semibold text-danger">{fmt(pv.willFlag)}</div></div>
              <div><span className="text-fg-muted">Already flagged</span><div className="text-lg font-semibold text-fg-muted">{fmt(pv.alreadyFlagged)}</div></div>
              <div><span className="text-fg-muted">Doors that will drop</span><div className="text-lg font-semibold text-warning-fg">{fmt(pv.doorsWillDrop)}</div></div>
              <div><span className="text-fg-muted">Not found</span><div className="text-lg font-semibold text-fg-subtle">{fmt(pv.notFound)}</div></div>
            </div>
            {(pv.dropsByCampaign || []).length > 0 && (
              <div className="mt-3">
                <div className="text-xs uppercase tracking-wide text-fg-subtle">Doors dropping, by campaign</div>
                <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
                  {pv.dropsByCampaign.map((c) => (
                    <li key={c.campaignId}>
                      <span className="font-medium text-fg">{c.name}</span> — {fmt(c.doors)} door{c.doors === 1 ? '' : 's'} will drop
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pv.notFound > 0 && (
              <div className="mt-3">
                <p className="text-xs text-fg-muted">
                  Not found — these Voter IDs matched no one in your voter database.
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
          className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {apply.isPending ? 'Applying…' : 'Flag these voters do-not-contact'}
        </button>
        {apply.error && (
          <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{apply.error.message}</div>
        )}
        {apply.data && (
          <div className="mt-3 rounded border border-success/30 bg-success-tint px-3 py-2 text-sm text-green-800">
            Flagged {fmt(apply.data.flagged)} voters do-not-contact · {fmt(apply.data.doorsDropped)} doors dropped
            {apply.data.notFound ? ` · ${fmt(apply.data.notFound)} not found` : ''}.
          </div>
        )}
      </section>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Total flagged voters" value={fmt(historyQ.data?.totalFlagged)} accent="text-danger" />
        <Stat label="Fully-DNC doors" value={fmt(historyQ.data?.fullyDncDoors)} accent="text-warning-fg" />
      </div>

      <h2 className="mb-3 text-base font-medium">Upload history</h2>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">File</th>
              <th className="px-4 py-2 text-right">Matched</th>
              <th className="px-4 py-2 text-right">Doors dropped</th>
              <th className="px-4 py-2 text-right">Not found</th>
              <th className="px-4 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {(historyQ.data?.uploads || []).map((u) => (
              <tr key={u.id} className={`border-t border-border ${u.undone ? 'text-fg-subtle' : ''}`}>
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
                      onClick={() => {
                        if (window.confirm('Undo this upload? Every voter it flagged is un-flagged, and their doors reopen.')) {
                          undo.mutate(u.id);
                        }
                      }}
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
        <strong>Undo</strong> only reverses flags that upload set — voters flagged individually on their
        profile keep their flag.
      </p>
    </div>
  );
}
