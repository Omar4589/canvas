import { Household } from '../../models/Household.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Campaign } from '../../models/Campaign.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { FlagReview } from '../../models/FlagReview.js';
import { deriveSetupSteps } from './setupSteps.js';
import { AUDIT_WINDOW_MAX_DAYS } from '../audit/flagThresholds.js';
import { NEEDS_PIN_FIX } from '../households/confirmHouseholdLocation.js';

// One round-trip of cheap grouped counts for a set of campaigns, turned into the
// per-campaign setup-progress + management state used by the campaigns list, the
// Overview rollup, and (via deriveSetupSteps) the dashboard hub. Single source of
// truth so every surface agrees.
//
// `campaigns`: array of lean docs with at least { _id, type, surveyTemplateId, name }.
// Returns Map<campaignIdStr, { setupComplete, stepsDone, stepsTotal, nextStepKey,
//   hasCanvassed, deletable, canEditType, openMockFlags }>.
export async function campaignSummaries({ organizationId, campaigns }) {
  const ids = campaigns.map((c) => c._id);
  const out = new Map();
  if (!ids.length) return out;

  const group = { $group: { _id: '$campaignId', n: { $sum: 1 } } };
  const [households, owned, passes, publishedTurfs, assignments, activePasses, statDocs, mockRows, pinsToFix] =
    await Promise.all([
      Household.aggregate([{ $match: { organizationId, campaignId: { $in: ids }, isActive: true } }, group]),
      Household.aggregate([{ $match: { organizationId, campaignId: { $in: ids }, isActive: true, effortId: { $ne: null } } }, group]),
      Pass.aggregate([{ $match: { campaignId: { $in: ids } } }, group]),
      Turf.aggregate([{ $match: { campaignId: { $in: ids }, status: 'published' } }, group]),
      TurfAssignment.aggregate([{ $match: { campaignId: { $in: ids } } }, group]),
      Pass.aggregate([{ $match: { campaignId: { $in: ids }, status: 'active' } }, group]),
      // hasCanvassed comes from the maintained Campaign.stats counters (one tiny Campaign read,
      // zero ledger queries). It gates delete/edit, so untrusted stats are never used —
      // unseeded legacy docs (stats.reconciledAt null, pre-migrate:campaign-stats) fall back to
      // the indexed existence distincts below.
      Campaign.find(
        { _id: { $in: ids } },
        { 'stats.activityCount': 1, 'stats.surveyCount': 1, 'stats.reconciledAt': 1 }
      ).lean(),
      // Open mock-GPS flags for the nudge badge. Window = AUDIT_WINDOW_MAX_DAYS − 1: a
      // strict subset of the range the dashboard's "Review in Audit" deep link seeds, so
      // the badge can never count an entry the clicked-through page doesn't show.
      // via:'bulk' rows are invisible to the detector (flagDetection.js scanFilter), so
      // they're excluded here too. Served by the partial {campaignId, 'location.mocked'}
      // index (mocked-only rows); the timestamp bound filters the tiny matched set.
      CanvassActivity.find(
        {
          campaignId: { $in: ids },
          'location.mocked': true,
          via: { $ne: 'bulk' },
          timestamp: { $gte: new Date(Date.now() - (AUDIT_WINDOW_MAX_DAYS - 1) * 24 * 60 * 60 * 1000) },
        },
        '_id campaignId'
      ).lean(),
      // Approximate pins awaiting a fix or confirm (the Pin Fixes nav badge). A live derived
      // count, deliberately NOT a Campaign.stats counter — stats' nightly reconcile reads only
      // the activity/survey ledgers and could never repair drift in a Household field-state
      // number. Shares NEEDS_PIN_FIX verbatim with the list endpoint so badge === list. Served
      // by the partial {campaignId, locationConfirmedAt} interpolated-only index — strictly
      // smaller than the two full-universe Household aggregates above.
      Household.aggregate([{ $match: { organizationId, campaignId: { $in: ids }, ...NEEDS_PIN_FIX } }, group]),
    ]);

  const canvassedByStats = new Map(); // idStr → boolean, trusted stats only
  const unseeded = [];
  for (const d of statDocs) {
    if (d.stats?.reconciledAt) {
      canvassedByStats.set(String(d._id), (d.stats.activityCount || 0) > 0 || (d.stats.surveyCount || 0) > 0);
    } else {
      unseeded.push(d._id);
    }
  }
  let canvassedSet = new Set();
  let respondedSet = new Set();
  if (unseeded.length) {
    const [canvassedIds, respondedIds] = await Promise.all([
      CanvassActivity.distinct('campaignId', { campaignId: { $in: unseeded } }),
      SurveyResponse.distinct('campaignId', { campaignId: { $in: unseeded } }),
    ]);
    canvassedSet = new Set(canvassedIds.map(String));
    respondedSet = new Set(respondedIds.map(String));
  }

  // open = mocked rows with NO FlagReview decision (absence of a record IS 'open' — see
  // models/FlagReview.js). actionModel is in the filter ON PURPOSE so the unique compound
  // index {organizationId, actionModel, actionId} serves the lookup. Skipped entirely in
  // the common case (honest orgs have zero mock rows).
  const openMockBy = new Map();
  if (mockRows.length) {
    const reviews = await FlagReview.find(
      { organizationId, actionModel: 'CanvassActivity', actionId: { $in: mockRows.map((r) => r._id) } },
      'actionId'
    ).lean();
    const reviewedSet = new Set(reviews.map((r) => String(r.actionId)));
    for (const r of mockRows) {
      if (reviewedSet.has(String(r._id))) continue;
      const k = String(r.campaignId);
      openMockBy.set(k, (openMockBy.get(k) || 0) + 1);
    }
  }

  const map = (agg) => new Map(agg.map((r) => [String(r._id), r.n]));
  const householdsBy = map(households);
  const ownedBy = map(owned);
  const passesBy = map(passes);
  const pubTurfBy = map(publishedTurfs);
  const assignBy = map(assignments);
  const activeBy = map(activePasses);
  const pinsToFixBy = map(pinsToFix);

  for (const campaign of campaigns) {
    const k = String(campaign._id);
    const hh = householdsBy.get(k) || 0;
    const ownedDoors = ownedBy.get(k) || 0;
    const hasCanvassed = canvassedByStats.has(k)
      ? canvassedByStats.get(k)
      : canvassedSet.has(k) || respondedSet.has(k);
    const setup = deriveSetupSteps({
      campaign,
      counts: {
        households: hh,
        ownedDoors,
        intakeDoors: Math.max(0, hh - ownedDoors),
        passes: passesBy.get(k) || 0,
        publishedTurfs: pubTurfBy.get(k) || 0,
        assignments: assignBy.get(k) || 0,
        activePasses: activeBy.get(k) || 0,
      },
    });
    out.set(k, {
      setupComplete: setup.complete,
      stepsDone: setup.stepsDone,
      stepsTotal: setup.stepsTotal,
      nextStepKey: setup.nextStepKey,
      hasCanvassed,
      deletable: !hasCanvassed,
      canEditType: !hasCanvassed,
      openMockFlags: openMockBy.get(k) || 0,
      pinsToFix: pinsToFixBy.get(k) || 0,
    });
  }
  return out;
}

