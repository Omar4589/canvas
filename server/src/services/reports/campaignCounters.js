import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { KNOCK_ACTIONS, NOT_BULK, knocksPipeline } from './aggregations.js';

// Maintenance for Campaign.stats — the denormalized all-time ledger counters (see the field
// comment in models/Campaign.js). Two tiers, both exact:
//
//   • HOT PATH (mobile knock/survey writes): the caller pre-reads the (household, pass) pair's
//     replaceable rows ONCE, derives the pair's billable-knock state before/after from that read
//     (the delete removes exactly the caller's rows; the create adds one known row — no second
//     query), and bumps with the deltas via `bumpCampaignStats`.
//   • RARE ADMIN BULK OPS (re-cut clear-knocks, snapshot restore, restrict-bulk/unrestrict-bulk
//     and restrict-doors/unrestrict-doors, draft-pass delete, admin survey delete, demo staging):
//     call `recomputeCampaignStats` after the mutation — a full
//     per-campaign recompute is exactly what the dashboards used to do on EVERY read, so doing it
//     once per rare admin write is strictly cheaper and immune to bulk-delta math bugs.
//
// The bump is guarded on `stats.reconciledAt` being set, so an unseeded legacy campaign is never
// partially incremented — its stats stay absent (readers fall back to live aggregation) until the
// migrate:campaign-stats backfill seeds them.
//
// Known limit (documented, accepted): the hot path is a read-compute-write without a transaction,
// so two truly simultaneous writes on the SAME (household, pass) pair can each see the other's row
// as absent and double-bump a pair counter by 1. That needs two canvassers on one door in the same
// instant; the reconcile (migrate:campaign-stats / reconcileCounts) repairs any drift.

// Billable-knock state of one (household, pass) pair, derived from its activity rows.
// Mirrors knocksPipeline's inner $group: knock = any KNOCK_ACTIONS row; surveyed/lit/refused =
// $max over the matching actionType.
//
// `restrictedDoor` mirrors the same pipeline run with includeRestricted: a pair counts as a
// restricted DOOR only when it has a non-bulk `restricted` mark and NO knock — so knockCount and
// restrictedDoorCount are disjoint and sum to billableDoors. The moment a real disposition lands
// on the pair, the door flips out of restricted and into knocks, which is exactly the transition
// the surveyed/lit/refused flags already model. Desk marks are skipped for the same reason the
// pipeline skips them: a desk-authored restricted mark (a whole book or a single home) is not
// field work (see aggregations.js). Callers MUST project `via` alongside `actionType`, or every
// desk mark would look like a walk.
export function knockStateOf(rows) {
  const state = { knock: false, surveyed: false, lit: false, refused: false, restrictedDoor: false };
  let restricted = false;
  for (const r of rows) {
    if (r.actionType === 'restricted') {
      if (r.via !== 'bulk') restricted = true;
      continue;
    }
    if (!KNOCK_ACTIONS.includes(r.actionType)) continue;
    state.knock = true;
    if (r.actionType === 'survey_submitted') state.surveyed = true;
    else if (r.actionType === 'lit_dropped') state.lit = true;
    else if (r.actionType === 'refused') state.refused = true;
  }
  state.restrictedDoor = restricted && !state.knock;
  return state;
}

// Per-counter deltas (−1 | 0 | +1 each) for a pair whose knock state moved before → after.
export function knockStateDelta(before, after) {
  const d = (b, a) => (a ? 1 : 0) - (b ? 1 : 0);
  return {
    knockCount: d(before.knock, after.knock),
    surveyedKnockCount: d(before.surveyed, after.surveyed),
    litKnockCount: d(before.lit, after.lit),
    refusedKnockCount: d(before.refused, after.refused),
    restrictedDoorCount: d(before.restrictedDoor, after.restrictedDoor),
  };
}

