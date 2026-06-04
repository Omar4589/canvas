import { UnrecoverableError } from 'bullmq';
import { ImportJob } from '../../models/ImportJob.js';
import { Campaign } from '../../models/Campaign.js';
import { loadRawImport, deleteRawImport } from './rawImportStore.js';
import { parseAndValidate, applyImport } from './csvImporter.js';
import { recomputeCutAttributesForCampaign } from '../turf/computeCutAttributes.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { recomputeFullyVoted } from '../voted/recomputeFullyVoted.js';
import { reapplyVotedLists } from '../voted/reapplyVotedLists.js';
import { recomputeHouseholdActive } from './recomputeHouseholdActive.js';

// BullMQ processor for the `import-queue`. Idempotent: household upserts on
// {campaignId, normalizedAddress} and voter upserts on {organizationId,
// stateVoterId} converge on retry, and counts are computed by diff.
export async function processImportJob(job) {
  const { importJobId } = job.data;
  const importJob = await ImportJob.findById(importJobId);
  if (!importJob) throw new UnrecoverableError(`ImportJob ${importJobId} not found`);

  const campaign = await Campaign.findById(importJob.campaignId);
  if (!campaign) {
    await ImportJob.updateOne(
      { _id: importJobId },
      { status: 'failed', errors: [{ reason: 'Campaign not found' }], errorCount: 1, completedAt: new Date() }
    );
    throw new UnrecoverableError('Campaign not found');
  }
  const orgId = campaign.organizationId;

  await ImportJob.updateOne(
    { _id: importJobId },
    { status: 'parsing', startedAt: new Date(), progress: 0, queueJobId: String(job.id) }
  );

  try {
    const buffer = await loadRawImport(importJobId);
    const csv = buffer.toString('utf8');
    const { totalRows, errors, validRows, householdMap, dupSvids } = parseAndValidate(
      csv,
      importJob.fieldMapping || {}
    );

    // Re-housing audit: capture each incoming voter's CURRENT household BEFORE the
    // upsert reassigns it, so we can detect moves + emptied doors afterward.
    const svids = validRows.map((r) => r.voter.stateVoterId);
    const priorVoters = await Voter.find(
      { organizationId: orgId, stateVoterId: { $in: svids } },
      { stateVoterId: 1, householdId: 1 }
    ).lean();
    const priorHhBySvid = new Map(
      priorVoters.map((v) => [v.stateVoterId, v.householdId ? String(v.householdId) : null])
    );
    // Source doors = where the incoming voters live now (pre-apply). Persist once so a
    // BullMQ retry — which re-reads post-move state — still re-checks the right doors.
    let sourceHhIds = (importJob.sourceHouseholdIds || []).map(String);
    if (!sourceHhIds.length) {
      sourceHhIds = [...new Set(priorVoters.map((v) => v.householdId).filter(Boolean).map(String))];
      if (sourceHhIds.length) {
        await ImportJob.updateOne({ _id: importJobId }, { $set: { sourceHouseholdIds: sourceHhIds } });
      }
    }

    const counts = await applyImport({
      campaign,
      orgId,
      validRows,
      householdMap,
      batchSize: 2000,
      onProgress: async ({ phase, processed, total }) => {
        const pct = total ? Math.round((processed / total) * 100) : 100;
        // Households fill 0-50%, voters 50-100%.
        const overall = phase === 'households' ? Math.round(pct / 2) : 50 + Math.round(pct / 2);
        await job.updateProgress(overall);
        await ImportJob.updateOne({ _id: importJobId }, { progress: overall, processedRows: processed });
      },
    });

    // Persist the net-new doc ids for "undo import" — only once. A BullMQ retry's
    // idempotent upsert inserts nothing (empty lists), so don't overwrite a prior capture.
    if (
      !importJob.insertedHouseholdIds?.length &&
      !importJob.insertedVoterIds?.length &&
      (counts.insertedHouseholdIds?.length || counts.insertedVoterIds?.length)
    ) {
      await ImportJob.updateOne(
        { _id: importJobId },
        {
          $set: {
            insertedHouseholdIds: counts.insertedHouseholdIds || [],
            insertedVoterIds: counts.insertedVoterIds || [],
          },
        }
      );
    }

    // Denormalize cut attributes onto households (modal voter value + conflict
    // flags) so attribute-cut turf generation can group by them.
    await recomputeCutAttributesForCampaign(campaign._id);

    // Early voting (sticky): first re-apply prior voted-list ids to voters that have only now
    // been imported, then recompute fullyVoted for those doors plus any currently-dropped door.
    // Net effect: a genuinely-new un-voted voter re-opens its door, but a voter who was already on
    // a voted list stays marked — so the door doesn't wrongly re-open, and brand-new all-voted
    // households drop.
    const { householdIds: reappliedHh } = await reapplyVotedLists(campaign._id);
    const droppedDoors = await Household.find({ campaignId: campaign._id, fullyVoted: true }).distinct('_id');
    const toRecompute = [...new Set([...droppedDoors.map(String), ...reappliedHh])];
    if (toRecompute.length) await recomputeFullyVoted(campaign._id, toRecompute);

    // Re-house cleanup: count voters that changed doors, then deactivate doors this
    // import emptied (and reactivate any refilled) — bounded to the touched households.
    const postVoters = await Voter.find(
      { organizationId: orgId, stateVoterId: { $in: svids } },
      { stateVoterId: 1, householdId: 1 }
    ).lean();
    let movedVoters = 0;
    for (const v of postVoters) {
      const prior = priorHhBySvid.get(v.stateVoterId);
      if (prior && prior !== String(v.householdId)) movedVoters += 1;
    }
    const destHouseholds = await Household.find(
      { campaignId: campaign._id, normalizedAddress: { $in: [...householdMap.keys()] } },
      { _id: 1 }
    ).lean();
    const touchedHhIds = [...new Set([...sourceHhIds, ...destHouseholds.map((h) => String(h._id))])];
    const { deactivated: deactivatedDoors } = await recomputeHouseholdActive(campaign._id, touchedHhIds);

    await ImportJob.updateOne(
      { _id: importJobId },
      {
        $set: {
          status: 'completed',
          totalRows,
          uniqueVoters: counts.uniqueVoters,
          uniqueHouseholds: counts.uniqueHouseholds,
          newVoters: counts.newVoters,
          updatedVoters: counts.updatedVoters,
          newHouseholds: counts.newHouseholds,
          duplicateStateVoterIds: Array.from(dupSvids),
          errors: errors.slice(0, 100),
          errorCount: errors.length,
          processedRows: totalRows,
          progress: 100,
          completedAt: new Date(),
        },
        // A retry recomputes these as 0 (voters already moved) — $max keeps the real
        // first-attempt counts so the audit trail never regresses.
        $max: { movedVoters, deactivatedDoors },
      }
    );

    await deleteRawImport(importJobId).catch(() => {});
    return { ok: true, importJobId: String(importJobId), newVoters: counts.newVoters };
  } catch (err) {
    await ImportJob.updateOne(
      { _id: importJobId },
      { status: 'failed', errors: [{ reason: err.message }], errorCount: 1, completedAt: new Date() }
    );
    throw err; // retried per the queue's backoff policy
  }
}
