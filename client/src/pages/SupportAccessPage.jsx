import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import Pager from '../components/Pager.jsx';
import StartSupportSessionForm from '../components/StartSupportSessionForm.jsx';

// Support access: who is currently inside a customer's data, and who has been.
//
// Doorline staff cannot enter an organization they are not a member of without a grant — a typed
// reason, a clock, and an audit row for every request that touches voter data. This page is where that becomes
// visible instead of theoretical: the sessions open right now (revocable on the spot), and the log of
// what was actually read.
//
// The log is the answer to a question we previously could not answer at all: "did anyone at Doorline
// look at my data, and why?" There was no audit model in the codebase, and morgan could not record the
// actor (its `remote-user` field is HTTP-Basic-only and we use a bearer JWT, so it is always `-`).
//
// Note what is NOT here: a member's own work. A super-admin who is genuinely the admin of an
// organization is a member, not a vendor, and their ordinary work is not logged. An audit trail that
// recorded normal work as snooping would tell you nothing about actual snooping.
const LOG_LIMIT = 50;
const DELETION_LIMIT = 25;

// Keys this page owns — kept when "End now" drops the org-scoped cache.
const PAGE_KEYS = new Set([
  'support-grants',
  'access-log',
  'access-log-facets',
  'retention-health',
  'deletion-requests',
]);

function fmtBytes(n) {
  if (!n) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Read magnitude for a log row / a grant: request-rows and payload size — NOT distinct voters.
function fmtRead(rows, bytes) {
  const parts = [];
  if (rows) parts.push(`${rows.toLocaleString()} row${rows === 1 ? '' : 's'}`);
  const b = fmtBytes(bytes);
  if (b) parts.push(b);
  return parts.length ? parts.join(' · ') : '—';
}

const DELETION_STATUSES = ['scheduled', 'completed', 'cancelled', 'failed'];

function DeletionStatusChip({ status, overdue }) {
  const cls = overdue || status === 'failed'
    ? 'bg-danger/10 text-danger'
    : status === 'scheduled'
      ? 'bg-warning-tint text-warning-fg'
      : 'bg-sunken text-fg-muted';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {overdue ? 'OVERDUE' : status}
    </span>
  );
}

