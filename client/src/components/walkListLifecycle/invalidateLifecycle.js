import { STALE_CODES, errorCode } from './lifecycleCopy.js';

// Everything an archive, unarchive, bring back or activation can change: the walk lists (status, crew,
// setup chip), every pass list (prefix match: campaign-wide and per walk list), the setup checklist,
// Campaign Home's live counts, any open Turf Cutting book list, and the campaign's History feed.
export const invalidateLifecycle = (qc, campaignId) => {
  qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
  qc.invalidateQueries({ queryKey: ['admin', 'passes', campaignId] });
  qc.invalidateQueries({ queryKey: ['admin', 'setup-status', campaignId] });
  // Both rollup keys, as TurfsPage does: the Overview's ['campaign-rollup'] prefix and Campaign Home's
  // ['reports', 'campaign-rollup', …], which the prefix alone never reached.
  qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
  qc.invalidateQueries({ predicate: (q) => q.queryKey?.[0] === 'reports' && q.queryKey?.[1] === 'campaign-rollup' });
  qc.invalidateQueries({ queryKey: ['turfs', campaignId] });
  qc.invalidateQueries({ queryKey: ['admin', 'campaign-history', campaignId] });
};

// After a 409: the page may be showing a walk list, pass or campaign someone else has since archived
// (or is changing right now), so it refetches what it shows; the campaign too on those four codes.
// It never retries or falls back to another action.
export const refreshAfterRefusal = (qc, campaignId, err) => {
  if (err?.status !== 409) return;
  invalidateLifecycle(qc, campaignId);
  if (STALE_CODES.includes(errorCode(err))) qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
};
