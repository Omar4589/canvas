// WHAT IS OWED, WHAT WAS SENT, WHAT WAS PAID — the whole of it, as pure functions.
//
// Same split as billingMonths.js (the rule) vs statement.js (the queries): this module decides,
// services/billing/invoicing.js fetches. Nothing here touches the database, and nothing here reads
// a clock — `now` and `currentMonth` are ARGUMENTS. That is what makes the truth table below
// testable at every boundary without a fixture that goes stale on the 1st of the month.
//
// THE VOCABULARY, and why each word means exactly one thing:
//
//   A STATEMENT (an issued invoice) is in exactly one PAYMENT STATE:
//     settled      totalCents === 0 — a $0 month someone froze for the record. Nothing to collect,
//                  so it is never chased and can never be marked paid (the route refuses it).
//     paid         paidAt is set. Beats overdue: a late payment that arrived is not still late.
//     overdue      unpaid and dueAt has passed (STRICT — due exactly now is not yet late).
//     outstanding  unpaid, not yet due.
//
//   A MONTH is in exactly one INVOICING STATE:
//     internal     Doorline's own org. Never billed, never on a revenue surface.
//     open         the running month. It is still accumulating knocks, so it is never "awaiting" —
//                  you cannot invoice a month that has not finished (issueStatement.js's
//                  MONTH_NOT_ENDED gate, the same UTC clock, so the two can never disagree).
//     awaiting     closed, more than $0, and NO issued statement. THIS is "needs invoicing".
//     zero         closed, no issued statement, and nothing to bill. A trial org three months into
//                  setup has three of these and owes nothing — counting them as "awaiting" was the
//                  single easiest way to make this whole feature lie.
//     issued/overdue/paid/settled  the frozen statement's payment state, projected onto the month.
//
// Both partitions are EXHAUSTIVE and EXCLUSIVE, and the test suite asserts it. That is the property
// the desk depends on: every org's months sum, with no month counted twice and none dropped.
//
// A deliberate NON-feature: partial payments. A statement is paid or it is not. Doorline does not
// collect money (docs/BILLING.md), so a half-paid invoice is a conversation, not a data structure.

import { statementDrift } from './statementDrift.js';

// Net-N. Thirty days unless the org negotiated otherwise (Subscription.paymentTermsDays).
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

const DAY_MS = 86400000;

// How far back an invoicing walk reaches. Deliberately SEPARATE from BILLING_HISTORY_MAX_MONTHS
// (24, statement.js): that cap is about the payload size of an explicitly-requested history range,
// this one bounds the canonical "everything this org has ever owed" walk. Three years is past any
// campaign's life; an org younger than that is bounded by its own age, not by this number.
export const INVOICING_LOOKBACK_MAX_MONTHS = 36;

// Every value classifyMonth can return, in the order they appear on a ledger read newest-first.
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

// Every value paymentStateOf can return for an issued statement.
export const PAYMENT_STATES = ['settled', 'paid', 'overdue', 'outstanding'];

// The org's net-N. Explicit null checks rather than `||` for the same reason rate.js uses them:
// 0 is a legal value ("due on issue") and `||` would silently promote it back to 30.
export const termsDaysFor = (sub) => {
  const n = sub?.paymentTermsDays;
  if (n !== null && n !== undefined) return n;
  return DEFAULT_PAYMENT_TERMS_DAYS;
};

// When an invoice issued at `issuedAt` on net-`termsDays` falls due.
export const dueAtFor = (issuedAt, termsDays) => {
  if (!issuedAt) return null;
  const t = new Date(issuedAt).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + termsDays * DAY_MS);
};

// The due date to READ for a statement.
//
// `dueAt` is stamped at issue time and frozen there, so renegotiating terms never moves an invoice
// already sent. Statements issued BEFORE this feature existed have none — for those we fall back to
// the same arithmetic over the org's current terms, which is exactly what migrations/
// backfillStatementDueDates.js persists. The read path and the migration therefore agree by
// construction rather than by luck, and the code is correct before the migration runs.
export const effectiveDueAt = (statement, termsDays) => {
  if (!statement) return null;
  if (statement.dueAt) return new Date(statement.dueAt);
  return dueAtFor(statement.issuedAt, termsDays);
};

