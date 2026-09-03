import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { BillingPill, fmtUsd, currentMonthStr } from '../lib/billingStatus.jsx';
import { Segmented } from '../components/ui/index.js';

// CLOSING THE MONTH: /super-admin/billing.
//
// Issuing a statement is per-org (the Billing panel on /organizations). This is the other half of
// that job — "who still needs invoicing this month, and has anything moved since I invoiced them"
// — which is unanswerable by clicking through thirty orgs one at a time, and is exactly how a
// month gets missed. Super-admin only; internal orgs never appear.

// 'YYYY-MM' for the month before the current one — the month you are almost always closing.
function lastMonthStr() {
  const [y, m] = currentMonthStr().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 'YYYY-MM' minus n months.
function monthsAgo(m, n) {
  const [y, mo] = String(m).split('-').map(Number);
  const total = y * 12 + (mo - 1) - n;
  const y2 = Math.floor(total / 12);
  const m2 = total - y2 * 12 + 1;
  return `${String(y2).padStart(4, '0')}-${String(m2).padStart(2, '0')}`;
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

export default function MonthClosePage() {
  const [month, setMonth] = useState(lastMonthStr());
  // Range mode answers the other shape of the job: "who still owes me an invoice for July AND
  // August". Single month stays the default — it is the ordinary end-of-month pass.
  const [mode, setMode] = useState('one');
  const [from, setFrom] = useState(() => monthsAgo(lastMonthStr(), 1));
  const [to, setTo] = useState(lastMonthStr());
  // Live recompute is O(orgs × campaigns) round-trips, so it is opt-in behind a button and never
  // auto-refetches. Without it the board is three queries and answers the main question anyway.
  const [live, setLive] = useState(false);

  const range = mode === 'range';
  const qs = range ? `from=${from}&to=${to}` : `month=${month}`;
  const boardQ = useQuery({
    queryKey: ['super-admin', 'month-close', qs, live],
    queryFn: () => api(`/super-admin/billing/statements?${qs}${live ? '&live=1' : ''}`),
    placeholderData: keepPreviousData,
  });

  const data = boardQ.data;
  const rows = data?.organizations || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Close the month</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Freeze what you invoiced, so a later rate change or a reactivated campaign can’t quietly
            rewrite it. Internal organizations are never billed and don’t appear here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'one', label: 'One month' },
              { value: 'range', label: 'Range' },
            ]}
          />
          {range ? (
            <span className="flex items-center gap-1">
              <input
                type="month"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From month"
                className="rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
              />
              <span className="text-sm text-fg-muted">to</span>
              <input
                type="month"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To month"
                className="rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
              />
            </span>
          ) : (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
            />
          )}
          <button
            onClick={() => setLive((v) => !v)}
            className="rounded-md border border-border-strong bg-card px-3 py-2 text-sm font-semibold text-fg hover:bg-sunken"
            title="Recompute every org's month from raw activity and compare it to what was issued. Slow — one pass per organization."
          >
            {live ? 'Hide live totals' : 'Recompute live'}
          </button>
        </div>
      </div>

      {boardQ.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
      {boardQ.error && <p className="text-sm text-danger">{boardQ.error.message}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={range ? 'Issued (org-months)' : 'Issued'}
              value={data.issuedCount}
              hint={range ? `Across ${data.months.length} months` : undefined}
            />
            <Stat label="Not yet issued" value={data.unissuedCount} tone={data.unissuedCount > 0 ? 'warn' : undefined} />
            <Stat
              label={range ? 'Range total' : 'Issued total'}
              value={fmtUsd(range ? data.rangeTotalCents : data.issuedTotalCents)}
              hint={range ? 'Frozen where issued, live where not' : undefined}
            />
            <Stat
              label={live ? 'Drifting' : 'Live total'}
              value={live ? data.driftingCount : '—'}
              tone={live && data.driftingCount > 0 ? 'warn' : undefined}
              hint={live ? `Live total ${fmtUsd(data.liveTotalCents)}` : 'Press Recompute live'}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2">Organization</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">{range ? 'Months' : 'Statement'}</th>
                  <th className="px-3 py-2 text-right">{range ? 'Range total' : 'Issued'}</th>
                  {live && <th className="px-3 py-2 text-right">Live</th>}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr
                    key={r.organizationId}
                    className={
                      (range ? r.months.some((m) => m.drift?.material) : r.drift?.material)
                        ? 'bg-amber-50/60'
                        : ''
                    }
                  >
                    <td className="px-3 py-2 font-medium text-fg">{r.name}</td>
                    <td className="px-3 py-2">
                      <BillingPill effective={r.status} />
                    </td>
                    <td className="px-3 py-2">
                      {range ? (
                        // One chip per month, so "who still owes me July" is answerable by scanning
                        // a column instead of reloading the board a month at a time.
                        <span className="flex flex-wrap gap-1">
                          {r.months.map((m) => (
                            <span
                              key={m.month}
                              title={
                                m.issued
                                  ? `Issued ${fmtDate(m.issuedAt)}${m.issuedBy ? ` by ${m.issuedBy}` : ''}${m.externalRef ? ` · ${m.externalRef}` : ''}`
                                  : 'Not issued'
                              }
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                m.drift?.material
                                  ? 'bg-amber-100 text-amber-900'
                                  : m.issued
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-sunken text-amber-700'
                              }`}
                            >
                              {m.month.slice(2)}
                              {m.drift?.material ? ' ⚠' : ''}
                            </span>
                          ))}
                        </span>
                      ) : r.issued ? (
                        <span className="text-fg-muted">
                          Issued {fmtDate(r.issuedAt)}
                          {r.issuedBy ? ` by ${r.issuedBy}` : ''}
                          {r.externalRef ? ` · ${r.externalRef}` : ''}
                          {r.drift?.material && (
                            <span className="ml-1 font-semibold text-amber-700">· drifted</span>
                          )}
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-700">Not issued</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {range ? fmtUsd(r.rangeTotalCents) : r.issued ? fmtUsd(r.issuedTotalCents) : '—'}
                    </td>
                    {live && (
                      <td className="px-3 py-2 text-right">
                        {r.liveTotalCents == null ? '—' : fmtUsd(r.liveTotalCents)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      {/* Issuing and voiding live on the org's own Billing panel — one place that
                          owns the write, so this board stays a read-only overview. */}
                      <Link
                        to={`/organizations?billing=${r.organizationId}`}
                        className="text-xs font-semibold text-brand-accent hover:opacity-80"
                      >
                        Open billing →
                      </Link>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={live ? 6 : 5} className="px-3 py-6 text-center text-sm text-fg-muted">
                      No billable organizations.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === 'warn' ? 'text-amber-700' : 'text-fg'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}