// Apply hot-path deltas in ONE guarded update. `knocks` is a knockStateDelta result; `at`/`userId`
// must be omitted for bulk-authored rows (lastActivityAt/canvasserIds mirror NOT_BULK surfaces).
export async function bumpCampaignStats(
  campaignId,
  { activity = 0, knocks = null, litDropped = 0, surveys = 0, at = null, userId = null } = {}
) {
  const inc = {};
  if (activity) inc['stats.activityCount'] = activity;
  if (litDropped) inc['stats.litDroppedCount'] = litDropped;
  if (surveys) inc['stats.surveyCount'] = surveys;
  for (const [k, v] of Object.entries(knocks || {})) {
    if (v) inc[`stats.${k}`] = v;
  }
  const update = {};
  if (Object.keys(inc).length) update.$inc = inc;
  if (at) update.$max = { 'stats.lastActivityAt': at };
  if (userId) update.$addToSet = { 'stats.canvasserIds': userId };
  if (!Object.keys(update).length) return;
  // The reconciledAt guard: unseeded (legacy) campaigns no-op instead of accumulating a partial,
  // wrong count — they stay on the live-aggregation fallback until backfilled.
  await Campaign.updateOne({ _id: campaignId, 'stats.reconciledAt': { $ne: null } }, update);
}

// Exact stats for one campaign, recomputed from the ledgers (the same aggregations the live
// dashboards run). Every query rides a campaignId-prefixed index.
export async function computeCampaignStats(campaignId) {
  // ORG-SCOPED, and it must be: every live reader matches on organizationId AND campaignId
  // (campaign-rollup's fallback at routes/admin/reports.js, /knocks-by-pass via baseFilter, the
  // timeline). This oracle used to match on campaignId ALONE, which made the counter answer a
  // slightly WIDER question than the dashboards it feeds. A row carrying the right campaignId but a
  // missing or foreign organizationId then counted toward the cached card and was invisible to
  // every live report — and because the drift check recomputed with the same wide match, the
  // reconcile agreed with the bad number and reported "nothing to do". That is drift no repair
  // could ever fix. Scoping here makes cache and live answer the same question by construction, so
  // any disagreement is real drift the sweep can actually repair.
  const campaign = await Campaign.findById(campaignId, { organizationId: 1 }).lean();
  const scope = campaign ? { organizationId: campaign.organizationId, campaignId } : { campaignId };

  const [activityCount, knockAgg, litDroppedCount, surveyCount, lastRow, canvasserIds] =
    await Promise.all([
      CanvassActivity.countDocuments(scope),
      // includeRestricted so ONE pass yields both knockCount (unchanged — `knocks` means the same
      // thing in both modes) and restrictedDoorCount. Storing them unconditionally keeps the
      // counters flag-independent: flipping billRestrictedDoors is a read-time decision and must
      // never require a recompute.
      CanvassActivity.aggregate(knocksPipeline(scope, { includeRestricted: true })),
      CanvassActivity.countDocuments({ ...scope, actionType: 'lit_dropped' }),
      SurveyResponse.countDocuments(scope),
      CanvassActivity.findOne({ ...scope, ...NOT_BULK }, { timestamp: 1 })
        .sort({ timestamp: -1 })
        .lean(),
      CanvassActivity.distinct('userId', { ...scope, ...NOT_BULK }),
    ]);
  const k = knockAgg[0] || {};
  return {
    activityCount,
    knockCount: k.knocks || 0,
    surveyedKnockCount: k.surveyedKnocks || 0,
    litKnockCount: k.litKnocks || 0,
    refusedKnockCount: k.refusedKnocks || 0,
    restrictedDoorCount: k.restrictedDoors || 0,
    litDroppedCount,
    surveyCount,
    lastActivityAt: lastRow?.timestamp || null,
    canvasserIds: canvasserIds.filter(Boolean),
  };
}

