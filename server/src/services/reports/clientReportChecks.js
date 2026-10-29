import mongoose from 'mongoose';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportAreaCell } from '../../models/ClientReportAreaCell.js';
import { ClientReportSeries } from '../../models/ClientReportSeries.js';
import { Effort } from '../../models/Effort.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { CoordinatorChange } from '../../models/CoordinatorChange.js';
import { KNOCK_ACTIONS, NOT_BULK, crewsMatch, withTeam } from './aggregations.js';
import { countOpenMockFlags } from './campaignSummaries.js';
import { earlierTotalsLine, comparedReportNow, comparedSnapshotMoved } from './clientReportRead.js';
import { legacyTemplatesFor } from './clientReportMap.js';
import { teamOf } from './clientReportSeries.js';
import { areaAnswerKeys } from './areaCells.js';
import { normalizeTag, tagOptionMap } from '../surveys/tags.js';
import {
  liveInputs,
  visibleKeysFor,
  breakdownKeysOf,
  mapServed,
  servedMapKeys,
  depsMap,
  numbersCutOff,
  scopeOf,
  isTeamScope,
  periodLabelOf,
} from './reportVisibility.js';

// "Before you publish" (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md Part 1, §F4, §F5, §O5): what is
// worth a look before a report goes to the client, computed on the server so the builder only
// renders it. Nothing here blocks a publish — Publish's own refusals are clientReportBuilds.js'.
// Operator-facing only: none of it is ever shaped into the client's payload.

const HOUR_MS = 60 * 60 * 1000;

/** Open mock-GPS flags in THIS report's scope (walk list, team), over its cumulative window. */
export const scopedOpenMockFlags = (report, inputs = liveInputs(report)) =>
  countOpenMockFlags({
    organizationId: report.organizationId,
    campaignId: report.campaignId,
    timestamp: { $lt: report.rangeEndUtc },
    effortId: report.effortId || null,
    coordinatorIds: isTeamScope(scopeOf(report).kind) ? inputs.coordinatorIds || [] : null,
  });

const oid = (v) => new mongoose.Types.ObjectId(String(v));

