import { Queue } from 'bullmq';
import { getSharedRedis, closeSharedRedis } from './connection.js';

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
  // Export Center: background CSV/ZIP builds (services/export/exportProcessor.js). Isolated
  // so a heavy full-backup can never head-of-line-block an import or turf cut.
  EXPORT: 'export-queue',
  // Campaign hard-delete cascades (services/campaigns/deleteCampaignProcessor.js) — a 100k-door
  // cascade runs for minutes, so it gets its own lane rather than starving imports.
  CAMPAIGN_DELETE: 'campaign-delete-queue',
  // Desk-entered survey conversions (services/canvass/conversionProcessor.js): a Door Outcomes run
  // that also writes N SurveyResponse rows per door and then recomputes campaign counters. Its own
  // lane for two reasons — two concurrent runs on one campaign would race recomputeCampaignStats
  // (so concurrency stays 1), and putting a multi-minute desk-entry job on TURF (also concurrency
  // 1) would head-of-line-block a walk-list claim.
  OUTCOME_CONVERT: 'outcome-convert-queue',
  // Organization hard-delete cascades (services/platform/deleteOrgProcessor.js). All FOUR paths
  // converge here — break-glass and the three retention triggers — so each org is its own job with
  // its own retry, and one org that throws can no longer abort the nightly sweep (which is what
  // enforces the 30-day delete-on-request promise). Own lane: an org cascade is every campaign's
  // rows at once and the heaviest thing the worker runs.
  ORG_DELETE: 'org-delete-queue',
  // Future: GEOCODE: 'geocode-queue'
};

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

const queues = new Map();

/**
 * Lazily construct (and cache) a producer-side Queue. Used by the web dyno, and by the worker
 * when a processor enqueues follow-on work (the retention triggers hand each condemned org to
 * org-delete-queue).
 */
export function getQueue(name) {
  if (!queues.has(name)) {
    // Every producer Queue in this process rides the ONE shared connection — a Queue handed an
    // ioredis instance uses it as-is and does not close it. A connection per Queue was what put
    // the web dyno at 2-7 of the 18 the dashboard counted on the Mini plan (connection.js has the budget).
    const queue = new Queue(name, { connection: getSharedRedis(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    // A Queue is an EventEmitter that re-emits Redis errors; an unobserved
    // 'error' would throw and crash the web process. Log and move on.
    queue.on('error', (err) => console.error(`[queue:${name}] error:`, err?.message || err));
    queues.set(name, queue);
  }
  return queues.get(name);
}

/**
 * Close every cached producer Queue, then the shared connection — in that order, and this is
 * the one place the connection is closed. Closing a Queue built on a handed-in connection only
 * detaches that Queue's listeners (bullmq's RedisConnection.close() skips quit() when `shared`),
 * so without the last step the connection would leak; closing it first would pull the socket
 * out from under Queues still detaching. The worker's shutdown calls this after its Workers
 * close, for the same reason.
 */
export async function closeQueues() {
  try {
    await Promise.all([...queues.values()].map((q) => q.close()));
  } finally {
    queues.clear();
    await closeSharedRedis();
  }
}
