import { useMemo, useState } from 'react';
import { Badge, Button, Card, DataTable, EmptyState, Segmented } from '../ui/index.js';
import { fmtUsd } from '../../lib/billingStatus.jsx';
import { formatDate, formatRelative } from '../../lib/dates.js';
import { monthLabel, shortMonthLabel } from '../../lib/months.js';
import { campaignRows, campaignNeedsAttention, CAMPAIGN_FILTERS, reasonLabel, stateMeta } from '../../lib/invoicing.js';

// "Which campaigns are active, which have started, which need invoicing" — the owner's question,
// answered campaign-first.
//
// Invoices are per org per MONTH, so this is a pivot: every month row folded sideways onto the
// campaigns inside it. No extra request; the lines are already in the history payload.

// One chip per month in the window, newest last, coloured by what that month is. The whole point
// is answering "which months has this campaign been invoiced for" at a glance.
const MonthStrip = ({ byMonth }) => (
  <div className="flex flex-wrap gap-1">
    {byMonth.map((m) => {
      const tone = !m.billable
        ? 'bg-sunken text-fg-subtle'
        : m.state === 'paid'
          ? 'bg-success-tint text-success-fg'
          : m.state === 'overdue'
            ? 'bg-danger-tint text-danger-fg'
            : m.state === 'awaiting'
              ? 'bg-warning-tint text-warning-fg'
              : m.state === 'open'
                ? 'bg-info-tint text-info-fg'
                : 'bg-info-tint text-info-fg';
      return (
        <span
          key={m.month}
          className={`rounded px-1.5 py-0.5 text-xs ${tone}`}
          title={`${monthLabel(m.month)} — ${m.billable ? `${fmtUsd(m.amountCents)}, ${m.state}` : reasonLabel(m.reason)}`}
        >
          {shortMonthLabel(m.month)}
        </span>
      );
    })}
  </div>
);

