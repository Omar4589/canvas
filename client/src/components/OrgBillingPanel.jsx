import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { BillingPill, BILLING_STATUS_META, fmtUsd, currentMonthStr } from '../lib/billingStatus.jsx';
import { saveCsvRows } from '../lib/downloadFile.js';
import Pager from './Pager.jsx';
import { Segmented } from './ui/index.js';

const STATUSES = ['trial', 'active', 'past_due', 'suspended', 'canceled', 'internal'];
const inputCls =
  'mt-1 w-full rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';
const btnCls =
  'rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60';

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

const EVENTS_LIMIT = 25;

// 'YYYY-MM' minus n months. Mirrors billingMonths.addMonths on the server; the panel needs it to
// turn "last 12 months" into the from/to the history endpoint takes.
function monthsAgo(month, n) {
  const [y, m] = String(month).split('-').map(Number);
  const total = y * 12 + (m - 1) - n;
  const y2 = Math.floor(total / 12);
  const m2 = total - y2 * 12 + 1;
  return `${String(y2).padStart(4, '0')}-${String(m2).padStart(2, '0')}`;
}

// 'YYYY-MM' → 'July 2026'.
function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!y || !m) return ym || '—';
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Why a line is (or isn't) on the invoice. Mirrors the reason codes in
// server/src/services/billing/billingMonths.js. 'billable' needs no label — it's the default —
// and 'before-start' is self-evident from the Billing-started column.
const REASON_LABEL = {
  'no-field-visit': 'not billing yet',
  'start-grace': 'free — started in the last week',
  'end-grace': 'free — archived with no knocks',
  floor: 'minimum one month',
  'archived-earlier': 'archived',
};

// Render a changes-only event from its stored before/after values instead of a bare "X updated" —
// the numbers were always in SubscriptionEvent.changes, just never shown.
function changeText(ch) {
  const parts = [];
  if (ch.pricePerCampaignCents) {
    parts.push(`rate ${fmtUsd(ch.pricePerCampaignCents.from ?? 30000)} → ${fmtUsd(ch.pricePerCampaignCents.to)}`);
  }
  if (ch.billingContact) {
    const to = ch.billingContact.to || {};
    parts.push(`contact → ${[to.name, to.email].filter(Boolean).join(' · ') || '(cleared)'}`);
  }
  if (ch.trialEndsAt) parts.push(`trial end ${fmtDate(ch.trialEndsAt.from)} → ${fmtDate(ch.trialEndsAt.to)}`);
  if (ch.notes) parts.push('notes updated');
  if (ch.campaignRate) {
    const { campaignName, from, to } = ch.campaignRate;
    parts.push(
      `rate for ${campaignName || 'a campaign'} ${from == null ? 'org default' : fmtUsd(from)} → ${
        to == null ? 'org default' : fmtUsd(to)
      }`
    );
  }
  if (ch.statementIssued) {
    const s = ch.statementIssued;
    parts.push(
      `statement ${s.month} issued · ${fmtUsd(s.totalCents)}${s.externalRef ? ` · ref ${s.externalRef}` : ''}`
    );
  }
  if (ch.statementVoided) {
    parts.push(`statement ${ch.statementVoided.month} voided · ${fmtUsd(ch.statementVoided.totalCents)}`);
  }
  const known = [
    'pricePerCampaignCents', 'billingContact', 'trialEndsAt', 'notes',
    'campaignRate', 'statementIssued', 'statementVoided',
  ];
  const rest = Object.keys(ch).filter((k) => !known.includes(k));
  if (rest.length) parts.push(`${rest.join(', ')} updated`);
  return parts.join(' · ');
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
  const [externalRef, setExternalRef] = useState('');
  // { campaignId, dollars } while a per-campaign rate is being edited inline.
  const [rateEdit, setRateEdit] = useState(null);
  // Custom trial control: extend BY N days, or set an explicit end date.
  const [extendDays, setExtendDays] = useState('7');
  const [trialUntil, setTrialUntil] = useState('');
  const [error, setError] = useState(null);
  const [eventsSkip, setEventsSkip] = useState(0);
  // Which tab. Component state, not the URL: this panel is opened inline from OrganizationsPage
  // against a selected org, so a URL param would end up fighting that selection.
  const [tab, setTab] = useState('statement');
  // History tab: the months ticked for a combined invoice, and the one ref they all carry.
  const [picked, setPicked] = useState(() => new Set());
  const [batchRef, setBatchRef] = useState('');
  const [batchResult, setBatchResult] = useState(null);
  const [historyMonths, setHistoryMonths] = useState(12);
  // Rename / re-slug (PATCH /super-admin/organizations/:orgId — it always supported name+slug;
  // this is the first UI for it).
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameEdit, setNameEdit] = useState('');
  const [slugEdit, setSlugEdit] = useState('');

  const key = ['super-admin', 'billing', orgId];
  const billingQ = useQuery({
    queryKey: [...key, 'events', eventsSkip],
    queryFn: () => api(`/super-admin/organizations/${orgId}/billing?eventsSkip=${eventsSkip}&eventsLimit=${EVENTS_LIMIT}`),
    placeholderData: keepPreviousData,
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

  // The month ledger behind the History tab. One request for the whole range — the server does it
  // in three queries per campaign regardless of how many months (monthlyStatementRange).
  const historyQ = useQuery({
    queryKey: [...key, 'history', historyMonths],
    queryFn: () =>
      api(`/super-admin/organizations/${orgId}/billing/history?from=${monthsAgo(thisMonth, historyMonths - 1)}&to=${thisMonth}`),
    enabled: tab === 'history',
    placeholderData: keepPreviousData,
  });
  // The paper trail: every statement ever issued OR VOIDED. The voided rows are the half the
  // ledger above can't show — it only knows what currently stands for each month.
  const paperQ = useQuery({
    queryKey: [...key, 'statements'],
    queryFn: () => api(`/super-admin/organizations/${orgId}/billing/statements`),
    enabled: tab === 'history',
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
  const renameMut = useMutation({
    mutationFn: (body) => api(`/super-admin/organizations/${orgId}`, { method: 'PATCH', body }),
    onSuccess: () => {
      setRenameOpen(false);
      setError(null);
      refetchAll();
    },
    onError: onErr,
  });
  // Freeze / unfreeze a month. refetchAll() already prefix-invalidates [...key, 'statement', month],
  // so the statement view refreshes without naming it.
  const issueMut = useMutation({
    mutationFn: (body) =>
      api(`/super-admin/organizations/${orgId}/billing/statement/${month}/issue`, { method: 'POST', body }),
    onSuccess: () => {
      setExternalRef('');
      setError(null);
      refetchAll();
    },
    onError: onErr,
  });
  // Issue SEVERAL months under one invoice number. The server answers 200 with a per-month outcome
  // even when some months fail, so this keeps the result rather than treating it as an error.
  const issueManyMut = useMutation({
    mutationFn: (body) =>
      api(`/super-admin/organizations/${orgId}/billing/statements/issue`, { method: 'POST', body }),
    onSuccess: (res) => {
      setBatchResult(res);
      setBatchRef('');
      // Keep only the months that did NOT issue selected, so a retry is one click on what's left.
      setPicked(new Set(res.results.filter((r) => !r.ok).map((r) => r.month)));
      setError(null);
      refetchAll();
    },
    onError: onErr,
  });
  const voidMut = useMutation({
    mutationFn: ({ statementId, reason: why }) =>
      api(`/super-admin/organizations/${orgId}/billing/statement/${statementId}/void`, {
        method: 'POST',
        body: { reason: why },
      }),
    onSuccess: () => {
      setError(null);
      refetchAll();
    },
    onError: onErr,
  });
  // Per-campaign negotiated rate. Empty input clears the override back to the org default.
  const campaignRateMut = useMutation({
    mutationFn: ({ campaignId, pricePerCampaignCents }) =>
      api(`/super-admin/organizations/${orgId}/billing/campaigns/${campaignId}`, {
        method: 'PATCH',
        body: { pricePerCampaignCents },
      }),
    onSuccess: () => {
      setRateEdit(null);
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
  // Once a month is issued, the FROZEN statement is what the table, the totals and the CSV show —
  // that is the number that was invoiced. The live recompute stays available underneath, and any
  // divergence between them surfaces as `drift` rather than silently replacing what you sent.
  const issued = stmt?.statement || null;
  const view = issued || stmt;
  const drift = stmt?.drift || null;
  const issuedBy = issued?.issuedByUserId
    ? `${issued.issuedByUserId.firstName || ''} ${issued.issuedByUserId.lastName || ''}`.trim()
    : '';
  const monthEnded = month < thisMonth;
  const billingLines = view ? view.lines.filter((l) => l.billable) : [];
  // Do all billing campaigns share the org rate? Decides whether the totals row can honestly
  // show "n × rate" (see the note on that row).
  const uniformRate = billingLines.every((l) => l.rateCents === view?.rateCents);

  function downloadCsv() {
    if (!stmt) return;
    // A statement CSV is the artifact most likely to end up attached to an invoice email, so it
    // has to say on its face whether it is the FROZEN issued figure or a live recompute. Exporting
    // an unlabelled sheet is how the two get confused six months later.
    const src = issued
      ? `ISSUED ${fmtDate(issued.issuedAt)}${issuedBy ? ` by ${issuedBy}` : ''} — rules v${issued.rulesVersion}${
          issued.externalRef ? ` — ref ${issued.externalRef}` : ''
        }`
      : 'LIVE — not issued, recomputed on export';
    const rows = [
      ['Statement', month, src],
      [],
      ['Campaign', 'Households', 'Billing started', 'Archived', 'Knocks this month', 'Restricted doors', 'Billable doors', 'Billable', 'Reason', 'Rate', 'Amount'],
      ...view.lines.map((l) => [
        l.name,
        l.households,
        l.firstKnockAt ? new Date(l.firstKnockAt).toISOString().slice(0, 10) : '',
        l.archivedAt ? new Date(l.archivedAt).toISOString().slice(0, 10) : '',
        l.knocksThisMonth,
        l.restrictedDoorsThisMonth,
        // The org's own invoice figure; equals knocks when it doesn't bill restricted doors.
        l.billRestrictedDoors ? l.billableDoorsThisMonth : l.knocksThisMonth,
        l.billable ? 'yes' : 'no',
        l.reason || '',
        ((l.rateCents ?? 0) / 100).toFixed(2),
        (l.amountCents / 100).toFixed(2),
      ]),
      ['Total', '', '', '', '', '', '', '', '', '', (view.totalCents / 100).toFixed(2)],
    ];
    saveCsvRows(
      rows,
      `${(displayName || 'org').replaceAll(/\s+/g, '-').toLowerCase()}-statement-${month}-${
        issued ? 'issued' : 'live'
      }.csv`
    );
  }

  // The COMBINED export: several months on one sheet, which is the artifact that gets attached to
  // a single invoice covering July and August. Same provenance discipline as the single-month CSV —
  // every line says whether it came from a FROZEN issued statement or a live recompute, because an
  // unlabelled sheet is exactly how the two get confused six months later.
  function downloadRangeCsv() {
    const months = (historyQ.data?.months || []).filter((m) => picked.has(m.month));
    if (!months.length) return;
    const rows = [
      ['Statements', `${months[months.length - 1].month} to ${months[0].month}`, displayName || ''],
      [],
      ['Month', 'Source', 'Campaign', 'Households', 'Billing started', 'Archived', 'Knocks', 'Restricted doors', 'Billable doors', 'Billable', 'Reason', 'Rate', 'Amount'],
    ];
    // Oldest first on the sheet — an invoice reads forwards even though the screen reads backwards.
    for (const m of [...months].reverse()) {
      const src = m.issued
        ? `ISSUED ${fmtDate(m.issuedAt)}${m.issuedBy ? ` by ${m.issuedBy}` : ''} — rules v${m.rulesVersion}${m.externalRef ? ` — ref ${m.externalRef}` : ''}`
        : 'LIVE — not issued, recomputed on export';
      for (const l of m.lines) {
        rows.push([
          m.month,
          src,
          l.name,
          l.households,
          l.firstKnockAt ? new Date(l.firstKnockAt).toISOString().slice(0, 10) : '',
          l.archivedAt ? new Date(l.archivedAt).toISOString().slice(0, 10) : '',
          l.knocksThisMonth,
          l.restrictedDoorsThisMonth,
          l.billRestrictedDoors ? l.billableDoorsThisMonth : l.knocksThisMonth,
          l.billable ? 'yes' : 'no',
          l.reason || '',
          ((l.rateCents ?? 0) / 100).toFixed(2),
          (l.amountCents / 100).toFixed(2),
        ]);
      }
      rows.push([`${m.month} subtotal`, '', '', '', '', '', '', '', '', '', '', '', (m.totalCents / 100).toFixed(2)]);
      rows.push([]);
    }
    rows.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', (pickedTotalCents / 100).toFixed(2)]);
    saveCsvRows(
      rows,
      `${(displayName || 'org').replaceAll(/\s+/g, '-').toLowerCase()}-statements-${
        months[months.length - 1].month
      }-to-${months[0].month}.csv`
    );
  }

  const orgInfo = billingQ.data?.organization;
  const displayName = orgInfo?.name || orgName;
  // The born-immutable flag (Organization.isInternal), NOT the billing status. When set, the server
  // locks the status to 'internal' (POST /billing/status → 403 INTERNAL_LOCKED for any other target);
  // when unset, it rejects a move TO 'internal' (403 INTERNAL_FLAG_REQUIRED). So the control mirrors
  // both server rules: locked note for a flagged org, and no selectable 'internal' for the rest.
  const isInternal = !!orgInfo?.isInternal;
  const historyRows = historyQ.data?.months || [];
  const pickedRows = historyRows.filter((m) => picked.has(m.month));
  // What the ticked months add up to: the FROZEN figure where a month is issued, the live one where
  // it isn't — the same rule the ledger renders, so the footer can never disagree with the table.
  const pickedTotalCents = pickedRows.reduce((sum, m) => sum + m.totalCents, 0);
  const pickedUnissued = pickedRows.filter((m) => !m.issued).map((m) => m.month);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Billing — {displayName}</h2>
          {sub && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <BillingPill effective={ent?.effective} />
              <span>
                since {fmtDate(sub.statusChangedAt)}
                {sub.status === 'trial' && ` · trial ends ${fmtDate(sub.trialEndsAt)}`}
                {ent?.banner === 'trial_expired' && ' · EXPIRED'}
                {/* A canceled org's wind-down date IS its deletion date (entitlement.js). */}
                {ent?.effective === 'canceled' && ent?.windDownEndsAt && (
                  <span className="font-semibold text-danger"> · deletes {fmtDate(ent.windDownEndsAt)}</span>
                )}
                {/* Whether this status was set by a human or a Stripe webhook. */}
                {' · '}set {sub.source === 'stripe' ? 'by Stripe' : 'manually'}
                {sub.stripeCustomerId && ` · ${sub.stripeCustomerId}`}
              </span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={() => {
              setRenameOpen((v) => !v);
              setNameEdit(orgInfo?.name || orgName || '');
              setSlugEdit(orgInfo?.slug || '');
            }}
            className="text-xs font-semibold text-fg-muted hover:text-fg"
          >
            Rename…
          </button>
          <button onClick={onClose} className="text-xs font-semibold text-fg-muted hover:text-fg">
            Close ✕
          </button>
        </div>
      </div>

      {renameOpen && (
        <div className="mt-3 rounded-lg border border-border bg-surface p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Rename organization</h3>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-fg-muted">Name</label>
              <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted">Slug</label>
              <input value={slugEdit} onChange={(e) => setSlugEdit(e.target.value)} className={inputCls} />
            </div>
          </div>
          {slugEdit.trim().toLowerCase() !== (orgInfo?.slug || '') && (
            <p className="mt-2 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
              The slug is the org&apos;s identity across the platform — the org switcher, provisioning, and the
              demo seed lock all reference it. Change it only if you mean to; anything pointing at the old
              slug stops matching.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => renameMut.mutate({ name: nameEdit.trim(), slug: slugEdit.trim().toLowerCase() })}
              disabled={renameMut.isPending || !nameEdit.trim() || !slugEdit.trim()}
              className={btnCls}
            >
              {renameMut.isPending ? 'Saving…' : 'Save name & slug'}
            </button>
            <button onClick={() => setRenameOpen(false)} className="text-xs font-semibold text-fg-muted hover:text-fg">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</div>
      )}
      {billingQ.isLoading && <p className="mt-3 text-sm text-fg-muted">Loading…</p>}

      {/* Same panel, same information — three tabs instead of one long scroll. Statement opens
          first because closing a month is the job this panel is opened for. */}
      <div className="mt-4">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'statement', label: 'Statement' },
            { value: 'history', label: 'History' },
            { value: 'account', label: 'Account' },
          ]}
        />
      </div>

      {tab === 'account' && sub && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Status + trial */}
          <div className="rounded-lg border border-border bg-surface p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Status</h3>
            {isInternal ? (
              // A born-internal org's status is locked to 'internal' (the flag is immutable and the
              // server enforces regardless); show why instead of a control that can only 403.
              <p className="mt-2 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
                <span className="font-semibold">Locked to Internal.</span> This organization was created
                internal, so its billing status can&apos;t be changed — it stays exempt from both retention
                sweeps and out of every revenue and lifetime number. Only a manual delete can remove it.
              </p>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-fg-muted">Change to</label>
                    <select value={statusTo} onChange={(e) => setStatusTo(e.target.value)} className={inputCls}>
                      <option value="">— keep {BILLING_STATUS_META[sub.status]?.label || sub.status} —</option>
                      {/* 'internal' is set only at creation (break-glass); the server 403s a move to it
                          here, so it's not offered. */}
                      {STATUSES.filter((s) => s !== sub.status && s !== 'internal').map((s) => (
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
              </>
            )}
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
      {tab === 'statement' && (
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
        {/* Reality has moved since this invoice went out. Never reconciled automatically — voiding
            and reissuing is an account-manager judgement, so all this does is refuse to hide it. */}
        {drift && (
          <div
            className={`mb-3 rounded-md border px-3 py-2 text-xs ${
              drift.material
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-border bg-sunken text-fg-muted'
            }`}
          >
            <p className="font-semibold">
              {drift.material
                ? `Issued ${fmtUsd(drift.totalCents.issued)} — a live recompute now says ${fmtUsd(drift.totalCents.live)}.`
                : 'Underlying data changed since this was issued (the total is unaffected).'}
            </p>
            <ul className="mt-1 space-y-0.5">
              {drift.lines.slice(0, 6).map((l) => (
                <li key={l.campaignId}>
                  {l.name}: {Object.keys(l.fields).join(', ')} changed
                </li>
              ))}
              {drift.addedCampaigns.map((c) => (
                <li key={`a-${c.campaignId}`}>{c.name}: campaign added since issue</li>
              ))}
              {drift.removedCampaigns.map((c) => (
                <li key={`r-${c.campaignId}`}>{c.name}: campaign no longer exists</li>
              ))}
              {drift.rulesVersion && (
                <li>
                  Billing rules changed (v{drift.rulesVersion.issued} → v{drift.rulesVersion.live})
                </li>
              )}
            </ul>
            <p className="mt-1">The issued figures below are unchanged — void and reissue if you want to correct them.</p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Monthly statement</h3>
            {issued ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                Issued {fmtDate(issued.issuedAt)}
                {issuedBy ? ` by ${issuedBy}` : ''} · rules v{issued.rulesVersion}
                {issued.externalRef ? ` · ${issued.externalRef}` : ''}
              </span>
            ) : (
              <span className="text-xs text-fg-subtle">Live — not issued</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls + ' mt-0'} />
            {!issued && (
              <>
                <input
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                  placeholder="Invoice #"
                  className={inputCls + ' mt-0 w-28'}
                />
                <button
                  onClick={() => {
                    // `force` is the deliberate override for issuing a month that hasn't closed —
                    // a prepay or an early close-out. Asked for explicitly, never assumed.
                    const force = !monthEnded;
                    if (
                      force &&
                      !window.confirm(`${month} hasn't finished yet. Issue it anyway? Later knocks won't be included.`)
                    ) return;
                    issueMut.mutate({ externalRef: externalRef || undefined, force });
                  }}
                  disabled={!stmt || issueMut.isPending}
                  className={btnCls + ' py-1.5 text-xs'}
                >
                  {issueMut.isPending ? 'Issuing…' : 'Issue statement'}
                </button>
              </>
            )}
            {issued && (
              <button
                onClick={() => {
                  const why = window.prompt(`Void the ${month} statement? Give a reason (required):`);
                  if (why && why.trim()) voidMut.mutate({ statementId: issued._id, reason: why.trim() });
                }}
                disabled={voidMut.isPending}
                className="text-xs font-semibold text-danger hover:opacity-80 disabled:opacity-60"
              >
                {voidMut.isPending ? 'Voiding…' : 'Void'}
              </button>
            )}
            <button onClick={downloadCsv} disabled={!stmt} className="text-xs font-semibold text-brand-accent hover:opacity-80">
              Export CSV
            </button>
          </div>
        </div>
        {statementQ.isLoading && <p className="mt-2 text-sm text-fg-muted">Computing…</p>}
        {view && (
          <table className="mt-2 min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="py-1 pr-3">Campaign</th>
                <th className="py-1 pr-3">Households</th>
                {/* The billing clock, started by the first field visit — a knock OR a
                    restricted home a canvasser walked to (a desk bulk-restrict doesn't count). */}
                <th className="py-1 pr-3">Billing started</th>
                <th className="py-1 pr-3">Knocks ({month})</th>
                <th className="py-1 pr-3">Rate</th>
                <th className="py-1 pr-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.lines.map((l) => (
                <tr key={l.campaignId} className={l.billable ? '' : 'text-fg-subtle'}>
                  <td className="py-1.5 pr-3">
                    {l.name}
                    {!l.isActive && <span className="ml-1 text-xs">(archived {fmtDate(l.archivedAt)})</span>}
                    {/* Why this line is or isn't on the invoice — the grace rules and the floor are
                        invisible without it (services/billing/billingMonths.js). */}
                    {REASON_LABEL[l.reason] && (
                      <span className="ml-1 text-xs text-fg-subtle">— {REASON_LABEL[l.reason]}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">{l.households.toLocaleString()}</td>
                  <td className="py-1.5 pr-3">{l.firstKnockAt ? fmtDate(l.firstKnockAt) : 'Not started'}</td>
                  <td className="py-1.5 pr-3">
                    {l.knocksThisMonth.toLocaleString()}
                    {/* Only worth showing when the org invoices restricted doors — otherwise
                        billableDoorsThisMonth is just a duplicate of the knock count. */}
                    {l.billRestrictedDoors && l.restrictedDoorsThisMonth > 0 && (
                      <span className="ml-1 text-xs text-fg-subtle">
                        (+{l.restrictedDoorsThisMonth.toLocaleString()} restricted ={' '}
                        {l.billableDoorsThisMonth.toLocaleString()} billable doors)
                      </span>
                    )}
                  </td>
                  {/* Per-campaign negotiated rate. Editable only on a LIVE month — an issued
                      statement is frozen, and letting someone retype a number on it would defeat
                      the entire point of issuing. */}
                  <td className="py-1.5 pr-3">
                    {rateEdit?.campaignId === l.campaignId ? (
                      <span className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={rateEdit.dollars}
                          onChange={(e) => setRateEdit({ ...rateEdit, dollars: e.target.value })}
                          placeholder="org rate"
                          className={inputCls + ' mt-0 w-20 px-1.5 py-1 text-xs'}
                        />
                        <button
                          onClick={() => {
                            const raw = rateEdit.dollars.trim();
                            // Empty clears the override back to the org default. 0 is a legal
                            // rate (a comped campaign), so it must survive as 0, not become null.
                            const cents = raw === '' ? null : Math.round(Number(raw) * 100);
                            if (cents !== null && !Number.isFinite(cents)) return;
                            campaignRateMut.mutate({ campaignId: l.campaignId, pricePerCampaignCents: cents });
                          }}
                          className="text-xs font-semibold text-brand-accent"
                        >
                          Save
                        </button>
                        <button onClick={() => setRateEdit(null)} className="text-xs text-fg-subtle">
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() =>
                          !issued &&
                          setRateEdit({
                            campaignId: l.campaignId,
                            dollars: l.pricePerCampaignCents == null ? '' : String(l.pricePerCampaignCents / 100),
                          })
                        }
                        disabled={Boolean(issued)}
                        className={issued ? 'text-xs' : 'text-xs underline decoration-dotted underline-offset-2 hover:text-brand-accent'}
                        title={issued ? 'Frozen — this statement is issued' : 'Set a negotiated rate for this campaign'}
                      >
                        {fmtUsd(l.rateCents)}
                        {l.pricePerCampaignCents == null && (
                          <span className="ml-1 text-fg-subtle">(inherits)</span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{l.billable ? fmtUsd(l.amountCents) : '—'}</td>
                </tr>
              ))}
              <tr className="font-semibold text-fg">
                {/* "n × rate" is only ARITHMETICALLY TRUE when every billing campaign is on the org
                    rate. A campaign carrying a negotiated override (services/billing/rate.js) makes
                    the product wrong, so fall back to a plain count rather than print a false sum. */}
                <td className="py-1.5 pr-3">Total ({billingLines.length}{uniformRate ? ` × ${fmtUsd(view.rateCents)}` : ' campaigns'})</td>
                <td colSpan={4} />
                <td className="py-1.5 pr-3 text-right">{fmtUsd(view.totalCents)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      )}

      {/* The SubscriptionEvent audit trail — who changed what, and why. Lives on Account: it is the
          record of account decisions (status moves, rate edits), not of months. */}
      {tab === 'account' && (billingQ.data?.events?.length > 0 || eventsSkip > 0) && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">History</h3>
          <ul className="mt-2 space-y-1 text-sm text-fg-muted">
            {billingQ.data.events.map((ev) => (
              <li key={ev._id}>
                <span className="text-fg-subtle">{new Date(ev.createdAt).toLocaleDateString()}</span>{' '}
                {ev.fromStatus || ev.toStatus
                  ? `${ev.fromStatus ? `${ev.fromStatus} → ` : ''}${ev.toStatus || ''}`
                  : changeText(ev.changes || {})}
                {ev.byUserId && ` · ${[ev.byUserId.firstName, ev.byUserId.lastName].filter(Boolean).join(' ')}`}
                {ev.reason && ` · “${ev.reason}”`}
              </li>
            ))}
          </ul>
          {(billingQ.data?.eventsTotal || 0) > EVENTS_LIMIT && (
            <Pager
              skip={eventsSkip}
              limit={EVENTS_LIMIT}
              total={billingQ.data.eventsTotal}
              onChange={setEventsSkip}
              className="mt-2"
            />
          )}
        </div>
      )}

      {/* ── History: every month at once, and the multi-month invoice run ───────────────────── */}
      {tab === 'history' && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Month ledger</h3>
              <p className="mt-0.5 text-xs text-fg-muted">
                Issued months read from what was frozen; the rest are a live recompute. Tick the
                months you are invoicing together.
              </p>
            </div>
            <select
              value={historyMonths}
              onChange={(e) => {
                setHistoryMonths(Number(e.target.value));
                setPicked(new Set());
                setBatchResult(null);
              }}
              className={inputCls + ' mt-0 w-auto'}
            >
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
              <option value={24}>Last 24 months</option>
            </select>
          </div>

          {historyQ.isLoading && <p className="text-sm text-fg-muted">Computing…</p>}
          {historyQ.error && (
            <div className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
              {historyQ.error.message}
            </div>
          )}

          {historyRows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="min-w-full text-sm">
                <thead className="text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  <tr>
                    <th className="py-2 pl-3 pr-2">
                      <input
                        type="checkbox"
                        aria-label="Select every month shown"
                        checked={picked.size > 0 && picked.size === historyRows.length}
                        onChange={(e) =>
                          setPicked(e.target.checked ? new Set(historyRows.map((m) => m.month)) : new Set())
                        }
                      />
                    </th>
                    <th className="py-2 pr-3">Month</th>
                    <th className="py-2 pr-3">Campaigns</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historyRows.map((m) => {
                    const on = picked.has(m.month);
                    return (
                      <tr key={m.month} className={on ? 'bg-brand-tint/40' : ''}>
                        <td className="py-1.5 pl-3 pr-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${m.month}`}
                            checked={on}
                            onChange={() =>
                              setPicked((cur) => {
                                const next = new Set(cur);
                                if (next.has(m.month)) next.delete(m.month);
                                else next.add(m.month);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="py-1.5 pr-3">
                          <button
                            onClick={() => {
                              setMonth(m.month);
                              setTab('statement');
                            }}
                            className="font-medium text-fg underline decoration-dotted underline-offset-2 hover:text-brand-accent"
                            title="Open this month on the Statement tab"
                          >
                            {monthLabel(m.month)}
                          </button>
                        </td>
                        <td className="py-1.5 pr-3 text-fg-muted">
                          {m.billableCampaigns || '—'}
                        </td>
                        <td className="py-1.5 pr-3">
                          {m.issued ? (
                            <span className="inline-flex flex-wrap items-center gap-1">
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                                Issued {fmtDate(m.issuedAt)}
                              </span>
                              {m.externalRef && <span className="text-xs text-fg-muted">{m.externalRef}</span>}
                              {/* Reality moved since the invoice went out. Never reconciled
                                  automatically — voiding and reissuing is a judgement call. */}
                              {m.drift?.material && (
                                <span
                                  className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
                                  title={`A live recompute now says ${fmtUsd(m.liveTotalCents)}`}
                                >
                                  drifted
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-fg-subtle">
                              {m.month >= thisMonth ? 'Live — month still open' : 'Not issued'}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right font-medium text-fg">{fmtUsd(m.totalCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* The invoice run. Sticky so the total stays visible while ticking a long ledger. */}
          {picked.size > 0 && (
            <div className="sticky bottom-0 z-10 rounded-lg border border-brand-accent/30 bg-brand-tint px-3 py-2.5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-fg">
                  {picked.size} month{picked.size === 1 ? '' : 's'} selected ·{' '}
                  {fmtUsd(pickedTotalCents)}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={downloadRangeCsv} className="text-xs font-semibold text-brand-accent hover:opacity-80">
                    Export combined CSV
                  </button>
                  {pickedUnissued.length > 0 && (
                    <>
                      <input
                        value={batchRef}
                        onChange={(e) => setBatchRef(e.target.value)}
                        placeholder="Invoice #"
                        className={inputCls + ' mt-0 w-28'}
                      />
                      <button
                        onClick={() => {
                          // `force` is the deliberate override for a month that hasn't closed — a
                          // prepay or an early close-out. Asked for explicitly, never assumed.
                          const open = pickedUnissued.filter((m) => m >= thisMonth);
                          if (
                            open.length &&
                            !window.confirm(
                              `${open.join(', ')} ${open.length === 1 ? "hasn't" : "haven't"} finished yet. Issue anyway? Later knocks won't be included.`
                            )
                          ) return;
                          issueManyMut.mutate({
                            months: pickedUnissued,
                            externalRef: batchRef || undefined,
                            force: open.length > 0,
                          });
                        }}
                        disabled={issueManyMut.isPending}
                        className={btnCls + ' py-1.5 text-xs'}
                      >
                        {issueManyMut.isPending
                          ? 'Issuing…'
                          : `Issue ${pickedUnissued.length} month${pickedUnissued.length === 1 ? '' : 's'}`}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setPicked(new Set());
                      setBatchResult(null);
                    }}
                    className="text-xs font-semibold text-fg-muted hover:text-fg"
                  >
                    Clear
                  </button>
                </div>
              </div>
              {/* A batch can partly succeed — already-issued months are skipped, not fatal — so the
                  outcome is reported per month rather than as one verdict. */}
              {batchResult && (
                <ul className="mt-2 space-y-0.5 border-t border-brand-accent/20 pt-2 text-xs">
                  {batchResult.results.map((r) => (
                    <li key={r.month} className={r.ok ? 'text-fg' : 'text-danger'}>
                      {r.month}: {r.ok ? `issued · ${fmtUsd(r.totalCents)}` : r.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* The paper trail — including the VOIDED rows, which the ledger above can't show because
              it only knows what currently stands for each month. */}
          {paperQ.data?.statements?.length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Every statement</h3>
              <ul className="mt-2 space-y-1 text-sm text-fg-muted">
                {paperQ.data.statements.map((st) => (
                  <li key={st._id}>
                    <span className="font-medium text-fg">{st.month}</span> · {fmtUsd(st.totalCents)} ·{' '}
                    {st.status === 'void' ? (
                      <span className="text-danger">
                        voided {fmtDate(st.voidedAt)}
                        {st.voidedByUserId &&
                          ` by ${[st.voidedByUserId.firstName, st.voidedByUserId.lastName].filter(Boolean).join(' ')}`}
                        {st.voidReason ? ` — “${st.voidReason}”` : ''}
                        {st.supersededByStatementId ? ' · replaced' : ''}
                      </span>
                    ) : (
                      <>
                        issued {fmtDate(st.issuedAt)}
                        {st.issuedByUserId &&
                          ` by ${[st.issuedByUserId.firstName, st.issuedByUserId.lastName].filter(Boolean).join(' ')}`}
                        {st.externalRef ? ` · ${st.externalRef}` : ''}
                      </>
                    )}{' '}
                    <span className="text-fg-subtle">· rules v{st.rulesVersion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
