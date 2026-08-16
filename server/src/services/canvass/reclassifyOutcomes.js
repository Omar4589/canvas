import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { Household } from '../../models/Household.js';
import { ReclassifyRun } from '../../models/ReclassifyRun.js';
import { recomputeHouseholdStatus } from './status.js';

// Folding a retired door outcome's HISTORY into another one — "we turned no-soliciting off, now
// make the 412 entries we already recorded read as not-home". Turning an outcome off
// (outcomeToggles.js) only stops FUTURE recording; this is the tool for the past, and it is the
// only thing in the product that rewrites a canvasser's recorded disposition, so every rule below
// exists to keep that rewrite provably harmless and provably reversible.
//
// THE RATE-NEUTRAL TRIO IS THE WHOLE SAFETY ARGUMENT. Only not_home, wrong_address and
// no_soliciting may be a source OR a target. All three are in KNOCK_ACTIONS and none is a
// contact, so for any conversion within the set:
//   • knocks           — unchanged (all three count as one knock each)
//   • contactRate      — unchanged (numerator is surveyed + refused; none of the trio is either)
//   • connectionRate   — unchanged (numerator is surveyed + lit; likewise)
//   • billableDoors    — unchanged (knock-based; restricted is the only door-not-knock and is out)
//   • Campaign.stats   — unchanged (no counter keys on these three individually: knockCount and
//                        activityCount cover all of them, the rest count surveys/lit/refused/
//                        restricted — verified against models/Campaign.js, not assumed)
// So no invoice figure and no headline rate can move. `refused` and `restricted` are excluded
// FOREVER for the mirror-image reason: refused is a contact (it would move contactRate) and
// restricted is a billable non-knock (it would move the invoice). reclassifyOutcomes.int.test.js
// asserts the money invariant byte-for-byte rather than trusting this paragraph.
//
// WHAT CHANGES: actionType, and door status downstream of it (statusPrecedence maps each outcome
// to its own status). GPS, timestamp, canvasser, pass, turf, effort, coordinator and `replaced`
// are all preserved — this is a re-labelling, never a re-recording.
export const RECLASSIFIABLE_OUTCOMES = Object.freeze(['not_home', 'wrong_address', 'no_soliciting']);

// Households are re-statused one at a time (recomputeHouseholdStatus re-reads that door's rows),
// so the only unbounded thing is the id list — chunked here rather than held as one array.
const STATUS_CHUNK = 500;

/** Rows this tool may still touch: never a bulk desk mark, never an already-stamped row. */
const convertibleMatch = (campaignId, actionType) => ({
  campaignId,
  actionType,
  via: { $ne: 'bulk' },
  reclassified: { $exists: false },
});

/** { entries, doors } for one source outcome — the numbers the confirm step shows. */
export async function countConvertible(campaignId, from) {
  const match = convertibleMatch(campaignId, from);
  const [entries, doorAgg] = await Promise.all([
    CanvassActivity.countDocuments(match),
    CanvassActivity.aggregate([
      { $match: match },
      { $group: { _id: '$householdId' } },
      { $count: 'doors' },
    ]),
  ]);
  return { entries, doors: doorAgg[0]?.doors || 0 };
}

/**
 * Which outcomes this campaign may currently fold, and what each would move.
 *
 * A source must be rate-neutral AND currently switched off: the tool is offered for outcomes a
 * campaign has RETIRED, never as a way to edit live history. Zero-entry sources are dropped —
 * an admin should not be offered a button that would convert nothing.
 */
export async function eligibleSources(campaign) {
  const disabled = new Set(campaign.disabledOutcomes || []);
  const out = {};
  for (const outcome of RECLASSIFIABLE_OUTCOMES) {
    if (!disabled.has(outcome)) continue;
    const counts = await countConvertible(campaign._id, outcome);
    if (counts.entries > 0) out[outcome] = counts;
  }
  return out;
}

/** Legal targets: rate-neutral, still switched ON, and not the source itself. */
export function eligibleTargets(campaign, from = null) {
  const disabled = new Set(campaign.disabledOutcomes || []);
  return RECLASSIFIABLE_OUTCOMES.filter((o) => !disabled.has(o) && o !== from);
}

