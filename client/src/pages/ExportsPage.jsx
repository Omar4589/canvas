import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import Section from '../components/Section.jsx';
import DateRangeSelector from '../components/DateRangeSelector.jsx';
import InfoHint from '../components/InfoHint.jsx';
import Pager from '../components/Pager.jsx';
import { Button, Select, EmptyState, SkeletonRows } from '../components/ui/index.js';
import { downloadFile } from '../lib/downloadFile.js';

// The Export Center: queue background CSV/ZIP exports (built on the worker dyno), then
// download them from the history below until they expire. Admins see every type; leads see
// the campaign-scoped ones for campaigns they manage (the server enforces both). Works
// unchanged for suspended/canceled orgs — creating an export is the one write a read-only
// org may perform (the wind-down export window), and BillingBanner already points here.

function buildQuery(params) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return q ? `?${q}` : '';
}

const TYPES = [
  {
    id: 'canvass-activity',
    label: 'Canvassing activity',
    desc: 'Every door result: who knocked, when, the outcome, and the voter at that door.',
    filters: ['date', 'effort', 'pass', 'canvasser'],
  },
  {
    id: 'doors-by-round',
    label: 'Doors by round',
    desc: 'One row per door per round with its status — filterable to a re-knock list.',
    filters: ['effort', 'pass', 'roundStatus'],
  },
  {
    id: 'survey-results',
    label: 'Survey results',
    desc: 'One row per survey taken, one column per question. A voter surveyed again in a later round is another row.',
    filters: ['date', 'effort', 'pass', 'canvasser'],
  },
  {
    id: 'survey-answers',
    label: 'Survey answers (detailed)',
    desc: 'One row per recorded answer, exactly as captured at the door — the audit-grade record.',
    filters: ['date', 'effort', 'pass', 'canvasser'],
  },
  {
    id: 'voter-file',
    label: 'Voter file',
    desc: 'Your voter file, rebuilt from the data currently in Doorline — optionally using an import’s own vendor column names.',
    filters: ['import'],
  },
  {
    id: 'voters-filtered',
    label: 'Filtered voters',
    desc: 'Only the voters matching one of your saved searches.',
    filters: ['savedSearch'],
  },
  {
    id: 'voter-notes',
    label: 'Voter notes',
    desc: 'Staff notes about voters, with author and date.',
    filters: ['date'],
    adminOnly: true,
  },
  {
    id: 'full-backup',
    label: 'Full backup (ZIP)',
    desc: 'Everything in one bundle: voter file, activity, doors by round, surveys, notes, and per-round totals — with a manifest.',
    filters: ['backupScope'],
    adminOnly: true,
  },
];

const ROUND_STATUSES = ['unknocked', 'not_home', 'wrong_address', 'refused', 'surveyed', 'lit_dropped', 'restricted'];

const STATUS_LABEL = {
  pending: 'Queued',
  running: 'Building',
  completed: 'Ready',
  failed: 'Failed',
  canceled: 'Canceled',
  expired: 'Expired',
};

function StatusBadge({ job }) {
  const cls = {
    pending: 'bg-sunken text-fg-muted',
    running: 'bg-brand-tint text-brand-accent',
    completed: 'bg-success-tint text-success',
    failed: 'bg-danger-tint text-danger',
    canceled: 'bg-sunken text-fg-muted',
    expired: 'bg-sunken text-fg-muted',
  }[job.status] || 'bg-sunken text-fg-muted';
  const showPct = job.status === 'running' && job.progress != null && job.progress > 0;
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>
      {STATUS_LABEL[job.status] || job.status}
      {showPct ? ` ${job.progress}%` : ''}
    </span>
  );
}

const fmtBytes = (n) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const daysLeft = (expiresAt) => {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
};

// Compact human summary of a job's frozen params for the Scope column.
function scopeLabel(job, { effortName, passName, canvasserName }) {
  const p = job.params || {};
  const bits = [];
  if (job.type === 'full-backup') bits.push(job.campaignId ? 'This campaign' : 'Entire organization');
  if (p.savedSearchName) bits.push(p.savedSearchName);
  if (p.importJobId) bits.push('From import');
  if (p.effortId) bits.push(effortName(p.effortId) || 'Walk list');
  if (p.passId) bits.push(p.passId === 'legacy' ? 'Legacy / no pass' : passName(p.passId) || 'Round');
  if (p.userId) bits.push(canvasserName(p.userId) || 'Canvasser');
  if (p.roundStatuses?.length) bits.push(`Status: ${p.roundStatuses.join(', ')}`);
  if (p.from || p.to) bits.push([p.from, p.to].filter(Boolean).join(' → '));
  return bits.join(' · ') || 'Everything';
}