export default function CampaignsTab({
  campaigns,
  months,
  detailCampaigns,
  currentMonth,
  window: win,
  orgRateCents,
  internal,
  onSetRate,
}) {
  const [filter, setFilter] = useState('active');
  const [expanded, setExpanded] = useState(() => new Set());

  const rows = useMemo(
    () => campaignRows({ campaigns, months, detailCampaigns, currentMonth }).sort(campaignNeedsAttention),
    [campaigns, months, detailCampaigns, currentMonth]
  );
  const shown = rows.filter(CAMPAIGN_FILTERS[filter] || CAMPAIGN_FILTERS.all);

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!rows.length) {
    return (
      <Card>
        <EmptyState title="No campaigns" hint="Nothing has been created in this organization yet." />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: `Active (${rows.filter(CAMPAIGN_FILTERS.active).length})` },
            { value: 'archived', label: `Archived (${rows.filter(CAMPAIGN_FILTERS.archived).length})` },
            { value: 'notStarted', label: `Not started (${rows.filter(CAMPAIGN_FILTERS.notStarted).length})` },
            { value: 'all', label: `All (${rows.length})` },
          ]}
        />
        <p className="text-xs text-fg-subtle">Universe size is reported, never priced.</p>
      </div>

      <DataTable
        head={
          <>
            <th className="px-3 py-2.5 w-8" />
            <th className="px-3 py-2.5">Campaign</th>
            <th className="px-3 py-2.5" title="A knock, or a home a canvasser walked to and couldn't get into">First visit</th>
            <th className="px-3 py-2.5" title="The first month this campaign could bill — the start grace can push it one later">Bills from</th>
            <th className="px-3 py-2.5">This month</th>
            <th className="px-3 py-2.5">Invoiced</th>
            <th className="px-3 py-2.5 text-right">Months · billed</th>
            <th className="px-3 py-2.5">Rate</th>
            <th className="px-3 py-2.5 hidden xl:table-cell">Last activity</th>
            <th className="px-3 py-2.5 text-right hidden xl:table-cell">Homes</th>
          </>
        }
      >
        {shown.map((r) => {
          const open = expanded.has(r.campaignId);
          const graceShift = r.billingStartMonth && r.firstVisitDay && r.billingStartMonth !== String(r.firstVisitDay).slice(0, 7);
          return (
            <tr key={r.campaignId} className={r.isActive ? '' : 'text-fg-muted'}>
              <td className="px-3 py-2.5 align-top">
                <button
                  type="button"
                  onClick={() => toggle(r.campaignId)}
                  aria-expanded={open}
                  aria-label={`${open ? 'Hide' : 'Show'} months for ${r.name}`}
                  className="text-fg-subtle hover:text-fg"
                >
                  {open ? '▾' : '▸'}
                </button>
                {open && (
                  <div className="sr-only">expanded</div>
                )}
              </td>
              <td className="px-3 py-2.5 align-top">
                <div className="font-medium text-fg">{r.name}</div>
                <div className="text-xs text-fg-subtle">
                  created {formatDate(r.createdAt)}
                  {!r.isActive && r.archivedAt ? ` · archived ${formatDate(r.archivedAt)}` : ''}
                </div>
                {open && (
                  <div className="mt-2 max-w-md">
                    <MonthStrip byMonth={r.byMonth} />
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 align-top">
                {r.firstKnockAt ? formatDate(r.firstKnockAt) : <span className="text-fg-subtle">Not started</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 align-top">
                {r.billingStartMonth ? (
                  <span className="inline-flex items-center gap-1.5">
                    {monthLabel(r.billingStartMonth)}
                    {graceShift && (
                      <Badge variant="neutral" title="The first knock landed in the last week of a month, so that month was free">
                        start grace
                      </Badge>
                    )}
                  </span>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </td>
              <td className="px-3 py-2.5 align-top">
                {r.thisMonth?.billable ? (
                  <>
                    <div className="tabular-nums text-fg">{fmtUsd(r.thisMonth.amountCents)}</div>
                    {r.thisMonth.rateCents != null && (
                      <div className="text-xs text-fg-subtle">at {fmtUsd(r.thisMonth.rateCents)}</div>
                    )}
                  </>
                ) : (
                  <span className="text-fg-muted">{reasonLabel(r.thisMonth?.reason)}</span>
                )}
              </td>
              <td className="px-3 py-2.5 align-top">
                <div className="flex flex-wrap gap-1">
                  {r.awaitingMonths > 0 && <Badge variant="warning">{r.awaitingMonths} awaiting</Badge>}
                  {r.overdueMonths > 0 && <Badge variant="danger">{r.overdueMonths} overdue</Badge>}
                  {r.issuedMonths > 0 && <Badge variant="info">{r.issuedMonths} issued</Badge>}
                  {r.paidMonths > 0 && <Badge variant="success">{r.paidMonths} paid</Badge>}
                  {!r.awaitingMonths && !r.overdueMonths && !r.issuedMonths && !r.paidMonths && (
                    <span className="text-fg-subtle">—</span>
                  )}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums">
                {r.monthsBilled} · {fmtUsd(r.billedToDateCents)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 align-top">
                {internal ? (
                  <span className="text-fg-subtle">Never billed</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {fmtUsd(r.rateCents)}
                    {r.pricePerCampaignCents == null ? (
                      <span className="text-fg-subtle">(inherits)</span>
                    ) : (
                      <Badge variant="brand">negotiated</Badge>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => onSetRate(r)}>Set</Button>
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 align-top hidden xl:table-cell">{formatRelative(r.lastActivityAt)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums hidden xl:table-cell">
                {r.households ?? '—'}
              </td>
            </tr>
          );
        })}
        {shown.length === 0 && (
          <tr>
            <td colSpan={10} className="px-3 py-8 text-center text-sm text-fg-muted">
              No campaigns match that filter.
            </td>
          </tr>
        )}
      </DataTable>

      <p className="text-xs text-fg-subtle">
        History window {win?.from} → {win?.to}
        {win?.truncated ? ` · months before ${win.from} are not scanned` : ''}
      </p>
    </div>
  );
}

export { stateMeta };
