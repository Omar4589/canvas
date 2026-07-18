import { Organization } from '../../models/Organization.js';
import { Subscription } from '../../models/Subscription.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { OrgDeletionRequest } from '../../models/OrgDeletionRequest.js';
import { RetentionRun } from '../../models/RetentionRun.js';
import { deleteOrganization } from '../platform/deleteOrganization.js';
import { windDownDeletionDate } from '../billing/windDown.js';
import { sendMail } from '../mail/mailer.js';
import { windDownWarning, dormancyWarning } from '../mail/templates.js';
import { billingNotifyEmails } from '../mail/recipients.js';

// The three disclosed retention triggers. Each is a REAL purge — it calls the same irreversible
// org-delete cascade a super-admin would — and each writes a RetentionRun so that a trigger which
// stops firing shows up as a stale health check instead of as silence.
//
// Every window is configurable. They are business decisions, and a business decision hardcoded into a
// service file is a business decision nobody can change without a deploy.
//
//   WIND-DOWN            a terminated customer gets a grace period to export, then their data goes.
//   DORMANCY             a NON-PAYING account (canceled/suspended) untouched for two years goes.
//   DELETE-ON-REQUEST    a customer asks; we have an SLA and we keep it.
//
// The point of all three: "we keep your data as long as you're a customer, and then we don't" has to
// be something that HAPPENS, not something we say. Before this, nothing in the codebase ever deleted
// voter data on a timer — a canceled customer's voter file sat in our database forever.
//
// WIND-DOWN and DORMANCY additionally WARN before they delete (the warn* stages below), and their
// purges are gated on that warning having actually happened: no org is ever deleted by those two
// triggers unless a warning email was ACCEPTED FOR DELIVERY (or the org has no reachable recipient
// at all) at least WARN_GRACE_DAYS earlier. "We warned you first" is a marker in the database, not
// an intention. DELETE-ON-REQUEST is exempt from warning on purpose — it IS the customer's request.

// WIND_DOWN_DAYS + the deletion-date math live in one shared place so the customer-facing banner and
// this deletion job cannot disagree. Re-exported here for the existing importers/tests.
export { WIND_DOWN_DAYS } from '../billing/windDown.js';
export const DORMANCY_MONTHS = Number(process.env.RETENTION_DORMANCY_MONTHS || 30);
export const DELETE_REQUEST_SLA_DAYS = Number(process.env.RETENTION_DELETE_SLA_DAYS || 30);
// How far ahead of a deletion the warning email goes out, and the minimum time a customer gets
// between the warning actually reaching them and the deletion firing (matters when an org is
// already past its deadline at warn time — it still gets the full grace, never a same-day purge).
export const WARN_LEAD_DAYS = Number(process.env.RETENTION_WARN_LEAD_DAYS || 30);
export const WARN_GRACE_DAYS = Number(process.env.RETENTION_WARN_GRACE_DAYS || 14);

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
 * Deliver one deletion warning and decide whether it counts. The marker a purge trusts means
 * "the customer was actually told" — so it is earned in exactly two ways:
 *   - sendMail returned { sent: true }: Resend ACCEPTED the message. Not "we tried" — a send
 *     that failed, timed out, or ran while mail is dormant (no RESEND_API_KEY yet) returns
 *     sent: false and the org is retried next sweep, unstamped. One bad MAIL_FROM must never
 *     quietly license deleting a never-warned customer.
 *   - The org has ZERO reachable BILLING recipients (no billingAccess admin, no billing contact
 *     on file — recipients are deliberately billing-identities-only, never all admins; see
 *     services/mail/recipients.js). Nothing this notice is allowed to reach will ever be
 *     deliverable, so waiting would only mean keeping their data forever; stamp with a loud
 *     log. In practice every provisioned org starts with a billingAccess admin.
 */
async function deliverWarning({ orgId, orgSlug, template, kind }) {
  const recipients = await billingNotifyEmails(orgId);
  if (!recipients.length) {
    console.warn(
      `[retention] ${kind}: org ${orgSlug} has no reachable billing recipients (no billingAccess admin, no billing contact) — marking warned without an email.`
    );
    return { stamp: true };
  }
  const result = await sendMail({ to: recipients, ...template, kind, meta: { organizationId: orgId } });
  if (!result.sent) {
    console.warn(
      `[retention] ${kind}: warning for ${orgSlug} NOT delivered (${result.disabled ? 'mail dormant' : result.error || 'send failed'}) — not marking; will retry next sweep.`
    );
    return { stamp: false };
  }
  return { stamp: true };
}

/**
 * 1a. WIND-DOWN WARNING. Canceled subscriptions within WARN_LEAD_DAYS of their deletion date
 * (including already overdue) that have never been warned.
 *
 * The date the email promises is PERSISTED (`windDownDeleteNotBefore`) and the purge gates on it:
 * max(the banner's wind-down date, warn time + WARN_GRACE_DAYS). For the normal case that IS the
 * banner date — same windDownDeletionDate() call, so the email, the banner, and the deletion can't
 * disagree. The max() only matters for an org already past its deadline when warnings first ship:
 * it gets the full grace instead of an email naming a date in the past. Persisting also freezes
 * the promise against later env changes — a config edit can delay a deletion, never accelerate it
 * past what a customer was told.
 */
