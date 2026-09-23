import { monthLabel, shortMonthLabel } from './months.js';
import { fmtUsd } from './money.js';
import { formatDate } from './dates.js';

// The CLIENT half of the invoicing vocabulary. The server decides every state
// (services/billing/invoicingState.js); this file only knows how to SAY them, and folds the month
// rows into the per-campaign view.
//
// Nothing here computes money beyond summing cents the server sent. That is the rule that keeps
// three surfaces agreeing: if a figure is ever wrong, it is wrong in exactly one place.

// Every state classifyMonth can return, and how each reads. Kept in the same order as the server's
// INVOICING_STATES so the test asserting set-equality has something to compare against — a state
// the client cannot render is a blank cell, and a state the server never sends is dead vocabulary.
export const INVOICING_STATES = [
  'internal',
  'open',
  'awaiting',
  'zero',
  'issued',
  'overdue',
  'paid',
  'settled',
];

export const INVOICING_STATE_META = {
  internal: { variant: 'neutral', label: () => 'Internal' },
  open: { variant: 'info', dot: true, label: (row) => (row?.closesOn ? `Open · closes ${formatDate(row.closesOn)}` : 'Open') },
  awaiting: { variant: 'warning', label: () => 'Needs invoice' },
  zero: { variant: 'neutral', label: () => 'Nothing to bill' },
  issued: { variant: 'info', label: (row) => (row?.dueAt ? `Issued · due ${formatDate(row.dueAt)}` : 'Issued') },
  overdue: { variant: 'danger', label: (row) => `${daysOverdue(row?.dueAt, row?.asOf)}d overdue` },
  paid: { variant: 'success', label: (row) => (row?.paidAt ? `Paid ${formatDate(row.paidAt)}` : 'Paid') },
  settled: { variant: 'neutral', label: () => 'Settled ($0)' },
};

export const stateMeta = (state, row) => {
  const meta = INVOICING_STATE_META[state];
  if (!meta) return { variant: 'neutral', label: state || '—', dot: false };
  return { variant: meta.variant, dot: Boolean(meta.dot), label: meta.label(row) };
};

const DAY_MS = 86400000;

// Whole days past due. `asOf` is the server's stamp on the response, never the browser clock, so a
// row cannot creep from "due today" to "1d overdue" while a tab sits open.
export const daysOverdue = (dueAt, asOf) => {
  if (!dueAt) return 0;
  const now = asOf ? new Date(asOf).getTime() : Date.now();
  const ms = now - new Date(dueAt).getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
};

export const dueLabel = (dueAt, asOf) => {
  if (!dueAt) return '—';
  const n = daysOverdue(dueAt, asOf);
  return n > 0 ? `${n}d overdue` : `Due ${formatDate(dueAt)}`;
};

// Why a campaign is, or is not, on this month's invoice. Moved out of OrgBillingPanel so the desk,
// the org page and the CSV all name a reason identically.
export const REASON_LABEL = {
  billable: 'Billing',
  'no-field-visit': 'Not started — free until the first knock',
  'start-grace': 'Free — first knock in the last week of the month',
  'end-grace': 'Free — archived in the first days, nobody out',
  floor: 'Bills once — a campaign that knocked always bills a month',
  'before-start': 'Before billing started',
  'archived-earlier': 'Archived before this month',
};

export const reasonLabel = (reason) => REASON_LABEL[reason] || reason || '—';

// ---- what to do next ---------------------------------------------------------

