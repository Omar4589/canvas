import mongoose from 'mongoose';
import { CampaignChange } from '../../models/CampaignChange.js';
import { ClientReport } from '../../models/ClientReport.js';
import { periodLabelOf } from './reportVisibility.js';

// The Client Reports tab's History (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F9, as amended by
// §O8). Rows ride CampaignChange with source 'client_report' and are kept OUT of the campaign's
// general feed (routes/admin/campaigns.js filters them from the default query), so the web History
// and the phone see exactly what they did before.
//
// What a row holds: an EDIT keeps only the EARLIER text, in fromValue — toValue stays null, because
// the current text lives on the report — so each version of the text is kept in exactly one row.
// Every other row names the report's period, never its title. Link rows (stage 2) never hold the URL
// token, a password or its hash. Leads read this history on their campaigns, so it is
// customer-facing: an admin can Erase earlier text, everywhere it is kept.

const { ObjectId } = mongoose.Types;

export const REPORT_FIELDS = Object.freeze({
  created: 'clientReport.created',
  published: 'clientReport.published',
  edited: 'clientReport.edited',
  numbersRefreshed: 'clientReport.numbersRefreshed',
  refreshDiscarded: 'clientReport.refreshDiscarded',
  takenDown: 'clientReport.takenDown',
  putBackUp: 'clientReport.putBackUp',
  deleted: 'clientReport.deleted',
  remapped: 'clientReport.remapped',
  // Archive tidies the operator's list only (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C4): one row per
  // change, never a second for a repeat.
  archived: 'clientReport.archived',
  unarchived: 'clientReport.unarchived',
});
// A series row names its team or tab as it read at the time (WALK-3): toValue.label on created, crews
// changed, ended and continued, the new name itself on a rename. Crews-changed and ended rows written
// before that carry ids only; the History names them by the series' current label
// (client/src/lib/campaignHistory.js).
export const SERIES_FIELDS = Object.freeze({
  created: 'clientReportSeries.created',
  renamed: 'clientReportSeries.renamed',
  crewsChanged: 'clientReportSeries.crewsChanged',
  ended: 'clientReportSeries.ended',
  continued: 'clientReportSeries.continued',
});
export const LINK_FIELDS = Object.freeze({
  created: 'reportLink.created',
  passwordChanged: 'reportLink.passwordChanged',
  rotated: 'reportLink.rotated',
  renewed: 'reportLink.renewed',
  extended: 'reportLink.extended',
  disabled: 'reportLink.disabled',
  enabled: 'reportLink.enabled',
  wrongPasswords: 'reportLink.wrongPasswords',
  locked: 'reportLink.locked',
  unlocked: 'reportLink.unlocked',
  deleted: 'reportLink.deleted',
});

/** One History row about a report. Best-effort for callers: a lost row never undoes the act. */
export const writeReportHistory = (report, field, { by = null, fromValue = null, toValue = null } = {}) =>
  CampaignChange.create({
    organizationId: report.organizationId,
    campaignId: report.campaignId,
    field,
    fromValue,
    toValue,
    byUserId: by,
    source: 'client_report',
    clientReportId: report._id,
    seriesId: report.seriesId || null,
    periodLabel: periodLabelOf(report),
  });

/** One History row about a series (a team's name and crews are operator data, never canvassers'). */
export const writeSeriesHistory = (series, field, { by = null, fromValue = null, toValue = null } = {}) =>
  CampaignChange.create({
    organizationId: series.organizationId,
    campaignId: series.campaignId,
    field,
    fromValue,
    toValue,
    byUserId: by,
    source: 'client_report',
    seriesId: series._id,
  });

// A link row's values, with anything that looks like a credential dropped — defense in depth over
// callers that already pass only the label, dates and counts.
const withoutSecrets = (v) =>
  v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !/token|password|hash/i.test(k)))
    : v;

// The report a link row names: the one handed over, else the link's own, looked up. Only what the row
// stamps is read; null for a link to all your reports, or when the report is already gone (a caller
// that deletes the report first hands it over).
const reportOfLink = async (link, report) => {
  if (report !== undefined && report !== null) return report;
  if (!link?.reportId) return null;
  return ClientReport.findOne(
    { _id: link.reportId, organizationId: link.organizationId },
    { seriesId: 1, weekStart: 1, weekEnd: 1 }
  ).lean();
};

/**
 * One History row about a share link (stage 2, §F6/§F9): the link's id, never its URL token, a
 * password or its hash, and no IP address or user agent (§O7). A link to one report also stamps the
 * report's id, its tab and its period, as the report's own rows do, so History names the link by its
 * report ("Oct 12 – Oct 18, 2026 · Paid team report · Link created" — PROPOSAL_CLIENT_REPORT_LINKS.md
 * §C7). `report` is optional: handed over when the caller has it (and must be, when it deleted the
 * report first), looked up otherwise. These rows stay outside erase and restore, which touch edit rows
 * only, and outside the phone's feed.
 */