// Open (unreviewed) mock-GPS flags for ONE campaign over an explicit timestamp filter —
// the single-campaign sibling of the openMockFlags nudge above, used by the client-report
// soft publish gate (routes/admin/clientReports.js: the report's cumulative window,
// { $lt: rangeEndUtc }). Same contract: mocked rows, via ≠ bulk (invisible to the
// detector), open = no FlagReview row. Served by the partial {campaignId,
// 'location.mocked'} index, so the unbounded lower edge stays cheap. Note the gate
// counts the FULL window while the Audit deep link can only seed 62 days — a >62-day-old
// unreviewed mock flag is counted here but won't show on the linked page (it was nudged
// in prior weeks); bound the $gte here if that ever bites.
export async function countOpenMockFlags({ organizationId, campaignId, timestamp }) {
  const rows = await CanvassActivity.find(
    { campaignId, 'location.mocked': true, via: { $ne: 'bulk' }, ...(timestamp ? { timestamp } : {}) },
    '_id'
  ).lean();
  if (!rows.length) return 0;
  const reviews = await FlagReview.find(
    { organizationId, actionModel: 'CanvassActivity', actionId: { $in: rows.map((r) => r._id) } },
    'actionId'
  ).lean();
  const reviewed = new Set(reviews.map((r) => String(r.actionId)));
  return rows.filter((r) => !reviewed.has(String(r._id))).length;
}
