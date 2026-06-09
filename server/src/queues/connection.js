import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Create a fresh ioredis connection for BullMQ.
 *
 * BullMQ requires a distinct connection per Queue/Worker/QueueEvents and needs
 * `maxRetriesPerRequest: null` + `enableReadyCheck: false` or it throws at boot.
 * Heroku Key-Value Store uses `rediss://` with a self-signed cert, so we relax
 * TLS verification when the URL is a TLS URL.
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
