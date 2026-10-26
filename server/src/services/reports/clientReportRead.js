import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportSeries } from '../../models/ClientReportSeries.js';
import { Effort } from '../../models/Effort.js';
import { seriesLabelOf } from './clientReportSeries.js';

// What a report's page reads beside the report itself, shared by the public share routes and the
// admin preview so the operator sees exactly what the client gets.

// The cards the client sees on each kind of campaign (§F4: "visible count cards").
const cardsFor = (campaignType) =>
  campaignType === 'lit_drop' ? ['doorsKnocked', 'litKnocks', 'homesKnocked'] : ['doorsKnocked', 'surveysTaken', 'surveyedVoters'];

// A report shown to the client: published and not taken down.
const SHOWN = { status: 'published', takenDownAt: null };

const sameSeries = (report) =>
  report.seriesId ? { seriesId: report.seriesId } : { seriesId: null, effortId: report.effortId || null };

/**
 * The report this report's build compared its earlier totals with, as it stands now (lean), or null
 * when there is none. `extra` adds fields to what the line reads (the builder's check wants more).
 */
export const comparedReportNow = async (report, extra = {}) => {
  if (!report?.earlierTotals || !report.comparedReportId) return null;
  return ClientReport.findOne(
    { _id: report.comparedReportId, organizationId: report.organizationId, campaignId: report.campaignId },
    { 'stats.cumulative.totals': 1, weekStart: 1, weekEnd: 1, status: 1, takenDownAt: 1, snapshotId: 1, ...extra }
  ).lean();
};

/**
 * Were the compared report's numbers refreshed after this report's build recounted them (NUM-1)? Its
 * live snapshot is no longer the one the build froze, so the recount says nothing about what it shows
 * now — read against its new numbers, a refresh that ADDED a week's doors told the client totals went
 * down. Two nulls match: a report from before snapshots keeps its numbers until a refresh gives it one.
 */
export const comparedSnapshotMoved = (report, prev) =>
  String(prev?.snapshotId ?? '') !== String(report?.comparedSnapshotId ?? '');

/**
 * "Earlier totals were updated by −120 doors since the Oct 13 – Oct 19 report" (owner ruling 10-24,
 * §F4, §O9). The build froze its recount of the earlier report's cards; this compares it with what
 * that report froze, NOW — so the line follows the earlier report's fate: while it is still the
 * series' latest shown report ending on or before this one's start, the line names it; once it is
 * taken down or replaced, the "since …" clause drops; once it is gone, or its numbers were refreshed
 * since (comparedSnapshotMoved), so is the line. Returns { changes: [{ card, delta }], since:
 * { weekStart, weekEnd } | null } or null. `prev` skips the read when the caller already has it.
 *
 * `oneReport`: read through a link to one report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D), which
 * names no other report — the same counts, with `since: null` and `before: <this report's start>`:
 * "Totals from before Oct 19 were updated by −120 doors after they were first reported."
 */
export const earlierTotalsLine = async (report, { prev: loaded = undefined, oneReport = false } = {}) => {
  if (!report?.earlierTotals || !report.comparedReportId) return null;
  const prev = loaded === undefined ? await comparedReportNow(report) : loaded;
  if (!prev || prev.status !== 'published') return null;
  if (comparedSnapshotMoved(report, prev)) return null;
  const sent = prev.stats?.cumulative?.totals || {};
  const changes = cardsFor(report.campaignType)
    .map((card) => ({ card, delta: (report.earlierTotals[card] ?? 0) - (sent[card] ?? 0) }))
    .filter((c) => c.delta !== 0);
  if (!changes.length) return null;
  if (oneReport) return { changes, since: null, before: report.weekStart };
  let since = null;
  if (!prev.takenDownAt) {
    const latest = await ClientReport.findOne(
      {
        organizationId: report.organizationId,
        campaignId: report.campaignId,
        _id: { $ne: report._id },
        ...SHOWN,
        rangeEndUtc: { $lte: report.rangeStartUtc },
        ...sameSeries(report),
      },
      { _id: 1 }
    )
      .sort({ rangeEndUtc: -1, publishedAt: -1, _id: -1 })
      .lean();
    if (latest && String(latest._id) === String(prev._id)) since = { weekStart: prev.weekStart, weekEnd: prev.weekEnd };
  }
  return { changes, since };
};

/**
 * The older and newer shown report in the same series — the client's arrows. Ids only. Ordered the
 * way the hub lists them — by start, then publish time, then id — and compared on that whole tuple,
 * so two reports starting the same day each get an arrow to the other (a strict comparison on the
 * start alone gave both none: PUBUX-6). A draft (the admin preview) reads as published now, where it
 * will sit once published.
 */
export const seriesNav = async (report) => {
  const scope = { organizationId: report.organizationId, campaignId: report.campaignId, ...SHOWN, ...sameSeries(report), _id: { $ne: report._id } };
  const start = report.rangeStartUtc;
  const at = report.publishedAt || new Date();
  const beside = (op) => [
    { rangeStartUtc: { [op]: start } },
    { rangeStartUtc: start, publishedAt: { [op]: at } },
    { rangeStartUtc: start, publishedAt: at, _id: { [op]: report._id } },
  ];
  const [older, newer] = await Promise.all([
    ClientReport.findOne({ ...scope, $or: beside('$lt') }, { _id: 1 })
      .sort({ rangeStartUtc: -1, publishedAt: -1, _id: -1 })
      .lean(),
    ClientReport.findOne({ ...scope, $or: beside('$gt') }, { _id: 1 })
      .sort({ rangeStartUtc: 1, publishedAt: 1, _id: 1 })
      .lean(),
  ]);
  return { olderId: older ? String(older._id) : null, newerId: newer ? String(newer._id) : null };
};

/** Map<seriesId, current label> for the series of these reports (the hub shows current labels). */
export const currentSeriesLabels = async (reports) => {
  const ids = [...new Set(reports.map((r) => (r.seriesId ? String(r.seriesId) : null)).filter(Boolean))];
  if (!ids.length) return new Map();
  const series = await ClientReportSeries.find({ _id: { $in: ids } }).lean();
  const parents = new Map(
    (await ClientReportSeries.find({ _id: { $in: series.map((s) => s.teamSeriesId).filter(Boolean) } }).lean()).map((p) => [String(p._id), p])
  );
  const efforts = new Map(
    (await Effort.find({ _id: { $in: series.map((s) => s.effortId).filter(Boolean) } }, { name: 1 }).lean()).map((e) => [String(e._id), e.name])
  );
  const out = new Map();
  for (const s of series) {
    out.set(
      String(s._id),
      await seriesLabelOf(s, {
        team: s.teamSeriesId ? parents.get(String(s.teamSeriesId)) || null : null,
        effortName: s.effortId ? efforts.get(String(s.effortId)) || null : null,
      })
    );
  }
  return out;
};
