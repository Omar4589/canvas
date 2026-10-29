import { generateTurf, addSupplementalBooks } from './generateTurf.js';
import { executeClaim } from '../walklist/claimDoors.js';
import { acquireRecutLock, renewRecutLock, releaseRecutLock } from './recutLock.js';

// BullMQ processor for the `turf-queue`, dispatching on job.name:
//   'claim'        — move doors between walk lists (services/walklist/claimDoors.js)
//   'supplemental' — book late-imported doors into an existing pass
//   'generate'     — cut a pass into books (and the default, so a job enqueued by
//                    pre-deploy web code still drains as a generate)
// One queue + concurrency 1 (worker.js) is what serializes these against each
// other; the per-pass recut lock (below and inside executeClaim) is what fences
// off WEB-side discard/restore while a job runs. Progress is reported on the job
// itself (read by GET /admin/campaigns/:id/turfs/jobs/:jobId — it serves any job
// on this queue whose data carries campaignId).
//
// All three paths are idempotent under BullMQ's one allowed stall-redelivery
// (worker.js maxStalledCount): generate wipes prior drafts, claim sweeps by
// ownership + dedupes its snapshots on jobId, supplemental re-reads ownBooks and
// skips already-booked doors.
//
// A REFUSAL — the campaign archived or being deleted, the pass or its walk list (for a
// claim, the target walk list) archived while the job waited or ran — is thrown by the
// services as BullMQ's UnrecoverableError (generateTurf.js assertTurfJobWritable,
// docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.5), which fails the job at once instead of
// spending its 3 attempts on the same answer. So nothing here may catch or wrap a
// service's error: it has to reach BullMQ as thrown (the supplemental's try/finally
// only releases the lock). A busy recut lock stays an ordinary Error: that one is
// temporary, and the retries are what it needs.
export async function processTurfJob(job) {
  if (job.name === 'claim') {
    const { campaignId, effortId, walkListId, all, force, requestedBy } = job.data;
    return executeClaim({
      campaignId,
      effortId,
      walkListId,
      all,
      force,
      userId: requestedBy,
      jobId: String(job.id),
      onProgress: async (p) => {
        await job.updateProgress(p);
      },
    });
  }

  if (job.name === 'supplemental') {
    const { campaignId, passId, name, maxDoors, excludeRestricted, excludeNoSoliciting, excludeUnplaced, requestedBy } = job.data;
    // The BINDING lock acquire lives here, not in the route: a route-held lock
    // could go stale while this job waits behind a long generate. Renew from the
    // progress callback (throttled) so a 250k-door supplemental outlives STALE_MS.
    const token = String(job.id);
    if (!(await acquireRecutLock(passId, requestedBy, token))) {
      throw new Error('A re-cut or restore is in progress on this pass. Try again shortly.');
    }
    let lastRenew = Date.now();
    try {
      return await addSupplementalBooks({
        campaignId,
        passId,
        name,
        maxDoors,
        excludeRestricted,
        excludeNoSoliciting,
        excludeUnplaced: !!excludeUnplaced,
        onProgress: async (p) => {
          await job.updateProgress(p);
          if (Date.now() - lastRenew >= 30000) {
            lastRenew = Date.now();
            if (!(await renewRecutLock(passId, token))) {
              throw new Error('Lost the re-cut lock mid-run — another operation took over this pass');
            }
          }
        },
      });
    } finally {
      await releaseRecutLock(passId, token).catch(() => {});
    }
  }

  const { campaignId, passId, mode, params, generatedBy } = job.data;
  return generateTurf({
    campaignId,
    passId,
    mode,
    params,
    generationJobId: String(job.id),
    generatedBy,
    onProgress: async (p) => {
      await job.updateProgress(p);
    },
  });
}
