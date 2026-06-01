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
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  });
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
