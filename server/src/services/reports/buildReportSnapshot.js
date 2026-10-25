import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Household } from '../../models/Household.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ClientReportAreaCell } from '../../models/ClientReportAreaCell.js';
import { resolveStatus, STATUS_ROW_MATCH } from '../../utils/statusPrecedence.js';
import {
  KNOCK_ACTIONS,
  CONTACT_ACTIONS,
  NOT_BULK,
  crewsMatch,
  withTeam,
  connectionRate,
  contactRate,
} from './aggregations.js';
import { computeSurveyBreakdowns, computeTagBreakdowns, publicPointAnswer } from './computeReport.js';
import { createCellBin, applyAreaRule, cellsExtent, growExtent } from './areaCells.js';
import { depsMap } from './reportVisibility.js';
import { deadlineFor, goalPercent } from './goalProgress.js';

// ONE build of a client report's numbers and map — the snapshot (docs/PROPOSAL_CLIENT_REPORTS_
// UPGRADE.md §F2 "The build"). It replaces computeBothWindows + buildFrozenMapPoints, which loaded
// every in-scope household, knock and survey into memory inside one web request. Today's
// computeWindowStats and buildFrozenMapPoints (computeReport.js) stay as the TEST ORACLES this is
// pinned against (clientReportBuild.int.test.js), option by option id.
//
// The shape of it:
//   · Walk the households that have any activity before the period's end — one aggregation cursor
//     over CanvassActivity, grouped and sorted by householdId — in batches of CLIENT_REPORT_BATCH.
//     A build's memory is one batch, whatever the campaign's size.
//   · Per batch, a few indexed finds: the scope's knock rows, the map's status rows, the
//     households, the latest map answers. Scope clauses run IN MONGO (teamMatch, withTeam,
//     NOT_BULK, STATUS_ROW_MATCH), never re-implemented here.
//   · Door numbers come from ONE fold: scope rows grouped into (household, round) groups keyed on
//     String(passId) — so a missing and a null round stay apart, exactly as $group keeps them — and
//     every window (cumulative, period, and the earlier report's cut-off) counted from the same
//     groups. That is what makes the breakdown add up to Doors knocked by construction; chunked
//     reads with separate queries per number did not (round 1, reproduced).
//   · Survey numbers stay server-side aggregations, with the same fence and scope.
//   · Every read carries the FENCE: createdAt not after fenceAt (the $not form keeps rows with no
//     createdAt). Knocks the phones send mid-build land after it and are counted as arrivals.

const FENCE = (fenceAt) => (fenceAt ? { createdAt: { $not: { $gt: fenceAt } } } : {});

// The team clause (§F4): for every coordinator the build covers — current and past — her crew's
// stamped rows plus her own unstamped ones (crewsMatch, aggregations.js). Cast there, which this
// needs: the clause also goes into aggregation $matches, which Mongoose never casts.
export const teamClauseFor = (coordinatorIds) => crewsMatch(coordinatorIds);

/** The ledger scope of a report: org + campaign, its walk list, and its team (merged via $and). */
const ledgerScope = ({ organizationId, campaignId, effortId, team }) => {
  const base = { organizationId, campaignId, ...(effortId ? { effortId } : {}) };
  return team ? withTeam(base, team) : base;
};

const emptyEvents = () => ({
  not_home: 0, wrong_address: 0, refused: 0, surveyed: 0, lit_dropped: 0, no_soliciting: 0, not_target: 0,
});
const emptyAcc = () => ({
  knocks: 0, surveyedKnocks: 0, litKnocks: 0, refusedKnocks: 0, notTargetKnocks: 0, contactKnocks: 0, homes: 0,
  events: emptyEvents(),
});

// Frozen door-goal progress AS OF the report's window. Progress only — the model stores no pace or
// verdict (see ClientReport.goalSnapshot). `done` is the report's OWN cumulative doors, so the bar
// counts exactly what the card above it counts. A walk-list or team report never gets one: a
// campaign-wide target measured against part of the campaign understates progress badly.
export const goalSnapshotFor = ({ campaign, doorsKnocked, rangeEndUtc, scoped }) => {
  const target = Number(campaign?.doorGoal) > 0 ? campaign.doorGoal : null;
  if (!target || scoped) {
    return { target: null, deadline: null, done: null, remaining: null, percent: null, asOf: null };
  }
  const done = doorsKnocked || 0;
  const { deadline } = deadlineFor(campaign);
  return { target, deadline, done, remaining: Math.max(0, target - done), percent: goalPercent(done, target), asOf: rangeEndUtc };
};

