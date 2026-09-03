// Applying many links at once — and the one invalidation rule the mapping screen
// cannot get wrong.
import { api } from '../api/client.js';

/**
 * Invalidate exactly what a link or unlink changes.
 *
 * The page used to invalidate the PREFIX ['admin','integrations'], which was fine
 * when it matched three cheap queries. It now also matches the projects query,
 * whose refetch is a paged /shifts pull against the provider — so a prefix here
 * would put a multi-page provider call behind every single click of "Link".
 *
 * Deliberately NOT invalidated: the projects query (a link cannot change which
 * project somebody clocked into), ['admin','integrations','org-users'] and
 * ['admin','campaigns'] (a link changes neither). Connect / disconnect / settings
 * keep the broad prefix, where re-pulling everything IS correct.
 */
export function invalidateLinkCaches(qc, orgId) {
  qc.invalidateQueries({ queryKey: ['admin', 'integrations', 'fbtime', orgId] });
  qc.invalidateQueries({ queryKey: ['admin', 'integrations', 'fbtime', 'people', orgId] });
  qc.invalidateQueries({ queryKey: ['admin', 'integrations', 'fbtime', 'events', orgId] });
  // Every measured hours figure moves when a link does.
  qc.invalidateQueries({ queryKey: ['reports'] });
}

/**
 * Run link/unlink work with bounded concurrency.
 *
 * A client loop rather than a batch endpoint, on purpose: the per-item routes
 * already enforce the two unique indexes, backfill FbTimeShift.userId, and write
 * ONE IntegrationEvent per link — and per-link provenance is the point, because a
 * wrong link is a payroll-adjacent mistake somebody has to be able to trace. A
 * batch route would either emit N events anyway or destroy that trail.
 *
 * Concurrency is bounded because each POST does an updateMany; firing fifty in
 * parallel is a self-inflicted outage on our own database. Partial failure is the
 * NORMAL case here (a LINK_TAKEN race), so results are reported per item and the
 * caller invalidates ONCE at the end, never per item.
 */
const runBatch = async (items, worker, { concurrency = 3, onSettled } = {}) => {
  const ok = [];
  const failed = [];
  let cursor = 0;

  const drain = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      try {
        await worker(item);
        ok.push(item.key);
        onSettled?.(item.key, { ok: true });
      } catch (err) {
        const entry = {
          key: item.key,
          message: err?.message || 'Something went wrong.',
          code: err?.code || null,
        };
        failed.push(entry);
        onSettled?.(item.key, { ok: false, ...entry });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, drain)
  );
  return { ok, failed };
};

/** items: [{ key, userId, fbtimePersonId, fbtimeName, fbtimeEmail }] */
export const runLinkBatch = (items, opts) =>
  runBatch(
    items,
    (i) =>
      api('/admin/integrations/fbtime/links', {
        method: 'POST',
        body: {
          userId: i.userId,
          fbtimePersonId: i.fbtimePersonId,
          // Denormalized labels, so the row still names somebody if this person
          // later leaves the FbTime roster.
          fbtimeName: i.fbtimeName || undefined,
          fbtimeEmail: i.fbtimeEmail || undefined,
        },
      }),
    opts
  );

/** items: [{ key, userId }] */
export const runUnlinkBatch = (items, opts) =>
  runBatch(
    items,
    (i) => api(`/admin/integrations/fbtime/links/${i.userId}`, { method: 'DELETE' }),
    opts
  );
