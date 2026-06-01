import { Queue } from 'bullmq';
import { createRedis } from './connection.js';

// One queue per logical job type so concurrency/retry are isolated and a slow
// turf job can't head-of-line-block imports.
export const QUEUE_NAMES = {
  IMPORT: 'import-queue',
  TURF: 'turf-queue',
  // Future: GEOCODE: 'geocode-queue', EXPORT: 'export-queue'
};

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

const queues = new Map();

/** Lazily construct (and cache) a producer-side Queue. Used by the web dyno. */
export function getQueue(name) {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, { connection: createRedis(), defaultJobOptions: DEFAULT_JOB_OPTIONS })
    );
  }
  return queues.get(name);
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
