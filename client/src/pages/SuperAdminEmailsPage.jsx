import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import Pager from '../components/Pager.jsx';

// The transactional-email log: /super-admin/emails. Metadata only — every email the sendMail
// chokepoint attempted, to whom, and whether Resend accepted it; the rendered content and bounce
// forensics live in the Resend dashboard. Doubles as the deletion-warning evidence trail (those
// rows never expire — badged "kept" below). Platform-scoped, super-admin only.
const LIMIT = 50;

const OUTCOMES = ['sent', 'failed', 'dormant'];

function OutcomeBadge({ outcome, error }) {
  const cls =
    outcome === 'sent'
      ? 'bg-success/10 text-success'
      : outcome === 'failed'
        ? 'bg-danger/10 text-danger'
        : 'bg-sunken text-fg-muted';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
      // Resend's rejection reason rides along on failures — surfaced on hover, not in the row.
      title={outcome === 'failed' && error ? error : undefined}
    >
      {outcome}
    </span>
  );
}

export default function SuperAdminEmailsPage() {
  const [filters, setFilters] = useState({ kind: '', outcome: '', organizationId: '' });
  const [skip, setSkip] = useState(0);

  const params = new URLSearchParams({ limit: String(LIMIT), skip: String(skip) });
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const emailsQ = useQuery({
    queryKey: ['super-admin-emails', filters, skip],
    queryFn: () => api(`/super-admin/emails?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  // Orgs that actually appear in the log — a small dedicated endpoint, not the whole org directory.
  const orgsQ = useQuery({
    queryKey: ['super-admin-emails', 'orgs'],
    queryFn: () => api('/super-admin/emails/orgs'),
  });

  const emails = emailsQ.data?.emails || [];
  const total = emailsQ.data?.total || 0;
  // kind list is filter-independent server-side (distinct over the whole log), so it stays stable.
  const kinds = emailsQ.data?.kinds || [];
  const last24h = emailsQ.data?.last24h || { sent: 0, failed: 0 };
  const orgs = orgsQ.data?.orgs || [];

  const filtersActive = Boolean(filters.kind || filters.outcome || filters.organizationId);

  function setFilter(key, value) {
    setSkip(0);
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Emails</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            Every transactional email Doorline attempted — metadata only; content and bounce detail live in Resend.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm">
            <span className="text-fg-muted">Sent 24h:</span>{' '}
            <span className="font-semibold text-fg">{last24h.sent.toLocaleString()}</span>
          </div>
          <div
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              last24h.failed > 0 ? 'border-danger/30 bg-danger/10 text-danger' : 'border-border bg-card'
            }`}
          >
            <span className={last24h.failed > 0 ? '' : 'text-fg-muted'}>Failed 24h:</span>{' '}
            <span className={`font-semibold ${last24h.failed > 0 ? '' : 'text-fg'}`}>
              {last24h.failed.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={filters.kind}
          onChange={(e) => setFilter('kind', e.target.value)}
          className="rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <select
          value={filters.outcome}
          onChange={(e) => setFilter('outcome', e.target.value)}
          className="rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">All outcomes</option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <select
          value={filters.organizationId}
          onChange={(e) => setFilter('organizationId', e.target.value)}
          className="rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">All orgs</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {filtersActive && (
          <button
            type="button"
            onClick={() => { setSkip(0); setFilters({ kind: '', outcome: '', organizationId: '' }); }}
            className="text-xs text-fg-muted underline decoration-dotted underline-offset-2 hover:text-fg"
          >
            clear filters
          </button>
        )}
      </div>

      {emailsQ.isLoading && <p className="text-sm text-fg-subtle">Loading…</p>}
      {!emailsQ.isLoading && emails.length === 0 && (
        <p className="text-sm text-fg-subtle">
          {filtersActive ? 'No emails match these filters.' : 'No emails logged yet.'}
        </p>
      )}

      {emails.length > 0 && (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Org</th>
                <th className="px-3 py-2">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => {
                const to = (e.to || []).join(', ');
                return (
                  <tr key={e.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                      {new Date(e.sentAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-fg">{e.kind}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-fg" title={to || undefined}>{to || '—'}</td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-fg-muted" title={e.subject || undefined}>
                      {e.subject || '—'}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{e.organization?.name || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <OutcomeBadge outcome={e.outcome} error={e.error} />
                        {e.keptForever && (
                          <span
                            className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-fg-subtle"
                            title="Deletion-warning evidence — never expires"
                          >
                            kept
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <Pager skip={skip} limit={LIMIT} total={total} onChange={setSkip} />
      )}
    </div>
  );
}
