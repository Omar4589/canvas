import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { Voter } from '../../models/Voter.js';
import { Household } from '../../models/Household.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { Turf } from '../../models/Turf.js';
import { VoterNote } from '../../models/VoterNote.js';
import { ImportJob } from '../../models/ImportJob.js';
import { CANONICAL_FIELDS } from '../import/canonicalFields.js';
import { NOT_BULK, BILLABLE_WITH_RESTRICTED, NOT_DESK_MARK, fieldVisitActionTypes } from '../reports/aggregations.js';
import { getPassStatusMap } from '../passes/passStatus.js';
import {
  ACTION_TO_STATUS,
  STATUS_ROW_MATCH,
  DOOR_STATUS_LABELS,
  resolveStatusFromSummary,
} from '../../utils/statusPrecedence.js';
import { hydrateCanvassers } from '../reports/canvasserIdentity.js';
import { resolveWalkList } from '../walklist/resolveWalkList.js';
import { buildKnocksByPassData } from '../reports/knocksByPass.js';
import { zonedDayRange, tzAbbrev } from '../../utils/timezone.js';
import { DNC_FILTER } from './exportScope.js';
import { ExportUserError, EstimateTimeout } from './exportErrors.js';
import { templateAnswerPlan, snapshotAnswerText } from './surveyColumns.js';
import {
  resolveNoteScope,
  doorNotesMatch,
  surveyNotesMatch,
  adminNotesMatch,
} from '../notes/notesQuery.js';

// Row builders for every Export Center type. Each builder receives:
//   ctx  — { organizationId, campaignId, campaign, org, params, anchorTz, dnc (Set of flagged
//          voter id strings, from exportScope — injected by the processor, never built here),
//          subjects (capped collector of ids actually written), countDnc(n), countOrphaned(n),
//          progress(processedRows) }
//   sink — { file(name, headers) → row writer, raw(name, content) (ZIP artifacts only) }
// Builders stream: Mongo cursors in, csvWriter rows out, joins hydrated per batch with $in.
// Nothing materializes a whole collection. The full-backup composes these same functions —
// it never re-implements a file, so DNC semantics and column contracts are inherited.

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const BATCH = 500;

// ---------------------------------------------------------------------------------------
// Shared cell helpers

// The three-column instant rendering every dated export uses (voters-by-answer.csv
// precedent): UTC ISO + local Date + local Time, all in the ANCHOR tz — never the
// viewer's (docs/DATE_FILTERS.md).
const instantFmts = (tz) => ({
  dateFmt: new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }),
  timeFmt: new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
  tzLabel: tzAbbrev(tz) || tz,
});

const instantCells = (d, fmts) =>
  d ? [new Date(d).toISOString(), fmts.dateFmt.format(new Date(d)), fmts.timeFmt.format(new Date(d))] : ['', '', ''];

// from/to are date-only 'YYYY-MM-DD' params; half-open window in the anchor tz
// (parseDateRange's contract, req-free).
const dayRangeOf = (params, tz) => {
  const range = zonedDayRange(params.from || null, params.to || null, tz);
  return range.$gte || range.$lt ? range : null;
};

const passLabel = (p) => (p ? `Pass ${p.roundNumber}` : 'Legacy / no pass');

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Upfront metadata maps every activity/survey builder needs.
const loadPassEffortMaps = async (ctx) => {
  const [passes, efforts] = await Promise.all([
    Pass.find({ organizationId: ctx.organizationId, campaignId: ctx.campaignId }, 'roundNumber name status effortId activatedAt archivedAt').lean(),
    Effort.find({ organizationId: ctx.organizationId, campaignId: ctx.campaignId }, 'name').lean(),
  ]);
  return {
    passById: new Map(passes.map((p) => [String(p._id), p])),
    effortNameById: new Map(efforts.map((e) => [String(e._id), e.name])),
    passes,
  };
};

const canvasserCells = (info) => [info?.firstName || '', info?.lastName || '', info?.status || ''];
const nameOf = (info) => (info ? `${info.firstName || ''} ${info.lastName || ''}`.trim() : '');

// ── the opt-in detail block on the two survey exports (params.includeVoterDetail) ────────
// Owner decision 2026-08-11: OFF by default. A survey CSV is a record of what a named person
// said about politics; most of them have no business also carrying that person's date of
// birth and phone number on the same row. Every field here already leaves via the voter-file
// export to the IDENTICAL admin-or-lead audience, so the toggle is data minimization, not a
// new gate — and because it is frozen into ExportJob.params, the history row is a permanent
// record of which exports carried it.
//
// Split in two because the sources differ: the contact/demographic cells hang off the voter
// (and therefore off the DNC-guarded voter object like every other identity cell — a
// do-not-contact person is dropped before any of this is read), the geography cells off the
// household, with districts/precinct file-authoritative on the voter (the DNC-flag ruling).
const VOTER_DETAIL_HEADERS = ['Gender', 'Date of birth', 'Phone', 'Phone type', 'Cell phone'];
const GEO_DETAIL_HEADERS = [
  'County', 'Latitude', 'Longitude',
  'Precinct', 'Congressional district', 'State senate district', 'State house district',
];

const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

const voterDetailCells = (v) => [
  v?.gender || '', dateOnly(v?.dateOfBirth), v?.phone || '', v?.phoneType || '', v?.cellPhone || '',
];
const geoDetailCells = (v, h) => [
  h?.county || '',
  h?.location?.coordinates?.[1] ?? '',
  h?.location?.coordinates?.[0] ?? '',
  v?.precinct || '', v?.congressionalDistrict || '', v?.stateSenateDistrict || '', v?.stateHouseDistrict || '',
];

// Projections widen only when the toggle is on — an export that isn't printing a phone
// number should not be reading one out of Mongo either.
const SURVEY_VOTER_PROJ = 'stateVoterId uid firstName lastName party';
const SURVEY_VOTER_DETAIL_PROJ =
  `${SURVEY_VOTER_PROJ} gender dateOfBirth phone phoneType cellPhone precinct congressionalDistrict stateSenateDistrict stateHouseDistrict`;
const SURVEY_HH_PROJ = 'addressLine1 addressLine2 city state zipCode';
const SURVEY_HH_DETAIL_PROJ = `${SURVEY_HH_PROJ} county location`;

// The four things a survey builder needs to know about the toggle, resolved once.
const detailPlan = (ctx) => {
  const on = !!ctx.params.includeVoterDetail;
  return {
    on,
    voterProj: on ? SURVEY_VOTER_DETAIL_PROJ : SURVEY_VOTER_PROJ,
    hhProj: on ? SURVEY_HH_DETAIL_PROJ : SURVEY_HH_PROJ,
    voterHeaders: on ? VOTER_DETAIL_HEADERS : [],
    geoHeaders: on ? GEO_DETAIL_HEADERS : [],
    voterCells: on ? voterDetailCells : () => [],
    geoCells: on ? geoDetailCells : () => [],
  };
};

// ---------------------------------------------------------------------------------------
// canvass-activity — one row per CanvassActivity (door-unit ledger); or, opt-in, one row per
// voter registered at the door for the rows that named nobody (params.perVoterRows — fanPlan).

// The exact ledger query the builder streams, exported so the estimate endpoint counts the
// SAME universe — estimate==build by construction (the turf target-preview principle).
export const canvassActivityQuery = (ctx) => {
  const { params, anchorTz } = ctx;
  const q = { organizationId: ctx.organizationId, campaignId: ctx.campaignId };
  const range = dayRangeOf(params, anchorTz);
  if (range) q.timestamp = range;
  if (params.effortId) q.effortId = oid(params.effortId);
  if (params.passId === 'legacy') q.passId = null;
  else if (params.passId) q.passId = oid(params.passId);
  if (params.coordinatorId) q.coordinatorId = oid(params.coordinatorId);
  if (params.actionTypes?.length) q.actionType = { $in: params.actionTypes };
  // Bulk (admin desk-authored) rows are part of the campaign ledger, but the codebase-wide
  // rule is that they never appear on a per-CANVASSER surface — so a canvasser filter
  // applies NOT_BULK automatically, and excludeBulk is the explicit campaign-scope opt-out.
  if (params.userId) {
    q.userId = oid(params.userId);
    Object.assign(q, NOT_BULK);
  } else if (params.excludeBulk) {
    Object.assign(q, NOT_BULK);
  }
  return q;
};

const ACTIVITY_VOTER_PROJ = 'stateVoterId uid firstName lastName party';

// The by-voter row grain (params.perVoterRows), resolved ONCE — detailPlan's pattern. Owns the
// file name and the roster predicate, so the builder, the estimate and the download name cannot
// drift. Emission rule: an activity whose STORED voterId is null repeats once per voter in the
// kept roster of its door, and an EMPTY kept roster falls back to exactly one row identical to
// the un-fanned one (see the flush loop). Rows that already name a voter are never fanned.
export const fanPlan = (ctx) => {
  const on = !!ctx.params.perVoterRows;
  return {
    on,
    // The NAME is the only signal the grain moved, so a downstream pivot cannot silently absorb
    // fanned rows as knocks. Both names now come from activityFileNames, because the answer layer
    // moves the grain too and the two options are independent.
    fileName: activityFileNames(ctx.params).file,
    // Who "a voter at this door" is: campaign-scoped (Voter rows are per-campaign) and read
    // through the SAME DNC clause voterfile-current.csv publishes through, so the roster this
    // file repeats over is exactly the roster that file already hands the same audience.
    // oid() is defensive: ctx.campaignId is an ObjectId on both paths today, but the estimate
    // spreads this into an aggregation $match, which NEVER Mongoose-casts — a string id would
    // match nothing and every door would read as empty. Pin the cast, don't assume it.
    rosterMatch: { campaignId: oid(ctx.campaignId), ...DNC_FILTER },
    rosterProj: `${ACTIVITY_VOTER_PROJ} householdId`,
  };
};

// Per-batch roster prefetch for the fan: Map<householdId, Voter[]> over the batch's voter-less
// doors (≤ BATCH doors), empty when the plan is off. DNC_FILTER lives inside plan.rosterMatch:
// a flagged voter is structurally incapable of producing a row here, blank or otherwise. Do NOT
// "fix" this into fetch-and-blank to match the door-unit blanking rule in the loop below — a
// blank row per flagged voter, beside named siblings, is exactly the per-door marker
// exportScope.js forbids.
const loadFanRoster = async (plan, batch) => {
  if (!plan.on) return new Map();
  const doorIds = [...new Set(batch.filter((a) => !a.voterId).map((a) => String(a.householdId)))];
  if (!doorIds.length) return new Map();
  const roster = await Voter.find(
    { householdId: { $in: doorIds.map(oid) }, ...plan.rosterMatch },
    plan.rosterProj,
  ).lean();
  const byHome = new Map();
  for (const v of roster) {
    const k = String(v.householdId);
    if (!byHome.has(k)) byHome.set(k, []);
    byHome.get(k).push(v);
  }
  // Deterministic sibling order inside a door (voterfile-current.csv's sort).
  for (const list of byHome.values()) {
    list.sort(
      (a, b) =>
        (a.lastName || '').localeCompare(b.lastName || '') ||
        (a.firstName || '').localeCompare(b.firstName || '') ||
        String(a._id).localeCompare(String(b._id)),
    );
  }
  return byHome;
};

