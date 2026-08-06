import { PlatformStats, PLATFORM_METRICS } from '../../models/PlatformStats.js';
import { PlatformDaily } from '../../models/PlatformDaily.js';
import { Subscription } from '../../models/Subscription.js';
import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Voter } from '../../models/Voter.js';
import { KNOCK_ACTIONS, NOT_BULK } from '../reports/aggregations.js';

// Lifetime marketing counters. See models/PlatformStats.js for the two-bucket (live/deleted) design.
// Everything here EXCLUDES `internal` organizations — synthetic demo data never touches these numbers.

const KEY = { key: 'singleton' };

// Name of the nightly reconcile job (registered in services/retention/scheduler.js
// MAINTENANCE_JOBS; the handler calls recomputeLive below). Lives here beside the service
// it names, mirroring JOB_NAME in retention/purgeDeletedIdentities.js.
export const STATS_JOB = 'platform-stats-reconcile';

// The org ids that must be excluded everywhere: Doorline's own demo/internal orgs, PLUS any org
// currently being deleted. The second half matters because captureOrgBeforeDelete banks a
// condemned org into the permanent `deleted` bucket at the START of its cascade, while its rows
// (and the Organization doc) still exist — so counting it in `live` too would double it in the
// total. That window used to be seconds; since the cascade moved to the worker it is minutes to
// hours, long enough to span the nightly reconcile and PERSIST the inflated number.
async function excludedOrgIds() {
  const [subs, deleting] = await Promise.all([
    Subscription.find({ status: 'internal' }, 'organizationId').lean(),
    Organization.find({ 'deletion.requestedAt': { $ne: null } }, '_id').lean(),
  ]);
  return [...subs.map((s) => s.organizationId), ...deleting.map((o) => o._id)];
}

async function isInternalOrg(orgId) {
  return !!(await Subscription.exists({ organizationId: orgId, status: 'internal' }));
}

// Distinct PEOPLE — {organizationId, stateVoterId} pairs — under `match`. Voter rows are
// per-campaign, so a raw row count would double-count a person imported into two campaigns
// of one org; votersProcessed has always meant people. (The same person in two ORGS still
// counts twice — orgs are separate universes, decision 13.)
async function countPeople(match) {
  const [r] = await Voter.aggregate([
    { $match: match },
    { $group: { _id: { org: '$organizationId', svid: '$stateVoterId' } } },
    { $count: 'n' },
  ]).allowDiskUse(true);
  return r?.n || 0;
}

/**
 * Live increment for a single metric. Best-effort and non-fatal: a marketing counter must never take
 * down the request that triggered it, and the backfill recomputes the live bucket anyway, so a lost
 * increment self-heals. Pass `isInternal` when the caller already knows it (the entitlement middleware
 * attaches req.subscription, so the knock/survey hot paths pay no extra query); otherwise it's resolved.
 */
export async function bumpLive(metric, n = 1, { isInternal, orgId } = {}) {
  try {
    if (!n || !PLATFORM_METRICS.includes(metric)) return;
    const internal = isInternal ?? (orgId ? await isInternalOrg(orgId) : false);
    if (internal) return;
    await PlatformStats.updateOne(KEY, { $inc: { [`live.${metric}`]: n } }, { upsert: true });
  } catch {
    // swallow — see doc comment
  }
}

// Capture a set of counts into the `deleted` bucket and remove them from `live`, so the total is
// unchanged but the contribution survives the destruction of the rows. live is clamped at 0 (a missed
// live increment must never make a counter negative; the next backfill re-syncs live exactly).
async function moveLiveToDeleted(captured) {
  const doc = (await PlatformStats.findOne(KEY).lean()) || {};
  const live = doc.live || {};
  const inc = {};
  const set = {};
  for (const m of PLATFORM_METRICS) {
    const c = captured[m] || 0;
    if (c) inc[`deleted.${m}`] = c;
    set[`live.${m}`] = Math.max(0, (live[m] || 0) - c);
  }
  const update = { $set: set };
  if (Object.keys(inc).length) update.$inc = inc;
  await PlatformStats.updateOne(KEY, update, { upsert: true });
}

