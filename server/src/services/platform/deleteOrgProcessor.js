import { Organization } from '../../models/Organization.js';
import { OrgDeletionRequest } from '../../models/OrgDeletionRequest.js';
import { deleteOrganization } from './deleteOrganization.js';

// Organization hard-delete, on the worker dyno. Every path (break-glass route + the three
// retention triggers) stamps `organization.deletion` and enqueues; the Organization doc IS the job
// record — success is the row being GONE (the cascade's last line deletes it), so this processor
// never writes a "completed" state. Idempotent: the cascade converges on re-run and the
// platform-stats bank is claim-guarded, so BullMQ retries after a crash are safe.
//
// There is deliberately NO claim-time gate re-check here, unlike the campaign processor's
// `campaignHasCanvassed`. An org has no "you may not delete this after all" condition: the typed
// slug, the wind-down window, the dormancy warning and the 30-day SLA are all upstream gates, and
// every one of them is irreversible by design once it fires.
export async function processOrgDeleteJob(job) {
  const orgId = job.data?.organizationId;
  const requestId = job.data?.requestId || null;
  const org = orgId ? await Organization.findById(orgId) : null;

  // Already gone. For a delete-on-request job this is NOT a plain no-op: a prior attempt may have
  // completed the cascade and died before closing the request row, which would leave the customer's
  // request reading 'scheduled' forever with no org left to delete.
  if (!org) {
    if (requestId) await closeRequestCompleted(requestId);
    return null;
  }

  // Claim: flip to running. Accepts pending (normal), failed (retry attempt 2+ — the catch below
  // marked it), and running (stalled-job redelivery). The one refusal is an UNSTAMPED doc — the
  // enqueue-failure path clears the stamp, and a stray redelivery must never destroy a tenant
  // nobody asked to destroy.
  const claimed = await Organization.findOneAndUpdate(
    { _id: org._id, 'deletion.requestedAt': { $ne: null } },
    { $set: { 'deletion.status': 'running', 'deletion.heartbeatAt': new Date(), 'deletion.error': null } },
    { new: true }
  );
  if (!claimed) return null;

  const failWith = (message) =>
    Organization.updateOne(
      // Status guard: never stomp a fresh `pending` re-stamp from an operator retry racing us.
      { _id: org._id, 'deletion.status': 'running' },
      { $set: { 'deletion.status': 'failed', 'deletion.error': message } }
    ).catch(() => {});

  // Liveness rides a timer, not just cascade stage boundaries: an org-wide Voter.deleteMany and
  // captureOrgBeforeDelete's org-wide aggregation are single multi-minute awaits with no boundary
  // inside. The event loop is free during those awaits so the timer fires; an OOM/SIGKILL stops it,
  // which is exactly the failure the poll-side expiry exists to catch.
  const writeHeartbeat = () =>
    Organization.updateOne(
      { _id: org._id, 'deletion.status': 'running' },
      { $set: { 'deletion.heartbeatAt': new Date() } }
    ).catch(() => {});
  const hbTimer = setInterval(writeHeartbeat, 30_000);
  hbTimer.unref?.();
  let lastBeatAt = 0;
  const heartbeat = () => {
    const now = Date.now();
    if (now - lastBeatAt < 1000) return;
    lastBeatAt = now;
    writeHeartbeat();
  };

  try {
    const summary = await deleteOrganization(org._id, { heartbeat });
    console.warn(
      `[org-delete] ${summary.organization.slug} (${job.data?.source || 'unknown'}) deleted`,
      summary.counts,
      `persons=${summary.personsPurged}`
    );
    // AFTER the cascade, never before: closing the request first would record a deletion that has
    // not happened. A crash in the gap is covered by the `if (!org)` branch above on redelivery.
    const rid = requestId || claimed.deletion?.requestId;
    if (rid) await closeRequestCompleted(rid);
    return summary; // the integration test's hook onto the exhaustive-sweep counts
  } catch (err) {
    // Mark failed on EVERY attempt (a queue retry flips it back to running via the claim above, so
    // the row never lies for long). Generic message — never echo org or voter content.
    console.error(`[org-delete] ${org.slug} failed:`, err?.message || err);
    await failWith('The delete stopped partway. Retry to finish removing this organization.');
    if (requestId) await noteRequestAttempt(requestId, err);
    throw err;
  } finally {
    clearInterval(hbTimer);
  }
}

const closeRequestCompleted = (requestId) =>
  OrgDeletionRequest.updateOne(
    // Status-guarded so a cancelled or already-failed request is never resurrected.
    { _id: requestId, status: 'scheduled' },
    { $set: { status: 'completed', completedAt: new Date(), error: null } }
  ).catch(() => {});

// Records WHAT went wrong and WHEN, and deliberately does NOT touch `status` or `attempts`. The
// MAX_DELETION_ATTEMPTS ladder stays owned by the nightly sweep, which increments at enqueue time
// — otherwise BullMQ's 3 attempts and the sweep's 5 would compound into 15.
const noteRequestAttempt = (requestId, err) =>
  OrgDeletionRequest.updateOne(
    { _id: requestId, status: 'scheduled' },
    { $set: { error: String(err?.message || err), lastAttemptAt: new Date() } }
  ).catch(() => {});
