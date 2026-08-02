import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Voter } from '../../models/Voter.js';
import { VoterNote } from '../../models/VoterNote.js';
import { ImportJob } from '../../models/ImportJob.js';
import { DNC_FILTER } from './exportScope.js';
import { ExportUserError } from './exportErrors.js';
import { resolveWalkList } from '../walklist/resolveWalkList.js';
import {
  canvassActivityQuery,
  surveyBaseQuery,
  voterNotesQuery,
  resolveDoorsByRoundRounds,
} from './exportBuilders.js';

// Pre-queue row-count estimates, one per registry type. The contract is estimate==build:
// `rows` predicts ExportJob.rowCount and `dncWithheld` predicts excludedDncCount, because
// every estimate here imports the SAME query constructor its builder streams (the turf
// target-preview principle — a preview that runs a different query is a lie waiting to
// happen). `approx: true` marks the two survey types, whose builders also drop orphaned
// (import-undo) rows the count cannot see: est.rows === rowCount + orphanedRows there —
// which only holds because each builder's countOrphaned uses ITS OWN row unit (a dropped
// response counts 1 in the wide file, but its answers.length in the long file).
//
// ctx is the read-only slice of the builder ctx: { organizationId, campaignId, campaign,
// params (validated), anchorTz, dnc } — no sink, no counters. Everything below is
// countDocuments/covered-aggregation class over campaign-bounded, indexed collections, so
// it runs inline in the web dyno (same magnitude as the turf target-preview).

const oid = (v) => new mongoose.Types.ObjectId(String(v));

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const flaggedOids = (ctx) => [...ctx.dnc].map(oid);

// Rows are kept-and-blanked for DNC (door-unit rule), so the plain count IS the rowCount;
// dncWithheld counts the rows whose identity the builder will blank.
const estimateCanvassActivity = async (ctx) => {
  const q = canvassActivityQuery(ctx);
  const flagged = flaggedOids(ctx);
  const [rows, dncWithheld] = await Promise.all([
    CanvassActivity.countDocuments(q),
    flagged.length ? CanvassActivity.countDocuments({ ...q, voterId: { $in: flagged } }) : 0,
  ]);
  return { rows, dncWithheld, approx: false };
};

// Iterates the builder's own round resolution ('_id'-only, statuses only when a status
// filter needs them) and applies the identical status predicate emitRound uses.
const estimateDoorsByRound = async (ctx) => {
  const statusFilter = ctx.params.roundStatuses?.length ? new Set(ctx.params.roundStatuses) : null;
  let rows = 0;
  for await (const { universeIds, statusMap } of resolveDoorsByRoundRounds(ctx, {
    projection: '_id',
    withStatus: !!statusFilter,
  })) {
    if (!statusFilter) {
      rows += universeIds.length;
      continue;
    }
    for (const hid of universeIds) {
      const st = statusMap.get(hid) || { status: 'unknocked' };
      if (statusFilter.has(st.status)) rows += 1;
    }
  }
  return { rows, dncWithheld: 0, approx: false };
};

const estimateSurveyResults = async (ctx) => {
  const q = surveyBaseQuery(ctx);
  const flagged = flaggedOids(ctx);
  const flaggedQ = flagged.length ? { ...q, voterId: { $in: flagged } } : null;
  const [total, dncWithheld, templateIds] = await Promise.all([
    SurveyResponse.countDocuments(q),
    flaggedQ ? SurveyResponse.countDocuments(flaggedQ) : 0,
    SurveyResponse.distinct('surveyTemplateId', q),
  ]);
  const est = { rows: total - dncWithheld, dncWithheld, approx: true };
  // Several templates in scope → the artifact is a ZIP (one file per survey); break the
  // total down so the preview can say "across N files".
  const tids = templateIds.filter(Boolean);
  if (tids.length > 1) {
    const [perTemplate, perTemplateFlagged, templates] = await Promise.all([
      SurveyResponse.aggregate([{ $match: q }, { $group: { _id: '$surveyTemplateId', n: { $sum: 1 } } }]),
      flaggedQ
        ? SurveyResponse.aggregate([{ $match: flaggedQ }, { $group: { _id: '$surveyTemplateId', n: { $sum: 1 } } }])
        : [],
      SurveyTemplate.find({ _id: { $in: tids } }, 'name').lean(),
    ]);
    const nameById = new Map(templates.map((t) => [String(t._id), t.name]));
    const flaggedById = new Map(perTemplateFlagged.map((e) => [String(e._id), e.n]));
    est.files = perTemplate
      .filter((e) => e._id)
      .map((e) => {
        const withheld = flaggedById.get(String(e._id)) || 0;
        return {
          surveyTemplateId: String(e._id),
          templateName: nameById.get(String(e._id)) || '',
          rows: e.n - withheld,
          dncWithheld: withheld,
        };
      });
  }
  return est;
};

