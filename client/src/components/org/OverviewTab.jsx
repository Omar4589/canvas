import { Badge, Button, Card } from '../ui/index.js';
import { fmtUsd } from '../../lib/billingStatus.jsx';
import { formatDate, formatRelative } from '../../lib/dates.js';
import { closesAt, monthLabel } from '../../lib/months.js';
import { nextActions, reasonLabel, dueLabel } from '../../lib/invoicing.js';
import { changeText } from '../../lib/subscriptionEventText.js';

const SectionTitle = ({ children }) => (
  <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{children}</h2>
);

// The landing tab: what needs doing, then the three money pictures behind it.
export default function OverviewTab({
  orgId,
  invoicing,
  entitlement,
  subscription,
  months,
  currentMonth,
  members,
  campaigns,
  lastActivityAt,
  events,
  asOf,
  onGo,
  onMarkPaid,
  onIssue,
}) {
  const todo = nextActions({ ...invoicing, windDownEndsAt: entitlement?.windDownEndsAt }, entitlement, { orgId });
  // An internal org is never billed. Showing it a running-month total, an invoice backlog and a
  // rate — on the page an account manager uses to decide what to invoice — reads as $900 of
  // revenue from Doorline's own demo data.
  const internal = Boolean(invoicing?.internal);
  const running = months?.find((m) => m.month === currentMonth) || null;
  // When the running month stops accumulating and becomes issuable. Derived here from the month
  // string rather than sent, because the helper is UTC-correct and the server's gate reads the
  // same clock — see lib/months.js closesAt.
  const closesOn = currentMonth ? closesAt(currentMonth) : null;
  const runningLines = (running?.lines || []).filter((l) => l.billable);
  const freeLines = (running?.lines || []).filter((l) => !l.billable);
  const outstandingRows = (months || []).filter((m) => m.state === 'issued' || m.state === 'overdue');
  const awaiting = invoicing?.awaiting?.months || [];

  return (
    <div className="space-y-4">
      {/* Next up, before anything else. An org page opened by an account manager is opened to DO
          something; the list of what says so plainly instead of making them read four cards. */}
      <Card className="p-4">
        <SectionTitle>Next up</SectionTitle>
        {todo.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">
            Nothing to do.
            {closesOn ? ` ${monthLabel(currentMonth)} closes ${formatDate(closesOn)}.` : ''}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {todo.map((item, i) => (
              <li key={`${item.kind}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  variant={
                    item.kind === 'overdue' ? 'danger' : item.kind === 'trial' ? 'warning' : item.kind === 'drift' ? 'warning' : 'info'
                  }
                >
                  {item.kind === 'wind_down' ? 'wind-down' : item.kind}
                </Badge>
                <span className="text-fg">{item.label}</span>
                <button
                  type="button"
                  onClick={() => onGo(item.href)}
                  className="font-semibold text-brand-accent underline decoration-dotted underline-offset-2 hover:opacity-80"
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {internal && (
        <Card className="px-4 py-3 text-sm text-fg-muted">
          Internal organization — never billed, never on a revenue surface, and it cannot have
          statements issued.
        </Card>
      )}

      {!internal && (
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Running month */}
        <Card className="p-4">
          <SectionTitle>Running month</SectionTitle>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-fg">{fmtUsd(invoicing?.running?.totalCents)}</span>
            {invoicing?.running?.issuedEarly ? (
              <Badge variant="info">Issued early</Badge>
            ) : (
              <Badge variant="info" dot>Open</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {monthLabel(currentMonth)}
            {closesOn ? ` · closes ${formatDate(closesOn)}` : ''} · issue from the 1st
          </p>
          {runningLines.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {runningLines.map((l) => (
                <li key={l.campaignId} className="flex items-center justify-between gap-2">
                  <span className="truncate text-fg">{l.name}</span>
                  <span className="shrink-0 tabular-nums text-fg-muted">{fmtUsd(l.amountCents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-fg-muted">No campaign is billing this month.</p>
          )}
          {freeLines.length > 0 && (
            <p className="mt-2 text-xs text-fg-subtle">
              {freeLines.length} free: {[...new Set(freeLines.map((l) => reasonLabel(l.reason)))].join(' · ')}
            </p>
          )}
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={() => onGo(`/organizations/${orgId}?tab=statements&month=${currentMonth}`)}>
              View lines →
            </Button>
          </div>
        </Card>

        {/* Awaiting invoice */}
        <Card className="p-4">
          <SectionTitle>Awaiting invoice</SectionTitle>
          {awaiting.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">Every closed month is invoiced.</p>
          ) : (
            <>
              <ul className="mt-2 space-y-1.5 text-sm">
                {awaiting.map((m) => (
                  <li key={m.month} className="flex items-center justify-between gap-2">
                    <span className="text-fg">{monthLabel(m.month)}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-fg-muted">{fmtUsd(m.totalCents)}</span>
                      <Badge variant="warning">Needs invoice</Badge>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-border pt-2 text-sm font-semibold text-fg">
                {fmtUsd(invoicing.awaiting.totalCents)} across {awaiting.length} month{awaiting.length === 1 ? '' : 's'}
              </p>
              <div className="mt-3">
                <Button variant="primary" size="sm" onClick={() => onIssue(awaiting.map((m) => m.month))}>
                  Issue {awaiting.length} month{awaiting.length === 1 ? '' : 's'}…
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* Outstanding */}
        <Card className="p-4">
          <SectionTitle>Outstanding</SectionTitle>
          {outstandingRows.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">Nothing outstanding.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {outstandingRows.map((m) => (
                <li key={m.month} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="text-fg">{monthLabel(m.month)}</span>{' '}
                    <span className="tabular-nums text-fg-muted">{fmtUsd(m.totalCents)}</span>
                    {m.externalRef && <span className="ml-1 font-mono text-xs text-fg-subtle">{m.externalRef}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge variant={m.state === 'overdue' ? 'danger' : 'info'}>{dueLabel(m.dueAt, asOf || invoicing?.asOf)}</Badge>
                    <Button variant="secondary" size="sm" onClick={() => onMarkPaid(m)}>Mark paid…</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {invoicing?.paid?.count > 0 && (
            <p className="mt-3 border-t border-border pt-2 text-xs text-fg-subtle">
              Last payment {formatDate(invoicing.paid.lastPaidAt)} · {fmtUsd(invoicing.paid.last12Cents)} paid in the last 12 months
            </p>
          )}
        </Card>
      </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle>Account</SectionTitle>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">State</dt>
              <dd className="text-fg">
                {subscription?.status || 'active'}
                {subscription?.statusChangedAt ? ` since ${formatDate(subscription.statusChangedAt)}` : ''}
                {subscription?.source ? ` · set ${subscription.source === 'stripe' ? 'by Stripe' : 'manually'}` : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">Rate</dt>
              <dd className="text-fg">{fmtUsd(subscription?.pricePerCampaignCents)}/campaign/mo</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">Payment terms</dt>
              <dd className="text-fg">Net {subscription?.paymentTermsDays ?? 30}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">Billing contact</dt>
              <dd className="truncate text-fg">
                {[subscription?.billingContact?.name, subscription?.billingContact?.email].filter(Boolean).join(' · ') || '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">Members · campaigns</dt>
              <dd className="text-fg">
                {members?.length || 0} · {campaigns?.filter((c) => c.isActive).length || 0} active
                {campaigns?.some((c) => !c.isActive) ? `, ${campaigns.filter((c) => !c.isActive).length} archived` : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">Last field activity</dt>
              <dd className="text-fg">{formatRelative(lastActivityAt)}</dd>
            </div>
          </dl>
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={() => onGo(`/organizations/${orgId}?tab=account`)}>Edit on Account →</Button>
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle>Recent changes</SectionTitle>
          {!events?.length ? (
            <p className="mt-2 text-sm text-fg-muted">No billing changes recorded yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {events.slice(0, 5).map((e) => (
                <li key={e._id} className="text-fg-muted">
                  <span className="text-fg">
                    {e.fromStatus || e.toStatus
                      ? `${e.fromStatus || '—'} → ${e.toStatus || '—'}`
                      : changeText(e.changes) || 'updated'}
                  </span>{' '}
                  · {formatDate(e.createdAt)}
                  {e.byUserId ? ` · ${e.byUserId.firstName || ''} ${e.byUserId.lastName || ''}`.trimEnd() : ''}
                  {e.reason ? ` — “${e.reason}”` : ''}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={() => onGo(`/organizations/${orgId}?tab=account`)}>See all →</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
