import mongoose from 'mongoose';
import { EXPORT_TYPE_KEYS } from '../../models/ExportJob.js';
import { Campaign } from '../../models/Campaign.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { SavedSearch } from '../../models/SavedSearch.js';
import { ImportJob } from '../../models/ImportJob.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { zonedDayStr } from '../../utils/timezone.js';
import { ExportUserError } from './exportErrors.js';
import {
  buildCanvassActivity,
  buildDoorsByRound,
  buildSurveyResultsWide,
  buildSurveyAnswersLong,
  buildVoterFile,
  buildVotersFiltered,
  buildVoterNotes,
  buildKnocksByRound,
} from './exportBuilders.js';

// The Export Center type registry — the anti-drift spine. The route validates from it, the
// processor builds from it, and the DNC guard test iterates it (a type cannot exist without
// being under the "flagged voter appears in NO artifact" sweep). Keys come from the model
// (EXPORT_TYPE_KEYS) so the enum and the registry cannot diverge silently — the mismatch
// check at the bottom throws at import time.

const DOOR_STATUSES = ['unknocked', 'not_home', 'wrong_address', 'refused', 'surveyed', 'lit_dropped', 'restricted'];
const ACTION_TYPES = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'note_added', 'lit_dropped', 'restricted'];

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const isId = (s) => mongoose.isValidObjectId(s);

// Whitelist-normalize the shared time/attribution params. Throws user-actionable 400
// material; returns only known keys so nothing unvetted lands in the Mixed params field.
const normalizeCommon = async (params, { campaignId }, { pass = true, canvasser = true } = {}) => {
  const out = {};
  for (const k of ['from', 'to']) {
    if (params[k] == null || params[k] === '') continue;
    if (!isDay(params[k])) throw new ExportUserError(`${k} must be a YYYY-MM-DD date.`);
    out[k] = params[k];
  }
  if (params.effortId) {
    if (!isId(params.effortId)) throw new ExportUserError('effortId is not valid.');
    const effort = await Effort.findOne({ _id: params.effortId, campaignId }, '_id').lean();
    if (!effort) throw new ExportUserError('That walk list does not belong to this campaign.');
    out.effortId = String(params.effortId);
  }
  if (pass && params.passId) {
    if (params.passId === 'legacy') out.passId = 'legacy';
    else {
      if (!isId(params.passId)) throw new ExportUserError('passId is not valid.');
      const p = await Pass.findOne({ _id: params.passId, campaignId }, '_id').lean();
      if (!p) throw new ExportUserError('That pass does not belong to this campaign.');
      out.passId = String(params.passId);
    }
  }
  if (canvasser) {
    for (const k of ['userId', 'coordinatorId']) {
      if (!params[k]) continue;
      if (!isId(params[k])) throw new ExportUserError(`${k} is not valid.`);
      out[k] = String(params[k]);
    }
  }
  return out;
};

// ---------------------------------------------------------------------------------------
// full-backup — composes the standalone builders per campaign (never re-implements a file,
// so DNC semantics and column contracts are inherited), plus manifest.json + README.txt.

