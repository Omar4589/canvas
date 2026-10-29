import { ClientReport, REPORT_ALL_TIME_GUARD, REPORT_PERIOD_GUARD } from '../../models/ClientReport.js';
import { ClientReportAreaCell } from '../../models/ClientReportAreaCell.js';
import { ClientReportSeries } from '../../models/ClientReportSeries.js';
import { OrgBranding } from '../../models/OrgBranding.js';
import { ReportShareLink, REPORT_ONE_LINK_GUARD } from '../../models/ReportShareLink.js';

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
// Since Latest progress (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §N) there are two guards, each built, healed
// and retried on its own, the same way: dated reports' (report_period_guard, dupGuard) and all-time
// reports' (report_all_time_guard, allTimeGuard), so the two kinds never stand for each other.
//
// And since one link per report (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C2), a third on ReportShareLink —
// report_one_link_guard, oneLinkGuard — built, healed and retried the very same way: healing makes the
// later of two guarded links of one report an ordinary second link (Share lists it under the first, with
// Delete). Boot-built like the report guards — a deliberate exception to the build-indexes rule (prod
// autoIndex off, migrate:build-indexes by hand): it is partial, tiny, and never drops anything. Each guard
// names its model (ClientReport when it doesn't).
const PERIOD_GUARD = Object.freeze({ spec: REPORT_PERIOD_GUARD, flag: 'dupGuard', sharing: 'a tab and dates' });
const ALL_TIME_GUARD = Object.freeze({
  spec: REPORT_ALL_TIME_GUARD,
  flag: 'allTimeGuard',
  sharing: 'a tab and last day',
  // An all-time report made before it had its own guard (development builds of §N only) carried dupGuard,
  // and stood in report_period_guard for a dated report of the same dates: taken out of it, every time
  // this runs (a no-op once done).
  prepare: () => ClientReport.collection.updateMany({ allTime: true, dupGuard: true }, { $unset: { dupGuard: '' } }),
});
const ONE_LINK_GUARD = Object.freeze({
  model: ReportShareLink,
  spec: REPORT_ONE_LINK_GUARD,
  flag: 'oneLinkGuard',
  sharing: 'a report',
  noun: 'link',
});
const GUARD_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];

const modelOf = (guard) => guard.model ?? ClientReport;
const nounOf = (guard) => guard.noun ?? 'report';

const buildGuard = (guard) =>
  modelOf(guard).collection.createIndex(structuredClone(guard.spec.keys), structuredClone(guard.spec.options));

// Of the guarded documents sharing a key, all but the first made (createdAt, then _id) lose the guard's
// flag. A missing key groups with null, as the unique index counts it. Projected to the key first, so the
// sort never carries a whole document. Returns the ids taken out.
const unguardDuplicates = async (guard) => {
  const { spec, flag } = guard;
  const collection = modelOf(guard).collection;
  const key = Object.fromEntries(Object.keys(spec.keys).map((k) => [k, { $ifNull: [`$${k}`, null] }]));
  const groups = await collection
    .aggregate(
      [
        { $match: { [flag]: true } },
        { $project: { createdAt: 1, ...spec.keys } },
        { $sort: { createdAt: 1, _id: 1 } },
        { $group: { _id: key, first: { $first: '$_id' }, ids: { $push: '$_id' } } },
        { $match: { 'ids.1': { $exists: true } } },
      ],
      { allowDiskUse: true }
    )
    .toArray();
  const extra = groups.flatMap((g) => g.ids.filter((id) => !id.equals(g.first)));
  if (extra.length) await collection.updateMany({ _id: { $in: extra }, [flag]: true }, { $unset: { [flag]: '' } });
  return extra;
};

// E11000 on this guard: named in the message, or its exact key pattern (the guards' keys all differ, and
// none is a link's `token` — so a token collision is never read as a second link of a report).
const sameKeys = (pattern, keys) =>
  !!pattern && Object.keys(pattern).length === Object.keys(keys).length && Object.keys(keys).every((k) => pattern[k] === 1);
