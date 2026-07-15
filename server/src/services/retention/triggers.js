import { Organization } from '../../models/Organization.js';
import { Subscription } from '../../models/Subscription.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { OrgDeletionRequest } from '../../models/OrgDeletionRequest.js';
import { RetentionRun } from '../../models/RetentionRun.js';
import { deleteOrganization } from '../platform/deleteOrganization.js';

// The three disclosed retention triggers. Each is a REAL purge — it calls the same irreversible
// org-delete cascade a super-admin would — and each writes a RetentionRun so that a trigger which
// stops firing shows up as a stale health check instead of as silence.
//
// Every window is configurable. They are business decisions, and a business decision hardcoded into a
// service file is a business decision nobody can change without a deploy.
//
//   WIND-DOWN            a terminated customer gets a grace period to export, then their data goes.
//   DORMANCY             a NON-PAYING account (canceled/suspended) untouched for two years goes. There
//                        is NO warning email — the server has no email/SMS capability at all — which is
//                        exactly why this is gated to accounts that already stopped being customers.
//   DELETE-ON-REQUEST    a customer asks; we have an SLA and we keep it.
//
// The point of all three: "we keep your data as long as you're a customer, and then we don't" has to
// be something that HAPPENS, not something we say. Before this, nothing in the codebase ever deleted
// voter data on a timer — a canceled customer's voter file sat in our database forever.

export const WIND_DOWN_DAYS = Number(process.env.RETENTION_WIND_DOWN_DAYS || 60);
export const DORMANCY_MONTHS = Number(process.env.RETENTION_DORMANCY_MONTHS || 30);
export const DELETE_REQUEST_SLA_DAYS = Number(process.env.RETENTION_DELETE_SLA_DAYS || 30);

export const TRIGGER_JOB = 'retention-triggers';

const DAY = 86_400_000;

/**
 * Never let a scheduled job delete an organization we exempted. `internal` = Doorline's own demo /
 * platform orgs; they are ours, they hold synthetic data, and they must not evaporate because nobody
 * knocked a door in them for two years.
 */
async function isExempt(orgId) {
  const sub = await Subscription.findOne({ organizationId: orgId }, 'status').lean();
  return sub?.status === 'internal';
}

/**
 * 1. WIND-DOWN. A subscription that has been `canceled` for longer than the grace period.
 *
 * The grace period is the customer's window to export. Terminating a contract must not mean their
 * data lingers indefinitely on our servers "just in case" — that is exactly the retention we tell
 * people we don't do.
 */
export async function purgeWoundDownOrgs({ apply = true } = {}) {
  const cutoff = new Date(Date.now() - WIND_DOWN_DAYS * DAY);
  const subs = await Subscription.find(
    { status: 'canceled', statusChangedAt: { $lte: cutoff } },
    'organizationId statusChangedAt'
  ).lean();

  const due = [];
  for (const s of subs) {
    if (await isExempt(s.organizationId)) continue;
    const org = await Organization.findById(s.organizationId, 'name slug').lean();
    if (org) due.push({ org, since: s.statusChangedAt });
  }

  if (!apply) return { due: due.length, purged: 0, orgs: due.map((d) => d.org.slug) };

  let purged = 0;
  for (const d of due) {
    await deleteOrganization(d.org._id);
    purged += 1;
  }
  return { due: due.length, purged, orgs: due.map((d) => d.org.slug) };
}

/**
 * 2. DORMANCY. No canvassing activity for DORMANCY_MONTHS.
 *
 * "Reactivation resets the clock" is not a special case — the clock IS the most recent activity, so a
 * single knock un-dormants an org for another two years by construction. There is nothing to reset.
 */
// A paying/active organization is NEVER dormancy-deleted, no matter how long it has been since the last
// knock. Dormancy is a backstop for accounts that are no longer customers — not a guillotine for a live,
// subscribed org that is simply between election cycles. These statuses mean "still a customer": we do
// not auto-delete them for inactivity.
const DORMANCY_PROTECTED_STATUSES = new Set(['active', 'trial', 'past_due', 'internal']);

export async function purgeDormantOrgs({ apply = true } = {}) {
  const cutoff = new Date(Date.now() - DORMANCY_MONTHS * 30 * DAY);
  const orgs = await Organization.find({ createdAt: { $lte: cutoff } }, 'name slug createdAt').lean();

  const due = [];
  for (const org of orgs) {
    if (await isExempt(org._id)) continue;
    // Gate on subscription status, not knock recency alone. Deleting a paying customer because they
    // did not canvass for two years would be catastrophic — and we have NO email or SMS capability, so
    // we cannot warn anyone first. That makes "only delete an account that is no longer a customer" a
    // hard requirement: dormancy may only ever touch a canceled or suspended org (one that has already
    // stopped paying), never an active, trialing, or past-due one. An org with no subscription record
    // at all is treated as protected (fail safe) rather than deleted.
    const sub = await Subscription.findOne({ organizationId: org._id }, 'status').lean();
    if (!sub || DORMANCY_PROTECTED_STATUSES.has(sub.status)) continue;

    const last = await CanvassActivity.findOne({ organizationId: org._id }, 'timestamp')
      .sort({ timestamp: -1 })
      .lean();
    // An org that never canvassed at all is measured from its creation date, not treated as
    // infinitely dormant — otherwise a customer who signs up on Friday is "dormant" on Monday.
    const lastTouch = last?.timestamp || org.createdAt;
    if (new Date(lastTouch) <= cutoff) due.push({ org, lastTouch });
  }

  if (!apply) return { due: due.length, purged: 0, orgs: due.map((d) => d.org.slug) };

  let purged = 0;
  for (const d of due) {
    await deleteOrganization(d.org._id);
    purged += 1;
  }
  return { due: due.length, purged, orgs: due.map((d) => d.org.slug) };
}

