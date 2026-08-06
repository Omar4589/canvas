import { Organization } from '../../models/Organization.js';

// Organization hard-delete runs as a background job (deleteOrgProcessor.js), and the Organization
// doc itself is the job record — `deletion.requestedAt` set means the tenant is mid-delete (or its
// delete FAILED and it may be half-destroyed). Either way the WHOLE TENANT is walled: spread
// NOT_DELETING into every query that resolves or lists organizations. The one chokepoint that
// matters is middleware/orgContext.js — a deleting org resolves as gone there, so every /admin and
// /mobile request 404s with code ORG_CONTEXT and both clients recover by ejecting to the org picker.
// A `failed` deletion stays walled on purpose; the only exits are Retry or completion (row gone).
export const NOT_DELETING = { 'deletion.requestedAt': null };

export const isDeleting = (org) => !!org?.deletion?.requestedAt;

// Stuck-deletion expiry. Both windows are much longer than the campaign equivalents (2min/3min,
// services/campaigns/deletionState.js) and for different reasons:
//   - UNCLAIMED: concurrency is 1 and the nightly sweep can enqueue several orgs at once, so the
//     seventh org legitimately waits behind six multi-minute cascades. A short window would fail
//     perfectly healthy queued jobs. 6h is longer than any real night's backlog and still catches
//     "the worker dyno is off" before the next sweep compounds it.
//   - STALE: the processor heartbeats on a 30s timer, so 20min is 40 beats of silence. An org
//     cascade holds longer single awaits than a campaign's (an org-wide Voter.deleteMany, and
//     captureOrgBeforeDelete's org-wide aggregation), and an Atlas failover can stall a write for
//     minutes. Expiring too eagerly is not free: the operator's Retry re-stamps to `pending` but
//     BullMQ dedupes the re-add against the still-active job, so the doc reads pending while the
//     real run finishes and deletes the org. It converges, but the UI lied in the meantime.
const UNCLAIMED_MS = 6 * 60 * 60 * 1000;
const STALE_MS = 20 * 60 * 1000;

function staleReason(status) {
  return status === 'pending'
    ? 'No worker picked this delete up. The worker dyno may be off, or the delete queue is backed up — retry once it is running.'
    : 'The worker stopped responding mid-delete. Retry to finish removing this organization.';
}

function isStaleDeletion(org, now = Date.now()) {
  const d = org?.deletion;
  if (!d?.requestedAt || !['pending', 'running'].includes(d.status)) return false;
  const last = d.status === 'pending' ? d.requestedAt : d.heartbeatAt || d.requestedAt;
  const limit = d.status === 'pending' ? UNCLAIMED_MS : STALE_MS;
  return now - new Date(last).getTime() > limit;
}

/**
 * CAS-expire one deletion whose heartbeat lapsed, flipping it to 'failed' so the Organizations
 * page shows Retry. Called from the super-admin org list per poll — the web dyno enforces the
 * timeout precisely because the worker is the thing that's dead in this failure (the
 * maybeExpireStaleImportJob / maybeExpireStaleDeletion pattern). The status+heartbeat guard leaves
 * a run that progressed between our read and this write alone. Returns true if this call expired it.
 */
export async function maybeExpireStaleDeletion(org) {
  if (!isStaleDeletion(org)) return false;
  const res = await Organization.updateOne(
    {
      _id: org._id,
      'deletion.status': org.deletion.status,
      'deletion.heartbeatAt': org.deletion.heartbeatAt ?? null,
    },
    { $set: { 'deletion.status': 'failed', 'deletion.error': staleReason(org.deletion.status) } }
  );
  return res.modifiedCount > 0;
}

/**
 * Platform-wide health for the super-admin retention banner (routes/superAdmin/access.js).
 * FOUR counters, not two, because a deep queue is normal here: on a sweep night a dozen orgs
 * legitimately sit `pending` for hours, and a banner that reads "NOT ENFORCED" every time the
 * sweep does its job is a banner people learn to ignore. So `queued` is reported but does NOT
 * make the surface unhealthy; only a failure, a dead run, or a never-started one does.
 */
export async function orgDeletionHealth() {
  const now = Date.now();
  const stuckCutoff = new Date(now - 2 * STALE_MS);
  const unclaimedCutoff = new Date(now - UNCLAIMED_MS);
  const [failed, stuck, unstarted, queued] = await Promise.all([
    Organization.countDocuments({ 'deletion.status': 'failed' }),
    Organization.countDocuments({
      'deletion.status': 'running',
      $or: [{ 'deletion.heartbeatAt': null }, { 'deletion.heartbeatAt': { $lte: stuckCutoff } }],
    }),
    Organization.countDocuments({
      'deletion.status': 'pending',
      'deletion.requestedAt': { $lte: unclaimedCutoff },
    }),
    Organization.countDocuments({
      'deletion.status': 'pending',
      'deletion.requestedAt': { $gt: unclaimedCutoff },
    }),
  ]);
  return { healthy: failed === 0 && stuck === 0 && unstarted === 0, failed, stuck, unstarted, queued };
}