// A breakdown's options in a stable order: count descending, then the survey's own order, the
// folded 'Other' (no id) last.
const sortBreakdownOptions = (breakdowns, template) => {
  const orderByQ = new Map(
    (template?.questions || []).map((q) => [q.key, new Map((q.options || []).map((o, i) => [o.id, i]))])
  );
  for (const b of breakdowns) {
    const order = orderByQ.get(b.questionKey) || new Map();
    const rank = (o) => (o.id != null && order.has(o.id) ? order.get(o.id) : Number.MAX_SAFE_INTEGER);
    b.options = [...(b.options || [])].sort((x, y) => y.count - x.count || rank(x) - rank(y));
  }
  return breakdowns;
};

/** Survey numbers for one window — aggregations with the fence and the scope (§F2). */
const surveyNumbers = async ({ match, template, full = true }) => {
  const [surveysTaken, voters] = await Promise.all([
    SurveyResponse.countDocuments(match),
    // Voters surveyed: distinct non-null voters. $group + $count, not distinct(): a null voterId is
    // never a voter, and distinct() returns one document capped at 16 MB.
    SurveyResponse.aggregate([
      { $match: { ...match, voterId: { $ne: null } } },
      { $group: { _id: '$voterId' } },
      { $count: 'n' },
    ]).allowDiskUse(true),
  ]);
  const out = { surveysTaken, surveyedVoters: voters[0]?.n || 0 };
  if (!full) return out;
  const [surveyBreakdowns, tagBreakdowns, deskEnteredResponses, editedResponses] = await Promise.all([
    computeSurveyBreakdowns({ surveyScopeMatch: match, template, supportQuestionKey: null }),
    computeTagBreakdowns({ surveyScopeMatch: match, template }),
    // INTERNAL-ONLY (the builder's notes; shapeWindow never ships it): responses an admin entered at
    // a desk, and responses edited after they were recorded. Same posture as computeWindowStats.
    SurveyResponse.countDocuments({ ...match, deskEntry: { $exists: true } }),
    SurveyResponse.countDocuments({ ...match, editedAt: { $ne: null } }),
  ]);
  return {
    ...out,
    surveyBreakdowns: sortBreakdownOptions(surveyBreakdowns, template),
    tagBreakdowns,
    provenance: { deskEnteredResponses, editedResponses, totalResponses: surveysTaken },
  };
};

const totalsOf = (acc, survey) => ({
  doorsKnocked: acc.knocks, // billable knocks (distinct household+round) — the headline number
  homesKnocked: acc.homes, // distinct households touched
  surveysTaken: survey.surveysTaken,
  surveyedVoters: survey.surveyedVoters,
  surveyedKnocks: acc.surveyedKnocks,
  litKnocks: acc.litKnocks,
  refusedKnocks: acc.refusedKnocks,
  notTargetKnocks: acc.notTargetKnocks,
  connectionRate: connectionRate(acc),
  contactRate: contactRate(acc),
});

/**
 * Check §F2 step 8's invariants. They hold by construction (one fold); a failure is a bug, fails the
 * build loudly and never commits.
 */
export const assertInvariants = (stats) => {
  for (const name of ['cumulative', 'period']) {
    const w = stats[name];
    const sum = Object.values(w.contactBreakdown || {}).reduce((s, n) => s + n, 0);
    if (sum !== w.totals.doorsKnocked) {
      throw Object.assign(new Error(`${name}: the contact breakdown (${sum}) does not add up to doors knocked (${w.totals.doorsKnocked})`), {
        code: 'INVARIANT',
      });
    }
  }
  if (stats.period.totals.doorsKnocked > stats.cumulative.totals.doorsKnocked) {
    throw Object.assign(new Error('period doors exceed cumulative doors'), { code: 'INVARIANT' });
  }
};