export default function ExportsPage() {
  const { campaignId } = useParams();
  const { isLead } = useAuth();
  const { selected: campaign } = useCampaignSelection(campaignId);
  const qc = useQueryClient();
  const tz = campaign?.timeZone;

  const [typeId, setTypeId] = useState('canvass-activity');
  const [dateRange, setDateRange] = useState({ preset: 'all', from: null, to: null });
  const [effortId, setEffortId] = useState('');
  const [passId, setPassId] = useState('');
  const [userId, setUserId] = useState('');
  const [roundStatus, setRoundStatus] = useState('');
  const [savedSearchId, setSavedSearchId] = useState('');
  const [importJobId, setImportJobId] = useState('');
  const [backupScope, setBackupScope] = useState('campaign');
  const [skip, setSkip] = useState(0);
  const [rowBusy, setRowBusy] = useState(null); // jobId of an in-flight download/delete
  const [rowError, setRowError] = useState('');

  const visibleTypes = TYPES.filter((t) => !t.adminOnly || !isLead);
  const type = visibleTypes.find((t) => t.id === typeId) || visibleTypes[0];
  const wants = (f) => type.filters.includes(f);

  // ── option sources (all existing endpoints) ────────────────────────────────────────────
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const efforts = effortsQ.data?.efforts || [];
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId, effortId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes${buildQuery({ effortId: effortId || undefined })}`),
    enabled: !!campaignId,
  });
  const passes = passesQ.data?.passes || [];
  // Ledger-first (NOT the roster): a deleted canvasser's rows must stay exportable, and
  // this endpoint keeps them selectable. Bare array response.
  const canvassersQ = useQuery({
    queryKey: ['reports', 'canvassers', campaignId],
    queryFn: () => api(`/admin/reports/canvassers${buildQuery({ campaignId })}`),
    enabled: !!campaignId && wants('canvasser'),
  });
  const canvassers = Array.isArray(canvassersQ.data) ? canvassersQ.data : [];
  const walkListsQ = useQuery({
    queryKey: ['admin', 'walklists', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/walklists`),
    enabled: !!campaignId && wants('savedSearch'),
  });
  const walkLists = walkListsQ.data?.walkLists || [];
  // /admin/imports returns in-flight/failed/undone jobs too (capped at 50) — the picker
  // wants only reconstructable ones.
  const importsQ = useQuery({
    queryKey: ['imports', campaignId],
    queryFn: () => api(`/admin/imports${buildQuery({ campaignId })}`),
    enabled: !!campaignId && wants('import'),
  });
  const imports = (importsQ.data?.jobs || []).filter((j) => j.status === 'completed' && !j.undone);

  // ── the history list (polls only while something is in flight) ─────────────────────────
  const listQ = useQuery({
    queryKey: ['admin', 'exports', campaignId, skip],
    queryFn: () => api(`/admin/exports${buildQuery({ campaignId, skip, limit: 20 })}`),
    enabled: !!campaignId,
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs || [];
      return jobs.some((j) => ['pending', 'running'].includes(j.status)) ? 1500 : false;
    },
  });
  const jobs = listQ.data?.jobs || [];
  const total = listQ.data?.total || 0;

  const workerQ = useQuery({
    queryKey: ['admin', 'exports', 'worker-status'],
    queryFn: () => api('/admin/exports/worker-status'),
    refetchInterval: 15000,
  });
  const workerOffline = workerQ.data?.online === false;

  const effortName = (id) => efforts.find((e) => String(e._id) === String(id))?.name;
  const passName = (id) => {
    const p = passes.find((x) => String(x._id) === String(id));
    return p ? `Pass ${p.roundNumber} · ${p.name}` : null;
  };
  const canvasserName = (id) => {
    const c = canvassers.find((x) => String(x.userId) === String(id));
    return c ? `${c.firstName} ${c.lastName}`.trim() : null;
  };

  // ── create ─────────────────────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (body) => api('/admin/exports', { method: 'POST', body }),
    onSuccess: () => {
      setRowError('');
      qc.invalidateQueries({ queryKey: ['admin', 'exports', campaignId] });
      setSkip(0);
    },
  });

  function paramsForCreate() {
    const p = {};
    if (wants('date') && (dateRange?.from || dateRange?.to)) {
      if (dateRange.from) p.from = dateRange.from;
      if (dateRange.to) p.to = dateRange.to;
    }
    if (wants('effort') && effortId) p.effortId = effortId;
    if (wants('pass') && passId) p.passId = passId;
    if (wants('canvasser') && userId) p.userId = userId;
    if (wants('roundStatus') && roundStatus) p.roundStatuses = [roundStatus];
    if (wants('savedSearch')) p.savedSearchId = savedSearchId;
    if (wants('import') && importJobId) p.importJobId = importJobId;
    return p;
  }

  function queueExport() {
    const body = { type: type.id, params: paramsForCreate() };
    if (!(type.id === 'full-backup' && backupScope === 'org')) body.campaignId = campaignId;
    createMut.mutate(body);
  }

  const createDisabled =
    createMut.isPending ||
    (wants('savedSearch') && !savedSearchId) ||
    !campaignId;

  // ── row actions ────────────────────────────────────────────────────────────────────────
  async function downloadJob(job) {
    setRowError('');
    setRowBusy(job._id);
    try {
      await downloadFile(`/admin/exports/${job._id}/download`, { fallbackName: `${job.type}.csv` });
    } catch (err) {
      setRowError(err.message || 'Download failed');
      qc.invalidateQueries({ queryKey: ['admin', 'exports', campaignId] });
    } finally {
      setRowBusy(null);
    }
  }
  const deleteMut = useMutation({
    mutationFn: (id) => api(`/admin/exports/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'exports', campaignId] }),
  });
  function retryJob(job) {
    // No retry route on purpose: re-POST the frozen params (the server re-validates and
    // re-stamps the anchor tz), so the entitlement carve-out stays one exact path.
    const body = { type: job.type, params: job.params || {} };
    if (job.campaignId) body.campaignId = job.campaignId;
    createMut.mutate(body);
  }

  const selectCls = 'min-w-[12rem]';

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-fg">Exports</h1>
        <p className="text-sm text-fg-muted">
          Your data is yours — queue an export, download it below when it’s ready. Files are
          kept for 7 days, then deleted automatically.
        </p>
      </div>

      {workerOffline && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          Exports are built in the background, and the background worker looks offline right
          now — your export will start as soon as it returns.
        </div>
      )}

      <Section title="New export">
        <div className="grid gap-2 sm:grid-cols-2">
          {visibleTypes.map((t) => {
            const active = t.id === type.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTypeId(t.id)}
                className={`rounded-md border p-3 text-left transition-colors ${
                  active ? 'border-brand-600 bg-brand-tint' : 'border-border bg-card hover:border-border-strong'
                }`}
              >
                <div className="text-sm font-medium text-fg">{t.label}</div>
                <div className="mt-0.5 text-xs text-fg-muted">{t.desc}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          {wants('date') && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Date range</div>
              <DateRangeSelector value={dateRange} onChange={setDateRange} tz={tz} />
            </div>
          )}
          {wants('effort') && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Walk list</div>
              <Select className={selectCls} value={effortId} onChange={(e) => { setEffortId(e.target.value); setPassId(''); }}>
                <option value="">All walk lists</option>
                {efforts.map((ef) => (
                  <option key={ef._id} value={ef._id}>{ef.name}</option>
                ))}
              </Select>
            </div>
          )}
          {wants('pass') && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Round</div>
              <Select className={selectCls} value={passId} onChange={(e) => setPassId(e.target.value)}>
                <option value="">All rounds</option>
                {passes.map((p) => (
                  <option key={p._id} value={p._id}>{`Pass ${p.roundNumber} · ${p.name}`}</option>
                ))}
                <option value="legacy">Legacy / no pass</option>
              </Select>
            </div>
          )}
          {wants('canvasser') && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Canvasser</div>
              <Select className={selectCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">All canvassers</option>
                {canvassers.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {`${c.firstName} ${c.lastName}`.trim() || 'Unknown'}
                    {c.status && c.status !== 'active' ? ` (${c.status})` : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {wants('roundStatus') && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Only doors with status</div>
              <Select className={selectCls} value={roundStatus} onChange={(e) => setRoundStatus(e.target.value)}>
                <option value="">Any status</option>
                {ROUND_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </Select>
            </div>
          )}
          {wants('savedSearch') && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Saved search</div>
              <Select className={selectCls} value={savedSearchId} onChange={(e) => setSavedSearchId(e.target.value)}>
                <option value="">Pick a saved search…</option>
                {walkLists.map((w) => (
                  <option key={w._id} value={w._id}>{w.name}</option>
                ))}
              </Select>
              <div className="mt-1 text-xs text-fg-muted">
                Need a different subset? Build a saved search first on the Saved Searches page.
              </div>
            </div>
          )}
          {wants('import') && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Columns</div>
              <Select className={selectCls} value={importJobId} onChange={(e) => setImportJobId(e.target.value)}>
                <option value="">Current data, standard columns</option>
                {imports.map((j) => (
                  <option key={j._id} value={j._id}>
                    {`${j.filename || 'import'} — ${new Date(j.createdAt).toLocaleDateString()}`}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {wants('backupScope') && !isLead && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Scope</div>
              <Select className={selectCls} value={backupScope} onChange={(e) => setBackupScope(e.target.value)}>
                <option value="campaign">This campaign</option>
                <option value="org">Entire organization</option>
              </Select>
            </div>
          )}
          <Button onClick={queueExport} loading={createMut.isPending} disabled={createDisabled}>
            Queue export
          </Button>
        </div>

        {type.id === 'voter-file' && (
          <div className="mt-3 rounded-md border border-warning/40 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
            This rebuilds a file from the voter data currently in Doorline{importJobId ? ', using the column names from that upload' : ''}.
            It is not the original file: columns that weren’t mapped during import aren’t included, rows that
            failed import aren’t included, and edits made since the upload are reflected.
          </div>
        )}

        <div className="mt-3 flex items-center gap-1 text-xs text-fg-muted">
          Do-not-contact voters are excluded from every export, so totals here can be lower than dashboard counts.
          <InfoHint label="Why totals can differ">
            When someone asks not to be contacted, they’re excluded from every export from then on —
            including records made before they asked. Dashboards still count the historical activity,
            so an export can show fewer rows than the screen it mirrors. Each export records how many
            rows were withheld.
          </InfoHint>
        </div>

        {createMut.isError && (
          <div className="mt-3 rounded-md border border-danger/40 bg-danger-tint px-3 py-2 text-sm text-danger">
            {createMut.error?.message || 'Could not queue the export'}
          </div>
        )}
      </Section>

      <Section title="Export history">
        {listQ.isLoading ? (
          <SkeletonRows rows={4} />
        ) : jobs.length === 0 ? (
          <EmptyState
            title="No exports yet"
            hint="Queue one above — you’ll download it here, and it stays available for 7 days."
          />
        ) : (
          <>
            {rowError && (
              <div className="mb-3 rounded-md border border-danger/40 bg-danger-tint px-3 py-2 text-sm text-danger">
                {rowError}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Scope</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Requested</th>
                    <th className="py-2 pr-3 text-right">Rows</th>
                    <th className="py-2 pr-3 text-right">Size</th>
                    <th className="py-2 pr-3">Expires</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const t = TYPES.find((x) => x.id === job.type);
                    const dl = daysLeft(job.expiresAt);
                    const downloadable = job.status === 'completed' && (dl === null || dl > 0);
                    return (
                      <tr key={job._id} className="border-b border-border align-top">
                        <td className="py-2 pr-3 font-medium text-fg">{t?.label || job.type}</td>
                        <td className="py-2 pr-3 text-fg-muted">
                          {scopeLabel(job, { effortName, passName, canvasserName })}
                          {job.excludedDncCount > 0 && (
                            <div className="text-xs text-fg-subtle">{job.excludedDncCount} withheld (do not contact)</div>
                          )}
                          {job.status === 'failed' && job.error && (
                            <div className="text-xs text-danger">{job.error}</div>
                          )}
                        </td>
                        <td className="py-2 pr-3"><StatusBadge job={job} /></td>
                        <td className="py-2 pr-3 text-fg-muted">
                          {job.requestedBy ? `${job.requestedBy.firstName || ''} ${job.requestedBy.lastName || ''}`.trim() : ''}
                          <div className="text-xs text-fg-subtle">{new Date(job.createdAt).toLocaleString()}</div>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{job.rowCount || ''}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtBytes(job.bytes)}</td>
                        <td className="py-2 pr-3 text-fg-muted">
                          {job.status === 'completed' && dl !== null ? (dl > 0 ? `in ${dl} day${dl === 1 ? '' : 's'}` : 'expired') : ''}
                          {job.status === 'expired' ? 'expired' : ''}
                        </td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-2">
                            {downloadable && (
                              <Button size="sm" loading={rowBusy === job._id} onClick={() => downloadJob(job)}>
                                Download
                              </Button>
                            )}
                            {job.status === 'failed' && (
                              <Button size="sm" variant="secondary" onClick={() => retryJob(job)}>
                                Retry
                              </Button>
                            )}
                            {job.status !== 'running' && (
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => {
                                  if (window.confirm('Delete this export? A downloaded copy is unaffected.')) {
                                    deleteMut.mutate(job._id);
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager skip={skip} limit={20} total={total} onChange={setSkip} className="mt-3" />
          </>
        )}
      </Section>
    </div>
  );
}
