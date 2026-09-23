import { Statement } from '../../models/Statement.js';
import { Subscription } from '../../models/Subscription.js';
import { addMonths, monthOf } from './billingMonths.js';
import { statementDrift } from './statementDrift.js';
import { currentMonth, monthlyStatementRange } from './statement.js';
import {
  INVOICING_LOOKBACK_MAX_MONTHS,
  classifyMonth,
  deriveInvoicing,
  effectiveDueAt,
  paymentStateOf,
  termsDaysFor,
} from './invoicingState.js';

// ONE PLACE decides what an organization owes. invoicingState.js holds the rules; this module
// fetches the facts and is the only caller that picks the window.
//
// Why that matters more than it looks: before this, "what does this org owe" was answered three
// times over — the rollup ran a one-month usage walk, the history route ran its own range, and the
// month-close board read Statement rows directly. Three answers to one question is how a desk ends
// up saying "needs invoicing" on a month the org page calls issued. Every surface now reads the
// block this module returns.

export { INVOICING_LOOKBACK_MAX_MONTHS };

// How far back to scan for an org. Activity cannot predate the organization, so its creation month
// is an EXACT floor — for any org younger than the cap the window is complete, not a sample, and
// the cost is bounded by the org's age rather than by the constant. Older orgs truncate and say so
// (`truncated`), because a silently narrowed window is a wrong number wearing a right one's clothes.
//
// Issued statements are deliberately NOT window-bound (see orgInvoicing): an unpaid invoice from
// four years ago still has to be chased.
export const canonicalWindow = (org, now = new Date()) => {
  const to = currentMonth(now);
  const floor = addMonths(to, -(INVOICING_LOOKBACK_MAX_MONTHS - 1));
  const born = org?.createdAt ? monthOf(new Date(org.createdAt).toISOString().slice(0, 10)) : floor;
  const from = born > floor ? born : floor;
  return { from, to, truncated: born < floor };
};

// Is this organization one of Doorline's own? Both signals, for the same reason
// issueStatementForMonth checks both: the org flag and the subscription status are written by
// different paths, and an org whose two drifted apart must not slip onto a revenue surface.
const isInternalOrg = (org, sub) => Boolean(org?.isInternal || sub?.status === 'internal');

// The month rows a ledger renders — the projection GET /history used to build inline, lifted here
// so the route, the org page and the rollup cannot render the same month differently.
//
// `includeLines` is off for the desk (which needs totals, not 1,200 campaign lines per org) and on
// for the org page, whose expandable rows read the lines already in the payload rather than
// re-fetching a month at a time.
export const historyRows = (range, issuedByMonth, { now, termsDays, internal = false, includeLines = true }) => {
  const cm = currentMonth(now);
  return range.statements
    .map((live) => {
      const frozen = issuedByMonth.get(live.month) || null;
      // A LEDGER row is about the invoice, not the meter. classifyMonth keeps a force-issued
      // current month 'open' because the running card must go on showing a live total for a month
      // still accumulating — but on this table that would render a sent, and possibly paid,
      // invoice as "Open" and drop it out of the Paid and Outstanding filters entirely. Where a
      // frozen statement exists, its payment state is what the row is.
      const state = frozen
        ? (() => {
            const ps = paymentStateOf(frozen, { now, termsDays });
            return internal ? 'internal' : ps === 'outstanding' ? 'issued' : ps;
          })()
        : classifyMonth({
            month: live.month,
            currentMonth: cm,
            frozen,
            liveTotalCents: live.totalCents,
            internal,
            now,
            termsDays,
          });
      const due = frozen ? effectiveDueAt(frozen, termsDays) : null;
      const row = {
        month: live.month,
        // What this month IS on an invoice: the frozen total when issued, else the live one.
        totalCents: frozen ? frozen.totalCents : live.totalCents,
        liveTotalCents: live.totalCents,
        billableCampaigns: (frozen || live).lines.filter((l) => l.billable).length,
        issued: Boolean(frozen),
        statementId: frozen ? String(frozen._id) : null,
        issuedAt: frozen?.issuedAt ?? null,
        issuedBy: frozen?.issuedByUserId
          ? `${frozen.issuedByUserId.firstName || ''} ${frozen.issuedByUserId.lastName || ''}`.trim()
          : null,
        externalRef: frozen?.externalRef || null,
        rulesVersion: frozen?.rulesVersion ?? live.rulesVersion,
        drift: statementDrift(frozen, live),
        // The invoicing vocabulary, resolved server-side so three clients cannot disagree about
        // what a month is called.
        state,
        dueAt: due,
        termsDays: frozen?.termsDays ?? (frozen ? termsDays : null),
        paidAt: frozen?.paidAt ?? null,
        paidBy: frozen?.paidByUserId
          ? `${frozen.paidByUserId.firstName || ''} ${frozen.paidByUserId.lastName || ''}`.trim()
          : null,
        paymentRef: frozen?.paymentRef || null,
        paymentState: frozen ? paymentStateOf(frozen, { now, termsDays }) : null,
        overdue: state === 'overdue',
      };
      if (includeLines) {
        // The lines that were (or would be) invoiced, so a combined export never has to go back
        // for them month by month.
        row.lines = (frozen || live).lines;
      }
      return row;
    })
    .reverse();
};

