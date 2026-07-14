import { Queue } from 'bullmq';
import { createRedis } from './connection.js';

// One queue per logical job type so concurrency/retry are isolated and a slow
// turf job can't head-of-line-block imports.
export const QUEUE_NAMES = {
  IMPORT: 'import-queue',
  TURF: 'turf-queue',
  // Scheduled housekeeping that must happen whether or not anyone remembers it — today, the
  // 180-day identity purge that backs our published retention promise. It lives here, on the
  // worker dyno we already run, rather than in a Heroku Scheduler add-on: a dashboard entry is
  // invisible to the code, uncovered by any test, and can be removed or lost in a host migration
  // without a single thing failing. See services/retention/.
  MAINTENANCE: 'maintenance-queue',
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
    const queue = new Queue(name, { connection: createRedis(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    // A Queue is an EventEmitter that re-emits Redis errors; an unobserved
    // 'error' would throw and crash the web process. Log and move on.
    queue.on('error', (err) => console.error(`[queue:${name}] error:`, err?.message || err));
    queues.set(name, queue);
  }
  return queues.get(name);
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
