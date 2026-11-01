import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connectDb } from '../config/db.js';
import { ClientReport } from '../models/ClientReport.js';
import { closeQueues } from '../queues/index.js';
import { mapContextFor } from '../services/reports/clientReportMap.js';
import { buildIsLive, claimBuild, processClientReportJob, reconcileFailedClientReportJob } from '../services/reports/clientReportBuilds.js';
import { writeReportHistory, REPORT_FIELDS } from '../services/reports/clientReportHistory.js';
import { isLegacyPublished, mapServed, periodLabelOf, servedMapKeys } from '../services/reports/reportVisibility.js';

// Client reports: areas for every existing report (privacy record item 52; docs/CLIENT_PORTAL.md Part 2
// §R).
//
//   npm run migrate:client-report-areas              # dry run — the plan, report by report
//   npm run migrate:client-report-areas -- --apply   # do it
//
// The deploy comes BEFORE this. From the deploy on, every new report starts in areas — which never show
// an address or a household's answers — and a house-level map (each knocked house with its street
// address and map answers, a tap away) is an explicit opt-in per report, confirmed against a warning
// and recorded. No existing report ever opted in, so this moves each one to areas; an operator can turn
// its house-level map back on through that opt-in. A report whose house-level map someone confirmed
// since the deploy (visibility.houseLevelConfirmedAt) is left as it is, and listed.
//
// Steps, in order:
//   1. Published reports, shown or taken down, whose live snapshot serves a house-level map: the same
//      switch to areas the builder's Switch to areas makes (a remap, claimed and built here, inline) to
//      small areas, from the frozen rows — the numbers don't change. Marked as Doorline's own (build.via
//      'privacy'), so the client is NOT shown "Edited"; the report's History reads "Map switched to areas
//      by Doorline (privacy update)". A report published before snapshots (its map forced to pins) takes
//      the same path: the remap reads its legacy rows like any others. SKIPPED, and listed: a report with
//      a Refresh waiting for review, or a build in flight — re-run once they're done.
//   2. Drafts, and published reports whose map is off: their map setting becomes areas (small, unless
//      large is set), with editVersion moved (an open builder merges onto it) and a History row. A draft
//      takes it at its next Recompute; a map-off report when Refresh numbers turns its map back on.
//
// The house-level rows of a switched report go with its old snapshot (the remap's commit deletes
// them); every other frozen row stays as it is, addresses included — a house-level map left in place
// still needs them.
//
// Every write selects only what is still to do, so a second run changes nothing.

const APPLY = process.argv.includes('--apply');

const idOf = (r) => String(r._id);
const lineOf = (r) => `${idOf(r)} (campaign ${r.campaignId}, ${periodLabelOf(r)}${r.takenDownAt ? ', taken down' : ''})`;
// Confirmed under the new rule: a house-level setting with its confirmation recorded.
const confirmedHouseLevel = (r) => r.visibility?.mapMode === 'pins' && !!r.visibility?.houseLevelConfirmedAt;

