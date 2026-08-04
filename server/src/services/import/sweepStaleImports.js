import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { ImportJob } from '../../models/ImportJob.js';

// Stuck-import expiry. A worker V8 OOM-abort (or SIGKILL) skips every catch, so an
// ImportJob can freeze in an active status forever while the client polls it — the
// "Analyzing…" spinner that never ends. Two enforcement points share this module:
//   1. GET /admin/imports/:importId calls maybeExpireStaleImportJob per poll — the
//      web dyno enforces the timeout precisely because the worker is the thing
//      that's dead in this failure.
//   2. The nightly maintenance sweep catches jobs nobody is polling, and deletes
//      raw uploads left behind by terminal/vanished jobs (the GridFS privacy leak).

export const IMPORT_SWEEP_JOB = 'sweep-stale-imports';

const ACTIVE_STATUSES = ['pending', 'parsing', 'geocoding', 'linking', 'importing'];
// 'pending' means no worker ever claimed it — that verdict is safe to reach quickly.
// Anything later means a worker died mid-job; heartbeats ride every progress batch,
// so minutes of silence is death, not slowness.
const UNCLAIMED_MS = 2 * 60 * 1000;
const STALE_MS = 3 * 60 * 1000;

function staleReason(status) {
  return status === 'pending'
    ? 'No import worker picked this up. The worker dyno may be off — check Heroku → Resources.'
    : 'The import worker stopped responding mid-job (it may have run out of memory). Try again, or split the file into smaller parts.';
}

function isStale(job, now = Date.now()) {
  if (!ACTIVE_STATUSES.includes(job.status)) return false;
  const last = job.heartbeatAt || job.startedAt || job.createdAt;
  if (!last) return false;
  const limit = job.status === 'pending' ? UNCLAIMED_MS : STALE_MS;
  return now - new Date(last).getTime() > limit;
}

/**
 * CAS-expire one job if its heartbeat lapsed. The status guard in the filter means
 * a job that resumed (new status) or finished between our read and this write is
 * left alone. Returns true if this call expired it.
 */
export async function maybeExpireStaleImportJob(job) {
  if (!job || !isStale(job)) return false;
  const res = await ImportJob.updateOne(
    { _id: job._id, status: job.status },
    {
      $set: {
        status: 'failed',
        lastError: job.status === 'pending' ? 'stale-unclaimed' : 'stale-heartbeat',
        completedAt: new Date(),
      },
      // Keep the message generic — never echo voter data into errors.
      $push: { errors: { reason: staleReason(job.status) } },
      $inc: { errorCount: 1 },
    }
  );
  return res.modifiedCount > 0;
}

/**
 * Nightly sweep, registered as IMPORT_SWEEP_JOB in the maintenance queue:
 *   - expire active-status jobs whose heartbeat lapsed (jobs nobody is polling);
 *   - delete rawImports GridFS files whose ImportJob is terminal or gone and that
 *     are older than 24h. Crashed imports used to orphan the complete uploaded
 *     voter file here with no TTL and no deletion path.
 */
export async function sweepStaleImportJobs() {
  let expired = 0;
  const stale = await ImportJob.find(
    { status: { $in: ACTIVE_STATUSES } },
    { status: 1, heartbeatAt: 1, startedAt: 1, createdAt: 1 }
  ).lean();
  for (const job of stale) {
    if (await maybeExpireStaleImportJob(job)) expired += 1;
  }

  let rawDeleted = 0;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const files = mongoose.connection.db.collection('rawImports.files');
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'rawImports' });
  const cursor = files.find({ uploadDate: { $lt: cutoff } }, { projection: { _id: 1, filename: 1 } });
  for await (const f of cursor) {
    // filename is the ImportJob id (rawImportStore convention). Keep the file only
    // while its job is still live — an active job within 24h is unusual but legal
    // (huge geocode run); anything terminal or missing has no reader left.
    const jobId = mongoose.isValidObjectId(f.filename) ? f.filename : null;
    const job = jobId ? await ImportJob.findById(jobId, { status: 1 }).lean() : null;
    if (job && ACTIVE_STATUSES.includes(job.status)) continue;
    await bucket.delete(f._id).catch(() => {});
    rawDeleted += 1;
  }

  // Stray worker temp files: ExcelJS's streaming reader spools decompressed sheet
  // XML to the OS temp dir (tmp-*) and a crash skips its cleanup callback; our own
  // import-spill-* files are removed in a finally but a SIGKILL can beat it. Both
  // hold voter PII, so sweep anything older than 24h. Dyno FS is ephemeral, this
  // is belt-and-braces for a long-lived worker.
  let tmpDeleted = 0;
  try {
    const dir = os.tmpdir();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      if (!/^(tmp-|import-spill-)/.test(name)) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile() && st.mtimeMs < dayAgo) {
          fs.rmSync(full, { force: true });
          tmpDeleted += 1;
        }
      } catch { /* raced with another cleaner — fine */ }
    }
  } catch { /* tmpdir unreadable — skip */ }

  return { expired, rawDeleted, tmpDeleted };
}
