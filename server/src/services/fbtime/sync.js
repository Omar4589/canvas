import { FbTimeConnection } from '../../models/FbTimeConnection.js';
import { FbTimeShift } from '../../models/FbTimeShift.js';
import { FbTimePersonLink } from '../../models/FbTimePersonLink.js';
import { IntegrationEvent } from '../../models/IntegrationEvent.js';
import { Organization } from '../../models/Organization.js';
import { openSecret, sealedSecretConfigured } from '../../utils/sealedSecret.js';
import { zonedDayRange } from '../../utils/timezone.js';
import { getShifts, ping, FbtimeApiError, FATAL_CODES } from './client.js';

// The FbTime hours sync: re-pull date ranges of SHIFTS, replace what we hold.
//
// TWO JOBS, BOTH RANGE RE-PULLS, NEVER A CURSOR. The provider hard-deletes
// time entries, and a deleted row is never "updated" — an updatedSince cursor
// would keep the deleted shift in our cache forever, inflating the
// denominator. Re-pulling a range and REPLACING it propagates deletions for
// free: the shift is simply absent from the response, so it becomes absent
// here.
//
//   fbtime-hours-recent — every 15 minutes, last RECENT_WINDOW_DAYS (7).
//     Keeps today's rate fresh (open shifts accrue on the provider side, so
//     each pull advances "so far" hours) and catches same-week corrections.
//   fbtime-hours-deep   — nightly, last DEEP_WINDOW_DAYS (120). Catches late
//     edits and deletions beyond the recent window, and re-pings 'errored'
//     connections so a re-enabled key self-heals with no admin action.
//
// This is deliberately ALL the machinery. No reconciliation pass, no drift
// detection, no per-row bookkeeping — the polling model is self-healing by
// construction, and any machinery on top would be solving a problem the model
// does not have (the provider's own words in its contract).
//
// THE ZONE HERE ONLY SHAPES THE PULL WINDOW. Shifts are cached as instants and
// bucketed into local days at READ time, in each report's own anchor zone
// (services/reports/hoursSource.js) — so one pull serves every campaign the
// org runs, whatever zone each one anchors to. The org's zone is just a
// sensible edge for the trailing window, and the replace-range delete below
// uses the exact same UTC bounds the provider derived from it.
//
// Cron minutes sit off the quarter-hour and outside the overnight maintenance
// ladder (03:17 / 03:47 / 04:07 / 04:41 / 05:23 / 05:53 — see
// services/retention/scheduler.js).

export const FBTIME_RECENT_JOB = 'fbtime-hours-recent';
export const FBTIME_DEEP_JOB = 'fbtime-hours-deep';
// One-off, enqueued by the connect route so a fresh connection has data in
// seconds rather than at the next cron tick. Carries { organizationId }.
export const FBTIME_ORG_JOB = 'fbtime-hours-org';

export const FBTIME_RECENT_CRON = process.env.FBTIME_RECENT_CRON || '4,19,34,49 * * * *';
export const FBTIME_DEEP_CRON = process.env.FBTIME_DEEP_CRON || '29 6 * * *';

export const RECENT_WINDOW_DAYS = Number(process.env.FBTIME_RECENT_WINDOW_DAYS || 7);
export const DEEP_WINDOW_DAYS = Number(process.env.FBTIME_DEEP_WINDOW_DAYS || 120);

// 'YYYY-MM-DD' for an instant in an IANA zone — the en-CA idiom used across
// the repo. Day arithmetic subtracts whole days of milliseconds and formats
// in-zone; at day granularity that is exact except within an hour of a DST
// transition, where a window START can land one day off — harmless for a
// rolling window whose next run heals it.
const localDay = (instant, timeZone) =>
  new Date(instant).toLocaleDateString('en-CA', { timeZone });

const windowFor = (timeZone, windowDays) => {
  const now = Date.now();
  return {
    endDate: localDay(now, timeZone),
    startDate: localDay(now - (windowDays - 1) * 86_400_000, timeZone),
  };
};

