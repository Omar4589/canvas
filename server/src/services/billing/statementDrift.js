// Has reality moved since we issued this invoice?
//
// Freezing a statement (models/Statement.js) stops the number changing under you. It does NOT stop
// the underlying data changing — a campaign gets reactivated, a rate is renegotiated, an offline
// queue flushes three days late. Hiding that divergence would be worse than not freezing at all:
// you'd be invoicing from a number the system quietly disagrees with and never says so.
//
// So every read of an issued month recomputes live alongside it and diffs the two. The UI shows a
// warning; nothing is ever silently reconciled. Deciding what to do — leave it, or void and
// reissue — is an account-manager judgement, not the software's.
//
// One helper, used by BOTH the per-org panel and the cross-org month-close board, so the two can
// never disagree about what "drifting" means.

// Dates arrive as Date objects from a lean() read and as ISO strings from JSON. Normalize before
// comparing or every reload reports phantom drift.
function sameInstant(a, b) {
  const x = a ? new Date(a).getTime() : null;
  const y = b ? new Date(b).getTime() : null;
  return x === y;
}

// Fields worth reporting per campaign. `money: true` marks the ones that can move the invoice.
const LINE_FIELDS = [
  { key: 'billable', money: true },
  { key: 'amountCents', money: true },
  { key: 'rateCents', money: true },
  { key: 'reason', money: false },
  { key: 'firstKnockAt', money: false, date: true },
  { key: 'archivedAt', money: false, date: true },
  { key: 'knocksThisMonth', money: false },
];

// `issued` is a Statement document (or lean object); `live` is a fresh monthlyStatement() result.
// Returns null when there is nothing to report — no issued statement, or the two agree.
export function statementDrift(issued, live) {
  if (!issued || !live) return null;

  const byId = (lines) => new Map((lines || []).map((l) => [String(l.campaignId), l]));
  const issuedLines = byId(issued.lines);
  const liveLines = byId(live.lines);

  const lines = [];
  for (const [id, was] of issuedLines) {
    const now = liveLines.get(id);
    if (!now) continue; // handled as `removedCampaigns` below
    const fields = {};
    for (const f of LINE_FIELDS) {
      const same = f.date ? sameInstant(was[f.key], now[f.key]) : was[f.key] === now[f.key];
      if (!same) fields[f.key] = { issued: was[f.key] ?? null, live: now[f.key] ?? null };
    }
    if (Object.keys(fields).length) lines.push({ campaignId: id, name: was.name, fields });
  }

  const added = [...liveLines.keys()].filter((id) => !issuedLines.has(id));
  const removed = [...issuedLines.keys()].filter((id) => !liveLines.has(id));

  const top = {};
  if (issued.totalCents !== live.totalCents) top.totalCents = { issued: issued.totalCents, live: live.totalCents };
  if (issued.rateCents !== live.rateCents) top.rateCents = { issued: issued.rateCents, live: live.rateCents };
  if (issued.rulesVersion !== live.rulesVersion) {
    top.rulesVersion = { issued: issued.rulesVersion, live: live.rulesVersion };
  }

  if (!lines.length && !added.length && !removed.length && !Object.keys(top).length) return null;

  return {
    // Does this change what the customer OWES? That is the only question the month-close board
    // raises an alarm on. A late offline flush moves `knocksThisMonth` without moving a dollar —
    // worth showing on the panel, not worth interrupting anyone over.
    material: issued.totalCents !== live.totalCents,
    ...top,
    lines,
    addedCampaigns: added.map((id) => ({
      campaignId: id,
      name: liveLines.get(id)?.name || '',
      amountCents: liveLines.get(id)?.amountCents ?? 0,
    })),
    removedCampaigns: removed.map((id) => ({
      campaignId: id,
      name: issuedLines.get(id)?.name || '',
      amountCents: issuedLines.get(id)?.amountCents ?? 0,
    })),
  };
}