export const writeLinkHistory = async (link, field, { by = null, fromValue = null, toValue = null, report } = {}) => {
  const r = await reportOfLink(link, report);
  return CampaignChange.create({
    organizationId: link.organizationId,
    campaignId: link.campaignId,
    field,
    fromValue: withoutSecrets(fromValue),
    toValue: withoutSecrets(toValue),
    byUserId: by,
    source: 'client_report',
    shareLinkId: link._id,
    clientReportId: r?._id || link.reportId || null,
    seriesId: r?.seriesId || null,
    periodLabel: r ? periodLabelOf(r) : null,
  });
};

const sameText = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const plainSections = (obs) => (obs || []).map((s) => ({ heading: s.heading, body: s.body ?? '' }));

/**
 * The earlier text an edit replaced, from the write's PRE-IMAGE (§O8: findOneAndUpdate returning
 * 'before', so overlapping edits keep exactly one copy of each version). Only fields the edit
 * changed; null when it changed no text (a visibility-only edit still gets a row, without text).
 */
export const earlierTextOf = (pre, edit) => {
  const out = {};
  if (edit.title !== undefined && !sameText(pre.title || '', edit.title)) out.title = pre.title || '';
  if (edit.observations !== undefined && !sameText(plainSections(pre.observations), plainSections(edit.observations))) {
    out.observations = plainSections(pre.observations);
  }
  return Object.keys(out).length ? out : null;
};

export class HistoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Restore (§F9, §O8): apply a row's earlier text as a normal edit. Reads the report's eraseEpoch
 * FIRST and the row after, and the write requires the epoch unchanged — Erase clears the row first
 * and bumps the epoch after — so an Erase landing mid-restore always wins (409). Returns the report.
 */
export const restoreHistoryRow = async ({ campaignId, organizationId, rowId, by }) => {
  if (!mongoose.isValidObjectId(rowId)) throw new HistoryError(400, 'INVALID_ID', 'Invalid id');
  const peek = await CampaignChange.findOne(
    { _id: rowId, campaignId, organizationId, source: 'client_report' },
    { clientReportId: 1 }
  ).lean();
  if (!peek?.clientReportId) throw new HistoryError(404, 'HISTORY_NOT_FOUND', 'History entry not found');
  const report = await ClientReport.findOne(
    { _id: peek.clientReportId, organizationId, campaignId },
    { eraseEpoch: 1, status: 1 }
  ).lean();
  if (!report) throw new HistoryError(404, 'REPORT_NOT_FOUND', 'Report not found');
  const epoch = report.eraseEpoch ?? null;
  const row = await CampaignChange.findOne({ _id: rowId, campaignId, organizationId, source: 'client_report' }).lean();
  if (!row || row.field !== REPORT_FIELDS.edited) throw new HistoryError(400, 'NOT_RESTORABLE', 'Only an edit can be restored.');
  if (row.erasedAt || !row.fromValue) throw new HistoryError(409, 'HISTORY_ERASED', 'This text was erased, so it can’t be restored.');
  const text = row.fromValue;
  const set = {};
  if (typeof text.title === 'string') set.title = text.title;
  if (Array.isArray(text.observations)) set.observations = plainSections(text.observations);
  if (!Object.keys(set).length) throw new HistoryError(400, 'NOT_RESTORABLE', 'This entry holds no text to restore.');
  const now = new Date();
  const published = report.status === 'published';
  const pre = await ClientReport.findOneAndUpdate(
    { _id: report._id, organizationId, eraseEpoch: epoch },
    [
      {
        $set: {
          ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k, { $literal: v }])),
          editVersion: { $add: [{ $ifNull: ['$editVersion', 0] }, 1] },
          ...(published ? { contentEditedAt: { $literal: now }, contentEditedBy: { $literal: by } } : {}),
        },
      },
    ],
    { returnDocument: 'before' }
  ).lean();
  if (!pre) throw new HistoryError(409, 'HISTORY_ERASED', 'This text was just erased, so it can’t be restored.');
  if (published) {
    const earlier = earlierTextOf(pre, set);
    if (earlier) await writeReportHistory(pre, REPORT_FIELDS.edited, { by, fromValue: earlier });
  }
  return ClientReport.findById(report._id).lean();
};

// The erased texts' sections, as comparable keys.
const erasedSectionKeys = (texts) =>
  new Set(
    texts.flatMap((t) => (Array.isArray(t?.observations) ? t.observations : [])).map((s) => JSON.stringify([s.heading, s.body ?? '']))
  );

