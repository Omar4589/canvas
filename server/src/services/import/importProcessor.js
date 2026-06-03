import { UnrecoverableError } from 'bullmq';
import { ImportJob } from '../../models/ImportJob.js';
import { Campaign } from '../../models/Campaign.js';
import { loadRawImport, deleteRawImport } from './rawImportStore.js';
import { parseAndValidate, applyImport } from './csvImporter.js';
import { recomputeCutAttributesForCampaign } from '../turf/computeCutAttributes.js';
import { Household } from '../../models/Household.js';
import { recomputeFullyVoted } from '../voted/recomputeFullyVoted.js';
import { reapplyVotedLists } from '../voted/reapplyVotedLists.js';

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

    await ImportJob.updateOne(
      { _id: importJobId },
      {
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
