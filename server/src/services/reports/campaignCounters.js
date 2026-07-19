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
//   • RARE ADMIN BULK OPS (re-cut clear-knocks, snapshot restore, bulk-restrict/unrestrict, admin
//     survey delete, demo staging): call `recomputeCampaignStats` after the mutation — a full
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
// the surveyed/lit/refused flags already model. Bulk marks are skipped for the same reason the
// pipeline skips them: a desk-authored bulk restrict is not field work (see aggregations.js).
// Callers MUST project `via` alongside `actionType`, or every bulk mark would look like a walk.
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
  const [activityCount, knockAgg, litDroppedCount, surveyCount, lastRow, canvasserIds] =
    await Promise.all([
      CanvassActivity.countDocuments({ campaignId }),
      // includeRestricted so ONE pass yields both knockCount (unchanged — `knocks` means the same
      // thing in both modes) and restrictedDoorCount. Storing them unconditionally keeps the
      // counters flag-independent: flipping billRestrictedDoors is a read-time decision and must
      // never require a recompute.
      CanvassActivity.aggregate(knocksPipeline({ campaignId }, { includeRestricted: true })),
      CanvassActivity.countDocuments({ campaignId, actionType: 'lit_dropped' }),
      SurveyResponse.countDocuments({ campaignId }),
      CanvassActivity.findOne({ campaignId, ...NOT_BULK }, { timestamp: 1 })
        .sort({ timestamp: -1 })
        .lean(),
      CanvassActivity.distinct('userId', { campaignId, ...NOT_BULK }),
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
