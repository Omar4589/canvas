import { Organization } from '../../models/Organization.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { isDeleting, maybeExpireStaleDeletion } from './orgDeletionState.js';

// Queue calls are time-bounded: ioredis buffers commands while disconnected, so without this a
// wedged/absent Redis would HANG the caller rather than failing it — and for the nightly sweep
// that means one unreachable Redis stalls the whole retention run.
const queueOp = (promise, ms = Number(process.env.ORG_DELETE_ENQUEUE_TIMEOUT_MS || 5000)) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('queue timeout')), ms).unref?.()),
  ]);

/**
 * THE single place an organization's deletion stamp is written. All four delete paths go through
 * here — the break-glass route and the three retention triggers (wind-down, dormancy,
 * delete-on-request) — so the CAS, the rollback and the job options exist exactly once.
 *
 * Returns one of:
 *   { queued: true, organization }  — stamped and enqueued; the worker owns it now
 *   { alreadyDeleting: true }       — a live stamp already exists (double click, second tab, or
 *                                     last night's sweep); idempotent, do nothing
 *   { gone: true }                  — the org no longer exists (already destroyed). Callers that
 *                                     track a request row use this to close it: the promise WAS kept.
 * Throws with `err.code = 'queue-unavailable'` when the enqueue fails; the stamp is restored first.
 */
export async function stampAndEnqueueOrgDelete({ orgId, source, requestedBy = null, requestId = null }) {
  const org = await Organization.findById(orgId, { name: 1, slug: 1, deletion: 1 });
  if (!org) return { gone: true };

  // A stale stamp must not wedge the retry path — expire it first, then a `failed` stamp falls
  // through to be re-stamped (that IS the retry), while a live pending/running one short-circuits.
  if (isDeleting(org)) {
    const expired = await maybeExpireStaleDeletion(org);
    if (!expired && ['pending', 'running'].includes(org.deletion.status)) {
      return { alreadyDeleting: true };
    }
  }

  // Remember a failed quarantine so an enqueue failure restores it rather than silently lifting
  // the wall off a possibly half-destroyed org.
  const prevDeletion = isDeleting(org)
    ? {
        requestedAt: org.deletion.requestedAt,
        requestedBy: org.deletion.requestedBy || null,
        source: org.deletion.source || null,
        requestId: org.deletion.requestId || null,
        status: 'failed',
        heartbeatAt: org.deletion.heartbeatAt || null,
        error: org.deletion.error || null,
      }
    : null;

  const requestedAt = new Date();
  const stamped = await Organization.findOneAndUpdate(
    {
      _id: org._id,
      // Admits a fresh request and a failed-run retry; refuses to stomp a concurrent
      // pending/running stamp from another writer — that race is an idempotent no-op.
      $or: [{ 'deletion.requestedAt': null }, { 'deletion.status': 'failed' }],
    },
    {
      $set: {
        deletion: { requestedAt, requestedBy, source, requestId, status: 'pending', heartbeatAt: null, error: null },
      },
    },
    { new: true }
  );
  if (!stamped) return { alreadyDeleting: true };

  try {
    await queueOp(
      getQueue(QUEUE_NAMES.ORG_DELETE).add(
        'org-delete',
        { organizationId: String(org._id), source, requestId: requestId ? String(requestId) : null },
        // Stable id so a duplicate submit can't double-run. removeOnComplete/Fail matter: a
        // finished job squatting on this id would make the NEXT add — i.e. Retry — a silent no-op.
        { jobId: String(org._id), removeOnComplete: true, removeOnFail: true }
      )
    );
  } catch (err) {
    // No tenant walled off for a job that never entered the queue. Guarded on OUR stamp so a
    // racing worker claim is left alone; if the poll-side expiry beat us here the CAS simply
    // misses and the row stays `failed`, which is the truth anyway.
    await Organization.updateOne(
      { _id: org._id, 'deletion.requestedAt': requestedAt, 'deletion.status': 'pending' },
      {
        $set: {
          deletion: prevDeletion || {
            requestedAt: null, requestedBy: null, source: null, requestId: null,
            status: null, heartbeatAt: null, error: null,
          },
        },
      }
    ).catch(() => {});
    const wrapped = new Error(`Could not queue the delete: ${err?.message || err}`);
    wrapped.code = 'queue-unavailable';
    throw wrapped;
  }

  return { queued: true, organization: { id: String(org._id), name: org.name, slug: org.slug } };
}
