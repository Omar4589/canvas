import { Campaign } from '../../models/Campaign.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { executeConversionRun, revertConversionRun, CONVERSION_JOB_PREFIX } from './surveyConversion.js';
import { sweptAfter } from '../platform/lateWriteSweep.js';

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
      { _id: job.data.runId, status: 'reverting', queueJobId: String(job.id) },
      { $set: { status: 'revert_failed', error } }
    );
    return;
  }
  // Only the run's own job (as the processor claims it): a job that isn't — one a Pick up replaced,
  // one that failed before it could claim — marked a run another job was executing as failed, and a
  // Pick up then ran a second job beside it (code review round 5).
  const previousBuild = !String(job.id).startsWith(CONVERSION_JOB_PREFIX);
  await SurveyConversionRun.updateOne(
    {
      _id: job.data.runId,
      status: { $in: ['pending', 'running'] },
      $or: [
        { queueJobId: String(job.id) },
        ...(previousBuild ? [{ status: 'pending', queueJobId: { $not: new RegExp(`^${CONVERSION_JOB_PREFIX}`) } }] : []),
      ],
    },
    { $set: { status: 'failed', error } }
  );
};

export async function processConversionJob(job) {
  const { runId } = job.data;
  const run = await SurveyConversionRun.findById(runId);
  if (!run) return { skipped: 'run-gone' };
  // Swept after on its campaign or organization being deleted however it ends — the run itself too,
  // when the cascade passed it while it was being created (round 4: the throw below left it for good).
  return sweptAfter({ campaignId: run.campaignId, organizationId: run.organizationId }, () => processRun(job, run));
}

const processRun = async (job, run) => {
  const runId = run._id;
  const campaign = await Campaign.findById(run.campaignId).lean();
  if (!campaign) throw new Error('Campaign no longer exists');

  // Only the run's OWN job runs it (the route writes the id before the add): a job that arrives after
  // its enqueue timed out — the admin was told nothing changed, and may since have started an answer
  // edit — or one a later Resume replaced, is skipped, never run beside something else (code review
  // 2026-10-19, round 2). A stall redelivery carries the same id and is welcome: both phases are
  // re-entrant.
  if (job.name === 'revert') {
    // A real claim (round 3): stamped, so a timed-out enqueue can no longer park an undo that has
    // started — it answered "Nothing has been changed" while the undo ran, and the campaign read free.
    // The deploy window: the previous build gave its jobs BullMQ's own ids and saved the undo's only
    // after the add, so until that save its run still holds another job's id, or none. Such a job is
    // its run's own while no undo of this build has claimed the run (the claim stamps the claimer's id,
    // so one of them wins) — skipped, it left the run reading Undoing for good.
    const previousBuild = !String(job.id).startsWith(CONVERSION_JOB_PREFIX);
    const claimed = await SurveyConversionRun.findOneAndUpdate(
      {
        _id: runId,
        status: 'reverting',
        $or: [{ queueJobId: String(job.id) }, ...(previousBuild ? [{ revertClaimedAt: null }] : [])],
      },
      { $set: { revertClaimedAt: new Date(), queueJobId: String(job.id) } },
      { new: true }
    );
    if (!claimed) return { skipped: 'not-claimable' };
    return revertConversionRun({ run: claimed, campaign });
  }

  // Also, for a job of the previous build, a run still pending under no job id of this build's: that
  // build saved the id only after the add — a create left none, and a Pick up still held the stopped
  // job's id — so a job taken in the moments before that save is its own (the deploy window; round 4:
  // a Pick up's job was skipped, and its run read Waiting for good). This build writes its id first.
  const previousBuild = !String(job.id).startsWith(CONVERSION_JOB_PREFIX);
  const claimed = await SurveyConversionRun.findOneAndUpdate(
    {
      _id: runId,
      status: { $in: ['pending', 'running'] },
      $or: [
        { queueJobId: String(job.id) },
        ...(previousBuild ? [{ status: 'pending', queueJobId: { $not: new RegExp(`^${CONVERSION_JOB_PREFIX}`) } }] : []),
      ],
    },
    { $set: { status: 'running', queueJobId: String(job.id) } },
    { new: true }
  );
  if (!claimed) return { skipped: run.status === 'completed' ? 'already-completed' : 'not-claimable' };
  if (!claimed.startedAt) {
    claimed.startedAt = new Date();
    await claimed.save();
  }

  return executeConversionRun({
    run: claimed,
    campaign,
    onProgress: async (r) => {
      await job.updateProgress(r.progress?.pct || 0);
    },
  });
};
