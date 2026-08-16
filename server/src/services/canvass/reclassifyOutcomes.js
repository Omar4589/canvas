import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { Household } from '../../models/Household.js';
import { ReclassifyRun } from '../../models/ReclassifyRun.js';
import { recomputeHouseholdStatusesBatched } from './status.js';
import { knocksPipeline, billableDoorsOf, contactRate, connectionRate } from '../reports/aggregations.js';
import { recomputeCampaignStats } from '../reports/campaignCounters.js';

// Rewriting what a door entry SAYS happened — the Door Outcomes page.
//
// Two different acts share this machinery, and the difference matters:
//   • CORRECTION — "the canvasser hit the wrong button; this door was really Refused." The
//     numbers were wrong before, so moving them is the POINT.
//   • FOLDING — "we retired No soliciting; make its history read Not home." The entries were
//     TRUE, so moving a reported number would be fabrication.
// The product doesn't ask which one you meant. Instead every conversion is priced before it
// runs (computeImpact) and the confirm step states the effect in the campaign's own numbers, so
// a fold that would quietly move an invoice is impossible to perform by accident.
//
// WHAT CHANGES: actionType, and door status downstream of it (statusPrecedence maps each outcome
// to its own status). GPS, timestamp, canvasser, pass, turf, effort, coordinator and `replaced`
// are all preserved — this is a re-labelling, never a re-recording. Every run is stamped,
// listed, and revertible.

// The five DOOR outcomes. Completion actions (`survey_submitted`, `lit_dropped`) are absent and
// must stay absent: a surveyed entry owns a real SurveyResponse, so converting INTO it fabricates
// answers that were never given and converting OUT of it orphans answers that were. That is a
// data-integrity rule, not a policy choice — it is not togglable by anyone.
export const RECLASSIFIABLE_OUTCOMES = Object.freeze([
  'not_home',
  'wrong_address',
  'refused',
  'no_soliciting',
  'restricted',
]);

// The three that are interchangeable ARITHMETIC: each is exactly one knock and none is a contact,
// so any conversion among them provably moves nothing — not knocks, not contactRate (numerator is
// surveyed + refused), not connectionRate (surveyed + lit), not billableDoors, and no
// Campaign.stats counter (no key counts these three individually — verified against
// models/Campaign.js). A pair inside this set skips both the impact simulation and the counter
// recompute below, which is also what keeps a whole-outcome fold unbounded.
//
// `refused` and `restricted` are the mirror image: refused IS a contact and restricted is a
// billable non-knock, so any pair touching them moves a reported number. They are allowed —
// a wrong button deserves a real fix — but always priced first, and never silently.
export const RATE_NEUTRAL_OUTCOMES = Object.freeze(['not_home', 'wrong_address', 'no_soliciting']);

// A 'mixed' source (one run spanning several outcomes) is deliberately NOT neutral: the safe
// answer when the origin isn't a single known outcome is to price it and recompute counters.
export const isRateNeutralPair = (from, to) =>
  RATE_NEUTRAL_OUTCOMES.includes(from) && RATE_NEUTRAL_OUTCOMES.includes(to);

// A money-moving conversion is capped: it simulates over the campaign's ledger and recomputes
// counters afterwards, so it is the one path whose cost scales with the SELECTION rather than
// with a stamped-row cursor. 25k is far above any plausible correction and far below anything
// that would threaten the request budget. Rate-neutral folds are deliberately uncapped.
export const RECLASSIFY_MAX_IMPACT_ENTRIES = 25000;

/** Rows this tool may still touch: never a bulk desk mark, never an already-stamped row. */
const convertibleMatch = (campaignId, actionType) => ({
  campaignId,
  ...(actionType ? { actionType } : { actionType: { $in: RECLASSIFIABLE_OUTCOMES } }),
  // Desk-authored restricted marks are not field observations: converting one into a knock would
  // invent a walk that never happened, attributed to the admin who ran the bulk tool. They have
  // their own undo already (unrestrict-bulk on Turf Cutting).
  via: { $ne: 'bulk' },
  // Provenance stays SINGLE-LEVEL so revert is exact: a row already carrying a stamp is out of
  // scope until its run is reverted.
  reclassified: { $exists: false },
});