// THE SCAN WINDOW, narrowed by what is already invoiced.
//
// The canonical window is "everything this org has ever been". Walking all of it is right for the
// org page's ledger, which renders every month — and ruinous for the desk, which fires on every
// page load: the knocks aggregation reads every activity row in the window PER CAMPAIGN, so three
// years of a 250k-door campaign is ~500k documents where one month is ~10k. Same query count,
// fifty times the reading.
//
// But the desk only needs the live recompute for months that might be AWAITING, and a month with
// an issued statement never can be — it bills from the frozen row. So the months worth recomputing
// are the CLOSED ones with no statement. Subtract the issued set from the window and scan only the
// span that survives.
//
// This is exact, not a sample. For an org invoiced up to date the span is empty and the walk is
// skipped outright; for a neglected one it is the real backlog, which is precisely the org where
// the number matters. `outstanding`/`overdue`/`paid` never needed the walk at all — they read the
// frozen statements.
const scanSpan = ({ window: win, issuedMonths, currentMonth: cm }) => {
  const candidates = [];
  for (let m = win.from; m <= win.to; m = addMonths(m, 1)) {
    if (m >= cm) continue; // the running month is never awaiting
    if (issuedMonths.has(m)) continue; // already invoiced — the frozen row decides it
    candidates.push(m);
  }
  if (!candidates.length) return null;
  return { from: candidates[0], to: candidates[candidates.length - 1] };
};

// `includeLines` asks for the month ROWS as well, with each month's frozen or live campaign lines
// attached — what the org page's expandable ledger renders without a fetch per month. The desk
// leaves it off: it needs eight totals per org, not twelve hundred campaign lines.
//
// `fullWindow` forces the whole canonical range even where nothing is awaiting — the org page needs
// every month to render a ledger, the desk does not. Off by default, because the default caller is
// the one that must stay cheap.
export const orgInvoicing = async (
  org,
  { now = new Date(), includeLines = false, fullWindow = includeLines } = {}
) => {
  const sub = await Subscription.findOne({ organizationId: org._id }).lean();
  const internal = isInternalOrg(org, sub);
  const termsDays = termsDaysFor(sub);
  const window = canonicalWindow(org, now);
  const cm = currentMonth(now);

  // Statements first: they decide how much of the window still needs a live recompute, and on the
  // cheap path they are most of the answer.
  const issuedStatements = await (includeLines
    ? Statement.find({ organizationId: org._id, status: 'issued' })
        .populate('issuedByUserId', 'firstName lastName')
        .populate('paidByUserId', 'firstName lastName')
    : Statement.find({ organizationId: org._id, status: 'issued' }, { lines: 0 })
  )
    .sort({ month: -1 })
    .lean();

  const issuedMonths = new Set(issuedStatements.map((s) => s.month));
  // The running month is always walked: it IS the live meter every surface shows.
  const span = fullWindow
    ? { from: window.from, to: window.to }
    : (() => {
        const backlog = scanSpan({ window, issuedMonths, currentMonth: cm });
        return backlog ? { from: backlog.from, to: cm } : { from: cm, to: cm };
      })();

  const range = await monthlyStatementRange(org._id, {
    from: span.from,
    to: span.to,
    maxMonths: INVOICING_LOOKBACK_MAX_MONTHS,
  });

  const invoicing = deriveInvoicing({
    months: range.statements,
    campaigns: range.campaigns,
    issuedStatements,
    currentMonth: currentMonth(now),
    now,
    termsDays,
    internal,
    windowFrom: window.from,
    windowTruncated: window.truncated,
  });

  return {
    sub,
    internal,
    termsDays,
    window,
    range,
    issuedStatements,
    invoicing,
    // The rollup's legacy keys, computed from the SAME walk rather than a second one. The running
    // month of a range is the same object monthlyStatement returns for that month
    // (test/statementRange.int.test.js pins it), so these numbers are unchanged by the swap.
    usage: {
      month: invoicing.running.month,
      rateCents: range.rateCents,
      billableCampaigns: invoicing.running.billableCampaigns,
      totalCents: invoicing.running.liveTotalCents,
      setupCount: invoicing.running.setupCount,
      graceCount: invoicing.running.graceCount,
    },
    rows: includeLines
      ? historyRows(range, new Map(issuedStatements.map((s) => [s.month, s])), {
          now,
          termsDays,
          internal,
          includeLines: true,
        })
      : null,
  };
};
