import mongoose from 'mongoose';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ClientReportAreaCell } from '../../models/ClientReportAreaCell.js';
import { buildIsLive } from './clientReportBuilds.js';
import { liveInputs } from './reportVisibility.js';

// The nightly client-report row sweep (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F2 "Nightly sweep").
// Every path that ends a build deletes its own rows when it safely can; this catches what none of
// them could — a dead attempt's rows, a failed build's (the failed listener leaves them here on
// purpose), an orphan whose report was deleted while a batch was in flight.
//
// It reads at `sweepStart`, and every delete it issues ALSO requires the row's snapshotId to have
// been minted before that instant (ObjectId.createFromTime takes SECONDS) or to be null, so a build
// that starts after the read is never touched.

const { ObjectId } = mongoose.Types;
export const CLIENT_REPORT_SWEEP_JOB = 'client-report-row-sweep';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 500;

const MODELS = [ClientReportMapPoint, ClientReportAreaCell];

export const sweepClientReportRows = async ({ now = new Date(), jobState = undefined } = {}) => {
  const sweepStart = now.getTime();
  const cut = ObjectId.createFromTime(Math.floor(sweepStart / 1000));
  const dayCut = ObjectId.createFromTime(Math.floor((sweepStart - DAY_MS) / 1000));
  const beforeRead = { $or: [{ snapshotId: { $lt: cut } }, { snapshotId: null }] };
  const counts = { orphans: 0, mapOff: 0, legacy: 0, stale: 0, reports: 0 };

  const reportIds = new Set();
  for (const M of MODELS) for (const id of await M.distinct('clientReportId')) reportIds.add(String(id));
  const ids = [...reportIds].map((id) => new ObjectId(id));

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const reports = await ClientReport.find(
      { _id: { $in: chunk } },
      { snapshotId: 1, snapshotInputs: 1, visibility: 1, build: 1, status: 1 }
    ).lean();
    const byId = new Map(reports.map((r) => [String(r._id), r]));

    // Rows whose report no longer exists.
    const orphanIds = chunk.filter((id) => !byId.has(String(id)));
    if (orphanIds.length) {
      for (const M of MODELS) {
        const r = await M.deleteMany({ clientReportId: { $in: orphanIds }, ...beforeRead });
        counts.orphans += r.deletedCount || 0;
      }
    }

    for (const report of reports) {
      counts.reports += 1;
      // The build's snapshot is spared while the build is live or holds a ready result (a ready
      // "turn the map on" refresh included) — the operator is still to review it.
      const b = report.build;
      const spared = b?.snapshotId && (b.status === 'ready' || (await buildIsLive(report, jobState ? { jobState } : {})))
        ? b.snapshotId
        : null;
      const keep = [report.snapshotId, spared].filter(Boolean);
      const mapOff = report.visibility?.showMap === false || !liveInputs(report).showMap;

      for (const M of MODELS) {
        if (mapOff) {
          // A report whose map is off keeps no rows at all, save a live or ready build's.
          const r = await M.deleteMany({
            clientReportId: report._id,
            $or: [{ snapshotId: { $lt: cut, ...(spared ? { $ne: spared } : {}) } }, { snapshotId: null }],
          });
          counts.mapOff += r.deletedCount || 0;
          continue;
        }
        if (report.snapshotId) {
          // Legacy rows of a report that has a snapshot of its own now.
          const r = await M.deleteMany({ clientReportId: report._id, snapshotId: null });
          counts.legacy += r.deletedCount || 0;
        }
        // Rows of a snapshot that is neither the live one nor a live or ready build's, minted more
        // than a day ago.
        const r = await M.deleteMany({
          clientReportId: report._id,
          snapshotId: { $lt: dayCut, ...(keep.length ? { $nin: keep } : {}) },
        });
        counts.stale += r.deletedCount || 0;
      }
    }
  }
  return counts;
};