// The drafts Next copied this report's notes into that still hold an erased section — the ones the
// Erase confirm NAMES by period, and the ones "also remove it there" would change (§O8). A draft
// whose copied notes were already rewritten holds none of the text, so it isn't named.
const draftsHoldingErasedText = async ({ organizationId, reportId, texts }) => {
  const erased = erasedSectionKeys(texts);
  if (!erased.size) return [];
  const drafts = await ClientReport.find(
    { organizationId, status: 'draft', 'copiedFrom.reportId': new ObjectId(String(reportId)) },
    { observations: 1, weekStart: 1, weekEnd: 1 }
  )
    .sort({ weekStart: 1, _id: 1 })
    .lean();
  return drafts.filter((d) => plainSections(d.observations).some((s) => erased.has(JSON.stringify([s.heading, s.body]))));
};

// Remove erased sections from drafts that Next copied them into (§O8, an option of the Erase).
const scrubCopiedDrafts = async ({ organizationId, reportId, texts }) => {
  const erased = erasedSectionKeys(texts);
  if (!erased.size) return 0;
  const drafts = await ClientReport.find(
    { organizationId, status: 'draft', 'copiedFrom.reportId': new ObjectId(String(reportId)) },
    { observations: 1 }
  ).lean();
  let n = 0;
  for (const d of drafts) {
    const kept = plainSections(d.observations).filter((s) => !erased.has(JSON.stringify([s.heading, s.body])));
    if (kept.length === (d.observations || []).length) continue;
    await ClientReport.updateOne(
      { _id: d._id, status: 'draft' },
      [
        {
          $set: {
            observations: { $literal: kept },
            copiedNotesReviewed: false,
            editVersion: { $add: [{ $ifNull: ['$editVersion', 0] }, 1] },
          },
        },
      ]
    );
    n += 1;
  }
  return n;
};

/**
 * Erase (admins, §F9/§O8): clear the earlier text of one edit row — or, with `allForReport`, of every
 * edit row of that report, beyond the drawer's page and after the report is deleted. The rows are
 * cleared FIRST and the report's eraseEpoch bumped after (see restoreHistoryRow). `alsoDrafts`
 * removes the same sections from later drafts Next copied them into. `dryRun` counts without writing,
 * and names those drafts by period (copiedDraftPeriods) for the confirm.
 */
export const eraseHistory = async ({ campaignId, organizationId, rowId = null, clientReportId = null, by, alsoDrafts = false, dryRun = false }) => {
  let reportId = clientReportId;
  let filter;
  if (rowId) {
    if (!mongoose.isValidObjectId(rowId)) throw new HistoryError(400, 'INVALID_ID', 'Invalid id');
    const row = await CampaignChange.findOne({ _id: rowId, campaignId, organizationId, source: 'client_report' }).lean();
    if (!row) throw new HistoryError(404, 'HISTORY_NOT_FOUND', 'History entry not found');
    if (row.field !== REPORT_FIELDS.edited) throw new HistoryError(400, 'NOT_ERASABLE', 'Only an edit holds earlier text.');
    reportId = row.clientReportId;
    filter = { _id: row._id };
  } else {
    if (!mongoose.isValidObjectId(clientReportId)) throw new HistoryError(400, 'INVALID_ID', 'Invalid report id');
    filter = { clientReportId: new ObjectId(String(clientReportId)) };
  }
  const scope = { ...filter, campaignId, organizationId, source: 'client_report', field: REPORT_FIELDS.edited, fromValue: { $ne: null } };
  const rows = await CampaignChange.find(scope, { fromValue: 1 }).lean();
  const texts = rows.map((r) => r.fromValue);
  const report = reportId ? await ClientReport.findOne({ _id: reportId, organizationId }, { title: 1, observations: 1 }).lean() : null;
  // Warn when an erased text is the report's CURRENT text (a Restore put it back): Erase removes it
  // from History, never from the report.
  const currentTextMatches = !!report && texts.some((t) =>
    (typeof t?.title === 'string' && t.title === (report.title || '')) ||
    (Array.isArray(t?.observations) && sameText(plainSections(t.observations), plainSections(report.observations)))
  );
  // The confirm NAMES the later drafts that still hold this text (their periods), not just a count.
  const holding = reportId ? await draftsHoldingErasedText({ organizationId, reportId, texts }) : [];
  const copiedDrafts = holding.length;
  const copiedDraftPeriods = holding.map((d) => periodLabelOf(d));
  if (dryRun) return { rows: rows.length, currentTextMatches, copiedDrafts, copiedDraftPeriods, draftsScrubbed: 0 };

  const now = new Date();
  const r = await CampaignChange.updateMany(scope, { $set: { fromValue: null, erasedAt: now, erasedBy: by } });
  if (reportId) {
    await ClientReport.updateOne({ _id: reportId, organizationId }, [
      { $set: { eraseEpoch: { $add: [{ $ifNull: ['$eraseEpoch', 0] }, 1] } } },
    ]);
  }
  const draftsScrubbed = alsoDrafts && reportId ? await scrubCopiedDrafts({ organizationId, reportId, texts }) : 0;
  return { rows: r.modifiedCount || 0, currentTextMatches, copiedDrafts, copiedDraftPeriods, draftsScrubbed };
};
