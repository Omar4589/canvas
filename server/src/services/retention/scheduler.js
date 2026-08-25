import { Queue } from 'bullmq';
import { createRedis } from '../../queues/connection.js';
import { QUEUE_NAMES } from '../../queues/index.js';
import { purgeDeletedIdentities, JOB_NAME } from './purgeDeletedIdentities.js';
import { runRetentionTriggers, TRIGGER_JOB } from './triggers.js';
import { recomputeLive, recomputeDaily, STATS_JOB } from '../platform/platformStats.js';
import { reconcileAllCampaignStats, CAMPAIGN_STATS_JOB } from '../reports/campaignCounters.js';
import { sweepExpiredExports, EXPORT_SWEEP_JOB } from '../export/sweepExpiredExports.js';
import { sweepStaleImportJobs, IMPORT_SWEEP_JOB } from '../import/sweepStaleImports.js';
import {
  runFbtimeSync,
  syncOneConnection,
  FBTIME_RECENT_JOB,
  FBTIME_DEEP_JOB,
  FBTIME_ORG_JOB,
  FBTIME_RECENT_CRON,
  FBTIME_DEEP_CRON,
  RECENT_WINDOW_DAYS,
  DEEP_WINDOW_DAYS,
} from '../fbtime/sync.js';
import { FbTimeConnection } from '../../models/FbTimeConnection.js';
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

// Nightly drift-correction for the per-campaign Campaign.stats counters. The write-side bump is a
// non-transactional read-compute-write (services/reports/campaignCounters.js documents the
// same-door race), and drift is SILENT: the campaign Home card keeps rendering a stale knock count
// with no error, disagreeing with the live per-round table directly beneath it. That is exactly how
// a client report goes out with the wrong number, so the repair runs on a schedule rather than
// waiting for someone to notice and run the CLI. 04:07 keeps it clear of the platform-stats
// recompute (03:47) and the retention triggers (04:41).
export const CAMPAIGN_STATS_CRON = process.env.CAMPAIGN_STATS_CRON || '7 4 * * *';

// Nightly Export Center artifact sweep: expired downloads deleted, failed-job leftovers and
// orphan GridFS files cleaned. 05:23 keeps it clear of the purge (03:17), the stats
// recomputes (03:47 / 04:07), and the triggers (04:41).
export const EXPORT_SWEEP_CRON = process.env.EXPORT_SWEEP_CRON || '23 5 * * *';

