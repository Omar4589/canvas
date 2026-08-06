import mongoose from 'mongoose';

// Finished export artifacts live in their own GridFS bucket in the SAME Atlas deployment
// (no new subprocessor — DPA §6 unchanged), keyed like rawImportStore.js: the GridFS
// filename is the ExportJob id, so delete/download need no separate pointer. One GridFS
// file per job — a single CSV, or one ZIP for multi-file bundles — which keeps deletion
// idempotent for the retry cleanup, the TTL sweeper, DELETE /:id, and the org/campaign
// delete cascades alike.
const BUCKET = 'exportArtifacts';

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET });
}

// Streaming upload — the processor pipes CSV/ZIP bytes through; nothing buffers the whole
// artifact in memory. organizationId/campaignId ride along in metadata so cascade purges
// and orphan sweeps can find files even if the ExportJob doc is already gone.
export function openArtifactUploadStream(exportJobId, { filename, contentType, organizationId, campaignId }) {
  return bucket().openUploadStream(String(exportJobId), {
    contentType,
    metadata: {
      exportJobId: String(exportJobId),
      organizationId: String(organizationId),
      campaignId: campaignId ? String(campaignId) : null,
      filename,
    },
  });
}

export function openArtifactDownloadStream(exportJobId) {
  return bucket().openDownloadStreamByName(String(exportJobId));
}

// Idempotent: deleting a job with no artifact (or a half-written one from a crashed
// attempt) is a no-op per file, same shape as deleteRawImport.
export async function deleteArtifact(exportJobId) {
  const b = bucket();
  const files = await mongoose.connection.db
    .collection(`${BUCKET}.files`)
    .find({ filename: String(exportJobId) })
    .toArray();
  await Promise.all(files.map((f) => b.delete(f._id).catch(() => {})));
}

// length/uploadDate/_id of the stored file — the processor stamps ExportJob.bytes and
// artifact.gridFsId from this after the upload stream finishes.
export async function artifactStats(exportJobId) {
  const file = await mongoose.connection.db
    .collection(`${BUCKET}.files`)
    .findOne({ filename: String(exportJobId) }, { sort: { uploadDate: -1 } });
  if (!file) return null;
  return { gridFsId: file._id, bytes: file.length, uploadDate: file.uploadDate };
}

// Orphan sweep support: files whose ExportJob no longer exists (crashed retries, races
// with deletes). Returns the distinct exportJobIds present in the bucket.
export async function listArtifactJobIds() {
  return mongoose.connection.db.collection(`${BUCKET}.files`).distinct('filename');
}

// Cascade purge for org/campaign deletion — finds files by metadata, not by job list, so
// artifacts survive-proof even when ExportJob docs were removed first.
//
// Cursor + bounded parallelism, not `find().toArray()` + `Promise.all` over everything: an ORG
// delete can match every artifact the tenant ever produced, and each bucket.delete is two
// collection deletes (the .files row plus a whole .chunks range). 100 in flight is plenty of
// parallelism with bounded memory. `onProgress` lets a long cascade stamp liveness; both new
// options default, so existing callers are unchanged.
export async function deleteArtifactsForScope({ organizationId, campaignId, chunk = 100, onProgress } = {}) {
  const b = bucket();
  const q = {};
  if (organizationId) q['metadata.organizationId'] = String(organizationId);
  if (campaignId) q['metadata.campaignId'] = String(campaignId);
  const cursor = mongoose.connection.db
    .collection(`${BUCKET}.files`)
    .find(q, { projection: { _id: 1 } });
  let deleted = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    await Promise.all(batch.map((id) => b.delete(id).catch(() => {})));
    deleted += batch.length;
    batch = [];
    onProgress?.(deleted);
  };
  for await (const f of cursor) {
    batch.push(f._id);
    if (batch.length >= chunk) await flush();
  }
  await flush();
  return deleted;
}