// Rows THIS file will contain under these params — the builder's progress denominator AND
// estimateCanvassActivity's `rows`, one code path, so estimate==build stops being a convention.
// Plan off: the identical countDocuments it has always been. Plan on: the fanned count is a
// JOIN CARDINALITY — Σ over doors of (voter-less knocks at the door × max(1, kept roster size))
// plus the rows that already name a voter — with no arithmetic shortcut, so it is one
// $unionWith pipeline: two index scans and a merge, ONE document back to Node (a correlated
// $lookup would be one sub-pipeline per door). opts.maxTimeMS caps that pipeline — the estimate
// runs inline in the web dyno behind a 30s router; the worker passes nothing — and on expiry
// throws EstimateTimeout, which only the estimate catches (it answers with the floor).
export const countCanvassActivityRows = async (ctx, opts = {}) => {
  const q = canvassActivityQuery(ctx);
  const plan = fanPlan(ctx);
  if (!plan.on) return CanvassActivity.countDocuments(q);
  const agg = CanvassActivity.aggregate([
    // {voterId: null} matches null AND missing; {$ne: null} is its exact complement — the same
    // partition the builder's `a.voterId ? … : …` truthy test makes.
    { $match: { ...q, voterId: null } },
    { $group: { _id: '$householdId', k: { $sum: 1 }, r: { $sum: 0 } } },
    {
      $unionWith: {
        coll: Voter.collection.name,
        pipeline: [
          { $match: plan.rosterMatch },
          { $group: { _id: '$householdId', k: { $sum: 0 }, r: { $sum: 1 } } },
        ],
      },
    },
    { $group: { _id: '$_id', k: { $sum: '$k' }, r: { $sum: '$r' } } },
    // Doors the roster branch contributed that carry no voter-less knock drop out here.
    { $match: { k: { $gt: 0 } } },
    // $max:[1,'$r'] IS the empty-roster fallback the builder writes, as arithmetic.
    { $group: { _id: null, rows: { $sum: { $multiply: ['$k', { $max: [1, '$r'] }] } } } },
  ]).allowDiskUse(true);
  if (opts.maxTimeMS) agg.option({ maxTimeMS: opts.maxTimeMS });
  try {
    const [named, fanned] = await Promise.all([
      CanvassActivity.countDocuments({ ...q, voterId: { $ne: null } }),
      agg,
    ]);
    return named + (fanned[0]?.rows || 0);
  } catch (err) {
    if (err?.codeName === 'MaxTimeMSExpired' || err?.code === 50) throw new EstimateTimeout();
    throw err;
  }
};

// The honest floor when the exact fanned count times out: every knock is at least one row.
export const canvassActivityFloorRows = (ctx) => CanvassActivity.countDocuments(canvassActivityQuery(ctx));

// ── the opt-in answer layer (params.includeSurveyAnswers) ────────────────────────────────
// Two things at once, and the second is the reason the first is honest:
//
//  COLUMNS on a survey_submitted row, joined on the SurveyResponse unique key {voterId, passId}.
//  ROWS for every in-scope response the knock ledger cannot represent — because a survey knock is
//  household-deduped: surveying three people at one door in one pass leaves ONE survey_submitted row
//  (naming whoever was surveyed last) and THREE responses. Columns alone would show one of the three
//  and look complete.
//
// The join deliberately does NOT match on userId (owner ruling 2026-09-23). Two canvassers who
// surveyed the same person in one round keep one activity row each, while the live response is the
// later one's, so both rows carry the answers OF RECORD and the disclosure columns say whose survey
// it is. The alternative — blanking the superseded row — reads as "no survey taken", which is false.
const ANSWER_HEADERS = ['Row source', 'Survey', 'Survey version', 'Survey submitted (ISO)', 'Survey taken by', 'Desk entered'];

// Responses in scope for the layer. NOT surveyBaseQuery: that one applies params.userId, which would
// defeat the ruling above by hiding the very row whose answers belong to somebody else.
const activityResponseQuery = (ctx) => {
  const q = { organizationId: ctx.organizationId, campaignId: oid(ctx.campaignId) };
  const range = dayRangeOf(ctx.params, ctx.anchorTz);
  if (range) q.submittedAt = range;
  if (ctx.params.effortId) q.effortId = oid(ctx.params.effortId);
  if (ctx.params.passId === 'legacy') q.passId = null;
  else if (ctx.params.passId) q.passId = oid(ctx.params.passId);
  if (ctx.params.coordinatorId) q.coordinatorId = oid(ctx.params.coordinatorId);
  return q;
};

// (voterId, passId) — the SurveyResponse unique key, and therefore the join key AND the coverage key.
// A pipe rather than the codebase's NUL convention so this file stays greppable; both halves are hex
// or the literal 'legacy', so nothing can collide.
const respKey = (voterId, passId) => `${voterId}|${passId ? String(passId) : 'legacy'}`;

// Is the survey layer on at all, and does it get to add rows?
// Takes PARAMS, not a ctx, so exportTypes' fileSlug (which only ever sees params) resolves the same
// layer the builder does — the file name and the columns cannot disagree about whether it is on.
export const answerLayerPlan = (params = {}) => {
  const asked = !!params.includeSurveyAnswers;
  // The chips gate the layer: a file narrowed to "not home" has no survey_submitted rows, so EVERY
  // response would read as uncovered and a re-knock list would fill with survey rows.
  const chipsAllow = !params.actionTypes?.length || params.actionTypes.includes('survey_submitted');
  // Columns, and therefore the whole layer. With surveys chipped out there is nothing to attach, so
  // the file is byte-identical to one queued without the option rather than gaining empty columns.
  const on = asked && chipsAllow;
  return {
    on,
    joinAnswers: on,
    // Rows are suppressed under a canvasser filter (owner ruling): the filter REMOVES the covering
    // rows, so keeping the rule would manufacture survey rows for work that canvasser never did — a
    // measured 9-row file, 8 of them somebody else's.
    addRows: on && !params.userId,
  };
};

// One plan per template in scope, plus the flat column list. Column identity is (templateId,
// questionKey) and never the key alone: keys are per-template label slugs, so two surveys asking the
// same question collide (surveyColumns.js).
const loadAnswerColumns = async (ctx, rq) => {
  const ids = (await SurveyResponse.distinct('surveyTemplateId', rq)).filter(Boolean).map(String);
  const templates = ids.length
    ? await SurveyTemplate.find({ _id: { $in: ids }, organizationId: ctx.organizationId }).lean()
    : [];
  const byId = new Map(templates.map((t) => [String(t._id), t]));
  const plans = new Map();
  for (const tid of ids) {
    const orphanAgg = await SurveyResponse.aggregate([
      { $match: { ...rq, surveyTemplateId: oid(tid) } },
      { $unwind: '$answers' },
      { $group: { _id: '$answers.questionKey', label: { $last: '$answers.questionLabel' } } },
    ]);
    plans.set(tid, templateAnswerPlan(byId.get(tid), orphanAgg.map((o) => ({ key: o._id, label: o.label }))));
  }
  // Several surveys in scope → the survey name prefixes its questions, because two templates can
  // legitimately carry the same question LABEL as well as the same key.
  const many = ids.length > 1;
  const cols = [];
  for (const tid of ids) {
    const plan = plans.get(tid);
    for (const c of plan.cols) {
      cols.push({
        templateId: tid,
        key: c.key,
        header: many ? `${plan.templateName || 'Survey'} — ${plan.columnOf(c)}` : plan.columnOf(c),
      });
    }
  }
  return { plans, cols };
};

// Uncovered in-scope responses: the ones no survey_submitted row in this file names. ONE aggregation
// on the composite key — the $unionWith shape countCanvassActivityRows already uses — so the estimate
// and the builder agree on a set neither can enumerate cheaply.
export const countUncoveredResponses = async (ctx, { onlyFlagged = false } = {}) => {
  const plan = answerLayerPlan(ctx.params);
  if (!plan.addRows) return 0;
  const rq = activityResponseQuery(ctx);
  const flagged = [...ctx.dnc].map(oid);
  if (onlyFlagged && !flagged.length) return 0;
  const match = onlyFlagged
    ? { ...rq, voterId: { $in: flagged } }
    : flagged.length
      ? { ...rq, voterId: { $nin: flagged } }
      : rq;
  const agg = await SurveyResponse.aggregate([
    { $match: match },
    { $group: { _id: { v: '$voterId', p: '$passId' }, r: { $sum: 1 } } },
    {
      $unionWith: {
        coll: CanvassActivity.collection.name,
        pipeline: [
          { $match: { ...canvassActivityQuery(ctx), actionType: 'survey_submitted', voterId: { $ne: null } } },
          { $group: { _id: { v: '$voterId', p: '$passId' }, a: { $sum: 1 } } },
        ],
      },
    },
    { $group: { _id: '$_id', r: { $sum: '$r' }, a: { $sum: '$a' } } },
    // a === 0 is "no activity row in this file names this (voter, pass)". Keys the activity branch
    // contributed alone carry r === 0 and drop out of the sum below anyway.
    { $match: { a: 0 } },
    { $group: { _id: null, n: { $sum: '$r' } } },
  ]).allowDiskUse(true);
  return agg[0]?.n || 0;
};

// BOTH names for this file, from ONE function. The two options are independent, so there are four
// combinations — and the pair must never disagree: csvSink discards sink.file()'s name
// (exportProcessor.js) and neither client renders ExportJob.files[].name, so the DOWNLOAD name is the
// only one a human sees, while the entry name is what the backup bundle lists.
export const activityFileNames = (params = {}) => {
  // `-with-surveys` tracks addRows, not the raw tick: columns never rename a file (includeVoterDetail
  // does not), and a name that claimed a moved grain the file does not have would be worse than none.
  const suffix = `${params.perVoterRows ? '-by-voter' : ''}${answerLayerPlan(params).addRows ? '-with-surveys' : ''}`;
  return { file: `activity-log${suffix}`, slug: `canvass-activity${suffix}` };
};

// Rows this FILE contains: the ledger rows (fan-aware) plus the responses the ledger cannot
// represent. ONE function for the estimate and the builder's progress denominator.
export const countActivityRowsWithLayer = async (ctx, opts = {}) => {
  const ledger = await countCanvassActivityRows(ctx, opts);
  return ledger + (await countUncoveredResponses(ctx));
};