/**
 * Build one snapshot. Writes its map rows (pins per batch, cells once at the end) under
 * `snapshotId`; returns the numbers for the caller to commit.
 *
 *   report  — lean: organizationId, campaignId, effortId, rangeStartUtc, rangeEndUtc, _id
 *   inputs  — the build's target (build.inputs): { showMap, mapMode, areaSize, mapKeys,
 *             questionDeps, coordinatorIds }; coordinatorIds non-empty ⇔ a team report
 *   team    — true on a team report (its coordinators may all be gone, so not inferred from ids)
 *   compared — { reportId, end, cut, snapshotId } of the earlier report whose cards this build
 *             recomputes (its period's end, its numbers' cut-off, its live snapshot), or null
 *   beforeBatch — awaited before every batch (deletion check, cancel flag); onBatch({ done, total })
 *             after, `total` being the households the walk visits
 */
export const buildReportSnapshot = async ({
  report,
  campaign,
  template = null,
  inputs,
  team = false,
  snapshotId,
  fenceAt,
  compared = null,
  batchSize = Number(process.env.CLIENT_REPORT_BATCH) || 2000,
  beforeBatch = async () => {},
  onBatch = async () => {},
}) => {
  const organizationId = report.organizationId;
  const campaignId = report.campaignId;
  const effortId = report.effortId || null;
  const campaignType = campaign?.type || report.campaignType || null;
  const rangeStart = new Date(report.rangeStartUtc);
  const rangeEnd = new Date(report.rangeEndUtc);
  const teamClause = team ? teamClauseFor(inputs.coordinatorIds) : null;
  const fence = FENCE(fenceAt);

  const windows = [
    { name: 'cumulative', from: null, to: rangeEnd, acc: emptyAcc() },
    { name: 'period', from: rangeStart, to: rangeEnd, acc: emptyAcc() },
  ];
  const earlierEnd = compared?.end ? new Date(compared.end) : null;
  // The earlier report froze what it had RECEIVED by its cut-off (its fence), timed before its
  // period's end. So the recount takes every such row still on record, plus rows timed before the
  // cut-off that arrived after it (late syncs, the corrections the line is for) — never a row timed
  // and received after the cut-off, which is only the rest of a period whose numbers stopped early.
  // Counting "timed before the cut-off" read a phone clock a few minutes fast as a door taken away
  // (NUM-3). A cut-off at or after the period's end changes nothing: every row is timed before it.
  const earlierCut = earlierEnd && compared.cut ? new Date(compared.cut) : null;
  if (earlierEnd) windows.push({ name: 'earlier', from: null, to: earlierEnd, cut: earlierCut, acc: emptyAcc() });
  const inWindow = (w, a) => {
    const ms = new Date(a.timestamp).getTime();
    if ((w.from && ms < w.from.getTime()) || ms >= w.to.getTime()) return false;
    // A row with no createdAt reads as received in time, as the fence reads it.
    return !(w.cut && ms >= w.cut.getTime() && a.createdAt && new Date(a.createdAt).getTime() > w.cut.getTime());
  };

  // Survey numbers run beside the walk — aggregations, so their memory is the server's.
  const surveyScope = { ...ledgerScope({ organizationId, campaignId, effortId, team: teamClause }), ...fence };
  // The earlier report's surveys, recounted the same way on submittedAt (NUM-3).
  const earlierSurveys = earlierEnd
    ? {
        ...surveyScope,
        submittedAt: { $lt: earlierEnd },
        ...(earlierCut && earlierCut < earlierEnd
          ? { $and: [...(surveyScope.$and || []), { $or: [{ createdAt: { $not: { $gt: earlierCut } } }, { submittedAt: { $lt: earlierCut } }] }] }
          : {}),
      }
    : null;
  const surveysPromise = Promise.all([
    surveyNumbers({ match: { ...surveyScope, submittedAt: { $lt: rangeEnd } }, template }),
    surveyNumbers({ match: { ...surveyScope, submittedAt: { $gte: rangeStart, $lt: rangeEnd } }, template }),
    earlierSurveys ? surveyNumbers({ match: earlierSurveys, template, full: false }) : null,
  ]);
  // A rejection here must never go unobserved while the walk runs; it is re-thrown below.
  surveysPromise.catch(() => {});

  // ── The map: what it carries and how ──────────────────────────────────────────────────────────
  const showMap = !!inputs.showMap;
  const area = showMap && inputs.mapMode === 'area';
  const mapKeys = showMap ? [...new Set(inputs.mapKeys || [])] : [];
  const mapKeySet = new Set(mapKeys);
  const questionByKey = new Map((template?.questions || []).map((q) => [q.key, q]));
  const singleChoiceKeys = mapKeys.filter((k) => questionByKey.get(k)?.type === 'single_choice');
  const bin = area ? createCellBin({ areaSize: inputs.areaSize, singleChoiceKeys }) : null;
  let seq = 0;
  let extent = null;

  // Scope rows (§F2 build, step 1): the knocks this report counts.
  const knockMatch = (hhIds) => ({
    ...ledgerScope({ organizationId, campaignId, effortId, team: teamClause }),
    ...(team ? NOT_BULK : {}),
    householdId: { $in: hhIds },
    actionType: { $in: KNOCK_ACTIONS },
    timestamp: { $lt: rangeEnd },
    ...fence,
  });
  // Status rows (step 2): a door's status as of the period's end. Whole campaign and walk list:
  // every status row of the door, campaign-wide, as today (a door's as-of status reflects knocks
  // stamped before it joined the walk list). Team: the team's OWN rows (its latest result, never the
  // other team's) plus every restricted row on the door, desk marks included.
  const statusMatch = (hhIds) => {
    const base = { organizationId, campaignId, householdId: { $in: hhIds }, timestamp: { $lt: rangeEnd }, ...fence };
    if (!team) return { ...base, ...STATUS_ROW_MATCH };
    return {
      ...base,
      $or: [{ $and: [teamClause], ...NOT_BULK, ...STATUS_ROW_MATCH }, { actionType: 'restricted' }],
    };
  };

  // The latest response per household carrying a map answer (step 4): ascending submittedAt with
  // the _id-descending tie-break today's freeze effectively had (verified in round 2), so the LAST
  // write per household wins. Only the report's own survey (§O6): a duplicated or swapped survey
  // can't bring old answers onto the map. Team reports: the team's own answers.
  const latestMapAnswers = async (hhIds) => {
    const out = new Map();
    if (!mapKeys.length || !template || !hhIds.length) return out;
    const rows = await SurveyResponse.find(
      {
        ...ledgerScope({ organizationId, campaignId, team: teamClause }),
        householdId: { $in: hhIds },
        surveyTemplateId: template._id,
        submittedAt: { $lt: rangeEnd },
        ...fence,
      },
      { householdId: 1, submittedAt: 1, answers: 1 }
    )
      .sort({ submittedAt: 1, _id: -1 })
      .lean();
    for (const r of rows) {
      // Every answer passes through publicPointAnswer: canonical choice values only, never typed text.
      const picked = (r.answers || [])
        .filter((a) => mapKeySet.has(a.questionKey))
        .map((a) => ({ questionKey: a.questionKey, answer: publicPointAnswer(questionByKey.get(a.questionKey), a) }))
        .filter((a) => a.answer != null);
      if (picked.length) out.set(String(r.householdId), picked);
    }
    return out;
  };

  let done = 0;
  const runBatch = async (hhIds) => {
    await beforeBatch();
    const [scopeRows, statusRows, households] = await Promise.all([
      CanvassActivity.find(knockMatch(hhIds), { householdId: 1, passId: 1, actionType: 1, timestamp: 1, createdAt: 1 })
        .sort({ timestamp: 1, _id: 1 })
        .lean(),
      showMap
        ? CanvassActivity.find(statusMatch(hhIds), { householdId: 1, actionType: 1, timestamp: 1 })
            .sort({ timestamp: 1, _id: 1 })
            .lean()
        : [],
      showMap
        ? Household.find(
            {
              _id: { $in: hhIds },
              organizationId,
              campaignId,
              isActive: true,
              'location.coordinates': { $exists: true, $ne: null },
              // Walk-list scope narrows the map's HOUSEHOLD set (Household.effortId is ownership's
              // source of truth), as today.
              ...(effortId ? { effortId } : {}),
            },
            { addressLine1: 1, city: 1, state: 1, location: 1 }
          ).lean()
        : [],
    ]);

    // The fold: one group per (household, round), every window counted from the same groups.
    const groups = new Map();
    for (const r of scopeRows) {
      const key = `${r.householdId}|${String(r.passId)}`;
      let g = groups.get(key);
      if (!g) {
        g = { hh: String(r.householdId), acts: [] };
        groups.set(key, g);
      }
      g.acts.push(r);
    }
    const knockedHere = new Set();
    const homesByWindow = windows.map(() => new Set());
    for (const g of groups.values()) {
      knockedHere.add(g.hh);
      windows.forEach((w, i) => {
        const acts = g.acts.filter((a) => inWindow(w, a));
        if (!acts.length) return;
        const acc = w.acc;
        acc.knocks += 1;
        let survey = 0, lit = 0, refused = 0, notTarget = 0, contact = 0;
        for (const a of acts) {
          if (a.actionType === 'survey_submitted') survey = 1;
          else if (a.actionType === 'lit_dropped') lit = 1;
          else if (a.actionType === 'refused') refused = 1;
          else if (a.actionType === 'not_target') notTarget = 1;
          if (CONTACT_ACTIONS.includes(a.actionType)) contact = 1;
        }
        acc.surveyedKnocks += survey;
        acc.litKnocks += lit;
        acc.refusedKnocks += refused;
        acc.notTargetKnocks += notTarget;
        acc.contactKnocks += contact;
        // One outcome per (household, round), the resolveStatus the live app uses. Every group has a
        // knock, so it never resolves to unknocked; a status missing from the literal would silently
        // drop doors from the breakdown, which the invariant check then catches.
        const status = resolveStatus(campaignType, acts);
        if (status in acc.events) acc.events[status] += 1;
        homesByWindow[i].add(g.hh);
      });
    }
    // Households are unique to a batch (the walk groups by householdId), so per-batch distinct
    // counts add up.
    windows.forEach((w, i) => {
      w.acc.homes += homesByWindow[i].size;
    });

    if (showMap) {
      const statusByHh = new Map();
      for (const r of statusRows) {
        const k = String(r.householdId);
        if (!statusByHh.has(k)) statusByHh.set(k, []);
        statusByHh.get(k).push(r);
      }
      // The team map shows the doors the team knocked; the others, every in-scope door reached.
      const mapHouseholds = households
        .filter((h) => !team || knockedHere.has(String(h._id)))
        .sort((a, b) => String(a._id).localeCompare(String(b._id)));
      const answersByHh = await latestMapAnswers(mapHouseholds.map((h) => h._id));
      const points = [];
      for (const h of mapHouseholds) {
        const coords = h.location?.coordinates || [];
        if (coords.length < 2) continue;
        const status = resolveStatus(campaignType, statusByHh.get(String(h._id)) || []);
        // The client map shows only doors we actually reached.
        if (status === 'unknocked') continue;
        const point = {
          clientReportId: report._id,
          organizationId,
          campaignId,
          householdId: h._id,
          snapshotId,
          lng: coords[0],
          lat: coords[1],
          addressLine1: h.addressLine1 || '',
          city: h.city || '',
          state: h.state || '',
          status,
          answers: answersByHh.get(String(h._id)) || [],
        };
        if (area) {
          bin.add(point);
        } else {
          point.seq = seq;
          seq += 1;
          extent = growExtent(extent, point.lng, point.lat);
          points.push(point);
        }
      }
      if (points.length) await ClientReportMapPoint.insertMany(points, { ordered: false });
    }

    done += hhIds.length;
    await onBatch({ done, total });
  };

  // The progress bar's denominator: the households this walk visits, counted with the walk's own
  // filter before it starts — not every household of the campaign, whose unknocked doors the walk
  // never reaches, so the bar used to stop at the share of doors knocked (STATE-4).
  const walkMatch = { organizationId, campaignId, timestamp: { $lt: rangeEnd }, ...fence };
  const [walkCount] = await CanvassActivity.aggregate([
    { $match: walkMatch },
    { $group: { _id: '$householdId' } },
    { $match: { _id: { $ne: null } } },
    { $count: 'n' },
  ]).allowDiskUse(true);
  const total = walkCount?.n || 0;

  const walk = CanvassActivity.aggregate([
    { $match: walkMatch },
    { $group: { _id: '$householdId' } },
    { $sort: { _id: 1 } },
  ])
    .allowDiskUse(true)
    .cursor({ batchSize });
  let batch = [];
  for await (const row of walk) {
    if (row._id == null) continue;
    batch.push(row._id);
    if (batch.length >= batchSize) {
      await runBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await runBatch(batch);

  const [cumSurvey, periodSurvey, earlierSurvey] = await surveysPromise;
  const [cum, period, earlier] = windows;
  const stats = {
    cumulative: {
      totals: totalsOf(cum.acc, cumSurvey),
      contactBreakdown: cum.acc.events,
      coverage: {},
      surveyBreakdowns: cumSurvey.surveyBreakdowns,
      tagBreakdowns: cumSurvey.tagBreakdowns,
      provenance: cumSurvey.provenance,
    },
    period: {
      totals: totalsOf(period.acc, periodSurvey),
      contactBreakdown: period.acc.events,
      coverage: {},
      surveyBreakdowns: periodSurvey.surveyBreakdowns,
      tagBreakdowns: periodSurvey.tagBreakdowns,
      provenance: periodSurvey.provenance,
    },
  };
  assertInvariants(stats);

  let areaCellCount = 0;
  let areaQuestions = [];
  if (area) {
    const { cells, shownKeys } = applyAreaRule(bin.rows(), {
      candidateKeys: singleChoiceKeys,
      deps: depsMap(inputs.questionDeps),
    });
    areaQuestions = shownKeys;
    if (cells.length) {
      await ClientReportAreaCell.insertMany(
        cells.map((c) => ({ ...c, organizationId, campaignId, clientReportId: report._id, snapshotId })),
        { ordered: false }
      );
    }
    areaCellCount = cells.length;
    extent = cellsExtent(cells);
  }

  return {
    stats,
    goalSnapshot: goalSnapshotFor({
      campaign,
      doorsKnocked: stats.cumulative.totals.doorsKnocked,
      rangeEndUtc: report.rangeEndUtc,
      scoped: !!effortId || team,
    }),
    mapPointCount: area ? 0 : seq,
    areaCellCount,
    areaQuestions,
    extent,
    comparedReportId: earlierEnd ? compared.reportId : null,
    // Frozen beside the recount: the line is only true while that report still shows these numbers.
    comparedSnapshotId: earlierEnd ? compared.snapshotId ?? null : null,
    earlierTotals: earlierEnd
      ? {
          doorsKnocked: earlier.acc.knocks,
          homesKnocked: earlier.acc.homes,
          litKnocks: earlier.acc.litKnocks,
          surveysTaken: earlierSurvey.surveysTaken,
          surveyedVoters: earlierSurvey.surveyedVoters,
        }
      : null,
  };
};

/**
 * A remap (§F5 Switch to areas): bin the live snapshot's pins into cells under a new snapshot. The
 * numbers don't change. Reads the stored rows, which carry only the answers the live snapshot
 * froze; single-choice comes from the frozen breakdown types.
 */
export const remapSnapshot = async ({ report, inputs, snapshotId, batchSize = 2000, beforeBatch = async () => {} }) => {
  const mapKeys = new Set(inputs.mapKeys || []);
  const singleChoiceKeys = (report.stats?.cumulative?.surveyBreakdowns || [])
    .filter((b) => b.type === 'single_choice' && mapKeys.has(b.questionKey))
    .map((b) => b.questionKey);
  const bin = createCellBin({ areaSize: inputs.areaSize, singleChoiceKeys });
  const cursor = ClientReportMapPoint.find(
    { clientReportId: report._id, snapshotId: report.snapshotId ?? null },
    { lng: 1, lat: 1, status: 1, answers: 1 }
  )
    .lean()
    .cursor({ batchSize });
  let n = 0;
  for await (const p of cursor) {
    if (n % batchSize === 0) await beforeBatch();
    n += 1;
    bin.add({ ...p, answers: (p.answers || []).filter((a) => mapKeys.has(a.questionKey)) });
  }
  const { cells, shownKeys } = applyAreaRule(bin.rows(), {
    candidateKeys: singleChoiceKeys,
    deps: depsMap(inputs.questionDeps),
  });
  if (cells.length) {
    await ClientReportAreaCell.insertMany(
      cells.map((c) => ({
        ...c,
        organizationId: report.organizationId,
        campaignId: report.campaignId,
        clientReportId: report._id,
        snapshotId,
      })),
      { ordered: false }
    );
  }
  return { areaCellCount: cells.length, areaQuestions: shownKeys, extent: cellsExtent(cells) };
};