// Team reports (§F4 "What people are told"): canvassers who knocked for this team in the period, and
// the period's door visits team by team against the base scope — the whole campaign, or this
// report's walk list: each active client-report team's own visits, the visits more than one team made
// (each counts in both teams' reports — owner ruling 10-24), and the visits no team made. One
// aggregation, grouped by door and round with the set of teams that made each visit, counted the way
// the build counts doors: knock actions, the period, this report's numbers' cut-off, team rows never
// entered in bulk. This report's team is its FROZEN crews, so its figure is the report's own period
// doors knocked; every other team is its series' crews now. Each team is tested on its own, never as a
// first match: a crew is in one active team at a time, but a report's frozen crews can still name a
// crew that has since moved to another team. The old figure counted crews and "No team", not teams
// (NUM-2).
const teamPeriodFigures = async (report, inputs) => {
  const base = {
    organizationId: report.organizationId,
    campaignId: report.campaignId,
    ...(report.effortId ? { effortId: report.effortId } : {}),
    actionType: { $in: KNOCK_ACTIONS },
    timestamp: { $gte: report.rangeStartUtc, $lt: report.rangeEndUtc },
  };
  const cut = numbersCutOff(report);
  const series = report.seriesId ? await ClientReportSeries.findById(report.seriesId).lean() : null;
  const own = await teamOf(series);
  const [canvassers, active, effort] = await Promise.all([
    CanvassActivity.distinct('userId', withTeam({ ...base, ...NOT_BULK }, crewsMatch(inputs.coordinatorIds || []))),
    ClientReportSeries.find(
      { organizationId: report.organizationId, campaignId: report.campaignId, kind: 'team', endedAt: null },
      { label: 1, crewKeys: 1 }
    ).lean(),
    report.effortId ? Effort.findById(report.effortId, { name: 1 }).lean() : null,
  ]);
  const teams = [
    {
      seriesId: own ? String(own._id) : report.seriesId ? String(report.seriesId) : null,
      label: own?.label || scopeOf(report).label,
      crews: inputs.coordinatorIds || [],
      isThis: true,
    },
    ...active
      .filter((t) => !own || String(t._id) !== String(own._id))
      .map((t) => ({ seriesId: String(t._id), label: t.label || '', crews: t.crewKeys || [], isThis: false })),
  ];
  // crewsMatch as an expression, per team: a row stamped with one of its crews, or a lead's own
  // unstamped row. Missing reads as null ($ifNull), as the query form's { coordinatorId: null } does.
  const coord = { $ifNull: ['$coordinatorId', null] };
  const madeBy = (crews) => {
    const ids = [...new Set(crews.map(String))].map(oid);
    return { $or: [{ $in: [coord, ids] }, { $and: [{ $eq: [coord, null] }, { $in: ['$userId', ids] }] }] };
  };
  const [row] = await CanvassActivity.aggregate([
    {
      $match: {
        ...base,
        // The build only ever walks a household (a row without one is never a door).
        householdId: { $ne: null },
        // The fence of the live snapshot, as the build reads it.
        ...(cut ? { createdAt: { $not: { $gt: new Date(cut) } } } : {}),
      },
    },
    {
      $project: {
        householdId: 1,
        passId: 1,
        // The teams this row counts for: none when it was entered in bulk.
        t: {
          $cond: [
            { $eq: ['$via', 'bulk'] },
            [],
            { $concatArrays: teams.map((team, i) => ({ $cond: [madeBy(team.crews), [i], []] })) },
          ],
        },
      },
    },
    // One group per door and round — a missing and a null round stay apart, as the build's fold
    // keeps them — with every team that made it.
    { $group: { _id: { h: '$householdId', p: '$passId' }, t: { $push: '$t' } } },
    { $project: { t: { $reduce: { input: '$t', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } } } },
    {
      $group: {
        _id: null,
        scope: { $sum: 1 },
        noTeam: { $sum: { $cond: [{ $eq: [{ $size: '$t' }, 0] }, 1, 0] } },
        multi: { $sum: { $cond: [{ $gte: [{ $size: '$t' }, 2] }, 1, 0] } },
        ...Object.fromEntries(teams.map((team, i) => [`t${i}`, { $sum: { $cond: [{ $in: [i, '$t'] }, 1, 0] } }])),
      },
    },
  ]).allowDiskUse(true);
  const counted = teams.map((team, i) => ({ seriesId: team.seriesId, label: team.label, doorVisits: row?.[`t${i}`] || 0, isThis: team.isThis }));
  const [mine, ...others] = counted;
  const list = [mine, ...others.sort((a, b) => a.label.localeCompare(b.label))];
  return {
    canvassers: canvassers.length,
    multiTeamDoorVisits: row?.multi || 0,
    teams: list,
    teamsTotal: list.reduce((sum, t) => sum + t.doorVisits, 0),
    scopeDoorVisits: row?.scope || 0,
    noTeamDoorVisits: row?.noTeam || 0,
    scopeLabel: report.effortId ? effort?.name || report.effortName || 'this walk list' : 'the whole campaign',
  };
};

// An all-time team report (Latest progress, PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §N) keeps only the one-person
// check — its period is the whole campaign, so the door-visit figures would re-read every visit each time
// the builder opens (6.6 s on a 1M-knock ledger, code review) to compare what its own totals already are.
// The count is the build's (provenance.canvassers, frozen with the numbers); a report built before the
// build counted it reads the same distinct the period figures run. `allTime: true` tells the builder.
const allTimeTeamFigures = async (report, inputs) => {
  const frozen = report.stats?.cumulative?.provenance?.canvassers;
  if (Number.isInteger(frozen)) return { allTime: true, canvassers: frozen };
  const base = {
    organizationId: report.organizationId,
    campaignId: report.campaignId,
    ...(report.effortId ? { effortId: report.effortId } : {}),
    actionType: { $in: KNOCK_ACTIONS },
    timestamp: { $lt: report.rangeEndUtc },
    ...NOT_BULK,
  };
  const users = await CanvassActivity.distinct('userId', withTeam(base, crewsMatch(inputs.coordinatorIds || [])));
  return { allTime: true, canvassers: users.length };
};

// No link check here (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C1, D5): "Before you publish" used to count
// the links that could open the report (`checks.links`), but a draft can never have a link of its own —
// Share makes it once the report is published — so the check went, rather than being re-scoped.

