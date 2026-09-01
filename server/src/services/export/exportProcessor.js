import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { UnrecoverableError } from 'bullmq';
import { ExportJob } from '../../models/ExportJob.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { createCsvWriter } from './csvWriter.js';
import { openArtifactUploadStream, deleteArtifact, artifactStats } from './exportArtifactStore.js';
import { EXPORT_TYPES, exportFilename } from './exportTypes.js';
import { loadDncVoterIdSet } from './exportScope.js';
import { ExportUserError } from './exportErrors.js';
import { SUBJECT_CAP } from '../access/supportAccess.js';

// The export-queue consumer (worker dyno). Streams rows from the builders into a GridFS
// artifact — CSV straight through, or entries in one ZIP — without ever materializing the
// file in memory, then stamps the ExportJob doc as the durable record of what was written
// (rows/bytes/subjects; the download response is chunked, so accessLog can't count it).

export const EXPORT_TTL_DAYS = Number(process.env.EXPORT_TTL_DAYS || 7);
const MAX_BYTES = Number(process.env.EXPORT_MAX_BYTES || 512 * 1024 * 1024);

class ExportTooLargeError extends ExportUserError {
  constructor() {
    super('Export exceeded the size limit — narrow the filters and try again.');
  }
}

// Distinct-id collector for the download route's addAuditSubjects. Dedupe is capped (an
// org-wide backup can emit more ids than are worth holding); past the cap we stop
// collecting and mark truncated — subjectsTotal is then "distinct ids seen up to the cap",
// the same honesty contract as capSubjects.
const DEDUPE_CAP = 100000;
const makeSubjects = () => {
  const set = new Set();
  let overflow = false;
  return {
    add(id) {
      if (!id) return;
      if (set.size >= DEDUPE_CAP) {
        overflow = true;
        return;
      }
      set.add(String(id));
    },
    result() {
      const ids = [...set];
      return {
        subjectIds: ids.slice(0, SUBJECT_CAP),
        subjectsTruncated: overflow || ids.length > SUBJECT_CAP,
        subjectsTotal: ids.length,
      };
    },
  };
};

// Wrap a csvWriter so cumulative uncompressed bytes enforce the artifact cap.
const capWriter = (writer, tally) => ({
  writeRow: async (cells) => {
    await writer.writeRow(cells);
    tally.add(writer);
    if (tally.total() > MAX_BYTES) throw new ExportTooLargeError();
  },
  get rowsWritten() {
    return writer.rowsWritten;
  },
});

const makeTally = () => {
  let closed = 0;
  let current = null;
  return {
    add(writer) {
      current = writer;
    },
    closeCurrent() {
      if (current) closed += current.bytesWritten;
      current = null;
    },
    total() {
      return closed + (current ? current.bytesWritten : 0);
    },
  };
};

// Single-CSV artifact: the one file streams straight into the GridFS upload.
const csvSink = (upload) => {
  const tally = makeTally();
  let writer = null;
  return {
    async file(name, headers) {
      if (writer) throw new Error(`single-CSV export tried to open a second file (${name})`);
      writer = createCsvWriter(upload);
      await writer.writeHeader(headers);
      const capped = capWriter(writer, tally);
      tally.add(writer);
      return capped;
    },
    async raw(name) {
      throw new Error(`single-CSV export cannot carry a raw entry (${name})`);
    },
    async finalize() {
      if (writer) await writer.end();
      else await new Promise((resolve, reject) => { upload.on('error', reject); upload.on('finish', resolve); upload.end(); });
    },
  };
};