// The org page's "Next up" card: EVERY open item, in the order they should be dealt with, not just
// the single highest-ranked one the desk sorts by. An account manager opening an org wants the
// whole list, because they are about to work through it.
export const nextActions = (invoicing, entitlement, { orgId } = {}) => {
  if (!invoicing || invoicing.internal) return [];
  const items = [];
  const path = (tab, extra = '') => `/organizations/${orgId}?tab=${tab}${extra}`;

  for (const s of invoicing.overdue?.statements || []) {
    items.push({
      kind: 'overdue',
      label: `${monthLabel(s.month)} is ${daysOverdue(s.dueAt, invoicing.asOf)} days overdue — ${fmtUsd(s.totalCents)}`,
      href: path('statements', `&month=${s.month}`),
    });
  }
  // The aggregate, when per-statement detail was not sent (the desk's cheap path).
  if (!invoicing.overdue?.statements && invoicing.overdue?.count > 0) {
    items.push({
      kind: 'overdue',
      label: `${invoicing.overdue.count} overdue invoice${invoicing.overdue.count === 1 ? '' : 's'} — ${fmtUsd(invoicing.overdue.totalCents)}`,
      href: path('statements'),
    });
  }
  const trialExpired = entitlement?.banner === 'trial_expired';
  const trialEnding = typeof entitlement?.trialDaysLeft === 'number' && entitlement.trialDaysLeft <= 3;
  if (trialExpired) {
    items.push({ kind: 'trial', label: 'The trial has expired — this account is read-only', href: path('account') });
  } else if (trialEnding) {
    items.push({
      kind: 'trial',
      label: `The trial ends in ${entitlement.trialDaysLeft} day${entitlement.trialDaysLeft === 1 ? '' : 's'}`,
      href: path('account'),
    });
  }
  for (const m of invoicing.awaiting?.months || []) {
    items.push({
      kind: 'awaiting',
      label: `Issue ${monthLabel(m.month)} — ${fmtUsd(m.totalCents)}`,
      href: path('statements', `&month=${m.month}`),
    });
  }
  for (const d of invoicing.drifting || []) {
    items.push({
      kind: 'drift',
      label: `${monthLabel(d.month)} drifted — invoiced ${fmtUsd(d.issuedTotalCents)}, now reads ${fmtUsd(d.liveTotalCents)}`,
      href: path('statements', `&month=${d.month}`),
    });
  }
  if (invoicing.windDownEndsAt) {
    items.push({ kind: 'wind_down', label: `Canceled — data deletes ${formatDate(invoicing.windDownEndsAt)}`, href: path('account') });
  }
  return items;
};

// What the desk's Next action column says, and where it points.
export const NEXT_ACTION_RANK = {
  chase: 0,
  rescue_trial: 1,
  issue: 2,
  wind_down: 3,
  await_payment: 4,
  none: 5,
};

export const nextActionLabel = (row) => {
  const inv = row?.invoicing;
  switch (row?.nextAction) {
    case 'chase':
      return { label: `Chase ${fmtUsd(inv?.overdue?.totalCents)}`, tab: 'statements', tone: 'danger' };
    case 'rescue_trial':
      return { label: 'Extend trial', tab: 'account', tone: 'warning' };
    case 'issue': {
      const n = inv?.awaiting?.months?.length || 0;
      return { label: `Issue ${n} month${n === 1 ? '' : 's'}`, tab: 'statements', tone: 'warning' };
    }
    case 'wind_down':
      return { label: 'Winding down', tab: 'account', tone: 'muted' };
    case 'await_payment':
      return { label: 'Awaiting payment', tab: 'statements', tone: 'muted' };
    default:
      return { label: '—', tab: 'overview', tone: 'muted' };
  }
};

// ---- the ledger --------------------------------------------------------------

// The Statements tab's filter. 'Outstanding' means MONEY OUT — issued and overdue, never paid and
// never a $0 settled row, which is the same partition the server's aggregates use.
export const LEDGER_FILTERS = {
  all: () => true,
  awaiting: (m) => m.state === 'awaiting',
  outstanding: (m) => m.state === 'issued' || m.state === 'overdue',
  paid: (m) => m.state === 'paid',
  issued: (m) => Boolean(m.issued),
};

export const ledgerFilter = (months, filter) => (months || []).filter(LEDGER_FILTERS[filter] || LEDGER_FILTERS.all);

// What a set of ticked months adds up to, and which of them need anything special to issue.
export const pickedSummary = (months, picked, currentMonth) => {
  const rows = (months || []).filter((m) => picked.has(m.month));
  return {
    count: rows.length,
    totalCents: rows.reduce((n, m) => n + (m.totalCents || 0), 0),
    // Only un-issued months can be issued; an already-issued one is skipped by the server, and
    // offering it is how a batch reports failures nobody caused.
    unissuedMonths: rows.filter((m) => !m.issued).map((m) => m.month),
    // A month that has not finished needs `force` — the modal says so rather than the old
    // window.confirm, which described none of this.
    openMonths: rows.filter((m) => !m.issued && m.month >= currentMonth).map((m) => m.month),
  };
};

