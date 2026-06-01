import { Pass } from '../../models/Pass.js';

// Lightweight advisory lock on a pass so two destructive re-cut operations
// (discard / restore) can't interleave. Atomic acquire via a conditional update;
// stale locks (left by a crash) are reclaimable after STALE_MS. Generation runs
// on the worker and is already serialized by BullMQ + UI gating, so it does not
// take this lock — this only guards the web-side discard/restore writes.
const STALE_MS = 5 * 60 * 1000;

export async function acquireRecutLock(passId, userId) {
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
    { $set: { recutLock: { lockedAt: now, lockedBy: userId || null } } },
    { new: true }
  ).lean();
  return !!res;
}

export async function releaseRecutLock(passId) {
  await Pass.updateOne({ _id: passId }, { $set: { recutLock: { lockedAt: null, lockedBy: null } } });
}
