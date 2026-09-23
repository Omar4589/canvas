import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Select, Textarea } from '../ui/index.js';
import Pager from '../Pager.jsx';
import { AccountStateBadge, BILLING_STATUS_META } from '../../lib/billingStatus.jsx';
import { formatDate } from '../../lib/dates.js';
import { changeText } from '../../lib/subscriptionEventText.js';

const STATUSES = ['trial', 'active', 'past_due', 'suspended', 'canceled'];
const NEEDS_REASON = ['suspended', 'canceled'];
const EVENTS_LIMIT = 25;

const SectionTitle = ({ children }) => (
  <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{children}</h2>
);

// Status, trial, plan, terms, contact, notes, rename, the audit trail and the danger zone — every
// write that is about the ACCOUNT rather than about an invoice.
export default function AccountTab({
  org,
  subscription: sub,
  entitlement,
  events,
  eventsTotal,
  eventsSkip,
  onEventsSkip,
  isInternal,
  onStatus,
  onExtendTrial,
  onPatch,
  onRename,
  onToggleActive,
  onDelete,
  canDelete,
  pending,
  error,
  actionsDisabled,
  loading = false,
  loadError = null,
  onRetry,
}) {
  const [statusTo, setStatusTo] = useState('');
  const [reason, setReason] = useState('');
  const [rateDollars, setRateDollars] = useState('');
  const [termsDays, setTermsDays] = useState('');
  const [contact, setContact] = useState({ name: '', email: '' });
  const [notes, setNotes] = useState('');
  const [extendDays, setExtendDays] = useState('7');
  const [trialUntil, setTrialUntil] = useState('');

  // Reset the form from the record only when the RECORD changes, keyed on updatedAt. Keyed on the
  // whole object it would clobber a half-typed note every time any mutation on the page
  // invalidated the query.
  useEffect(() => {
    if (!sub) return;
    setRateDollars(sub.pricePerCampaignCents == null ? '' : String(sub.pricePerCampaignCents / 100));
    setTermsDays(sub.paymentTermsDays == null ? '30' : String(sub.paymentTermsDays));
    setContact({ name: sub.billingContact?.name || '', email: sub.billingContact?.email || '' });
    setNotes(sub.notes || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub?.updatedAt]);

  // Clear the status form once the move has landed. Without this the dropdown kept "Suspended"
  // selected after suspending — a value the option list no longer offers, so it rendered blank
  // beside an armed red Apply and the old reason, and clicking it answered "Already suspended."
  useEffect(() => {
    setStatusTo('');
    setReason('');
  }, [sub?.status]);

  const needsReason = NEEDS_REASON.includes(statusTo);
  // A failed read used to render as a permanent "Loading…", leaving status, trial, rate, terms,
  // contact and the danger zone unreachable with nothing to click and no sign anything was wrong.
  if (loadError) {
    return (
      <Card>
        <EmptyState
          title="Could not load this organization's billing account"
          hint={loadError.message}
          action={onRetry ? <Button variant="secondary" onClick={onRetry}>Retry</Button> : null}
        />
      </Card>
    );
  }
  if (!sub) return <Card className="p-4 text-sm text-fg-muted">{loading ? 'Loading…' : 'No billing record.'}</Card>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">
          {error.message || String(error)}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Status & trial */}
        <Card className="p-4">
          <SectionTitle>Status &amp; trial</SectionTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <AccountStateBadge
              effective={entitlement?.effective}
              banner={entitlement?.banner}
              status={sub.status}
              trialDaysLeft={entitlement?.trialDaysLeft}
              windDownEndsAt={entitlement?.windDownEndsAt}
            />
            <span>
              since {formatDate(sub.statusChangedAt)} · set {sub.source === 'stripe' ? 'by Stripe' : 'manually'}
            </span>
          </div>

          {isInternal ? (
            <p className="mt-3 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning-fg">
              <span className="font-semibold">Locked to Internal.</span> This organization was created internal, so
              its billing status can&apos;t be changed — it stays exempt from both retention sweeps and out of every
              revenue and lifetime number. Only a manual delete can remove it.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <label className="block text-xs font-semibold text-fg-muted" htmlFor="status-to">Change to</label>
                  <Select id="status-to" value={statusTo} onChange={(e) => setStatusTo(e.target.value)} disabled={actionsDisabled}>
                    <option value="">— keep {BILLING_STATUS_META[sub.status]?.label || sub.status} —</option>
                    {STATUSES.filter((s) => s !== sub.status).map((s) => (
                      <option key={s} value={s}>{BILLING_STATUS_META[s]?.label || s}</option>
                    ))}
                  </Select>
                </div>
                <Button
                  variant={NEEDS_REASON.includes(statusTo) ? 'danger' : 'primary'}
                  loading={pending}
                  disabled={!statusTo || (needsReason && !reason.trim()) || actionsDisabled}
                  onClick={() => onStatus({ to: statusTo, reason: reason.trim() || undefined })}
                >
                  Apply
                </Button>
              </div>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={needsReason ? 'Reason (required)' : 'Reason (optional, kept in history)'}
                disabled={actionsDisabled}
              />
              {needsReason && (
                <p className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
                  {statusTo === 'suspended'
                    ? 'The account becomes read-only: recording, imports and cuts stop and share links stop resolving. Nothing is deleted.'
                    : 'The account becomes read-only and the 60-day wind-down starts. Exports keep working; the data is deleted on the date the banner shows the customer.'}
                </p>
              )}
            </div>
          )}

          {sub.status === 'trial' && (
            <div className="mt-3 rounded-lg border border-border bg-sunken p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Trial</span>
                <span className="text-xs text-fg-muted">ends {formatDate(sub.trialEndsAt)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-xs font-semibold text-fg-muted" htmlFor="extend-days">Extend by</label>
                  <div className="mt-1 flex items-center gap-1">
                    <Input
                      id="extend-days"
                      type="number"
                      min="1"
                      max="90"
                      className="w-20"
                      value={extendDays}
                      onChange={(e) => setExtendDays(e.target.value)}
                    />
                    <span className="text-xs text-fg-muted">days</span>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  disabled={extendDays === '' || actionsDisabled}
                  onClick={() => onExtendTrial({ days: Math.max(1, Math.min(90, parseInt(extendDays, 10) || 7)) })}
                >
                  Extend
                </Button>
                <div>
                  <label className="block text-xs font-semibold text-fg-muted" htmlFor="trial-until">or set end date</label>
                  <Input id="trial-until" type="date" value={trialUntil} onChange={(e) => setTrialUntil(e.target.value)} />
                </div>
                <Button
                  variant="secondary"
                  disabled={!trialUntil || actionsDisabled}
                  onClick={() => onExtendTrial({ until: new Date(`${trialUntil}T00:00:00`).toISOString() })}
                >
                  Set
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Plan, terms, contact, notes */}
        <Card className="p-4">
          <SectionTitle>Plan &amp; payment terms</SectionTitle>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-fg-muted" htmlFor="org-rate">Rate ($ / campaign / month)</label>
              <Input id="org-rate" type="number" min="0" step="1" value={rateDollars} onChange={(e) => setRateDollars(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button
                variant="secondary"
                loading={pending}
                disabled={rateDollars === '' || Number.isNaN(Number(rateDollars)) || actionsDisabled}
                onClick={() => onPatch({ pricePerCampaignCents: Math.round(Number(rateDollars) * 100) })}
              >
                Save rate
              </Button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted" htmlFor="terms-days">Payment terms</label>
              <div className="mt-1 flex items-center gap-1">
                <Input
                  id="terms-days"
                  type="number"
                  min="0"
                  max="365"
                  className="w-24"
                  value={termsDays}
                  onChange={(e) => setTermsDays(e.target.value)}
                />
                <span className="text-xs text-fg-muted">days (net)</span>
              </div>
            </div>
            <div className="flex items-end">
              <Button
                variant="secondary"
                loading={pending}
                disabled={termsDays === '' || Number.isNaN(Number(termsDays)) || actionsDisabled}
                onClick={() => onPatch({ paymentTermsDays: Math.max(0, Math.min(365, parseInt(termsDays, 10) || 0)) })}
              >
                Save terms
              </Button>
            </div>
          </div>
          <p className="mt-1 text-xs text-fg-subtle">
            Applies to statements issued from now on. A statement already issued keeps the due date it was issued with.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-fg-muted" htmlFor="contact-name">Billing contact</label>
              <Input id="contact-name" value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} placeholder="Name" />
            </div>
            <div className="flex items-end">
              <Input value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} placeholder="Billing email" />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs font-semibold text-fg-muted" htmlFor="org-notes">Internal notes</label>
            <Textarea
              id="org-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="LOI terms, grandfathered deals — never shown to the org"
            />
          </div>
          <div className="mt-2">
            <Button variant="secondary" loading={pending} disabled={actionsDisabled} onClick={() => onPatch({ billingContact: contact, notes })}>
              Save contact &amp; notes
            </Button>
          </div>
          <p className="mt-2 text-xs text-fg-subtle">Per-campaign rates live on the Campaigns tab.</p>
        </Card>
      </div>

      {/* The audit trail. Named "Change history" rather than "History", which is what the month
          ledger was called — one page cannot have two Histories meaning different things. */}
      <Card className="p-4">
        <SectionTitle>Change history</SectionTitle>
        {!events?.length ? (
          <p className="mt-2 text-sm text-fg-muted">No billing changes recorded yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {events.map((e) => (
              <li key={e._id} className="py-2">
                <span className="text-fg">
                  {e.fromStatus || e.toStatus
                    ? `${e.fromStatus || '—'} → ${e.toStatus || '—'}`
                    : changeText(e.changes) || 'updated'}
                </span>
                <span className="text-fg-muted">
                  {' · '}
                  {formatDate(e.createdAt)}
                  {e.byUserId ? ` · ${e.byUserId.firstName || ''} ${e.byUserId.lastName || ''}`.trimEnd() : ''}
                  {e.reason ? ` — “${e.reason}”` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {eventsTotal > EVENTS_LIMIT && (
          <div className="mt-3">
            <Pager skip={eventsSkip} limit={EVENTS_LIMIT} total={eventsTotal} onChange={onEventsSkip} />
          </div>
        )}
      </Card>

      {/* Danger zone */}
      <Card className="border-danger/30 p-4">
        <SectionTitle>Danger zone</SectionTitle>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={actionsDisabled} onClick={onToggleActive}>
            {org?.isActive ? 'Deactivate…' : 'Reactivate'}
          </Button>
          <Button variant="secondary" disabled={actionsDisabled} onClick={onRename}>Rename…</Button>
          {canDelete && (
            <Button variant="danger" disabled={actionsDisabled} onClick={onDelete}>Delete organization…</Button>
          )}
          {!canDelete && (
            <span className="text-xs text-fg-subtle">Deleting an organization requires break-glass authority.</span>
          )}
        </div>
        <p className="mt-2 text-xs text-fg-subtle">
          Deactivating stops sign-in and nothing else — billing, statements and any unpaid balance are untouched.
        </p>
      </Card>

      {org?.isInternal && (
        <p className="text-xs text-fg-subtle">
          <Badge variant="neutral" className="mr-1.5">Internal</Badge>
          This organization holds only Doorline&apos;s synthetic data.
        </p>
      )}
    </div>
  );
}