// Recompute-and-write for one campaign or a list — the repair tool the rare-admin-op hooks, the
// demo stager, and the migrate:campaign-stats backfill all share. Never throws into the caller's
// request flow decision: counters are a read-optimization, so a failed recompute must not fail
// the admin mutation that already committed (callers pass swallowErrors: true from request paths).
export async function recomputeCampaignStats(campaignIdOrIds, { swallowErrors = false } = {}) {
  const ids = Array.isArray(campaignIdOrIds) ? campaignIdOrIds : [campaignIdOrIds];
  try {
    for (const id of ids) {
      if (!id) continue;
      const stats = await computeCampaignStats(id);
      await Campaign.updateOne({ _id: id }, { $set: { stats: { ...stats, reconciledAt: new Date() } } });
    }
  } catch (err) {
    if (!swallowErrors) throw err;
    console.error('[campaignCounters] recompute failed (stats stale until next reconcile):', err?.message || err);
  }
}

// The maintenance job's name. Lives here beside the service it reconciles, so the scheduler
// imports the job identity from the thing that does the work (mirrors platformStats.js/STATS_JOB).
export const CAMPAIGN_STATS_JOB = 'reconcile-campaign-stats';

// The counters a drift check compares. lastActivityAt and canvasserIds are compared separately
// below — they are not scalars.
const COUNTER_KEYS = [
  'activityCount',
  'knockCount',
  'surveyedKnockCount',
  'litKnockCount',
  'refusedKnockCount',
  'restrictedDoorCount',
  'litDroppedCount',
  'surveyCount',
];

// Is the stored counter set still equal to a freshly computed one? ONE definition, shared by the
// nightly reconcile and the migrate:campaign-stats CLI — a drift check that disagrees with the
// repair it triggers is worse than no check at all.
export function sameStats(stored, fresh) {
  for (const k of COUNTER_KEYS) {
    if ((stored?.[k] || 0) !== (fresh[k] || 0)) return false;
  }
  const storedLast = stored?.lastActivityAt ? new Date(stored.lastActivityAt).getTime() : null;
  const freshLast = fresh.lastActivityAt ? new Date(fresh.lastActivityAt).getTime() : null;
  if (storedLast !== freshLast) return false;
  const a = new Set((stored?.canvasserIds || []).map(String));
  const b = new Set((fresh.canvasserIds || []).map(String));
  if (a.size !== b.size) return false;
  for (const id of b) if (!a.has(id)) return false;
  return true;
}

// Sweep every campaign: recompute from the ledgers, report which had drifted, and (when applying)
// write the corrected counters back.
//
// This exists because the hot-path bump is best-effort by construction — the documented
// same-door write race above, plus any ledger edit that bypasses the bump hooks. Drift is SILENT:
// the dashboard card keeps rendering a stale number with no error anywhere, and the only tell is
// that it disagrees with the live per-round table beside it. A campaign that has not drifted costs
// one recompute and no write, so the sweep is safe to run on everything.
//
// Returns per-campaign detail so the CLI can print a dry-run report and the nightly job can log a
// one-line summary, without either re-deriving what "drifted" means.
export async function reconcileAllCampaignStats({ apply = false } = {}) {
  const campaigns = await Campaign.find({}, { name: 1, stats: 1 }).lean();
  const details = [];
  let unseeded = 0;
  let drifted = 0;

  for (const c of campaigns) {
    const fresh = await computeCampaignStats(c._id);
    const seeded = Boolean(c.stats?.reconciledAt);
    const changed = seeded && !sameStats(c.stats, fresh);
    if (!seeded) unseeded += 1;
    else if (changed) drifted += 1;
    if (!seeded || changed) {
      details.push({
        campaignId: String(c._id),
        name: c.name,
        state: seeded ? 'drifted' : 'unseeded',
        fresh,
        diffs: COUNTER_KEYS.filter((k) => (c.stats?.[k] || 0) !== (fresh[k] || 0))
          .map((k) => `${k} ${c.stats?.[k] || 0}→${fresh[k] || 0}`),
      });
    }
    if (apply) await recomputeCampaignStats(c._id);
  }

  return { scanned: campaigns.length, unseeded, drifted, repaired: apply ? campaigns.length : 0, details };
}