/** { entries, doors } for one source outcome — the numbers the confirm step shows. */
export async function countConvertible(campaignId, from) {
  const match = convertibleMatch(campaignId, from);
  const [entries, doorAgg] = await Promise.all([
    CanvassActivity.countDocuments(match),
    CanvassActivity.aggregate([{ $match: match }, { $group: { _id: '$householdId' } }, { $count: 'doors' }]),
  ]);
  return { entries, doors: doorAgg[0]?.doors || 0 };
}

/**
 * The App Customization card's shortcut list: outcomes this campaign has RETIRED that still have
 * history. Deliberately narrower than what the Door Outcomes page offers — the card exists for
 * the "I turned this off, now fold it in" follow-up, and only rate-neutral folds are safe to
 * offer as a one-click action with no impact review.
 */
export async function eligibleSources(campaign) {
  const disabled = new Set(campaign.disabledOutcomes || []);
  const out = {};
  for (const outcome of RATE_NEUTRAL_OUTCOMES) {
    if (!disabled.has(outcome)) continue;
    const counts = await countConvertible(campaign._id, outcome);
    if (counts.entries > 0) out[outcome] = counts;
  }
  return out;
}

/** Card targets: rate-neutral, still switched ON, and not the source itself. */
export function eligibleTargets(campaign, from = null) {
  const disabled = new Set(campaign.disabledOutcomes || []);
  return RATE_NEUTRAL_OUTCOMES.filter((o) => !disabled.has(o) && o !== from);
}

/**
 * Validate a requested pair. Returns null when legal, else { status, body } ready to send.
 *
 * The source no longer has to be switched off (owner ruling 2026-08-16 — the Door Outcomes page
 * is explicit enough on its own; requiring a toggle first made correcting a live campaign's
 * mistyped entry impossible). The TARGET still may not be a retired outcome: moving history INTO
 * something the campaign has stopped recording contradicts the retirement.
 */
