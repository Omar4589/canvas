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
// The worker's `failed` listener, for this queue. What landed STAYS landed — every converted door is
// individually correct and individually revertible by the run's own stamp sweep, so a rollback
// pass here would be a second destructive operation with its own failure mode. This only makes
// sure the doc says what stopped instead of freezing at `running` / `reverting` forever, and says
// it by DIRECTION: a stopped conversion reads `failed` (Pick up or Undo), a stopped undo reads
// `revert_failed` (Retry undo only — picking it up would run the conversion forward again).
export const reconcileFailedConversionJob = async (job, err) => {
  if (!job?.data?.runId) return;
  const attemptsAllowed = job.opts?.attempts || 1;
  if ((job.attemptsMade || 0) < attemptsAllowed && !job.finishedOn) return; // a retry is coming
  const error = String(err?.message || err || 'unknown');
  if (job.name === 'revert') {
    await SurveyConversionRun.updateOne(
      { _id: job.data.runId, status: 'reverting' },
      { $set: { status: 'revert_failed', error } }
    );
    return;
  }
  await SurveyConversionRun.updateOne(
    { _id: job.data.runId, status: { $in: ['pending', 'running'] } },
    { $set: { status: 'failed', error } }
  );
};

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