export const buildCanvassActivity = async (ctx, sink) => {
  const { anchorTz } = ctx;
  const fmts = instantFmts(anchorTz);
  const q = canvassActivityQuery(ctx);
  const plan = fanPlan(ctx);
  const layer = answerLayerPlan(ctx.params);
  const rq = layer.on ? activityResponseQuery(ctx) : null;
  const answers = layer.on ? await loadAnswerColumns(ctx, rq) : { plans: new Map(), cols: [] };

  // The progress denominator is the SAME counter the estimate returns — under the fan or the answer
  // layer a plain countDocuments would pin the bar at 99% for the whole run.
  const [{ passById, effortNameById }, userIds, coordIds, respUserIds, total] = await Promise.all([
    loadPassEffortMaps(ctx),
    CanvassActivity.distinct('userId', q),
    CanvassActivity.distinct('coordinatorId', q),
    // The canvasser who took a survey may be nobody the ledger scope names — that is the whole point
    // of the disclosure columns — so hydrate them too or 'Survey taken by' exports blank.
    layer.on ? SurveyResponse.distinct('userId', rq) : [],
    countActivityRowsWithLayer(ctx),
  ]);
  const people = await hydrateCanvassers(
    [...userIds, ...coordIds, ...respUserIds].filter(Boolean).map(String),
    ctx.organizationId,
  );
  ctx.setTotalEstimate(total);

  const names = activityFileNames(ctx.params);
  const writer = await sink.file(names.file, [
    'Timestamp (ISO)', 'Date', `Time (${fmts.tzLabel})`, 'Action',
    'Address', 'Address line 2', 'City', 'State', 'Zip', 'County',
    'State voter ID', 'UID', 'Voter first name', 'Voter last name', 'Party',
    'Canvasser first name', 'Canvasser last name', 'Canvasser status', 'Team',
    'Walk list', 'Pass', 'Pass name', 'Via', 'Offline submission',
    'Latitude', 'Longitude', 'GPS accuracy (m)', 'Distance from house (m)',
    'Replaces earlier action', 'Replaced at (ISO)', 'Note',
    ...(layer.on ? [...ANSWER_HEADERS, ...answers.cols.map((c) => c.header)] : []),
    'Household DB id', 'Voter DB id', 'Activity DB id',
    ...(layer.on ? ['Response DB id'] : []),
  ]);

  // The answer cells for one response — or the same number of empty cells, so every row is the same
  // width whether or not a survey is attached to it.
  const answerCellsOf = (r) => {
    if (!layer.on) return [];
    // ANSWER_HEADERS[0] is 'Row source', which the caller writes — so both branches yield FIVE
    // metadata cells plus one per question column, and every row stays the same width.
    if (!r) return [...ANSWER_HEADERS.slice(1).map(() => ''), ...answers.cols.map(() => '')];
    const plan = answers.plans.get(String(r.surveyTemplateId));
    return [
      '', // Row source is written by the caller, which knows which stream the row came from
      plan?.templateName || '',
      r.surveyTemplateVersion ?? '',
      r.submittedAt ? new Date(r.submittedAt).toISOString() : '',
      nameOf(people.get(String(r.userId))),
      r.deskEntry ? 'yes' : '',
      ...answers.cols.map((c) =>
        c.templateId === String(r.surveyTemplateId) ? answers.plans.get(c.templateId).renderAnswer(c.key, r.answers) : ''
      ),
    ].slice(1);
  };

  // Streams: the ledger always, plus the responses when the layer may add rows. The ACTIVITY stream
  // is index 0 deliberately — mergeByTime's equal-instant tie-break is emergent (strict `<` keeps the
  // lowest index) and equal instants are the NORM here, because a field submit writes one `ts` to
  // both ledgers (routes/mobile/canvass.js). Reordering these pushes silently reorders the file.
  const tagged = async function* (cursor, source, tsField) {
    for await (const d of cursor) yield { ...d, _source: source, _t: d[tsField] };
  };
  const streams = [
    tagged(CanvassActivity.find(q).sort({ timestamp: 1 }).lean().cursor({ batchSize: BATCH }), 'knock', 'timestamp'),
  ];
  if (layer.addRows) {
    streams.push(
      tagged(SurveyResponse.find(rq).sort({ submittedAt: 1 }).lean().cursor({ batchSize: BATCH }), 'survey', 'submittedAt')
    );
  }

  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const knocks = batch.filter((d) => d._source === 'knock');
    const resps = batch.filter((d) => d._source === 'survey');

    const hhIds = [...new Set(batch.map((d) => String(d.householdId)))];
    const vIds = [
      ...new Set([
        ...knocks.map((a) => a.voterId && String(a.voterId)),
        ...resps.map((r) => String(r.voterId)),
      ].filter(Boolean)),
    ];
    const knockVoterIds = knocks.map((a) => a.voterId).filter(Boolean);
    const respVoterIds = resps.map((r) => r.voterId);

    const [homes, voters, rosterByHome, joined, coveredRows] = await Promise.all([
      Household.find({ _id: { $in: hhIds } }, 'addressLine1 addressLine2 city state zipCode county').lean(),
      vIds.length ? Voter.find({ _id: { $in: vIds } }, ACTIVITY_VOTER_PROJ).lean() : [],
      loadFanRoster(plan, knocks),
      // Answers for the knock rows: the unique key is {voterId, passId}, so this is a point seek per
      // row on an index that exists.
      layer.joinAnswers && knockVoterIds.length
        ? SurveyResponse.find({ ...rq, voterId: { $in: knockVoterIds } }).lean()
        : [],
      // Coverage decided from the RESPONSE side: for the responses in THIS batch, does any
      // survey_submitted row in the file's scope name their (voter, pass)? Deciding it from the
      // activity side instead double-prints answers at BATCH=500, because a covering row can sit in a
      // different batch than the response it covers.
      layer.addRows && respVoterIds.length
        ? CanvassActivity.find(
            { ...q, actionType: 'survey_submitted', voterId: { $in: respVoterIds } },
            'voterId passId',
          ).lean()
        : [],
    ]);
    const homeById = new Map(homes.map((h) => [String(h._id), h]));
    const voterById = new Map(voters.map((v) => [String(v._id), v]));
    const joinedByKey = new Map(joined.map((r) => [respKey(String(r.voterId), r.passId), r]));
    const covered = new Set(coveredRows.map((a) => respKey(String(a.voterId), a.passId)));

    for (const doc of batch) {
      if (doc._source === 'survey') {
        const r = doc;
        const vid = String(r.voterId);
        // Already represented by a knock row in this file — its answers are on that row.
        if (covered.has(respKey(vid, r.passId))) continue;
        // Voter-unit: this row IS the person, so a flagged voter's row goes entirely.
        if (ctx.dnc.has(vid)) {
          ctx.countDnc(1);
          continue;
        }
        const v = voterById.get(vid);
        // Dangling voterId (an import undo): the row is kept with blank identity, exactly as a
        // dangling KNOCK row is — this file's door-unit habit — and counted as orphaned. Keeping it
        // is also what lets the estimate stay exact rather than `approx`.
        if (!v) ctx.countOrphaned(1);
        else ctx.subjects.add(vid);
        const h = homeById.get(String(r.householdId));
        const p = r.passId ? passById.get(String(r.passId)) : null;
        const canv = people.get(String(r.userId)) || null;
        const team = r.coordinatorId ? people.get(String(r.coordinatorId)) : null;
        const plan2 = answers.plans.get(String(r.surveyTemplateId));
        await writer.writeRow([
          ...instantCells(r.submittedAt, fmts), 'survey_submitted',
          h?.addressLine1 || '', h?.addressLine2 || '', h?.city || '', h?.state || '', h?.zipCode || '', h?.county || '',
          v?.stateVoterId || '', v?.uid || '', v?.firstName || '', v?.lastName || '', v?.party || '',
          ...canvasserCells(canv),
          team ? `${team.firstName} ${team.lastName}`.trim() : '',
          p ? effortNameById.get(String(p.effortId)) || '' : '',
          p ? p.roundNumber : '', p ? p.name : passLabel(p),
          'field',
          r.wasOfflineSubmission ? 'yes' : 'no',
          r.location?.lat ?? '', r.location?.lng ?? '', r.location?.accuracy ?? '',
          r.distanceFromHouseMeters ?? '',
          '', '',
          r.note || '',
          // Row source = survey: this row came from the survey ledger, NOT the knock ledger. Never
          // count these as knocks — which is also why the file is renamed when the option is on.
          'survey', plan2?.templateName || '', r.surveyTemplateVersion ?? '',
          r.submittedAt ? new Date(r.submittedAt).toISOString() : '',
          nameOf(people.get(String(r.userId))),
          r.deskEntry ? 'yes' : '',
          ...answers.cols.map((c) =>
            c.templateId === String(r.surveyTemplateId) ? answers.plans.get(c.templateId).renderAnswer(c.key, r.answers) : ''
          ),
          String(r.householdId), v ? vid : '', '',
          String(r._id),
        ]);
        continue;
      }

      const a = doc;
      const h = homeById.get(String(a.householdId));
      const vid = a.voterId ? String(a.voterId) : null;
      // Door-unit DNC rule: the knock is a record of work performed (and billed), so the ROW stays;
      // the PERSON does not appear. Blank identity, no marker (a marker would itself flag the
      // household as containing an opt-out).
      const dncHit = vid && ctx.dnc.has(vid);
      if (dncHit) ctx.countDnc(1);
      const v = !dncHit && vid ? voterById.get(vid) : null;
      if (v) ctx.subjects.add(vid);
      else if (vid && !dncHit) ctx.countOrphaned(1); // dangling voterId — Voter doc gone; row kept (door-unit rule)
      const p = a.passId ? passById.get(String(a.passId)) : null;
      const canv = people.get(String(a.userId)) || null;
      const team = a.coordinatorId ? people.get(String(a.coordinatorId)) : null;
      // The joined survey, and NOT for a flagged voter: their answers and their survey note are
      // identity too, so a row that blanks the name must blank those as well or the export hands over
      // what a do-not-contact person said, beside their full address.
      const joinedResp = !dncHit && vid && layer.joinAnswers ? joinedByKey.get(respKey(vid, a.passId)) : null;
      const fan = !vid && plan.on ? rosterByHome.get(String(a.householdId)) || [] : [];
      // `[null]` is the row exactly as it has always been written — and it is ALSO the fallback when
      // the kept roster is empty (no registered voters, OR every one of them flagged), so an
      // all-flagged door is byte-identical to an empty one and the ABSENCE of rows can never become
      // the marker the door-unit rule forbids. Do not optimize this row away.
      for (const fv of fan.length ? fan : [null]) {
        const rv = fv || v;
        if (fv) ctx.subjects.add(String(fv._id)); // only identities that actually shipped
        // A fanned row is a neighbour's copy of a door-level knock; attaching the named voter's
        // answers to it would attribute one person's survey to everyone at the address.
        const rowResp = fv ? null : joinedResp;
        await writer.writeRow([
          ...instantCells(a.timestamp, fmts), a.actionType,
          h?.addressLine1 || '', h?.addressLine2 || '', h?.city || '', h?.state || '', h?.zipCode || '', h?.county || '',
          rv?.stateVoterId || '', rv?.uid || '', rv?.firstName || '', rv?.lastName || '', rv?.party || '',
          ...canvasserCells(canv),
          team ? `${team.firstName} ${team.lastName}`.trim() : '',
          p ? effortNameById.get(String(p.effortId)) || '' : '',
          p ? p.roundNumber : '', p ? p.name : passLabel(p),
          a.via === 'bulk' ? 'bulk' : 'field',
          a.wasOfflineSubmission ? 'yes' : 'no',
          a.location?.lat ?? '', a.location?.lng ?? '', a.location?.accuracy ?? '',
          a.distanceFromHouseMeters ?? '',
          a.replaced?.actionType || '',
          a.replaced?.timestamp ? new Date(a.replaced.timestamp).toISOString() : '',
          // The note on a survey_submitted row is the SURVEY's note (canvass.js writes it to both
          // ledgers), so it is identity for the same reason the answers are.
          dncHit && a.actionType === 'survey_submitted' ? '' : a.note || '',
          ...(layer.on ? ['knock', ...answerCellsOf(rowResp)] : []),
          String(a.householdId), fv ? String(fv._id) : dncHit ? '' : vid || '', String(a._id),
          ...(layer.on ? [rowResp ? String(rowResp._id) : ''] : []),
        ]);
      }
    }
    ctx.progress(writer.rowsWritten);
    batch = [];
  };

  for await (const doc of mergeByTime(streams)) {
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return { files: [{ name: names.file, rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// doors-by-round — one row per (household × pass), LONG shape. Reconciliation contract:
// rows with `Round status` ∉ {unknocked, restricted} for a pass === that pass's `knocks`
// in knocks-by-pass (both are distinct (household, pass) over KNOCK_ACTIONS).

const DOORS_HH_PROJ = 'addressLine1 addressLine2 city state zipCode county precinctValue status isActive';

// Shared round/universe resolution — the builder and the estimate endpoint iterate the
// SAME rounds, so estimate==build by construction (the turf target-preview principle).
// `projection: '_id'` lets the estimate skip address hydration; `withStatus: false` skips
// the status aggregations entirely for an unfiltered count. The expensive per-round joins
// (visits, canvassers, turf names) stay in the builder — a count never needs them.
export const resolveDoorsByRoundRounds = async function* (ctx, { projection = DOORS_HH_PROJ, withStatus = true } = {}) {
  const { params } = ctx;
  const campaignType = ctx.campaign?.type || 'survey';

  const passQ = { organizationId: ctx.organizationId, campaignId: ctx.campaignId };
  if (params.effortId) passQ.effortId = oid(params.effortId);
  if (params.passId && params.passId !== 'legacy') passQ._id = oid(params.passId);
  // 'legacy' means ONLY the null-pass bucket (the passId:null mapping every other type
  // uses) — real rounds are skipped entirely, not merely un-filtered.
  const [{ effortNameById }, passes] = await Promise.all([
    loadPassEffortMaps(ctx),
    params.passId === 'legacy' ? [] : Pass.find(passQ, 'roundNumber name status effortId').lean(),
  ]);
  passes.sort(
    (a, b) =>
      (effortNameById.get(String(a.effortId)) || '￿').localeCompare(effortNameById.get(String(b.effortId)) || '￿') ||
      a.roundNumber - b.roundNumber
  );

  // The legacy (passId:null) pseudo-round needs getPassStatusMap's exact sticky-completion
  // rule but that helper requires a real passId — this is the same aggregation with the
  // null-pass match, kept adjacent to the real one so they can't drift far.
  const legacyStatusMap = async (hhIds) => {
    const map = new Map();
    for (const ids of chunk(hhIds, 2000)) {
      const agg = await CanvassActivity.aggregate([
        { $match: { campaignId: ctx.campaignId, passId: null, householdId: { $in: ids.map(oid) }, actionType: { $ne: 'note_added' } } },
        { $sort: { timestamp: -1 } },
        { $group: { _id: '$householdId', actions: { $addToSet: '$actionType' }, latestActionType: { $first: '$actionType' }, latestTimestamp: { $first: '$timestamp' } } },
      ]);
      const completion = campaignType === 'lit_drop' ? 'lit_dropped' : 'survey_submitted';
      const completionStatus = campaignType === 'lit_drop' ? 'lit_dropped' : 'surveyed';
      for (const a of agg) {
        map.set(String(a._id), {
          status: a.actions.includes(completion) ? completionStatus : ACTION_TO_STATUS[a.latestActionType] || 'unknocked',
          lastActionAt: a.latestTimestamp,
        });
      }
    }
    return map;
  };

  for (const pass of passes) {
    // Universe = doors the effort owns now ∪ doors the ledger touched this round (catches
    // doors deactivated or re-homed after being worked — they emit with Active door: no).
    const [owned, touched] = await Promise.all([
      Household.find({ campaignId: ctx.campaignId, effortId: pass.effortId, isActive: true }, projection).lean(),
      CanvassActivity.distinct('householdId', { campaignId: ctx.campaignId, passId: pass._id }),
    ]);
    const homeById = new Map(owned.map((h) => [String(h._id), h]));
    const extraIds = touched.map(String).filter((id) => !homeById.has(id));
    if (extraIds.length) {
      const extras = await Household.find({ _id: { $in: extraIds } }, projection).lean();
      for (const h of extras) homeById.set(String(h._id), h);
    }
    const universeIds = [...homeById.keys()];
    const statusMap = new Map();
    if (withStatus) {
      for (const ids of chunk(universeIds, 2000)) {
        const m = await getPassStatusMap(pass._id, ids, campaignType);
        for (const [k, v] of m) statusMap.set(k, v);
      }
    }
    yield { pass, universeIds, homeById, statusMap };
  }

  // Legacy pre-turf bucket: doors with null-pass activity only, one pseudo-round for the
  // campaign (legacy rows predate efforts, so there is no per-effort axis to put them on).
  if (!params.passId || params.passId === 'legacy') {
    const touched = await CanvassActivity.distinct('householdId', { campaignId: ctx.campaignId, passId: null });
    if (touched.length) {
      const ids = touched.map(String);
      const homes = await Household.find({ _id: { $in: ids } }, projection).lean();
      const homeById = new Map(homes.map((h) => [String(h._id), h]));
      const statusMap = withStatus ? await legacyStatusMap(ids) : new Map();
      yield { pass: null, universeIds: ids, homeById, statusMap };
    }
  }
};

export const buildDoorsByRound = async (ctx, sink) => {
  const { params, anchorTz } = ctx;
  const fmts = instantFmts(anchorTz);

  const [{ effortNameById }, turfs] = await Promise.all([
    loadPassEffortMaps(ctx),
    Turf.find({ campaignId: ctx.campaignId }, 'name').lean(),
  ]);
  const turfNameById = new Map(turfs.map((t) => [String(t._id), t.name]));
  const statusFilter = params.roundStatuses?.length ? new Set(params.roundStatuses) : null;

  const writer = await sink.file('doors-by-round', [
    'Walk list', 'Pass', 'Pass name', 'Pass status', 'Book',
    'Address', 'Address line 2', 'City', 'State', 'Zip', 'County', 'Precinct',
    'Round status', 'Door visits this round',
    'Last action at (ISO)', 'Date', `Time (${fmts.tzLabel})`,
    'Last action by first name', 'Last action by last name', 'Last action by status',
    'Campaign status', 'Active door', 'Household DB id',
  ]);

  // Per-pass visit/attribution rollup (event-unit visits over BILLABLE_WITH_RESTRICTED,
  // latest turf/user by time — the LEDGER's turfId, never Household.turfId, which mirrors
  // only the current cut and would mislabel past rounds).
  const visitAgg = (passIdMatch) =>
    CanvassActivity.aggregate([
      { $match: { campaignId: ctx.campaignId, passId: passIdMatch, actionType: { $in: BILLABLE_WITH_RESTRICTED } } },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: '$householdId',
          visits: { $sum: 1 },
          lastTurfId: { $last: '$turfId' },
          lastUserId: { $last: '$userId' },
        },
      },
    ]);

  const emitRound = async ({ pass, universeIds, homeById, statusMap, visitsById, people }) => {
    for (const hid of universeIds) {
      const st = statusMap.get(hid) || { status: 'unknocked', lastActionAt: null };
      if (statusFilter && !statusFilter.has(st.status)) continue;
      const h = homeById.get(hid);
      const vis = visitsById.get(hid);
      const by = vis?.lastUserId ? people.get(String(vis.lastUserId)) : null;
      ctx.subjects.add(hid);
      await writer.writeRow([
        pass ? effortNameById.get(String(pass.effortId)) || '' : '',
        pass ? pass.roundNumber : '', pass ? pass.name : 'Legacy / no pass', pass ? pass.status : '',
        vis?.lastTurfId ? turfNameById.get(String(vis.lastTurfId)) || '' : '',
        h?.addressLine1 || '', h?.addressLine2 || '', h?.city || '', h?.state || '', h?.zipCode || '', h?.county || '', h?.precinctValue || '',
        st.status, vis?.visits || 0,
        ...instantCells(st.lastActionAt, fmts),
        ...canvasserCells(by),
        h?.status || '', h?.isActive === false ? 'no' : 'yes', hid,
      ]);
    }
    ctx.progress(writer.rowsWritten);
  };

  let universeSoFar = 0;
  for await (const round of resolveDoorsByRoundRounds(ctx)) {
    universeSoFar += round.universeIds.length;
    ctx.setTotalEstimate(universeSoFar);
    const visits = await visitAgg(round.pass ? round.pass._id : null);
    const visitsById = new Map(visits.map((v) => [String(v._id), v]));
    const people = await hydrateCanvassers(
      visits.map((v) => v.lastUserId && String(v.lastUserId)).filter(Boolean),
      ctx.organizationId,
    );
    await emitRound({ ...round, visitsById, people });
  }

  return { files: [{ name: 'doors-by-round', rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// survey-results (wide) — one row per SurveyResponse ("Surveys taken"), one FILE per
// template. Answers render id-native against CURRENT option text (the reporting
// aggregations' stable-id contract) with the recorded snapshot as fallback; the LONG
// export below is the never-rewritten snapshot record for disputes.

// Exported for the estimate endpoint — the count and the build must share one query.
export const surveyBaseQuery = (ctx) => {
  const q = { organizationId: ctx.organizationId, campaignId: ctx.campaignId };
  const range = dayRangeOf(ctx.params, ctx.anchorTz);
  if (range) q.submittedAt = range;
  if (ctx.params.effortId) q.effortId = oid(ctx.params.effortId);
  if (ctx.params.passId === 'legacy') q.passId = null;
  else if (ctx.params.passId) q.passId = oid(ctx.params.passId);
  if (ctx.params.userId) q.userId = oid(ctx.params.userId);
  if (ctx.params.surveyTemplateId) q.surveyTemplateId = oid(ctx.params.surveyTemplateId);
  return q;
};

export const buildSurveyResultsWide = async (ctx, sink) => {
  const q = surveyBaseQuery(ctx);
  const detail = detailPlan(ctx);
  const templateIds = (await SurveyResponse.distinct('surveyTemplateId', q)).filter(Boolean);
  if (!templateIds.length) {
    await sink.file('survey-results', ['Submitted (ISO)']);
    return { files: [{ name: 'survey-results', rows: 0 }] };
  }
  let processedSoFar = 0;
  const fmts = instantFmts(ctx.anchorTz);
  const { passById, effortNameById } = await loadPassEffortMaps(ctx);
  const [userIds, coordIds, deskIds, total] = await Promise.all([
    SurveyResponse.distinct('userId', q),
    SurveyResponse.distinct('coordinatorId', q),
    // The admin who desk-entered is usually NOT on the campaign roster, so they have to be
    // hydrated explicitly or the "Desk entered by" column silently exports blank.
    SurveyResponse.distinct('deskEntry.byUserId', q),
    SurveyResponse.countDocuments(q),
  ]);
  const people = await hydrateCanvassers(
    [...userIds, ...coordIds, ...deskIds].filter(Boolean).map(String),
    ctx.organizationId
  );
  ctx.setTotalEstimate(total);
  const files = [];

  for (const tid of templateIds) {
    const template = await SurveyTemplate.findOne({ _id: tid, organizationId: ctx.organizationId }).lean();
    const tq = { ...q, surveyTemplateId: tid };
    // Column discovery is its own pass (two-phase): current questions in template order,
    // then orphan keys (hard-deleted questions still present in recorded answers), labeled
    // from their snapshot — a single streaming pass would either buffer every row or miss
    // late orphan keys.
    const orphanAgg = await SurveyResponse.aggregate([
      { $match: tq },
      { $unwind: '$answers' },
      { $group: { _id: '$answers.questionKey', label: { $last: '$answers.questionLabel' } } },
    ]);
    // Columns and the renderer come from the shared per-template factory
    // (services/export/surveyColumns.js), so this file and Results by voter can never disagree
    // about what a question is called or what an option id means. Per-template by construction:
    // option ids are unique only within a question and question keys only within a template, and
    // the duplicate route clones both verbatim.
    const { cols, columnOf, renderAnswer } = templateAnswerPlan(
      template,
      orphanAgg.map((o) => ({ key: o._id, label: o.label })),
    );


    const slug = (template?.name || 'survey').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40).toLowerCase();
    const name = templateIds.length > 1 ? `survey-${slug}` : 'survey-results';
    const writer = await sink.file(name, [
      'Submitted (ISO)', 'Date', `Time (${fmts.tzLabel})`,
      'Walk list', 'Pass', 'Pass name',
      'State voter ID', 'UID', 'Voter first name', 'Voter last name', 'Party',
      ...detail.voterHeaders,
      'Address', 'Address line 2', 'City', 'State', 'Zip',
      ...detail.geoHeaders,
      'Canvasser first name', 'Canvasser last name', 'Canvasser status', 'Team',
      'Template', 'Template version', 'Offline submission', 'Edited',
      // Desk entered = an admin typed these answers when converting the door to Surveyed. It counts
      // in every rate exactly like a field answer; the column is provenance, not arithmetic.
      'Desk entered', 'Desk entered by', 'Note',
      ...cols.map(columnOf),
      'Household DB id', 'Voter DB id', 'Response DB id',
    ]);

    const cursor = SurveyResponse.find(tq).sort({ submittedAt: 1 }).lean().cursor({ batchSize: BATCH });
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const vIds = [...new Set(batch.map((r) => String(r.voterId)))];
      const hhIds = [...new Set(batch.map((r) => String(r.householdId)))];
      const [voters, homes] = await Promise.all([
        Voter.find({ _id: { $in: vIds } }, detail.voterProj).lean(),
        Household.find({ _id: { $in: hhIds } }, detail.hhProj).lean(),
      ]);
      const voterById = new Map(voters.map((v) => [String(v._id), v]));
      const homeById = new Map(homes.map((h) => [String(h._id), h]));
      for (const r of batch) {
        const vid = String(r.voterId);
        // Voter-unit DNC rule: the row IS the person — drop it entirely.
        if (ctx.dnc.has(vid)) {
          ctx.countDnc(1);
          continue;
        }
        const v = voterById.get(vid);
        if (!v) {
          // Import-undo orphan: an identityless survey row is unusable and misleading.
          ctx.countOrphaned(1);
          continue;
        }
        ctx.subjects.add(vid);
        const h = homeById.get(String(r.householdId));
        const p = r.passId ? passById.get(String(r.passId)) : null;
        const canv = people.get(String(r.userId));
        const team = r.coordinatorId ? people.get(String(r.coordinatorId)) : null;
        await writer.writeRow([
          ...instantCells(r.submittedAt, fmts),
          p ? effortNameById.get(String(p.effortId)) || '' : '',
          p ? p.roundNumber : '', p ? p.name : passLabel(p),
          v.stateVoterId || '', v.uid || '', v.firstName || '', v.lastName || '', v.party || '',
          ...detail.voterCells(v),
          h?.addressLine1 || '', h?.addressLine2 || '', h?.city || '', h?.state || '', h?.zipCode || '',
          ...detail.geoCells(v, h),
          ...canvasserCells(canv),
          team ? `${team.firstName} ${team.lastName}`.trim() : '',
          template?.name || '', r.surveyTemplateVersion ?? '',
          r.wasOfflineSubmission ? 'yes' : 'no',
          r.editedAt ? 'yes' : '',
          r.deskEntry ? 'yes' : '',
          r.deskEntry ? nameOf(people.get(String(r.deskEntry.byUserId))) : '',
          r.note || '',
          ...cols.map((c) => renderAnswer(c.key, r.answers)),
          String(r.householdId), vid, String(r._id),
        ]);
      }
      ctx.progress(processedSoFar + writer.rowsWritten);
      batch = [];
    };
    for await (const doc of cursor) {
      batch.push(doc);
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    files.push({ name, rows: writer.rowsWritten });
    processedSoFar += writer.rowsWritten;
  }
  return { files };
};

// ---------------------------------------------------------------------------------------
// survey-answers (long) — one row per answers[] entry, snapshot text (the historical
// record; complements the wide file's current-text rendering).

export const buildSurveyAnswersLong = async (ctx, sink) => {
  const q = surveyBaseQuery(ctx);
  const detail = detailPlan(ctx);
  const fmts = instantFmts(ctx.anchorTz);
  const { passById, effortNameById } = await loadPassEffortMaps(ctx);
  const [userIds, total, templates] = await Promise.all([
    SurveyResponse.distinct('userId', q),
    SurveyResponse.countDocuments(q),
    SurveyTemplate.find({ organizationId: ctx.organizationId }, 'name').lean(),
  ]);
  const people = await hydrateCanvassers(userIds.filter(Boolean).map(String), ctx.organizationId);
  const templateNameById = new Map(templates.map((t) => [String(t._id), t.name]));
  ctx.setTotalEstimate(total);

  const writer = await sink.file('survey-answers', [
    'Submitted (ISO)', 'Date', `Time (${fmts.tzLabel})`,
    'State voter ID', 'UID', 'Voter first name', 'Voter last name', 'Party',
    ...detail.voterHeaders,
    'Address', 'Address line 2', 'City', 'State', 'Zip',
    ...detail.geoHeaders,
    'Canvasser first name', 'Canvasser last name', 'Canvasser status',
    'Walk list', 'Pass', 'Pass name', 'Template', 'Template version',
    'Question', 'Question key', 'Answer', 'Option ids', 'Other text',
    'Note', 'Offline submission', 'Desk entered',
    'Household DB id', 'Voter DB id', 'Response DB id',
  ]);

  const cursor = SurveyResponse.find(q).sort({ submittedAt: 1 }).lean().cursor({ batchSize: BATCH });
  let batch = [];
  let responsesSeen = 0;
  const flush = async () => {
    if (!batch.length) return;
    const vIds = [...new Set(batch.map((r) => String(r.voterId)))];
    const hhIds = [...new Set(batch.map((r) => String(r.householdId)))];
    const [voters, homes] = await Promise.all([
      Voter.find({ _id: { $in: vIds } }, detail.voterProj).lean(),
      Household.find({ _id: { $in: hhIds } }, detail.hhProj).lean(),
    ]);
    const voterById = new Map(voters.map((v) => [String(v._id), v]));
    const homeById = new Map(homes.map((h) => [String(h._id), h]));
    for (const r of batch) {
      responsesSeen += 1;
      const vid = String(r.voterId);
      if (ctx.dnc.has(vid)) {
        ctx.countDnc(1);
        continue;
      }
      const v = voterById.get(vid);
      if (!v) {
        // orphanedRows counts dropped ROWS in this file's unit — answer entries, not
        // responses (the wide file's unit) — so est.rows === rowCount + orphanedRows
        // holds exactly for the answer-unit estimate.
        ctx.countOrphaned((r.answers || []).length);
        continue;
      }
      ctx.subjects.add(vid);
      const h = homeById.get(String(r.householdId));
      const p = r.passId ? passById.get(String(r.passId)) : null;
      const canv = people.get(String(r.userId));
      const shared = [
        ...instantCells(r.submittedAt, fmts),
        v.stateVoterId || '', v.uid || '', v.firstName || '', v.lastName || '', v.party || '',
        ...detail.voterCells(v),
        h?.addressLine1 || '', h?.addressLine2 || '', h?.city || '', h?.state || '', h?.zipCode || '',
        ...detail.geoCells(v, h),
        ...canvasserCells(canv),
        p ? effortNameById.get(String(p.effortId)) || '' : '',
        p ? p.roundNumber : '', p ? p.name : passLabel(p),
        templateNameById.get(String(r.surveyTemplateId)) || '', r.surveyTemplateVersion ?? '',
      ];
      const tail = [r.note || '', r.wasOfflineSubmission ? 'yes' : 'no', r.deskEntry ? 'yes' : '', String(r.householdId), vid, String(r._id)];
      for (const a of r.answers || []) {
        await writer.writeRow([
          ...shared,
          a.questionLabel || '', a.questionKey || '',
          snapshotAnswerText(a),
          (a.optionIds || []).join('; '), a.otherText || '',
          ...tail,
        ]);
      }
    }
    ctx.progress(responsesSeen);
    batch = [];
  };
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return { files: [{ name: 'survey-answers', rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// results-by-voter — the client deliverable. One row per registered voter at a door with a
// surviving FIELD VISIT, union anyone surveyed in scope. Read docs/EXPORTS.md "What one row of
// Results by voter is" before changing any of the four definitions below; they are what let this
// file be reconciled against Doors by round and against an invoice.
//
// FOUR DEFINITIONS, each a decision rather than an implementation detail:
//  1. A VISIT is a field-visit row — fieldVisitMatch, the same sentence that starts a campaign's
//     billing clock. A desk mark is not a visit; a field Restricted IS (the walk was made).
//  2. ADDRESS OUTCOME resolves over the door's non-note rows (STATUS_ROW_MATCH), which INCLUDES
//     desk restricts — so this column says what the map, Books and Door Outcomes say. Resolving it
//     over visits instead would print "Not home" for a door the rest of the product calls
//     "Restricted".
//  3. The FILTERS narrow the work columns: a "last week, canvasser Ada" file prints Ada's visits in
//     that window, not the door's lifetime. The outcome CHIPS are the exception — they narrow which
//     doors are in the file, never how a door's outcome reads, or every row's outcome would be
//     whatever was ticked.
//  4. A ROUND is a passId, never a round number: roundNumber resets per effort (models/Pass.js), so
//     "R2" names a different round in every walk list. Blocks carry the walk-list name.
//
// WHAT IT CANNOT SAY, stated here because the row count invites the question: a field-visited door
// with NO registered voters, and one whose whole roster is do-not-contact, both produce ZERO rows
// and are indistinguishable by design (exportScope.js). So the rows are not "the doors you worked"
// — doors-by-round is the file that accounts for every door. Unknock and pass-discard hard-delete
// rows, which is why the universe is doors with a SURVIVING visit.

const VOTER_RESULTS_PROJ = 'stateVoterId uid firstName lastName party';

// The base ledger scope: campaign + the narrowing filters, with NO actionType opinion, so the two
// row sets below can each state their own. Two actionType keys in one object literal is a silent
// overwrite — the hazard fieldVisitActionTypes exists to remove.
const voterResultsBase = (ctx) => {
  const { params, anchorTz } = ctx;
  const q = { organizationId: ctx.organizationId, campaignId: oid(ctx.campaignId) };
  const range = dayRangeOf(params, anchorTz);
  if (range) q.timestamp = range;
  if (params.effortId) q.effortId = oid(params.effortId);
  if (params.passId === 'legacy') q.passId = null;
  else if (params.passId) q.passId = oid(params.passId);
  if (params.userId) q.userId = oid(params.userId);
  if (params.coordinatorId) q.coordinatorId = oid(params.coordinatorId);
  return q;
};

// Which ledger rows count as a visit here. null means the chips intersected to nothing, which is
// ZERO ROWS — never "no filter" (fieldVisitActionTypes' contract).
export const voterResultsVisitQuery = (ctx) => {
  const types = fieldVisitActionTypes(ctx.params.actionTypes);
  if (!types) return null;
  // fieldVisitMatch's own actionType is REPLACED, deliberately and visibly, by the intersection.
  return { ...voterResultsBase(ctx), ...NOT_DESK_MARK, actionType: { $in: types } };
};

// Status rows: every non-note row at the door, desk marks included (definition 2).
const voterResultsStatusQuery = (ctx) => ({ ...voterResultsBase(ctx), ...STATUS_ROW_MATCH });

// The responses in scope. No actionType concept — a SurveyResponse has none — and the outcome chips
// deliberately do not reach here: an answer is a fact about the PERSON, so narrowing the file to
// not-home doors still shows what the people at those doors said in another round.
export const voterResultsResponseQuery = (ctx) => {
  const { params, anchorTz } = ctx;
  const q = { organizationId: ctx.organizationId, campaignId: oid(ctx.campaignId) };
  const range = dayRangeOf(params, anchorTz);
  if (range) q.submittedAt = range;
  if (params.effortId) q.effortId = oid(params.effortId);
  if (params.passId === 'legacy') q.passId = null;
  else if (params.passId) q.passId = oid(params.passId);
  if (params.userId) q.userId = oid(params.userId);
  if (params.coordinatorId) q.coordinatorId = oid(params.coordinatorId);
  return q;
};

// The universe, resolved once and shared by the builder and the estimate so a preview can never
// count a different set than the file contains.
//
// Streamed through an aggregation cursor rather than `distinct`: distinct returns ONE reply and dies
// at the 16MB BSON cap (~840k ids), while the Set itself is affordable — measured 193 B/entry, so
// ~20MB at the largest campaign on record (107k doors) and ~45MB at the 250k design target, against
// the worker's 384MB heap with EXPORT_CONCURRENCY 1.
//
// The SURVEYED half is not redundant with the door half: a re-import moves Voter.householdId while
// SurveyResponse.householdId stays frozen at submit time (services/import/csvImporter.js), so a
// voter we surveyed who has since re-housed to an unknocked door would otherwise vanish from their
// own results file.
export const resolveVoterResultsUniverse = async (ctx) => {
  const visitQuery = voterResultsVisitQuery(ctx);
  const workedDoors = new Set();
  if (visitQuery) {
    const cursor = CanvassActivity.aggregate([{ $match: visitQuery }, { $group: { _id: '$householdId' } }])
      .allowDiskUse(true)
      .cursor({ batchSize: 1000 });
    for await (const doc of cursor) workedDoors.add(String(doc._id));
  }
  // The surveyed half follows the outcome chips, because it is a REPAIR for the re-housing case
  // rather than a second universe: a response implies a survey_submitted visit, so asking for
  // not-home work only and still receiving everyone ever surveyed would make the chips cosmetic.
  // No chips means every field visit, so the default is unaffected.
  const visitTypes = fieldVisitActionTypes(ctx.params.actionTypes) || [];
  const surveyedVoters = new Set(
    visitTypes.includes('survey_submitted')
      ? (await SurveyResponse.distinct('voterId', voterResultsResponseQuery(ctx))).filter(Boolean).map(String)
      : [],
  );
  return { visitQuery, workedDoors, surveyedVoters };
};

const inUniverse = (universe, voter) =>
  universe.workedDoors.has(String(voter.householdId)) || universe.surveyedVoters.has(String(voter._id));

// Voters in the universe, counted per 5000-id chunk like its neighbour emitVoterRows — a single $in
// of every worked door is both a huge query and a planner hazard. `extraOf` is the surveyed-half
// remainder, resolved THROUGH Voter so a response pointing at a deleted voter (an import undo)
// cannot count a row the roster cursor can never emit.
const countUniverseVoters = async (ctx, universe, extra = {}) => {
  const base = { organizationId: ctx.organizationId, campaignId: oid(ctx.campaignId), ...extra };
  let n = 0;
  for (const part of chunk([...universe.workedDoors], 5000)) {
    n += await Voter.countDocuments({ ...base, householdId: { $in: part.map(oid) } });
  }
  for (const part of chunk([...universe.surveyedVoters], 5000)) {
    const rows = await Voter.find({ ...base, _id: { $in: part.map(oid) } }, 'householdId').lean();
    n += rows.filter((v) => !universe.workedDoors.has(String(v.householdId))).length;
  }
  return n;
};

// Rows this file will contain — the estimate's `rows` AND the builder's progress denominator, one
// code path. Exact: the roster IS the row set, so there is nothing the count cannot see.
export const countVoterResultsRows = async (ctx, universe) =>
  countUniverseVoters(ctx, universe || (await resolveVoterResultsUniverse(ctx)), DNC_FILTER);

// What the do-not-contact promise withheld, over the SAME universe as the rows (buildVoterFile's
// pattern). It has to be a second query rather than a per-row tally: DNC_FILTER lives inside the
// roster cursor, so a flagged voter never reaches a row for ctx.countDnc to count.
export const countVoterResultsWithheld = (ctx, universe) =>
  countUniverseVoters(ctx, universe, { 'doNotContact.flagged': true });

// Per-batch door facts. ONE aggregation, no $sort — there is no {campaignId, householdId, timestamp}
// index, so sorting would make the planner drop the householdId bound and read the whole campaign
// once per batch (measured: 280,000 docs examined instead of 7,500). The composite $max is the house
// idiom (services/reports/overlaps.js) and is also what keeps an equal-instant tie deterministic,
// which $last after a $sort would not be.
const loadDoorFacts = async (ctx, doorIds) => {
  if (!doorIds.length) return new Map();
  const visitTypes = fieldVisitActionTypes(ctx.params.actionTypes) || [];
  // A visit is a field-visit row: in the (possibly chip-narrowed) set AND not a desk mark.
  const isVisit = {
    $and: [
      { $in: ['$actionType', visitTypes] },
      { $not: [{ $and: [{ $eq: ['$actionType', 'restricted'] }, { $eq: ['$via', 'bulk'] }] }] },
    ],
  };
  const rows = await CanvassActivity.aggregate([
    { $match: { ...voterResultsStatusQuery(ctx), householdId: { $in: doorIds.map(oid) } } },
    {
      $group: {
        _id: '$householdId',
        // Definition 2 — the status ladder's inputs, over every non-note row.
        actions: { $addToSet: '$actionType' },
        latest: { $max: { at: '$timestamp', action: '$actionType' } },
        // Definition 1 — the visit-only cells.
        visits: { $sum: { $cond: [isVisit, 1, 0] } },
        firstVisit: { $min: { $cond: [isVisit, '$timestamp', null] } },
        lastVisit: { $max: { $cond: [isVisit, { at: '$timestamp', by: '$userId' }, null] } },
        visitPasses: { $addToSet: { $cond: [isVisit, '$passId', '$$REMOVE'] } },
      },
    },
    // Emit the field name the ladder READS. The composite exists for the deterministic tie-break,
    // but handing resolveStatusFromSummary a shape it does not recognise returns 'unknocked' — a
    // legal-looking constant, and one that only shows up on non-completion doors (a surveyed door
    // still reads correctly off `actions`). Mapping it here rather than at the call site is what
    // stops that from being a hand-copied field name again.
    { $addFields: { latestActionType: '$latest.action' } },
  ]).allowDiskUse(true);
  return new Map(rows.map((r) => [String(r._id), r]));
};

// Deterministic block order: walk list, then round, legacy bucket last. NOT pass.activatedAt — the
// archive path never sets it and time order interleaves walk lists. SINK keeps a null last.
const SINK = '￿';

const orderAnswerBlocks = (pairs, { passById, effortNameById }) =>
  pairs
    .map((p) => {
      const pass = p.passId ? passById.get(String(p.passId)) : null;
      return {
        ...p,
        pass,
        effortName: pass ? effortNameById.get(String(pass.effortId)) || '' : '',
        roundNumber: pass ? pass.roundNumber ?? 0 : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort(
      (a, b) =>
        (a.pass ? a.effortName || SINK : SINK).localeCompare(b.pass ? b.effortName || SINK : SINK) ||
        a.roundNumber - b.roundNumber ||
        String(a.templateName || '').localeCompare(String(b.templateName || '')) ||
        String(a.templateId).localeCompare(String(b.templateId)),
    );

// (templateId, passId) → the voter's response for that block. A pipe is a safe separator because
// both halves are hex ids or the literal 'legacy'; the codebase's NUL convention is deliberately
// NOT used here, so this file stays greppable (see CLAUDE.md on the NUL-bearing files).
const blockKey = (templateId, passId) => `${templateId}|${passId || 'legacy'}`;

export const buildVoterResults = async (ctx, sink) => {
  const { anchorTz } = ctx;
  const fmts = instantFmts(anchorTz);
  const detail = detailPlan(ctx);
  const wantNotes = !!ctx.params.includeSurveyNote;

  const universe = await resolveVoterResultsUniverse(ctx);
  const { passById, effortNameById } = await loadPassEffortMaps(ctx);
  const rq = voterResultsResponseQuery(ctx);

  // Column discovery: the (template, pass) pairs that ACTUALLY occur in scope. A voter can hold at
  // most one response per pass ({voterId, passId} is unique and DB-enforced), so a template x round
  // cross product would be mostly columns no row can ever fill — and blank reads as "not surveyed".
  const pairAgg = await SurveyResponse.aggregate([
    { $match: rq },
    { $group: { _id: { templateId: '$surveyTemplateId', passId: '$passId' } } },
  ]);
  const templateIds = [...new Set(pairAgg.map((p) => p._id.templateId).filter(Boolean).map(String))];
  const templates = templateIds.length
    ? await SurveyTemplate.find({ _id: { $in: templateIds }, organizationId: ctx.organizationId }).lean()
    : [];
  const templateById = new Map(templates.map((t) => [String(t._id), t]));

  // One answer plan per template — per-template by construction, see surveyColumns.js.
  const planByTemplate = new Map();
  for (const tid of templateIds) {
    const orphanAgg = await SurveyResponse.aggregate([
      { $match: { ...rq, surveyTemplateId: oid(tid) } },
      { $unwind: '$answers' },
      { $group: { _id: '$answers.questionKey', label: { $last: '$answers.questionLabel' } } },
    ]);
    planByTemplate.set(
      tid,
      templateAnswerPlan(
        templateById.get(tid),
        orphanAgg.map((o) => ({ key: o._id, label: o.label })),
      ),
    );
  }

  const blocks = orderAnswerBlocks(
    pairAgg
      .filter((p) => p._id.templateId)
      .map((p) => ({
        templateId: String(p._id.templateId),
        passId: p._id.passId ? String(p._id.passId) : null,
        templateName: planByTemplate.get(String(p._id.templateId))?.templateName || '',
      })),
    { passById, effortNameById },
  );

  // One block needs no prefix — the file then reads like Survey results with a door block in front.
  // Several do, and the prefix names the WALK LIST as well as the round, because round numbers reset
  // per effort. Uniquified, because two efforts may legitimately share a name (Effort has no unique
  // name index) and two templates can occur in one pass if the survey was switched mid-round.
  const rawLabel = (b) => (b.pass ? `${b.effortName ? `${b.effortName} ` : ''}R${b.pass.roundNumber}` : 'Legacy / no pass');
  const labelCounts = new Map();
  for (const b of blocks) labelCounts.set(rawLabel(b), (labelCounts.get(rawLabel(b)) || 0) + 1);
  const seen = new Map();
  for (const b of blocks) {
    const base = rawLabel(b);
    if ((labelCounts.get(base) || 0) > 1) {
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      b.label = `${base} · ${b.templateName || `survey ${n}`}`;
    } else {
      b.label = base;
    }
  }
  const prefixed = blocks.length > 1;
  const colName = (b, base) => (prefixed ? `${b.label} — ${base}` : base);

  const [total, withheld] = await Promise.all([
    countVoterResultsRows(ctx, universe),
    countVoterResultsWithheld(ctx, universe),
  ]);
  ctx.setTotalEstimate(total);
  if (withheld) ctx.countDnc(withheld);

  const writer = await sink.file('results-by-voter', [
    'State voter ID', 'UID', 'Voter first name', 'Voter last name', 'Party',
    ...detail.voterHeaders,
    'Address', 'Address line 2', 'City', 'State', 'Zip',
    ...detail.geoHeaders,
    'Address outcome', 'Address visits', 'Rounds worked',
    `Address first visited (${fmts.tzLabel})`, `Address last visited (${fmts.tzLabel})`,
    'Last visited by first name', 'Last visited by last name', 'Last visited by status',
    'Surveys taken',
    ...blocks.flatMap((b) => {
      const plan = planByTemplate.get(b.templateId);
      return [
        colName(b, 'Survey'),
        ...plan.cols.map((c) => colName(b, plan.columnOf(c))),
        ...(wantNotes ? [colName(b, 'Note')] : []),
      ];
    }),
    'Household DB id', 'Voter DB id',
  ]);

  const cursor = Voter.find(
    { organizationId: ctx.organizationId, campaignId: oid(ctx.campaignId), ...DNC_FILTER },
    `${detail.on ? detail.voterProj : VOTER_RESULTS_PROJ} householdId`,
  )
    .sort({ lastName: 1, firstName: 1 })
    .lean()
    .cursor({ batchSize: BATCH });

  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const kept = batch.filter((v) => inUniverse(universe, v));
    batch = [];
    if (!kept.length) return;

    const doorIds = [...new Set(kept.map((v) => String(v.householdId)).filter(Boolean))];
    const [homes, doorFacts, responses] = await Promise.all([
      Household.find({ _id: { $in: doorIds } }, detail.hhProj).lean(),
      loadDoorFacts(ctx, doorIds),
      SurveyResponse.find({ ...rq, voterId: { $in: kept.map((v) => v._id) } }).lean(),
    ]);
    const homeById = new Map(homes.map((h) => [String(h._id), h]));
    const byVoter = new Map();
    for (const r of responses) {
      const k = String(r.voterId);
      if (!byVoter.has(k)) byVoter.set(k, new Map());
      byVoter.get(k).set(blockKey(String(r.surveyTemplateId), r.passId && String(r.passId)), r);
    }

    const canvIds = [
      ...new Set([...doorFacts.values()].map((d) => d.lastVisit?.by && String(d.lastVisit.by)).filter(Boolean)),
    ];
    const people = canvIds.length ? await hydrateCanvassers(canvIds, ctx.organizationId) : new Map();

    for (const v of kept) {
      const h = homeById.get(String(v.householdId));
      const facts = doorFacts.get(String(v.householdId));
      const mine = byVoter.get(String(v._id)) || new Map();
      ctx.subjects.add(String(v._id));

      await writer.writeRow([
        v.stateVoterId || '', v.uid || '', v.firstName || '', v.lastName || '', v.party || '',
        ...detail.voterCells(v),
        h?.addressLine1 || '', h?.addressLine2 || '', h?.city || '', h?.state || '', h?.zipCode || '',
        ...detail.geoCells(v, h),
        DOOR_STATUS_LABELS[resolveStatusFromSummary(ctx.campaign?.type, facts)] || '',
        facts?.visits ?? 0,
        facts?.visitPasses?.length ?? 0,
        facts?.firstVisit ? fmts.dateFmt.format(new Date(facts.firstVisit)) : '',
        facts?.lastVisit?.at ? fmts.dateFmt.format(new Date(facts.lastVisit.at)) : '',
        ...canvasserCells(facts?.lastVisit?.by ? people.get(String(facts.lastVisit.by)) : null),
        mine.size,
        ...blocks.flatMap((b) => {
          const plan = planByTemplate.get(b.templateId);
          const r = mine.get(blockKey(b.templateId, b.passId));
          return [
            r ? `${plan.templateName}${r.deskEntry ? ' (desk entered)' : ''}` : '',
            ...plan.cols.map((c) => (r ? plan.renderAnswer(c.key, r.answers) : '')),
            ...(wantNotes ? [r?.note || ''] : []),
          ];
        }),
        String(v.householdId || ''), String(v._id),
      ]);
    }
    ctx.progress(writer.rowsWritten);
  };

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return { files: [{ name: 'results-by-voter', rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// voter-file — reconstruction only (owner decision: raw uploads stay deleted).
//   with importJobId  → the vendor's own headers via ImportJob.fieldMapping, rows = that
//                       import's still-existing net-new voters;
//   without           → the full current roster under canonical labels.

const voterValueOf = (key, v, h) => {
  switch (key) {
    case 'dateOfBirth':
      return v.dateOfBirth ? new Date(v.dateOfBirth).toISOString().slice(0, 10) : '';
    case 'addressLine1': return h?.addressLine1 || '';
    case 'addressLine2': return h?.addressLine2 || '';
    case 'city': return h?.city || '';
    case 'state': return h?.state || '';
    case 'zipCode': return h?.zipCode || '';
    case 'county': return h?.county || '';
    case 'latitude': return h?.location?.coordinates?.[1] ?? '';
    case 'longitude': return h?.location?.coordinates?.[0] ?? '';
    default: return v[key] ?? '';
  }
};

const emitVoterRows = async (ctx, writer, voterQueryChunks, keys) => {
  for (const q of voterQueryChunks) {
    const voters = await Voter.find(q).sort({ lastName: 1, firstName: 1 }).lean();
    const hhIds = [...new Set(voters.map((v) => String(v.householdId)).filter(Boolean))];
    const homes = await Household.find({ _id: { $in: hhIds } }, 'addressLine1 addressLine2 city state zipCode county location').lean();
    const homeById = new Map(homes.map((h) => [String(h._id), h]));
    for (const v of voters) {
      const h = homeById.get(String(v.householdId));
      ctx.subjects.add(String(v._id));
      await writer.writeRow([
        ...keys.map((k) => voterValueOf(k, v, h)),
        String(v.householdId || ''), String(v._id),
      ]);
    }
    ctx.progress(writer.rowsWritten);
  }
};

export const buildVoterFile = async (ctx, sink) => {
  const { params } = ctx;
  if (params.importJobId) {
    const job = await ImportJob.findOne({ _id: params.importJobId, organizationId: ctx.organizationId }).lean();
    if (!job) throw new ExportUserError('That import could not be found.');
    if (job.kind !== 'apply' || job.status !== 'completed') {
      throw new ExportUserError('Only completed imports can be reconstructed.');
    }
    if (job.undone) throw new ExportUserError('That import was undone — there is nothing to reconstruct.');
    if (!job.fieldMapping) {
      throw new ExportUserError('That import predates saved column mappings, so its vendor headers are unknown. Export the current voter file instead.');
    }
    // Vendor headers in CANONICAL_FIELDS order. The same vendor header can serve two
    // canonical keys (the default profile maps registeredState AND state to
    // 'Registered State') — emit each header once, first canonical key wins, or the CSV
    // would carry duplicate columns.
    const seen = new Set();
    const cols = [];
    for (const f of CANONICAL_FIELDS) {
      const vendor = job.fieldMapping[f.key];
      if (!vendor || seen.has(vendor)) continue;
      seen.add(vendor);
      cols.push({ key: f.key, header: vendor });
    }
    const ids = (job.insertedVoterIds || []).map(String);
    const dncExcluded = ids.filter((id) => ctx.dnc.has(id)).length;
    if (dncExcluded) ctx.countDnc(dncExcluded);
    ctx.setTotalEstimate(ids.length - dncExcluded);
    const writer = await sink.file('voterfile-import', [...cols.map((c) => c.header), 'Household DB id', 'Voter DB id']);
    const chunks = chunk(ids, 5000).map((part) => ({ _id: { $in: part }, ...DNC_FILTER }));
    await emitVoterRows(ctx, writer, chunks, cols.map((c) => c.key));
    return {
      files: [{ name: 'voterfile-import', rows: writer.rowsWritten }],
      meta: { importJobId: String(job._id), importFilename: job.filename, importTotalRows: job.totalRows },
    };
  }

  const base = { organizationId: ctx.organizationId, campaignId: ctx.campaignId };
  const [total, flagged] = await Promise.all([
    Voter.countDocuments({ ...base, ...DNC_FILTER }),
    Voter.countDocuments({ ...base, 'doNotContact.flagged': true }),
  ]);
  if (flagged) ctx.countDnc(flagged);
  ctx.setTotalEstimate(total);
  const keys = CANONICAL_FIELDS.map((f) => f.key);
  const writer = await sink.file('voterfile-current', [
    ...CANONICAL_FIELDS.map((f) => f.label), 'Household DB id', 'Voter DB id',
  ]);
  // One query, streamed via the sort index; emitVoterRows handles the per-chunk shape, so
  // wrap the single query as one "chunk" and let the cursor inside do the paging.
  const cursor = Voter.find({ ...base, ...DNC_FILTER }).sort({ lastName: 1, firstName: 1 }).lean().cursor({ batchSize: BATCH });
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const hhIds = [...new Set(batch.map((v) => String(v.householdId)).filter(Boolean))];
    const homes = await Household.find({ _id: { $in: hhIds } }, 'addressLine1 addressLine2 city state zipCode county location').lean();
    const homeById = new Map(homes.map((h) => [String(h._id), h]));
    for (const v of batch) {
      const h = homeById.get(String(v.householdId));
      ctx.subjects.add(String(v._id));
      await writer.writeRow([...keys.map((k) => voterValueOf(k, v, h)), String(v.householdId || ''), String(v._id)]);
    }
    ctx.progress(writer.rowsWritten);
    batch = [];
  };
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return { files: [{ name: 'voterfile-current', rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// voters-filtered — a SavedSearch-scoped subset, resolved live through resolveWalkList
// (which applies the voter-level DNC exclusion itself — the DNC_FILTER in the chunk
// queries is belt-and-braces, not the enforcement point).

export const buildVotersFiltered = async (ctx, sink) => {
  const resolved = await resolveWalkList(ctx.campaign, ctx.params.filter || {}, {});
  const ids = (resolved.voterIds || []).map(String);
  ctx.setTotalEstimate(ids.length);
  const keys = CANONICAL_FIELDS.map((f) => f.key);
  const writer = await sink.file('voters-filtered', [
    ...CANONICAL_FIELDS.map((f) => f.label), 'Household DB id', 'Voter DB id',
  ]);
  const chunks = chunk(ids, 5000).map((part) => ({ _id: { $in: part }, ...DNC_FILTER }));
  await emitVoterRows(ctx, writer, chunks, keys);
  return { files: [{ name: 'voters-filtered', rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// voter-notes — staff-authored free text about voters (admin-only; the one dataset no
// route could export before the Export Center). Notes about DNC voters are dropped
// entirely: the note body frequently contains the opt-out request itself.

// Exported for the estimate endpoint — the count and the build must share one query.
export const voterNotesQuery = (ctx) => {
  const q = { organizationId: ctx.organizationId };
  const range = dayRangeOf(ctx.params, ctx.anchorTz);
  if (range) q.createdAt = range;
  return q;
};

export const buildVoterNotes = async (ctx, sink) => {
  const fmts = instantFmts(ctx.anchorTz);
  const q = voterNotesQuery(ctx);
  const authorIds = await VoterNote.distinct('authorId', q);
  const people = await hydrateCanvassers(authorIds.filter(Boolean).map(String), ctx.organizationId);
  ctx.setTotalEstimate(await VoterNote.countDocuments(q));

  const writer = await sink.file('voter-notes', [
    'Created (ISO)', 'Date', `Time (${fmts.tzLabel})`,
    'State voter ID', 'UID', 'Voter first name', 'Voter last name',
    'Address', 'City', 'State', 'Zip',
    'Author first name', 'Author last name', 'Author status',
    'Edited', 'Edited at (ISO)', 'Note',
    'Voter DB id', 'Note DB id',
  ]);

  const cursor = VoterNote.find(q).sort({ createdAt: 1 }).lean().cursor({ batchSize: BATCH });
  let batch = [];
  let seen = 0;
  const flush = async () => {
    if (!batch.length) return;
    const vIds = [...new Set(batch.map((n) => String(n.voterId)))];
    // Campaign scoping happens through the voter join: VoterNote is org-level, Voter rows
    // are per-campaign, so a note only belongs in this campaign's export if its voter does.
    const voters = await Voter.find(
      { _id: { $in: vIds }, campaignId: ctx.campaignId },
      'stateVoterId uid firstName lastName householdId'
    ).lean();
    const voterById = new Map(voters.map((v) => [String(v._id), v]));
    const hhIds = [...new Set(voters.map((v) => String(v.householdId)).filter(Boolean))];
    const homes = await Household.find({ _id: { $in: hhIds } }, 'addressLine1 addressLine2 city state zipCode').lean();
    const homeById = new Map(homes.map((h) => [String(h._id), h]));
    for (const n of batch) {
      seen += 1;
      const vid = String(n.voterId);
      const v = voterById.get(vid);
      if (!v) continue; // another campaign's voter, or deleted
      if (ctx.dnc.has(vid)) {
        ctx.countDnc(1);
        continue;
      }
      ctx.subjects.add(vid);
      const h = homeById.get(String(v.householdId));
      const author = people.get(String(n.authorId));
      await writer.writeRow([
        ...instantCells(n.createdAt, fmts),
        v.stateVoterId || '', v.uid || '', v.firstName || '', v.lastName || '',
        h?.addressLine1 || '', h?.city || '', h?.state || '', h?.zipCode || '',
        ...canvasserCells(author),
        n.editedAt ? 'yes' : '', n.editedAt ? new Date(n.editedAt).toISOString() : '',
        n.body || '',
        vid, String(n._id),
      ]);
    }
    ctx.progress(seen);
    batch = [];
  };
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return { files: [{ name: 'voter-notes', rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// notes — one row per note, unioning the three live note stores. The reason this type exists:
// door notes (CanvassActivity.note) and survey notes (SurveyResponse.note) were only ever
// reachable as one column buried in a wide door/survey file, and the Notes hub that unions all
// three caps each source at 500 rows. This streams, uncapped.
//
// Scope resolution is shared with GET /admin/reports/notes through services/notes/notesQuery.js,
// so the screen and the download can never disagree about what a filter selects — and the
// estimate below calls this SAME function, which is what makes estimate==build hold.
export const notesScopeOf = (ctx) =>
  resolveNoteScope({
    organizationId: ctx.organizationId,
    campaignId: ctx.campaignId,
    anchorTz: ctx.anchorTz,
    from: ctx.params.from,
    to: ctx.params.to,
    effortId: ctx.params.effortId,
    passId: ctx.params.passId,
    userId: ctx.params.userId,
    q: ctx.params.q,
    sources: ctx.params.noteSources,
    actionTypes: ctx.params.actionTypes,
  });

const SOURCE_LABEL = { door: 'Door', survey: 'Survey', voter: 'Admin' };

// Tag each cursor's docs with the source and ONE comparable instant, so the merge below can
// order across three collections whose time fields have three different names.
const taggedNotes = async function* (cursor, source, tsField) {
  for await (const d of cursor) yield { ...d, _source: source, _t: d[tsField] };
};

// K-way merge of already-sorted streams. Chronological across sources without ever holding more
// than one row per source in memory — the whole point of not merging in JS after the fact.
const mergeByTime = async function* (streams) {
  const heads = await Promise.all(streams.map((it) => it.next()));
  const live = heads.map((h) => (h.done ? null : h.value));
  for (;;) {
    let best = -1;
    for (let i = 0; i < live.length; i += 1) {
      if (!live[i]) continue;
      if (best === -1 || new Date(live[i]._t) < new Date(live[best]._t)) best = i;
    }
    if (best === -1) return;
    yield live[best];
    const nxt = await streams[best].next();
    live[best] = nxt.done ? null : nxt.value;
  }
};

export const buildNotes = async (ctx, sink) => {
  const scope = notesScopeOf(ctx);
  const fmts = instantFmts(ctx.anchorTz);
  const withDoorVoters = !!ctx.params.includeDoorVoters;
  const has = (t) => scope.sources.includes(t);

  const doorQ = doorNotesMatch(scope);
  const surveyQ = surveyNotesMatch(scope);
  const adminQ = adminNotesMatch(scope);

  const [{ passById, effortNameById }, doorUsers, surveyUsers, deskUsers, adminUsers, dTotal, sTotal, aTotal] =
    await Promise.all([
      loadPassEffortMaps(ctx),
      has('door') ? CanvassActivity.distinct('userId', doorQ) : [],
      has('survey') ? SurveyResponse.distinct('userId', surveyQ) : [],
      has('survey') ? SurveyResponse.distinct('deskEntry.byUserId', surveyQ) : [],
      has('voter') ? VoterNote.distinct('authorId', adminQ) : [],
      has('door') ? CanvassActivity.countDocuments(doorQ) : 0,
      has('survey') ? SurveyResponse.countDocuments(surveyQ) : 0,
      has('voter') ? VoterNote.countDocuments(adminQ) : 0,
    ]);
  const people = await hydrateCanvassers(
    [...doorUsers, ...surveyUsers, ...deskUsers, ...adminUsers].filter(Boolean).map(String),
    ctx.organizationId,
  );
  ctx.setTotalEstimate(dTotal + sTotal + aTotal);

  const writer = await sink.file('notes', [
    'Created (ISO)', 'Date', `Time (${fmts.tzLabel})`, 'Source', 'Outcome',
    'State voter ID', 'UID', 'Voter first name', 'Voter last name',
    'Address', 'City', 'State', 'Zip',
    'Author first name', 'Author last name', 'Author status',
    'Desk entered', 'Desk entered by',
    'Walk list', 'Pass', 'Pass name',
    'Edited', 'Edited at (ISO)', 'Note',
    ...(withDoorVoters ? ['Voters at this door', 'Voter count at this door'] : []),
    'Household DB id', 'Voter DB id', 'Note DB id',
  ]);

  const streams = [];
  if (has('door')) {
    streams.push(
      taggedNotes(
        CanvassActivity.find(doorQ, '_id note timestamp actionType userId householdId voterId passId')
          .sort({ timestamp: 1 }).lean().cursor({ batchSize: BATCH }),
        'door', 'timestamp',
      ),
    );
  }
  if (has('survey')) {
    streams.push(
      taggedNotes(
        SurveyResponse.find(surveyQ, '_id note submittedAt userId householdId voterId passId editedBy editedAt deskEntry')
          .sort({ submittedAt: 1 }).lean().cursor({ batchSize: BATCH }),
        'survey', 'submittedAt',
      ),
    );
  }
  if (has('voter')) {
    streams.push(
      taggedNotes(
        VoterNote.find(adminQ, '_id body createdAt authorId voterId editedBy editedAt')
          .sort({ createdAt: 1 }).lean().cursor({ batchSize: BATCH }),
        'voter', 'createdAt',
      ),
    );
  }

  let batch = [];
  const flush = async () => {
    if (!batch.length) return;

    // Voter ids named by a row; household ids known directly (door/survey) — an admin note gets
    // its household through its voter, which is also how it is scoped to this campaign.
    const vIds = [...new Set(batch.map((n) => n.voterId && String(n.voterId)).filter(Boolean))];
    const voters = vIds.length
      ? await Voter.find(
          { _id: { $in: vIds }, campaignId: ctx.campaignId },
          'stateVoterId uid firstName lastName householdId',
        ).lean()
      : [];
    const voterById = new Map(voters.map((v) => [String(v._id), v]));

    const hhIds = new Set(batch.map((n) => n.householdId && String(n.householdId)).filter(Boolean));
    for (const v of voters) if (v.householdId) hhIds.add(String(v.householdId));
    const homes = hhIds.size
      ? await Household.find({ _id: { $in: [...hhIds] } }, 'addressLine1 city state zipCode').lean()
      : [];
    const homeById = new Map(homes.map((h) => [String(h._id), h]));

    // The opt-in door roster. DNC voters are omitted SILENTLY and the count counts listed names
    // only — a count that disagreed with the list would itself be the do-not-contact marker the
    // door-unit rule forbids. The omission is indistinguishable from voterfile-current.csv, which
    // already excludes flagged voters through the same filter.
    let rosterByHome = new Map();
    if (withDoorVoters) {
      const doorHomes = [...new Set(batch.filter((n) => n._source === 'door' && n.householdId).map((n) => String(n.householdId)))];
      const roster = doorHomes.length
        ? await Voter.find(
            { householdId: { $in: doorHomes }, campaignId: ctx.campaignId, ...DNC_FILTER },
            'firstName lastName householdId',
          ).lean()
        : [];
      rosterByHome = roster.reduce((m, v) => {
        const k = String(v.householdId);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(`${v.firstName || ''} ${v.lastName || ''}`.trim());
        v.householdId && ctx.subjects.add(String(v._id));
        return m;
      }, new Map());
    }

    for (const n of batch) {
      const vid = n.voterId ? String(n.voterId) : null;
      const dncHit = vid && ctx.dnc.has(vid);

      // Voter-unit rows ARE the person, so a flagged voter drops the row entirely — the note body
      // very often quotes the opt-out request itself. Door-unit rows are a record of work: the row
      // stays and the identity blanks, with no marker.
      if (dncHit && n._source !== 'door') {
        ctx.countDnc(1);
        continue;
      }
      if (dncHit) ctx.countDnc(1);

      const v = !dncHit && vid ? voterById.get(vid) : null;
      if (vid && !dncHit && !v) {
        // A survey note names a voter that no longer exists (import-undo). Voter-unit → the row
        // goes, counted as an orphan so the estimate (which counts responses without a voter join)
        // still reconciles. An ADMIN note misses for a second, indistinguishable reason — the voter
        // belongs to another campaign, which is the COMMON case for an org-level VoterNote — and
        // its estimate already excludes both through the campaign join, so it is skipped silently.
        // A DOOR row is never skipped and therefore never counted here: unlike canvass-activity
        // (approx:false, where orphans are informational), this type is approx:true, so a count
        // with no matching skipped row would break est.rows === rowCount + orphanedRows.
        if (n._source === 'survey') ctx.countOrphaned(1);
        if (n._source !== 'door') continue;
      }
      if (n._source === 'voter' && !v) continue; // org-level note, not this campaign's voter
      if (v) ctx.subjects.add(vid);

      const hid = n.householdId ? String(n.householdId) : v?.householdId ? String(v.householdId) : '';
      const h = hid ? homeById.get(hid) : null;
      const p = n.passId ? passById.get(String(n.passId)) : null;
      const author = people.get(String(n._source === 'voter' ? n.authorId : n.userId)) || null;
      const desk = n.deskEntry?.byUserId ? people.get(String(n.deskEntry.byUserId)) : null;
      const names = n._source === 'door' && withDoorVoters ? rosterByHome.get(hid) || [] : [];

      await writer.writeRow([
        ...instantCells(n._t, fmts),
        SOURCE_LABEL[n._source],
        n._source === 'door' ? n.actionType || '' : n._source === 'survey' ? 'survey_submitted' : '',
        v?.stateVoterId || '', v?.uid || '', v?.firstName || '', v?.lastName || '',
        h?.addressLine1 || '', h?.city || '', h?.state || '', h?.zipCode || '',
        ...canvasserCells(author),
        // The note on a desk-converted survey was typed by an ADMIN, but the row's userId is the
        // field canvasser who took the original survey — so Author alone would name the wrong
        // person in a file whose whole point is who wrote each note.
        desk ? 'yes' : '', desk ? nameOf(desk) : '',
        p ? effortNameById.get(String(p.effortId)) || '' : '',
        p ? p.roundNumber : '', p ? p.name : '',
        n.editedAt ? 'yes' : '', n.editedAt ? new Date(n.editedAt).toISOString() : '',
        (n._source === 'voter' ? n.body : n.note) || '',
        ...(withDoorVoters ? [names.join('; '), names.length || ''] : []),
        hid, dncHit ? '' : vid || '', String(n._id),
      ]);
    }
    ctx.progress(writer.rowsWritten);
    batch = [];
  };

  for await (const doc of mergeByTime(streams)) {
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return { files: [{ name: 'notes', rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// knocks-by-round — the invoice-grade per-round rollup, through the SAME extracted core as
// /admin/reports/knocks-by-pass(.csv), so Σ rounds === totals holds by construction. Used
// by the full-backup bundle (standalone consumers keep using the existing sync route).

export const buildKnocksByRound = async (ctx, sink) => {
  const built = await buildKnocksByPassData({
    organizationId: ctx.organizationId,
    campaignId: ctx.campaignId,
  });
  const doorCols = built.billRestricted ? ['Restricted doors', 'Billable doors'] : [];
  const doorVals = (r) => (built.billRestricted ? [r.restrictedDoors, r.billableDoors] : []);
  // Column order mirrors /admin/reports/knocks-by-pass.csv exactly — 'Surveys taken' (the
  // response unit) directly after 'Survey doors' (the door unit the rates are built from).
  // The two files are read side by side; a divergence here reads as a data difference.
  const writer = await sink.file('knocks-by-round', [
    'Walk list', 'Pass', 'Pass name', 'Pass status', 'Activated (ISO)', 'Archived (ISO)',
    'Knocks', 'Survey doors', 'Surveys taken', 'Lit knocks', 'Refused', 'No soliciting',
    ...doorCols, 'Connection rate %', 'Contact rate %', 'New homes reached',
  ]);
  for (const r of built.rounds) {
    await writer.writeRow([
      r.effortName || '', r.roundNumber ?? '', r.roundName ?? r.roundLabel, r.status || '',
      r.activatedAt ? new Date(r.activatedAt).toISOString() : '',
      r.archivedAt ? new Date(r.archivedAt).toISOString() : '',
      r.knocks, r.surveyedKnocks, r.surveysTaken, r.litKnocks, r.refusedKnocks,
      r.noSolicitingKnocks,
      ...doorVals(r), r.connectionRate, r.contactRate, r.coverageGained,
    ]);
  }
  const t = built.totals;
  await writer.writeRow([
    'TOTAL', '', '', '', '', '',
    t.knocks, t.surveyedKnocks, t.surveysTaken, t.litKnocks, t.refusedKnocks,
    t.noSolicitingKnocks,
    ...doorVals(t), t.connectionRate, t.contactRate, t.coverageGained,
  ]);
  return { files: [{ name: 'knocks-by-round', rows: writer.rowsWritten }] };
};
