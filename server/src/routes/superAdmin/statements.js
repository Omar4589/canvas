import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { Organization } from '../../models/Organization.js';
import { Statement } from '../../models/Statement.js';
import { Subscription } from '../../models/Subscription.js';
import { monthDayBounds, monthlyStatement } from '../../services/billing/statement.js';
import { statementDrift } from '../../services/billing/statementDrift.js';

// The MONTH-CLOSE BOARD: for one month, every org's issued-or-not state in a single view.
//
// Issuing happens per org (routes/superAdmin/billing.js). Closing a month is the other shape of
// the same job — "who still needs invoicing, and did anything move since I invoiced them" — and
// clicking through thirty orgs to answer it is how a month gets missed.
const router = Router();
router.use(requireAuth, requireSuperAdmin);

router.get('/statements', async (req, res, next) => {
  try {
    const month = String(req.query.month || '');
    if (!monthDayBounds(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
    // Recomputing every org's month live is the expensive path — it is O(orgs × campaigns) database
    // round-trips, strictly worse than /billing-rollup, which already loops serially. So it is
    // OPT-IN: the default answer is three queries and no statement walks, and the client asks for
    // live only behind an explicit button.
    const wantLive = req.query.live === '1' || req.query.live === 'true';

    const [orgs, subs, issued] = await Promise.all([
      Organization.find({}, 'name slug isActive isInternal').sort({ name: 1 }).lean(),
      Subscription.find({}, 'organizationId status').lean(),
      Statement.find({ month, status: 'issued' }, { lines: 0 })
        .populate('issuedByUserId', 'firstName lastName')
        .lean(),
    ]);
    const subMap = new Map(subs.map((s) => [String(s.organizationId), s]));
    const stmtMap = new Map(issued.map((s) => [String(s.organizationId), s]));

    const rows = [];
    for (const o of orgs) {
      const sub = subMap.get(String(o._id)) || null;
      // Internal orgs are never billed and never appear on a revenue surface — same both-signals
      // check the issue route makes.
      if (o.isInternal || sub?.status === 'internal') continue;
      const stmt = stmtMap.get(String(o._id)) || null;
      const row = {
        organizationId: String(o._id),
        name: o.name,
        slug: o.slug,
        isActive: o.isActive,
        status: sub?.status ?? null,
        issued: Boolean(stmt),
        statementId: stmt ? String(stmt._id) : null,
        issuedAt: stmt?.issuedAt ?? null,
        issuedBy: stmt?.issuedByUserId
          ? `${stmt.issuedByUserId.firstName || ''} ${stmt.issuedByUserId.lastName || ''}`.trim()
          : null,
        externalRef: stmt?.externalRef || null,
        rulesVersion: stmt?.rulesVersion ?? null,
        issuedTotalCents: stmt?.totalCents ?? null,
        liveTotalCents: null,
        drift: null,
      };
      if (wantLive) {
        const live = await monthlyStatement(o._id, month);
        row.liveTotalCents = live.totalCents;
        // Only an ISSUED month can drift — an un-issued one has nothing to disagree with.
        if (stmt) {
          const full = await Statement.findById(stmt._id).lean();
          row.drift = statementDrift(full, live);
        }
      }
      rows.push(row);
    }

    res.json({
      month,
      live: wantLive,
      organizations: rows,
      issuedCount: rows.filter((r) => r.issued).length,
      unissuedCount: rows.filter((r) => !r.issued).length,
      issuedTotalCents: rows.reduce((s, r) => s + (r.issuedTotalCents || 0), 0),
      liveTotalCents: wantLive ? rows.reduce((s, r) => s + (r.liveTotalCents || 0), 0) : null,
      driftingCount: wantLive ? rows.filter((r) => r.drift?.material).length : null,
    });
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

export default router;