// Why the earlier report's totals moved since it was sent (§F4), chosen by cause, for the builder
// only — the client's line never carries a reason. On a team report: the team's crews themselves
// changed (the earlier report froze a different set than this build covered), or canvassers moved
// into or out of its crews after the earlier report's cut-off (a re-stamp moves their past doors —
// owner ruling: the current coordinator owns all history). Otherwise, the ledgers changed: knocks
// that arrived late, answers edited, doors unknocked.
const EARLIER_REASONS = {
  crews_changed: "the team's crews changed",
  canvassers_changed_teams: 'canvassers changed teams',
  records_changed: 'records changed after it was sent (late knocks, edited or unknocked answers)',
};
const earlierTotalsReason = async ({ report, prev, inputs, team }) => {
  const reason = (code) => ({ code, text: EARLIER_REASONS[code] });
  if (!team) return reason('records_changed');
  const ids = (list) => [...new Set((list || []).map(String))].sort().join(',');
  const theirs = liveInputs(prev).coordinatorIds;
  if (ids(theirs) !== ids(inputs.coordinatorIds)) return reason('crews_changed');
  const crews = [...new Set((inputs.coordinatorIds || []).map(String))];
  const from = numbersCutOff(prev);
  const to = numbersCutOff(report);
  if (crews.length && from) {
    const moved = await CoordinatorChange.exists({
      campaignId: report.campaignId,
      createdAt: { $gt: new Date(from), ...(to ? { $lte: new Date(to) } : {}) },
      // A move whose doors came from several teams names them in `sources`.
      $or: [{ fromCoordinatorId: { $in: crews } }, { toCoordinatorId: { $in: crews } }, { 'sources.coordinatorId': { $in: crews } }],
    });
    if (moved) return reason('canvassers_changed_teams');
  }
  return reason('records_changed');
};

// The earlier-totals note for the builder: the client's line (changes, since) plus, card by card,
// what that report sent and what it reads now, the report it compares with, and why it moved. When
// that report's numbers were refreshed after this build recounted them, the line is hidden from the
// client (comparedSnapshotMoved) and the builder is told which report moved instead, so the operator
// can refresh — or, on a draft, recompute — to compare again (NUM-1). Returns { earlierTotals,
// refreshed: { weekStart, weekEnd } | null }.
const earlierTotalsCheck = async ({ report, inputs, team }) => {
  const prev = await comparedReportNow(report, { snapshotInputs: 1, statsComputedAt: 1, publishedAt: 1 });
  if (!prev || prev.status !== 'published') return { earlierTotals: null, refreshed: null };
  if (comparedSnapshotMoved(report, prev)) {
    return { earlierTotals: null, refreshed: { weekStart: prev.weekStart, weekEnd: prev.weekEnd } };
  }
  const line = await earlierTotalsLine(report, { prev });
  if (!line) return { earlierTotals: null, refreshed: null };
  const sent = prev.stats?.cumulative?.totals || {};
  return {
    earlierTotals: {
      ...line,
      changes: line.changes.map((c) => ({ ...c, sent: sent[c.card] ?? 0, now: report.earlierTotals?.[c.card] ?? 0 })),
      compared: { id: String(prev._id), period: periodLabelOf(prev) },
      reason: await earlierTotalsReason({ report, prev, inputs, team }),
    },
    refreshed: null,
  };
};

