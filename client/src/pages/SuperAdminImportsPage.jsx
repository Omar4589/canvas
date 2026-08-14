import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import Pager from '../components/Pager.jsx';
import { fmtUsd } from '../lib/billingStatus.jsx';
import { saveCsvRows } from '../lib/downloadFile.js';

const LIMIT = 50;

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
  linking: 'bg-warning-tint text-warning-fg',
  importing: 'bg-brand-tint text-brand-accent',
};

const inputCls =
  'rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';

// Count-truth copy for the two headline numbers whose populations aren't obvious.
const COST_HELP =
  'An internal estimate: new lookups × the assumed per-1,000 rate. It is NOT Geocodio’s invoice — ' +
  'reconcile against the real bill. Each import’s cost is rounded on its own, so row costs may not ' +
  'add up exactly to this total (the total rounds the sum).';
const HOUSEHOLDS_HELP =
  'The sum of each import’s unique households — an import-unit number, not distinct physical doors. ' +
  'The same address imported by two organizations counts twice here (the shared geocode cache still ' +
  'means it was only ever looked up once).';

const VIEWS = [
  { key: 'import', label: 'By import' },
  { key: 'month', label: 'By month' },
  { key: 'org', label: 'By organization' },
];

export default function SuperAdminImportsPage() {
  const [month, setMonth] = useState('');
  const [orgId, setOrgId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('date'); // date | cost
  const [excludeUndone, setExcludeUndone] = useState(false);
  const [view, setView] = useState('import'); // import | month | org
  const [skip, setSkip] = useState(0);

  // Org filter options — the platform org list (small, already cached from other pages).
  const orgsQ = useQuery({
    queryKey: ['super-admin', 'organizations'],
    queryFn: () => api('/super-admin/organizations'),
  });

  const params = new URLSearchParams({ limit: String(LIMIT), skip: String(skip) });
  if (month) params.set('month', month);
  if (orgId) params.set('orgId', orgId);
  if (q) params.set('q', q);
  if (sort === 'cost') params.set('sort', 'cost');
  if (excludeUndone) params.set('excludeUndone', '1');
  if (view !== 'import') params.set('groupBy', view);

  const importsQ = useQuery({
    queryKey: ['super-admin', 'imports', month, orgId, q, sort, excludeUndone, view, skip],
    queryFn: () => api(`/super-admin/imports?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const totals = importsQ.data?.totals;
  const rows = importsQ.data?.imports || [];
  const groups = importsQ.data?.groups || [];
  const total = importsQ.data?.total || 0;
  const rate = importsQ.data?.ratePer1000Cents ?? 100;
  // Cache ROI: lookups the shared cache avoided, priced at the same assumed rate.
  const savedCents = totals ? Math.round((totals.geocodedCached * rate) / 1000) : 0;
  const hitRate = totals && totals.geocodedNew + totals.geocodedCached > 0
    ? Math.round((totals.geocodedCached / (totals.geocodedNew + totals.geocodedCached)) * 100)
    : null;

  function resetAnd(fn) {
    setSkip(0);
    fn();
  }

  function exportCsv() {
    if (view === 'import') {
      saveCsvRows(
        [
          ['When', 'Organization', 'File', 'Campaign', 'By', 'Status', 'Undone', 'Households', 'With coords', 'New lookups', 'Cached', 'Unplaceable', 'Cost'],
          ...rows.map((r) => [
            r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
            r.organizationName,
            r.filename || '',
            r.campaignName || '',
            r.uploadedByName || '',
            r.status,
            r.undone ? 'yes' : '',
            r.uniqueHouseholds,
            r.withFileCoords,
            r.geocodedNew,
            r.geocodedCached,
            r.geocodeUnmatched + r.geocodeFailed,
            (r.costCents / 100).toFixed(2),
          ]),
        ],
        `geocoding-imports-${month || 'all'}.csv`
      );
    } else {
      saveCsvRows(
        [
          [view === 'month' ? 'Month' : 'Organization', 'Imports', 'Households', 'New lookups', 'Cached', 'Unplaceable', 'Cost'],
          ...groups.map((g) => [
            g.label,
            g.imports,
            g.households,
            g.geocodedNew,
            g.geocodedCached,
            g.geocodeUnmatched + g.geocodeFailed,
            (g.costCents / 100).toFixed(2),
          ]),
        ],
        `geocoding-by-${view}-${month || 'all'}.csv`
      );
    }
  }

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

      <form
        onSubmit={(e) => { e.preventDefault(); resetAnd(() => setQ(searchText.trim())); }}
        className="mb-3 flex flex-wrap items-center gap-3"
      >
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => resetAnd(() => setMonth(e.target.value))}
            className={inputCls}
          />
        </label>
        {month && (
          <button
            type="button"
            onClick={() => resetAnd(() => setMonth(''))}
            className="text-xs font-semibold text-brand-accent underline underline-offset-2 hover:opacity-80"
          >
            All time
          </button>
        )}
        <select
          value={orgId}
          onChange={(e) => resetAnd(() => setOrgId(e.target.value))}
          className={inputCls}
        >
          <option value="">All organizations</option>
          {(orgsQ.data?.organizations || []).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search org, file, uploader…"
          className={`flex-1 min-w-[200px] ${inputCls}`}
        />
        <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Search
        </button>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted" title="Reversed (undone) imports still incurred lookups — untick to include them in the cost math">
          <input
            type="checkbox"
            checked={excludeUndone}
            onChange={(e) => resetAnd(() => setExcludeUndone(e.target.checked))}
          />
          Exclude undone
        </label>
      </form>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => resetAnd(() => setView(v.key))}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                view === v.key ? 'bg-brand-accent text-white' : 'bg-sunken text-fg-muted hover:text-fg'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          onClick={exportCsv}
          disabled={importsQ.isLoading}
          className="text-xs font-semibold text-brand-accent hover:opacity-80 disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {totals && (
        <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <StatCard compact label="Imports" value={fmt(totals.imports)} />
          <StatCard compact label="Households" value={fmt(totals.households)} help={HOUSEHOLDS_HELP} />
          <StatCard compact label="With coords" value={fmt(totals.withFileCoords)} hint="no lookup" accent="green" />
          <StatCard compact label="Needed geocoding" value={fmt(totals.neededGeocoding)} />
          <StatCard compact label="New lookups" value={fmt(totals.geocodedNew)} hint="billable" accent="amber" />
          <StatCard
            compact
            label="Cache savings"
            value={fmtUsd(savedCents)}
            hint={hitRate === null ? `${fmt(totals.geocodedCached)} cached` : `${fmt(totals.geocodedCached)} cached · ${hitRate}% hit rate`}
            accent="green"
          />
          <StatCard compact label="Est. cost" value={fmtUsd(totals.costCents)} accent="brand" help={COST_HELP} />
        </div>
      )}
      <p className="mb-4 text-xs text-fg-subtle">
        Est. cost assumes {fmtUsd(rate)} per 1,000 new lookups — an internal estimate, not Geocodio&apos;s
        invoice. Row costs round individually and may not sum exactly to the total.
      </p>

      {view !== 'import' ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-3 text-left">{view === 'month' ? 'Month' : 'Organization'}</th>
                <th className="px-4 py-3 text-right">Imports</th>
                <th className="px-4 py-3 text-right">Households</th>
                <th className="px-4 py-3 text-right">New lookups</th>
                <th className="px-4 py-3 text-right">Cached</th>
                <th className="px-4 py-3 text-right">Unplaceable</th>
                <th className="px-4 py-3 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {importsQ.isLoading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-fg-muted">Loading…</td></tr>
              )}
              {groups.map((g) => (
                <tr key={g.key}>
                  <td className="px-4 py-3 font-medium text-fg">{g.label}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{fmt(g.imports)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg">{fmt(g.households)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg">{fmt(g.geocodedNew)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{fmt(g.geocodedCached)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{fmt(g.geocodeUnmatched + g.geocodeFailed)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-fg">{fmtUsd(g.costCents)}</td>
                </tr>
              ))}
              {!importsQ.isLoading && groups.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-fg-muted">Nothing to roll up.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <button
                      onClick={() => resetAnd(() => setSort('date'))}
                      className={`uppercase tracking-wide hover:text-fg ${sort === 'date' ? 'text-fg' : ''}`}
                    >
                      When{sort === 'date' && ' ▾'}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left">Organization</th>
                  <th className="px-4 py-3 text-left">File</th>
                  <th className="px-4 py-3 text-left">Campaign</th>
                  <th className="px-4 py-3 text-left">By</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Households</th>
                  <th className="px-4 py-3 text-right">With coords</th>
                  <th className="px-4 py-3 text-right">New / cached</th>
                  <th className="px-4 py-3 text-right" title="Addresses that couldn't be placed: unmatched by the geocoder, or failed on a provider error">
                    Unplaceable
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button
                      onClick={() => resetAnd(() => setSort('cost'))}
                      className={`uppercase tracking-wide hover:text-fg ${sort === 'cost' ? 'text-fg' : ''}`}
                    >
                      Cost{sort === 'cost' && ' ▾'}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {importsQ.isLoading && (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-fg-muted">Loading…</td>
                  </tr>
                )}
                {importsQ.error && (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-danger">{importsQ.error.message}</td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className={r.undone ? 'opacity-60' : ''}>
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
                      {r.undone && (
                        <span
                          className="ml-1 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-fg-muted"
                          title={`Reversed${r.undoneAt ? ` ${formatDate(r.undoneAt)}` : ''} — its lookups still happened; use "Exclude undone" to drop it from the totals`}
                        >
                          undone
                        </span>
                      )}
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
                    <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                      {r.geocodeUnmatched + r.geocodeFailed > 0
                        ? `${fmt(r.geocodeUnmatched + r.geocodeFailed)}${r.geocodeFailed ? ` (${fmt(r.geocodeFailed)} failed)` : ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-fg">{fmtUsd(r.costCents)}</td>
                  </tr>
                ))}
                {!importsQ.isLoading && !importsQ.error && rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-fg-muted">No imports found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <Pager skip={skip} limit={LIMIT} total={total} onChange={setSkip} className="mt-3" />
          <p className="mt-1 text-xs text-fg-subtle">
            The totals above cover every matching import, not just this page.
          </p>
        </>
      )}
    </div>
  );
}
