import { Pass } from '../../models/Pass.js';

// Lightweight advisory lock on a pass so destructive book operations can't
// interleave. Two kinds of holders:
//   - WEB requests (discard / restore / snapshot-delete / draft delete): acquire
//     without a token, do their work inside the request, release in finally.
//   - WORKER JOBS (claim re-carve, supplemental cut): acquire WITH a token (the
//     BullMQ jobId) and RENEW from their progress callback, because a 250k-door
//     job legitimately runs past STALE_MS. STALE_MS itself stays short so a lock
//     left by a CRASHED web request frees in minutes — jobs outlive it by
//     renewing, never by us lengthening the staleness window for everyone.
// Atomic acquire via a conditional update; stale locks are reclaimable after
// STALE_MS. Generation (/generate) still takes no lock: it runs on the TURF
// queue (concurrency 1), which already serializes it against the claim and
// supplemental jobs, and the published-books 409 guard covers the web side.
const STALE_MS = 5 * 60 * 1000;

export async function acquireRecutLock(passId, userId, token = null) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const res = await Pass.findOneAndUpdate(
    {
      _id: passId,
      $or: [
        { 'recutLock.lockedAt': null },
        { 'recutLock.lockedAt': { $exists: false } },
        { 'recutLock.lockedAt': { $lt: staleBefore } },
      ],
    },
    { $set: { recutLock: { lockedAt: now, lockedBy: userId || null, token } } },
    { new: true }
  ).lean();
  return !!res;
}

// Re-stamp lockedAt — but ONLY for the holder that presents the matching token
// (CAS), so a job can keep its own lock alive without being able to hijack a
// lock someone else reclaimed after a stall. Returns false when the lock was
// lost (stolen after going stale, or released) — callers should abort: another
// actor may already be mutating the pass.
export async function renewRecutLock(passId, token) {
  if (!token) return false;
  const res = await Pass.updateOne(
    { _id: passId, 'recutLock.token': token },
    { $set: { 'recutLock.lockedAt': new Date() } }
  );
  return res.modifiedCount > 0;
}

// Token-checked when a token is passed (a job must not release a lock it lost);
// unconditional when omitted (web callers, which held the lock for one request).
export async function releaseRecutLock(passId, token = null) {
  const filter = token ? { _id: passId, 'recutLock.token': token } : { _id: passId };
  await Pass.updateOne(filter, { $set: { recutLock: { lockedAt: null, lockedBy: null, token: null } } });
}

// Read-only probe for the advisory pre-check on enqueue routes ("is someone
// re-cutting right now?"). Best-effort by design — the BINDING acquire happens
// inside the job; this just gives the admin an immediate 409 instead of a
// queued job that fails a minute later.
export async function isRecutLocked(passId) {
  const staleBefore = new Date(Date.now() - STALE_MS);
  const pass = await Pass.findById(passId, { recutLock: 1 }).lean();
  return !!(pass?.recutLock?.lockedAt && pass.recutLock.lockedAt >= staleBefore);
}