/**
 * Capture an organization's lifetime contribution the instant BEFORE its rows are destroyed. Call this
 * at the top of the org-deletion cascade. Returns the captured counts (or null for an internal org,
 * which is excluded). Counts actual rows — the source of truth — never a running tally.
 */
export async function captureOrgBeforeDelete(orgId) {
  // Atomically claim the capture. deleteOrganization is retried by the retention sweep, and this add is
  // not idempotent on its own (organizations += 1 every call) — so we mark the org exactly once and skip
  // on any re-entry. `platformStatsCaptured` dies with the org, so it never lingers.
  const claimed = await Organization.findOneAndUpdate(
    { _id: orgId, platformStatsCaptured: { $ne: true } },
    { $set: { platformStatsCaptured: true } }
  );
  if (!claimed) return null; // already captured on a prior (failed) attempt, or the org is gone
  if (await isInternalOrg(orgId)) return null;
  const [campaigns, doorsKnocked, surveyResponses, votersProcessed] = await Promise.all([
    Campaign.countDocuments({ organizationId: orgId }),
    CanvassActivity.countDocuments({ organizationId: orgId, actionType: { $in: KNOCK_ACTIONS }, ...NOT_BULK }),
    SurveyResponse.countDocuments({ organizationId: orgId }),
    countPeople({ organizationId: orgId }),
  ]);
  const captured = { organizations: 1, campaigns, doorsKnocked, surveyResponses, votersProcessed };
  await moveLiveToDeleted(captured);
  return captured;
}

/**
 * Capture a single campaign's contribution before a standalone campaign delete destroys its rows. (Org
 * deletion uses captureOrgBeforeDelete instead — the two never both fire for the same rows, because a
 * row is destroyed by exactly one of the two cascades.) `organizations` is 0 here — the org lives on.
 */
export async function captureCampaignBeforeDelete(campaign) {
  // Atomically claim the capture — deleteCampaignCascade is sequential and non-transactional, so a
  // partial failure + admin retry would otherwise re-add campaigns:1 and the surviving voters into the
  // permanent `deleted` bucket (which the backfill never recomputes). Same guard as the org path.
  const claimed = await Campaign.findOneAndUpdate(
    { _id: campaign._id, platformStatsCaptured: { $ne: true } },
    { $set: { platformStatsCaptured: true } }
  );
  if (!claimed) return null; // already captured on a prior (failed) attempt
  if (await isInternalOrg(campaign.organizationId)) return null;
  const campaignId = campaign._id;
  // People this delete actually removes from the org's universe: distinct ids in this
  // campaign with NO sibling row in another campaign. A person shared with a sibling
  // campaign lives on there — banking them into `deleted` while their surviving row still
  // counts in `live` would double them in the total.
  // Aggregation cursor, NOT distinct(): distinct returns one BSON document hard-capped at
  // 16MB, which ~600k stateVoterIds would blow — making a huge campaign permanently
  // undeletable. The $group rides the unique {campaignId, stateVoterId} index; batches of
  // 5000 keep each sibling distinct() far under the cap.
  const cursor = Voter.aggregate([{ $match: { campaignId } }, { $group: { _id: '$stateVoterId' } }])
    .allowDiskUse(true)
    .cursor();
  let total = 0;
  let survivors = 0;
  let batch = [];
  const flushBatch = async () => {
    if (!batch.length) return;
    const s = await Voter.find({
      organizationId: campaign.organizationId,
      stateVoterId: { $in: batch },
      campaignId: { $ne: campaignId },
    }).distinct('stateVoterId');
    survivors += s.length;
    batch = [];
  };
  for await (const doc of cursor) {
    total += 1;
    batch.push(doc._id);
    if (batch.length >= 5000) await flushBatch();
  }
  await flushBatch();
  const [doorsKnocked, surveyResponses] = await Promise.all([
    CanvassActivity.countDocuments({ campaignId, actionType: { $in: KNOCK_ACTIONS }, ...NOT_BULK }),
    SurveyResponse.countDocuments({ campaignId }),
  ]);
  const votersProcessed = Math.max(0, total - survivors);
  const captured = { organizations: 0, campaigns: 1, doorsKnocked, surveyResponses, votersProcessed };
  await moveLiveToDeleted(captured);
  return captured;
}

