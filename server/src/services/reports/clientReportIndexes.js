import { ClientReportAreaCell } from '../../models/ClientReportAreaCell.js';
import { ClientReportSeries } from '../../models/ClientReportSeries.js';
import { OrgBranding } from '../../models/OrgBranding.js';

// The client-report upgrade's NEW collections (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F12). Their
// indexes are built at BOOT by both the web dyno (awaited before it listens — it writes them: a
// series' partial-unique indexes are what keep two teams from claiming one crew) and the worker,
// because autoIndex is off in production and a deploy that skipped migrate:build-indexes must still
// never write a duplicate. syncIndexes is idempotent, and these collections start empty.
//
// Index definitions are FINAL at first deploy: once these hold data, a changed partial filter makes
// this drop and rebuild a unique index on a live collection (§O9). OrgBranding's unique
// organizationId is what keeps an organization to one logo document under racing uploads.
export const NEW_REPORT_COLLECTIONS = [ClientReportAreaCell, ClientReportSeries, OrgBranding];

export const syncClientReportIndexes = async (tag = 'boot') => {
  for (const M of NEW_REPORT_COLLECTIONS) {
    await M.syncIndexes().catch((e) => console.error(`[${tag}] ${M.modelName}.syncIndexes failed`, e?.message || e));
  }
};
