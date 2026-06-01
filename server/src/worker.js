import 'dotenv/config';
import { Worker } from 'bullmq';
import { connectDb } from './config/db.js';
import { createRedis, assertNoeviction } from './queues/connection.js';
import { QUEUE_NAMES } from './queues/index.js';
import { processImportJob } from './services/import/importProcessor.js';
import { processTurfJob } from './services/turf/turfProcessor.js';

const IMPORT_CONCURRENCY = Number(process.env.IMPORT_JOB_CONCURRENCY || 2);
const TURF_CONCURRENCY = Number(process.env.TURF_JOB_CONCURRENCY || 1);

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
    w.on('completed', (job) => console.log(`[worker:${w.name}] job ${job?.id} completed`));
    w.on('failed', (job, err) => console.error(`[worker:${w.name}] job ${job?.id} failed:`, err?.message));
  }
  console.log(`[worker] up; consuming: ${workers.map((w) => w.name).join(', ')}`);

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} — draining in-flight jobs…`);
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[worker] failed to start', err);
  process.exit(1);
});