// Area reports (§F5, §O5): another shown report that maps the same single-choice question — door by
// door, or by area for another period, team or walk list — or charts it for a narrower scope (a team or
// a walk list), can narrow down what this report's areas keep hidden, for anyone who can open both.
// Named per question, so the operator can decide. Each report has its own link now
// (docs/PROPOSAL_CLIENT_REPORT_LINKS.md), but one person can hold several — and an old link to all your
// reports, until it's turned off, opens every one — so every shown report still counts.
// `inputsOf` reads each report's live inputs — a report from before snapshots with every survey its
// answers can have come from (LEGACY-1).
const areaNarrowing = async ({ report, inputs, inputsOf, labelOf }) => {
  if (inputs.mapMode !== 'area' || !inputs.showMap) return [];
  const served = new Set(servedMapKeys(report, inputs));
  const keys = (report.stats?.cumulative?.surveyBreakdowns || [])
    .filter((b) => b.type === 'single_choice' && served.has(b.questionKey))
    .map((b) => b.questionKey);
  if (!keys.length) return [];
  const others = await ClientReport.find(
    {
      organizationId: report.organizationId,
      campaignId: report.campaignId,
      status: 'published',
      takenDownAt: null,
      _id: { $ne: report._id },
    },
    {
      // status: liveInputs serves the legacy fallback only to a PUBLISHED report without snapshotInputs.
      weekStart: 1, weekEnd: 1, scope: 1, effortId: 1, effortName: 1, visibility: 1, snapshotInputs: 1, status: 1,
      'stats.cumulative.surveyBreakdowns.questionKey': 1,
    }
  )
    .sort({ rangeStartUtc: 1, _id: 1 })
    .lean();
  const out = new Map();
  for (const other of others) {
    const theirs = await inputsOf(other);
    const mapped = new Set(servedMapKeys(other, theirs));
    const charted = new Set(visibleKeysFor(other));
    const scope = scopeOf(other);
    for (const key of keys) {
      let how = null;
      if (mapped.has(key)) how = theirs.mapMode === 'area' ? 'areas' : 'doors';
      else if (scope.kind !== 'campaign' && charted.has(key)) how = 'chart';
      if (!how) continue;
      if (!out.has(key)) out.set(key, { key, label: labelOf.get(key) || key, reports: [] });
      out.get(key).reports.push({ id: String(other._id), period: periodLabelOf(other), scopeLabel: scope.label, how });
    }
  }
  return [...out.values()];
};

// Answers given under an earlier version of a survey, from before Doorline kept a record of its
// follow-up questions (§O6, LEGACY-1): their conditions can't be known, so a map question that was a
// follow-up of a hidden question back then may hint at the hidden answer. Worth a look only when the
// map is served and a chart is hidden. A survey's record runs from `depsEverFromVersion` (the version
// the migration seeded it at); a survey without one knows only its current version's conditions.
// Which surveys: the report's own (the campaign's); for a report from before snapshots — or when the
// campaign has no survey now — every survey its answers can have come from (legacyTemplatesFor).
// Replaces "answers under more than one version", which missed a single old version and was never
// computed for a report without a snapshot (C3).
const conditionsUnknownFor = async ({ report, inputs, visibleSet, surveys }) => {
  if (!mapServed(report, inputs)) return false;
  if (!breakdownKeysOf(report).some((k) => !visibleSet.has(k))) return false;
  const older = surveys
    .filter(Boolean)
    .map((s) => ({ surveyTemplateId: s._id, surveyTemplateVersion: { $lt: s.depsEverFromVersion ?? s.version ?? 1 } }));
  if (!older.length) return false;
  return !!(await SurveyResponse.exists({
    organizationId: report.organizationId,
    campaignId: report.campaignId,
    submittedAt: { $lt: report.rangeEndUtc },
    $or: older,
  }));
};

const hasSnapshotInputs = (report) => !!(report?.snapshotInputs && typeof report.snapshotInputs === 'object');

