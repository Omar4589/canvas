import { DeletedUserRecord } from '../../models/DeletedUserRecord.js';
import { RetentionRun } from '../../models/RetentionRun.js';
import { depairFbtimeAccount } from '../fbtime/purgePairing.js';

// The 180-day identity purge, as a function the app can call — not a script a human must remember.
//
// When someone deletes their account we scrub the User row immediately but keep ONE copy of their
// NAME in DeletedUserRecord (name only — email and phone die with the account, immediately), so
// the organization can still attribute past field work (above all the GPS quality flags) to a
// real person. We tell the user that, at the moment they delete, and we tell them it lasts a
// bounded period. This is the code that makes the bound real.
//
// It is deliberately boring: find the records whose window has lapsed, blank the name, sweep any
// legacy email/phone, stamp purgedAt. The ROW stays — it is the evidence that a deletion happened and that we
// honoured the window.
//
// RECORD BY RECORD, because the purge also de-pairs the account from FbTime
// (services/fbtime/purgePairing.js) — before the stamp, so a record whose FbTime step throws stays
// due for the next night while the rest are purged; a run with any failure is recorded ok:false
// (with `failed`) — the health surface shows the error at once and goes red once 48 hours pass
// without a clean run, rather than one record silently stalling everyone's purge.
//
// Called by the repeatable worker job (services/retention/scheduler.js) and by the CLI
// (migrations/purgeDeletedIdentities.js), which is now just a manual escape hatch.

export const JOB_NAME = 'purge-deleted-identities';

// A run older than this and the health check goes red. 48h gives a daily job one missed cycle of
// slack before it screams — enough to survive a deploy, not enough to hide a dead job for a week.
export const STALE_AFTER_HOURS = 48;

export async function purgeDeletedIdentities({ apply = true } = {}) {
  const startedAt = new Date();
  // A dry run records nothing: a RetentionRun is the health check's evidence that the purge
  // RAN, and a counting pass from a console must never make a dead job read green.
  const run = apply ? await RetentionRun.create({ job: JOB_NAME, startedAt }) : null;

  try {
    const filter = { retentionUntil: { $lte: startedAt }, purgedAt: null };
    const due = await DeletedUserRecord.find(filter).select('_id userId deletedAt').lean();
    const scanned = due.length;

    let purged = 0;
    let failed = 0;
    const fbtime = { links: 0, shiftsKept: 0, shiftsReassigned: 0, events: 0 };
    for (const rec of due) {
      try {
        const c = await depairFbtimeAccount({ userId: rec.userId, deletedAt: rec.deletedAt, apply });
        for (const k of Object.keys(fbtime)) fbtime[k] += c[k] || 0;
        if (!apply) continue;
        // New snapshots are name-only; the $unset still sweeps email/phone off any legacy row
        // that predates migrate:deletion-snapshots, so the purge is complete either way.
        const res = await DeletedUserRecord.updateOne(
          { _id: rec._id, purgedAt: null },
          { $set: { firstName: '', lastName: '', purgedAt: startedAt }, $unset: { email: 1, phone: 1 } }
        );
        purged += res.modifiedCount || 0;
      } catch (err) {
        failed += 1;
        console.error(`[retention] identity purge failed for record ${rec._id}: ${err?.message || err}`);
      }
    }

    const ok = failed === 0;
    if (!run) return { ok, scanned, purged, failed, fbtime };
    await RetentionRun.updateOne(
      { _id: run._id },
      {
        $set: {
          finishedAt: new Date(),
          ok,
          purged,
          scanned,
          failed,
          ...(ok ? {} : { error: `${failed} record(s) failed and stay due for the next run` }),
        },
      }
    );
    return { ok, scanned, purged, failed, fbtime };
  } catch (err) {
    // Record the failure. A job that throws and leaves no trace is the thing we are fixing.
    if (!run) throw err;
    await RetentionRun.updateOne(
      { _id: run._id },
      { $set: { finishedAt: new Date(), ok: false, error: String(err?.message || err) } }
    );
    throw err;
  }
}

/**
 * Is a retention job actually running right now? Read by the super-admin health surface.
 * Returns red when the last SUCCESSFUL run is stale — which is what a silently-dead job looks like.
 *
 * Takes the job NAME because there is more than one retention job, and they fail independently.
 * This used to hardcode JOB_NAME, which meant the health banner could only ever see the identity
 * purge: the `retention-triggers` sweep — the job that actually DELETES ORGANIZATIONS, including the
 * contractual delete-on-request SLA — could throw every single night and the banner stayed green,
 * because the purge beside it kept succeeding. A health check that cannot go red for half the thing
 * it reports on is worse than none, because it is believed. Callers should ask about every job in
 * scheduler.js's REPEATABLE_JOBS and let the worst one win.
 */
export async function retentionHealth(job = JOB_NAME, label = 'The 180-day identity purge') {
  const last = await RetentionRun.findOne({ job, ok: true }).sort({ startedAt: -1 }).lean();
  const lastFailure = await RetentionRun.findOne({ job, ok: false }).sort({ startedAt: -1 }).lean();

  const ageHours = last ? (Date.now() - new Date(last.startedAt).getTime()) / 3_600_000 : Infinity;
  const stale = ageHours > STALE_AFTER_HOURS;

  return {
    job,
    label,
    healthy: !!last && !stale,
    lastSuccessAt: last?.startedAt || null,
    lastSuccessPurged: last?.purged ?? null,
    hoursSinceLastSuccess: Number.isFinite(ageHours) ? Math.round(ageHours) : null,
    staleAfterHours: STALE_AFTER_HOURS,
    lastFailureAt: lastFailure?.startedAt || null,
    lastError: lastFailure?.error || null,
    // The message an operator should act on, in words rather than a boolean.
    message: !last
      ? `${label} has NEVER run. We are promising a retention limit we are not enforcing.`
      : stale
        ? `${label} has not succeeded for ${Math.round(ageHours)}h. The retention promise is not being kept.`
        : `${label} is running.`,
  };
}
