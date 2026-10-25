import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connectDb } from '../config/db.js';
import { ClientReport } from '../models/ClientReport.js';
import { ClientReportMapPoint } from '../models/ClientReportMapPoint.js';
import { ReportShareLink } from '../models/ReportShareLink.js';
import { Campaign } from '../models/Campaign.js';
import { Effort } from '../models/Effort.js';
import { SurveyTemplate } from '../models/SurveyTemplate.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { ensureSeries, namesInLabel } from '../services/reports/clientReportSeries.js';
import { backfillLegacyRows, legacyTemplatesFor } from '../services/reports/clientReportMap.js';
import { syncClientReportIndexes } from '../services/reports/clientReportIndexes.js';
import { depEdgesOf, liveInputs, breakdownKeysOf } from '../services/reports/reportVisibility.js';

// Client reports: visibility enforced on the server, for the reports that existed before it was
// (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F1 "Migration", as amended by §O3).
//
//   npm run migrate:client-report-visibility                               # dry run — what each step would do
//   npm run migrate:client-report-visibility -- --apply                    # do it
//   npm run migrate:client-report-visibility -- --apply --keep-legacy-all  # …keeping "unticked every question" charts
//
// The deploy comes BEFORE this, and the new code already works on every unmigrated document (each
// new field is read through a helper with an explicit fallback, map rows get their positions lazily
// on first read). So this only makes the stored documents say what the code already does — and
// EVERY write selects only what is still missing, so running it twice, or over documents the new
// code already wrote between the deploy and the run, changes nothing.
//
// Steps, in order; the irreversible ones last, and the dry run marks the two that discard:
//   0. Surveys: seed depsEver (every follow-up dependency) from today's conditions, and
//      depsEverFromVersion (the version that record is complete from) with it; list every survey
//      with answers — in a campaign with client reports — given under an OLDER version than that:
//      those versions' conditions can't be known (the builder warns, C3).
//      Every old report's dependencies come from EVERY survey its answers can have come from
//      (legacyTemplatesFor: each survey with a response in its campaign, plus the current one), and a
//      map question none of them asks is dropped — exactly what the deployed code serves (LEGACY-1).
//   1. LIST legacy reports whose operator unticked every question. Empty used to mean "all" and now
//      means "none"; by default they keep none. --keep-legacy-all first writes their charts' keys
//      (and the dry run with it counts steps 3-5 as if it had). Decide before step 4: after a plain
//      --apply the flag brings back their charts only — their map answers are already discarded.
//   2. Series: one whole-campaign series per campaign and one per walk list with reports, through
//      the SAME ensureSeries the routes use (it stamps each legacy report's seriesId and scope).
//      Walk-list labels that contain a canvasser's name are listed for the owner, never refused.
//   3. Backfill: editVersion 0; statsComputedAt = publishedAt on published reports; snapshotInputs
//      = what liveInputs reads today, frozen (a legacy DRAFT has nothing live — no map, no map
//      questions — until its first build); legacy map rows' positions (rank by _id) and the extent.
//   4. DISCARDS INFORMATION: every legacy PUBLISHED report's mapAnswerKeys becomes the questions
//      that may reach its map (liveInputs with the map on). A draft keeps its settings: its first
//      build maps only what its current survey allows (§O6).
//   5. IRREVERSIBLE: legacy rows of every legacy report whose map is off (drafts included) are
//      deleted, and answers outside its served map questions are pulled from the rest (a draft's
//      old rows are never served, so they keep none).
//   6. Share links (§F6, §O7): credentialVersion 0, the failure budget's fields, and lifetimeStartAt
//      (= createdAt) on links that expire — left unset on a legacy link that never expires, until
//      it gains an expiry. passwordMeetsRule is never written here: null means unknown, until the
//      link's next successful unlock checks the entered password's length.
//   It also lists open drafts, which need a recompute before they can be published.

