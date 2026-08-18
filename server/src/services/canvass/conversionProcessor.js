import { Campaign } from '../../models/Campaign.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { executeConversionRun, revertConversionRun } from './surveyConversion.js';

// BullMQ processor for the `outcome-convert-queue`, dispatching on job.name:
//   'convert' — run a bulk desk-entry conversion to completion
//   'revert'  — undo one, which is the same size of work and deserves the same lane
//
// Idempotent under BullMQ's one allowed stall-redelivery: executeConversionRun re-reads its work
// set each pass and convertibleMatch already excludes stamped rows, so a redelivered job naturally
// skips everything the first delivery finished. The one non-idempotent write (bumpLive) is CAS'd
// on the run doc's `liveBumped`.
//
// Progress is reported on the RUN DOC, not the BullMQ job: the client polls
// GET /admin/campaigns/:id/survey-conversions/:runId, which is scoped by
// {_id, campaignId, organizationId} — so a run id from another org reads as 404 by construction
// rather than by an ownership check the route has to remember to write.
export async function processConversionJob(job) {
  const { runId } = job.data;
  const run = await SurveyConversionRun.findById(runId);
  if (!run) return { skipped: 'run-gone' };

  const campaign = await Campaign.findById(run.campaignId).lean();
  if (!campaign) throw new Error('Campaign no longer exists');

  if (job.name === 'revert') {
    if (run.status === 'reverted') return { skipped: 'already-reverted' };
    return revertConversionRun({ run, campaign });
  }

  if (run.status === 'completed') return { skipped: 'already-completed' };
  run.status = 'running';
  run.startedAt = run.startedAt || new Date();
  run.queueJobId = String(job.id);
  await run.save();

  return executeConversionRun({
    run,
    campaign,
    onProgress: async (r) => {
      await job.updateProgress(r.progress?.pct || 0);
    },
  });
}
