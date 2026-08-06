import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UnrecoverableError } from 'bullmq';
import { ImportJob } from '../../models/ImportJob.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { loadRawImport, deleteRawImport } from './rawImportStore.js';
import { buildImportRows, applyImport, ndjsonBatches } from './csvImporter.js';
import { resolve as geocodeResolve, needsGeocode } from './geocode/geocodeService.js';
import { reconcileIdentityFromImport } from '../person/reconcileIdentityFromImport.js';
import { normalizeAddress } from '../../utils/normalizeAddress.js';
import { computeImportDiff } from './computeImportDiff.js';
import { recomputeCutAttributesForCampaign } from '../turf/computeCutAttributes.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { recomputeFullyVoted } from '../voted/recomputeFullyVoted.js';
import { reapplyVotedLists } from '../voted/reapplyVotedLists.js';
import { recomputeFullyDnc } from '../dnc/recomputeFullyDnc.js';
import { reapplyDncLists } from '../dnc/reapplyDncLists.js';
import { recomputeHouseholdActive } from './recomputeHouseholdActive.js';
import { collectRevisitHomes } from './collectRevisitHomes.js';

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
// {campaignId, normalizedAddress} and voter upserts on {campaignId,
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
  // Claimed AFTER a delete stamped the campaign (the route refuses new imports, but this
  // job may have been queued before the stamp): importing rows mid-cascade would orphan
  // voters into a half-deleted campaign (services/campaigns/deletionState.js).
  if (campaign.deletion?.requestedAt) {
    await ImportJob.updateOne(
      { _id: importJobId },
      { status: 'failed', errors: [{ reason: 'This campaign is being deleted.' }], errorCount: 1, completedAt: new Date() }
    );
    throw new UnrecoverableError('Campaign is being deleted');
  }
  // Same guard one level up: an import that started before an ORG delete was stamped would
  // re-materialize voter rows into a tenant whose data is being destroyed — the customer's data
  // surviving their own deletion.
  if (await Organization.exists({ _id: campaign.organizationId, 'deletion.requestedAt': { $ne: null } })) {
    await ImportJob.updateOne(
      { _id: importJobId },
      { status: 'failed', errors: [{ reason: 'This organization is being deleted.' }], errorCount: 1, completedAt: new Date() }
    );
    throw new UnrecoverableError('Organization is being deleted');
  }
  const orgId = campaign.organizationId;

  await ImportJob.updateOne(
    { _id: importJobId },
    {
      status: 'parsing',
      phase: 'parsing',
      startedAt: new Date(),
      heartbeatAt: new Date(),
      progress: 0,
      queueJobId: String(job.id),
    }
  );

  // Spill files (apply kind only): valid rows go to NDJSON on the dyno's ephemeral
  // disk instead of a ~160MB-per-166k-rows heap array; the link pass re-writes them
  // stamped with personId. Both are deleted in the finally — transient processing
  // storage, never at rest past the job (see PRIVACY_VERIFICATION).
  const spillRaw = path.join(os.tmpdir(), `import-spill-${importJobId}.ndjson`);
  const spillLinked = path.join(os.tmpdir(), `import-spill-${importJobId}-linked.ndjson`);
  try {
    const buffer = await loadRawImport(importJobId);
    const useSpill = importJob.kind !== 'preview' && importJob.kind !== 'geocode_check';
    if (useSpill) fs.writeFileSync(spillRaw, '');
    const { totalRows, errors, validRows, validCount, householdMap, dupSvids, dupRows, detection } = await buildImportRows(
      buffer,
      importJob.filename,
      importJob.fieldMapping || {},
      { explode: importJob.explode !== false, ...(useSpill ? { spill: spillRaw } : {}) }
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
          await ImportJob.updateOne({ _id: importJobId }, { progress: pct, heartbeatAt: new Date() });
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
      await ImportJob.updateOne({ _id: importJobId }, { $set: { phase: 'diffing', heartbeatAt: new Date() } });
      const diff = await computeImportDiff(campaign, { validRows, householdMap, errors, dupSvids, dupRows, totalRows, uidSource: importJob.uidSource });
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

    // Homes that arrived WITH lat/long in the file — never needed a paid lookup. Counted BEFORE
    // geocoding fills the rest, so it's an exact "arrived with coords" figure for the owner-only
    // import cost review (super-admin Imports page).
    const householdsWithFileCoords = [...householdMap.values()].filter((h) => !needsGeocode(h)).length;

    // ── Geocode missing-coordinate households (if enabled) ─────────────────────
    // Fills matched households' coords from the cache + Geocodio, and DROPS households
    // (plus their voters) that can't be placed — so every imported door keeps a walkable
    // pin (no location:null doors, no orphan voters).
    let geoStats = null;
    let geocodeUnmatched = null; // read by the spill-mode link pass below
    // Guarded on households actually MISSING coords — a file that arrives fully
    // geocoded must never flash a "Geocoding" stage (resolve() would no-op, but
    // the client polls every 1.5s and catches the stamp).
    const needingGeocode = householdMap.size - householdsWithFileCoords;
    if (process.env.GEOCODE_ENABLED === 'true' && needingGeocode > 0) {
      await ImportJob.updateOne(
        { _id: importJobId },
        { $set: { status: 'geocoding', phase: 'geocoding', heartbeatAt: new Date(), progress: 0 } }
      );
      const { unmatched, stats } = await geocodeResolve(householdMap, {
        onProgress: async (processed, total) => {
          const overall = total ? Math.round((processed / total) * 20) : 20; // geocode = 0–20%
          await job.updateProgress(overall);
          await ImportJob.updateOne({ _id: importJobId }, { progress: overall, heartbeatAt: new Date() });
        },
      });
      geoStats = stats;
      if (unmatched.size) {
        for (const normAddr of unmatched.keys()) householdMap.delete(normAddr);
        if (validRows) {
          for (let i = validRows.length - 1; i >= 0; i -= 1) {
            const info = unmatched.get(normalizeAddress(validRows[i].household));
            if (info) {
              errors.push({ code: info.code, reason: info.detail, stateVoterId: validRows[i].voter.stateVoterId || null });
              validRows.splice(i, 1);
            }
          }
        }
        // Spill mode: rows at unmatched addresses are dropped during the link pass
        // below (the spill is streamed there anyway — no extra read).
      }
      geocodeUnmatched = unmatched;
    }

    // ── Link voters to canonical Persons + reconcile identity (shared voter DB) ──
    // Always-on (the sharedVoters branch is the rollout gate). Runs on the POST-geocode
    // rows so only voters that will actually import get linked; stamps personId +
    // uidSource onto each row.voter so applyImport's {...row.voter} upsert carries them.
    // Its own stage: at 100k+ voters this is the longest pre-write step, and it used
    // to run under whatever label came before it (usually "geocoding" at 0%).
    // Progress deliberately stays at the geocode floor — this step has no cheap
    // row-granular progress, and a stage label beats a lying percentage.
    await ImportJob.updateOne(
      { _id: importJobId },
      { $set: { status: 'linking', phase: 'linking', heartbeatAt: new Date() } }
    );
    let svids;
    let linkedCount = 0;
    if (validRows) {
      await reconcileIdentityFromImport(validRows, { orgId, uidSource: importJob.uidSource || null });
      svids = validRows.map((r) => r.voter.stateVoterId);
      linkedCount = validRows.length;
    } else {
      // Spill mode: stream the raw spill in batches — drop geocode-unmatched rows,
      // reconcile each batch (stamps personId on the batch's rows), and re-write the
      // stamped rows to the linked spill applyImport will consume. One batch in heap
      // at a time; svids (short strings) are the only full-file accumulation.
      fs.writeFileSync(spillLinked, '');
      svids = [];
      for await (const batch of ndjsonBatches(spillRaw, 5000)) {
        let rows = batch;
        if (geocodeUnmatched?.size) {
          rows = [];
          for (const row of batch) {
            const info = geocodeUnmatched.get(normalizeAddress(row.household));
            if (info) errors.push({ code: info.code, reason: info.detail, stateVoterId: row.voter.stateVoterId || null });
            else rows.push(row);
          }
        }
        if (!rows.length) continue;
        await reconcileIdentityFromImport(rows, { orgId, uidSource: importJob.uidSource || null });
        const out = [];
        for (const row of rows) {
          svids.push(row.voter.stateVoterId);
          out.push(JSON.stringify(row));
        }
        fs.appendFileSync(spillLinked, `${out.join('\n')}\n`);
        linkedCount += rows.length;
        await ImportJob.updateOne({ _id: importJobId }, { $set: { heartbeatAt: new Date() } });
      }
    }

    // Re-housing audit: capture each incoming voter's CURRENT household BEFORE the
    // upsert reassigns it, so we can detect moves + emptied doors afterward. Campaign-
    // scoped: a sibling campaign's row of the same person is not "where they live" in
    // THIS campaign, and importing them here must not read as a move there.
    const priorVoters = await findInChunks(
      Voter, { campaignId: campaign._id }, 'stateVoterId', svids, { stateVoterId: 1, householdId: 1 }
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

    // Write phase — switch the status off "linking" so the UI shows the real stage, and
    // floor progress at 20% (geocode is 0–20%) even when geocoding was all cache hits.
    await ImportJob.updateOne(
      { _id: importJobId },
      { $set: { status: 'importing', phase: 'importing', heartbeatAt: new Date(), progress: 20 } }
    );

    const counts = await applyImport({
      campaign,
      orgId,
      validRows,
      ...(validRows ? {} : { validRowsFile: spillLinked, validCount: linkedCount }),
      householdMap,
      batchSize: 2000,
      overwriteHandEdits: importJob.overwriteHandEdits === true,
      onProgress: async ({ phase, processed, total }) => {
        const pct = total ? processed / total : 1;
        // Geocoding 0-20% (when it ran), households 20-60%, voters 60-100%.
        const overall = phase === 'households' ? 20 + Math.round(pct * 40) : 60 + Math.round(pct * 40);
        await job.updateProgress(overall);
        // heartbeatAt rides the progress write (per 2000-row batch — no extra write);
        // the stale-job expiry in GET /:importId reads it to tell alive from dead.
        await ImportJob.updateOne(
          { _id: importJobId },
          { progress: overall, processedRows: processed, heartbeatAt: new Date() }
        );
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

    // Do-not-contact (sticky): the same reopen mechanics, org-wide. Graduate prior DNC-list ids
    // onto voters that have only now been imported, then recompute fullyDnc for those doors plus
    // any currently-suppressed door in this campaign — a genuinely-new contactable resident
    // re-opens an all-DNC door; a resident who was on a DNC list stays flagged. Doors that
    // gained an import-SEEDED flag (a person flagged in a sibling campaign arriving here —
    // csvImporter 2.6) join the recompute so an all-DNC door drops now, not next nightly.
    const { householdIds: reappliedDncHh } = await reapplyDncLists(orgId);
    const dncDropped = await Household.find({ campaignId: campaign._id, fullyDnc: true }).distinct('_id');
    const dncRecompute = [...new Set([...dncDropped.map(String), ...reappliedDncHh, ...(counts.seededDncHouseholdIds || [])])];
    if (dncRecompute.length) await recomputeFullyDnc(dncRecompute);

    // Re-house cleanup: count voters that changed doors, then deactivate doors this
    // import emptied (and reactivate any refilled) — bounded to the touched households.
    // Same campaign scope as the prior capture, so the before/after pair compares the
    // same rows.
    const postVoters = await findInChunks(
      Voter, { campaignId: campaign._id }, 'stateVoterId', svids, { stateVoterId: 1, householdId: 1 }
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

    // Opt-in: collect already-worked homes that gained a new target voter into a saved
    // search so the admin can cut a fresh (billable) revisit round. Non-fatal — a hiccup
    // here must never fail an otherwise-successful import.
    let revisit = null;
    try {
      revisit = await collectRevisitHomes(importJob, campaign, counts);
    } catch (err) {
      console.error('[import] revisit-list creation failed (non-fatal):', err?.message);
    }

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
          duplicateStateVoterIds: Array.from(dupSvids.keys()),
          errors: errors.slice(0, 100),
          errorCount: errors.length,
          processedRows: totalRows,
          progress: 100,
          completedAt: new Date(),
          householdsWithFileCoords,
          ...(geoStats || {}),
          ...(revisit ? { revisitSavedSearchId: revisit.savedSearchId, revisitHouseholdCount: revisit.householdCount } : {}),
        },
        // A retry recomputes these as 0 (voters already moved; overwrite-mode flags already
        // pulled) — $max keeps the real first-attempt counts so the audit trail never regresses.
        $max: {
          movedVoters,
          deactivatedDoors,
          keptHandEdits: counts.keptHandEdits || 0,
          overwrittenHandEdits: counts.overwrittenHandEdits || 0,
          keptPins: counts.keptPins || 0,
        },
      }
    );

    await deleteRawImport(importJobId).catch(() => {});
    return { ok: true, importJobId: String(importJobId), newVoters: counts.newVoters };
  } catch (err) {
    // Classify before rethrowing: a missing raw file (cascade-deleted, or a retry
    // after a success+crash) and a file that won't parse are permanently
    // unrecoverable — retrying them just burns the backoff schedule.
    const unrecoverable =
      err instanceof UnrecoverableError ||
      /FileNotFound|file not found/i.test(String(err?.message)) ||
      err?.name === 'ImportTooLargeError';
    await ImportJob.updateOne(
      { _id: importJobId },
      {
        status: 'failed',
        errors: [{ reason: err.message }],
        errorCount: 1,
        lastError: String(err?.message || err),
        completedAt: new Date(),
      }
    );
    if (unrecoverable) {
      // Terminal: no retry will read the raw upload again — drop it now (the
      // nightly sweep is the backstop for every other failure path).
      await deleteRawImport(importJobId).catch(() => {});
      throw err instanceof UnrecoverableError ? err : new UnrecoverableError(err.message);
    }
    throw err; // retried per the queue's backoff policy; sweep cleans the raw file if all retries die
  } finally {
    // The spills hold voter PII on the dyno's ephemeral disk — their lifetime is
    // the job, success OR failure. Never leave them for the success path only.
    fs.rmSync(spillRaw, { force: true });
    fs.rmSync(spillLinked, { force: true });
  }
}