const safeSeg = (s) => String(s || '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60).toLowerCase() || 'x';

const BACKUP_NOTES = [
  'Do-not-contact voters are excluded from every file in this export, so totals here can be lower than dashboard figures.',
  'voterfile-current.csv is a RECONSTRUCTION from the data currently in Doorline, not the originally uploaded file: unmapped vendor columns were never stored, rows that failed import are absent, and edits made since the upload are reflected.',
  'Counting units (never sum across them): "Survey doors" counts doors (one per household per pass), "Voters surveyed" counts distinct people, "Surveys taken" counts survey submissions. activity-log.csv rows are individual door events, finer than all three.',
  'knocks-by-round.csv is the invoice-grade per-round summary; doors-by-round.csv is its per-door detail — rows with a Round status other than unknocked/restricted reconcile to that round’s Knocks.',
];

const buildFullBackup = async (ctx, sink) => {
  const campaigns = ctx.campaignId
    ? [ctx.campaign]
    : await Campaign.find({ organizationId: ctx.organizationId }).sort({ createdAt: 1 }).lean();
  if (!campaigns.length || campaigns.some((c) => !c)) {
    throw new ExportUserError('No campaigns to back up.');
  }
  const allFiles = [];
  let rowsSoFar = 0;

  for (const campaign of campaigns) {
    const folder = `campaigns/${safeSeg(campaign.name)}`;
    const subCtx = {
      ...ctx,
      campaignId: campaign._id,
      campaign,
      params: {},
      anchorTz: campaign.timeZone || ctx.org?.timeZone || 'America/New_York',
      // Sub-builders report per-file progress; the bundle reports cumulative rows instead.
      setTotalEstimate: () => {},
      progress: () => ctx.progress(rowsSoFar),
    };
    const subSink = {
      file: (name, headers) => sink.file(`${folder}/${name}`, headers),
      raw: (name, content) => sink.raw(`${folder}/${name}`, content),
    };
    // Sequential on purpose: the ZIP stream appends one entry at a time; starting a second
    // builder before the first entry ends would buffer it wholesale in memory.
    for (const build of [
      buildVoterFile,
      buildCanvassActivity,
      buildDoorsByRound,
      buildSurveyResultsWide,
      buildSurveyAnswersLong,
      buildVoterNotes,
      buildKnocksByRound,
    ]) {
      const res = await build(subCtx, subSink);
      for (const f of res.files) {
        allFiles.push({ name: `${folder}/${f.name}`, rows: f.rows });
        rowsSoFar += f.rows;
      }
      ctx.progress(rowsSoFar);
    }
  }

  const manifest = {
    schema: 'doorline-export/1',
    generatedAt: new Date().toISOString(),
    organization: { id: String(ctx.organizationId), name: ctx.org?.name || '', slug: ctx.org?.slug || '' },
    campaigns: campaigns.map((c) => ({
      id: String(c._id), name: c.name, type: c.type, state: c.state, timeZone: c.timeZone || null,
    })),
    files: allFiles,
    excludedDncCount: ctx.counters.excludedDnc,
    orphanedRows: ctx.counters.orphaned,
    notes: BACKUP_NOTES,
  };
  await sink.raw('manifest.json', JSON.stringify(manifest, null, 2));
  await sink.raw(
    'README.txt',
    [
      'Doorline data export',
      '====================',
      '',
      `Generated: ${manifest.generatedAt}`,
      `Organization: ${manifest.organization.name}`,
      '',
      'Each campaign folder contains:',
      '  voterfile-current.csv   — every voter currently in the campaign (canonical columns)',
      '  activity-log.csv        — every door event: who knocked, when, the outcome',
      '  doors-by-round.csv      — one row per door per round, with its round status',
      '  survey-results*.csv     — one row per survey taken, one column per question',
      '  survey-answers.csv      — one row per recorded answer (the as-recorded snapshot)',
      '  voter-notes.csv         — staff notes about voters',
      '  knocks-by-round.csv     — the per-round totals, with a TOTAL row',
      '',
      ...BACKUP_NOTES.map((n) => `* ${n}`),
      '',
      'manifest.json lists every file with its row count.',
    ].join('\n')
  );
  return { files: allFiles };
};

// ---------------------------------------------------------------------------------------

export const EXPORT_TYPES = {
  'canvass-activity': {
    label: 'Canvassing activity',
    adminOnly: false,
    requiresCampaign: true,
    subjectType: 'voter',
    contentKind: async () => 'csv',
    validateParams: async (params, scope) => {
      const out = await normalizeCommon(params, scope);
      if (params.actionTypes != null) {
        if (!Array.isArray(params.actionTypes) || params.actionTypes.some((a) => !ACTION_TYPES.includes(a))) {
          throw new ExportUserError('actionTypes contains an unknown action.');
        }
        if (params.actionTypes.length) out.actionTypes = params.actionTypes;
      }
      if (params.excludeBulk) out.excludeBulk = true;
      return out;
    },
    build: buildCanvassActivity,
  },
  'doors-by-round': {
    label: 'Doors by round',
    adminOnly: false,
    requiresCampaign: true,
    subjectType: 'household',
    contentKind: async () => 'csv',
    validateParams: async (params, scope) => {
      const out = await normalizeCommon(params, scope, { canvasser: false });
      delete out.from;
      delete out.to;
      if (params.roundStatuses != null) {
        if (!Array.isArray(params.roundStatuses) || params.roundStatuses.some((s) => !DOOR_STATUSES.includes(s))) {
          throw new ExportUserError('roundStatuses contains an unknown status.');
        }
        if (params.roundStatuses.length) out.roundStatuses = params.roundStatuses;
      }
      return out;
    },
    build: buildDoorsByRound,
  },
  'survey-results': {
    label: 'Survey results',
    adminOnly: false,
    requiresCampaign: true,
    subjectType: 'voter',
    // One file per template — several templates with responses in scope make it a ZIP.
    contentKind: async (ctx) => {
      const q = { organizationId: ctx.organizationId, campaignId: ctx.campaignId };
      if (ctx.params.surveyTemplateId) return 'csv';
      const ids = (await SurveyResponse.distinct('surveyTemplateId', q)).filter(Boolean);
      return ids.length > 1 ? 'zip' : 'csv';
    },
    validateParams: async (params, scope) => {
      const out = await normalizeCommon(params, scope);
      delete out.coordinatorId;
      if (params.surveyTemplateId) {
        if (!isId(params.surveyTemplateId)) throw new ExportUserError('surveyTemplateId is not valid.');
        const t = await SurveyTemplate.findOne({ _id: params.surveyTemplateId, organizationId: scope.organizationId }, '_id').lean();
        if (!t) throw new ExportUserError('That survey does not belong to this organization.');
        out.surveyTemplateId = String(params.surveyTemplateId);
      }
      return out;
    },
    build: buildSurveyResultsWide,
  },
  'survey-answers': {
    label: 'Survey answers (one row per answer)',
    adminOnly: false,
    requiresCampaign: true,
    subjectType: 'voter',
    contentKind: async () => 'csv',
    validateParams: async (params, scope) =>
      EXPORT_TYPES['survey-results'].validateParams(params, scope),
    build: buildSurveyAnswersLong,
  },
  'voter-file': {
    label: 'Voter file',
    adminOnly: false,
    requiresCampaign: true,
    subjectType: 'voter',
    contentKind: async () => 'csv',
    validateParams: async (params, scope) => {
      const out = {};
      if (params.importJobId) {
        if (!isId(params.importJobId)) throw new ExportUserError('importJobId is not valid.');
        const job = await ImportJob.findOne(
          { _id: params.importJobId, organizationId: scope.organizationId, campaignId: scope.campaignId },
          'kind status undone fieldMapping'
        ).lean();
        if (!job) throw new ExportUserError('That import could not be found in this campaign.');
        if (job.kind !== 'apply' || job.status !== 'completed') {
          throw new ExportUserError('Only completed imports can be reconstructed.');
        }
        if (job.undone) throw new ExportUserError('That import was undone — there is nothing to reconstruct.');
        if (!job.fieldMapping) {
          throw new ExportUserError('That import predates saved column mappings, so its vendor headers are unknown. Export the current voter file instead.');
        }
        out.importJobId = String(params.importJobId);
      }
      return out;
    },
    build: buildVoterFile,
  },
  'voters-filtered': {
    label: 'Filtered voters (saved search)',
    adminOnly: false,
    requiresCampaign: true,
    subjectType: 'voter',
    contentKind: async () => 'csv',
    validateParams: async (params, scope) => {
      if (!params.savedSearchId || !isId(params.savedSearchId)) {
        throw new ExportUserError('Pick a saved search to export.');
      }
      const search = await SavedSearch.findOne(
        { _id: params.savedSearchId, campaignId: scope.campaignId },
        'name filter'
      ).lean();
      if (!search) throw new ExportUserError('That saved search does not belong to this campaign.');
      // Snapshot the filter JSON at POST time so a later edit to the saved search cannot
      // falsify this job's record of what was exported.
      return {
        savedSearchId: String(search._id),
        savedSearchName: search.name,
        filter: search.filter || {},
      };
    },
    build: buildVotersFiltered,
  },
  'voter-notes': {
    label: 'Voter notes',
    adminOnly: true,
    requiresCampaign: true,
    subjectType: 'voter',
    contentKind: async () => 'csv',
    validateParams: async (params, scope) => {
      const out = await normalizeCommon(params, scope, { pass: false, canvasser: false });
      delete out.effortId;
      return out;
    },
    build: buildVoterNotes,
  },
  'full-backup': {
    label: 'Full backup',
    adminOnly: true,
    requiresCampaign: false,
    subjectType: 'voter',
    contentKind: async () => 'zip',
    validateParams: async () => ({}),
    build: buildFullBackup,
  },
};

// The registry and the model enum must name exactly the same types — fail at import time,
// not at the first mismatched POST.
{
  const a = Object.keys(EXPORT_TYPES).sort().join(',');
  const b = [...EXPORT_TYPE_KEYS].sort().join(',');
  if (a !== b) throw new Error(`EXPORT_TYPES/EXPORT_TYPE_KEYS mismatch: ${a} vs ${b}`);
}

// Download name: {org-slug}-{campaign-slug}-{type}-{YYYY-MM-DD}.{ext}, date in the anchor
// tz (walklists.js filename-sanitization precedent).
export const exportFilename = ({ org, campaign, type, anchorTz, ext }) => {
  const parts = [safeSeg(org?.slug || org?.name), campaign ? safeSeg(campaign.name) : null, type, zonedDayStr(new Date(), anchorTz)]
    .filter(Boolean);
  return `${parts.join('-')}.${ext}`;
};