/**
 * Validate a requested pair against the campaign. Returns null when legal, else
 * { status, body } ready to send — the router stays a thin shell over this.
 */
export function validatePair(campaign, from, to) {
  if (!RECLASSIFIABLE_OUTCOMES.includes(from) || !RECLASSIFIABLE_OUTCOMES.includes(to)) {
    return {
      status: 400,
      body: {
        error:
          'Only not-home, wrong-address and no-soliciting entries can be reclassified — the outcomes that carry no rate or billing meaning of their own.',
        code: 'OUTCOME_NOT_RECLASSIFIABLE',
      },
    };
  }
  if (from === to) {
    return { status: 400, body: { error: 'Pick two different outcomes.', code: 'OUTCOME_SAME' } };
  }
  const disabled = new Set(campaign.disabledOutcomes || []);
  if (!disabled.has(from)) {
    return {
      status: 400,
      body: {
        error: 'Turn this outcome off for the campaign before folding its history into another one.',
        code: 'SOURCE_NOT_DISABLED',
      },
    };
  }
  if (disabled.has(to)) {
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

/** Re-resolve door status for every household touched by a run, in bounded chunks. */
async function restatusRun(runId, campaignType) {
  const cursor = CanvassActivity.aggregate([
    { $match: { 'reclassified.runId': runId } },
    { $group: { _id: '$householdId' } },
  ]).cursor();

  let chunk = [];
  const flush = async () => {
    if (!chunk.length) return;
    const households = await Household.find({ _id: { $in: chunk } });
    for (const hh of households) {
      await recomputeHouseholdStatus(hh, campaignType);
      await hh.save();
    }
    chunk = [];
  };
  for await (const row of cursor) {
    chunk.push(row._id);
    if (chunk.length >= STATUS_CHUNK) await flush();
  }
  await flush();
}

/** Same, for a list of ids already collected (the revert path, where the stamp is gone). */
async function restatusIds(householdIds, campaignType) {
  for (let i = 0; i < householdIds.length; i += STATUS_CHUNK) {
    const households = await Household.find({ _id: { $in: householdIds.slice(i, i + STATUS_CHUNK) } });
    for (const hh of households) {
      await recomputeHouseholdStatus(hh, campaignType);
      await hh.save();
    }
  }
}

/**
 * Convert every convertible `from` row on this campaign to `to`.
 *
 * ORDER: rows are stamped FIRST, then the ReclassifyRun row is written — the same rule
 * CampaignChange follows in routes/admin/campaigns.js ("a row here must mean this change
 * landed"). The runId is minted up front so the stamp can carry it. The narrow failure window is
 * deliberate and the safe direction: a run doc that fails to insert leaves correctly-converted
 * rows that simply aren't listed (and still carry `from`, so nothing is lost), whereas writing the
 * run first would offer a Revert for a conversion that never happened.
 */
export async function runReclassify({ campaign, from, to, byUserId }) {
  const runId = new mongoose.Types.ObjectId();
  const { entries, doors } = await countConvertible(campaign._id, from);

  await CanvassActivity.updateMany(convertibleMatch(campaign._id, from), {
    $set: {
      actionType: to,
      reclassified: { from, at: new Date(), byUserId: byUserId || null, runId },
    },
  });

  const run = await ReclassifyRun.create({
    _id: runId,
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    from,
    to,
    count: entries,
    doorCount: doors,
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

  await restatusRun(runId, campaign.type);
  return run;
}

/**
 * Undo one run: restore each stamped row's original actionType and drop the stamp.
 *
 * Exact by construction — a run has exactly one `from`, and only rows this run stamped carry its
 * runId, so the restore is a single updateMany with no guesswork. Household ids are collected
 * BEFORE the unset, because the stamp is what identifies them.
 */
export async function revertReclassify({ campaign, run, byUserId }) {
  const affected = await CanvassActivity.aggregate([
    { $match: { 'reclassified.runId': run._id } },
    { $group: { _id: '$householdId' } },
  ]);
  const householdIds = affected.map((r) => r._id);

  await CanvassActivity.updateMany(
    { 'reclassified.runId': run._id },
    { $set: { actionType: run.from }, $unset: { reclassified: '' } }
  );

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

  await restatusIds(householdIds, campaign.type);
  return run;
}
