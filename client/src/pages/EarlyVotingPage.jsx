import { useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import IdColumnPicker, { SheetNote } from '../components/IdColumnPicker.jsx';
import { saveTextFile } from '../lib/downloadFile.js';
import { formatInTz } from '../lib/datetime.js';
import {
  describeIdsInFile,
  zeroMatchLine,
  historySubtitle,
  idListTooBig,
  idListTooBigText,
  fileLine,
  sheetNote,
  refusalView,
  lastIdColumn,
  suggestedColumn,
  keepToSend,
  ticksChanged,
  keptLine,
  requestErrorText,
} from '../lib/idListPreview.js';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

// "Count only rows where" (docs/PROPOSAL_ID_LIST_EXCEL.md, call A): an election office's returns file
// lists rejected and suspended ballots too, so the admin picks a column (a ballot status) and ticks
// which of its values count. Ticks stay local until Count these rows re-runs the preview. The controls
// stay enabled while a preview runs (the box stays on screen, page below), so keyboard focus is never
// thrown back to the page; Count these rows is aria-disabled, not disabled, for the same reason.
// `column` is the column last ASKED for: while its values are on their way, the old column's boxes are
// not offered (ticking them would tick values the new column may not have). `locked` while marking:
// nothing on screen may change while an apply writes. Exported for its render test
// (lib/idListExcelRender.smoke.test.js).
export const KeepRows = ({ pv, column = pv.keep?.column || '', ticks, onColumn, onToggle, onCount, busy, counting = false, dirty, locked = false }) => {
  const keep = pv.keep;
  const options = (pv.columns || []).filter((c) => c !== pv.idColumn);
  // A file with nothing but its ID column has nothing to count by.
  if (!options.length && !keep) return null;
  const listing = column !== (keep?.column || '');
  const countable = dirty && !busy && !locked;
  return (
    <div className="mt-3 border-t border-border pt-3 text-xs text-fg-muted">
      <label className="inline-flex items-center gap-1">
        Count only rows where
        <select
          value={column}
          onChange={(e) => onColumn(e.target.value)}
          disabled={locked}
          aria-label="Count only rows where"
          className="rounded border border-border-strong bg-card px-1.5 py-0.5 text-xs text-fg disabled:opacity-50"
        >
          <option value="">— every row —</option>
          {options.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      {listing && column && <p className="mt-1">Listing {column}&apos;s values…</p>}
      {!listing && keep?.tooMany && <p className="mt-1">{keep.column} has more than 25 different values; pick a column with a few, like a status.</p>}
      {!listing && keep?.tooLong && <p className="mt-1">{keep.column} has values too long to count by.</p>}
      {!listing && keep && !keep.tooMany && !keep.tooLong && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {keep.values.map(({ value, rows }) => (
            <label key={value} className="inline-flex items-center gap-1 text-fg">
              <input type="checkbox" checked={ticks.includes(value)} onChange={() => onToggle(value)} disabled={locked} />
              {value === '' ? '(blank)' : value} · {fmt(rows)}
            </label>
          ))}
          <button
            type="button"
            onClick={() => countable && onCount()}
            aria-disabled={!countable}
            className="rounded border border-border-strong px-2 py-1 text-xs font-medium text-fg hover:bg-card aria-disabled:opacity-50"
          >
            {counting ? 'Counting…' : 'Count these rows'}
          </button>
        </div>
      )}
    </div>
  );
};

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
  // The ticked "Count only rows where" values while the admin changes them (null = what the last
  // preview counted). The APPLY sends the last preview RESPONSE's keep, never these.
  const [keepTicks, setKeepTicks] = useState(null);
  // The last preview the server ANSWERED for this file, kept on screen while the next one runs, so the
  // box (and the control the admin is on) doesn't vanish on every change — TanStack clears a mutation's
  // data while it's pending. Set by call-level callbacks, which TanStack fires only for the NEWEST mutate
  // call, so an older answer can never land last. Apply reads `preview.data`, empty while a preview
  // runs, so it is off until the numbers on screen are current.
  const [shown, setShown] = useState(null);
  const [unmarkId, setUnmarkId] = useState('');

  // Early-voting uploads belong to this campaign → show times in its tz (fallback org).
  const tz = selected?.timeZone || orgTz;

  const historyQ = useQuery({
    queryKey: ['voted', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/voted`),
    enabled: !!campaignId,
  });

  const formOf = (f, col, keep) => {
    const fd = new FormData();
    fd.append('file', f);
    if (col) fd.append('idColumn', col);
    if (keep?.column) {
      fd.append('keepColumn', keep.column);
      if (Array.isArray(keep.selected)) fd.append('keepSelected', JSON.stringify(keep.selected));
    }
    return fd;
  };
  const preview = useMutation({
    mutationFn: ({ file: f, idColumn: col, keep }) =>
      api(`/admin/campaigns/${campaignId}/voted/preview`, { method: 'POST', formData: formOf(f, col, keep) }),
  });

  const apply = useMutation({
    mutationFn: ({ file: f, idColumn: col, keep }) =>
      api(`/admin/campaigns/${campaignId}/voted/import`, { method: 'POST', formData: formOf(f, col, keep) }),
    onSuccess: () => {
      setFile(null);
      setIdColumn('');
      setKeepTicks(null);
      setShown(null);
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

  // A new preview also clears an earlier apply's error, so one failure never shows twice.
  const runPreview = (vars) => {
    if (apply.isError) apply.reset();
    preview.mutate(vars, { onSuccess: (data) => setShown(data), onError: () => setShown(null) });
  };

  function onPickFile(f) {
    setFile(f);
    setIdColumn('');
    setKeepTicks(null);
    setShown(null);
    apply.reset();
    // Over the size limit: refused right here, before anything uploads.
    if (f && campaignId && !idListTooBig(f)) runPreview({ file: f, idColumn: '' });
    else preview.reset();
  }

  const pv = shown;
  // What the last answered preview counted (Apply's and the Count button's yardstick).
  const keptKeep = keepToSend(pv);
  // What the page last ASKED for, answered or not: every new request starts from it, so a change made
  // while a preview runs never reverts another (round-2 code review: a counting column chosen during an
  // ID-column change used to send the old ID column).
  const pendingVars = preview.isPending ? preview.variables : null;
  const askedIdColumn = (pendingVars ? pendingVars.idColumn : pv?.idColumn) || pv?.idColumn || '';
  const askedKeep = pendingVars ? pendingVars.keep ?? null : keptKeep;
  // Nothing on screen changes while an apply writes: the numbers shown are the numbers being marked.
  const locked = apply.isPending;
  // Changing the column re-runs the preview on it; the preview's response then owns the value. A
  // counting column that has just become the ID column is dropped.
  function onChangeColumn(col) {
    if (locked) return;
    setIdColumn(col);
    setKeepTicks(null);
    if (file && col) runPreview({ file, idColumn: col, keep: askedKeep && askedKeep.column !== col ? askedKeep : null });
  }
  // Choosing a counting column lists its values, every one ticked; Count these rows sends the ticks.
  function onKeepColumn(column) {
    if (locked) return;
    setKeepTicks(null);
    if (file && pv) runPreview({ file, idColumn: askedIdColumn, keep: column ? { column } : null });
  }
  // The ticks belong to the column they were ticked on, and only values that column has count: a stale
  // tick from another column can never leave Apply waiting for a Count that can't clear it.
  const shownKeep = pv?.keep && !pv.keep.tooMany && !pv.keep.tooLong ? pv.keep : null;
  const ticks =
    keepTicks && shownKeep && keepTicks.column === shownKeep.column
      ? keepTicks.values.filter((v) => shownKeep.values.some((x) => x.value === v))
      : shownKeep?.selected ?? [];
  const ticksDirty = ticksChanged(ticks, keptKeep);
  function onToggleKeep(value) {
    if (locked || !shownKeep) return;
    setKeepTicks({ column: shownKeep.column, values: ticks.includes(value) ? ticks.filter((v) => v !== value) : [...ticks, value] });
  }
  // The ticks stay as they are while it counts; once the answer lands they ARE what was counted.
  function onCountRows() {
    if (!file || !keptKeep || preview.isPending || locked) return;
    runPreview({ file, idColumn: pv.idColumn, keep: { column: keptKeep.column, selected: ticks } });
  }

  function downloadUnmatched() {
    const ids = pv?.notFoundIds || [];
    if (!ids.length) return;
    saveTextFile(`voterId\n${ids.join('\n')}\n`, 'unmatched-voter-ids.csv');
  }

  // A refused preview: the column picker only when the server couldn't find a column (code-less 400
  // with the column list); every other refusal is its sentence (lib/idListPreview.js refusalView).
  const refused = refusalView(preview.error, { page: 'early-voting' });
  // Offered, never matched: the column the newest upload that wasn't undone used, when this file has it.
  const suggested = suggestedColumn(refused, lastIdColumn(historyQ.data?.uploads));
  const pickedColumn = idColumn || suggested || '';
  // Apply runs only on a settled preview — the one on screen — with its counting exactly as counted.
  const settled = preview.isPending ? null : preview.data;
  const canApply = file && campaignId && settled && settled.willMark > 0 && !ticksDirty && !apply.isPending;

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
            <label className="mb-1 block text-xs font-medium text-fg-muted">Voted-voters file (CSV or Excel)</label>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xls,.xlsx"
              // Off while marking: the apply's success clears the page, which would wipe a file picked meanwhile.
              disabled={!campaignId || apply.isPending}
              aria-describedby={file ? 'early-voting-file' : undefined}
              onChange={(e) => {
                onPickFile(e.target.files?.[0] || null);
                // Cleared so picking the same file again (fixed in Excel) runs again; the File stays in state.
                e.target.value = '';
              }}
              className="block w-full text-sm disabled:opacity-50"
            />
            {file && <p id="early-voting-file" className="mt-1 text-xs text-fg-muted">{fileLine(file)}</p>}
            {preview.isPending && <p className="mt-1 text-xs text-fg-muted">Matching…</p>}
            {refused?.kind === 'picker' && (
              <IdColumnPicker
                undetected
                columns={refused.columns}
                value={pickedColumn}
                onChange={setIdColumn}
                onMatch={() => file && pickedColumn && runPreview({ file, idColumn: pickedColumn })}
                busy={preview.isPending}
                note={refused.sheet}
                headerRowHint={refused.headerRowHint}
                excel={refused.excel}
                suggested={suggested}
              />
            )}
            {refused?.kind === 'message' && (
              <>
                <SheetNote note={refused.sheet} className="mt-2" />
                <p className="mt-1 text-xs text-danger">{refused.text}</p>
              </>
            )}
            {idListTooBig(file) && (
              <p className="mt-1 text-xs text-danger">{idListTooBigText('the voters who have already voted')}</p>
            )}
          </div>
        </div>

        {pv && (
          <div className="mb-4 rounded border border-border bg-sunken p-4 text-sm">
            <SheetNote note={sheetNote(pv)} className="mb-3" />
            <div className="mb-1 text-xs text-fg-muted">
              {/* Not disabled while a preview runs (focus stays where it is); shows what was asked for. */}
              <IdColumnPicker columns={pv.columns || []} value={askedIdColumn} onChange={onChangeColumn} busy={locked} />
              {' · '}
              {describeIdsInFile(pv, { counted: !!keptLine(pv) })}
            </div>
            {keptLine(pv) && <p className="mb-1 text-xs font-medium text-fg">{keptLine(pv)}</p>}
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
            <KeepRows
              pv={pv}
              column={askedKeep?.column || ''}
              ticks={ticks}
              onColumn={onKeepColumn}
              onToggle={onToggleKeep}
              onCount={onCountRows}
              busy={preview.isPending}
              counting={!!pendingVars?.keep?.selected}
              dirty={ticksDirty}
              locked={locked}
            />
          </div>
        )}

        <button
          onClick={() => canApply && apply.mutate({ file, idColumn: settled.idColumn, keep: keepToSend(settled) })}
          disabled={!canApply}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {apply.isPending ? 'Applying…' : 'Mark these voters voted'}
        </button>
        {ticksDirty && !preview.isPending && <p className="mt-1 text-xs text-fg-muted">Press Count these rows to update the numbers first.</p>}
        {apply.error && (
          <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{requestErrorText(apply.error)}</div>
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
