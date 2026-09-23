import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { Organization } from '../../models/Organization.js';
import { NOT_DELETING } from '../../services/platform/orgDeletionState.js';
import { Statement } from '../../models/Statement.js';
import { Subscription } from '../../models/Subscription.js';
import {
  currentMonth,
  monthDayBounds,
  monthlyStatementRange,
  monthsBetween,
} from '../../services/billing/statement.js';
import { statementDrift } from '../../services/billing/statementDrift.js';
import { addMonths } from '../../services/billing/billingMonths.js';
import {
  classifyMonth,
  effectiveDueAt,
  paymentStateOf,
  termsDaysFor,
} from '../../services/billing/invoicingState.js';

// The MONTH-CLOSE BOARD: for one month, every org's issued-or-not state in a single view.
//
// Issuing happens per org (routes/superAdmin/billing.js). Closing a month is the other shape of
// the same job — "who still needs invoicing, and did anything move since I invoiced them" — and
// clicking through thirty orgs to answer it is how a month gets missed.
const router = Router();
router.use(requireAuth, requireSuperAdmin);

router.get('/statements', async (req, res, next) => {
  try {
    // Two shapes, one route. `month=` is the original single-month board and is untouched.
    // `from=&to=` closes a RANGE — the shape of "invoice everyone for July and August", where
    // clicking each month separately is the same way a month gets missed one org at a time.
    const rangeMode = Boolean(req.query.from || req.query.to);
    const month = String(req.query.month || '');
    let months;
    if (rangeMode) {
      const from = String(req.query.from || req.query.to || '');
      const to = String(req.query.to || req.query.from || '');
      try {
        months = monthsBetween(from, to);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    } else {
      // No month? Default to the LAST CLOSED one — the month you are almost always here to close.
      // The client used to pick this from the browser clock, which disagrees with the server's UTC
      // month for several hours around each boundary; now it adopts `month` from this response.
      const resolved = month || addMonths(currentMonth(), -1);
      if (!monthDayBounds(resolved)) return res.status(400).json({ error: 'month must be YYYY-MM' });
      months = [resolved];
    }
    // Recomputing every org's month live is the expensive path — it is O(orgs × campaigns) database
    // round-trips, strictly worse than /billing-rollup, which already loops serially. So it is
    // OPT-IN: the default answer is three queries and no statement walks, and the client asks for
    // live only behind an explicit button.
    const wantLive = req.query.live === '1' || req.query.live === 'true';

    const [orgs, subs, issued] = await Promise.all([
      // NOT_DELETING: never put an invoice in front of a tenant we are destroying (and Statement
      // is swept by the cascade moments later anyway).
      Organization.find(NOT_DELETING, 'name slug isActive isInternal').sort({ name: 1 }).lean(),
      Subscription.find({}, 'organizationId status paymentTermsDays').lean(),
      Statement.find({ month: { $in: months }, status: 'issued' }, { lines: 0 })
        .populate('issuedByUserId', 'firstName lastName')
        .populate('paidByUserId', 'firstName lastName')
        .lean(),
    ]);
    const now = new Date();
    const subMap = new Map(subs.map((s) => [String(s.organizationId), s]));
    // org -> month -> statement. In single-month mode the inner map has at most one entry, which is
    // what keeps the existing row shape below a straight lookup.
    const stmtMap = new Map();
    for (const st of issued) {
      const k = String(st.organizationId);
      if (!stmtMap.has(k)) stmtMap.set(k, new Map());
      stmtMap.get(k).set(st.month, st);
    }

    const rows = [];
    for (const o of orgs) {
      const sub = subMap.get(String(o._id)) || null;
      // Internal orgs are never billed and never appear on a revenue surface — same both-signals
      // check the issue route makes.
      if (o.isInternal || sub?.status === 'internal') continue;
      const byMonth = stmtMap.get(String(o._id)) || new Map();
      // ONE live range pass per org when asked, instead of one per org PER MONTH — which is what
      // makes a live range affordable at all (services/billing/statement.js → monthlyStatementRange).
      let live = null;
      if (wantLive) {
        const r = await monthlyStatementRange(o._id, { from: months[0], to: months[months.length - 1] });
        live = new Map(r.statements.map((st) => [st.month, st]));
      }

      const termsDays = termsDaysFor(sub);
      const monthRows = [];
      for (const m of months) {
        const stmt = byMonth.get(m) || null;
        const liveStmt = live?.get(m) || null;
        const mr = {
          month: m,
          issued: Boolean(stmt),
          statementId: stmt ? String(stmt._id) : null,
          issuedAt: stmt?.issuedAt ?? null,
          issuedBy: stmt?.issuedByUserId
            ? `${stmt.issuedByUserId.firstName || ''} ${stmt.issuedByUserId.lastName || ''}`.trim()
            : null,
          externalRef: stmt?.externalRef || null,
          rulesVersion: stmt?.rulesVersion ?? null,
          issuedTotalCents: stmt?.totalCents ?? null,
          liveTotalCents: liveStmt ? liveStmt.totalCents : null,
          drift: null,
          // ── additive: the same payment vocabulary the desk and the org page use ──
          dueAt: stmt ? effectiveDueAt(stmt, termsDays) : null,
          paidAt: stmt?.paidAt ?? null,
          paidBy: stmt?.paidByUserId
            ? `${stmt.paidByUserId.firstName || ''} ${stmt.paidByUserId.lastName || ''}`.trim()
            : null,
          paymentRef: stmt?.paymentRef || null,
          paymentState: stmt ? paymentStateOf(stmt, { now, termsDays }) : null,
          // In live mode a closed month with nothing to bill is 'zero', not an unissued alarm: a
          // $0 month owes nobody anything, and clicking Issue on thirty of them is busywork.
          //
          // NULL for an un-issued month in the cheap mode, deliberately. Without a live total
          // there is no way to tell "owes $600" from "owes nothing", and defaulting either way
          // would be the exact lie this vocabulary exists to prevent. An ISSUED month is always
          // classifiable — its frozen row carries everything the answer needs.
          state:
            stmt || liveStmt
              ? classifyMonth({
                  month: m,
                  currentMonth: currentMonth(now),
                  frozen: stmt,
                  liveTotalCents: liveStmt ? liveStmt.totalCents : 0,
                  internal: false,
                  now,
                  termsDays,
                })
              : null,
        };
        // Only an ISSUED month can drift — an un-issued one has nothing to disagree with.
        if (wantLive && stmt && liveStmt) {
          const full = await Statement.findById(stmt._id).lean();
          mr.drift = statementDrift(full, liveStmt);
        }
        monthRows.push(mr);
      }

      // The single-month fields stay AT THE TOP LEVEL, unchanged, so the existing board keeps
      // working byte-for-byte; `months` is purely additive alongside them.
      const { month: _headMonth, ...head } = monthRows[0];
      rows.push({
        organizationId: String(o._id),
        name: o.name,
        slug: o.slug,
        isActive: o.isActive,
        status: sub?.status ?? null,
        ...head,
        months: monthRows,
        // What this org owes across the whole range, issued figures where frozen and live where
        // not — the number an account manager invoices from when closing two months at once.
        rangeTotalCents: monthRows.reduce(
          (sum, r) => sum + (r.issued ? r.issuedTotalCents || 0 : r.liveTotalCents || 0),
          0
        ),
        unissuedMonths: monthRows.filter((r) => !r.issued).map((r) => r.month),
      });
    }

    // Flattened across every org x month, so the range totals mean the same thing the
    // single-month ones always did.
    const all = rows.flatMap((r) => r.months);
    res.json({
      month: rangeMode ? months[months.length - 1] : months[0],
      // The server's month, so the client's picker never offers one the issue gate would refuse.
      currentMonth: currentMonth(now),
      asOf: now,
      paidCount: all.filter((r) => r.paymentState === 'paid').length,
      overdueCount: all.filter((r) => r.paymentState === 'overdue').length,
      from: months[0],
      to: months[months.length - 1],
      months,
      range: rangeMode,
      live: wantLive,
      organizations: rows,
      issuedCount: all.filter((r) => r.issued).length,
      // Counts the ALARM, not the absence. In live mode a closed $0 month is 'zero' — nobody owes
      // anything for it — and folding those in told an operator to chase 35 invoices when there
      // were 5, which is the exact miscount the 'zero' state exists to prevent. Without `live`
      // there is no state to judge by, so that mode's count is unchanged.
      unissuedCount: all.filter((r) => !r.issued && r.state !== 'zero').length,
      zeroCount: all.filter((r) => r.state === 'zero').length,
      issuedTotalCents: all.reduce((s, r) => s + (r.issuedTotalCents || 0), 0),
      liveTotalCents: wantLive ? all.reduce((s, r) => s + (r.liveTotalCents || 0), 0) : null,
      driftingCount: wantLive ? all.filter((r) => r.drift?.material).length : null,
      // Everything owed across the range: frozen where issued, live where not.
      rangeTotalCents: rows.reduce((s, r) => s + r.rangeTotalCents, 0),
    });
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

export default router;