export const publishChecks = async (report, { template = null, now = new Date() } = {}) => {
  // A report from before snapshots reads its live inputs with the dependencies of every survey its
  // answers can have come from — never the campaign's current survey alone, which may have been
  // swapped since (LEGACY-1). Loaded at most once per call, for it and for the other reports on its
  // link (areaNarrowing).
  let legacy = null;
  const legacyTemplates = () => (legacy ??= legacyTemplatesFor(report));
  const inputsOf = async (r) => (hasSnapshotInputs(r) ? liveInputs(r) : liveInputs(r, { templates: await legacyTemplates() }));
  const inputs = await inputsOf(report);
  const scope = scopeOf(report);
  const team = isTeamScope(scope.kind);
  const cut = numbersCutOff(report);
  const deps = depsMap(inputs.questionDeps);
  const visible = visibleKeysFor(report);
  const visibleSet = new Set(visible);
  const labelOf = new Map((report.stats?.cumulative?.surveyBreakdowns || []).map((b) => [b.questionKey, b.questionLabel]));
  // A question with no chart of its own (a written one never has one) is named from the survey, with
  // its type, so the builder can say "a written answer to …" rather than show an internal key. Type
  // null: a question the survey no longer has.
  const questionOf = new Map((template?.questions || []).map((q) => [q.key, q]));
  const chartTypeOf = new Map((report.stats?.cumulative?.surveyBreakdowns || []).map((b) => [b.questionKey, b.type]));
  const questionWords = (k) => ({
    key: k,
    label: labelOf.get(k) || questionOf.get(k)?.label || k,
    type: chartTypeOf.get(k) || questionOf.get(k)?.type || null,
  });

  // A follow-up chart whose parent is hidden: its total shows how many gave the parent's answer.
  const hiddenParentCharts = visible
    .map((key) => ({ key, hidden: [...(deps.get(key) || [])].filter((d) => !visibleSet.has(d)) }))
    .filter((x) => x.hidden.length)
    .map((x) => ({ key: x.key, label: questionWords(x.key).label, parents: x.hidden.map(questionWords) }));

  // A shown tag carried by an option of a hidden question, or of a follow-up of one (§O5).
  const hiddenTagSources = [];
  if (template && (report.visibility?.visibleTags || []).length) {
    const shownTags = new Set((report.visibility.visibleTags || []).map(normalizeTag));
    for (const [key, entry] of tagOptionMap(template)) {
      if (!shownTags.has(key)) continue;
      const fromHidden = entry.members.filter((m) => !visibleSet.has(m.questionKey) || [...(deps.get(m.questionKey) || [])].some((d) => !visibleSet.has(d)));
      if (fromHidden.length) hiddenTagSources.push({ tag: entry.display, questions: [...new Set(fromHidden.map((m) => m.questionKey))] });
    }
  }

  // Area reports: a single-choice map question that gets no area answers, and why (§O5).
  let areaWithoutAnswers = [];
  if (inputs.mapMode === 'area' && inputs.showMap && report.snapshotId) {
    const served = servedMapKeys(report, inputs);
    const singleChoice = (report.stats?.cumulative?.surveyBreakdowns || [])
      .filter((b) => b.type === 'single_choice' && served.includes(b.questionKey))
      .map((b) => b.questionKey);
    const cells = await ClientReportAreaCell.find({ clientReportId: report._id, snapshotId: report.snapshotId }, { answers: 1 }).lean();
    const shown = new Set(areaAnswerKeys(cells, { candidateKeys: singleChoice, deps }));
    areaWithoutAnswers = singleChoice.filter((k) => !shown.has(k)).map((k) => ({ key: k, label: labelOf.get(k) || k }));
  }

  const surveysForConditions = async () => (hasSnapshotInputs(report) && template ? [template] : legacyTemplates());

  const [openMockFlags, earlier, teamFigures, areaNarrowedBy, conditionsUnknown] = await Promise.all([
    scopedOpenMockFlags(report, inputs),
    earlierTotalsCheck({ report, inputs, team }),
    // An all-time report keeps only the one-person check (allTimeTeamFigures, above).
    team && report.snapshotId ? (report.allTime ? allTimeTeamFigures(report, inputs) : teamPeriodFigures(report, inputs)) : null,
    areaNarrowing({ report, inputs, inputsOf, labelOf }),
    surveysForConditions().then((surveys) => conditionsUnknownFor({ report, inputs, visibleSet, surveys })),
  ]);

  return {
    periodNotOver: now < new Date(report.rangeEndUtc),
    numbersAsOf: cut || null,
    numbersStale: !!cut && now.getTime() - new Date(cut).getTime() > HOUR_MS,
    arrivedDuringBuild: report.arrivedDuringBuild || 0,
    openMockFlags,
    provenance: {
      cumulative: report.stats?.cumulative?.provenance || null,
      period: report.stats?.period?.provenance || null,
    },
    copiedNotesUnreviewed: !!report.copiedFrom && report.copiedNotesReviewed === false,
    copiedFrom: report.copiedFrom || null,
    hiddenParentCharts,
    hiddenTagSources,
    areaWithoutAnswers,
    conditionsUnknown,
    areaNarrowedBy,
    earlierTotals: earlier.earlierTotals,
    // The compared report's numbers were refreshed after this build recounted them, so the client's
    // earlier-totals line is hidden until a Refresh (a Recompute, on a draft) compares again (NUM-1):
    // { weekStart, weekEnd } of that report, or null.
    earlierReportRefreshed: earlier.refreshed,
    // Earlier reports of this series whose totals changed since they were sent — the real check, not
    // "was refreshed": the build recounted the series' previous shown report up to its own cut-off,
    // and its cards moved (0 or 1; earlierTotals says by how much, and why).
    earlierReportsRefreshed: earlier.earlierTotals ? 1 : 0,
    team: teamFigures,
  };
};