// Whole days a statement is past due, 0 when it is not.
export const daysOverdue = (statement, { now, termsDays }) => {
  const due = effectiveDueAt(statement, termsDays);
  if (!due) return 0;
  const ms = now.getTime() - due.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
};

// settled | paid | overdue | outstanding, or null for a row that is not a live invoice at all.
// Void rows never decide anything — they are history, visible only in the paper trail.
export const paymentStateOf = (statement, { now, termsDays }) => {
  if (!statement || statement.status !== 'issued') return null;
  if (!statement.totalCents) return 'settled';
  if (statement.paidAt) return 'paid';
  const due = effectiveDueAt(statement, termsDays);
  // Strict: a statement due at this instant is not yet late.
  if (due && due.getTime() < now.getTime()) return 'overdue';
  return 'outstanding';
};

// One month's state. `frozen` is that month's issued Statement (or null), `liveTotalCents` what a
// fresh recompute says it comes to.
//
// A FORCE-ISSUED current month is still 'open' here — the running card must keep showing the live
// meter for a month that is still accumulating — while its frozen row independently counts toward
// outstanding, because it has a real due date and someone has to pay it.
export const classifyMonth = ({
  month,
  currentMonth,
  frozen,
  liveTotalCents,
  internal,
  now,
  termsDays,
}) => {
  if (internal) return 'internal';
  if (month >= currentMonth) return 'open';
  if (frozen) {
    // 'outstanding' is the statement's word for "sent, not yet due"; the month calls that
    // 'issued', because on a ledger the interesting thing about the month is that it is closed
    // and invoiced. Every other payment state passes through under its own name.
    const ps = paymentStateOf(frozen, { now, termsDays });
    return ps === 'outstanding' ? 'issued' : ps;
  }
  return liveTotalCents > 0 ? 'awaiting' : 'zero';
};

// The month's amount as an INVOICE reads it: the frozen figure where one exists, the live one
// otherwise. What is owed is what was sent — a later recompute showing a different number is drift,
// reported beside it, never silently substituted.
const amountOf = (frozen, liveTotalCents) => (frozen ? frozen.totalCents : liveTotalCents);

// ---- the per-org rollup ------------------------------------------------------

