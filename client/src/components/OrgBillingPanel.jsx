import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { BillingPill, BILLING_STATUS_META, fmtUsd, currentMonthStr } from '../lib/billingStatus.jsx';

const STATUSES = ['trial', 'active', 'past_due', 'suspended', 'canceled', 'internal'];
const inputCls =
  'mt-1 w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';
const btnCls =
  'rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60';

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

// The account-manager Billing panel for one org (rendered by OrganizationsPage).
// Status transitions, trial extension, rate/contact/notes, the monthly
// statement, and the audit history — the whole sales-led billing loop.
export default function OrgBillingPanel({ orgId, orgName, onClose }) {
  const qc = useQueryClient();
  const [statusTo, setStatusTo] = useState('');
  const [reason, setReason] = useState('');
  const [rateDollars, setRateDollars] = useState('');
  const [contact, setContact] = useState({ name: '', email: '' });
  const [notes, setNotes] = useState('');
  const thisMonth = currentMonthStr();
  const [month, setMonth] = useState(thisMonth);
  // Custom trial control: extend BY N days, or set an explicit end date.
  const [extendDays, setExtendDays] = useState('7');
  const [trialUntil, setTrialUntil] = useState('');
  const [error, setError] = useState(null);

  const key = ['super-admin', 'billing', orgId];
  const billingQ = useQuery({
    queryKey: key,
    queryFn: () => api(`/super-admin/organizations/${orgId}/billing`),
  });
  const statementQ = useQuery({
    queryKey: [...key, 'statement', month],
    queryFn: () => api(`/super-admin/organizations/${orgId}/billing/statement?month=${month}`),
    enabled: Boolean(month),
  });
  // The current-month meter for the "This month" headline — pinned to thisMonth so
  // it stays accurate even when the account manager browses an older statement.
  // Shares statementQ's cache (identical key) when month === thisMonth: no extra fetch.
  const thisMonthQ = useQuery({
    queryKey: [...key, 'statement', thisMonth],
    queryFn: () => api(`/super-admin/organizations/${orgId}/billing/statement?month=${thisMonth}`),
  });

  const sub = billingQ.data?.subscription;
  useEffect(() => {
    if (!sub) return;
    setRateDollars(String((sub.pricePerCampaignCents ?? 30000) / 100));
    setContact(sub.billingContact || { name: '', email: '' });
    setNotes(sub.notes || '');
  }, [sub?._id, sub?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['super-admin', 'organizations'] });
    qc.invalidateQueries({ queryKey: ['super-admin', 'platform-overview'] });
  };
  const onErr = (err) => setError(err.message);

  const statusMut = useMutation({
    mutationFn: (body) => api(`/super-admin/organizations/${orgId}/billing/status`, { method: 'POST', body }),
    onSuccess: () => {
      setStatusTo('');
      setReason('');
      setError(null);
      refetchAll();
    },
    onError: onErr,
  });
  const extendMut = useMutation({
    mutationFn: (body) => api(`/super-admin/organizations/${orgId}/billing/extend-trial`, { method: 'POST', body }),
    onSuccess: () => {
      setError(null);
      refetchAll();
    },
    onError: onErr,
  });
  const patchMut = useMutation({
    mutationFn: (body) => api(`/super-admin/organizations/${orgId}/billing`, { method: 'PATCH', body }),
    onSuccess: () => {
      setError(null);
      refetchAll();
    },
    onError: onErr,
  });

  const ent = billingQ.data?.entitlement;
  const needsReason = ['suspended', 'canceled'].includes(statusTo);
  const stmt = statementQ.data;
  const thisStmt = thisMonthQ.data;
  const thisBillable = thisStmt ? thisStmt.lines.filter((l) => l.billable).length : null;

  function downloadCsv() {
    if (!stmt) return;
    const rows = [
      ['Campaign', 'Households', 'First knock', 'Archived', 'Knocks this month', 'Billable', 'Amount'],
      ...stmt.lines.map((l) => [
        l.name,
        l.households,
        l.firstKnockAt ? new Date(l.firstKnockAt).toISOString().slice(0, 10) : '',
        l.archivedAt ? new Date(l.archivedAt).toISOString().slice(0, 10) : '',
        l.knocksThisMonth,
        l.billable ? 'yes' : 'no',
        (l.amountCents / 100).toFixed(2),
      ]),
      ['Total', '', '', '', '', '', (stmt.totalCents / 100).toFixed(2)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${orgName.replaceAll(/\s+/g, '-').toLowerCase()}-statement-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Billing — {orgName}</h2>
          {sub && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <BillingPill effective={ent?.effective} />
              <span>
                since {fmtDate(sub.statusChangedAt)}
                {sub.status === 'trial' && ` · trial ends ${fmtDate(sub.trialEndsAt)}`}
                {ent?.banner === 'trial_expired' && ' · EXPIRED'}
              </span>
            </div>
          )}
        </div>
        <button onClick={onClose} className="text-xs font-semibold text-fg-muted hover:text-fg">
          Close ✕
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</div>
      )}
      {billingQ.isLoading && <p className="mt-3 text-sm text-fg-muted">Loading…</p>}

      {sub && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Status + trial */}
          <div className="rounded-lg border border-border bg-surface p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Status</h3>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs font-semibold text-fg-muted">Change to</label>
                <select value={statusTo} onChange={(e) => setStatusTo(e.target.value)} className={inputCls}>
                  <option value="">— keep {BILLING_STATUS_META[sub.status]?.label || sub.status} —</option>
                  {STATUSES.filter((s) => s !== sub.status).map((s) => (
                    <option key={s} value={s}>
                      {BILLING_STATUS_META[s]?.label || s}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => statusMut.mutate({ to: statusTo, reason: reason.trim() || undefined })}
                disabled={!statusTo || (needsReason && !reason.trim()) || statusMut.isPending}
                className={btnCls}
              >
                Apply
              </button>
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={needsReason ? 'Reason (required)' : 'Reason (optional, kept in history)'}
              className={inputCls}
            />
            {sub.status === 'trial' && (
              <div className="mt-3 rounded-md border border-border bg-card p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Trial</span>
                  <span className="text-xs text-fg-muted">ends {fmtDate(sub.trialEndsAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-fg-muted">Extend by</label>
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        type="number"
                        min="1"
                        max="90"
                        value={extendDays}
                        onChange={(e) => setExtendDays(e.target.value)}
                        className="w-16 rounded-md border border-border-strong bg-card px-2 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      />
                      <span className="text-xs text-fg-muted">days</span>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      extendMut.mutate({ days: Math.max(1, Math.min(90, parseInt(extendDays, 10) || 7)) })
                    }
                    disabled={extendMut.isPending || extendDays === ''}
                    className={btnCls}
                  >
                    Extend
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-fg-muted">or set end date</label>
                    <input
                      type="date"
                      value={trialUntil}
                      onChange={(e) => setTrialUntil(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <button
                    onClick={() => extendMut.mutate({ until: new Date(`${trialUntil}T00:00:00`).toISOString() })}
                    disabled={extendMut.isPending || !trialUntil}
                    className={btnCls}
                  >
                    Set
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Plan / contact / notes */}
          <div className="rounded-lg border border-border bg-surface p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Plan & contact</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-fg-muted">Rate ($ / campaign / month)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={rateDollars}
                  onChange={(e) => setRateDollars(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => patchMut.mutate({ pricePerCampaignCents: Math.round(Number(rateDollars) * 100) })}
                  disabled={patchMut.isPending || rateDollars === '' || Number.isNaN(Number(rateDollars))}
                  className={btnCls}
                >
                  Save rate
                </button>
              </div>
              <input
                value={contact.name}
                onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
                placeholder="Billing contact name"
                className={inputCls}
              />
              <input
                value={contact.email}
                onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                placeholder="Billing email"
                className={inputCls}
              />
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes (LOI terms, grandfathered deals — never shown to the org)"
              rows={2}
              className={inputCls}
            />
            <button
              onClick={() => patchMut.mutate({ billingContact: contact, notes })}
              disabled={patchMut.isPending}
              className={`mt-2 ${btnCls}`}
            >
              Save contact & notes
            </button>
          </div>
        </div>
      )}

      {/* Statement */}
      <div className="mt-4 rounded-lg border border-border bg-surface p-3">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-brand-accent/20 bg-brand-tint px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand-accent">This month</span>
          <span className="text-sm font-semibold text-fg">
            {thisStmt
              ? `${thisBillable} campaign${thisBillable === 1 ? '' : 's'} billing · ${fmtUsd(thisStmt.totalCents)}`
              : thisMonthQ.isLoading
                ? 'Computing…'
                : '—'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Monthly statement</h3>
          <div className="flex items-center gap-2">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls + ' mt-0'} />
            <button onClick={downloadCsv} disabled={!stmt} className="text-xs font-semibold text-brand-accent hover:opacity-80">
              Export CSV
            </button>
          </div>
        </div>
        {statementQ.isLoading && <p className="mt-2 text-sm text-fg-muted">Computing…</p>}
        {stmt && (
          <table className="mt-2 min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="py-1 pr-3">Campaign</th>
                <th className="py-1 pr-3">Households</th>
                <th className="py-1 pr-3">First knock</th>
                <th className="py-1 pr-3">Knocks ({month})</th>
                <th className="py-1 pr-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stmt.lines.map((l) => (
                <tr key={l.campaignId} className={l.billable ? '' : 'text-fg-subtle'}>
                  <td className="py-1.5 pr-3">
                    {l.name}
                    {!l.isActive && <span className="ml-1 text-xs">(archived {fmtDate(l.archivedAt)})</span>}
                    {l.billable ? '' : l.firstKnockAt ? '' : ' — not billing yet'}
                  </td>
                  <td className="py-1.5 pr-3">{l.households.toLocaleString()}</td>
                  <td className="py-1.5 pr-3">{fmtDate(l.firstKnockAt)}</td>
                  <td className="py-1.5 pr-3">{l.knocksThisMonth.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-right">{l.billable ? fmtUsd(l.amountCents) : '—'}</td>
                </tr>
              ))}
              <tr className="font-semibold text-fg">
                <td className="py-1.5 pr-3">Total ({stmt.lines.filter((l) => l.billable).length} × {fmtUsd(stmt.rateCents)})</td>
                <td colSpan={3} />
                <td className="py-1.5 pr-3 text-right">{fmtUsd(stmt.totalCents)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* History */}
      {billingQ.data?.events?.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">History</h3>
          <ul className="mt-2 space-y-1 text-sm text-fg-muted">
            {billingQ.data.events.map((ev) => (
              <li key={ev._id}>
                <span className="text-fg-subtle">{new Date(ev.createdAt).toLocaleDateString()}</span>{' '}
                {ev.fromStatus || ev.toStatus
                  ? `${ev.fromStatus ? `${ev.fromStatus} → ` : ''}${ev.toStatus || ''}`
                  : Object.keys(ev.changes || {}).join(', ') + ' updated'}
                {ev.byUserId && ` · ${[ev.byUserId.firstName, ev.byUserId.lastName].filter(Boolean).join(' ')}`}
                {ev.reason && ` · “${ev.reason}”`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
