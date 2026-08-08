import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

// The do-not-knock REGISTER — every address the org has promised never to visit again.
//
// This page exists because the feature's two honest limitations are invisible without it:
// a request never auto-reopens (so turnover has to be surfaced, not assumed), and matching is by
// EXACT address key (so formatting drift between two campaigns' files can leave a sibling door
// knockable). Both get a column here rather than a silent fix.
//
// Admins only — the register is org-wide, so a team lead reading it would see addresses from
// campaigns they don't manage. Leads still set and lift per-door on the map and voter profile.

function fmtDate(d, tz) {
  if (!d) return '—';
  return formatInTz(d, tz, { year: 'numeric', month: 'short', day: 'numeric' }, false) || '—';
}

const SOURCE_LABEL = { admin: 'Admin', lead: 'Team lead', super: 'Super admin' };

function NearMisses({ recordId }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['do-not-knock', 'near-misses', recordId],
    queryFn: () => api(`/admin/do-not-knock/${recordId}/near-misses`),
    enabled: open,
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-fg-muted hover:underline">
        Check similar addresses
      </button>
    );
  }
  if (q.isLoading) return <span className="text-xs text-fg-muted">Checking…</span>;
  const matches = q.data?.matches || [];
  return (
    <div className="text-xs">
      {matches.length === 0 ? (
        <span className="text-fg-muted">
          No similar addresses{q.data?.truncated ? ' in the portion checked' : ''}.
        </span>
      ) : (
        <div>
          <p className="font-medium text-warning-fg">
            {matches.length} address{matches.length === 1 ? '' : 'es'} may be the same place, written
            differently — these are NOT suppressed:
          </p>
          <ul className="mt-1 space-y-0.5 text-fg-muted">
            {matches.map((m) => (
              <li key={m.householdId}>
                {m.addressLine1}{m.addressLine2 ? `, ${m.addressLine2}` : ''} · {m.city} {m.zipCode}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-fg-subtle">
            Suppress each one from its own door on the map if it is the same address.
          </p>
        </div>
      )}
      {q.data?.truncated && (
        <p className="mt-1 text-fg-subtle">
          Only part of this ZIP was checked — treat “no matches” as inconclusive.
        </p>
      )}
    </div>
  );
}

export default function DoNotKnockPage() {
  const qc = useQueryClient();
  const tz = useOrgTimeZone();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const listQ = useQuery({
    queryKey: ['do-not-knock', 'list', page, search],
    queryFn: () =>
      api(`/admin/do-not-knock?page=${page}&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  });

  const lift = useMutation({
    mutationFn: (id) => api(`/admin/do-not-knock/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['do-not-knock'] }),
  });

  const records = listQ.data?.records || [];
  const total = listQ.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / (listQ.data?.limit || 50)));
  const needsReview = records.filter((r) => r.newResidents > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Do not knock</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Addresses nobody visits again — in every campaign, permanently. Individual voters keep
          their own do-not-contact status; this is about the door.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-fg-muted">Suppressed addresses</div>
          <div className="mt-1 text-2xl font-semibold text-fg">{total.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-fg-muted">Worth re-reviewing</div>
          <div className={`mt-1 text-2xl font-semibold ${needsReview ? 'text-warning-fg' : 'text-fg'}`}>
            {needsReview}
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            On this page — new residents have been imported since the request.
          </p>
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder="Search address, city, or ZIP"
        className="w-full max-w-md rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
      />

      {listQ.isLoading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : records.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-fg-muted">
          No addresses are marked do not knock.
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-fg">
                    {r.addressLine1}{r.addressLine2 ? `, ${r.addressLine2}` : ''}
                  </p>
                  <p className="text-sm text-fg-muted">{r.city}, {r.state} {r.zipCode}</p>
                  <p className="mt-1 text-sm text-fg">{r.reason}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {r.by?.name || 'Unknown'} · {SOURCE_LABEL[r.source] || r.source} · {fmtDate(r.at, tz)}
                    {' · '}
                    {/* 0 live doors is normal, not an error: the campaign that held this address
                        may have been deleted, and the request deliberately outlived it. */}
                    {r.doors} live door{r.doors === 1 ? '' : 's'}
                  </p>
                  {r.newResidents > 0 && (
                    <p className="mt-1.5 text-xs font-medium text-warning-fg">
                      ⚠ {r.newResidents} voter{r.newResidents === 1 ? '' : 's'} imported here since
                      this request — the household may have moved on. Nothing reopens on its own;
                      lift it only if you know it should be lifted.
                    </p>
                  )}
                  <div className="mt-2">
                    <NearMisses recordId={r.id} />
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(`Lift the do-not-knock request for ${r.addressLine1}? It becomes knockable again in every campaign.`)) {
                      lift.mutate(r.id);
                    }
                  }}
                  disabled={lift.isPending}
                  className="shrink-0 rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-50"
                >
                  Lift
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border border-border-strong px-3 py-1.5 font-medium text-fg-muted hover:bg-sunken disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-fg-muted">Page {page} of {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="rounded-md border border-border-strong px-3 py-1.5 font-medium text-fg-muted hover:bg-sunken disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
