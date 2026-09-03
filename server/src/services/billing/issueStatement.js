import { Statement } from '../../models/Statement.js';
import { SubscriptionEvent } from '../../models/SubscriptionEvent.js';
import { currentMonth, monthDayBounds, monthlyStatement } from './statement.js';

// FREEZING ONE MONTH — the whole of it, in one function.
//
// Lifted out of routes/superAdmin/billing.js when issuing several months at once became a thing
// (invoicing a client for July AND August in one pass). Everything load-bearing about an issue
// lives here so the single-month route and the multi-month route cannot drift apart: the
// internal-org refusal, the "month hasn't closed" gate, the already-issued pre-check, the
// duplicate-key RACE GUARD, the superseded back-reference, and the audit event.
//
// Returns { ok: true, statement } or { ok: false, code, error } — a REFUSAL IS A VALUE, not a
// throw, because a batch of months has to be able to skip one already-issued month and keep going.
// The single-month route maps the codes back onto its existing HTTP statuses, so its API is
// unchanged.
export const ISSUE_STATUS_BY_CODE = {
  INTERNAL_NOT_BILLABLE: 403,
  MONTH_NOT_ENDED: 422,
  ALREADY_ISSUED: 409,
  INVALID_MONTH: 400,
};

export async function issueStatementForMonth({ org, sub, month, userId, externalRef = '', force = false }) {
  if (!monthDayBounds(month)) {
    return { ok: false, month, code: 'INVALID_MONTH', error: 'month must be YYYY-MM' };
  }
  // Internal orgs are permanently non-billable and never appear on a revenue surface. Check BOTH
  // signals: billing-rollup filters on the subscription status and the status chokepoint on the
  // org flag, so an org whose two drifted apart would otherwise slip past whichever we picked.
  if (org.isInternal || sub?.status === 'internal') {
    return {
      ok: false,
      month,
      code: 'INTERNAL_NOT_BILLABLE',
      error: 'Internal organizations are never billed and cannot have statements issued.',
    };
  }
  // Don't freeze a month that's still accumulating knocks. `currentMonth()` is UTC while each
  // campaign's month boundary is its own timezone, so this is a deliberate approximation: it can
  // let a behind-UTC org's October be issued during the first hours of Nov 1 UTC. `force` exists
  // for the real cases that need it (a customer closing out early, a prepay).
  if (!force && month >= currentMonth()) {
    return {
      ok: false,
      month,
      code: 'MONTH_NOT_ENDED',
      error: `${month} has not finished yet — issue it once the month closes, or pass force to override.`,
    };
  }
  // Cheap, friendly pre-check. The real guard is the duplicate-key catch below.
  const existing = await Statement.findOne({ organizationId: org._id, month, status: 'issued' }).lean();
  if (existing) {
    return {
      ok: false,
      month,
      code: 'ALREADY_ISSUED',
      error: `${month} is already issued. Void it first to reissue.`,
      statementId: String(existing._id),
    };
  }

  const live = await monthlyStatement(org._id, month);
  let statement;
  try {
    statement = await Statement.create({
      organizationId: org._id,
      month,
      status: 'issued',
      rateCents: live.rateCents,
      rulesVersion: live.rulesVersion,
      totalCents: live.totalCents,
      lines: live.lines,
      issuedAt: new Date(),
      issuedByUserId: userId,
      externalRef: externalRef || '',
    });
  } catch (err) {
    // THE race guard. Two concurrent issues both pass the pre-check; the partial unique index
    // lets exactly one insert win and the loser lands here. No transactions exist in this
    // codebase, so single-document atomicity is doing the work.
    if (err?.code === 11000) {
      return {
        ok: false,
        month,
        code: 'ALREADY_ISSUED',
        error: `${month} was issued by someone else just now.`,
      };
    }
    throw err;
  }

  // Point the most recent voided row at its replacement. Best-effort: the statement is already
  // committed and correct, and a broken back-reference must never fail an issue.
  try {
    const prior = await Statement.findOne({ organizationId: org._id, month, status: 'void' })
      .sort({ voidedAt: -1 })
      .select({ _id: 1 });
    if (prior) {
      await Statement.updateOne({ _id: prior._id }, { $set: { supersededByStatementId: statement._id } });
    }
  } catch {
    /* leave the back-reference unset rather than fail a committed issue */
  }

  // If this throws, the statement still carries issuedAt/issuedByUserId — the audit is not lost,
  // so do NOT roll the statement back. One event PER MONTH even in a batch: the history reads as
  // "July issued, August issued", which is what actually happened and what a reader needs.
  await SubscriptionEvent.create({
    organizationId: org._id,
    byUserId: userId,
    changes: {
      statementIssued: {
        month,
        totalCents: statement.totalCents,
        rulesVersion: statement.rulesVersion,
        statementId: String(statement._id),
        externalRef: statement.externalRef || null,
      },
    },
    reason: 'Statement issued',
  });

  return { ok: true, month, statement };
}