export async function warnWindDownOrgs({ apply = true } = {}) {
  const now = Date.now();
  const subs = await Subscription.find(
    { status: 'canceled', windDownWarnedAt: null },
    'organizationId statusChangedAt'
  ).lean();

  const candidates = [];
  for (const s of subs) {
    const deletionDate = windDownDeletionDate(s.statusChangedAt);
    if (!deletionDate) continue;
    if (deletionDate.getTime() - now > WARN_LEAD_DAYS * DAY) continue;
    if (await isExempt(s.organizationId)) continue;
    const org = await Organization.findById(s.organizationId, 'name slug').lean();
    if (org) candidates.push({ sub: s, org, deletionDate });
  }

  // Dry-run counts only — it must not email a customer, and it must not stamp.
  if (!apply) return { due: candidates.length, warned: 0, orgs: candidates.map((c) => c.org.slug) };

  let warned = 0;
  for (const c of candidates) {
    const deleteNotBefore = new Date(Math.max(c.deletionDate.getTime(), now + WARN_GRACE_DAYS * DAY));
    const { stamp } = await deliverWarning({
      orgId: c.org._id,
      orgSlug: c.org.slug,
      template: windDownWarning({ orgName: c.org.name, deleteOnDate: deleteNotBefore }),
      kind: 'windDownWarning',
    });
    if (!stamp) continue;
    // Guarded on the marker still being null AND the sub still canceled: a concurrent status
    // change (which clears the markers) must not be overwritten by a warning that raced it.
    await Subscription.updateOne(
      { _id: c.sub._id, windDownWarnedAt: null, status: 'canceled' },
      { $set: { windDownWarnedAt: new Date(), windDownDeleteNotBefore: deleteNotBefore } }
    );
    warned += 1;
  }
  return { due: candidates.length, warned, orgs: candidates.map((c) => c.org.slug) };
}

/**
 * 1b. WIND-DOWN PURGE. A subscription that has been `canceled` past the wind-down window — AND
 * whose customer was warned (see warnWindDownOrgs), at least WARN_GRACE_DAYS ago.
 *
 * The grace period is the customer's window to export. Terminating a contract must not mean their
 * data lingers indefinitely on our servers "just in case" — that is exactly the retention we tell
 * people we don't do.
 */