// ZIP artifact: sequential entries appended to one archive piped into the upload.
// Sequential is load-bearing — a second source appended before the first PassThrough ends
// buffers wholesale in archiver's queue.
const zipSink = (upload) => {
  // Level env-tunable: tests run level 0 (stored blocks — raw bytes greppable) so the
  // registry-driven DNC sweep can assert on ZIP artifacts without a zip-reader dependency.
  const archive = archiver('zip', { zlib: { level: Number(process.env.EXPORT_ZIP_LEVEL ?? 6) } });
  let archiveError = null;
  archive.on('error', (err) => { archiveError = err; });
  archive.on('warning', (err) => console.warn('[export] archiver warning:', err?.message || err));
  archive.pipe(upload);
  const tally = makeTally();
  let current = null; // { writer }

  const closeCurrent = async () => {
    if (archiveError) throw archiveError;
    if (current) {
      await current.writer.end(); // ends the PassThrough; resolves when archiver has consumed it
      tally.closeCurrent();
      current = null;
    }
  };

  return {
    async file(name, headers) {
      await closeCurrent();
      const pt = new PassThrough();
      archive.append(pt, { name: `${name}.csv` });
      const writer = createCsvWriter(pt);
      await writer.writeHeader(headers);
      current = { writer };
      const capped = capWriter(writer, tally);
      tally.add(writer);
      return capped;
    },
    async raw(name, content) {
      await closeCurrent();
      archive.append(Buffer.from(content, 'utf8'), { name });
    },
    async finalize() {
      await closeCurrent();
      await archive.finalize();
      if (archiveError) throw archiveError;
    },
  };
};