/**
 * 3. DELETE-ON-REQUEST. A customer asked. We have an SLA and this is what keeps it.
 *
 * Executed on the SLA date rather than immediately, on purpose: it gives a wrongly-submitted or
 * coerced request a window to be cancelled, and it gives the customer time to export. The request is
 * `scheduledFor = requestedAt + SLA`, and cancelling is a first-class action until it fires.
 */
// A due request that errors is re-attempted on subsequent sweeps rather than abandoned after one try.
// Only after this many failed attempts does it escalate to the terminal 'failed' state, which the
// retention health surface reports RED. A transient error (a Mongo blip, a lock) self-heals; a real,
// persistent failure becomes loudly visible — never a silent 'completed' the customer would trust.
const MAX_DELETION_ATTEMPTS = Number(process.env.RETENTION_DELETE_MAX_ATTEMPTS || 5);

export async function executeDueDeletionRequests({ apply = true } = {}) {
  const now = new Date();
  const due = await OrgDeletionRequest.find({
    status: 'scheduled',
    scheduledFor: { $lte: now },
  }).lean();

  if (!apply) return { due: due.length, purged: 0, failed: 0 };

  let purged = 0;
  let failed = 0;
  for (const r of due) {
    try {
      await deleteOrganization(r.organizationId);
      await OrgDeletionRequest.updateOne(
        { _id: r._id },
        { $set: { status: 'completed', completedAt: new Date(), error: null }, $inc: { attempts: 1 } }
      );
      purged += 1;
    } catch (err) {
      const attempts = (r.attempts || 0) + 1;
      const giveUp = attempts >= MAX_DELETION_ATTEMPTS;
      // Keep it 'scheduled' (so the next sweep retries) until we've exhausted the budget; only then
      // mark 'failed'. Either way, record the error and the attempt so it is never a silent success.
      await OrgDeletionRequest.updateOne(
        { _id: r._id },
        {
          $set: {
            status: giveUp ? 'failed' : 'scheduled',
            error: String(err?.message || err),
            lastAttemptAt: new Date(),
          },
          $inc: { attempts: 1 },
        }
      );
      if (giveUp) failed += 1;
    }
  }
  return { due: due.length, purged, failed };
}

/**
 * How healthy is the delete-on-request SLA right now? Distinct from "did the job run": a request can
 * be stuck (past its date, still not completed) even while the sweep runs nightly. `stuck` counts
 * requests overdue by more than a day; `failed` counts terminal failures. Either being non-zero means
 * a customer's deletion promise is not being kept, and the retention banner must say so.
 */
export async function deletionRequestHealth() {
  const now = Date.now();
  const overdueCutoff = new Date(now - DAY); // a day's grace past the scheduled date
  const [stuck, failed] = await Promise.all([
    OrgDeletionRequest.countDocuments({ status: 'scheduled', scheduledFor: { $lte: overdueCutoff } }),
    OrgDeletionRequest.countDocuments({ status: 'failed' }),
  ]);
  return { healthy: stuck === 0 && failed === 0, stuck, failed };
}

/**
 * The scheduled sweep: all three triggers, one RetentionRun receipt.
 *
 * Wrapped exactly like the identity purge (services/retention/purgeDeletedIdentities.js) so the same
 * health check catches it going quiet. A retention trigger that stops firing is indistinguishable
 * from one that has nothing to do — unless something is counting.
 *
 * That was aspirational until it wasn't: retentionHealth() hardcoded the purge's job name, so these
 * receipts were written and read by nothing. This sweep could have thrown every night — taking the
 * delete-on-request SLA down with it — while the banner stayed green off the purge beside it. The
 * health surface now asks about every job in scheduler.js's REPEATABLE_JOBS and lets the worst win.
 */
export async function runRetentionTriggers({ apply = true } = {}) {
  const startedAt = new Date();
  const run = await RetentionRun.create({ job: TRIGGER_JOB, startedAt });

  try {
    const windDown = await purgeWoundDownOrgs({ apply });
    const dormant = await purgeDormantOrgs({ apply });
    const requested = await executeDueDeletionRequests({ apply });

    const purged = windDown.purged + dormant.purged + requested.purged;
    const scanned = windDown.due + dormant.due + requested.due;

    await RetentionRun.updateOne(
      { _id: run._id },
      { $set: { finishedAt: new Date(), ok: true, purged, scanned } }
    );
    return { ok: true, windDown, dormant, requested, purged, scanned };
  } catch (err) {
    await RetentionRun.updateOne(
      { _id: run._id },
      { $set: { finishedAt: new Date(), ok: false, error: String(err?.message || err) } }
    );
    throw err;
  }
}