const APPLY = process.argv.includes('--apply');
const KEEP_LEGACY_ALL = process.argv.includes('--keep-legacy-all');

// A report from before snapshots: no live snapshot, and numbers the old code computed at create.
// (A draft the new code made but hasn't built yet has no numbers, so it is never touched.)
const LEGACY = { snapshotId: null, 'stats.cumulative.totals.doorsKnocked': { $exists: true } };

export const runClientReportVisibility = async ({ apply = APPLY, keepLegacyAll = KEEP_LEGACY_ALL, log = console.log } = {}) => {
  const out = { templatesSeeded: 0, fromVersionsSeeded: 0, olderVersionTemplates: [], untickedAll: [], seriesStamped: 0, namedLabels: [], editVersion: 0, statsComputedAt: 0, snapshotInputs: 0, rowsPositioned: 0, mapKeysNarrowed: 0, mapOffRowsDeleted: 0, rowsPulled: 0, links: {}, openDrafts: [] };
  const mode = apply ? `APPLY${keepLegacyAll ? ' + KEEP LEGACY ALL' : ''}` : 'DRY RUN';
  log(`client-report visibility migration — ${mode}`);
  if (apply) await syncClientReportIndexes('migrate');

  // ── 0. Surveys' dependency record ──────────────────────────────────────────────────────────
  // depsEver and depsEverFromVersion, each only where it is missing: a survey edited since the deploy
  // already has both (the PATCH route stamps the version it replaced).
  for (const t of await SurveyTemplate.find(
    { $or: [{ depsEver: { $exists: false } }, { depsEverFromVersion: null }] },
    { questions: 1, version: 1, depsEver: 1, depsEverFromVersion: 1 }
  ).lean()) {
    if (t.depsEver === undefined) {
      out.templatesSeeded += 1;
      if (apply) await SurveyTemplate.updateOne({ _id: t._id, depsEver: { $exists: false } }, { $set: { depsEver: depEdgesOf(t.questions || []) } });
    }
    if (t.depsEverFromVersion == null) {
      out.fromVersionsSeeded += 1;
      if (apply) await SurveyTemplate.updateOne({ _id: t._id, depsEverFromVersion: null }, { $set: { depsEverFromVersion: t.version || 1 } });
    }
  }
  // Which versions answered, in ONE pass over the responses of every campaign with client reports
  // (its campaignId index) — then each survey whose answers include a version older than the one
  // its record starts at (depsEverFromVersion, or the version the dry run would stamp).
  const reportCampaigns = await ClientReport.distinct('campaignId');
  const answered = new Map(); // survey id → Set of versions
  for (const row of await SurveyResponse.aggregate([
    { $match: { campaignId: { $in: reportCampaigns } } },
    { $group: { _id: { t: '$surveyTemplateId', v: '$surveyTemplateVersion' } } },
  ])) {
    if (!row._id?.t) continue;
    const key = String(row._id.t);
    if (!answered.has(key)) answered.set(key, new Set());
    answered.get(key).add(Number(row._id.v));
  }
  for (const t of await SurveyTemplate.find({ _id: { $in: [...answered.keys()] } }, { version: 1, depsEverFromVersion: 1 }).lean()) {
    const from = t.depsEverFromVersion ?? t.version ?? 1;
    const older = [...answered.get(String(t._id))].filter((v) => Number.isFinite(v) && v < from).sort((a, b) => a - b);
    if (older.length) out.olderVersionTemplates.push({ templateId: String(t._id), from, versions: older });
  }
  log(`0. surveys: ${out.templatesSeeded} dependency record(s) to seed, ${out.fromVersionsSeeded} to stamp with the version they start at; ${out.olderVersionTemplates.length} survey(s) with answers older than that version (those versions' conditions can't be known — the builder warns): ${out.olderVersionTemplates.map((t) => `${t.templateId} (v${t.versions.join(', v')} < v${t.from})`).join('; ') || 'none'}`);

  // Every survey an old report's answers can have come from, read once per campaign AFTER the seeding
  // above (so depsEver is in) — the deployed code's own fallback (clientReportMap.js).
  const surveys = new Map();
  const surveysOf = async (r) => {
    const key = `${r.organizationId}:${r.campaignId}`;
    if (!surveys.has(key)) surveys.set(key, await legacyTemplatesFor({ organizationId: r.organizationId, campaignId: r.campaignId }));
    return surveys.get(key);
  };
  // --keep-legacy-all's chart keys by report, so a dry run counts steps 3-5 as the flag would leave
  // them (an --apply has already written them in step 1).
  const keptCharts = new Map();
  const asFlagged = (r) =>
    keptCharts.has(String(r._id)) ? { ...r, visibility: { ...(r.visibility || {}), visibleQuestionKeys: keptCharts.get(String(r._id)) } } : r;
  // What the deployed code reads as a legacy report's live inputs (liveInputs: fail closed for a
  // published one; nothing live for a draft, which needs no surveys).
  const legacyLive = async (r, { showMap = undefined } = {}) => {
    const flagged = asFlagged(r);
    const visibility = showMap === undefined ? flagged.visibility : { ...(flagged.visibility || {}), showMap };
    const templates = r.status === 'published' ? await surveysOf(r) : [];
    return liveInputs({ ...flagged, visibility, snapshotInputs: null }, { templates });
  };

  // ── 1. Legacy reports whose operator unticked every question ───────────────────────────────
  const unticked = await ClientReport.find(
    { ...LEGACY, editVersion: { $in: [null, 0] }, 'visibility.visibleQuestionKeys': { $size: 0 } },
    { campaignId: 1, weekStart: 1, weekEnd: 1, status: 1, snapshotInputs: 1, 'stats.cumulative.surveyBreakdowns.questionKey': 1 }
  ).lean();
  for (const r of unticked) {
    const keys = breakdownKeysOf(r);
    if (!keys.length) continue;
    // A published report already through steps 3-5 of an earlier --apply (it has snapshotInputs):
    // its map answers were narrowed to none and pulled from its rows then, so the flag brings back
    // its charts only. A draft keeps its map settings (step 4) and rebuilds its map anyway.
    const mapAnswersDiscarded = r.status === 'published' && !!(r.snapshotInputs && typeof r.snapshotInputs === 'object');
    out.untickedAll.push({ id: String(r._id), campaignId: String(r.campaignId), period: `${r.weekStart}..${r.weekEnd}`, status: r.status, mapAnswersDiscarded });
    if (keepLegacyAll) {
      keptCharts.set(String(r._id), keys);
      if (apply) await ClientReport.updateOne({ _id: r._id, 'visibility.visibleQuestionKeys': { $size: 0 } }, { $set: { 'visibility.visibleQuestionKeys': keys } });
    }
  }
  log(`1. ${out.untickedAll.length} legacy report(s) whose operator unticked every question — ${keepLegacyAll ? 'their charts come back (--keep-legacy-all)' : 'they now show NONE (add --keep-legacy-all to keep their charts)'}:`);
  for (const r of out.untickedAll) {
    const verdict = !keepLegacyAll ? '' : r.mapAnswersDiscarded ? ' — charts only: its map answers were already discarded' : ' — KEPT';
    log(`     ${r.id} (${r.status}, ${r.period}, campaign ${r.campaignId})${verdict}`);
  }

  // ── 2. Series ──────────────────────────────────────────────────────────────────────────────
  const unseriesed = await ClientReport.aggregate([
    { $match: { seriesId: null } },
    { $group: { _id: { o: '$organizationId', c: '$campaignId', e: { $ifNull: ['$effortId', null] } }, n: { $sum: 1 }, name: { $first: '$effortName' } } },
  ]);
  for (const g of unseriesed) {
    const { o: organizationId, c: campaignId, e: effortId } = g._id;
    out.seriesStamped += g.n;
    let label = 'Whole campaign';
    if (effortId) {
      const effort = await Effort.findById(effortId, { name: 1 }).lean();
      label = g.name || effort?.name || 'Walk list';
      const names = await namesInLabel({ campaignId, label });
      if (names.length) out.namedLabels.push({ campaignId: String(campaignId), effortId: String(effortId), label, names });
    }
    if (apply) {
      await ensureSeries({
        organizationId,
        campaignId,
        kind: effortId ? 'walk_list' : 'campaign',
        effortId: effortId || null,
        effortName: effortId ? label : null,
      });
    }
  }
  log(`2. series: ${out.seriesStamped} report(s) to put in a series (${unseriesed.length} scope(s)); ${out.namedLabels.length} walk-list label(s) matching a canvasser's name, for the owner to look at:`);
  for (const l of out.namedLabels) log(`     "${l.label}" (campaign ${l.campaignId}) matches: ${l.names.join(', ')}`);

  // ── 3. Backfill (only what is missing) ─────────────────────────────────────────────────────
  out.editVersion = await ClientReport.countDocuments({ editVersion: null });
  if (apply) await ClientReport.updateMany({ editVersion: null }, { $set: { editVersion: 0 } });
  const cutFilter = { status: 'published', statsComputedAt: null, publishedAt: { $ne: null } };
  out.statsComputedAt = await ClientReport.countDocuments(cutFilter);
  // Today's publish recomputes at publish, so the published reports' cut-off IS their publish time.
  if (apply) await ClientReport.updateMany(cutFilter, [{ $set: { statsComputedAt: '$publishedAt' } }]);
  for await (const r of ClientReport.find({ ...LEGACY, snapshotInputs: null }).lean().cursor()) {
    // Exactly what the deployed code reads for it today, frozen (so the client's view doesn't move;
    // a draft's is nothing live).
    const live = await legacyLive(r);
    out.snapshotInputs += 1;
    if (apply) {
      await ClientReport.updateOne(
        { _id: r._id, snapshotId: null, snapshotInputs: null },
        {
          $set: {
            snapshotInputs: {
              showMap: live.showMap,
              mapMode: live.mapMode,
              areaSize: live.areaSize,
              mapKeys: live.mapKeys,
              questionDeps: live.questionDeps,
              coordinatorIds: [],
            },
          },
        }
      );
    }
  }
  const legacyWithRows = await ClientReportMapPoint.distinct('clientReportId', { snapshotId: null });
  for (const id of legacyWithRows) {
    const r = await ClientReport.findOne({ _id: id, snapshotId: null }, { extent: 1, snapshotId: 1 }).lean();
    if (!r) continue;
    const missing = await ClientReportMapPoint.countDocuments({ clientReportId: id, snapshotId: null, seq: null });
    if (missing || !r.extent) {
      out.rowsPositioned += missing;
      if (apply) await backfillLegacyRows(r);
    }
  }
  log(`3. backfill: editVersion on ${out.editVersion}, statsComputedAt on ${out.statsComputedAt}, snapshotInputs on ${out.snapshotInputs} report(s); positions for ${out.rowsPositioned} legacy map row(s) (and extents)`);

  // ── 4. DISCARDS INFORMATION: mapAnswerKeys narrowed to what may reach the map ──────────────
  for await (const r of ClientReport.find({ ...LEGACY, status: 'published' }).lean().cursor()) {
    // Whatever the map switch says: the questions that may reach the map at all.
    const allowed = (await legacyLive(r, { showMap: true })).mapKeys;
    const current = r.visibility?.mapAnswerKeys || [];
    if (current.length === allowed.length && current.every((k) => allowed.includes(k))) continue;
    out.mapKeysNarrowed += 1;
    if (apply) await ClientReport.updateOne({ _id: r._id, snapshotId: null }, { $set: { 'visibility.mapAnswerKeys': allowed } });
  }
  log(`4. [DISCARDS INFORMATION] ${out.mapKeysNarrowed} legacy published report(s) whose map-answer list narrows to the questions that may reach the map`);

  // ── 5. IRREVERSIBLE: legacy rows that may not be served ────────────────────────────────────
  for (const id of await ClientReportMapPoint.distinct('clientReportId', { snapshotId: null })) {
    const r = await ClientReport.findOne({ _id: id, snapshotId: null }).lean();
    if (!r) continue; // an orphan is the nightly sweep's
    if (r.visibility?.showMap === false) {
      const n = await ClientReportMapPoint.countDocuments({ clientReportId: id, snapshotId: null });
      out.mapOffRowsDeleted += n;
      if (apply && n) await ClientReportMapPoint.deleteMany({ clientReportId: id, snapshotId: null });
      continue;
    }
    const allowed = (await legacyLive(r)).mapKeys;
    // $elemMatch: a row with ANY answer outside the set (a plain dotted $nin would ask that NONE is in it).
    const filter = { clientReportId: id, snapshotId: null, answers: { $elemMatch: { questionKey: { $nin: allowed } } } };
    const n = await ClientReportMapPoint.countDocuments(filter);
    out.rowsPulled += n;
    if (apply && n) await ClientReportMapPoint.updateMany({ clientReportId: id, snapshotId: null }, { $pull: { answers: { questionKey: { $nin: allowed } } } });
  }
  log(`5. [IRREVERSIBLE] ${out.mapOffRowsDeleted} map row(s) of map-off reports deleted; answers outside the map questions pulled from ${out.rowsPulled} row(s)`);

  // ── 6. Share links (only what is missing) ────────────────────────────────────────────────────
  // Each filter selects only links still lacking the field ({ f: null } matches a missing one), so a
  // second run — or one over links the new code already wrote — changes nothing. The deployed code
  // reads every one of these through a fallback (services/reports/shareLinks.js) meanwhile.
  const linkSteps = [
    ['credentialVersion', { credentialVersion: null }, { $set: { credentialVersion: 0 } }],
    [
      'lifetimeStartAt',
      { lifetimeStartAt: null, expiresAt: { $ne: null } },
      [{ $set: { lifetimeStartAt: { $ifNull: ['$createdAt', { $toDate: '$_id' }] } } }],
    ],
    ['failedUnlockAt', { failedUnlockAt: null }, { $set: { failedUnlockAt: [] } }],
    ['failedUnlocksTotal', { failedUnlocksTotal: null }, { $set: { failedUnlocksTotal: 0 } }],
    ['failedByDay', { failedByDay: null }, { $set: { failedByDay: [] } }],
  ];
  for (const [field, filter, update] of linkSteps) {
    out.links[field] = await ReportShareLink.countDocuments(filter);
    if (apply && out.links[field]) await ReportShareLink.updateMany(filter, update, { timestamps: false });
  }
  log(`6. share links: ${linkSteps.map(([f]) => `${f} on ${out.links[f]}`).join(', ')} link(s)`);

  out.openDrafts = (await ClientReport.find({ status: 'draft', snapshotId: null }, { campaignId: 1, weekStart: 1, weekEnd: 1 }).lean()).map((d) => ({
    id: String(d._id),
    campaignId: String(d.campaignId),
    period: `${d.weekStart}..${d.weekEnd}`,
  }));
  log(`   ${out.openDrafts.length} open draft(s) need a recompute before they can be published (they recompute when opened).`);
  if (!apply) log('\nDry run — nothing written. Re-run with -- --apply (and --keep-legacy-all if you decided to keep those charts).');
  return out;
};

// Run as a script (npm run migrate:client-report-visibility); import for tests.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  connectDb(process.env.MONGODB_URI)
    .then(() => runClientReportVisibility())
    .then(() => mongoose.disconnect())
    .catch(async (err) => {
      console.error(err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
