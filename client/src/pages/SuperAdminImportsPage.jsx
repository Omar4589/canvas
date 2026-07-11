import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import { fmtUsd } from '../lib/billingStatus.jsx';

function fmt(n) {
  return (n ?? 0).toLocaleString();
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_STYLE = {
  completed: 'bg-success-tint text-success',
  failed: 'bg-danger-tint text-danger',
};

const inputCls =
  'rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';

export default function SuperAdminImportsPage() {
  const [month, setMonth] = useState('');
  const [search, setSearch] = useState('');

  const q = useQuery({
    queryKey: ['super-admin', 'imports', month],
    queryFn: () => api(`/super-admin/imports${month ? `?month=${month}` : ''}`),
  });

  const totals = q.data?.totals;
  const rows = q.data?.imports || [];

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      `${r.organizationName} ${r.campaignName || ''} ${r.filename || ''} ${r.uploadedByName || ''}`
        .toLowerCase()
        .includes(term)
    );
  }, [rows, search]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-fg">Imports &amp; geocoding cost</h1>
        <p className="text-sm text-fg-muted">
          Every voter-file import across every organization and the geocoding it required. Homes that
          arrive with coordinates (or hit the cache) are free — only new lookups cost. This is an
          internal figure; it is never shown to clients.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} />
        </label>
        {month && (
          <button
            onClick={() => setMonth('')}
            className="text-xs font-semibold text-brand-accent underline underline-offset-2 hover:opacity-80"
          >
            All time
          </button>
        )}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search org, file, campaign, uploader…"
          className={`flex-1 min-w-[220px] ${inputCls}`}
        />
      </div>

      {totals && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard compact label="Imports" value={fmt(totals.imports)} />
          <StatCard compact label="Households" value={fmt(totals.households)} />
          <StatCard compact label="With coords" value={fmt(totals.withFileCoords)} hint="no lookup" accent="green" />
          <StatCard compact label="Needed geocoding" value={fmt(totals.neededGeocoding)} />
          <StatCard compact label="New lookups" value={fmt(totals.geocodedNew)} hint="billable" accent="amber" />
          <StatCard compact label="Est. cost" value={fmtUsd(totals.costCents)} accent="brand" />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-3 text-left">When</th>
              <th className="px-4 py-3 text-left">Organization</th>
              <th className="px-4 py-3 text-left">File</th>
              <th className="px-4 py-3 text-left">Campaign</th>
              <th className="px-4 py-3 text-left">By</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Households</th>
              <th className="px-4 py-3 text-right">With coords</th>
              <th className="px-4 py-3 text-right">New / cached</th>
              <th className="px-4 py-3 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {q.isLoading && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-fg-muted">Loading…</td>
              </tr>
            )}
            {q.error && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-danger">{q.error.message}</td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-3 text-fg-muted">{formatDate(r.createdAt)}</td>
                <td className="px-4 py-3 font-medium text-fg">{r.organizationName}</td>
                <td className="max-w-[220px] truncate px-4 py-3 text-fg-muted" title={r.filename || ''}>{r.filename || '—'}</td>
                <td className="px-4 py-3 text-fg-muted">{r.campaignName || '—'}</td>
                <td className="px-4 py-3 text-fg-muted">{r.uploadedByName || '—'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] || 'bg-sunken text-fg-muted'}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-fg">{fmt(r.uniqueHouseholds)}</td>
                <td
                  className="px-4 py-3 text-right tabular-nums text-fg"
                  title={r.withFileCoordsApprox ? 'Approximate — this import predates exact tracking' : ''}
                >
                  {r.withFileCoordsApprox ? '≈' : ''}{fmt(r.withFileCoords)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                  {fmt(r.geocodedNew)} / {fmt(r.geocodedCached)}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-fg">{fmtUsd(r.costCents)}</td>
              </tr>
            ))}
            {!q.isLoading && !q.error && visible.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-fg-muted">No imports found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {q.data?.truncated && (
        <p className="mt-2 text-xs text-fg-subtle">
          Showing the {q.data.listLimit} most recent of {fmt(q.data.total)} imports. The totals above
          cover every matching import.
        </p>
      )}
    </div>
  );
}
