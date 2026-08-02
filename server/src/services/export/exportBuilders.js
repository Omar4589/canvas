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
import { NOT_BULK, BILLABLE_WITH_RESTRICTED } from '../reports/aggregations.js';
import { getPassStatusMap } from '../passes/passStatus.js';
import { ACTION_TO_STATUS } from '../../utils/statusPrecedence.js';
import { hydrateCanvassers } from '../reports/canvasserIdentity.js';
import { resolveWalkList } from '../walklist/resolveWalkList.js';
import { buildKnocksByPassData } from '../reports/knocksByPass.js';
import { zonedDayRange, tzAbbrev } from '../../utils/timezone.js';
import { DNC_FILTER } from './exportScope.js';
import { ExportUserError } from './exportErrors.js';

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

// The snapshot rendering of one answers[] entry — what was actually recorded at the door
// (the voters-by-answer.csv answerText contract, honest across option renames).
const snapshotAnswerText = (a) => {
  const base = Array.isArray(a.answer) ? a.answer.join('; ') : a.answer ?? '';
  const embedded = Array.isArray(a.answer) ? a.answer.includes(a.otherText) : a.answer === a.otherText;
  return a.otherText && !embedded ? `${base} — ${a.otherText}` : base;
};

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

// ---------------------------------------------------------------------------------------
// canvass-activity — one row per CanvassActivity (door-unit ledger)

