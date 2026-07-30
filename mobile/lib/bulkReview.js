import { api } from './api';

// RN mirror of client/src/lib/bulkReview.js — client side of POST
// /admin/reports/flags/review-bulk. The scope is the SAME query-string shape as GET
// /admin/reports/flags (campaignId required; from/to, reviewStatus, reasonType, severity,
// userId, effortId), so the set the server acts on is exactly the set the current filters
// show. Compose the scope from the DISPLAYED filters, never a query's params, when any
// filtering happens client-side. Keep in sync with the web copy. docs/AUDIT.md §D.

function scopeQuery(scope) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(scope || {})) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// body: { status, note?, actionIds?, dryRun? } → the server's
// { matched, createdActionIds, overwrittenActionIds, deleted?, status }.
export function postBulkReview(scope, body) {
  return api(`/admin/reports/flags/review-bulk${scopeQuery(scope)}`, { method: 'POST', body });
}

// Exact count for a confirm line, without writing anything.
export async function countBulkReview(scope) {
  const res = await postBulkReview(scope, { status: 'reviewed', dryRun: true });
  return res.matched || 0;
}

// Undo replays the bulk's created decisions back to open. Two rules make this correct:
//  - `reviewStatus` is DROPPED from the scope — the entries just changed status, so replaying
//    the original "open" scope would match nothing;
//  - only `createdActionIds` are sent. An OVERWRITTEN decision (one that existed before the
//    bulk) must never be "undone": reopen is a delete, so it would destroy the earlier
//    reviewer's decision rather than restore it.
export function undoBulkReview(scope, createdActionIds) {
  return postBulkReview({ ...scope, reviewStatus: undefined }, { status: 'open', actionIds: createdActionIds });
}

// Same caches every review change drops on mobile: the audit screen (['admin','flags']), the
// map layer (['admin','flags-map']), campaign cards / audit tile / More row badges
// (['admin','campaigns']), and the Overview pills (['admin','reports','campaign-rollup']).
// Mirrors the single-review onReviewed handlers in admin/audit.jsx and admin/map.jsx.
export function invalidateFlagCaches(qc) {
  qc.invalidateQueries({
    predicate: (query) =>
      query.queryKey?.[0] === 'admin' &&
      (query.queryKey?.[1] === 'flags' ||
        query.queryKey?.[1] === 'flags-map' ||
        query.queryKey?.[1] === 'campaigns' ||
        (query.queryKey?.[1] === 'reports' && query.queryKey?.[2] === 'campaign-rollup')),
  });
}

// Past-tense verb for the confirmation flash: "✓ 340 dismissed".
export const BULK_VERB = {
  reviewed: 'marked reviewed',
  dismissed: 'dismissed',
  confirmed: 'confirmed as issues',
  open: 'reopened',
};
