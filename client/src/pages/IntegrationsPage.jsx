import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../api/client.js';

// The FbTime integration: connect the org's time-tracking so doors-per-hour
// divides by measured hours instead of the first-to-last-knock estimate.
// Admin-only (routed inside the orgAdmin RoleGate). The API key is pasted here
// once, validated against FbTime, and never displayed again — the server
// stores it sealed and returns only the prefix.

const FIGURES = [
  {
    value: 'adjustedHours',
    label: 'Adjusted hours',
    desc: 'The payroll figure — total time minus break overage. Matches the "Adjusted total" on FbTime timesheets. Recommended.',
  },
  {
    value: 'workedHours',
    label: 'Worked hours',
    desc: 'Total time minus ALL breaks. The strictest knock rate; will not match the timesheet.',
  },
  {
    value: 'grossHours',
    label: 'Total hours',
    desc: 'Clock-in to clock-out, breaks included. Overstates hours on long-break shifts — not recommended as a rate denominator.',
  },
];

const EVENT_COPY = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  'key-rotated': 'API key replaced',
  'figure-changed': 'Hours figure changed',
  'link-created': 'Canvasser linked',
  'link-removed': 'Canvasser unlinked',
  'auto-matched': 'Auto-matched by email',
  'sync-failed': 'Sync started failing',
  'sync-recovered': 'Sync recovered',
};

export default function IntegrationsPage() {
  const orgId = getActiveOrgId();
  const qc = useQueryClient();

  const statusQ = useQuery({
    queryKey: ['admin', 'integrations', 'fbtime', orgId],
    queryFn: () => api('/admin/integrations/fbtime'),
    enabled: Boolean(orgId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'integrations'] });
    // Every hours figure on the report surfaces can shift with the connection.
    qc.invalidateQueries({ queryKey: ['reports'] });
  };

  const data = statusQ.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Integrations</h1>
        <p className="text-sm text-fg-muted">
          Connect outside tools your organization already uses.
        </p>
      </div>

      {statusQ.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      {statusQ.error && (
        <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {statusQ.error.message}
        </div>
      )}

      {data && !data.connected && <ConnectCard configured={data.configured} onDone={invalidate} />}
      {data && data.connected && (
        <>
          <StatusCard data={data} onChanged={invalidate} />
          <MappingCard onChanged={invalidate} unmatchedWithHours={data.unmatchedWithHours} />
          <HistoryCard />
        </>
      )}
    </div>
  );
}

// ── Connect ─────────────────────────────────────────────────────────────────

function ConnectCard({ configured, onDone }) {
  const [apiKey, setApiKey] = useState('');
  // The Test result the admin must confirm — pasting another customer's key is
  // caught HERE as a name that reads wrong, not weeks later as a report full of
  // strangers' hours.
  const [tested, setTested] = useState(null);

  const testMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/test', { method: 'POST', body: { apiKey } }),
    onSuccess: (res) => setTested(res),
  });

  const connectMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/connect', { method: 'POST', body: { apiKey } }),
    onSuccess: () => {
      setApiKey('');
      setTested(null);
      onDone();
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-fg">FbTime — measured hours</h2>
      <p className="mt-1 text-sm text-fg-muted">
        If your canvassers clock in and out with FbTime, connect it and doors-per-hour will divide
        by the hours they were actually on the clock instead of estimating from knock times. Your
        reports label every number as <span className="font-medium text-fg">measured</span> or{' '}
        <span className="font-medium text-fg">estimated</span>, so the two are never mixed.
      </p>

      {!configured && (
        <p className="mt-3 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-fg">
          This server is not configured to store integration keys yet (CREDENTIAL_SEAL_KEY). Contact
          Doorline before connecting.
        </p>
      )}

      <div className="mt-3 space-y-2">
        <label className="block text-xs font-medium text-fg-muted" htmlFor="fbtime-key">
          FbTime API key
        </label>
        <input
          id="fbtime-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value.trim());
            setTested(null);
          }}
          placeholder="fbt_live_…"
          className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-subtle"
        />
        <p className="text-xs text-fg-muted">
          An admin of your FbTime organization creates this under{' '}
          <span className="font-medium text-fg">Integrations → New key</span> there. It is shown
          once; paste it straight in. Doorline stores it encrypted and never displays it again.
        </p>
      </div>

      {!tested ? (
        <button
          type="button"
          disabled={!apiKey || testMut.isPending}
          onClick={() => testMut.mutate()}
          className="mt-3 rounded-md bg-brand-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {testMut.isPending ? 'Checking…' : 'Test connection'}
        </button>
      ) : (
        <div className="mt-3 rounded-lg border border-border bg-sunken px-3 py-2.5">
          <p className="text-sm text-fg">
            This key reads{' '}
            <span className="font-semibold">{tested.organization?.name || 'an FbTime organization'}</span>
            {tested.key?.name ? (
              <span className="text-fg-muted"> (key “{tested.key.name}”)</span>
            ) : null}
            . Is that your organization?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={connectMut.isPending}
              onClick={() => connectMut.mutate()}
              className="rounded-md bg-brand-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {connectMut.isPending ? 'Connecting…' : 'Yes — connect'}
            </button>
            <button
              type="button"
              onClick={() => setTested(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-fg"
            >
              No, cancel
            </button>
          </div>
        </div>
      )}

      {(testMut.error || connectMut.error) && (
        <p className="mt-2 text-xs text-danger">{(testMut.error || connectMut.error).message}</p>
      )}
    </div>
  );
}

