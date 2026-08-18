import 'dotenv/config';
import { Worker } from 'bullmq';
import { connectDb } from './config/db.js';
import { createRedis, assertNoeviction } from './queues/connection.js';
import { QUEUE_NAMES } from './queues/index.js';
import { processImportJob } from './services/import/importProcessor.js';
import { processTurfJob } from './services/turf/turfProcessor.js';
import { processExportJob } from './services/export/exportProcessor.js';
import { processCampaignDeleteJob } from './services/campaigns/deleteCampaignProcessor.js';
import { processOrgDeleteJob } from './services/platform/deleteOrgProcessor.js';
import { processConversionJob } from './services/canvass/conversionProcessor.js';
import { registerMaintenanceJobs, processMaintenanceJob } from './services/retention/scheduler.js';
import { GeocodeCache } from './models/GeocodeCache.js';
import { ExportJob } from './models/ExportJob.js';
import { FbTimeShift } from './models/FbTimeShift.js';
import { ImportJob } from './models/ImportJob.js';
import { Campaign } from './models/Campaign.js';
import { Organization } from './models/Organization.js';
import { SurveyConversionRun } from './models/SurveyConversionRun.js';

const IMPORT_CONCURRENCY = Number(process.env.IMPORT_JOB_CONCURRENCY || 2);
const TURF_CONCURRENCY = Number(process.env.TURF_JOB_CONCURRENCY || 1);
// Exports are full-collection scans sharing this dyno with imports/turf — default 1 so a
// heavy backup can never head-of-line-block real canvassing work.
const EXPORT_CONCURRENCY = Number(process.env.EXPORT_JOB_CONCURRENCY || 1);
// Campaign hard-deletes are multi-minute cascade runs — 1 for the same reason as exports.
const CAMPAIGN_DELETE_CONCURRENCY = Number(process.env.CAMPAIGN_DELETE_JOB_CONCURRENCY || 1);
// Org hard-deletes are the heaviest thing this dyno runs (every campaign's rows at once). 1:
// two concurrent cascades would each starve the other's heartbeat and look dead to the watchdog.
const ORG_DELETE_CONCURRENCY = Number(process.env.ORG_DELETE_JOB_CONCURRENCY || 1);
// Desk-entry conversions: 1, because two runs on the same campaign would race the
// recomputeCampaignStats each one ends with, and the loser would persist a stale counter set.
const OUTCOME_CONVERT_CONCURRENCY = Number(process.env.OUTCOME_CONVERT_JOB_CONCURRENCY || 1);

// A long-lived worker must survive transient Redis/Mongo faults instead of
// exiting. Without these, a stray unhandled rejection — or a Worker 'error'
// event re-thrown by Node's EventEmitter (see the w.on('error') note below) —
// terminates the dyno, and Heroku's escalating crash-backoff then keeps it off
// for up to ~320 minutes. Log and KEEP RUNNING; let only a platform SIGKILL
// (R15 memory / R12 exit-timeout) take us down.
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException', err);
});