export async function processExportJob(job) {
  const exportJobId = job.data?.exportJobId;
  const doc = exportJobId ? await ExportJob.findById(exportJobId).lean() : null;
  // Stale redelivery (deleted, already finished, or canceled while queued) is a safe no-op.
  if (!doc || ['completed', 'canceled'].includes(doc.status)) return;

  // Retry hygiene FIRST: a crashed prior attempt's partial upload must not survive into
  // this attempt (idempotent when there is nothing to delete).
  await deleteArtifact(doc._id);

  const type = EXPORT_TYPES[doc.type];
  if (!type) {
    await ExportJob.updateOne({ _id: doc._id }, { $set: { status: 'failed', error: 'Unknown export type.', completedAt: new Date() } });
    throw new UnrecoverableError(`unknown export type ${doc.type}`);
  }

  await ExportJob.updateOne(
    { _id: doc._id },
    {
      $set: {
        status: 'running', startedAt: new Date(), queueJobId: String(job.id),
        progress: 0, processedRows: 0, rowCount: 0, bytes: 0, files: [],
        excludedDncCount: 0, orphanedRows: 0, error: null,
        audit: { subjectType: type.subjectType, subjectIds: [], subjectsTruncated: false, subjectsTotal: 0 },
      },
    }
  );

  const [org, campaign] = await Promise.all([
    Organization.findById(doc.organizationId, 'name slug timeZone deletion').lean(),
    doc.campaignId ? Campaign.findOne({ _id: doc.campaignId, organizationId: doc.organizationId }).lean() : null,
  ]);
  // A campaign-scoped export claimed AFTER a delete stamped the campaign would read a
  // half-destroyed dataset — fail it honestly (services/campaigns/deletionState.js).
  // Org-scoped exports (campaignId null) are untouched; a missing campaign stays
  // tolerated as before (the export reads whatever rows remain).
  if (doc.campaignId && campaign?.deletion?.requestedAt) {
    await ExportJob.updateOne(
      { _id: doc._id },
      { $set: { status: 'failed', error: 'This campaign is being deleted.', completedAt: new Date() } }
    );
    throw new UnrecoverableError('Campaign is being deleted');
  }
  // Same one level up — and org-scoped exports matter here too, not just campaign-scoped ones:
  // building a full backup out of a tenant mid-cascade produces a half-destroyed artifact.
  if (org?.deletion?.requestedAt) {
    await ExportJob.updateOne(
      { _id: doc._id },
      { $set: { status: 'failed', error: 'This organization is being deleted.', completedAt: new Date() } }
    );
    throw new UnrecoverableError('Organization is being deleted');
  }
  const anchorTz = doc.params?.anchorTz || campaign?.timeZone || org?.timeZone || 'America/New_York';

  // Org-wide on purpose: the DNC flag is kept in lockstep across a person's per-campaign
  // sibling rows, and the exclusion promise is org-level (privacy.html).
  const dnc = await loadDncVoterIdSet(doc.organizationId);

  const subjects = makeSubjects();
  const counters = { excludedDnc: 0, orphaned: 0 };
  let totalEstimate = 0;
  let lastProgressAt = 0;
  const ctx = {
    organizationId: doc.organizationId,
    campaignId: doc.campaignId,
    campaign,
    org,
    params: doc.params || {},
    anchorTz,
    dnc,
    subjects,
    counters,
    countDnc: (n) => { counters.excludedDnc += n; },
    countOrphaned: (n) => { counters.orphaned += n; },
    setTotalEstimate: (n) => {
      totalEstimate = n || 0;
      ExportJob.updateOne({ _id: doc._id }, { $set: { totalRowsEstimate: totalEstimate } }).catch(() => {});
    },
    progress: (processed) => {
      const now = Date.now();
      if (now - lastProgressAt < 1000) return;
      lastProgressAt = now;
      const pct = totalEstimate > 0 ? Math.min(99, Math.round((processed / totalEstimate) * 100)) : 0;
      ExportJob.updateOne(
        { _id: doc._id },
        { $set: { processedRows: processed, ...(pct ? { progress: pct } : {}) } }
      ).catch(() => {});
    },
  };

  let upload;
  try {
    const kind = await type.contentKind(ctx);
    const ext = kind === 'zip' ? 'zip' : 'csv';
    const filename = exportFilename({ org, campaign, type: doc.type, slug: type.fileSlug?.(ctx.params), anchorTz, ext });
    const contentType = kind === 'zip' ? 'application/zip' : 'text/csv; charset=utf-8';
    upload = openArtifactUploadStream(doc._id, {
      filename, contentType, organizationId: doc.organizationId, campaignId: doc.campaignId,
    });
    const uploadDone = new Promise((resolve, reject) => {
      upload.on('finish', resolve);
      upload.on('error', reject);
    });
    const sink = kind === 'zip' ? zipSink(upload) : csvSink(upload);

    const result = await type.build(ctx, sink);
    await sink.finalize();
    await uploadDone;

    const stats = await artifactStats(doc._id);
    const rowCount = (result.files || []).reduce((s, f) => s + (f.rows || 0), 0);
    await ExportJob.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'completed', completedAt: new Date(), progress: 100,
          processedRows: rowCount, rowCount,
          files: result.files || [],
          bytes: stats?.bytes || 0,
          excludedDncCount: counters.excludedDnc,
          orphanedRows: counters.orphaned,
          artifact: { gridFsId: stats?.gridFsId || null, filename, contentType },
          audit: { subjectType: type.subjectType, ...subjects.result() },
          expiresAt: new Date(Date.now() + EXPORT_TTL_DAYS * 86400000),
        },
      }
    );
  } catch (err) {
    try { await upload?.abort?.(); } catch { /* stream already gone */ }
    await deleteArtifact(doc._id).catch(() => {});
    const userError = err instanceof ExportUserError || err?.isExportUserError;
    // Marked failed on EVERY failed attempt (the importProcessor pattern) — a queue retry
    // flips it back to running via the reset at the top, so the row never lies for long.
    await ExportJob.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'failed', completedAt: new Date(),
          error: userError ? err.message : 'Export failed — try again, or narrow the filters.',
        },
      }
    ).catch(() => {});
    console.error(`[export] job ${doc._id} (${doc.type}) failed:`, err?.message || err);
    // A user-actionable failure fails identically on every retry — skip the backoff cycle.
    if (userError) throw new UnrecoverableError(err.message);
    throw err;
  }
}
