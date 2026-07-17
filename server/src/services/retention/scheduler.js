import { Queue } from 'bullmq';
import { createRedis } from '../../queues/connection.js';
import { QUEUE_NAMES } from '../../queues/index.js';
import { purgeDeletedIdentities, JOB_NAME } from './purgeDeletedIdentities.js';
import { runRetentionTriggers, TRIGGER_JOB } from './triggers.js';
import { recomputeLive, recomputeDaily, STATS_JOB } from '../platform/platformStats.js';
import { PLATFORM_METRICS } from '../../models/PlatformStats.js';

// Registers the repeatable maintenance jobs on the worker dyno.
//
// The whole point is that this is CODE. A Heroku Scheduler entry doing the same thing is invisible
// to the repo: no test can assert it exists, no reviewer sees it in a diff, and deleting it breaks
// a published legal commitment without failing anything. `assertRepeatableJobsRegistered` below is
// the test hook — if someone removes the schedule, a test goes red instead of a promise going quiet.

// Daily at 03:17 UTC. The odd minute is deliberate: on-the-hour is where every other cron in the
// world piles up.
export const RETENTION_CRON = process.env.RETENTION_CRON || '17 3 * * *';
// The triggers actually DELETE organizations, so they run apart from the identity purge — one job
// failing must not stop the other, and a log line about a purged customer should not be buried in a
// run that was mostly about something else.
export const TRIGGERS_CRON = process.env.RETENTION_TRIGGERS_CRON || '41 4 * * *';

// Nightly drift-correction for the lifetime platform counters: recompute the live bucket
// from real rows (bumpLive is best-effort and some delete paths have no hook) and stamp
// backfilledAt — the Control Room's "last reconciled" line. 03:47 sits between the purge
// (03:17) and the triggers (04:41).
export const PLATFORM_STATS_CRON = process.env.PLATFORM_STATS_CRON || '47 3 * * *';

// The `label` is not decoration: the health surface reports on every job in this list, and when one
// goes quiet the operator needs to be told WHICH promise stopped being kept.
export const REPEATABLE_JOBS = [
  { name: JOB_NAME, cron: RETENTION_CRON, label: 'The 180-day identity purge' },
  {
    name: TRIGGER_JOB,
    cron: TRIGGERS_CRON,
    label: 'The retention triggers (wind-down, dormancy, delete-on-request)',
  },
];

// Everything the worker schedules. REPEATABLE_JOBS above stays retention-only ON PURPOSE:
// the /health/retention banner reports on every entry in it (and supportAccess.int.test.js
// pins the count) — a marketing-counter reconcile going quiet must never read
// "Retention: NOT ENFORCED". The stats job's own freshness signal is backfilledAt, shown
// on the Control Room as "last reconciled".
export const MAINTENANCE_JOBS = [
  ...REPEATABLE_JOBS,
  { name: STATS_JOB, cron: PLATFORM_STATS_CRON, label: 'The nightly platform-stats reconcile' },
];

/** Producer side: declare the repeatable schedule. Idempotent — BullMQ dedupes on (name, cron). */
export async function registerMaintenanceJobs() {
  const queue = new Queue(QUEUE_NAMES.MAINTENANCE, { connection: createRedis() });
  queue.on('error', (err) => console.error('[queue:maintenance] error:', err?.message || err));

  for (const job of MAINTENANCE_JOBS) {
    await queue.add(job.name, {}, {
      repeat: { pattern: job.cron },
      // A repeatable job that piles up on an outage is worse than one that skips: we only ever want
      // the newest.
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
      jobId: job.name, // stable id so a redeploy re-declares rather than duplicates
    });
    console.log(`[maintenance] repeatable job registered: ${job.name} (${job.cron})`);
  }
  return queue;
}

/** Consumer side: what the worker actually runs. */
export async function processMaintenanceJob(job) {
  if (job.name === JOB_NAME) {
    const res = await purgeDeletedIdentities({ apply: true });
    console.log(`[maintenance] ${JOB_NAME}: scanned ${res.scanned}, purged ${res.purged}`);
    return res;
  }
  if (job.name === TRIGGER_JOB) {
    const res = await runRetentionTriggers({ apply: true });
    // Loud on purpose: this job DELETES CUSTOMERS. If it ever purges something unexpected, the line
    // that says so should be findable in a log without knowing what to grep for.
    console.log(
      `[maintenance] ${TRIGGER_JOB}: wind-down ${res.windDown.purged}/${res.windDown.due}, ` +
      `dormant ${res.dormant.purged}/${res.dormant.due}, requested ${res.requested.purged}/${res.requested.due}`
    );
    if (res.purged > 0) {
      console.warn(`[maintenance] ${TRIGGER_JOB}: PURGED ${res.purged} ORGANIZATION(S):`,
        [...res.windDown.orgs, ...res.dormant.orgs].join(', '));
    }
    return res;
  }
  if (job.name === STATS_JOB) {
    const live = await recomputeLive({ stampBackfill: true });
    // The trend series rides the same job: full rebuild from the same rows at the same moment, so
    // Σ(series) + undated stays reconciled to the live bucket it charts.
    const daily = await recomputeDaily();
    console.log(
      `[maintenance] ${STATS_JOB}: live bucket recomputed from rows — ` +
      PLATFORM_METRICS.map((m) => `${m} ${live[m]}`).join(', ') +
      ` · daily series rebuilt (${daily.days} day rows)`
    );
    return live;
  }
  throw new Error(`Unknown maintenance job: ${job.name}`);
}

/**
 * Test hook. Asserts the schedule is actually declared on the queue — so that deleting the retention
 * job from this file, or from the worker, fails a test rather than silently ending a legal promise.
 */
export async function listRepeatableJobs(queue) {
  const repeats = await queue.getRepeatableJobs();
  return repeats.map((r) => ({ name: r.name, pattern: r.pattern || r.cron }));
}
