// Is an unknock still removing, or did it stop?
//
// A strike runs inside its request and has no job: a `pending` run is either one still working — it
// beats `heartbeatAt` between every step — or one whose request died (a dyno restart, the database
// dropping out). Telling them apart by the beat, never by `pending` alone: round 3 offered Undo on any
// pending run that had begun removing, and an Undo pressed while the strike still ran put back half of
// it, after which the strike finished over the undo — entries gone, their answers live, and the
// removal never undoable again (code review round 4; at 25,000 entries the strike ran for minutes).
//
// Ten minutes without a beat, the same rule as an unknock's undo (`revertingAt`) and an answer edit's
// Start again. A run from before the beat existed is judged by when it began removing, else by when
// it was created.

import crypto from 'node:crypto';
import mongoose from 'mongoose';

export const UNKNOCK_STALE_MS = 10 * 60 * 1000;

/** When the strike last showed it was alive. Takes a doc or a lean row. */
export const unknockLastBeat = (r) => r.heartbeatAt || r.deletingAt || r.createdAt || null;

/**
 * A pending unknock whose strike is still running (it beat within UNKNOCK_STALE_MS, and hasn't failed —
 * a strike that fails in process stamps `stoppedAt`, round 6).
 */
export const unknockRemoving = (r, now = Date.now()) => {
  const beat = unknockLastBeat(r);
  return r.status === 'pending' && !r.stoppedAt && !!beat && now - new Date(beat).getTime() < UNKNOCK_STALE_MS;
};

/** A filter for pending unknocks whose strike is still running — the query twin of unknockRemoving. */
export const UNKNOCK_REMOVING = (now = Date.now()) => {
  const since = new Date(now - UNKNOCK_STALE_MS);
  return {
    status: 'pending',
    stoppedAt: null,
    $or: [
      { heartbeatAt: { $gte: since } },
      { heartbeatAt: null, deletingAt: { $gte: since } },
      { heartbeatAt: null, deletingAt: null, createdAt: { $gte: since } },
    ],
  };
};

/**
 * A run's History row for one act ('strike' or 'undo'), once: the id is derived from the run and the
 * act, so a strike or an undo that is retried, or stopped after writing it, never logs twice — nor
 * does the console step that marks a run that stopped before the stamp existed (round 5).
 */
export const unknockHistoryRowId = (runId, act) =>
  new mongoose.Types.ObjectId(crypto.createHash('sha1').update(`unknock|${String(runId)}|${act}`).digest('hex').slice(0, 24));