// ── Status ──────────────────────────────────────────────────────────────────

function StatusCard({ data, onChanged }) {
  const orgId = getActiveOrgId();
  const qc = useQueryClient();

  const figureMut = useMutation({
    mutationFn: (hourFigure) =>
      api('/admin/integrations/fbtime/settings', { method: 'PATCH', body: { hourFigure } }),
    onSuccess: onChanged,
  });

  // "Refresh hours now": the server enqueues a deep re-pull and answers with
  // its requestedAt; completion is read off the connection's own sync stamps
  // moving past that instant, so both sides of the comparison are the server's
  // clock. (A 15-minute cron tick landing in the same window can trip the
  // "refreshed" note a moment before the deep rows land — cosmetic; the rows
  // arrive on the very next refetch.)
  const [refreshingSince, setRefreshingSince] = useState(null); // ms epoch, server time
  const [refreshNote, setRefreshNote] = useState(null);

  const refreshMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/sync', { method: 'POST' }),
    onSuccess: (res) => {
      setRefreshNote(null);
      setRefreshingSince(new Date(res.requestedAt).getTime());
    },
  });

  // Poll the status query while a refresh is in flight; give up politely after
  // 90s (the job still runs — the next natural refetch shows its result).
  useEffect(() => {
    if (!refreshingSince) return undefined;
    const tick = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['admin', 'integrations', 'fbtime', orgId] });
    }, 2000);
    const bail = setTimeout(() => {
      setRefreshingSince(null);
      setRefreshNote('Still working — the refresh runs in the background. Check back in a minute.');
    }, 90_000);
    return () => {
      clearInterval(tick);
      clearTimeout(bail);
    };
  }, [refreshingSince, qc, orgId]);

  // lastSyncAt past our request = done; lastErrorAt past it = the sync ran and
  // failed, and the error banner above already says why.
  useEffect(() => {
    if (!refreshingSince) return;
    const syncedAt = data.lastSyncAt ? new Date(data.lastSyncAt).getTime() : 0;
    const failedAt = data.lastErrorAt ? new Date(data.lastErrorAt).getTime() : 0;
    if (syncedAt >= refreshingSince) {
      setRefreshingSince(null);
      setRefreshNote('Hours refreshed.');
      onChanged(); // every report recomputes against the fresh cache
    } else if (failedAt >= refreshingSince) {
      setRefreshingSince(null);
      setRefreshNote(null);
    }
  }, [data.lastSyncAt, data.lastErrorAt, refreshingSince, onChanged]);

  const disconnectMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime', { method: 'DELETE' }),
    onSuccess: onChanged,
  });

  const errored = data.status === 'errored';

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">FbTime — measured hours</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            errored ? 'bg-danger-tint text-danger' : 'bg-success-tint text-success-fg'
          }`}
        >
          {errored ? 'Needs attention' : 'Connected'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-fg-muted">FbTime organization</dt>
          <dd className="font-medium text-fg">{data.fbtimeOrgName || '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-fg-muted">Key</dt>
          <dd className="font-mono text-fg">{data.keyPrefix}…</dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-fg-muted">Last sync</dt>
          <dd className="text-fg">
            {data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString() : 'not yet'}
          </dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-fg-muted">Linked canvassers</dt>
          <dd className="text-fg">{data.linkCount}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={refreshMut.isPending || Boolean(refreshingSince)}
          onClick={() => refreshMut.mutate()}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg disabled:opacity-50"
        >
          {refreshMut.isPending || refreshingSince ? 'Refreshing…' : 'Refresh hours now'}
        </button>
        <span className="text-xs text-fg-muted">
          Re-pulls the last few months from FbTime — use it after fixing a timesheet there.
        </span>
      </div>
      {refreshNote && <p className="mt-1.5 text-xs text-fg-muted">{refreshNote}</p>}
      {refreshMut.error && <p className="mt-1.5 text-xs text-danger">{refreshMut.error.message}</p>}

      <p className="mt-3 text-xs text-fg-muted">
        Doorline stores only each person's daily totals. Shift-level detail — exact clock-ins,
        clock-outs, and breaks — lives on their timesheet in FbTime.
      </p>

      {data.lastSyncError && (
        <p className="mt-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">
          {errored
            ? 'Hours have stopped syncing: '
            : 'Last sync problem (will retry): '}
          {data.lastSyncError}
          {errored && ' — replace the key below, or revoke and re-create it in FbTime.'}
        </p>
      )}

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-fg-muted">
          Which hours divide doors-per-hour
        </legend>
        <div className="mt-2 space-y-2">
          {FIGURES.map((f) => (
            <label key={f.value} className="flex cursor-pointer items-start gap-2 text-sm text-fg">
              <input
                type="radio"
                name="hourFigure"
                className="mt-0.5"
                checked={data.hourFigure === f.value}
                disabled={figureMut.isPending}
                onChange={() => figureMut.mutate(f.value)}
              />
              <span>
                {f.label}
                <span className="mt-0.5 block text-xs text-fg-muted">{f.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {figureMut.error && <p className="mt-2 text-xs text-danger">{figureMut.error.message}</p>}
      </fieldset>

      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          disabled={disconnectMut.isPending}
          onClick={() => {
            // Disconnecting deletes the cached hours (reports revert to estimates
            // immediately); the canvasser links are kept for a reconnect.
            if (window.confirm('Disconnect FbTime? Reports go back to estimated hours immediately. Your canvasser links are kept.')) {
              disconnectMut.mutate();
            }
          }}
          className="text-sm font-medium text-danger underline underline-offset-2 disabled:opacity-50"
        >
          Disconnect
        </button>
        {disconnectMut.error && (
          <p className="mt-2 text-xs text-danger">{disconnectMut.error.message}</p>
        )}
      </div>
    </div>
  );
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function MappingCard({ onChanged, unmatchedWithHours }) {
  const orgId = getActiveOrgId();
  const qc = useQueryClient();

  const peopleQ = useQuery({
    queryKey: ['admin', 'integrations', 'fbtime', 'people', orgId],
    queryFn: () => api('/admin/integrations/fbtime/people'),
    enabled: Boolean(orgId),
  });

  const usersQ = useQuery({
    queryKey: ['admin', 'integrations', 'org-users', orgId],
    queryFn: () => api('/admin/memberships'),
    enabled: Boolean(orgId),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'integrations'] });
    onChanged();
  };

  const autoMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/links/auto', { method: 'POST' }),
    onSuccess: refresh,
  });
  const linkMut = useMutation({
    mutationFn: ({ userId, fbtimePersonId }) =>
      api('/admin/integrations/fbtime/links', { method: 'POST', body: { userId, fbtimePersonId } }),
    onSuccess: refresh,
  });
  const unlinkMut = useMutation({
    mutationFn: (userId) => api(`/admin/integrations/fbtime/links/${userId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const people = peopleQ.data?.people || [];
  // /admin/memberships → { members: [{ user: { id, firstName, lastName, email } }] }
  const roster = usersQ.data?.members || [];
  const userLabel = new Map(
    roster.map((m) => [
      m.user.id,
      `${m.user.firstName || ''} ${m.user.lastName || ''}`.trim() || m.user.email || 'Unknown user',
    ])
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Canvasser mapping</h2>
        <button
          type="button"
          disabled={autoMut.isPending}
          onClick={() => autoMut.mutate()}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg disabled:opacity-50"
        >
          {autoMut.isPending ? 'Matching…' : 'Auto-match by email'}
        </button>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        Hours only count for canvassers linked to their FbTime person. Same email in both apps
        links automatically; the rest are linked here by hand.
      </p>
      {unmatchedWithHours > 0 && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-fg">
          {unmatchedWithHours} FbTime {unmatchedWithHours === 1 ? 'person has' : 'people have'}{' '}
          clocked hours but no linked canvasser — their hours are not counted anywhere until linked.
        </p>
      )}

      {peopleQ.isLoading && <p className="mt-3 text-sm text-fg-muted">Loading roster…</p>}
      {peopleQ.error && <p className="mt-3 text-xs text-danger">{peopleQ.error.message}</p>}

      {people.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-muted">
                <th className="py-1.5 pr-3 font-medium">FbTime person</th>
                <th className="py-1.5 pr-3 font-medium">Email</th>
                <th className="py-1.5 pr-3 font-medium">Linked canvasser</th>
                <th className="py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.fbtimePersonId} className="border-b border-border/60">
                  <td className="py-2 pr-3 text-fg">
                    {`${p.firstName} ${p.lastName}`.trim() || '—'}
                    {!p.isActive && <span className="ml-1.5 text-xs text-fg-subtle">(inactive)</span>}
                    {p.hasUnmatchedHours && (
                      <span className="ml-1.5 rounded bg-warning-tint px-1.5 py-0.5 text-xs text-fg">
                        has hours
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-fg-muted">{p.email || '—'}</td>
                  <td className="py-2 pr-3">
                    {p.linkedUserId ? (
                      <span className="text-fg">
                        {userLabel.get(p.linkedUserId) || 'Linked'}
                        {p.linkSource === 'auto-email' && (
                          <span className="ml-1 text-xs text-fg-subtle">(auto)</span>
                        )}
                      </span>
                    ) : (
                      <LinkPicker
                        roster={roster}
                        linkedIds={new Set(people.map((x) => x.linkedUserId).filter(Boolean))}
                        onPick={(userId) =>
                          linkMut.mutate({ userId, fbtimePersonId: p.fbtimePersonId })
                        }
                        disabled={linkMut.isPending}
                      />
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {p.linkedUserId && (
                      <button
                        type="button"
                        disabled={unlinkMut.isPending}
                        onClick={() => unlinkMut.mutate(p.linkedUserId)}
                        className="text-xs text-danger underline underline-offset-2 disabled:opacity-50"
                      >
                        Unlink
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(linkMut.error || unlinkMut.error || autoMut.error) && (
        <p className="mt-2 text-xs text-danger">
          {(linkMut.error || unlinkMut.error || autoMut.error).message}
        </p>
      )}
    </div>
  );
}

function LinkPicker({ roster, linkedIds, onPick, disabled }) {
  return (
    <select
      className="rounded-md border border-border bg-card px-2 py-1 text-sm text-fg"
      defaultValue=""
      disabled={disabled}
      onChange={(e) => e.target.value && onPick(e.target.value)}
    >
      <option value="">Link to…</option>
      {roster.map((m) => {
        const id = m.user.id;
        if (linkedIds.has(id)) return null;
        const name =
          `${m.user.firstName || ''} ${m.user.lastName || ''}`.trim() || m.user.email || id;
        return (
          <option key={id} value={id}>
            {name}
          </option>
        );
      })}
    </select>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

function HistoryCard() {
  const orgId = getActiveOrgId();
  const eventsQ = useQuery({
    queryKey: ['admin', 'integrations', 'fbtime', 'events', orgId],
    queryFn: () => api('/admin/integrations/fbtime/events'),
    enabled: Boolean(orgId),
  });

  const events = eventsQ.data?.events || [];
  if (!events.length) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-fg">History</h2>
      <ul className="mt-2 space-y-1.5">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg">
              {EVENT_COPY[e.type] || e.type}
              {e.detail?.count != null && ` — ${e.detail.count}`}
              {e.detail?.code && ` (${e.detail.code})`}
              {e.detail?.to && ` → ${e.detail.to}`}
            </span>
            <span className="shrink-0 text-xs text-fg-subtle">
              {new Date(e.at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