async function main() {
  // The worker needs far fewer connections than the web dyno (2 job concurrencies, no request
  // fan-out), so give it a smaller pool to keep the total Atlas connection count down.
  await connectDb(process.env.MONGODB_URI, {
    maxPoolSize: Number(process.env.WORKER_MONGO_MAX_POOL_SIZE) || 10,
  });

  // autoIndex is off in production (config/db.js), so the GeocodeCache indexes — a NEW
  // collection — won't auto-build. The worker reads/writes that cache during imports,
  // so ensure its indexes once at boot (no-op if already present).
  await GeocodeCache.syncIndexes().catch((e) => console.error('[worker] GeocodeCache.syncIndexes failed', e?.message || e));
  // Same reason for ExportJob (another new collection the worker writes; the deploy-time
  // buildIndexes migration remains the primary path — this is the no-op belt-and-braces).
  await ExportJob.syncIndexes().catch((e) => console.error('[worker] ExportJob.syncIndexes failed', e?.message || e));
  // And for the FbTime shift cache — the sync jobs upsert on its unique
  // {org, shiftId} key, which without the index would quietly allow duplicates.
  await FbTimeShift.syncIndexes().catch((e) => console.error('[worker] FbTimeShift.syncIndexes failed', e?.message || e));
  // And the desk-entry run collection — another new one this dyno writes and the web polls.
  await SurveyConversionRun.syncIndexes().catch((e) =>
    console.error('[worker] SurveyConversionRun.syncIndexes failed', e?.message || e)
  );

  // Bound the boot probe: against an unreachable Redis, ioredis
  // (maxRetriesPerRequest: null) queues the CONFIG GET forever and this await
  // would wedge main() BEFORE any Worker is constructed — dyno "up", consuming
  // nothing. The probe is advisory; log and let the Workers' own connections
  // retry into a recovered Redis.
  const probe = createRedis();
  await Promise.race([
    assertNoeviction(probe),
    new Promise((resolve) => setTimeout(resolve, 10000).unref()),
  ]).catch((err) => console.error('[worker] noeviction probe failed:', err?.message || err));
  await probe.quit().catch(() => {});

  // Declare the repeatable schedule (the 180-day identity purge) before the consumer starts. This is
  // what replaces the Heroku Scheduler add-on: the promise is now kept by code that ships with the
  // app, is covered by a test, and shows up in a diff.
  // Bounded for the same reason as the probe above — a dead Redis would wedge this await forever.
  // The declaration must still happen, so on timeout keep retrying in the background until it lands.
  const declareMaintenance = async () => {
    for (;;) {
      try {
        await Promise.race([
          registerMaintenanceJobs(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('redis-timeout')), 15000).unref()),
        ]);
        return;
      } catch (err) {
        console.error('[worker] registerMaintenanceJobs failed, retrying in 60s:', err?.message || err);
        await new Promise((resolve) => setTimeout(resolve, 60000).unref());
      }
    }
  };
  await Promise.race([
    declareMaintenance(),
    new Promise((resolve) => setTimeout(resolve, 20000).unref()),
  ]); // proceed to construct Workers either way; the retry loop keeps running if needed

  const workers = [
    new Worker(QUEUE_NAMES.IMPORT, processImportJob, {
      connection: createRedis(),
      concurrency: IMPORT_CONCURRENCY,
    }),
    new Worker(QUEUE_NAMES.TURF, processTurfJob, {
      connection: createRedis(),
      concurrency: TURF_CONCURRENCY,
      // Belt-and-braces for the 2026-08 stall incident: the cut/claim pipeline now
      // yields (balancedKMeans + computeTerritories + per-book loops), so the lock
      // renewal timer can always fire — but one sync block remains (turf.voronoi
      // over a whole pass, seconds at 250k doors). 90s covers a pathological block
      // with margin while still detecting a genuinely dead worker in ~1.5 min.
      lockDuration: 90_000,
      // Exactly one legitimate stall redelivery (dyno restart mid-job) is allowed —
      // safe because all three processors are idempotent (generate wipes prior
      // drafts, claim sweeps by ownership, supplemental re-reads ownBooks). A job
      // that stalls twice fails loudly instead of thrashing.
      maxStalledCount: 2,
    }),
    new Worker(QUEUE_NAMES.MAINTENANCE, processMaintenanceJob, {
      connection: createRedis(),
      concurrency: 1, // housekeeping; never compete with real work
    }),
    new Worker(QUEUE_NAMES.EXPORT, processExportJob, {
      connection: createRedis(),
      concurrency: EXPORT_CONCURRENCY,
    }),
    new Worker(QUEUE_NAMES.CAMPAIGN_DELETE, processCampaignDeleteJob, {
      connection: createRedis(),
      concurrency: CAMPAIGN_DELETE_CONCURRENCY,
    }),
    new Worker(QUEUE_NAMES.ORG_DELETE, processOrgDeleteJob, {
      connection: createRedis(),
      concurrency: ORG_DELETE_CONCURRENCY,
    }),
    new Worker(QUEUE_NAMES.OUTCOME_CONVERT, processConversionJob, {
      connection: createRedis(),
      concurrency: OUTCOME_CONVERT_CONCURRENCY,
      // One stall redelivery is safe: the processor re-reads its work set and convertibleMatch
      // excludes rows it already stamped, so a resumed job skips finished doors on its own.
      maxStalledCount: 2,
    }),
  ];

  for (const w of workers) {
    // REQUIRED: BullMQ re-emits every Redis socket error (ECONNRESET, TLS reset,
    // failover, "max number of clients reached") as a Worker 'error' event. A
    // Worker is an EventEmitter, so emitting 'error' with NO listener makes Node
    // throw and crash the process. Consume it here — do NOT exit or re-throw;
    // ioredis auto-reconnects and the worker resumes consuming on its own.
    w.on('error', (err) => console.error(`[worker:${w.name}] worker error:`, err?.message || err));
    w.on('completed', (job) => console.log(`[worker:${w.name}] job ${job?.id} completed`));
    w.on('failed', (job, err) => console.error(`[worker:${w.name}] job ${job?.id} failed:`, err?.message));
    // Observability: a stalled job means the lock lapsed (worker froze/restarted
    // or the connection dropped mid-job). BullMQ retries it; idempotent
    // processors make that safe. Log it so a silent reclaim isn't invisible.
    w.on('stalled', (jobId) => console.warn(`[worker:${w.name}] job ${jobId} stalled — will be retried`));
  }
  // Redis→Mongo ledger reconcile: when BullMQ exhausts an import job's retries
  // (thrown errors, stall-limit after a crash loop, drain races), the failure
  // lands in Redis only — nothing else writes `failed` onto the ImportJob doc the
  // client polls. The CAS status filter leaves completed/failed docs alone.
  const importWorker = workers.find((w) => w.name === QUEUE_NAMES.IMPORT);
  importWorker.on('failed', async (job, err) => {
    if (!job?.data?.importJobId) return;
    const attemptsAllowed = job.opts?.attempts || 1;
    if ((job.attemptsMade || 0) < attemptsAllowed && !job.finishedOn) return; // a retry is coming
    try {
      await ImportJob.updateOne(
        {
          _id: job.data.importJobId,
          status: { $in: ['pending', 'parsing', 'geocoding', 'linking', 'importing'] },
        },
        {
          $set: {
            status: 'failed',
            lastError: String(err?.message || err || 'unknown'),
            completedAt: new Date(),
          },
          $push: { errors: { reason: 'The import failed after retries. Check the file and try again.' } },
          $inc: { errorCount: 1 },
        }
      );
    } catch (e) {
      console.error('[worker] failed-listener reconcile error:', e?.message || e);
    }
  });
  // Same reconcile for campaign deletes: the campaign doc is the job record, so when BullMQ
  // exhausts retries the doc must read `failed` (with Retry in the UI) rather than freeze in
  // pending/running until the poll-side expiry happens to notice. Belt-and-braces for
  // OOM-abort exits that skip the processor's own catch.
  const campaignDeleteWorker = workers.find((w) => w.name === QUEUE_NAMES.CAMPAIGN_DELETE);
  campaignDeleteWorker.on('failed', async (job) => {
    if (!job?.data?.campaignId) return;
    const attemptsAllowed = job.opts?.attempts || 1;
    if ((job.attemptsMade || 0) < attemptsAllowed && !job.finishedOn) return; // a retry is coming
    try {
      await Campaign.updateOne(
        { _id: job.data.campaignId, 'deletion.status': { $in: ['pending', 'running'] } },
        {
          $set: {
            'deletion.status': 'failed',
            // Generic on purpose — never echo campaign/voter content into the error.
            'deletion.error': 'The delete failed after retries. Retry from the Campaigns page.',
          },
        }
      );
    } catch (e) {
      console.error('[worker] campaign-delete reconcile error:', e?.message || e);
    }
  });
  // Same reconcile for org deletes. Extra weight here: while the stamp reads pending/running the
  // WHOLE TENANT is walled off, so a job that died in Redis without flipping the doc would leave
  // a customer locked out of a org that is not actually being deleted by anyone.
  const orgDeleteWorker = workers.find((w) => w.name === QUEUE_NAMES.ORG_DELETE);
  orgDeleteWorker.on('failed', async (job) => {
    if (!job?.data?.organizationId) return;
    const attemptsAllowed = job.opts?.attempts || 1;
    if ((job.attemptsMade || 0) < attemptsAllowed && !job.finishedOn) return; // a retry is coming
    try {
      await Organization.updateOne(
        { _id: job.data.organizationId, 'deletion.status': { $in: ['pending', 'running'] } },
        {
          $set: {
            'deletion.status': 'failed',
            // Generic on purpose — never echo org or voter content into an operator-visible field.
            'deletion.error': 'The delete failed after retries. Retry from the Organizations page.',
          },
        }
      );
    } catch (e) {
      console.error('[worker] org-delete reconcile error:', e?.message || e);
    }
  });
  // Same reconcile for desk-entry conversions. What landed STAYS landed — every converted door is
  // individually correct and individually revertible by the run's own stamp sweep, so a rollback
  // pass here would be a second destructive operation with its own failure mode. The run card
  // offers Revert and Resume instead; this listener only makes sure the doc says `failed` rather
  // than freezing at `running` forever.
  const convertWorker = workers.find((w) => w.name === QUEUE_NAMES.OUTCOME_CONVERT);
  convertWorker.on('failed', async (job, err) => {
    if (!job?.data?.runId) return;
    const attemptsAllowed = job.opts?.attempts || 1;
    if ((job.attemptsMade || 0) < attemptsAllowed && !job.finishedOn) return; // a retry is coming
    try {
      await SurveyConversionRun.updateOne(
        { _id: job.data.runId, status: { $in: ['pending', 'running', 'reverting'] } },
        { $set: { status: 'failed', error: String(err?.message || err || 'unknown') } }
      );
    } catch (e) {
      console.error('[worker] conversion reconcile error:', e?.message || e);
    }
  });

  console.log(`[worker] up; consuming: ${workers.map((w) => w.name).join(', ')}`);

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} — draining in-flight jobs…`);
    try {
      // Heroku SIGKILLs (R12 exit-timeout) 30s after SIGTERM. Bound the graceful
      // drain to 25s so we always exit cleanly inside that window even if a long
      // turf/import job is mid-flight; an abandoned job becomes stalled and is
      // retried (processors are idempotent), so this is safe.
      await Promise.race([
        Promise.all(workers.map((w) => w.close())),
        new Promise((resolve) => setTimeout(resolve, 25000)),
      ]);
    } catch (err) {
      console.error('[worker] error during drain', err?.message || err);
    } finally {
      process.exit(0);
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[worker] failed to start', err);
  process.exit(1);
});
