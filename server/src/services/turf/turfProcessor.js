import { generateTurf } from './generateTurf.js';

// BullMQ processor for the `turf-queue`. Progress is reported on the job itself
// (read by GET /admin/campaigns/:id/turfs/jobs/:jobId). Idempotent: generateTurf
// wipes prior drafts for the pass before inserting, so a retry is clean.
export async function processTurfJob(job) {
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