const isGuardError = (guard, err) =>
  err?.code === 11000 && (String(err?.message || '').includes(guard.spec.options.name) || sameKeys(err?.keyPattern, guard.spec.keys));

// One try: build it; when a duplicate key fails the build, take the duplicates out of the guard and
// build once more. Returns how many documents it took out.
const buildOrHeal = async (guard, tag) => {
  const name = guard.spec.options.name;
  const noun = nounOf(guard);
  try {
    await buildGuard(guard);
    return 0;
  } catch (e) {
    if (!isGuardError(guard, e)) throw e;
  }
  const extra = await unguardDuplicates(guard);
  const ids = `${extra.slice(0, 20).join(', ')}${extra.length > 20 ? ', …' : ''}`;
  console.warn(`[${tag}] ${modelOf(guard).modelName} ${name}: a duplicate key failed the build; ${extra.length} ${noun}(s) sharing ${guard.sharing} with an earlier one now sit outside the guard, as second ${noun}s (${ids}) — building it again`);
  await buildGuard(guard);
  return extra.length;
};

const ensureGuard = (guard) => async (tag = 'boot', { retryDelaysMs = GUARD_RETRY_DELAYS_MS } = {}) => {
  const name = guard.spec.options.name;
  const model = modelOf(guard).modelName;
  const attempt = async (n) => {
    try {
      await guard.prepare?.();
      const healed = await buildOrHeal(guard, tag);
      if (n || healed) console.log(`[${tag}] ${model} ${name} index built${n ? ` on retry ${n}` : ''}`);
      return true;
    } catch (e) {
      const wait = retryDelaysMs[n];
      const next = wait === undefined ? 'no retries left; the next boot tries again' : `retry ${n + 1} of ${retryDelaysMs.length} in ${wait / 1000} s`;
      console.error(`[${tag}] ${model} ${name} index failed — ${next}:`, e?.message || e);
      if (wait !== undefined) setTimeout(() => attempt(n + 1), wait).unref();
      return false;
    }
  };
  return attempt(0);
};

/** Build report_period_guard (dated reports), healing and retrying as above. True when it is built now. */
export const ensureReportPeriodGuard = ensureGuard(PERIOD_GUARD);
/** Build report_all_time_guard (all-time reports, §N) the same way. True when it is built now. */
export const ensureAllTimeGuard = ensureGuard(ALL_TIME_GUARD);
/** Build report_one_link_guard (one link per report) the same way. True when it is built now. */
export const ensureOneLinkGuard = ensureGuard(ONE_LINK_GUARD);

/**
 * Did this insert lose to a guarded report of the same kind, tab and period (E11000 on either guard)?
 * POST /admin/client-reports and Next then answer that report as `existing: true` — looked up by the
 * same kind, so a dated report never answers for an all-time one or the other way round. A build of an
 * index that meets guarded duplicates fails the same way (buildOrHeal above).
 */
export const isReportPeriodGuardError = (err) => isGuardError(PERIOD_GUARD, err) || isGuardError(ALL_TIME_GUARD, err);

/**
 * Did this link's insert lose to a guarded link of the same report (E11000 on report_one_link_guard)?
 * POST /admin/client-reports/shares then answers 409 REPORT_HAS_LINK with the link that won. Never true
 * for a token collision (its key pattern is { token: 1 }).
 */
export const isOneLinkGuardError = (err) => isGuardError(ONE_LINK_GUARD, err);

export const syncClientReportIndexes = async (tag = 'boot') => {
  for (const M of NEW_REPORT_COLLECTIONS) {
    await M.syncIndexes().catch((e) => console.error(`[${tag}] ${M.modelName}.syncIndexes failed`, e?.message || e));
  }
  await ensureReportPeriodGuard(tag);
  await ensureAllTimeGuard(tag);
  await ensureOneLinkGuard(tag);
};
