import mongoose from 'mongoose';
import { ExportJob } from '../../models/ExportJob.js';
import { deleteArtifact, listArtifactJobIds } from './exportArtifactStore.js';

// The nightly artifact TTL sweep. Registered in MAINTENANCE_JOBS (services/retention/
// scheduler.js) — NOT in REPEATABLE_JOBS, which is retention-promise-only and whose count
// the health surface pins. Three passes, all idempotent:
//   1. completed jobs past expiresAt → artifact deleted, status 'expired' (the history row
//      survives with its filename/rowCount/bytes — only the download dies);
//   2. artifacts still attached to terminally-failed/canceled jobs (the processor cleans
//      these on failure, but the import pipeline taught us failure paths leak — this is the
//      backstop that path lacks);
//   3. orphan GridFS files whose ExportJob is gone entirely (crashed retries, races with
//      deletes).

export const EXPORT_SWEEP_JOB = 'sweep-expired-exports';

export async function sweepExpiredExports() {
  const now = new Date();

  const due = await ExportJob.find(
    { status: 'completed', expiresAt: { $lte: now } },
    '_id'
  ).lean();
  for (const job of due) {
    await deleteArtifact(job._id);
    await ExportJob.updateOne(
      { _id: job._id },
      { $set: { status: 'expired', 'artifact.gridFsId': null } }
    );
  }

  const failedWithArtifact = await ExportJob.find(
    { status: { $in: ['failed', 'canceled'] }, 'artifact.gridFsId': { $ne: null } },
    '_id'
  ).lean();
  for (const job of failedWithArtifact) {
    await deleteArtifact(job._id);
    await ExportJob.updateOne({ _id: job._id }, { $set: { 'artifact.gridFsId': null } });
  }

  const inBucket = (await listArtifactJobIds()).filter((id) => mongoose.isValidObjectId(id));
  const known = new Set(
    (await ExportJob.find({ _id: { $in: inBucket } }, '_id').lean()).map((j) => String(j._id))
  );
  const orphans = inBucket.filter((id) => !known.has(String(id)));
  for (const id of orphans) await deleteArtifact(id);

  return { expired: due.length, failedCleaned: failedWithArtifact.length, orphans: orphans.length };
}
