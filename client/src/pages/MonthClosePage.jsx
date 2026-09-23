import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { BillingPill, fmtUsd } from '../lib/billingStatus.jsx';
import { Badge, Segmented } from '../components/ui/index.js';
import { addMonths } from '../lib/months.js';
import { formatDate } from '../lib/dates.js';
import { stateMeta } from '../lib/invoicing.js';
import { orgPagePath } from '../lib/orgPageTabs.js';

// CLOSING THE MONTH: /super-admin/billing.
//
// Issuing a statement is per-org (the Billing panel on /organizations). This is the other half of
// that job — "who still needs invoicing this month, and has anything moved since I invoiced them"
// — which is unanswerable by clicking through thirty orgs one at a time, and is exactly how a
// month gets missed. Super-admin only; internal orgs never appear.

export default function MonthClosePage() {
  // The month comes from the SERVER, not the browser. `currentMonth` is UTC on the server and is
  // the clock the MONTH_NOT_ENDED gate reads; picking it locally meant that for several hours
  // around each boundary a US account manager could be offered a month the server would refuse.
  // The request starts with no month at all and adopts the one the response names.
  const [month, setMonth] = useState('');
  // Range mode answers the other shape of the job: "who still owes me an invoice for July AND
  // August". Single month stays the default — it is the ordinary end-of-month pass.
  const [mode, setMode] = useState('one');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Live recompute is O(orgs × campaigns) round-trips, so it is opt-in behind a button and never
  // auto-refetches. Without it the board is three queries and answers the main question anyway.
  const [live, setLive] = useState(false);

  const range = mode === 'range';
  // No month on the first request: the server answers with the last CLOSED month and says so.
  const qs = range ? `from=${from}&to=${to}` : month ? `month=${month}` : '';
  const boardQ = useQuery({
    queryKey: ['super-admin', 'month-close', qs, live],
    queryFn: () => api(`/super-admin/billing/statements?${qs}${live ? '&live=1' : ''}`),
    placeholderData: keepPreviousData,
  });

  const data = boardQ.data;
  const rows = data?.organizations || [];

  // Adopt the server's month once, then leave the picker to the operator.
  useEffect(() => {
    if (!month && data?.month) {
      setMonth(data.month);
      setTo((t) => t || data.month);
      setFrom((f) => f || addMonths(data.month, -1));
    }
  }, [data?.month, month]);

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
            {/* Counts the months that actually need an invoice. A closed $0 month has no statement
                either, and folding those in told you to chase 35 when there were 5. */}
            <Stat
              label="Not yet issued"
              value={data.unissuedCount}
              tone={data.unissuedCount > 0 ? 'warn' : undefined}
              hint={data.zeroCount > 0 ? `${data.zeroCount} more had nothing to bill` : undefined}
            />
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
                        ? 'bg-warning-tint/60'
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
                                  ? `Issued ${formatDate(m.issuedAt)}${m.issuedBy ? ` by ${m.issuedBy}` : ''}${m.externalRef ? ` · ${m.externalRef}` : ''}${m.paidAt ? ` · paid ${formatDate(m.paidAt)}` : m.dueAt ? ` · due ${formatDate(m.dueAt)}` : ''}`
                                  : m.state === 'zero'
                                    ? 'Nothing to bill — not an outstanding invoice'
                                    : 'Not issued'
                              }
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                m.drift?.material
                                  ? 'bg-warning-tint text-warning-fg'
                                  : m.paymentState === 'paid'
                                    ? 'bg-success-tint text-success-fg'
                                    : m.paymentState === 'overdue'
                                      ? 'bg-danger-tint text-danger-fg'
                                      : m.issued
                                        ? 'bg-info-tint text-info-fg'
                                        : m.state === 'zero'
                                          ? 'bg-sunken text-fg-subtle'
                                          : 'bg-sunken text-warning-fg'
                              }`}
                            >
                              {m.month.slice(2)}
                              {m.drift?.material ? ' ⚠' : ''}
                            </span>
                          ))}
                        </span>
                      ) : r.issued ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5 text-fg-muted">
                          <Badge variant={stateMeta(r.paymentState === 'outstanding' ? 'issued' : r.paymentState, { ...r, asOf: data?.asOf }).variant}>
                            {stateMeta(r.paymentState === 'outstanding' ? 'issued' : r.paymentState, { ...r, asOf: data?.asOf }).label}
                          </Badge>
                          <span>
                            {formatDate(r.issuedAt)}
                            {r.issuedBy ? ` by ${r.issuedBy}` : ''}
                            {r.externalRef ? ` · ${r.externalRef}` : ''}
                          </span>
                          {r.drift?.material && <Badge variant="warning">drifted</Badge>}
                        </span>
                      ) : r.state === 'zero' ? (
                        // A closed month with nothing to bill owes nobody anything. Calling it
                        // "Not issued" turned thirty of these into a to-do list of busywork.
                        <span className="text-fg-subtle">Nothing to bill</span>
                      ) : (
                        <Badge variant="warning">Needs invoice</Badge>
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
                        to={orgPagePath(r.organizationId, { tab: 'statements', month: range ? undefined : month })}
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
      <p className={`mt-1 text-2xl font-semibold ${tone === 'warn' ? 'text-warning-fg' : 'text-fg'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}