// ---- the campaign pivot ------------------------------------------------------

// Months are the unit an invoice is made of, but "which campaigns need another invoice" is a
// CAMPAIGN question. This folds the month rows sideways: for each campaign, which months it billed
// and what state each of those months is in.
export const campaignInvoicing = (months) => {
  const byCampaign = new Map();
  // Oldest first, so each campaign's month strip reads left to right in time.
  const ordered = [...(months || [])].reverse();
  for (const m of ordered) {
    for (const line of m.lines || []) {
      const id = String(line.campaignId);
      if (!byCampaign.has(id)) {
        byCampaign.set(id, {
          campaignId: id,
          byMonth: [],
          monthsBilled: 0,
          billedToDateCents: 0,
          awaitingMonths: 0,
          overdueMonths: 0,
          issuedMonths: 0,
          paidMonths: 0,
          thisMonth: null,
        });
      }
      const agg = byCampaign.get(id);
      agg.byMonth.push({ month: m.month, state: m.state, billable: line.billable, reason: line.reason, amountCents: line.amountCents });
      if (!line.billable) continue;
      agg.monthsBilled += 1;
      agg.billedToDateCents += line.amountCents || 0;
      if (m.state === 'awaiting') agg.awaitingMonths += 1;
      else if (m.state === 'overdue') agg.overdueMonths += 1;
      else if (m.state === 'paid') agg.paidMonths += 1;
      else if (m.state === 'issued' || m.state === 'settled') agg.issuedMonths += 1;
    }
  }
  return byCampaign;
};

// The Campaigns tab's rows: the range's per-campaign facts, joined with the fold above and with
// whatever the detail composite knows (last activity).
export const campaignRows = ({ campaigns = [], months = [], detailCampaigns = [], currentMonth } = {}) => {
  const fold = campaignInvoicing(months);
  const detailById = new Map((detailCampaigns || []).map((c) => [String(c.id), c]));
  const runningRow = (months || []).find((m) => m.month === currentMonth);
  const runningLines = new Map((runningRow?.lines || []).map((l) => [String(l.campaignId), l]));

  return campaigns.map((c) => {
    const id = String(c.campaignId);
    const agg = fold.get(id) || {
      byMonth: [], monthsBilled: 0, billedToDateCents: 0,
      awaitingMonths: 0, overdueMonths: 0, issuedMonths: 0, paidMonths: 0,
    };
    const detail = detailById.get(id);
    const thisMonth = runningLines.get(id) || null;
    return {
      ...c,
      campaignId: id,
      lastActivityAt: detail?.lastActivityAt ?? null,
      households: c.households ?? detail?.households ?? null,
      byMonth: agg.byMonth,
      monthsBilled: agg.monthsBilled,
      billedToDateCents: agg.billedToDateCents,
      awaitingMonths: agg.awaitingMonths,
      overdueMonths: agg.overdueMonths,
      issuedMonths: agg.issuedMonths,
      paidMonths: agg.paidMonths,
      thisMonth: thisMonth
        ? { billable: thisMonth.billable, reason: thisMonth.reason, amountCents: thisMonth.amountCents, rateCents: thisMonth.rateCents }
        : null,
      // A campaign that has never been to the field is "not started"; the grace rule can still put
      // its first BILLED month one later than its first visit, which the row shows separately.
      started: Boolean(c.firstKnockAt),
    };
  });
};

// Needs-attention first: money owed, then money out, then active, then name.
export const campaignNeedsAttention = (a, b) => {
  if (b.overdueMonths !== a.overdueMonths) return b.overdueMonths - a.overdueMonths;
  if (b.awaitingMonths !== a.awaitingMonths) return b.awaitingMonths - a.awaitingMonths;
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return String(a.name || '').localeCompare(String(b.name || ''));
};

export const CAMPAIGN_FILTERS = {
  active: (r) => r.isActive,
  archived: (r) => !r.isActive,
  notStarted: (r) => !r.started,
  all: () => true,
};

export { monthLabel, shortMonthLabel };
