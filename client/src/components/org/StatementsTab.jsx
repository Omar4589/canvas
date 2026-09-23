import { useMemo, useState } from 'react';
import { Badge, Button, Card, DataTable, EmptyState, Segmented } from '../ui/index.js';
import RowMenu from '../RowMenu.jsx';
import { fmtUsd } from '../../lib/billingStatus.jsx';
import { formatDate } from '../../lib/dates.js';
import { monthLabel } from '../../lib/months.js';
import { ledgerFilter, pickedSummary, stateMeta, reasonLabel } from '../../lib/invoicing.js';
import { DriftBadge } from './modals/StatementModals.jsx';
import { statementCsvRows, statementCsvName, combinedCsvRows, combinedCsvName } from '../../lib/statementCsv.js';
import { saveCsvRows } from '../../lib/downloadFile.js';

// THE MONTH LEDGER — every month this org has ever been in, what it came to, whether it was
// invoiced, when it falls due and whether it was paid.
//
// Rows expand in place to the campaign lines ALREADY in the payload: a frozen month shows what was
// invoiced, an open one shows a live recompute, and neither costs another request.

const MonthDetail = ({ row, asOf, internal, onSetRate }) => {
  const lines = row.lines || [];
  const billing = lines.filter((l) => l.billable);
  const uniformRate = billing.every((l) => l.rateCents === billing[0]?.rateCents);

  return (
    <div className="space-y-3 bg-sunken/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {row.issued ? (
          <span>
            Issued {formatDate(row.issuedAt)}
            {row.issuedBy ? ` by ${row.issuedBy}` : ''} · rules v{row.rulesVersion}
            {row.externalRef ? ` · invoice ${row.externalRef}` : ''}
            {row.dueAt ? ` · due ${formatDate(row.dueAt)}` : ''}
            {row.paidAt ? ` · paid ${formatDate(row.paidAt)}${row.paymentRef ? ` (${row.paymentRef})` : ''}` : ''}
          </span>
        ) : (
          <span>Live — not issued. These figures are recomputed each time you look.</span>
        )}
      </div>

      {row.drift && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            row.drift.material
              ? 'border border-warning/30 bg-warning-tint text-warning-fg'
              : 'bg-sunken text-fg-muted'
          }`}
        >
          {row.drift.material ? (
            <>
              <span className="font-semibold">This month has drifted.</span> You invoiced{' '}
              {fmtUsd(row.drift.totalCents?.issued)}; a live recompute now says {fmtUsd(row.drift.totalCents?.live)}.
              Nothing has been changed — void and reissue if the new figure is the right one.
            </>
          ) : (
            <>Some detail has moved since this was issued, but the amount has not.</>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="py-1.5 pr-3">Campaign</th>
              <th className="py-1.5 pr-3">Homes</th>
              <th className="py-1.5 pr-3">First visit</th>
              <th className="py-1.5 pr-3">Bills from</th>
              <th className="py-1.5 pr-3 text-right">Knocks</th>
              <th className="py-1.5 pr-3 text-right">Doors</th>
              <th className="py-1.5 pr-3">Why</th>
              <th className="py-1.5 pr-3 text-right">Rate</th>
              <th className="py-1.5 pr-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((l) => (
              <tr key={l.campaignId} className={l.billable ? '' : 'text-fg-muted'}>
                <td className="py-1.5 pr-3 font-medium text-fg">{l.name}</td>
                <td className="py-1.5 pr-3">{l.households}</td>
                <td className="whitespace-nowrap py-1.5 pr-3">{l.firstKnockAt ? formatDate(l.firstKnockAt) : '—'}</td>
                <td className="whitespace-nowrap py-1.5 pr-3">{l.billingStartMonth ? monthLabel(l.billingStartMonth) : '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{l.knocksThisMonth}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {l.billRestrictedDoors ? l.billableDoorsThisMonth : l.knocksThisMonth}
                  {l.billRestrictedDoors && l.restrictedDoorsThisMonth > 0 && (
                    <span className="text-fg-subtle"> (+{l.restrictedDoorsThisMonth} restricted)</span>
                  )}
                </td>
                <td className="py-1.5 pr-3">{reasonLabel(l.reason)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {/* A frozen month's rate is not retypeable — that is what freezing means. */}
                  {!row.issued && !internal ? (
                    <button
                      type="button"
                      onClick={() => onSetRate(l)}
                      className="underline decoration-dotted underline-offset-2 hover:text-brand-accent"
                      title="Set this campaign's rate"
                    >
                      {fmtUsd(l.rateCents)}
                    </button>
                  ) : (
                    fmtUsd(l.rateCents)
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-fg">{l.billable ? fmtUsd(l.amountCents) : '—'}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 pr-3 text-fg" colSpan={8}>
                Total ({billing.length}
                {uniformRate && billing.length > 0 ? ` × ${fmtUsd(billing[0].rateCents)}` : ' campaigns'})
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-fg">{fmtUsd(row.totalCents)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default function StatementsTab({
  orgName,
  months,
  invoicing,
  currentMonth,
  asOf,
  window: win,
  internal,
  openMonth,
  onOpenMonth,
  onIssue,
  onVoid,
  onMarkPaid,
  onUnmarkPaid,
  onSetRate,
  paperTrail,
  paperTrailLoading = false,
  paperTrailError = null,
  onLoadPaperTrail,
}) {
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(12);
  const [picked, setPicked] = useState(() => new Set());
  const [trailOpen, setTrailOpen] = useState(false);

  const awaiting = invoicing?.awaiting?.months || [];
  const filtered = useMemo(() => ledgerFilter(months, filter), [months, filter]);
  const shown = limit === 0 ? filtered : filtered.slice(0, limit);
  const summary = pickedSummary(months, picked, currentMonth);

  const toggle = (month) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });

  const exportMonth = (row) => {
    saveCsvRows(
      statementCsvRows({
        month: row.month,
        view: { lines: row.lines, totalCents: row.totalCents },
        statement: row.issued ? row : null,
        orgName,
      }),
      statementCsvName({ orgName, month: row.month, issued: row.issued })
    );
  };

  const exportPicked = () => {
    const rows = (months || []).filter((m) => picked.has(m.month));
    if (!rows.length) return;
    saveCsvRows(combinedCsvRows({ months: rows, orgName }), combinedCsvName({ orgName, months: rows }));
  };

  if (internal) {
    return (
      <Card>
        <EmptyState
          title="Internal organizations are never billed"
          hint="This org holds only Doorline's own data. It never appears on a revenue surface and cannot have statements issued."
        />
      </Card>
    );
  }

  if (!months?.length) {
    return (
      <Card>
        <EmptyState title="Nothing to invoice yet" hint="Billing starts with the first field visit." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Awaiting, first and separate: this is the backlog, and it is the reason the page exists. */}
      {awaiting.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Awaiting invoice</h2>
            <Button variant="primary" size="sm" onClick={() => onIssue(awaiting.map((m) => m.month))}>
              Issue {awaiting.length} month{awaiting.length === 1 ? '' : 's'}…
            </Button>
          </div>
          <ul className="mt-2 divide-y divide-border text-sm">
            {awaiting.map((m) => (
              <li key={m.month} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-fg">{monthLabel(m.month)}</span>
                <span className="flex items-center gap-3">
                  <span className="text-fg-muted">
                    {m.billableCampaigns} campaign{m.billableCampaigns === 1 ? '' : 's'}
                  </span>
                  <span className="tabular-nums font-medium text-fg">{fmtUsd(m.totalCents)}</span>
                  <Button variant="secondary" size="sm" onClick={() => onIssue([m.month])}>Issue…</Button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-border pt-2 text-sm font-semibold text-fg">
            {fmtUsd(invoicing.awaiting.totalCents)} to invoice
          </p>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'awaiting', label: 'Awaiting' },
            { value: 'outstanding', label: 'Outstanding' },
            { value: 'paid', label: 'Paid' },
            { value: 'issued', label: 'Issued' },
          ]}
        />
        <Segmented
          size="sm"
          value={String(limit)}
          onChange={(v) => setLimit(Number(v))}
          options={[
            { value: '12', label: '12 months' },
            { value: '24', label: '24' },
            { value: '0', label: 'All' },
          ]}
        />
      </div>

      <DataTable
        head={
          <>
            <th className="px-3 py-2.5 w-8" />
            <th className="px-3 py-2.5">Month</th>
            <th className="px-3 py-2.5">Campaigns</th>
            <th className="px-3 py-2.5 text-right">Amount</th>
            <th className="px-3 py-2.5">State</th>
            <th className="px-3 py-2.5 hidden xl:table-cell">Invoice</th>
            <th className="px-3 py-2.5 hidden xl:table-cell">Issued</th>
            <th className="px-3 py-2.5 hidden 2xl:table-cell">Due</th>
            <th className="px-3 py-2.5 text-right" />
          </>
        }
      >
        {shown.map((row) => {
          const expanded = openMonth === row.month;
          const meta = stateMeta(row.state, { ...row, asOf });
          const menu = [];
          if (row.state === 'awaiting' || row.state === 'zero' || row.state === 'open') {
            menu.push({
              label: row.state === 'open' ? 'Issue early…' : 'Issue…',
              onClick: () => onIssue([row.month]),
            });
          }
          if (row.issued && row.state !== 'paid') {
            if (row.totalCents > 0) menu.push({ label: 'Mark paid…', onClick: () => onMarkPaid(row) });
            menu.push({ label: 'Void…', onClick: () => onVoid(row), danger: true });
          }
          if (row.state === 'paid') {
            menu.push({ label: 'Unmark paid…', onClick: () => onUnmarkPaid(row) });
            menu.push({ label: 'Void…', onClick: () => onVoid(row), danger: true, title: 'Unmark it paid first' });
          }
          menu.push({ label: expanded ? 'Hide lines' : 'View lines', onClick: () => onOpenMonth(expanded ? null : row.month) });
          menu.push({ label: 'Export CSV', onClick: () => exportMonth(row) });

          return (
            <tr key={row.month} id={`month-${row.month}`} className={expanded ? 'bg-brand-tint/40' : ''}>
              <td className="px-3 py-2.5 align-top">
                <input
                  type="checkbox"
                  aria-label={`Select ${monthLabel(row.month)}`}
                  checked={picked.has(row.month)}
                  onChange={() => toggle(row.month)}
                />
              </td>
              <td className="px-3 py-2.5 align-top">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => onOpenMonth(expanded ? null : row.month)}
                  className="font-medium text-fg underline decoration-dotted underline-offset-2 hover:text-brand-accent"
                >
                  {monthLabel(row.month)}
                </button>
                {expanded && (
                  <div className="mt-3 -mx-3">
                    <MonthDetail row={row} asOf={asOf} internal={internal} onSetRate={onSetRate} />
                  </div>
                )}
              </td>
              <td className="px-3 py-2.5 align-top text-fg-muted">{row.billableCampaigns}</td>
              <td className="px-3 py-2.5 text-right align-top tabular-nums text-fg">{fmtUsd(row.totalCents)}</td>
              <td className="px-3 py-2.5 align-top">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={meta.variant} dot={meta.dot}>{meta.label}</Badge>
                  <DriftBadge drift={row.drift} />
                </div>
              </td>
              <td className="px-3 py-2.5 align-top hidden xl:table-cell">
                {row.externalRef ? <span className="font-mono text-xs text-fg">{row.externalRef}</span> : <span className="text-fg-subtle">—</span>}
                {row.paymentRef && <div className="font-mono text-xs text-fg-muted">paid: {row.paymentRef}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 align-top hidden xl:table-cell text-fg-muted">
                {row.issuedAt ? formatDate(row.issuedAt) : '—'}
                {row.issuedBy && <div className="text-xs text-fg-subtle">{row.issuedBy}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 align-top hidden 2xl:table-cell text-fg-muted">
                {row.dueAt ? formatDate(row.dueAt) : '—'}
              </td>
              <td className="px-3 py-2.5 text-right align-top">
                <RowMenu items={menu} />
              </td>
            </tr>
          );
        })}
        {shown.length === 0 && (
          <tr>
            <td colSpan={9} className="px-3 py-8 text-center text-sm text-fg-muted">
              No months match that filter.
            </td>
          </tr>
        )}
      </DataTable>

      {/* The sticky bar only exists when something is ticked — an always-present empty toolbar is
          noise on the 29 days a month nobody is invoicing. */}
      {summary.count > 0 && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-accent/30 bg-brand-tint px-3 py-2.5">
          <span className="text-sm font-semibold text-fg">
            {summary.count} month{summary.count === 1 ? '' : 's'} · {fmtUsd(summary.totalCents)}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={exportPicked}>Export combined CSV</Button>
            {summary.unissuedMonths.length > 0 && (
              <Button variant="primary" size="sm" onClick={() => onIssue(summary.unissuedMonths)}>
                Issue {summary.unissuedMonths.length} unissued…
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Clear</Button>
          </span>
        </div>
      )}

      {/* The paper trail, including voided rows — the answer to "was July ever voided". */}
      <Card className="p-4">
        <button
          type="button"
          aria-expanded={trailOpen}
          onClick={() => {
            setTrailOpen((v) => !v);
            if (!trailOpen) onLoadPaperTrail();
          }}
          className="text-xs font-semibold uppercase tracking-wide text-fg-muted hover:text-fg"
        >
          {trailOpen ? '▾' : '▸'} Every statement (paper trail)
        </button>
        {trailOpen && (
          <ul className="mt-3 space-y-1.5 text-sm">
            {/* "Nothing issued yet" is an ASSERTION about the record. While the request is in
                flight, or after it failed, it is not one we can make — and "was July ever voided?"
                is exactly the question this list exists to answer. */}
            {paperTrailError && (
              <li className="text-danger-fg">Could not load the paper trail: {paperTrailError.message}</li>
            )}
            {!paperTrailError && paperTrailLoading && <li className="text-fg-muted">Loading…</li>}
            {!paperTrailError && !paperTrailLoading && !paperTrail?.length && (
              <li className="text-fg-muted">Nothing issued yet.</li>
            )}
            {(paperTrail || []).map((st) => (
              <li key={st._id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{monthLabel(st.month)}</span>
                <span className="tabular-nums text-fg-muted">{fmtUsd(st.totalCents)}</span>
                {st.status === 'void' ? (
                  <>
                    <Badge variant="neutral">Void</Badge>
                    <span className="text-fg-muted">
                      voided {formatDate(st.voidedAt)}
                      {st.voidedByUserId ? ` by ${st.voidedByUserId.firstName || ''} ${st.voidedByUserId.lastName || ''}`.trimEnd() : ''}
                      {st.voidReason ? ` — “${st.voidReason}”` : ''}
                      {st.supersededByStatementId ? ' · replaced' : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <Badge variant={stateMeta(st.paymentState === 'outstanding' ? 'issued' : st.paymentState, { ...st, asOf }).variant}>
                      {stateMeta(st.paymentState === 'outstanding' ? 'issued' : st.paymentState, { ...st, asOf }).label}
                    </Badge>
                    <span className="text-fg-muted">
                      issued {formatDate(st.issuedAt)}
                      {st.issuedByUserId ? ` by ${st.issuedByUserId.firstName || ''} ${st.issuedByUserId.lastName || ''}`.trimEnd() : ''}
                      {st.externalRef ? ` · ref ${st.externalRef}` : ''}
                    </span>
                  </>
                )}
                <span className="text-xs text-fg-subtle">rules v{st.rulesVersion}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-fg-subtle">
        History window {win?.from} → {win?.to}
        {win?.truncated ? ` · months before ${win.from} are not scanned (unpaid invoices older than that are still counted)` : ''}
      </p>
    </div>
  );
}
