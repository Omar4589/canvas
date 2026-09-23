import { useState } from 'react';
import { Badge, Button, Input, Modal, Textarea } from '../../ui/index.js';
import { fmtUsd } from '../../../lib/billingStatus.jsx';
import { monthLabel } from '../../../lib/months.js';
import { formatDate } from '../../../lib/dates.js';

// The four irreversible billing actions, each as a real dialog that states its consequence.
//
// All of this used to be window.confirm and window.prompt: unstyled, unthemed, blocked outright by
// some browsers, and — worse — describing none of what was about to be frozen or erased. A void
// collected its required reason through a browser prompt box.

const errText = (err) => err?.message || 'Something went wrong.';

// ---- Issue -------------------------------------------------------------------

export function IssueStatementModal({ months, orgName, termsDays, currentMonth, onClose, onIssue, pending, error, results }) {
  const [externalRef, setExternalRef] = useState('');
  const [forceAck, setForceAck] = useState(false);
  const open = months.filter((m) => m.month >= currentMonth);
  const needsForce = open.length > 0;
  const total = months.reduce((n, m) => n + (m.totalCents || 0), 0);
  const one = months.length === 1;

  return (
    <Modal
      size="lg"
      onClose={onClose}
      title={one ? `Issue ${monthLabel(months[0].month)}` : `Issue ${months.length} statements`}
      subtitle={orgName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={needsForce && !forceAck}
            onClick={() => onIssue({ externalRef: externalRef.trim() || undefined, force: needsForce && forceAck })}
          >
            {one ? 'Issue statement' : `Issue ${months.length} months`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          Issuing freezes {one ? 'this month' : 'these months'}. From then on {one ? 'it reads' : 'they read'} from the
          frozen record, and any later change shows up as drift rather than quietly rewriting what you invoiced.
        </p>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-border">
              {months.map((m) => (
                <tr key={m.month}>
                  <td className="px-3 py-2 font-medium text-fg">{monthLabel(m.month)}</td>
                  <td className="px-3 py-2 text-fg-muted">
                    {m.billableCampaigns} campaign{m.billableCampaigns === 1 ? '' : 's'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg">{fmtUsd(m.totalCents)}</td>
                </tr>
              ))}
              <tr className="bg-sunken font-semibold">
                <td className="px-3 py-2 text-fg" colSpan={2}>Total</td>
                <td className="px-3 py-2 text-right tabular-nums text-fg">{fmtUsd(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <label className="block text-xs font-semibold text-fg-muted" htmlFor="issue-ref">
            Invoice number <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <Input
            id="issue-ref"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="The number on the PDF you send"
            autoFocus
          />
          <p className="mt-1 text-xs text-fg-subtle">
            {one ? 'Recorded on this statement' : 'All selected months are issued under this one number'} · payment due{' '}
            <span className="font-medium text-fg-muted">{termsDays} days</span> after issuing (net {termsDays}, change on Account).
          </p>
        </div>

        {needsForce && (
          <div className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2.5 text-sm text-warning-fg">
            <p className="font-semibold">
              {open.length === 1 ? `${monthLabel(open[0].month)} has not finished yet.` : `${open.length} of these months have not finished yet.`}
            </p>
            <p className="mt-1">
              Knocks recorded for the rest of the month will NOT be on the invoice — they show up later as drift.
              Issue early only for a prepay or a deliberate close-out.
            </p>
            <label className="mt-2 flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={forceAck} onChange={(e) => setForceAck(e.target.checked)} />
              Issue anyway
            </label>
          </div>
        )}

        {results?.length > 0 && (
          <div className="rounded-md border border-border bg-sunken px-3 py-2 text-sm">
            <p className="font-semibold text-fg">Results</p>
            <ul className="mt-1 space-y-0.5">
              {results.map((r) => (
                <li key={r.month} className={r.ok ? 'text-success-fg' : 'text-danger-fg'}>
                  {monthLabel(r.month)}: {r.ok ? `issued · ${fmtUsd(r.totalCents)}` : r.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">{errText(error)}</div>}
      </div>
    </Modal>
  );
}

// ---- Void --------------------------------------------------------------------

export function VoidStatementModal({ month, totalCents, paidAt, onClose, onVoid, pending, error }) {
  const [reason, setReason] = useState('');
  // A paid statement cannot be voided — the server refuses it. Say why, and offer nothing to click.
  if (paidAt) {
    return (
      <Modal
        size="md"
        onClose={onClose}
        title={`The ${monthLabel(month)} statement is marked paid`}
        footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
      >
        <p className="text-sm text-fg-muted">
          Unmark it paid first, then void it. Recording that the money arrived and correcting the invoice are two
          separate decisions, and each gets its own entry in the history.
        </p>
      </Modal>
    );
  }
  return (
    <Modal
      size="md"
      onClose={onClose}
      title={`Void the ${monthLabel(month)} statement?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} disabled={!reason.trim()} onClick={() => onVoid({ reason: reason.trim() })}>
            Void statement
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">
          This statement is for <span className="font-semibold text-fg">{fmtUsd(totalCents)}</span>. Voiding does not
          delete it — the row stays in the paper trail, and reissuing the month links the two together.
        </p>
        <div>
          <label className="block text-xs font-semibold text-fg-muted" htmlFor="void-reason">Reason (required)</label>
          <Textarea
            id="void-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this invoice was wrong — future you reads this"
            autoFocus
          />
        </div>
        {error && <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">{errText(error)}</div>}
      </div>
    </Modal>
  );
}

// ---- Mark paid ---------------------------------------------------------------

export function MarkPaidModal({ month, totalCents, issuedAt, externalRef, asOf, onClose, onPaid, pending, error }) {
  // The server's stamp, not the browser's clock — the same instant every other figure on the page
  // was computed against.
  const today = (asOf ? new Date(asOf) : new Date()).toISOString().slice(0, 10);
  const [paidOn, setPaidOn] = useState(today);
  const [paymentRef, setPaymentRef] = useState('');
  const prepay = issuedAt && paidOn < new Date(issuedAt).toISOString().slice(0, 10);

  return (
    <Modal
      size="md"
      onClose={onClose}
      title={`Mark ${monthLabel(month)} paid`}
      subtitle={externalRef ? `Invoice ${externalRef}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={pending}
            // Guarded like the trial date field beside it: an emptied date built an Invalid Date,
            // which threw on toISOString before any request was sent — so the click did nothing
            // and said nothing.
            disabled={!paidOn}
            onClick={() => onPaid({ paidAt: new Date(`${paidOn}T12:00:00`).toISOString(), paymentRef: paymentRef.trim() || undefined })}
          >
            Mark paid
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">
          Amount <span className="font-semibold text-fg">{fmtUsd(totalCents)}</span>
          {issuedAt ? <> · invoiced {formatDate(issuedAt)}</> : null}
        </p>
        <div>
          <label className="block text-xs font-semibold text-fg-muted" htmlFor="paid-on">Paid on</label>
          <Input id="paid-on" type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} autoFocus />
        </div>
        {prepay && (
          <div className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm text-warning-fg">
            That date is before the invoice was issued — it will be recorded as a prepayment.
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-fg-muted" htmlFor="paid-ref">
            Payment reference <span className="font-normal text-fg-subtle">(optional)</span>
          </label>
          <Input
            id="paid-ref"
            value={paymentRef}
            onChange={(e) => setPaymentRef(e.target.value)}
            placeholder="Invoice #, check #, transfer id"
          />
          <p className="mt-1 text-xs text-fg-subtle">
            A reference number only — never a person&apos;s name, and never card or bank details.
          </p>
        </div>
        <p className="text-xs text-fg-subtle">Recorded in the billing history with your name.</p>
        {error && <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">{errText(error)}</div>}
      </div>
    </Modal>
  );
}

// ---- Unmark paid -------------------------------------------------------------

export function UnmarkPaidModal({ month, paidAt, paymentRef, onClose, onUnmark, pending, error }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      size="md"
      onClose={onClose}
      title={`Unmark ${monthLabel(month)} paid?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} disabled={!reason.trim()} onClick={() => onUnmark({ reason: reason.trim() })}>
            Unmark paid
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">
          Recorded paid {formatDate(paidAt)}
          {paymentRef ? <> · reference <span className="font-mono text-xs">{paymentRef}</span></> : null}. The statement
          goes back to outstanding, or overdue if its due date has passed. Both values stay in the history.
        </p>
        <div>
          <label className="block text-xs font-semibold text-fg-muted" htmlFor="unpaid-reason">Reason (required)</label>
          <Textarea
            id="unpaid-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why the payment record is being removed"
            autoFocus
          />
        </div>
        {error && <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">{errText(error)}</div>}
      </div>
    </Modal>
  );
}

// ---- Per-campaign rate -------------------------------------------------------

export function SetCampaignRateModal({ campaign, orgRateCents, onClose, onSave, pending, error }) {
  const [dollars, setDollars] = useState(
    campaign?.pricePerCampaignCents == null ? '' : String(campaign.pricePerCampaignCents / 100)
  );
  return (
    <Modal
      size="md"
      onClose={onClose}
      title={`Rate for ${campaign?.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              onSave({
                pricePerCampaignCents: dollars.trim() === '' ? null : Math.round(Number(dollars) * 100),
              })
            }
            disabled={dollars.trim() !== '' && Number.isNaN(Number(dollars))}
          >
            Save rate
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-fg-muted" htmlFor="campaign-rate">
            Dollars per month
          </label>
          <Input
            id="campaign-rate"
            type="number"
            min="0"
            step="1"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            placeholder={String((orgRateCents ?? 30000) / 100)}
            autoFocus
          />
          <p className="mt-1 text-xs text-fg-subtle">
            Leave blank to inherit the org rate ({fmtUsd(orgRateCents)}). <span className="font-medium">0</span> is a
            comped campaign — it still counts as billing, at nothing.
          </p>
        </div>
        <p className="text-xs text-fg-subtle">
          Changing a rate re-prices every month that has not been issued. Frozen statements keep the rate they were
          issued with.
        </p>
        {error && <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-fg">{errText(error)}</div>}
      </div>
    </Modal>
  );
}

// ---- Drift badge (shared) ----------------------------------------------------

export function DriftBadge({ drift }) {
  if (!drift) return null;
  return (
    <Badge
      variant={drift.material ? 'warning' : 'neutral'}
      title={
        drift.material
          ? `Invoiced ${fmtUsd(drift.totalCents?.issued)} — a live recompute now says ${fmtUsd(drift.totalCents?.live)}`
          : 'Some detail has moved since this was issued; the amount has not'
      }
    >
      Drifted
    </Badge>
  );
}
