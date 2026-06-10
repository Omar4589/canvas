import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import { getStoredCampaignId, setStoredCampaignId } from '../components/CampaignSelector.jsx';
import NextStepBanner from '../components/NextStepBanner.jsx';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // server-enforced upload cap
const LARGE_FILE_BYTES = 15 * 1024 * 1024; // at/above this, route the preview to the background worker
const fmtMB = (b) => `${(b / (1024 * 1024)).toFixed(1)} MB`;

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function StatusBadge({ job }) {
  const cls = {
    pending: 'bg-sunken text-fg-muted',
    parsing: 'bg-warning-tint text-warning-fg',
    completed: 'bg-success-tint text-success',
    failed: 'bg-danger-tint text-danger',
  }[job.status] || 'bg-sunken text-fg-muted';
  const showPct = (job.status === 'parsing' || job.status === 'pending') && job.progress != null;
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>
      {job.status}
      {showPct ? ` ${job.progress}%` : ''}
    </span>
  );
}

const addr1 = (norm) => String(norm || '').split('|')[0];

function DiffStat({ label, value, amber }) {
  const hot = amber && value > 0;
  return (
    <div className={`rounded border p-3 ${hot ? 'border-warning/30 bg-warning-tint' : 'border-border bg-card'}`}>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${hot ? 'text-warning-fg' : 'text-fg'}`}>{fmt(value)}</div>
    </div>
  );
}

function SampleList({ title, count, children }) {
  if (!count) return null;
  return (
    <details className="rounded border border-border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{title} ({fmt(count)})</summary>
      <div className="border-t border-border px-3 py-2 text-xs text-fg-muted">{children}</div>
    </details>
  );
}

function ReviewPanel({ diff }) {
  const { totals, rowIssues, samples } = diff;
  const skipped = rowIssues.missingRequired + rowIssues.noCoordinates + rowIssues.duplicateInFile;
  const hasWarnings = totals.movedVoters > 0 || totals.orphanedDoors > 0 || totals.nearDuplicates > 0;
  return (
    <div className="mb-4 rounded border border-border bg-sunken p-4">
      <h3 className="mb-3 text-sm font-medium">Review changes before importing</h3>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <DiffStat label="New doors" value={totals.newDoors} />
        <DiffStat label="Existing doors" value={totals.existingDoors} />
        <DiffStat label="New voters" value={totals.newVoters} />
        <DiffStat label="Updated voters" value={totals.updatedVoters} />
        <DiffStat label="Voters moving doors" value={totals.movedVoters} amber />
        <DiffStat label="Doors emptied" value={totals.orphanedDoors} amber />
        <DiffStat label="Near-dup addresses" value={totals.nearDuplicates} amber />
        <DiffStat label="Rows skipped" value={skipped} amber />
      </div>

      {hasWarnings && (
        <p className="mt-3 text-xs text-warning-fg">
          Amber items are worth a look before you confirm: voters changing addresses, doors that will be
          emptied (and dropped from the field), and addresses that look like re-spellings of existing ones.
        </p>
      )}

      <div className="mt-3 space-y-2">
        <SampleList title="Voters moving to a different door" count={totals.movedVoters}>
          <ul className="space-y-1">
            {samples.moved.map((m, i) => (
              <li key={i}>
                <span className="font-medium">{m.name || m.stateVoterId}</span>: {addr1(m.fromAddress)} → {addr1(m.toAddress)}{m.toIsNew ? ' (new door → Intake)' : ''}
              </li>
            ))}
            {totals.movedVoters > samples.moved.length && (
              <li className="text-fg-subtle">+{fmt(totals.movedVoters - samples.moved.length)} more</li>
            )}
          </ul>
        </SampleList>
        <SampleList title="Doors that will be emptied" count={totals.orphanedDoors}>
          <ul className="space-y-1">
            {samples.orphans.map((o, i) => (
              <li key={i}>{addr1(o.address)} ({fmt(o.voterCount)} voter{o.voterCount === 1 ? '' : 's'} leaving)</li>
            ))}
            {totals.orphanedDoors > samples.orphans.length && (
              <li className="text-fg-subtle">+{fmt(totals.orphanedDoors - samples.orphans.length)} more</li>
            )}
          </ul>
        </SampleList>
        <SampleList title="Near-duplicate addresses (won't merge)" count={totals.nearDuplicates}>
          <ul className="space-y-1">
            {samples.nearDups.map((n, i) => (
              <li key={i}>{addr1(n.newAddress)} ↔ {addr1(n.existingAddress)}</li>
            ))}
            {totals.nearDuplicates > samples.nearDups.length && (
              <li className="text-fg-subtle">+{fmt(totals.nearDuplicates - samples.nearDups.length)} more</li>
            )}
          </ul>
        </SampleList>
        <SampleList title="Rows skipped" count={skipped}>
          {rowIssues.missingRequired > 0 && <div>{fmt(rowIssues.missingRequired)} missing required fields</div>}
          {rowIssues.noCoordinates > 0 && <div>{fmt(rowIssues.noCoordinates)} missing/invalid coordinates</div>}
          {rowIssues.duplicateInFile > 0 && <div>{fmt(rowIssues.duplicateInFile)} duplicate Voter IDs within the file (first kept)</div>}
        </SampleList>
      </div>
    </div>
  );
}

export default function ImportPage() {
  const queryClient = useQueryClient();
  const orgTz = useOrgTimeZone();
  const [file, setFile] = useState(null);
  // Default to the campaign the admin was last working (e.g. one they just created
  // and clicked "Import voters" from), so the handoff lands pre-scoped.
  const [campaignId, setCampaignId] = useState(() => getStoredCampaignId());
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState({});
  const [profileName, setProfileName] = useState('');
  const [step, setStep] = useState('select'); // 'select' | 'map' | 'review'
  const [justImported, setJustImported] = useState(null); // campaignId of the last queued import
  const [previewJobId, setPreviewJobId] = useState(null); // async (large-file) preview job
  const [fileNote, setFileNote] = useState(null); // { tooBig } | { sizeText, estRows, large }

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
  const workerStatusQ = useQuery({
    queryKey: ['admin', 'imports', 'worker-status'],
    queryFn: () => api('/admin/imports/worker-status'),
    refetchInterval: 15000,
  });
  const workerOffline = workerStatusQ.data?.online === false;

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

  const previewDiff = useMutation({
    mutationFn: async ({ file, campaignId, mapping }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      fd.append('mapping', JSON.stringify(mapping));
      return api('/admin/imports/csv/preview', { method: 'POST', formData: fd });
    },
    onSuccess: () => setStep('review'),
  });

  // Large files: the parse+diff can exceed the 30s request timeout, so run it on
  // the worker and poll. Same diff shape as the sync path; the render unifies both.
  const enqueuePreview = useMutation({
    mutationFn: async ({ file, campaignId, mapping }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      fd.append('mapping', JSON.stringify(mapping));
      return api('/admin/imports/csv/preview-enqueue', { method: 'POST', formData: fd });
    },
    onSuccess: (res) => setPreviewJobId(res.job?._id || null),
  });
  const previewJobQ = useQuery({
    queryKey: ['admin', 'imports', 'preview-job', previewJobId],
    queryFn: () => api(`/admin/imports/${previewJobId}`),
    enabled: !!previewJobId,
    refetchInterval: (q) => {
      const s = q.state.data?.job?.status;
      return s === 'completed' || s === 'failed' ? false : 1500;
    },
  });
  const previewAsyncJob = previewJobQ.data?.job || null;
  useEffect(() => {
    if (previewAsyncJob?.status === 'completed') setStep('review');
  }, [previewAsyncJob?.status]);

  const upload = useMutation({
    mutationFn: async ({ file, campaignId, mapping }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      fd.append('mapping', JSON.stringify(mapping));
      return api('/admin/imports/csv', { method: 'POST', formData: fd });
    },
    onSuccess: (_data, variables) => {
      resetSelection();
      queryClient.invalidateQueries({ queryKey: ['imports'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'setup-status', variables.campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign-rollup'] });
      setStoredCampaignId(variables.campaignId);
      setJustImported(variables.campaignId);
    },
  });

  const undo = useMutation({
    mutationFn: (importId) => api(`/admin/imports/${importId}/undo`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['imports'] }),
  });

  function onUndo(job) {
    if (
      !window.confirm(
        'Undo this import? It removes the net-new doors and voters it added that haven’t been claimed, ' +
          'cut, canvassed, surveyed, or voted. Anything already in use is kept. This cannot be re-done.'
      )
    ) return;
    undo.mutate(job._id);
  }

  function resetSelection() {
    setFile(null);
    setColumns([]);
    setMapping({});
    setStep('select');
    setFileNote(null);
    setPreviewJobId(null);
    previewDiff.reset();
    enqueuePreview.reset();
  }

  // Any change to the inputs makes a computed diff stale — drop back to mapping.
  function dropReview() {
    previewDiff.reset();
    enqueuePreview.reset();
    setPreviewJobId(null);
    setStep((s) => (s === 'review' ? 'map' : s));
  }

  function onPickFile(f) {
    setPreviewJobId(null);
    previewDiff.reset();
    enqueuePreview.reset();
    if (!f) { setFile(null); setFileNote(null); setStep('select'); return; }
    setFile(f);
    if (f.size > MAX_FILE_BYTES) {
      setFileNote({ tooBig: true }); // block — server would 413; don't even read headers
      setStep('select');
      return;
    }
    setFileNote({ sizeText: fmtMB(f.size), estRows: Math.round(f.size / 250), large: f.size >= LARGE_FILE_BYTES });
    preview.mutate(f); // header read is cheap (5-row peek) even for big files
  }

  function applyMapping(next) {
    // Keep only mappings whose column exists in this file's headers.
    const filtered = {};
    for (const [k, col] of Object.entries(next || {})) {
      if (columns.includes(col)) filtered[k] = col;
    }
    setMapping(filtered);
    dropReview();
  }

  const campaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);
  const requiredUnmapped = requiredKeys.filter((k) => !mapping[k]);

  // Unify the sync (small-file) and async (large-file) preview so the render reads
  // one diff / pending / error regardless of path.
  const tooBig = !!fileNote?.tooBig;
  const isLargeFile = !!file && file.size >= LARGE_FILE_BYTES;
  const diff = isLargeFile ? previewAsyncJob?.diff : previewDiff.data?.diff;
  const previewPending = isLargeFile
    ? enqueuePreview.isPending ||
      Boolean(previewJobId && previewAsyncJob?.status !== 'completed' && previewAsyncJob?.status !== 'failed')
    : previewDiff.isPending;
  const previewError = isLargeFile
    ? enqueuePreview.error ||
      (previewAsyncJob?.status === 'failed' ? { message: 'Background preview failed — check the file and try again.' } : null)
    : previewDiff.error;

  // Not gated on step === 'map': if a race leaves step === 'review' with the diff
  // cleared, the fallback "Preview changes" button must still be usable to recover.
  const canPreview = file && campaignId && requiredUnmapped.length === 0 && !previewPending && !tooBig;
  function triggerPreview() {
    if (!canPreview) return;
    if (isLargeFile) enqueuePreview.mutate({ file, campaignId, mapping });
    else previewDiff.mutate({ file, campaignId, mapping });
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">CSV Import</h1>

      {workerOffline && (
        <div className="mb-6 rounded-md border border-danger/40 bg-danger-tint px-4 py-3 text-sm text-red-800">
          <strong>The import worker appears to be offline.</strong> Queued imports won't run until the
          worker dyno is back on (Heroku → Resources → <code className="rounded bg-danger-tint px-1">worker</code>).
          {workerStatusQ.data?.waiting > 0 && ` ${fmt(workerStatusQ.data.waiting)} import(s) waiting.`}
        </div>
      )}

      <section className="mb-8 rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 text-base font-medium">Upload voter CSV</h2>
        <p className="mb-4 text-sm text-fg-muted">
          Each upload is scoped to a single campaign and runs in the background. Map your vendor's
          columns to our fields (i360, L2, a state file, …) — re-uploading is safe and won't lose
          canvass activity. New households fold in via the books editor, not automatically.
        </p>

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">Campaign</label>
            <select
              value={campaignId}
              onChange={(e) => { setCampaignId(e.target.value); setStoredCampaignId(e.target.value); dropReview(); }}
              className="w-full rounded border border-border-strong bg-card text-fg px-3 py-2 text-sm focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">— Choose a campaign —</option>
              {campaigns.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.state} · {c.type === 'survey' ? 'Survey' : 'Lit drop'})
                </option>
              ))}
            </select>
            {!campaignsQ.isLoading && !campaigns.length && (
              <p className="mt-1 text-xs text-warning-fg">
                No active campaigns. Create one on the Campaigns page first.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">CSV file</label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              className="block w-full text-sm"
            />
            {fileNote?.tooBig && (
              <div className="mt-2 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">
                This file is over the 50 MB limit. Split it into smaller files (e.g. by region or county) and
                upload each — imports are additive, so the end result is identical.
              </div>
            )}
            {fileNote && !fileNote.tooBig && (
              <p className="mt-1 text-xs text-fg-muted">
                {fileNote.sizeText} · ~{fileNote.estRows.toLocaleString()} rows (est.)
                {fileNote.large && (
                  <span className="text-warning-fg"> · large file — analyzed in the background (needs the import worker running)</span>
                )}
              </p>
            )}
            {preview.isPending && <p className="mt-1 text-xs text-fg-muted">Reading columns…</p>}
            {preview.error && (
              <p className="mt-1 text-xs text-danger">{preview.error.message}</p>
            )}
          </div>
        </div>

        {step === 'map' && (
          <div className="mb-4 rounded border border-border bg-sunken p-4">
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
                  className="rounded border border-border-strong bg-card text-fg px-2 py-1 text-xs"
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
                    <label className="w-40 shrink-0 text-fg-muted">
                      {f.label}
                      {f.required && <span className="text-danger"> *</span>}
                    </label>
                    <select
                      value={mapping[f.key] || ''}
                      onChange={(e) => { setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined })); dropReview(); }}
                      className={`min-w-0 flex-1 rounded border px-2 py-1 text-xs ${
                        isReqUnmapped ? 'border-danger/40 bg-danger-tint' : 'border-border-strong bg-card text-fg'
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
              <p className="mt-3 text-xs text-danger">
                Map all required (*) fields to continue: {requiredUnmapped.join(', ')}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Save this mapping as… (e.g. i360)"
                className="rounded border border-border-strong bg-card text-fg placeholder:text-fg-subtle px-2 py-1 text-xs"
              />
              <button
                onClick={() => profileName.trim() && saveProfile.mutate({ name: profileName.trim(), mapping })}
                disabled={!profileName.trim() || saveProfile.isPending}
                className="rounded border border-border-strong px-3 py-1 text-xs font-medium hover:bg-sunken disabled:opacity-60"
              >
                {saveProfile.isPending ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </div>
        )}

        {step === 'review' && diff && <ReviewPanel diff={diff} />}

        {step === 'review' && diff ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep('map')}
              className="rounded border border-border-strong px-4 py-2 text-sm font-medium hover:bg-sunken"
            >
              Back
            </button>
            <button
              onClick={() => upload.mutate({ file, campaignId, mapping })}
              disabled={upload.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
            >
              {upload.isPending ? 'Importing…' : 'Confirm & import'}
            </button>
          </div>
        ) : (
          <button
            onClick={triggerPreview}
            disabled={!canPreview}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {previewPending ? (isLargeFile ? 'Analyzing in the background…' : 'Analyzing…') : 'Preview changes'}
          </button>
        )}
        {previewError && (
          <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            {previewError.message}
          </div>
        )}
        {upload.error && (
          <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            {upload.error.message}
          </div>
        )}
        {upload.data?.job && (
          <NextStepBanner
            tone="success"
            className="mt-3"
            title="Import queued — processing in the background."
            action={
              justImported
                ? { label: 'Go to Efforts', to: '/efforts', onClick: () => setStoredCampaignId(justImported) }
                : null
            }
          >
            New addresses land in Intake until an effort claims them.
          </NextStepBanner>
        )}
      </section>

      <h2 className="mb-3 text-base font-medium">Recent imports</h2>
      {undo.data && (
        <div className="mb-3 rounded border border-success/30 bg-success-tint px-3 py-2 text-sm text-green-800">
          Undo complete — removed {fmt(undo.data.doorsDeleted)} door(s) and {fmt(undo.data.votersDeleted)} voter(s).
          {(undo.data.doorsSkipped > 0 || undo.data.votersSkipped > 0)
            ? ` Kept ${fmt(undo.data.doorsSkipped)} door(s) and ${fmt(undo.data.votersSkipped)} voter(s) already in use.`
            : ''}
        </div>
      )}
      {undo.error && (
        <div className="mb-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{undo.error.message}</div>
      )}
      {isLoading ? (
        <div>Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Campaign</th>
                <th className="px-4 py-2 text-left">File</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Voters</th>
                <th className="px-4 py-2 text-right">Households</th>
                <th className="px-4 py-2 text-right">New</th>
                <th className="px-4 py-2 text-right">Moved / Emptied</th>
                <th className="px-4 py-2 text-right">Errors</th>
                <th className="px-4 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {(data?.jobs || []).map((j) => (
                <tr key={j._id} className="border-t border-border">
                  <td className="px-4 py-2 text-fg-muted">{formatInTz(j.createdAt, orgTz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }, true)}</td>
                  <td className="px-4 py-2">{j.campaignId?.name || '—'}</td>
                  <td className="px-4 py-2">{j.filename || '—'}</td>
                  <td className="px-4 py-2"><StatusBadge job={j} /></td>
                  <td className="px-4 py-2 text-right">{fmt(j.uniqueVoters)}</td>
                  <td className="px-4 py-2 text-right">{fmt(j.uniqueHouseholds)}</td>
                  <td className="px-4 py-2 text-right">{fmt(j.newVoters)} v / {fmt(j.newHouseholds)} h</td>
                  <td className="px-4 py-2 text-right">{fmt(j.movedVoters)} / {fmt(j.deactivatedDoors)}</td>
                  <td className="px-4 py-2 text-right">{fmt(j.errorCount)}</td>
                  <td className="px-4 py-2 text-right">
                    {j.status === 'completed' && !j.undone ? (
                      <button onClick={() => onUndo(j)} disabled={undo.isPending} className="text-xs font-semibold text-danger hover:underline disabled:opacity-60">
                        Undo
                      </button>
                    ) : j.undone ? (
                      <span className="text-xs italic text-fg-subtle">undone</span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!data?.jobs?.length && (
                <tr>
                  <td colSpan="10" className="px-4 py-6 text-center text-fg-muted">No imports yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
