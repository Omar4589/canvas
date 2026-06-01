import mongoose from 'mongoose';

// The web dyno receives the upload but the worker is a separate dyno with its
// own filesystem, so the raw CSV is stashed in MongoDB GridFS keyed by the
// ImportJob id (used as the GridFS filename) and streamed back by the worker.
const BUCKET = 'rawImports';

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET });
}

export function saveRawImport(importJobId, filename, buffer) {
  return new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(String(importJobId), {
      metadata: { importJobId: String(importJobId), filename },
    });
    stream.on('error', reject);
    stream.on('finish', () => resolve(stream.id));
    stream.end(buffer);
  });
}

export function loadRawImport(importJobId) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = bucket().openDownloadStreamByName(String(importJobId));
    stream.on('data', (c) => chunks.push(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export async function deleteRawImport(importJobId) {
  const b = bucket();
  const files = await mongoose.connection.db
    .collection(`${BUCKET}.files`)
    .find({ filename: String(importJobId) })
    .toArray();
  await Promise.all(files.map((f) => b.delete(f._id).catch(() => {})));
}