export async function purgeWoundDownOrgs({ apply = true } = {}) {
  const now = Date.now();
  const subs = await Subscription.find(
    { status: 'canceled' },
    'organizationId statusChangedAt windDownWarnedAt windDownDeleteNotBefore'
  ).lean();

  const due = [];
  for (const s of subs) {
    // The due decision is windDownDeletionDate(statusChangedAt) <= now — the SAME function that computes
    // the date shown on the customer's banner, so the banner date IS this boundary. Canceled orgs are
    // few, so an indexed status query + an in-code check per row is fine and keeps the math in one place.
    const deletionDate = windDownDeletionDate(s.statusChangedAt);
    if (!deletionDate || deletionDate.getTime() > now) continue;
    // Never delete unwarned: no marker (the warning was never accepted for delivery — mail down,
    // dormant, or the warn stage hasn't reached them) means NO deletion, this sweep or any sweep.
    // And never before the exact date the warning email named.
    if (!s.windDownWarnedAt || !s.windDownDeleteNotBefore) continue;
    if (new Date(s.windDownDeleteNotBefore).getTime() > now) continue;
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

/**
 * 2a. DORMANCY WARNING. Orgs whose inactivity clock will cross DORMANCY_MONTHS within
 * WARN_LEAD_DAYS (or already has), on a non-protected subscription, never warned.
 *
 * Same delivery/stamp semantics as wind-down. The promised date is max(the org's natural
 * dormancy-purge date, warn time + WARN_GRACE_DAYS), persisted on the Organization. The email
 * says it plainly: any recorded canvassing activity cancels the deletion — and the purge below
 * enforces exactly that.
 */
export async function warnDormantOrgs({ apply = true } = {}) {
  const now = Date.now();
  const cutoff = new Date(now - DORMANCY_MONTHS * 30 * DAY);
  // An org is warn-eligible when its last activity is within WARN_LEAD_DAYS of the dormancy
  // boundary — i.e. it will become purge-eligible within the lead window if nobody knocks.
  const warnHorizon = new Date(cutoff.getTime() + WARN_LEAD_DAYS * DAY);
  const orgs = await Organization.find(
    { createdAt: { $lte: warnHorizon }, dormancyWarnedAt: null },
    'name slug createdAt'
  ).lean();

  const candidates = [];
  for (const org of orgs) {
    if (await isExempt(org._id)) continue;
    const sub = await Subscription.findOne({ organizationId: org._id }, 'status').lean();
    if (!sub || DORMANCY_PROTECTED_STATUSES.has(sub.status)) continue;
    const last = await CanvassActivity.findOne({ organizationId: org._id }, 'timestamp')
      .sort({ timestamp: -1 })
      .lean();
    const lastTouch = new Date(last?.timestamp || org.createdAt);
    if (lastTouch > warnHorizon) continue;
    const naturalPurgeAt = new Date(lastTouch.getTime() + DORMANCY_MONTHS * 30 * DAY);
    candidates.push({ org, naturalPurgeAt });
  }

  // Dry-run counts only — it must not email a customer, and it must not stamp.
  if (!apply) return { due: candidates.length, warned: 0, orgs: candidates.map((c) => c.org.slug) };

  let warned = 0;
  for (const c of candidates) {
    const deleteNotBefore = new Date(Math.max(c.naturalPurgeAt.getTime(), now + WARN_GRACE_DAYS * DAY));
    const { stamp } = await deliverWarning({
      orgId: c.org._id,
      orgSlug: c.org.slug,
      template: dormancyWarning({ orgName: c.org.name, deleteOnDate: deleteNotBefore }),
      kind: 'dormancyWarning',
    });
    if (!stamp) continue;
    await Organization.updateOne(
      { _id: c.org._id, dormancyWarnedAt: null },
      { $set: { dormancyWarnedAt: new Date(), dormancyDeleteNotBefore: deleteNotBefore } }
    );
    warned += 1;
  }
  return { due: candidates.length, warned, orgs: candidates.map((c) => c.org.slug) };
}

export async function purgeDormantOrgs({ apply = true } = {}) {
  const now = Date.now();
  const cutoff = new Date(now - DORMANCY_MONTHS * 30 * DAY);
  const orgs = await Organization.find(
    { createdAt: { $lte: cutoff } },
    'name slug createdAt dormancyWarnedAt dormancyDeleteNotBefore'
  ).lean();

  const due = [];
  for (const org of orgs) {
    if (await isExempt(org._id)) continue;
    // Gate on subscription status, not knock recency alone. Deleting a paying customer because
    // they did not canvass for two years would be catastrophic. Even with the warning emails
    // below, "only delete an account that is no longer a customer" stays a hard requirement:
    // dormancy may only ever touch a canceled or suspended org (one that has already stopped
    // paying), never an active, trialing, or past-due one. An org with no subscription record
    // at all is treated as protected (fail safe) rather than deleted.
    const sub = await Subscription.findOne({ organizationId: org._id }, 'status').lean();
    if (!sub || DORMANCY_PROTECTED_STATUSES.has(sub.status)) continue;

    const last = await CanvassActivity.findOne({ organizationId: org._id }, 'timestamp')
      .sort({ timestamp: -1 })
      .lean();
    // An org that never canvassed at all is measured from its creation date, not treated as
    // infinitely dormant — otherwise a customer who signs up on Friday is "dormant" on Monday.
    const lastTouch = new Date(last?.timestamp || org.createdAt);

    // Activity AFTER the warning voids it — "any recorded canvassing activity cancels this" is
    // what the email promised. Clear the marker so a future dormancy stretch starts from a
    // fresh warning instead of trusting a stale one.
    if (org.dormancyWarnedAt && lastTouch > new Date(org.dormancyWarnedAt)) {
      if (apply) {
        await Organization.updateOne(
          { _id: org._id },
          { $set: { dormancyWarnedAt: null, dormancyDeleteNotBefore: null } }
        );
      }
      continue;
    }
    if (lastTouch > cutoff) continue;
    // Never delete unwarned (see purgeWoundDownOrgs) — and never before the date the email named.
    if (!org.dormancyWarnedAt || !org.dormancyDeleteNotBefore) continue;
    if (new Date(org.dormancyDeleteNotBefore).getTime() > now) continue;
    due.push({ org, lastTouch });
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
    // Warnings run FIRST, so a sweep's receipt always shows warns ahead of the purges they
    // license. A freshly-warned org can never be purged in the same sweep by construction:
    // its deleteNotBefore is at least WARN_GRACE_DAYS in the future.
    const warnWindDown = await warnWindDownOrgs({ apply });
    const warnDormant = await warnDormantOrgs({ apply });
    const windDown = await purgeWoundDownOrgs({ apply });
    const dormant = await purgeDormantOrgs({ apply });
    const requested = await executeDueDeletionRequests({ apply });

    const purged = windDown.purged + dormant.purged + requested.purged;
    const scanned = windDown.due + dormant.due + requested.due;
    const warned = warnWindDown.warned + warnDormant.warned;

    await RetentionRun.updateOne(
      { _id: run._id },
      { $set: { finishedAt: new Date(), ok: true, purged, scanned, warned } }
    );
    return { ok: true, warnWindDown, warnDormant, windDown, dormant, requested, purged, scanned, warned };
  } catch (err) {
    await RetentionRun.updateOne(
      { _id: run._id },
      { $set: { finishedAt: new Date(), ok: false, error: String(err?.message || err) } }
    );
    throw err;
  }
}