export const runClientReportAreas = async ({ apply = APPLY, log = console.log } = {}) => {
  const out = {
    remapped: [],
    toRemap: [],
    legacy: 0,
    kept: [],
    skipped: [],
    failed: [],
    settings: { drafts: 0, mapOff: 0 },
  };
  log(`client-report areas migration — ${apply ? 'APPLY' : 'DRY RUN'}`);

  // ── 1. Published reports whose live map is house-level ───────────────────────────────────────
  const published = await ClientReport.find({ status: 'published' }).sort({ campaignId: 1, weekEnd: 1, _id: 1 }).lean();
  const mapOffPublished = [];
  for (const r of published) {
    const { inputs: live } = await mapContextFor(r);
    if (!mapServed(r, live)) {
      mapOffPublished.push(r);
      continue;
    }
    if (live.mapMode === 'area') continue;
    if (confirmedHouseLevel(r)) {
      out.kept.push({ id: idOf(r), line: lineOf(r), confirmedAt: r.visibility.houseLevelConfirmedAt });
      continue;
    }
    if (r.build?.status === 'ready') {
      out.skipped.push({ id: idOf(r), line: lineOf(r), why: 'new numbers from Refresh numbers are waiting for review' });
      continue;
    }
    if (await buildIsLive(r)) {
      out.skipped.push({ id: idOf(r), line: lineOf(r), why: `a build is ${r.build.status === 'running' ? 'running' : 'queued'}` });
      continue;
    }
    // Published before snapshots: no live snapshot of its own (its map rows carry none).
    const legacy = isLegacyPublished(r) || !r.snapshotId;
    const plan = { id: idOf(r), line: lineOf(r), doors: r.mapPointCount || 0, legacy };
    if (!apply) {
      out.toRemap.push(plan);
      continue;
    }
    // The switch to areas Switch to areas claims (routes PATCH), with the map questions the live
    // snapshot serves: the area rule then decides which show answers area by area.
    let build;
    try {
      build = await claimBuild({
        report: r,
        kind: 'remap',
        inputs: { ...live, mapKeys: servedMapKeys(r, live), mapMode: 'area', areaSize: 'small' },
        by: null,
        expectStatus: 'published',
        via: 'privacy',
      });
    } catch (err) {
      out.skipped.push({ id: idOf(r), line: lineOf(r), why: `the switch couldn't start (${err?.code || err?.message || err})` });
      continue;
    }
    // Built here rather than on the worker: nothing is enqueued, so the worker never sees this job.
    const job = { id: build.jobId, data: { reportId: idOf(r) }, updateProgress: async () => {} };
    try {
      const res = await processClientReportJob(job, 'migrate:client-report-areas');
      if (res?.committed) out.remapped.push(plan);
      else out.failed.push({ ...plan, why: res?.code || res?.stopped || res?.skipped || 'not committed' });
    } catch (err) {
      await reconcileFailedClientReportJob(job, err).catch(() => {});
      out.failed.push({ ...plan, why: err?.message || String(err) });
    }
  }
  const remaps = apply ? out.remapped : out.toRemap;
  out.legacy = remaps.filter((p) => p.legacy).length;
  log(
    `1. published house-level maps → small areas (no "Edited" for the client): ${remaps.length} ${apply ? 'switched' : 'to switch'}` +
      ` (${out.legacy} from before snapshots); ${out.kept.length} left house-level (confirmed); ${out.skipped.length} skipped; ${out.failed.length} failed`
  );
  for (const p of remaps) log(`     ${apply ? 'switched' : 'switch'} ${p.line} — ${p.doors.toLocaleString()} doors on its map${p.legacy ? ', published before snapshots' : ''}`);
  for (const k of out.kept) log(`     kept ${k.line} — house-level map confirmed ${new Date(k.confirmedAt).toISOString().slice(0, 10)}`);
  for (const s of out.skipped) log(`     SKIPPED ${s.line} — ${s.why}; run this again once it's done`);
  for (const f of out.failed) log(`     FAILED ${f.line} — ${f.why}; run this again`);

  // ── 2. Drafts and map-off published reports: the setting ────────────────────────────────────
  // Only what isn't areas already, and never a house-level setting someone confirmed.
  const notAreas = { 'visibility.mapMode': { $ne: 'area' }, 'visibility.houseLevelConfirmedAt': null };
  const setAreas = [
    {
      $set: {
        'visibility.mapMode': 'area',
        'visibility.areaSize': { $cond: [{ $eq: ['$visibility.areaSize', 'large'] }, 'large', 'small'] },
        editVersion: { $add: [{ $ifNull: ['$editVersion', 0] }, 1] },
      },
    },
  ];
  const fields = { organizationId: 1, campaignId: 1, seriesId: 1, weekStart: 1, weekEnd: 1, visibility: 1, status: 1 };
  const drafts = await ClientReport.find({ status: 'draft', ...notAreas }, fields).lean();
  const mapOffIds = mapOffPublished.filter((r) => r.visibility?.mapMode !== 'area' && !r.visibility?.houseLevelConfirmedAt).map((r) => r._id);
  const mapOff = mapOffIds.length ? await ClientReport.find({ _id: { $in: mapOffIds }, status: 'published', ...notAreas }, fields).lean() : [];
  for (const [kind, list] of [['drafts', drafts], ['mapOff', mapOff]]) {
    for (const r of list) {
      if (!apply) {
        out.settings[kind] += 1;
        continue;
      }
      const pre = await ClientReport.findOneAndUpdate({ _id: r._id, status: r.status, ...notAreas }, setAreas, { returnDocument: 'before' }).lean();
      if (!pre) continue; // changed since it was read: the next run sees it as it is
      out.settings[kind] += 1;
      const areaSize = pre.visibility?.areaSize === 'large' ? 'large' : 'small';
      await writeReportHistory(pre, REPORT_FIELDS.areasPrivacyUpdate, { toValue: { kind: 'setting', mapMode: 'area', areaSize } }).catch(() => {});
    }
  }
  const keptDrafts = await ClientReport.countDocuments({ status: 'draft', 'visibility.mapMode': 'pins', 'visibility.houseLevelConfirmedAt': { $ne: null } });
  log(
    `2. map setting → areas: ${out.settings.drafts} draft(s) (they take it at their next Recompute) and ${out.settings.mapOff} published report(s) whose map is off` +
      `${apply ? '' : ' to change'}; ${keptDrafts} draft(s) left house-level (confirmed)`
  );

  if (!apply) log('\nDry run — nothing written. Re-run with -- --apply.');
  else if (out.skipped.length || out.failed.length) log('\nSome reports were skipped or failed (above): run this again once they are done — it changes nothing twice.');
  return out;
};

// Run as a script (npm run migrate:client-report-areas); import for tests. The queue connection a build's
// liveness check opens is closed on the way out, or the console would hang on it.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  connectDb(process.env.MONGODB_URI)
    .then(() => runClientReportAreas())
    .then(async () => {
      await closeQueues().catch(() => {});
      await mongoose.disconnect();
    })
    .catch(async (err) => {
      console.error(err);
      await closeQueues().catch(() => {});
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