/**
 * Recompute the LIVE bucket from the current rows of all non-internal orgs, and SET it (idempotent —
 * running twice yields the same result, and the `deleted` bucket is never touched). This is the backfill
 * body, and it doubles as the drift-corrector: any live increment ever missed is made exact here.
 */
/**
 * The current live counts from real rows, excluding internal orgs. READ-ONLY — used both by the backfill
 * dry run (to preview without writing) and by recomputeLive (to persist).
 */
export async function computeLiveCounts() {
  const internal = await excludedOrgIds();
  const orgNin = internal.length ? { $nin: internal } : { $exists: true };
  const [organizations, campaigns, doorsKnocked, surveyResponses, votersProcessed] = await Promise.all([
    Organization.countDocuments({ _id: orgNin }),
    Campaign.countDocuments({ organizationId: orgNin }),
    CanvassActivity.countDocuments({ organizationId: orgNin, actionType: { $in: KNOCK_ACTIONS }, ...NOT_BULK }),
    SurveyResponse.countDocuments({ organizationId: orgNin }),
    countPeople({ organizationId: orgNin }),
  ]);
  return { organizations, campaigns, doorsKnocked, surveyResponses, votersProcessed };
}

export async function recomputeLive({ stampBackfill = false } = {}) {
  const live = await computeLiveCounts();
  const set = {};
  for (const m of PLATFORM_METRICS) set[`live.${m}`] = live[m];
  if (stampBackfill) set.backfilledAt = new Date();
  await PlatformStats.updateOne(KEY, { $set: set }, { upsert: true });
  return live;
}

// ── The per-day trend series (PlatformDaily) ─────────────────────────────────────────────────────

// The date field each metric buckets by. CanvassActivity.timestamp and SurveyResponse.submittedAt
// are `required: true`; Organization/Campaign/Voter only have createdAt via `timestamps: true`,
// which Mongoose stamps on WRITE — a pre-existing row may have none. That is exactly why `undated`
// below is counted independently instead of assumed zero.
const DAILY_SOURCES = {
  organizations: { dateField: 'createdAt' },
  campaigns: { dateField: 'createdAt' },
  doorsKnocked: { dateField: 'timestamp' },
  surveyResponses: { dateField: 'submittedAt' },
  votersProcessed: { dateField: 'createdAt' },
};

/**
 * The full per-day series from real rows, plus the per-metric count of rows that carry NO date
 * (and so can never appear in any bucket). READ-ONLY — same role computeLiveCounts plays for the
 * live bucket, over the SAME filter set (internal orgs excluded; knocks = KNOCK_ACTIONS, never
 * via:'bulk'), so `Σ(days[m]) + undated[m] === computeLiveCounts()[m]` when the data is quiescent.
 * Days are UTC ('%Y-%m-%d' with no timezone) — a platform series has no campaign anchor tz.
 */