/**
 * Record a sync failure ON THE TRANSITION, not per run. A revoked key hit by a
 * 15-minute cron must produce one audit row, not a wall of identical ones.
 */
const markConnectionError = async (connection, err) => {
  const summary = `${err.code || 'ERROR'}: ${String(err.message || '').slice(0, 200)}`;
  const wasConnected = connection.status === 'connected';

  connection.status = 'errored';
  connection.lastSyncError = summary;
  connection.lastErrorAt = new Date();
  await connection.save();

  if (wasConnected) {
    await IntegrationEvent.create({
      organizationId: connection.organizationId,
      byUserId: null, // the worker
      type: 'sync-failed',
      detail: { code: err.code || null },
    });
  }
};

/**
 * Pull one organization's shifts for the trailing window and make the cache
 * equal the response over that range — upserts for what the provider has,
 * deletes for what it no longer has. Exported for the connect route's one-off
 * job and for tests.
 *
 * Returns { pulled, upserted, deleted } on success. Throws FbtimeApiError on
 * provider refusal (caller decides whether it is fatal for the connection).
 */
export async function syncOrgHours(connection, { windowDays = RECENT_WINDOW_DAYS } = {}) {
  const org = await Organization.findById(connection.organizationId)
    .select('timeZone')
    .lean();
  // The org's zone shapes the trailing WINDOW only — never a bucket. Reports
  // bucket the cached instants per request, in their own anchor zone.
  const timeZone = org?.timeZone || 'America/New_York';
  const { startDate, endDate } = windowFor(timeZone, windowDays);

  const apiKey = openSecret(connection.keyCiphertext);
  const shifts = await getShifts({ apiKey, startDate, endDate, timeZone });

  // Resolve the link map once; shifts for unmapped people are kept with
  // userId null — that is the mapping screen's "unmatched hours exist" signal,
  // and absence of a link must never make hours silently vanish.
  const links = await FbTimePersonLink.find({ organizationId: connection.organizationId })
    .select('userId fbtimePersonId')
    .lean();
  const userOf = new Map(links.map((l) => [l.fbtimePersonId, l.userId]));

  const now = new Date();
  const seen = new Set(); // shift ids present in the response
  const ops = [];

  for (const s of shifts) {
    // A shift row must carry the provider's id and a real clockIn; anything
    // else is skipped rather than cached as garbage. isStale is deliberately
    // NOT cached — it embeds the pull's "today" and zone; hoursSource.js
    // derives it per request from isOpen + clockIn, exactly.
    if (!s?.id || !s.clockIn) continue;
    const shiftId = String(s.id);
    seen.add(shiftId);
    ops.push({
      updateOne: {
        filter: { organizationId: connection.organizationId, shiftId },
        update: {
          $set: {
            fbtimePersonId: String(s.userId),
            userId: userOf.get(String(s.userId)) ?? null,
            clockIn: new Date(s.clockIn),
            // Stored as sent — each figure already rounded to 2dp per the
            // contract, so read-time sums reproduce the provider's own totals.
            grossHours: s.grossHours ?? 0,
            adjustedHours: s.adjustedHours ?? 0,
            workedHours: s.workedHours ?? 0,
            isOpen: Boolean(s.isOpen),
            isManualEntry: Boolean(s.isManualEntry),
            entryTimeZone: s.entryTimeZone || null,
            syncedAt: now,
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length) await FbTimeShift.bulkWrite(ops, { ordered: false });

  // THE REPLACE HALF — hard-delete propagation. Every cached shift inside the
  // pulled window that the response did not contain describes a shift that no
  // longer exists; delete it, and the report falls back to span math for that
  // user-day. Rows OUTSIDE the window are not touched — the deep job's wider
  // window heals those. The bounds are the SAME UTC instants the provider
  // derived from [startDate, endDate] in this zone (its inclusive
  // 23:59:59.999 end and our exclusive next-midnight are the same set at
  // integer-millisecond resolution), so "inside the window" can never disagree
  // between the two systems.
  const window = zonedDayRange(startDate, endDate, timeZone);
  const held = await FbTimeShift.find({
    organizationId: connection.organizationId,
    clockIn: { $gte: window.$gte, $lt: window.$lt },
  })
    .select('_id shiftId')
    .lean();

  const stale = held.filter((r) => !seen.has(r.shiftId)).map((r) => r._id);
  if (stale.length) await FbTimeShift.deleteMany({ _id: { $in: stale } });

  connection.status = 'connected';
  connection.lastSyncAt = now;
  connection.lastSyncError = null;
  await connection.save();

  return { pulled: seen.size, upserted: ops.length, deleted: stale.length };
}

/**
 * Sync ONE connection with the full cron-loop posture — errored recovery,
 * fatal-vs-transient handling, never a throw. Shared by the cron fan-out below
 * and the one-off org job (connect + the admin's "Refresh hours now" button),
 * so a manual refresh fails exactly the way a cron tick does: recorded on the
 * connection where the status card can explain it, not lost in a dead job.
 *
 * An 'errored' connection is probed first — a key un-revoked or an org
 * re-activated on the provider side self-heals here, audited as
 * 'sync-recovered'; a still-dead key stays errored without a second audit row
 * (markConnectionError only logs the transition).
 *
 * Returns { ok, recovered, ...counts } — `recovered` stays true even when the
 * pull after a successful probe fails, matching the loop's historic counting.
 */
export async function syncOneConnection(connection, { windowDays } = {}) {
  let recovered = false;
  try {
    if (connection.status === 'errored') {
      await ping({ apiKey: openSecret(connection.keyCiphertext) });
      connection.status = 'connected';
      await connection.save();
      await IntegrationEvent.create({
        organizationId: connection.organizationId,
        byUserId: null,
        type: 'sync-recovered',
        detail: null,
      });
      recovered = true;
    }

    const res = await syncOrgHours(connection, { windowDays });
    return { ok: true, recovered, ...res };
  } catch (err) {
    if (err instanceof FbtimeApiError && FATAL_CODES.has(err.code)) {
      await markConnectionError(connection, err);
    } else {
      // Transient: timeout, 5xx, network. Say so on the status card, keep
      // the connection live, let the next tick retry.
      connection.lastSyncError = `${err.code || 'TRANSIENT'}: ${String(err.message || '').slice(0, 200)}`;
      connection.lastErrorAt = new Date();
      await connection.save().catch(() => {});
    }
    console.error(
      `[fbtime] sync failed for org ${connection.organizationId}: ${err.code || err.message}`
    );
    return { ok: false, recovered, code: err.code || null };
  }
}

/**
 * The fan-out both cron jobs run. One org failing never aborts the sweep
 * (geocodeService's mark-and-continue posture): fatal provider codes mark the
 * connection 'errored' (audited once, on the transition); anything transient
 * records lastSyncError and stays 'connected' for the next tick.
 *
 * recoverErrored (the deep job): include 'errored' connections so
 * syncOneConnection's probe can self-heal them.
 */
export async function runFbtimeSync({ windowDays, recoverErrored = false } = {}) {
  if (!sealedSecretConfigured()) {
    // Dormant, not broken — same posture as the mailer without RESEND_API_KEY.
    return { orgs: 0, ok: 0, errored: 0, recovered: 0, dormant: true };
  }

  const statuses = recoverErrored ? ['connected', 'errored'] : ['connected'];
  const connections = await FbTimeConnection.find({ status: { $in: statuses } });

  const out = { orgs: connections.length, ok: 0, errored: 0, recovered: 0 };

  for (const connection of connections) {
    const res = await syncOneConnection(connection, { windowDays });
    if (res.recovered) out.recovered += 1;
    if (res.ok) out.ok += 1;
    else out.errored += 1;
  }

  return out;
}
