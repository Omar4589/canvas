import 'dotenv/config';
import { Worker } from 'bullmq';
import { connectDb } from './config/db.js';
import { createRedis, assertNoeviction } from './queues/connection.js';
import { QUEUE_NAMES } from './queues/index.js';
import { processImportJob } from './services/import/importProcessor.js';
import { processTurfJob } from './services/turf/turfProcessor.js';

const IMPORT_CONCURRENCY = Number(process.env.IMPORT_JOB_CONCURRENCY || 2);
const TURF_CONCURRENCY = Number(process.env.TURF_JOB_CONCURRENCY || 1);

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
  await connectDb(process.env.MONGODB_URI);

  const probe = createRedis();
  await assertNoeviction(probe);
  await probe.quit().catch(() => {});

  const workers = [
    new Worker(QUEUE_NAMES.IMPORT, processImportJob, {
      connection: createRedis(),
      concurrency: IMPORT_CONCURRENCY,
    }),
    new Worker(QUEUE_NAMES.TURF, processTurfJob, {
      connection: createRedis(),
      concurrency: TURF_CONCURRENCY,
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
