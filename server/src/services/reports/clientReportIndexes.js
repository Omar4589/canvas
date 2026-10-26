import { ClientReport, REPORT_PERIOD_GUARD } from '../../models/ClientReport.js';
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

// The duplicate guard's index on ClientReport (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §E), built at
// boot beside the collections above so it exists before the first guarded create — no console step,
// and no window after a deploy in which a same-instant double could land and then fail the build.
// ClientReport is NOT synced: production built some of its indexes by hand, and syncIndexes would drop
// them. createIndex never drops anything, and the index covers only guarded reports (none before this
// deploy), so it builds at once. A failure is logged, never fatal: POST / still looks first.
//
// It heals itself (code review round 1, SRV-1). While the index is missing, nothing stops two guarded
// creates landing at the same instant, and their shared key then failed every later build — the guard
// stayed off for good. So a build that fails on a duplicate key takes every guarded report but the first
// made of its tab and dates out of the guard — each stays, an ordinary second report like one made with
// Make a second one, still found by New report's look-first — and builds again at once. Any other failure
// (a failover, a dropped connection) is retried in the background a few times, each wait longer, on
// unref'd timers that never hold a process open. Two dynos healing at once do the same thing twice.
const GUARD_NAME = REPORT_PERIOD_GUARD.options.name;
const GUARD_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];

const buildGuard = () =>
  ClientReport.collection.createIndex(structuredClone(REPORT_PERIOD_GUARD.keys), structuredClone(REPORT_PERIOD_GUARD.options));

// Of the guarded reports sharing a tab and dates, all but the first made (createdAt, then _id) lose
// dupGuard. A missing key groups with null, as the unique index counts it. Projected to the key first,
// so the sort never carries a report. Returns the ids taken out.
const unguardDuplicatePeriods = async () => {
  const key = Object.fromEntries(Object.keys(REPORT_PERIOD_GUARD.keys).map((k) => [k, { $ifNull: [`$${k}`, null] }]));
  const groups = await ClientReport.collection
    .aggregate(
      [
        { $match: { dupGuard: true } },
        { $project: { createdAt: 1, ...REPORT_PERIOD_GUARD.keys } },
        { $sort: { createdAt: 1, _id: 1 } },
        { $group: { _id: key, first: { $first: '$_id' }, ids: { $push: '$_id' } } },
        { $match: { 'ids.1': { $exists: true } } },
      ],
      { allowDiskUse: true }
    )
    .toArray();
  const extra = groups.flatMap((g) => g.ids.filter((id) => !id.equals(g.first)));
  if (extra.length) await ClientReport.collection.updateMany({ _id: { $in: extra }, dupGuard: true }, { $unset: { dupGuard: '' } });
  return extra;
};

// One try: build it; when a duplicate key fails the build, take the duplicates out of the guard and
// build once more. Returns how many reports it took out.
const buildOrHeal = async (tag) => {
  try {
    await buildGuard();
    return 0;
  } catch (e) {
    if (!isReportPeriodGuardError(e)) throw e;
  }
  const extra = await unguardDuplicatePeriods();
  const ids = `${extra.slice(0, 20).join(', ')}${extra.length > 20 ? ', …' : ''}`;
  console.warn(`[${tag}] ClientReport ${GUARD_NAME}: a duplicate key failed the build; ${extra.length} report(s) sharing a tab and dates with an earlier one now sit outside the guard, as second reports (${ids}) — building it again`);
  await buildGuard();
  return extra.length;
};

/** Build report_period_guard, healing and retrying as above. True when it is built now. */
export const ensureReportPeriodGuard = async (tag = 'boot', { retryDelaysMs = GUARD_RETRY_DELAYS_MS } = {}) => {
  const attempt = async (n) => {
    try {
      const healed = await buildOrHeal(tag);
      if (n || healed) console.log(`[${tag}] ClientReport ${GUARD_NAME} index built${n ? ` on retry ${n}` : ''}`);
      return true;
    } catch (e) {
      const wait = retryDelaysMs[n];
      const next = wait === undefined ? 'no retries left; the next boot tries again' : `retry ${n + 1} of ${retryDelaysMs.length} in ${wait / 1000} s`;
      console.error(`[${tag}] ClientReport ${GUARD_NAME} index failed — ${next}:`, e?.message || e);
      if (wait !== undefined) setTimeout(() => attempt(n + 1), wait).unref();
      return false;
    }
  };
  return attempt(0);
};

/**
 * Did this insert lose to a guarded report of the same tab and period (E11000 on report_period_guard)?
 * POST /admin/client-reports and Next then answer that report as `existing: true`. A build of the index
 * that meets guarded duplicates fails the same way (buildOrHeal above).
 */
export const isReportPeriodGuardError = (err) =>
  err?.code === 11000 &&
  (String(err?.message || '').includes(REPORT_PERIOD_GUARD.options.name) ||
    Object.keys(REPORT_PERIOD_GUARD.keys).every((k) => err?.keyPattern?.[k] === 1));

export const syncClientReportIndexes = async (tag = 'boot') => {
  for (const M of NEW_REPORT_COLLECTIONS) {
    await M.syncIndexes().catch((e) => console.error(`[${tag}] ${M.modelName}.syncIndexes failed`, e?.message || e));
  }
  await ensureReportPeriodGuard(tag);
};
