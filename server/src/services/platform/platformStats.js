import { PlatformStats, PLATFORM_METRICS } from '../../models/PlatformStats.js';
import { Subscription } from '../../models/Subscription.js';
import { Organization } from '../../models/Organization.js';
import { Campaign } from '../../models/Campaign.js';
import { Household } from '../../models/Household.js';
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

// The org ids that must be excluded everywhere (Doorline's own demo/internal orgs).
async function internalOrgIds() {
  const subs = await Subscription.find({ status: 'internal' }, 'organizationId').lean();
  return subs.map((s) => s.organizationId);
}

async function isInternalOrg(orgId) {
  return !!(await Subscription.exists({ organizationId: orgId, status: 'internal' }));
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
    Voter.countDocuments({ organizationId: orgId }),
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
  const householdIds = await Household.find({ campaignId }).distinct('_id');
  const [doorsKnocked, surveyResponses, votersProcessed] = await Promise.all([
    CanvassActivity.countDocuments({ campaignId, actionType: { $in: KNOCK_ACTIONS }, ...NOT_BULK }),
    SurveyResponse.countDocuments({ campaignId }),
    Voter.countDocuments({ householdId: { $in: householdIds } }),
  ]);
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
  const internal = await internalOrgIds();
  const orgNin = internal.length ? { $nin: internal } : { $exists: true };
  const [organizations, campaigns, doorsKnocked, surveyResponses, votersProcessed] = await Promise.all([
    Organization.countDocuments({ _id: orgNin }),
    Campaign.countDocuments({ organizationId: orgNin }),
    CanvassActivity.countDocuments({ organizationId: orgNin, actionType: { $in: KNOCK_ACTIONS }, ...NOT_BULK }),
    SurveyResponse.countDocuments({ organizationId: orgNin }),
    Voter.countDocuments({ organizationId: orgNin }),
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

/** The public marketing view: total (live + deleted) per metric, plus the raw buckets for auditing. */
export async function getPlatformStats() {
  const doc = (await PlatformStats.findOne(KEY).lean()) || {};
  const live = doc.live || {};
  const deleted = doc.deleted || {};
  const total = {};
  for (const m of PLATFORM_METRICS) total[m] = (live[m] || 0) + (deleted[m] || 0);
  return { total, live, deleted, backfilledAt: doc.backfilledAt || null };
}
