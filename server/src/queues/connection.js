import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Create a fresh ioredis connection for BullMQ.
 *
 * Most callers want getSharedRedis() below, not this. A fresh client is only right for code
 * that owns its connection and closes it itself — today, the worker's boot probe (worker.js),
 * which quits as soon as the maxmemory-policy check answers.
 *
 * BullMQ needs `maxRetriesPerRequest: null` + `enableReadyCheck: false` or it throws at boot.
 * Heroku Key-Value Store uses `rediss://` with a self-signed cert, so we relax TLS
 * verification when the URL is a TLS URL.
 */
export function createRedis() {
  const isTls = REDIS_URL.startsWith('rediss://');
  const client = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  });
  // Never hand back a listener-less ioredis instance. The raw client emits
  // 'error' silently (no crash), but anything wrapping it — the boot probe, and
  // the producer Queues on the web dyno — must observe it for visibility, and a
  // wrapper that re-emits an unobserved 'error' would throw. This guarantees a
  // listener exists everywhere createRedis() is used.
  client.on('error', (err) => console.error('[redis] connection error:', err?.message || err));
  return client;
}

/**
 * The ONE Redis connection a process shares across every Queue and Worker it opens.
 *
 * BullMQ does not need a connection per Queue or Worker. Handed an ioredis INSTANCE, a Queue
 * uses it as-is and marks it `shared` (bullmq classes/queue-base.js wraps it in a
 * RedisConnection with `shared: isRedisInstance(...)`), and closing that Queue only detaches
 * the Queue's listeners — the `shared` guard in RedisConnection.close() skips quit() and
 * disconnect(). A Worker uses the instance for its ordinary commands and calls `.duplicate()`
 * exactly once, for the connection it parks in a blocking fetch (classes/worker.js,
 * `blockingConnection`, built `shared: false`); that duplicate is the only connection a
 * Worker owns and quits. So the per-process floor is 1 + one blocking duplicate per Worker,
 * and nothing else grows it. (Only the blocking side is per-Worker; nothing here uses
 * QueueEvents, which would be one more.)
 *
 * Connection budget on Heroku Key-Value Store, counted per process:
 *   before — worker 15: 7 Workers x 2 (base + blocking duplicate) + 1 for the maintenance
 *            schedule's producer Queue, which is never closed. Web 2-7: one per producer Queue,
 *            created lazily by getQueue() — Bull Board opens IMPORT and TURF at boot, and the
 *            first use of each other queue type after a restart added one more. 17 at rest,
 *            22 once the web dyno had touched every queue, and a deploy overlap counts both the
 *            old and the new dynos while the old ones drain.
 *   after  — worker 8: 1 shared + 7 blocking duplicates. Web 1.
 * Why it matters: on 2026-09-30 the app sat at the Mini plan's limit — the dashboard counted 18/18
 * ("Database connections over limit"; Heroku's plan page lists Mini at 20), so every deploy overlap, a second web dyno, or
 * the first use of a queue type after a restart hit the limit — a job that would not enqueue,
 * a Worker that would not start. The plan is now Premium 0 (40 connections); sharing keeps the
 * baseline far under either, with room for a deploy overlap and a second web dyno.
 *
 * Lazy and per-process: the web dyno opens it on its first getQueue() (Bull Board, at boot);
 * the worker on its first Worker. Only closeQueues() (queues/index.js) should close it, last.
 */
let shared = null;

export function getSharedRedis() {
  if (!shared) shared = createRedis();
  return shared;
}

/**
 * Quit the shared connection and forget it, so a later getSharedRedis() starts a fresh one.
 * Call it AFTER every Queue and Worker on it has closed (closeQueues() does), never before: a
 * Queue or Worker handed a connection does not close it, but it still expects it to be there.
 *
 * Bounded on purpose. With `maxRetriesPerRequest: null`, a QUIT sent while commands are waiting
 * out a reconnect is parked behind them in ioredis's offline queue and never resolves, so after
 * a short wait disconnect() — which also stops the reconnect loop — is the unconditional
 * fallback. Against a Redis that was never reachable ioredis resolves quit() at once and
 * disconnects itself, which is what the integration tests (REDIS_URL at a closed port) rely on.
 */
export async function closeSharedRedis() {
  const client = shared;
  shared = null;
  if (!client) return;
  try {
    await Promise.race([
      client.quit(),
      new Promise((resolve) => setTimeout(resolve, 2000).unref()),
    ]);
  } catch {
    // already ended — nothing to flush
  }
  if (client.status !== 'end') client.disconnect();
}

/**
 * BullMQ requires Redis `maxmemory-policy` = noeviction or jobs can be silently
 * evicted. Heroku may forbid CONFIG GET, so this only warns and never throws.
 */
export async function assertNoeviction(redis) {
  try {
    const res = await redis.config('GET', 'maxmemory-policy');
    const policy = Array.isArray(res) ? res[1] : res?.['maxmemory-policy'];
    if (policy && policy !== 'noeviction') {
      console.warn(
        `[queues] Redis maxmemory-policy is "${policy}"; BullMQ requires "noeviction". ` +
          `Run: heroku redis:maxmemory --policy noeviction`
      );
    }
  } catch {
    // CONFIG GET not permitted (managed Redis) — skip.
  }
}
