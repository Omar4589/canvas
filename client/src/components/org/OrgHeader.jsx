import { Link } from 'react-router-dom';
import { Badge, Button, Card } from '../ui/index.js';
import Skeleton from '../ui/Skeleton.jsx';
import RowMenu from '../RowMenu.jsx';
import StatCard from '../StatCard.jsx';
import { AccountStateBadge, InternalBadge, fmtUsd } from '../../lib/billingStatus.jsx';
import { formatDate, formatRelative } from '../../lib/dates.js';
import { monthLabel } from '../../lib/months.js';
import { nextActions } from '../../lib/invoicing.js';

// The org page's masthead: who this is, what state they are in, what they owe, and the one thing
// to do about it. Everything below is detail.
export default function OrgHeader({
  org,
  billing,
  invoicing,
  entitlement,
  lastActivityAt,
  moneyPending = false,
  moneyFailed = false,
  onTab,
  onRename,
  onToggleActive,
  onDelete,
  canDelete,
  actionsDisabled,
}) {
  // The single most urgent open item, from the same ordered list the Overview tab renders in
  // full — so the header button and that list can never disagree about what comes first.
  const todo = nextActions(
    { ...(invoicing || {}), windDownEndsAt: entitlement?.windDownEndsAt },
    entitlement,
    { orgId: org?.id }
  );
  const first = todo[0] || null;
  const firstTab = first?.href?.match(/tab=(\w+)/)?.[1] || 'overview';
  const deleting = org?.deletion || null;

  return (
    <div className="space-y-4">
      <Link to="/organizations" className="text-sm font-medium text-brand-accent hover:underline">
        ‹ Organizations
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-fg">{org?.name}</h1>
              <span className="font-mono text-xs text-fg-subtle">{org?.slug}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AccountStateBadge
                effective={billing?.effective}
                banner={billing?.banner}
                status={billing?.status}
                trialDaysLeft={billing?.trialDaysLeft}
                windDownEndsAt={billing?.windDownEndsAt}
              />
              {!org?.isActive && <Badge variant="neutral">Inactive</Badge>}
              {org?.isInternal && <InternalBadge label="Internal org" />}
              {deleting && (
                <Badge
                  variant={deleting.status === 'failed' ? 'danger' : 'warning'}
                  title={deleting.error || `Requested ${formatDate(deleting.requestedAt)} · ${deleting.source}`}
                >
                  {deleting.status === 'failed' ? 'Delete failed' : 'Deleting…'}
                </Badge>
              )}
            </div>
            {/* The four dates an account manager asks for, labelled. "Customer since" is the org's
                creation; "Billing since" is the first month that actually carried money, which can
                be months later and is a different fact. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
              <span>Customer since {formatDate(org?.createdAt)}</span>
              <span aria-hidden="true">·</span>
              <span>
                Billing since{' '}
                {moneyPending ? (
                  <Skeleton className="inline-block h-3 w-16 align-middle" />
                ) : moneyFailed ? (
                  <span className="text-fg-subtle">—</span>
                ) : invoicing?.billingSince ? (
                  <span className="font-medium text-fg">{monthLabel(invoicing.billingSince)}</span>
                ) : (
                  <span className="text-fg-subtle" title="No campaign has been to the field yet">not started</span>
                )}
              </span>
              {billing?.pricePerCampaignCents != null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{fmtUsd(billing.pricePerCampaignCents)}/campaign/mo</span>
                </>
              )}
              {billing?.paymentTermsDays != null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Net {billing.paymentTermsDays}</span>
                </>
              )}
              {billing?.status === 'trial' && billing?.trialEndsAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Trial ends {formatDate(billing.trialEndsAt)}</span>
                </>
              )}
              {billing?.windDownEndsAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-danger-fg">Deletes {formatDate(billing.windDownEndsAt)}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>Last field activity {formatRelative(lastActivityAt)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {first && !actionsDisabled && (
              <Button variant="primary" size="sm" onClick={() => onTab(firstTab)} title={first.label}>
                {first.kind === 'overdue'
                  ? 'Chase payment'
                  : first.kind === 'awaiting'
                    ? 'Issue invoice'
                    : first.kind === 'trial'
                      ? 'Extend trial'
                      : first.kind === 'drift'
                        ? 'Review drift'
                        : 'Open'}
              </Button>
            )}
            <Link
              to={`/super-admin/access?organizationId=${org?.id}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-card px-2.5 py-1 text-xs font-semibold text-fg transition-colors hover:bg-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Who at Doorline has read this organization's data"
            >
              Access log
            </Link>
            <RowMenu
              items={[
                { label: 'Rename…', onClick: onRename, disabled: actionsDisabled },
                {
                  label: org?.isActive ? 'Deactivate…' : 'Reactivate',
                  onClick: onToggleActive,
                  disabled: actionsDisabled,
                },
                ...(canDelete ? [{ label: 'Delete…', onClick: onDelete, danger: true, disabled: actionsDisabled }] : []),
              ]}
            />
          </div>
        </div>

        {/* The consequences of `internal`, stated where the flag is seen. Each sentence keys on the
            field that actually drives it: the retention exemption follows the billing STATUS, the
            staff free-entry follows the immutable FLAG. They normally agree; if they ever drift,
            this states exactly which half applies. */}
        {(billing?.internal || org?.isInternal) && (
          <div className="mt-4 rounded-md border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
            <span className="font-semibold">Internal organization:</span>
            {billing?.internal && (
              <> exempt from automatic retention — the dormancy sweep and the wind-down will never delete it.
                Only a manual delete can.</>
            )}
            {org?.isInternal && (
              <> Staff enter this organization freely, without a support grant, and their activity is not
                written to the access log — it holds only Doorline&apos;s own synthetic data.</>
            )}
          </div>
        )}
      </Card>

      {/* The money, four ways. An internal org is never billed, so it gets a sentence instead of a
          row of zeros that would read as "they owe nothing this month". */}
      {invoicing?.internal ? (
        <Card className="px-4 py-3 text-sm text-fg-muted">Internal organization — never billed.</Card>
      ) : moneyFailed ? (
        <Card className="flex flex-wrap items-center gap-2 border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-fg">
          <span className="font-semibold">Billing figures unavailable.</span>
          <span>This organization may still owe money — the totals could not be loaded.</span>
        </Card>
      ) : moneyPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {['Running month', 'Awaiting invoice', 'Outstanding', 'Overdue'].map((label) => (
            <StatCard key={label} compact label={label} value={<Skeleton className="h-6 w-20" />} hint=" " />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            compact
            label="Running month"
            value={fmtUsd(invoicing?.running?.totalCents)}
            hint={
              invoicing?.running
                ? `${monthLabel(invoicing.running.month)} · ${invoicing.running.billableCampaigns} billing${
                    invoicing.running.setupCount ? ` · ${invoicing.running.setupCount} in setup` : ''
                  }`
                : '—'
            }
          />
          <StatCard
            compact
            label="Awaiting invoice"
            accent={invoicing?.awaiting?.months?.length ? 'amber' : undefined}
            value={fmtUsd(invoicing?.awaiting?.totalCents)}
            hint={
              invoicing?.awaiting?.months?.length
                ? `${invoicing.awaiting.months.length} month${invoicing.awaiting.months.length === 1 ? '' : 's'} · oldest ${monthLabel(invoicing.awaiting.months[0].month)}`
                : 'Every closed month is invoiced'
            }
          />
          <StatCard
            compact
            label="Outstanding"
            value={fmtUsd(invoicing?.outstanding?.totalCents)}
            hint={
              invoicing?.outstanding?.count
                ? `${invoicing.outstanding.count} statement${invoicing.outstanding.count === 1 ? '' : 's'}${
                    invoicing.outstanding.nextDueAt ? ` · next due ${formatDate(invoicing.outstanding.nextDueAt)}` : ''
                  }`
                : 'Nothing outstanding'
            }
          />
          <StatCard
            compact
            label="Overdue"
            accent={invoicing?.overdue?.count ? 'red' : undefined}
            value={fmtUsd(invoicing?.overdue?.totalCents)}
            hint={
              invoicing?.overdue?.count
                ? `${invoicing.overdue.count} · up to ${invoicing.overdue.maxDaysOverdue}d late`
                : 'Nothing overdue'
            }
          />
        </div>
      )}
    </div>
  );
}