export const buildCanvassActivity = async (ctx, sink) => {
  const { params, anchorTz } = ctx;
  const fmts = instantFmts(anchorTz);
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

  const [{ passById, effortNameById }, userIds, coordIds, total] = await Promise.all([
    loadPassEffortMaps(ctx),
    CanvassActivity.distinct('userId', q),
    CanvassActivity.distinct('coordinatorId', q),
    CanvassActivity.countDocuments(q),
  ]);
  const people = await hydrateCanvassers(
    [...userIds, ...coordIds].filter(Boolean).map(String),
    ctx.organizationId,
  );
  ctx.setTotalEstimate(total);

  const writer = await sink.file('activity-log', [
    'Timestamp (ISO)', 'Date', `Time (${fmts.tzLabel})`, 'Action',
    'Address', 'Address line 2', 'City', 'State', 'Zip', 'County',
    'Voter ID', 'Voter first name', 'Voter last name', 'Party',
    'Canvasser first name', 'Canvasser last name', 'Canvasser status', 'Team',
    'Walk list', 'Pass', 'Pass name', 'Via', 'Offline submission',
    'Latitude', 'Longitude', 'GPS accuracy (m)', 'Distance from house (m)',
    'Replaces earlier action', 'Replaced at (ISO)', 'Note',
    'Household DB id', 'Voter DB id', 'Activity DB id',
  ]);

  const cursor = CanvassActivity.find(q).sort({ timestamp: 1 }).lean().cursor({ batchSize: BATCH });
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const hhIds = [...new Set(batch.map((a) => String(a.householdId)))];
    const vIds = [...new Set(batch.map((a) => a.voterId && String(a.voterId)).filter(Boolean))];
    const [homes, voters] = await Promise.all([
      Household.find({ _id: { $in: hhIds } }, 'addressLine1 addressLine2 city state zipCode county').lean(),
      vIds.length ? Voter.find({ _id: { $in: vIds } }, 'stateVoterId firstName lastName party').lean() : [],
    ]);
    const homeById = new Map(homes.map((h) => [String(h._id), h]));
    const voterById = new Map(voters.map((v) => [String(v._id), v]));
    for (const a of batch) {
      const h = homeById.get(String(a.householdId));
      const vid = a.voterId ? String(a.voterId) : null;
      // Door-unit DNC rule: the knock is a record of work performed (and billed), so the
      // ROW stays; the PERSON does not appear. Blank identity, no marker (a marker would
      // itself flag the household as containing an opt-out).
      const dncHit = vid && ctx.dnc.has(vid);
      if (dncHit) ctx.countDnc(1);
      const v = !dncHit && vid ? voterById.get(vid) : null;
      if (v) ctx.subjects.add(vid);
      const p = a.passId ? passById.get(String(a.passId)) : null;
      const canv = people.get(String(a.userId)) || null;
      const team = a.coordinatorId ? people.get(String(a.coordinatorId)) : null;
      await writer.writeRow([
        ...instantCells(a.timestamp, fmts), a.actionType,
        h?.addressLine1 || '', h?.addressLine2 || '', h?.city || '', h?.state || '', h?.zipCode || '', h?.county || '',
        v?.stateVoterId || '', v?.firstName || '', v?.lastName || '', v?.party || '',
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
        a.note || '',
        String(a.householdId), dncHit ? '' : vid || '', String(a._id),
      ]);
    }
    ctx.progress(writer.rowsWritten);
    batch = [];
  };
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return { files: [{ name: 'activity-log', rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// doors-by-round — one row per (household × pass), LONG shape. Reconciliation contract:
// rows with `Round status` ∉ {unknocked, restricted} for a pass === that pass's `knocks`
// in knocks-by-pass (both are distinct (household, pass) over KNOCK_ACTIONS).

export const buildDoorsByRound = async (ctx, sink) => {
  const { params, anchorTz } = ctx;
  const fmts = instantFmts(anchorTz);
  const campaignType = ctx.campaign?.type || 'survey';

  const passQ = { organizationId: ctx.organizationId, campaignId: ctx.campaignId };
  if (params.effortId) passQ.effortId = oid(params.effortId);
  if (params.passId && params.passId !== 'legacy') passQ._id = oid(params.passId);
  const [{ effortNameById }, passes, turfs] = await Promise.all([
    loadPassEffortMaps(ctx),
    Pass.find(passQ, 'roundNumber name status effortId').lean(),
    Turf.find({ campaignId: ctx.campaignId }, 'name').lean(),
  ]);
  const turfNameById = new Map(turfs.map((t) => [String(t._id), t.name]));
  passes.sort(
    (a, b) =>
      (effortNameById.get(String(a.effortId)) || '￿').localeCompare(effortNameById.get(String(b.effortId)) || '￿') ||
      a.roundNumber - b.roundNumber
  );
  const statusFilter = params.roundStatuses?.length ? new Set(params.roundStatuses) : null;

  const writer = await sink.file('doors-by-round', [
    'Walk list', 'Pass', 'Pass name', 'Pass status', 'Book',
    'Address', 'Address line 2', 'City', 'State', 'Zip', 'County', 'Precinct',
    'Round status', 'Door visits this round',
    'Last action at (ISO)', 'Date', `Time (${fmts.tzLabel})`,
    'Last action by first name', 'Last action by last name', 'Last action by status',
    'Campaign status', 'Active door', 'Household DB id',
  ]);

  const HH_PROJ = 'addressLine1 addressLine2 city state zipCode county precinctValue status isActive';

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

  for (const pass of passes) {
    // Universe = doors the effort owns now ∪ doors the ledger touched this round (catches
    // doors deactivated or re-homed after being worked — they emit with Active door: no).
    const [owned, touched] = await Promise.all([
      Household.find({ campaignId: ctx.campaignId, effortId: pass.effortId, isActive: true }, HH_PROJ).lean(),
      CanvassActivity.distinct('householdId', { campaignId: ctx.campaignId, passId: pass._id }),
    ]);
    const homeById = new Map(owned.map((h) => [String(h._id), h]));
    const extraIds = touched.map(String).filter((id) => !homeById.has(id));
    if (extraIds.length) {
      const extras = await Household.find({ _id: { $in: extraIds } }, HH_PROJ).lean();
      for (const h of extras) homeById.set(String(h._id), h);
    }
    const universeIds = [...homeById.keys()];
    const statusMap = new Map();
    for (const ids of chunk(universeIds, 2000)) {
      const m = await getPassStatusMap(pass._id, ids, campaignType);
      for (const [k, v] of m) statusMap.set(k, v);
    }
    const visits = await visitAgg(pass._id);
    const visitsById = new Map(visits.map((v) => [String(v._id), v]));
    const people = await hydrateCanvassers(
      visits.map((v) => v.lastUserId && String(v.lastUserId)).filter(Boolean),
      ctx.organizationId,
    );
    await emitRound({ pass, universeIds, homeById, statusMap, visitsById, people });
  }

  // Legacy pre-turf bucket: doors with null-pass activity only, one pseudo-round for the
  // campaign (legacy rows predate efforts, so there is no per-effort axis to put them on).
  if (!params.passId || params.passId === 'legacy') {
    const touched = await CanvassActivity.distinct('householdId', { campaignId: ctx.campaignId, passId: null });
    if (touched.length) {
      const ids = touched.map(String);
      const homes = await Household.find({ _id: { $in: ids } }, HH_PROJ).lean();
      const homeById = new Map(homes.map((h) => [String(h._id), h]));
      const statusMap = await legacyStatusMap(ids);
      const visits = await visitAgg(null);
      const visitsById = new Map(visits.map((v) => [String(v._id), v]));
      const people = await hydrateCanvassers(
        visits.map((v) => v.lastUserId && String(v.lastUserId)).filter(Boolean),
        ctx.organizationId,
      );
      await emitRound({ pass: null, universeIds: ids, homeById, statusMap, visitsById, people });
    }
  }

  return { files: [{ name: 'doors-by-round', rows: writer.rowsWritten }] };
};

// ---------------------------------------------------------------------------------------
// survey-results (wide) — one row per SurveyResponse ("Surveys taken"), one FILE per
// template. Answers render id-native against CURRENT option text (the reporting
// aggregations' stable-id contract) with the recorded snapshot as fallback; the LONG
// export below is the never-rewritten snapshot record for disputes.

const surveyBaseQuery = (ctx) => {
  const q = { organizationId: ctx.organizationId, campaignId: ctx.campaignId };
  const range = dayRangeOf(ctx.params, ctx.anchorTz);
  if (range) q.submittedAt = range;
  if (ctx.params.effortId) q.effortId = oid(ctx.params.effortId);
  if (ctx.params.passId === 'legacy') q.passId = null;
  else if (ctx.params.passId) q.passId = oid(ctx.params.passId);
  if (ctx.params.userId) q.userId = oid(ctx.params.userId);
  return q;
};

export const buildSurveyResultsWide = async (ctx, sink) => {
  const q = surveyBaseQuery(ctx);
  if (ctx.params.surveyTemplateId) q.surveyTemplateId = oid(ctx.params.surveyTemplateId);
  const templateIds = (await SurveyResponse.distinct('surveyTemplateId', q)).filter(Boolean);
  if (!templateIds.length) {
    await sink.file('survey-results', ['Submitted (ISO)']);
    return { files: [{ name: 'survey-results', rows: 0 }] };
  }
  let processedSoFar = 0;
  const fmts = instantFmts(ctx.anchorTz);
  const { passById, effortNameById } = await loadPassEffortMaps(ctx);
  const [userIds, coordIds, total] = await Promise.all([
    SurveyResponse.distinct('userId', q),
    SurveyResponse.distinct('coordinatorId', q),
    SurveyResponse.countDocuments(q),
  ]);
  const people = await hydrateCanvassers([...userIds, ...coordIds].filter(Boolean).map(String), ctx.organizationId);
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
    const questions = (template?.questions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const known = new Set(questions.map((x) => x.key));
    const orphans = orphanAgg.filter((o) => o._id && !known.has(o._id)).map((o) => ({ key: o._id, label: o.label || o._id }));
    const labelCounts = new Map();
    for (const x of [...questions, ...orphans]) labelCounts.set(x.label, (labelCounts.get(x.label) || 0) + 1);
    const columnOf = (x) => ((labelCounts.get(x.label) || 0) > 1 ? `${x.label} (${x.key})` : x.label);
    const optionTextById = new Map();
    for (const question of questions) {
      for (const opt of question.options || []) optionTextById.set(`${question.key}:${opt.id}`, opt.text);
    }
    const cols = [...questions, ...orphans];

    // Id-native with snapshot fallback: stable option ids survive renames, so current
    // option text is the honest "what this answer means today"; entries with no
    // resolvable ids (legacy rows, deleted options) fall back to the recorded snapshot,
    // which already embeds otherText.
    const renderAnswer = (qk, answers) => {
      const entries = (answers || []).filter((a) => a.questionKey === qk);
      if (!entries.length) return '';
      return entries
        .map((a) => {
          const texts = (a.optionIds || []).map((id) => optionTextById.get(`${qk}:${id}`)).filter(Boolean);
          if (!texts.length) return snapshotAnswerText(a);
          const base = texts.join('; ');
          return a.otherText ? `${base} — ${a.otherText}` : base;
        })
        .join(' | ');
    };

    const slug = (template?.name || 'survey').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40).toLowerCase();
    const name = templateIds.length > 1 ? `survey-${slug}` : 'survey-results';
    const writer = await sink.file(name, [
      'Submitted (ISO)', 'Date', `Time (${fmts.tzLabel})`,
      'Walk list', 'Pass', 'Pass name',
      'Voter ID', 'Voter first name', 'Voter last name', 'Party',
      'Address', 'Address line 2', 'City', 'State', 'Zip',
      'Canvasser first name', 'Canvasser last name', 'Canvasser status', 'Team',
      'Template', 'Template version', 'Offline submission', 'Edited', 'Note',
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
        Voter.find({ _id: { $in: vIds } }, 'stateVoterId firstName lastName party').lean(),
        Household.find({ _id: { $in: hhIds } }, 'addressLine1 addressLine2 city state zipCode').lean(),
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
          v.stateVoterId || '', v.firstName || '', v.lastName || '', v.party || '',
          h?.addressLine1 || '', h?.addressLine2 || '', h?.city || '', h?.state || '', h?.zipCode || '',
          ...canvasserCells(canv),
          team ? `${team.firstName} ${team.lastName}`.trim() : '',
          template?.name || '', r.surveyTemplateVersion ?? '',
          r.wasOfflineSubmission ? 'yes' : 'no',
          r.editedAt ? 'yes' : '',
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
  if (ctx.params.surveyTemplateId) q.surveyTemplateId = oid(ctx.params.surveyTemplateId);
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
    'Voter ID', 'Voter first name', 'Voter last name', 'Party',
    'Address', 'Address line 2', 'City', 'State', 'Zip',
    'Canvasser first name', 'Canvasser last name', 'Canvasser status',
    'Walk list', 'Pass', 'Pass name', 'Template', 'Template version',
    'Question', 'Question key', 'Answer', 'Option ids', 'Other text',
    'Note', 'Offline submission',
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
      Voter.find({ _id: { $in: vIds } }, 'stateVoterId firstName lastName party').lean(),
      Household.find({ _id: { $in: hhIds } }, 'addressLine1 addressLine2 city state zipCode').lean(),
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
        ctx.countOrphaned(1);
        continue;
      }
      ctx.subjects.add(vid);
      const h = homeById.get(String(r.householdId));
      const p = r.passId ? passById.get(String(r.passId)) : null;
      const canv = people.get(String(r.userId));
      const shared = [
        ...instantCells(r.submittedAt, fmts),
        v.stateVoterId || '', v.firstName || '', v.lastName || '', v.party || '',
        h?.addressLine1 || '', h?.addressLine2 || '', h?.city || '', h?.state || '', h?.zipCode || '',
        ...canvasserCells(canv),
        p ? effortNameById.get(String(p.effortId)) || '' : '',
        p ? p.roundNumber : '', p ? p.name : passLabel(p),
        templateNameById.get(String(r.surveyTemplateId)) || '', r.surveyTemplateVersion ?? '',
      ];
      const tail = [r.note || '', r.wasOfflineSubmission ? 'yes' : 'no', String(r.householdId), vid, String(r._id)];
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

export const buildVoterNotes = async (ctx, sink) => {
  const fmts = instantFmts(ctx.anchorTz);
  const q = { organizationId: ctx.organizationId };
  const range = dayRangeOf(ctx.params, ctx.anchorTz);
  if (range) q.createdAt = range;
  const authorIds = await VoterNote.distinct('authorId', q);
  const people = await hydrateCanvassers(authorIds.filter(Boolean).map(String), ctx.organizationId);
  ctx.setTotalEstimate(await VoterNote.countDocuments(q));

  const writer = await sink.file('voter-notes', [
    'Created (ISO)', 'Date', `Time (${fmts.tzLabel})`,
    'Voter ID', 'Voter first name', 'Voter last name',
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
      'stateVoterId firstName lastName householdId'
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
        v.stateVoterId || '', v.firstName || '', v.lastName || '',
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
  const writer = await sink.file('knocks-by-round', [
    'Walk list', 'Pass', 'Pass name', 'Pass status', 'Activated (ISO)', 'Archived (ISO)',
    'Knocks', 'Survey doors', 'Lit knocks', 'Refused',
    ...doorCols, 'Connection rate %', 'Contact rate %', 'New homes reached',
  ]);
  for (const r of built.rounds) {
    await writer.writeRow([
      r.effortName || '', r.roundNumber ?? '', r.roundName ?? r.roundLabel, r.status || '',
      r.activatedAt ? new Date(r.activatedAt).toISOString() : '',
      r.archivedAt ? new Date(r.archivedAt).toISOString() : '',
      r.knocks, r.surveyedKnocks, r.litKnocks, r.refusedKnocks,
      ...doorVals(r), r.connectionRate, r.contactRate, r.coverageGained,
    ]);
  }
  const t = built.totals;
  await writer.writeRow([
    'TOTAL', '', '', '', '', '',
    t.knocks, t.surveyedKnocks, t.litKnocks, t.refusedKnocks,
    ...doorVals(t), t.connectionRate, t.contactRate, t.coverageGained,
  ]);
  return { files: [{ name: 'knocks-by-round', rows: writer.rowsWritten }] };
};