export function validatePair(campaign, from, to) {
  if (!RECLASSIFIABLE_OUTCOMES.includes(from) || !RECLASSIFIABLE_OUTCOMES.includes(to)) {
    return {
      status: 400,
      body: {
        error:
          'Only door outcomes can be reclassified. Surveyed and lit-dropped entries carry recorded survey data, so they can never be converted.',
        code: 'OUTCOME_NOT_RECLASSIFIABLE',
      },
    };
  }
  if (from === to) {
    return { status: 400, body: { error: 'Pick two different outcomes.', code: 'OUTCOME_SAME' } };
  }
  if (new Set(campaign.disabledOutcomes || []).has(to)) {
    return {
      status: 400,
      body: {
        error: 'That outcome is switched off for this campaign — pick one canvassers can still record.',
        code: 'TARGET_DISABLED',
      },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The entries browser
// ---------------------------------------------------------------------------

/**
 * Mongo filter for the page's table and for a filter-scoped run. Every field is optional; the
 * campaign scope and the two provenance rules are not.
 */
export function buildEntryFilter(campaignId, q = {}) {
  const filter = convertibleMatch(campaignId, null);
  if (q.outcomes?.length) filter.actionType = { $in: q.outcomes.filter((o) => RECLASSIFIABLE_OUTCOMES.includes(o)) };
  if (q.userId) filter.userId = new mongoose.Types.ObjectId(q.userId);
  if (q.passId) filter.passId = new mongoose.Types.ObjectId(q.passId);
  if (q.effortId) filter.effortId = new mongoose.Types.ObjectId(q.effortId);
  if (q.from || q.to) {
    filter.timestamp = {};
    if (q.from) filter.timestamp.$gte = new Date(q.from);
    if (q.to) filter.timestamp.$lte = new Date(q.to);
  }
  return filter;
}

/** One page of entries plus the per-outcome totals for the whole filtered set. */
export async function listEntries(campaignId, q = {}, { skip = 0, limit = 50 } = {}) {
  const filter = buildEntryFilter(campaignId, q);
  const [rows, total, facets] = await Promise.all([
    CanvassActivity.find(filter, {
      householdId: 1, actionType: 1, userId: 1, timestamp: 1, passId: 1, distanceFromHouseMeters: 1,
    })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CanvassActivity.countDocuments(filter),
    CanvassActivity.aggregate([
      // Facet counts ignore the outcome chips (you need to see what ELSE is there to pick it),
      // but honor every other filter.
      { $match: buildEntryFilter(campaignId, { ...q, outcomes: [] }) },
      { $group: { _id: '$actionType', n: { $sum: 1 } } },
    ]),
  ]);

  const doorIds = [...new Set(rows.map((r) => String(r.householdId)))];
  const doors = await Household.find(
    { _id: { $in: doorIds } },
    { addressLine1: 1, unit: 1, city: 1 }
  ).lean();
  const doorById = new Map(doors.map((d) => [String(d._id), d]));

  return {
    entries: rows.map((r) => {
      const d = doorById.get(String(r.householdId));
      return {
        id: String(r._id),
        householdId: String(r.householdId),
        address: d ? [d.addressLine1, d.unit ? `#${d.unit}` : null].filter(Boolean).join(' ') : '(door removed)',
        city: d?.city || '',
        actionType: r.actionType,
        userId: r.userId ? String(r.userId) : null,
        passId: r.passId ? String(r.passId) : null,
        timestamp: r.timestamp,
      };
    }),
    total,
    facets: Object.fromEntries(facets.map((f) => [f._id, f.n])),
  };
}

/**
 * Turn a request's scope into the exact activity ids a run would touch.
 *
 * `actionIds` may only NARROW the filter — ids outside it are dropped rather than written, the
 * same rule the flag bulk-review uses, so a stale checkbox can never reach a row the admin's
 * current filter doesn't show.
 */
export async function resolveSelection(campaignId, q = {}, actionIds = null) {
  const filter = buildEntryFilter(campaignId, q);
  if (actionIds?.length) {
    filter._id = { $in: actionIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
  }
  const rows = await CanvassActivity.find(filter, { householdId: 1, actionType: 1 }).lean();
  return {
    ids: rows.map((r) => r._id),
    householdIds: [...new Set(rows.map((r) => String(r.householdId)))].map((s) => new mongoose.Types.ObjectId(s)),
    entries: rows.length,
    doors: new Set(rows.map((r) => String(r.householdId))).size,
    sources: [...new Set(rows.map((r) => r.actionType))],
  };
}

// ---------------------------------------------------------------------------
// Pricing a conversion
// ---------------------------------------------------------------------------

const totalsOf = (row, billRestricted) => ({
  knocks: row?.knocks || 0,
  billableDoors: billableDoorsOf(row || {}, billRestricted),
  restrictedDoors: row?.restrictedDoors || 0,
  contactRate: contactRate(row || {}),
  connectionRate: connectionRate(row || {}),
});

/**
 * What this conversion would do to the campaign's reported numbers.
 *
 * The "after" figures come out of the SAME knocksPipeline that produces the "before" ones, with
 * a `$set` ahead of it rewriting actionType for exactly the selected rows — a simulation through
 * the production aggregation rather than a parallel formula that could drift from it. The int
 * test asserts the previewed "after" equals the real totals once the run lands, so a divergence
 * fails the build instead of quietly misinforming an admin.
 *
 * Skipped entirely for a rate-neutral pair: the answer is provably "nothing moves", and running
 * a full-ledger simulation to rediscover that would put a scan in front of the common fold.
 */
export async function computeImpact({ campaign, ids, to, billRestricted }) {
  const campaignId = campaign._id;
  const opts = { includeRestricted: true };
  const [beforeRow] = await CanvassActivity.aggregate(knocksPipeline({ campaignId }, opts));
  const [afterRow] = await CanvassActivity.aggregate([
    { $match: { campaignId } },
    { $set: { actionType: { $cond: [{ $in: ['$_id', ids] }, to, '$actionType'] } } },
    ...knocksPipeline({ campaignId }, opts),
  ]);
  const before = totalsOf(beforeRow, billRestricted);
  const after = totalsOf(afterRow, billRestricted);
  return {
    before,
    after,
    moves: Object.keys(before).some((k) => before[k] !== after[k]),
  };
}

// ---------------------------------------------------------------------------
// Running and reverting
// ---------------------------------------------------------------------------

/** Households touched by a run, read off the stamp (the run's own record of what it changed). */
async function householdsOfRun(runId) {
  const rows = await CanvassActivity.aggregate([
    { $match: { 'reclassified.runId': runId } },
    { $group: { _id: '$householdId' } },
  ]);
  return rows.map((r) => r._id);
}

/**
 * Convert a selection to `to`.
 *
 * Pass `ids` for a scoped run (the Door Outcomes page) or `from` alone for a whole-outcome fold
 * (the App Customization card) — the fold stays id-free so it is unbounded.
 *
 * ORDER: rows are stamped FIRST, then the ReclassifyRun row is written — the same rule
 * CampaignChange follows in routes/admin/campaigns.js ("a row here must mean this change
 * landed"). The runId is minted up front so the stamp can carry it. The narrow failure window is
 * deliberate and the safe direction: a run doc that fails to insert leaves correctly-converted
 * rows that simply aren't listed (and still carry `from`, so nothing is lost), whereas writing
 * the run first would offer a Revert for a conversion that never happened.
 */
export async function runReclassify({ campaign, from, to, ids = null, byUserId }) {
  const runId = new mongoose.Types.ObjectId();
  const scoped = Array.isArray(ids);
  const match = scoped
    ? { ...convertibleMatch(campaign._id, null), _id: { $in: ids } }
    : convertibleMatch(campaign._id, from);

  // Counted BEFORE the write: afterwards the rows no longer match `from`.
  const doorIds = scoped
    ? null
    : (await CanvassActivity.aggregate([{ $match: match }, { $group: { _id: '$householdId' } }])).map((r) => r._id);
  const entries = scoped ? ids.length : await CanvassActivity.countDocuments(match);

  // `from` is per-ROW on a scoped run: a mixed selection (some not-home, some refused) is one
  // run, and each row remembers its own origin so revert restores every one of them correctly.
  await CanvassActivity.updateMany(match, [
    {
      $set: {
        reclassified: { from: '$actionType', at: new Date(), byUserId: byUserId || null, runId },
        actionType: to,
      },
    },
  ]);

  const affected = scoped ? await householdsOfRun(runId) : doorIds;

  const run = await ReclassifyRun.create({
    _id: runId,
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    from,
    to,
    count: entries,
    doorCount: affected.length,
    byUserId: byUserId || null,
  });

  await CampaignChange.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    field: 'outcomeReclassify',
    fromValue: from,
    toValue: to,
    byUserId: byUserId || null,
    source: 'outcome_reclassify',
  });

  await recomputeHouseholdStatusesBatched(affected, campaign.type);
  // Only a money-moving pair can shift a denormalized counter; a rate-neutral fold provably
  // cannot, and re-aggregating the whole ledger to confirm that would be the slowest part of
  // the common case.
  if (!isRateNeutralPair(from, to)) await recomputeCampaignStats(campaign._id);
  return run;
}

/**
 * Undo one run: restore each stamped row's original actionType and drop the stamp.
 *
 * Exact by construction — only rows this run stamped carry its runId, and each carries the
 * outcome IT had, so a mixed selection reverts correctly. Household ids are collected BEFORE
 * the unset, because the stamp is what identifies them.
 */
export async function revertReclassify({ campaign, run, byUserId }) {
  const householdIds = await householdsOfRun(run._id);

  await CanvassActivity.updateMany({ 'reclassified.runId': run._id }, [
    { $set: { actionType: '$reclassified.from' } },
    { $unset: 'reclassified' },
  ]);

  run.revertedAt = new Date();
  await run.save();

  // Swapped on purpose: the feed reads left-to-right, so a revert says to → from.
  await CampaignChange.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    field: 'outcomeReclassify',
    fromValue: run.to,
    toValue: run.from,
    byUserId: byUserId || null,
    source: 'outcome_reclassify',
  });

  await recomputeHouseholdStatusesBatched(householdIds, campaign.type);
  if (!isRateNeutralPair(run.from, run.to)) await recomputeCampaignStats(campaign._id);
  return run;
}
