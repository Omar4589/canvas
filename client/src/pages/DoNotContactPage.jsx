import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
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

export default function DoNotContactPage() {
  const qc = useQueryClient();
  // Do-not-contact is ORG-WIDE (no campaign selector) → times in the org tz.
  const tz = useOrgTimeZone();
  const [file, setFile] = useState(null);
  // A list is for ONE state, and the upload has to say which: IDs are matched inside that state's
  // campaigns only, because two states can issue the same digits.
  const [state, setState] = useState('');
  // The admin's column override ('' = let the server detect). The APPLY sends the column the last
  // preview RESPONSE matched on, never this local value.
  const [idColumn, setIdColumn] = useState('');

  const historyQ = useQuery({
    queryKey: ['dnc'],
    queryFn: () => api('/admin/dnc'),
  });
  const states = historyQ.data?.states || [];
  const statesKey = states.join(',');
  // An organization in one state has nothing to choose; pick it for them.
  useEffect(() => {
    if (!state && states.length === 1) setState(states[0]);
  }, [state, statesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const formOf = (f, st, col) => {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('state', st);
    if (col) fd.append('idColumn', col);
    return fd;
  };
  const preview = useMutation({
    mutationFn: ({ file: f, state: st, idColumn: col }) => api('/admin/dnc/preview', { method: 'POST', formData: formOf(f, st, col) }),
  });

  const apply = useMutation({
    mutationFn: ({ file: f, state: st, idColumn: col }) => api('/admin/dnc/import', { method: 'POST', formData: formOf(f, st, col) }),
    onSuccess: () => {
      setFile(null);
      setIdColumn('');
      preview.reset();
      qc.invalidateQueries({ queryKey: ['dnc'] });
    },
  });

  const undo = useMutation({
    mutationFn: (uploadId) => api('/admin/dnc/undo', { method: 'POST', body: { uploadId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dnc'] }),
  });

  function runPreview(f, st, col) {
    if (f && st) preview.mutate({ file: f, state: st, idColumn: col });
    else preview.reset();
  }
  function onPickFile(f) {
    setFile(f);
    setIdColumn('');
    apply.reset();
    runPreview(f, state, '');
  }
  function onPickState(st) {
    setState(st);
    setIdColumn('');
    apply.reset();
    runPreview(file, st, '');
  }
  function onChangeColumn(col) {
    setIdColumn(col);
    if (col) runPreview(file, state, col);
  }

  function downloadUnmatched() {
    const ids = preview.data?.notFoundIds || [];
    if (!ids.length) return;
    saveTextFile(`voterId\n${ids.join('\n')}\n`, 'unmatched-voter-ids.csv');
  }
  function downloadOutside() {
    const ids = preview.data?.outsideState?.ids || [];
    if (!ids.length) return;
    saveTextFile(`voterId\n${ids.join('\n')}\n`, `outside-${(preview.data?.state || 'state').toLowerCase()}-voter-ids.csv`);
  }

  const pv = preview.data;
  const undetected = preview.error?.data?.columns?.length ? preview.error.data : null;
  const canApply = file && state && pv && pv.willFlag > 0 && !apply.isPending;
  const outsideStates = [...new Set((pv?.outsideState?.samples || []).flatMap((s) => s.states))].sort();

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 text-2xl font-semibold">Do Not Contact</h1>
      <p className="mb-6 text-sm text-fg-muted">
        Upload a list of voters who must <strong>not be contacted</strong>, matched by Voter ID (with or without
        leading zeros) inside the campaigns of the <strong>state the list is for</strong>. The flag is{' '}
        <strong>org-wide</strong>: it applies across <strong>every</strong> campaign and every campaign type —
        including lit drop — excluding flagged voters from walk-list exports and surveys, and a door drops off
        the books once <strong>everyone</strong> there is flagged. Flags are <strong>permanent until removed</strong> —
        undo an upload below, or remove a single voter&apos;s flag from their profile on <Link to="/voters" className="font-medium text-brand-accent hover:underline">Voters</Link>.
      </p>

      <section className="mb-8 rounded-lg border border-border bg-card p-5">
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">State the list is for</label>
            <select
              value={state}
              onChange={(e) => onPickState(e.target.value)}
              disabled={!states.length}
              className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg"
            >
              <option value="">— Choose a state —</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-fg-subtle">
              Two states can issue the same digits, so the app only matches inside this state&apos;s campaigns. A list
              covering two states is two uploads.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Do-not-contact CSV</label>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xls"
              disabled={!state}
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              className="block w-full text-sm disabled:opacity-50"
            />
            {!state && <p className="mt-1 text-xs text-fg-subtle">Pick the state first.</p>}
            {preview.isPending && <p className="mt-1 text-xs text-fg-muted">Matching…</p>}
            {undetected && (
              <IdColumnPicker
                undetected
                columns={undetected.columns}
                value={idColumn}
                onChange={setIdColumn}
                onMatch={() => file && idColumn && runPreview(file, state, idColumn)}
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
              {' · '}
              matched in {pv.state} campaigns
            </div>
            {pv.sampleIds?.length > 0 && (
              <p className="mb-2 text-[11px] text-fg-subtle">e.g. {pv.sampleIds.join(' · ')}</p>
            )}
            {zeroMatchLine(pv) && <p className="mb-3 text-xs text-fg-muted">{zeroMatchLine(pv)}</p>}
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
            {pv.outsideState?.count > 0 && (
              <div className="mt-3 rounded border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
                <strong>{fmt(pv.outsideState.count)}</strong> ID{pv.outsideState.count === 1 ? '' : 's'} in this file also match voters in
                campaigns outside {pv.state} ({outsideStates.join(', ') || 'other states'}). Nothing outside {pv.state} is flagged:
                a list is for one state, so if some of these belong there, upload them again under that state.
                <button
                  type="button"
                  onClick={downloadOutside}
                  className="ml-2 font-semibold text-brand-accent hover:underline"
                >
                  Download {fmt(pv.outsideState.count)} ID{pv.outsideState.count === 1 ? '' : 's'}
                </button>
              </div>
            )}
            {pv.notFound > 0 && (
              <div className="mt-3">
                <p className="text-xs text-fg-muted">
                  Not found — these Voter IDs matched no one in your {pv.state} campaigns. They&apos;re saved for {pv.state}: if
                  one of those voters is imported later under this exact ID, they&apos;re flagged automatically.
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
          onClick={() => canApply && apply.mutate({ file, state, idColumn: pv.idColumn })}
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
            Flagged {fmt(apply.data.flagged)} voters do-not-contact in {apply.data.state} · {fmt(apply.data.doorsDropped)} doors dropped
            {apply.data.notFound ? ` · ${fmt(apply.data.notFound)} not found` : ''}
            {apply.data.outsideState?.count ? ` · ${fmt(apply.data.outsideState.count)} outside ${apply.data.state}, not flagged` : ''}.
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
