import { api } from '../api/client.js';

// Client side of POST /admin/reports/flags/review-bulk — one decision applied to every flag
// matching a /flags query scope. The scope is the SAME query-string shape as GET
// /admin/reports/flags (campaignId required; from/to, reviewStatus, reasonType, severity,
// userId, effortId), so the set the server acts on is exactly the set the current filters
// show. CRITICAL for callers: compose the scope from the DISPLAYED filters, not the fetch's —
// the Audit page fetches without userId and applies userId/reason/severity client-side, so
// copying its query params would bulk-act far wider than what's on screen. docs/AUDIT.md §D.

function scopeQuery(scope) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(scope || {})) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// body: { status, note?, actionIds?, dryRun? }. Returns the server's
// { matched, createdActionIds, overwrittenActionIds, deleted?, status } (or { matched,
// dryRun:true } for a dry run).
export function postBulkReview(scope, body) {
  return api(`/admin/reports/flags/review-bulk${scopeQuery(scope)}`, { method: 'POST', body });
}

// Exact count for a confirm line, without writing anything — needed whenever the local list
// can't know the full matching count (fetch capped at 500, or client-side filters active).
export async function countBulkReview(scope) {
  const res = await postBulkReview(scope, { status: 'reviewed', dryRun: true });
  return res.matched || 0;
}

// Undo replays the bulk's created decisions back to open. Two rules make this correct:
//  - `reviewStatus` is DROPPED from the scope — the entries just changed status, so replaying
//    the original "open" scope would match nothing;
//  - only `createdActionIds` are sent. An OVERWRITTEN decision (one that existed before the
//    bulk) must never be "undone": reopen is a delete, so it would destroy the earlier
//    reviewer's decision rather than restore it. The server response splits the two for
//    exactly this reason.
export function undoBulkReview(scope, createdActionIds) {
  return postBulkReview({ ...scope, reviewStatus: undefined }, { status: 'open', actionIds: createdActionIds });
}

// Every surface that changes a review drops the same caches: both flags queries (Audit page +
// map layer), the campaigns list (sidebar/BottomNav mock-GPS badges), and the campaign rollup
// (dashboard banner). Mirrors the single-review onFlagReviewed handlers in AuditPage/MapPage.
export function invalidateFlagCaches(qc) {
  qc.invalidateQueries({
    predicate: (q) =>
      (q.queryKey?.[0] === 'admin' && (q.queryKey?.[1] === 'flags-map' || q.queryKey?.[1] === 'campaigns')) ||
      (q.queryKey?.[0] === 'reports' && (q.queryKey?.[1] === 'flags' || q.queryKey?.[1] === 'campaign-rollup')),
  });
}

// Past-tense verb for toasts: "✓ 340 dismissed".
export const BULK_VERB = {
  reviewed: 'marked reviewed',
  dismissed: 'dismissed',
  confirmed: 'confirmed as issues',
  open: 'reopened',
};