// `months`   the statements from monthlyStatementRange (oldest first), each { month, lines, totalCents }
// `campaigns` the range's per-campaign facts (firstKnockAt, billingStartMonth, …)
// `issuedStatements` EVERY status:'issued' Statement for the org — NOT window-bound, so an unpaid
//            invoice older than the scan window still shows up in outstanding.
//
// Returns the block the desk row, the org page and the month-close board all read, so the same
// month can never read 'awaiting' on one screen and 'issued' on another.
export const deriveInvoicing = ({
  months = [],
  campaigns = [],
  issuedStatements = [],
  currentMonth,
  now,
  termsDays = DEFAULT_PAYMENT_TERMS_DAYS,
  internal = false,
  windowFrom = null,
  windowTruncated = false,
}) => {
  const issuedByMonth = new Map();
  for (const s of issuedStatements) {
    if (s.status === 'issued') issuedByMonth.set(s.month, s);
  }

  const monthStates = [];
  const awaitingMonths = [];
  let billingSince = null;

  for (const stmt of months) {
    const frozen = issuedByMonth.get(stmt.month) || null;
    const state = classifyMonth({
      month: stmt.month,
      currentMonth,
      frozen,
      liveTotalCents: stmt.totalCents,
      internal,
      now,
      termsDays,
    });
    // The org's "billing since" is the OLDEST month that actually carried a billable line. In the
    // floor corner (first visit Oct 29, archived Nov 2, nobody out in November) October bills while
    // billingStartMonth() says November — so reading the campaign's start month here would name a
    // month AFTER one that carried money. The campaign's own "Bills from" still shows November;
    // both facts are true and both are shown.
    //
    // Falls back to the LIVE lines when the frozen row was fetched without them. The desk's cheap
    // path projects `lines` away, and reading `frozen.lines` there would be undefined — which
    // would silently skip every invoiced month and name the first UNINVOICED one, i.e. exactly the
    // wrong answer for a customer who is fully up to date.
    const billLines = frozen?.lines || stmt.lines;
    const anyBillable = billLines?.some((l) => l.billable);
    if (anyBillable && !billingSince) billingSince = stmt.month;
    if (state === 'awaiting') {
      awaitingMonths.push({
        month: stmt.month,
        totalCents: stmt.totalCents,
        billableCampaigns: stmt.lines.filter((l) => l.billable).length,
      });
    }
    monthStates.push({ month: stmt.month, state, frozen, live: stmt });
  }

  // An ISSUED statement is itself proof that its month billed, and statements are read org-wide
  // rather than window-bound. So the earliest one is a lower bound on "billing since" that holds
  // however narrow the recompute window was — which is what lets the desk scan only the backlog
  // and still name the right month for a customer invoiced since last year.
  for (const s of issuedStatements) {
    if (s.status !== 'issued') continue;
    const billed = s.lines ? s.lines.some((l) => l.billable) : s.totalCents > 0;
    if (billed && (!billingSince || s.month < billingSince)) billingSince = s.month;
  }

  // Payment aggregates walk the statements themselves, not the window, so an old unpaid invoice is
  // never quietly dropped because the scan started after it.
  const outstanding = { count: 0, totalCents: 0, oldestDueAt: null, nextDueAt: null };
  const overdue = { count: 0, totalCents: 0, oldestDueAt: null, maxDaysOverdue: 0 };
  const paid = { count: 0, totalCents: 0, lastPaidAt: null, last12Cents: 0 };
  const twelveMonthsAgo = new Date(now.getTime() - 365 * DAY_MS);

  for (const s of issuedStatements) {
    const ps = paymentStateOf(s, { now, termsDays });
    if (ps === 'paid') {
      paid.count += 1;
      paid.totalCents += s.totalCents;
      const at = new Date(s.paidAt);
      if (!paid.lastPaidAt || at > paid.lastPaidAt) paid.lastPaidAt = at;
      if (at >= twelveMonthsAgo) paid.last12Cents += s.totalCents;
      continue;
    }
    if (ps !== 'outstanding' && ps !== 'overdue') continue; // settled / void — nothing owed
    const due = effectiveDueAt(s, termsDays);
    outstanding.count += 1;
    outstanding.totalCents += s.totalCents;
    if (due && (!outstanding.oldestDueAt || due < outstanding.oldestDueAt)) {
      outstanding.oldestDueAt = due;
    }
    if (due && due > now && (!outstanding.nextDueAt || due < outstanding.nextDueAt)) {
      outstanding.nextDueAt = due;
    }
    if (ps === 'overdue') {
      overdue.count += 1;
      overdue.totalCents += s.totalCents;
      if (due && (!overdue.oldestDueAt || due < overdue.oldestDueAt)) overdue.oldestDueAt = due;
      overdue.maxDaysOverdue = Math.max(overdue.maxDaysOverdue, daysOverdue(s, { now, termsDays }));
    }
  }

  // The running month, from the window's last entry (monthsBetween truncates from the front, so the
  // current month always survives).
  const openRow = monthStates.find((m) => m.month === currentMonth);
  const openLive = openRow?.live;
  const running = {
    month: currentMonth,
    totalCents: amountOf(openRow?.frozen, openLive?.totalCents || 0),
    liveTotalCents: openLive?.totalCents || 0,
    billableCampaigns: openLive ? openLive.lines.filter((l) => l.billable).length : 0,
    setupCount: openLive
      ? openLive.lines.filter((l) => l.reason === 'no-field-visit' && l.isActive).length
      : 0,
    graceCount: openLive ? openLive.lines.filter((l) => l.reason === 'start-grace').length : 0,
    // Prepay or an early close-out: the month is frozen although it has not finished.
    issuedEarly: openRow?.frozen
      ? { statementId: String(openRow.frozen._id), issuedAt: openRow.frozen.issuedAt }
      : null,
  };

  // Drift is REPORTED, never reconciled: an issued statement whose live recompute has moved is the
  // one case where the money surfaces must show two numbers and let a human decide.
  const drifting = [];
  for (const m of monthStates) {
    if (!m.frozen) continue;
    const d = statementDrift(m.frozen, m.live);
    if (d?.material) {
      drifting.push({
        month: m.month,
        issuedTotalCents: m.frozen.totalCents,
        liveTotalCents: m.live.totalCents,
      });
    }
  }

  const firstVisitAt = campaigns.reduce((earliest, c) => {
    if (!c.firstKnockAt) return earliest;
    const at = new Date(c.firstKnockAt);
    return !earliest || at < earliest ? at : earliest;
  }, null);

  const invoicing = {
    internal,
    // WHEN these figures were computed. It rides the block itself rather than only the response
    // envelope, because the block is what gets passed around — a desk row gets it from the rollup
    // and the org page from the history payload, and both render "23d overdue" from it. Without it
    // they would quietly fall back to the browser clock, which is the exact substitution this
    // feature removed everywhere else.
    asOf: now,
    billingSince,
    firstVisitAt,
    running,
    awaiting: {
      months: awaitingMonths,
      totalCents: awaitingMonths.reduce((n, m) => n + m.totalCents, 0),
    },
    outstanding,
    overdue,
    paid,
    drifting,
    window: { from: windowFrom, to: currentMonth, truncated: windowTruncated },
    monthStates: monthStates.map((m) => ({ month: m.month, state: m.state })),
  };
  return invoicing;
};

