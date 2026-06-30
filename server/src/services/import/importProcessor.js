import { UnrecoverableError } from 'bullmq';
import { ImportJob } from '../../models/ImportJob.js';
import { Campaign } from '../../models/Campaign.js';
import { loadRawImport, deleteRawImport } from './rawImportStore.js';
import { buildImportRows, applyImport } from './csvImporter.js';
import { resolve as geocodeResolve } from './geocode/geocodeService.js';
import { reconcileIdentityFromImport } from '../person/reconcileIdentityFromImport.js';
import { normalizeAddress } from '../../utils/normalizeAddress.js';
import { computeImportDiff } from './computeImportDiff.js';
import { recomputeCutAttributesForCampaign } from '../turf/computeCutAttributes.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { recomputeFullyVoted } from '../voted/recomputeFullyVoted.js';
import { reapplyVotedLists } from '../voted/reapplyVotedLists.js';
import { recomputeHouseholdActive } from './recomputeHouseholdActive.js';

// Chunk a large $in lookup so a 25k-element query document never balloons memory.
// Returns the same lean docs as the inline query it replaces, just fetched in pages.
async function findInChunks(Model, baseFilter, field, values, projection, chunk = 5000) {
  const out = [];
  for (let i = 0; i < values.length; i += chunk) {
    const docs = await Model.find(
      { ...baseFilter, [field]: { $in: values.slice(i, i + chunk) } },
      projection
    ).lean();
    for (const d of docs) out.push(d);
  }
  return out;
}

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
    const { totalRows, errors, validRows, householdMap, dupSvids, detection } = await buildImportRows(
      buffer,
      importJob.filename,
      importJob.fieldMapping || {},
      { explode: importJob.explode !== false }
    );

    // "See exact placement" (kind 'geocode_check'): geocode the missing-coord addresses
    // NOW (caching them so a later import is free) and report exact placeable/unplaceable
    // counts. No import.
    if (importJob.kind === 'geocode_check') {
      await ImportJob.updateOne({ _id: importJobId }, { $set: { status: 'geocoding', progress: 0 } });
      const { unmatched, stats } = await geocodeResolve(householdMap, {
        onProgress: async (processed, total) => {
          const pct = total ? Math.round((processed / total) * 100) : 100;
          await job.updateProgress(pct);
          await ImportJob.updateOne({ _id: importJobId }, { progress: pct });
        },
      });
      const sample = [];
      for (const [address, info] of unmatched) {
        if (sample.length >= 100) break;
        sample.push({ address, code: info.code, reason: info.detail });
      }
      const geocodeCheck = {
        households: householdMap.size,
        placeable: stats.geocodedNew + stats.geocodedCached,
        unplaceable: stats.geocodeUnmatched,
        failed: stats.geocodeFailed,
        geocodedNew: stats.geocodedNew,
        geocodedCached: stats.geocodedCached,
        estCostUsd: Math.round((stats.geocodedNew / 1000) * 100) / 100,
        sample,
      };
      await ImportJob.updateOne(
        { _id: importJobId },
        { $set: { status: 'completed', geocodeCheck, progress: 100, completedAt: new Date(), ...stats } }
      );
      await deleteRawImport(importJobId);
      return { ok: true, kind: 'geocode_check', importJobId: String(importJobId) };
    }

    // Preview kind: read-only forecast (same diff the sync /csv/preview shows), no
    // writes. Persist the diff for the client to poll, then drop the raw file.
    if (importJob.kind === 'preview') {
      const diff = await computeImportDiff(campaign, { validRows, householdMap, errors, dupSvids, totalRows, uidSource: importJob.uidSource });
      diff.detection = detection;
      await ImportJob.updateOne(
        { _id: importJobId },
        {
          status: 'completed',
          diff,
          totalRows,
          errorCount: errors.length,
          errors: errors.slice(0, 100),
          progress: 100,
          completedAt: new Date(),
        }
      );
      await deleteRawImport(importJobId);
      return { ok: true, kind: 'preview', importJobId: String(importJobId) };
    }

    // ── Geocode missing-coordinate households (if enabled) ─────────────────────
    // Fills matched households' coords from the cache + Geocodio, and DROPS households
    // (plus their voters) that can't be placed — so every imported door keeps a walkable
    // pin (no location:null doors, no orphan voters).
    let geoStats = null;
    if (process.env.GEOCODE_ENABLED === 'true') {
      await ImportJob.updateOne({ _id: importJobId }, { $set: { status: 'geocoding', progress: 0 } });
      const { unmatched, stats } = await geocodeResolve(householdMap, {
        onProgress: async (processed, total) => {
          const overall = total ? Math.round((processed / total) * 20) : 20; // geocode = 0–20%
          await job.updateProgress(overall);
          await ImportJob.updateOne({ _id: importJobId }, { progress: overall });
        },
      });
      geoStats = stats;
      if (unmatched.size) {
        for (const normAddr of unmatched.keys()) householdMap.delete(normAddr);
        for (let i = validRows.length - 1; i >= 0; i -= 1) {
          const info = unmatched.get(normalizeAddress(validRows[i].household));
          if (info) {
            errors.push({ code: info.code, reason: info.detail, stateVoterId: validRows[i].voter.stateVoterId || null });
            validRows.splice(i, 1);
          }
        }
      }
    }

    // ── Link voters to canonical Persons + reconcile identity (shared voter DB) ──
    // Always-on (the sharedVoters branch is the rollout gate). Runs on the POST-geocode
    // rows so only voters that will actually import get linked; stamps personId +
    // uidSource onto each row.voter so applyImport's {...row.voter} upsert carries them.
    await reconcileIdentityFromImport(validRows, { orgId, uidSource: importJob.uidSource || null });

    // Re-housing audit: capture each incoming voter's CURRENT household BEFORE the
    // upsert reassigns it, so we can detect moves + emptied doors afterward.
    const svids = validRows.map((r) => r.voter.stateVoterId);
    const priorVoters = await findInChunks(
      Voter, { organizationId: orgId }, 'stateVoterId', svids, { stateVoterId: 1, householdId: 1 }
    );
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
        const pct = total ? processed / total : 1;
        // Geocoding 0-20% (when it ran), households 20-60%, voters 60-100%.
        const overall = phase === 'households' ? 20 + Math.round(pct * 40) : 60 + Math.round(pct * 40);
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
    const postVoters = await findInChunks(
      Voter, { organizationId: orgId }, 'stateVoterId', svids, { stateVoterId: 1, householdId: 1 }
    );
    let movedVoters = 0;
    for (const v of postVoters) {
      const prior = priorHhBySvid.get(v.stateVoterId);
      if (prior && prior !== String(v.householdId)) movedVoters += 1;
    }
    const destHouseholds = await findInChunks(
      Household, { campaignId: campaign._id }, 'normalizedAddress', [...householdMap.keys()], { _id: 1 }
    );
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
          ...(geoStats || {}),
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