// Nightly import sweep: expire stuck ImportJobs nobody is polling (a worker OOM-abort
// skips every catch, freezing the doc in an active status) and delete orphaned raw
// voter-file uploads in GridFS — a crashed import used to leave the complete uploaded
// file behind with no TTL. 05:53 keeps it clear of the export sweep (05:23) and the
// rest of the overnight ladder.
export const IMPORT_SWEEP_CRON = process.env.IMPORT_SWEEP_CRON || '53 5 * * *';

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
  {
    name: CAMPAIGN_STATS_JOB,
    cron: CAMPAIGN_STATS_CRON,
    label: 'The nightly campaign-counter reconcile',
  },
  // Deliberately here and NOT in REPEATABLE_JOBS: an export sweep going quiet must never
  // read as "Retention: NOT ENFORCED" on the health banner.
  { name: EXPORT_SWEEP_JOB, cron: EXPORT_SWEEP_CRON, label: 'The nightly export-artifact sweep' },
  // Same reasoning — hygiene, not the retention promise.
  { name: IMPORT_SWEEP_JOB, cron: IMPORT_SWEEP_CRON, label: 'The nightly stale-import sweep' },
  // FbTime measured-hours sync (opt-in per org; a no-op sweep when nobody has
  // connected, and fully dormant without CREDENTIAL_SEAL_KEY). Off the
  // quarter-hour on purpose — :00/:15/:30/:45 is where the world's crons pile
  // up; the deep run sits after the overnight ladder above ends at 05:53.
  { name: FBTIME_RECENT_JOB, cron: FBTIME_RECENT_CRON, label: 'The FbTime hours sync (recent window)' },
  { name: FBTIME_DEEP_JOB, cron: FBTIME_DEEP_CRON, label: 'The nightly FbTime deep re-pull' },
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
    // Loud on purpose: this job CONDEMNS CUSTOMERS. It no longer swings the axe itself — each org
    // goes to org-delete-queue and the worker destroys it minutes later — but the decision is made
    // here, so the line that says so should be findable in a log without knowing what to grep for.
    console.log(
      `[maintenance] ${TRIGGER_JOB}: wind-down ${res.windDown.enqueued}/${res.windDown.due}, ` +
      `dormant ${res.dormant.enqueued}/${res.dormant.due}, requested ${res.requested.enqueued}/${res.requested.due}`
    );
    if (res.enqueued > 0) {
      console.warn(`[maintenance] ${TRIGGER_JOB}: ENQUEUED ${res.enqueued} ORGANIZATION DELETE(S):`,
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
  if (job.name === CAMPAIGN_STATS_JOB) {
    const res = await reconcileAllCampaignStats({ apply: true });
    // Named on purpose when something was actually wrong: a counter that drifts every night is a
    // bug in the bump hooks, and the only way anyone finds out is if the repair says which campaign
    // it kept repairing.
    if (res.drifted || res.unseeded) {
      console.warn(
        `[maintenance] ${CAMPAIGN_STATS_JOB}: repaired ${res.drifted} drifted, ` +
        `seeded ${res.unseeded} of ${res.scanned} campaign(s) — ` +
        res.details.map((d) => `${d.name} (${d.diffs.join(', ') || d.state})`).join('; ')
      );
    } else {
      console.log(`[maintenance] ${CAMPAIGN_STATS_JOB}: ${res.scanned} campaign(s) checked, no drift`);
    }
    return res;
  }
  if (job.name === EXPORT_SWEEP_JOB) {
    const res = await sweepExpiredExports();
    console.log(
      `[maintenance] ${EXPORT_SWEEP_JOB}: expired ${res.expired}, failed-job leftovers ${res.failedCleaned}, orphan file(s) ${res.orphans}`
    );
    return res;
  }
  if (job.name === IMPORT_SWEEP_JOB) {
    const res = await sweepStaleImportJobs();
    console.log(
      `[maintenance] ${IMPORT_SWEEP_JOB}: expired ${res.expired} stuck job(s), deleted ${res.rawDeleted} orphaned raw upload(s)`
    );
    return res;
  }
  if (job.name === FBTIME_RECENT_JOB) {
    const res = await runFbtimeSync({ windowDays: RECENT_WINDOW_DAYS });
    if (!res.dormant && res.orgs > 0) {
      console.log(
        `[maintenance] ${FBTIME_RECENT_JOB}: ${res.ok}/${res.orgs} org(s) synced` +
        (res.errored ? `, ${res.errored} errored` : '')
      );
    }
    return res;
  }
  if (job.name === FBTIME_DEEP_JOB) {
    const res = await runFbtimeSync({ windowDays: DEEP_WINDOW_DAYS, recoverErrored: true });
    if (!res.dormant && res.orgs > 0) {
      console.log(
        `[maintenance] ${FBTIME_DEEP_JOB}: ${res.ok}/${res.orgs} org(s) synced` +
        (res.recovered ? `, ${res.recovered} recovered` : '') +
        (res.errored ? `, ${res.errored} errored` : '')
      );
    }
    return res;
  }
  if (job.name === FBTIME_ORG_JOB) {
    // One-off for a single org: enqueued at connect (so a fresh connection
    // shows a season of measured hours in seconds, not at the next cron tick)
    // and by the admin's "Refresh hours now" button. Deep window both ways.
    // 'errored' is accepted because the manual refresh is exactly when a human
    // retries a fixed key — syncOneConnection probes and self-heals it, and
    // absorbs failures onto the connection where the status card explains them.
    const connection = await FbTimeConnection.findOne({
      organizationId: job.data?.organizationId,
      status: { $in: ['connected', 'errored'] },
    });
    if (!connection) return { skipped: true }; // disconnected before we ran — not an error
    const res = await syncOneConnection(connection, { windowDays: DEEP_WINDOW_DAYS });
    console.log(
      `[maintenance] ${FBTIME_ORG_JOB}: org ${job.data.organizationId} — ` +
      (res.ok ? `${res.pulled} shift(s), ${res.deleted} removed` : `failed (${res.code || 'transient'})`)
    );
    return res;
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