// The long file is one row per answers[] ENTRY, not per response — the $size aggregation
// is the load-bearing difference from the wide estimate. dncWithheld still counts dropped
// RESPONSES, matching the builder's countDnc unit.
const estimateSurveyAnswers = async (ctx) => {
  const q = surveyBaseQuery(ctx);
  const flagged = flaggedOids(ctx);
  const matchKept = flagged.length ? { ...q, voterId: { $nin: flagged } } : q;
  const [agg, dncWithheld] = await Promise.all([
    SurveyResponse.aggregate([
      { $match: matchKept },
      { $group: { _id: null, rows: { $sum: { $size: { $ifNull: ['$answers', []] } } } } },
    ]),
    flagged.length ? SurveyResponse.countDocuments({ ...q, voterId: { $in: flagged } }) : 0,
  ]);
  return { rows: agg[0]?.rows || 0, dncWithheld, approx: true };
};

const estimateVoterFile = async (ctx) => {
  if (ctx.params.importJobId) {
    const job = await ImportJob.findOne(
      { _id: ctx.params.importJobId, organizationId: ctx.organizationId },
      'insertedVoterIds'
    ).lean();
    if (!job) throw new ExportUserError('That import could not be found.');
    const ids = (job.insertedVoterIds || []).map(String);
    const dncWithheld = ids.filter((id) => ctx.dnc.has(id)).length;
    // Count EXISTING docs, not insertedVoterIds.length — voters deleted since the import
    // never reach the file, and the estimate must not overcount them.
    let rows = 0;
    for (const part of chunk(ids, 5000)) {
      rows += await Voter.countDocuments({ _id: { $in: part.map(oid) }, ...DNC_FILTER });
    }
    return { rows, dncWithheld, approx: false };
  }
  const base = { organizationId: ctx.organizationId, campaignId: ctx.campaignId };
  const [rows, dncWithheld] = await Promise.all([
    Voter.countDocuments({ ...base, ...DNC_FILTER }),
    Voter.countDocuments({ ...base, 'doNotContact.flagged': true }),
  ]);
  return { rows, dncWithheld, approx: false };
};

// resolveWalkList applies the DNC exclusion itself, so its id list IS the row set; the
// builder never counts DNC for this type and neither does the estimate.
const estimateVotersFiltered = async (ctx) => {
  const resolved = await resolveWalkList(ctx.campaign, ctx.params.filter || {}, {});
  return { rows: (resolved.voterIds || []).length, dncWithheld: 0, approx: false };
};

// Mirrors the builder's join order exactly: campaign membership FIRST (a flagged voter in
// another campaign is skipped, never counted as DNC), then the flag; n notes per voter.
const estimateVoterNotes = async (ctx) => {
  const q = voterNotesQuery(ctx);
  const perVoter = (
    await VoterNote.aggregate([{ $match: q }, { $group: { _id: '$voterId', n: { $sum: 1 } } }])
  ).filter((e) => e._id);
  let rows = 0;
  let dncWithheld = 0;
  for (const part of chunk(perVoter, 5000)) {
    const voters = await Voter.find(
      { _id: { $in: part.map((e) => oid(e._id)) }, campaignId: ctx.campaignId },
      '_id'
    ).lean();
    const inCampaign = new Set(voters.map((v) => String(v._id)));
    for (const e of part) {
      const vid = String(e._id);
      if (!inCampaign.has(vid)) continue;
      if (ctx.dnc.has(vid)) dncWithheld += e.n;
      else rows += e.n;
    }
  }
  return { rows, dncWithheld, approx: false };
};

// Keyed like EXPORT_TYPES; full-backup deliberately has no estimate (the endpoint 400s).
export const EXPORT_ESTIMATES = {
  'canvass-activity': estimateCanvassActivity,
  'doors-by-round': estimateDoorsByRound,
  'survey-results': estimateSurveyResults,
  'survey-answers': estimateSurveyAnswers,
  'voter-file': estimateVoterFile,
  'voters-filtered': estimateVotersFiltered,
  'voter-notes': estimateVoterNotes,
};