export default function SupportAccessPage() {
  const qc = useQueryClient();

  // Access-log filters. grantId is set by an open session's "view its log →" link.
  const [logFilters, setLogFilters] = useState({ organizationId: '', actorUserId: '', from: '', to: '', grantId: '' });
  const [logSkip, setLogSkip] = useState(0);
  const [delStatus, setDelStatus] = useState('');
  const [delSkip, setDelSkip] = useState(0);
  const [startOrg, setStartOrg] = useState(null); // { id, name } | null
  const [startOpen, setStartOpen] = useState(false);
  const [fileForm, setFileForm] = useState(null); // { organizationId, note, requestedByEmail } | null
  const [fileError, setFileError] = useState(null);

  const grants = useQuery({
    queryKey: ['support-grants'],
    queryFn: () => api('/super-admin/access/grants?all=1'),
    refetchInterval: 30_000,
  });

  const facets = useQuery({
    queryKey: ['access-log-facets'],
    queryFn: () => api('/super-admin/access/log-facets'),
  });

  const logParams = new URLSearchParams({ limit: String(LOG_LIMIT), skip: String(logSkip) });
  for (const [k, v] of Object.entries(logFilters)) if (v) logParams.set(k, v);
  const log = useQuery({
    queryKey: ['access-log', logFilters, logSkip],
    queryFn: () => api(`/super-admin/access/log?${logParams.toString()}`),
    placeholderData: keepPreviousData,
  });

  const health = useQuery({
    queryKey: ['retention-health'],
    queryFn: () => api('/super-admin/access/health/retention'),
  });

  const delParams = new URLSearchParams({ limit: String(DELETION_LIMIT), skip: String(delSkip) });
  if (delStatus) delParams.set('status', delStatus);
  const deletions = useQuery({
    queryKey: ['deletion-requests', delStatus, delSkip],
    queryFn: () => api(`/super-admin/access/deletion-requests?${delParams.toString()}`),
    placeholderData: keepPreviousData,
  });

  // Org list for the start-session and file-deletion pickers (the platform org list, not org data).
  const orgsQ = useQuery({
    queryKey: ['super-admin', 'organizations'],
    queryFn: () => api('/super-admin/organizations'),
  });
  const orgs = orgsQ.data?.organizations || [];

  const revoke = useMutation({
    mutationFn: (id) => api(`/super-admin/access/grants/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      // Ending the session must take the customer's data OFF THE SCREEN, not just off the server.
      //
      // React Query keeps whatever you loaded during the grant. Without this, navigating back to
      // Voters after "End now" rendered the cached voter list for a beat before the refetch 403'd and
      // the banner replaced it. No new request, no new audit row — but a revoked session should not
      // still be painting a customer's voter file. Drop the org-scoped cache; keep the platform org
      // list so the switcher does not blank, and this page's own platform-level queries.
      qc.removeQueries({
        predicate: (q) =>
          !(q.queryKey?.[0] === 'super-admin' && q.queryKey?.[1] === 'organizations') &&
          !PAGE_KEYS.has(q.queryKey?.[0]),
      });
      qc.invalidateQueries({ queryKey: ['support-grants'] });
      qc.invalidateQueries({ queryKey: ['access-log'] });
    },
  });

  const cancelDeletion = useMutation({
    mutationFn: (id) => api(`/super-admin/access/deletion-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deletion-requests'] });
      qc.invalidateQueries({ queryKey: ['retention-health'] });
    },
  });

  const fileDeletion = useMutation({
    mutationFn: (body) => api('/super-admin/access/deletion-requests', { method: 'POST', body }),
    onSuccess: () => {
      setFileForm(null);
      setFileError(null);
      qc.invalidateQueries({ queryKey: ['deletion-requests'] });
    },
    onError: (err) => setFileError(err.message),
  });

  const h = health.data;
  const grantScope = grants.data?.scope;
  const entries = log.data?.entries || [];
  const logTotal = log.data?.total || 0;
  const requests = deletions.data?.requests || [];
  const delTotal = deletions.data?.total || 0;

  function setFilter(key, value) {
    setLogSkip(0);
    setLogFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Support access</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            Entering a customer organization you are not a member of requires a session: a reason, a time
            limit, and a record of every request that touches voter data. Your own organizations are unaffected.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setStartOpen((v) => !v); setStartOrg(null); }}
          className="rounded bg-brand-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          {startOpen ? 'Close' : 'Start a session'}
        </button>
      </div>

      {/* Deliberate session start — access no longer begins only by tripping a 403 somewhere. */}
      {startOpen && (
        <div className="max-w-lg rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">Start a support session</h2>
          <label className="mt-3 block text-sm font-medium text-fg" htmlFor="start-org">Organization</label>
          <select
            id="start-org"
            value={startOrg?.id || ''}
            onChange={(e) => {
              const o = orgs.find((x) => x.id === e.target.value);
              setStartOrg(o ? { id: o.id, name: o.name } : null);
            }}
            className="mt-1 w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
          >
            <option value="">Choose an organization…</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {startOrg && (
            <StartSupportSessionForm
              organizationId={startOrg.id}
              organizationName={startOrg.name}
              onCancel={() => { setStartOpen(false); setStartOrg(null); }}
              onStarted={() => {
                setStartOpen(false);
                setStartOrg(null);
                qc.invalidateQueries({ queryKey: ['support-grants'] });
              }}
            />
          )}
        </div>
      )}

      {/* Retention health lives here because it answers the same class of question — is the thing we
          promised actually happening? Red means a retention job went quiet OR a customer's deletion
          request is stuck/failed; the per-job rows below make a red state diagnosable instead of a
          dead-end sentence. */}
      {h && (
        <div
          className={`rounded border px-4 py-3 text-sm ${
            h.healthy
              ? 'border-success/30 bg-success/10'
              : 'border-danger/30 bg-danger/10'
          }`}
        >
          <div className={h.healthy ? 'text-success' : 'text-danger'}>
            <span className="font-semibold">Retention: {h.healthy ? 'enforced' : 'NOT ENFORCED'}</span>
            <span className="ml-2">{h.message}</span>
          </div>
          <div className="mt-2 space-y-1">
            {(h.jobs || []).map((j) => (
              <div key={j.job} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className={j.healthy ? 'text-success' : 'font-semibold text-danger'}>
                  {j.healthy ? '●' : '▲'} {j.label}
                </span>
                <span className="text-fg-muted">
                  {j.lastSuccessAt
                    ? `last succeeded ${new Date(j.lastSuccessAt).toLocaleString()} (${j.hoursSinceLastSuccess}h ago, stale after ${j.staleAfterHours}h)`
                    : 'has never run'}
                </span>
                {j.lastError && (
                  <span className="text-danger">last error: {j.lastError}</span>
                )}
              </div>
            ))}
            {h.deletionRequests && (h.deletionRequests.stuck > 0 || h.deletionRequests.failed > 0) && (
              <div className="text-xs font-medium text-danger">
                Deletion requests: {h.deletionRequests.failed || 0} failed · {h.deletionRequests.stuck || 0} overdue — see
                “Scheduled deletions” below.
              </div>
            )}
          </div>
        </div>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          {grantScope === 'all' ? 'Open sessions' : 'Your open sessions'}
        </h2>
        {grantScope === 'mine' && (
          <p className="mt-1 text-xs text-fg-subtle">
            You see your own sessions only — listing everyone&apos;s requires the break-glass platform role.
          </p>
        )}
        {grants.isLoading && <p className="mt-2 text-sm text-fg-subtle">Loading…</p>}
        {grants.data?.grants?.length === 0 && (
          <p className="mt-2 text-sm text-fg-subtle">
            {grantScope === 'all'
              ? 'Nobody is inside a customer organization right now.'
              : 'You are not inside any customer organization right now.'}
          </p>
        )}
        <div className="mt-2 space-y-2">
          {grants.data?.grants?.map((g) => (
            <div
              key={g.id}
              className="flex items-start justify-between gap-4 rounded border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-fg">
                  {g.actor} → {g.organization?.name}
                  {g.kind && (
                    <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 text-xs font-normal text-fg-muted">{g.kind}</span>
                  )}
                </div>
                <div className="mt-0.5 text-sm text-fg-muted">{g.reason}</div>
                <div className="mt-1 text-xs text-fg-subtle">
                  expires {new Date(g.expiresAt).toLocaleString()}
                  {g.lastAccessAt && <> · last request {new Date(g.lastAccessAt).toLocaleString()}</>}
                  {' · '}
                  {/* Requests, not "records": one row per request — a 4,000-row export is ONE request. */}
                  <button
                    type="button"
                    onClick={() => {
                      setLogSkip(0);
                      setLogFilters({ organizationId: '', actorUserId: '', from: '', to: '', grantId: g.id });
                    }}
                    className="underline decoration-dotted underline-offset-2 hover:text-fg"
                    title="Show this session's rows in the access log below"
                  >
                    {g.read?.requests ?? g.accessCount} request{(g.read?.requests ?? g.accessCount) === 1 ? '' : 's'}
                  </button>
                  {g.read?.rows > 0 && <> · read {fmtRead(g.read.rows, g.read.bytes)}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke.mutate(g.id)}
                disabled={revoke.isPending}
                className="shrink-0 rounded border border-border-strong px-3 py-1.5 text-xs font-medium text-fg hover:bg-muted disabled:opacity-50"
              >
                End now
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">Access log</h2>
        <p className="mt-1 text-sm text-fg-subtle">
          Every customer record opened by staff, with the reason it was opened.
          {facets.data && (
            <>
              {' '}
              {facets.data.logTotal.toLocaleString()} entries total
              {facets.data.oldestAt && <>, oldest {new Date(facets.data.oldestAt).toLocaleDateString()}</>}.
            </>
          )}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <select
            value={logFilters.organizationId}
            onChange={(e) => setFilter('organizationId', e.target.value)}
            className="rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
          >
            <option value="">All organizations</option>
            {(facets.data?.organizations || []).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <select
            value={logFilters.actorUserId}
            onChange={(e) => setFilter('actorUserId', e.target.value)}
            className="rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
          >
            <option value="">All staff</option>
            {(facets.data?.actors || []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            from
            <input
              type="date"
              value={logFilters.from}
              onChange={(e) => setFilter('from', e.target.value)}
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg focus:border-brand-accent focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            to
            <input
              type="date"
              value={logFilters.to}
              onChange={(e) => setFilter('to', e.target.value)}
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg focus:border-brand-accent focus:outline-none"
            />
          </label>
          {logFilters.grantId && (
            <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-accent">
              one session
              <button
                type="button"
                onClick={() => setFilter('grantId', '')}
                className="ml-1 font-semibold"
                title="Stop filtering to this session"
              >
                ×
              </button>
            </span>
          )}
          {(logFilters.organizationId || logFilters.actorUserId || logFilters.from || logFilters.to || logFilters.grantId) && (
            <button
              type="button"
              onClick={() => { setLogSkip(0); setLogFilters({ organizationId: '', actorUserId: '', from: '', to: '', grantId: '' }); }}
              className="text-xs text-fg-muted underline decoration-dotted underline-offset-2 hover:text-fg"
            >
              clear filters
            </button>
          )}
        </div>

        {log.isLoading && <p className="mt-2 text-sm text-fg-subtle">Loading…</p>}
        {!log.isLoading && entries.length === 0 && (
          <p className="mt-2 text-sm text-fg-subtle">
            {logTotal === 0 && !Object.values(logFilters).some(Boolean)
              ? 'Nothing yet. No Doorline staff has opened a customer’s records.'
              : 'No entries match these filters.'}
          </p>
        )}
        {entries.length > 0 && (
          <div className="mt-2 overflow-x-auto rounded border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Who</th>
                  <th className="px-3 py-2">Organization</th>
                  <th className="px-3 py-2">Opened</th>
                  <th className="px-3 py-2" title="Rows and payload size of the response — request-rows, not distinct voters">Read</th>
                  <th className="px-3 py-2">Why</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                      {new Date(e.at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-fg">{e.actor}</td>
                    <td className="px-3 py-2 text-fg">{e.organization}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted" title={e.route || undefined}>
                      {e.method} {e.resource}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">{fmtRead(e.rows, e.bytes)}</td>
                    <td className="px-3 py-2 text-fg-muted">{e.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logTotal > 0 && (
          <Pager skip={logSkip} limit={LOG_LIMIT} total={logTotal} onChange={setLogSkip} className="mt-2" />
        )}
      </section>

      {/* The operator surface for the delete-on-request SLA our Privacy Policy and DPA promise.
          Filing one SCHEDULES the org's deletion (now + SLA days); the retention sweep executes it;
          cancellable until it fires. */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">Scheduled deletions</h2>
            <p className="mt-1 text-sm text-fg-subtle">
              Delete-on-request intake: filing schedules the organization&apos;s deletion; the nightly retention
              sweep carries it out. Cancellable until it fires.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setFileError(null); setFileForm(fileForm ? null : { organizationId: '', note: '', requestedByEmail: '' }); }}
            className="rounded border border-border-strong px-3 py-1.5 text-xs font-medium text-fg hover:bg-muted"
          >
            {fileForm ? 'Close' : 'File a deletion request'}
          </button>
        </div>

        {fileForm && (
          <div className="mt-3 max-w-lg rounded-lg border border-border bg-card p-5">
            <label className="block text-sm font-medium text-fg" htmlFor="del-org">Organization</label>
            <select
              id="del-org"
              value={fileForm.organizationId}
              onChange={(e) => setFileForm({ ...fileForm, organizationId: e.target.value })}
              className="mt-1 w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
            >
              <option value="">Choose an organization…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <label className="mt-3 block text-sm font-medium text-fg" htmlFor="del-email">Requested by (email)</label>
            <input
              id="del-email"
              type="email"
              value={fileForm.requestedByEmail}
              onChange={(e) => setFileForm({ ...fileForm, requestedByEmail: e.target.value })}
              placeholder="who asked for this deletion"
              className="mt-1 w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
            />
            <label className="mt-3 block text-sm font-medium text-fg" htmlFor="del-note">Note</label>
            <textarea
              id="del-note"
              rows={2}
              value={fileForm.note}
              onChange={(e) => setFileForm({ ...fileForm, note: e.target.value })}
              placeholder="e.g. Emailed request from the org owner on July 15."
              className="mt-1 w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
            />
            {fileError && (
              <div className="mt-3 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{fileError}</div>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={!fileForm.organizationId || fileDeletion.isPending}
                onClick={() => fileDeletion.mutate({
                  organizationId: fileForm.organizationId,
                  note: fileForm.note || undefined,
                  requestedByEmail: fileForm.requestedByEmail || undefined,
                })}
                className="rounded bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {fileDeletion.isPending ? 'Scheduling…' : 'Schedule deletion'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {['', ...DELETION_STATUSES].map((s) => (
            <button
              key={s || 'all'}
              type="button"
              onClick={() => { setDelSkip(0); setDelStatus(s); }}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                delStatus === s ? 'bg-brand-accent text-white' : 'bg-sunken text-fg-muted hover:text-fg'
              }`}
            >
              {s || 'all'}
            </button>
          ))}
        </div>

        {deletions.isLoading && <p className="mt-2 text-sm text-fg-subtle">Loading…</p>}
        {!deletions.isLoading && requests.length === 0 && (
          <p className="mt-2 text-sm text-fg-subtle">No deletion requests{delStatus ? ` with status “${delStatus}”` : ''}.</p>
        )}
        <div className="mt-2 space-y-2">
          {requests.map((r) => (
            <div
              key={r.id}
              className={`flex items-start justify-between gap-4 rounded border px-4 py-3 ${
                r.overdue ? 'border-danger/40 bg-danger/5' : 'border-border bg-card'
              }`}
            >
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{r.organization?.name || 'unknown org'}</span>
                  <DeletionStatusChip status={r.status} overdue={r.overdue} />
                </div>
                <div className="mt-1 text-xs text-fg-subtle">
                  requested {new Date(r.requestedAt).toLocaleDateString()}
                  {r.requestedByEmail && <> by {r.requestedByEmail}</>}
                  {' · '}deletes {new Date(r.scheduledFor).toLocaleDateString()}
                  {r.completedAt && <> · completed {new Date(r.completedAt).toLocaleDateString()}</>}
                  {r.cancelledAt && <> · cancelled {new Date(r.cancelledAt).toLocaleDateString()}</>}
                  {r.attempts > 0 && <> · {r.attempts} attempt{r.attempts === 1 ? '' : 's'}</>}
                </div>
                {r.note && <div className="mt-1 text-xs text-fg-muted">{r.note}</div>}
                {r.error && <div className="mt-1 text-xs text-danger">last error: {r.error}</div>}
              </div>
              {r.status === 'scheduled' && (
                <button
                  type="button"
                  onClick={() => cancelDeletion.mutate(r.id)}
                  disabled={cancelDeletion.isPending}
                  className="shrink-0 rounded border border-border-strong px-3 py-1.5 text-xs font-medium text-fg hover:bg-muted disabled:opacity-50"
                >
                  Cancel deletion
                </button>
              )}
            </div>
          ))}
        </div>
        {delTotal > DELETION_LIMIT && (
          <Pager skip={delSkip} limit={DELETION_LIMIT} total={delTotal} onChange={setDelSkip} className="mt-2" />
        )}
      </section>
    </div>
  );
}