export async function computeDailySeries() {
  const internal = await excludedOrgIds();
  const orgNin = internal.length ? { $nin: internal } : { $exists: true };
  const matches = {
    organizations: [Organization, { _id: orgNin }],
    campaigns: [Campaign, { organizationId: orgNin }],
    doorsKnocked: [CanvassActivity, { organizationId: orgNin, actionType: { $in: KNOCK_ACTIONS }, ...NOT_BULK }],
    surveyResponses: [SurveyResponse, { organizationId: orgNin }],
    votersProcessed: [Voter, { organizationId: orgNin }],
  };

  const byDay = new Map();
  const undated = {};
  for (const metric of PLATFORM_METRICS) {
    const [Model, match] = matches[metric];
    const { dateField } = DAILY_SOURCES[metric];
    // votersProcessed counts PEOPLE (per-campaign rows would double-count a person imported
    // into two campaigns), so bucket each {org, person} pair once, on its FIRST row's
    // createdAt — re-importing a known person into a sibling campaign adds a row, not a bar.
    if (metric === 'votersProcessed') {
      const [buckets, missing] = await Promise.all([
        Voter.aggregate([
          { $match: { ...match, [dateField]: { $type: 'date' } } },
          { $group: { _id: { org: '$organizationId', svid: '$stateVoterId' }, first: { $min: `$${dateField}` } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$first' } }, n: { $sum: 1 } } },
        ]).allowDiskUse(true),
        // Dateless = pairs with NO dated row at all (a real count, not a residual — keeps the
        // trend invariant an actual cross-check against countPeople, like the row metrics).
        Voter.aggregate([
          { $match: match },
          {
            $group: {
              _id: { org: '$organizationId', svid: '$stateVoterId' },
              hasDate: { $max: { $cond: [{ $eq: [{ $type: `$${dateField}` }, 'date'] }, 1, 0] } },
            },
          },
          { $match: { hasDate: 0 } },
          { $count: 'n' },
        ]).allowDiskUse(true),
      ]);
      undated[metric] = missing[0]?.n || 0;
      for (const b of buckets) {
        const row = byDay.get(b._id) || {};
        row[metric] = b.n;
        byDay.set(b._id, row);
      }
      continue;
    }
    const [buckets, missing] = await Promise.all([
      // $dateToString throws on a null/missing date, so bucket only real dates …
      Model.aggregate([
        { $match: { ...match, [dateField]: { $type: 'date' } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}` } }, n: { $sum: 1 } } },
      ]),
      // … and count the dateless rows SEPARATELY (not as a residual), so the trend invariant is a
      // real cross-check of this bucketing rather than true by definition.
      Model.countDocuments({ ...match, $or: [{ [dateField]: null }, { [dateField]: { $exists: false } }] }),
    ]);
    undated[metric] = missing;
    for (const b of buckets) {
      const row = byDay.get(b._id) || {};
      row[metric] = b.n;
      byDay.set(b._id, row);
    }
  }

  const days = [...byDay.entries()]
    .map(([day, metrics]) => {
      const row = { day };
      for (const m of PLATFORM_METRICS) row[m] = metrics[m] || 0;
      return row;
    })
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  return { days, undated };
}

/**
 * Rebuild the PlatformDaily collection in FULL from computeDailySeries() and stamp the `undated`
 * counts on the singleton. Full replacement (upsert every computed day, delete the rest) is the
 * point: after an org hard-delete its rows vanish, so its bars must drop out of history — the
 * `deleted` bank preserves the total while this series stays exactly what surviving rows support.
 * Idempotent and self-healing, like recomputeLive. Runs nightly in the same STATS_JOB, from the
 * manual backfill, and from the Control Room's "Reconcile now".
 */
export async function recomputeDaily() {
  const { days, undated } = await computeDailySeries();
  if (days.length) {
    await PlatformDaily.bulkWrite(
      days.map((d) => ({ updateOne: { filter: { day: d.day }, update: { $set: d }, upsert: true } })),
      { ordered: false }
    );
  }
  await PlatformDaily.deleteMany({ day: { $nin: days.map((d) => d.day) } });
  const set = {};
  for (const m of PLATFORM_METRICS) set[`undated.${m}`] = undated[m];
  await PlatformStats.updateOne(KEY, { $set: set }, { upsert: true });
  const undatedTotal = PLATFORM_METRICS.reduce((s, m) => s + undated[m], 0);
  if (undatedTotal > 0) {
    // Loud on purpose: dateless rows mean the trend charts under-draw by exactly these counts.
    console.warn(`[platform-stats] ${undatedTotal} row(s) have no date and cannot appear in the trend series:`, undated);
  }
  return { days: days.length, undated };
}

/** The public marketing view: total (live + deleted) per metric, plus the raw buckets for auditing. */
export async function getPlatformStats() {
  const doc = (await PlatformStats.findOne(KEY).lean()) || {};
  const live = doc.live || {};
  const deleted = doc.deleted || {};
  const undated = doc.undated || {};
  const total = {};
  for (const m of PLATFORM_METRICS) total[m] = (live[m] || 0) + (deleted[m] || 0);
  return {
    total,
    live,
    deleted,
    undated: Object.fromEntries(PLATFORM_METRICS.map((m) => [m, undated[m] || 0])),
    backfilledAt: doc.backfilledAt || null,
  };
}
