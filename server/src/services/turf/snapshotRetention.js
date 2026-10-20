import { Pass } from '../../models/Pass.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';

// A round's snapshots go with the round.
//
// A TurfSnapshot is the undo of a discard or a re-cut: the round's books and assignments, and — when
// the admin also cleared the round's knocks — every cleared entry, survey, note and earlier answer,
// verbatim (services/turf/snapshot.js). Only its own round can take it back: Turf Cutting lists a
// round's snapshots on that round, and the restore refuses once the round is gone. So when a round was
// deleted (a draft round, or every draft round of a deleted walk list) its snapshots stayed on file
// where no screen reached them, answers and notes included, until the whole campaign was deleted
// (code review round 9, 2026-10-20: privacy item 32's owner flag). Now the round's delete takes them,
// and this nightly sweep takes any whose round is gone anyway — the ones left before this existed,
// and any a delete stopped short of.

export const SNAPSHOT_SWEEP_JOB = 'sweep-orphan-snapshots';

/** Delete these rounds' snapshots — called by each round delete, after the round itself is gone. */
export const deleteRoundSnapshots = async (campaignId, passIds) => {
  const ids = (passIds || []).filter(Boolean);
  if (!ids.length) return 0;
  const res = await TurfSnapshot.deleteMany({ campaignId, passId: { $in: ids } });
  return res.deletedCount || 0;
};

/**
 * Every snapshot whose round no longer exists, deleted (or counted, with apply:false). A round once
 * deleted never comes back, and a snapshot is only ever taken of a round on file, so a snapshot read
 * here with no round is one nothing can restore.
 */
export const sweepOrphanSnapshots = async ({ apply = true } = {}) => {
  const passIds = await TurfSnapshot.distinct('passId');
  if (!passIds.length) return { rounds: 0, deleted: 0 };
  const onFile = new Set((await Pass.distinct('_id', { _id: { $in: passIds } })).map(String));
  const gone = passIds.filter((id) => id && !onFile.has(String(id)));
  if (!gone.length) return { rounds: 0, deleted: 0 };
  if (!apply) return { rounds: gone.length, deleted: await TurfSnapshot.countDocuments({ passId: { $in: gone } }) };
  const res = await TurfSnapshot.deleteMany({ passId: { $in: gone } });
  return { rounds: gone.length, deleted: res.deletedCount || 0 };
};