// ---- what to do about it -----------------------------------------------------

// The desk sorts by this, and the org page's "Next up" card lists every item in this order. Lower
// rank = more urgent. A trial that is about to lapse outranks chasing money, because an expired
// trial stops the customer working while an unpaid invoice does not.
export const NEXT_ACTION_RANK = {
  chase: 0,
  rescue_trial: 1,
  issue: 2,
  wind_down: 3,
  await_payment: 4,
  none: 5,
};

export const nextActionFor = ({ invoicing, entitlement, sub }) => {
  if (invoicing?.internal) return 'none';
  const trialExpired = entitlement?.banner === 'trial_expired';
  const trialEnding =
    sub?.status === 'trial' &&
    typeof entitlement?.trialDaysLeft === 'number' &&
    entitlement.trialDaysLeft <= 3;
  if (invoicing?.overdue?.count > 0) return 'chase';
  if (trialExpired || trialEnding) return 'rescue_trial';
  if (invoicing?.awaiting?.months?.length > 0) return 'issue';
  // The deletion date lives on the ENTITLEMENT, not the subscription — `windDownEndsAt` is
  // computed by entitlementFor from statusChangedAt and is not a schema path. Reading it off `sub`
  // made this branch unreachable, so the one account whose data is about to be permanently deleted
  // ranked below every idle trial.
  if (sub?.status === 'canceled' && entitlement?.windDownEndsAt) return 'wind_down';
  if (invoicing?.outstanding?.count > 0) return 'await_payment';
  return 'none';
};

// ---- the cheap path ----------------------------------------------------------

// The org LIST cannot afford a range walk per org, but the chase signal is the one an account
// manager needs first — and it comes from Statement rows alone, with no recompute. This folds a
// flat find() into a per-org summary so the desk paints overdue before the expensive rollup lands,
// and still shows it if the rollup fails outright.
//
// `termsByOrg` is a Map(orgId → termsDays); a missing entry falls back to the default.
export const foldIssuedRows = (rows, { now, termsByOrg = new Map() }) => {
  const byOrg = new Map();
  for (const s of rows) {
    if (s.status !== 'issued') continue;
    const orgId = String(s.organizationId);
    const termsDays = termsByOrg.get(orgId) ?? DEFAULT_PAYMENT_TERMS_DAYS;
    const ps = paymentStateOf(s, { now, termsDays });
    if (!byOrg.has(orgId)) {
      byOrg.set(orgId, {
        outstandingCount: 0,
        outstandingCents: 0,
        overdueCount: 0,
        overdueCents: 0,
        maxDaysOverdue: 0,
        oldestDueAt: null,
        lastPaidAt: null,
      });
    }
    const agg = byOrg.get(orgId);
    if (ps === 'paid') {
      const at = new Date(s.paidAt);
      if (!agg.lastPaidAt || at > agg.lastPaidAt) agg.lastPaidAt = at;
      continue;
    }
    if (ps !== 'outstanding' && ps !== 'overdue') continue;
    const due = effectiveDueAt(s, termsDays);
    agg.outstandingCount += 1;
    agg.outstandingCents += s.totalCents;
    if (due && (!agg.oldestDueAt || due < agg.oldestDueAt)) agg.oldestDueAt = due;
    if (ps === 'overdue') {
      agg.overdueCount += 1;
      agg.overdueCents += s.totalCents;
      agg.maxDaysOverdue = Math.max(agg.maxDaysOverdue, daysOverdue(s, { now, termsDays }));
    }
  }
  return byOrg;
};
