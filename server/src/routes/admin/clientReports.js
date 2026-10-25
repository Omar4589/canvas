import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { isOrgAdmin, managedCampaignIds, canManageCampaign } from '../../services/authz/campaignManagement.js';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ClientReportAreaCell } from '../../models/ClientReportAreaCell.js';
import { ClientReportSeries } from '../../models/ClientReportSeries.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { Effort } from '../../models/Effort.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { zonedDayRange, zonedDayStr } from '../../utils/timezone.js';
import { daysBetween, addDays } from '../../services/reports/goalProgress.js';
import { shapeReportForClient, mapFilterSurvey } from '../../services/reports/clientReportView.js';
import {
  MapError,
  mapContextFor,
  checkMapRequest,
  sendMapPayload,
  doorsPayload,
  parseRows,
} from '../../services/reports/clientReportMap.js';
import { earlierTotalsLine, seriesNav, currentSeriesLabels } from '../../services/reports/clientReportRead.js';
import { publishChecks, scopedOpenMockFlags } from '../../services/reports/clientReportChecks.js';
import {
  BuildError,
  buildIsLive,
  buildView,
  queuePositionOf,
  claimBuild,
  enqueueBuild,
  startBuild,
  cancelBuild,
  inputsFromSettings,
  currentCrewKeysFor,
  publishReport,
  applyRefresh,
  discardRefresh,
  takeDownReport,
  putBackUpReport,
} from '../../services/reports/clientReportBuilds.js';
import {
  SeriesError,
  ensureSeries,
  teamOf,
  seriesLabelOf,
  seriesEnded,
  crewKeysOf,
  namesInLabel,
  createTeamSeries,
  editSeries,
  seriesPicker,
  teamChangedCard,
  CAMPAIGN_LABEL,
} from '../../services/reports/clientReportSeries.js';
import {
  writeReportHistory,
  writeSeriesHistory,
  earlierTextOf,
  eraseHistory,
  HistoryError,
  REPORT_FIELDS,
  SERIES_FIELDS,
} from '../../services/reports/clientReportHistory.js';
import {
  choiceKeysOf,
  closeUnderDeps,
  depsMap,
  questionDepsOf,
  scopeOf,
  isTeamScope,
  seriesKeyOf,
  breakdownKeysOf,
  mapServed,
  servedMapKeys,
} from '../../services/reports/reportVisibility.js';

// Admin report BUILDER (docs/CLIENT_PORTAL.md; the upgrade in docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md).
// Create a draft for a period — its numbers build on the WORKER (services/reports/clientReportBuilds.js),
// never in this request — edit what the client sees, preview exactly what they will see, then
// publish, which freezes the snapshot that was previewed. A published report changes only through
// Edit (words and removals; the numbers stay frozen) or Refresh numbers (a before-and-after the
// operator applies). Take down hides it; Put back up shows it again, unchanged.
const router = Router();
// Client reports are per-campaign, so team leads may build them — but only for a
// campaign they manage (owner ruling 10-23: full control, as today). Each handler authorizes via
// manages() on the report/share/campaign's campaignId (admins/super are unscoped).
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}

// True if the requester may manage `campaignId`; otherwise writes 403 and returns false.
async function manages(req, res, campaignId) {
  if (await canManageCampaign(req, campaignId)) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}
function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}

// The service errors (a status, a code the builder can explain, and their extra fields), as JSON.
const KNOWN_ERRORS = [BuildError, SeriesError, MapError, HistoryError];
const sendKnown = (res, err) => {
  if (!KNOWN_ERRORS.some((E) => err instanceof E)) return false;
  res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
  return true;
};
const fail = (res, next) => (err) => {
  if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
  if (sendKnown(res, err)) return undefined;
  return next(err);
};

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const idString = z.string().refine((v) => mongoose.isValidObjectId(v), { message: 'Invalid id' });
const createSchema = z.object({
  campaignId: z.string(),
  weekStart: z.string().regex(dateRe),
  weekEnd: z.string().regex(dateRe),
  title: z.string().max(200).optional(),
  // The series this report continues — or, without one, the scope that names it: a walk list
  // (effortId), a team (teamSeriesId), or both (a team on one walk list). None = the whole campaign.
  seriesId: idString.optional(),
  effortId: z.string().optional(),
  teamSeriesId: idString.optional(),
  // A NEW walk-list series' "Name your client sees", and the operator's confirmation that a label
  // matching a canvasser's name is a place, not a person.
  seriesLabel: z.string().max(200).optional(),
  confirmLabel: z.boolean().optional(),
});
const sectionSchema = z.object({ heading: z.string().min(1).max(200), body: z.string().max(20000).default('') });
const updateSchema = z.object({
  title: z.string().max(200).optional(),
  observations: z.array(sectionSchema).optional(),
  supportQuestionKey: z.string().nullable().optional(),
  // "I've reviewed these notes" on a draft whose notes Next copied.
  copiedNotesReviewed: z.boolean().optional(),
  // The status the builder edited (contract C5): a draft's auto-saves send 'draft', a published
  // report's Update sends 'published'; a report that has moved on answers 409 STATUS_CHANGED.
  ifStatus: z.enum(['draft', 'published']).optional(),
  // The editVersion the builder's screen was built on (contract C8): pinned in the write's own
  // filter, so a save from a page that hasn't seen a change made elsewhere is refused 409
  // CHANGED_ELSEWHERE instead of undoing it (PRIV-1, CONCUR-1). Optional for other callers.
  ifEditVersion: z.number().int().min(0).optional(),
  visibility: z
    .object({
      // Explicit lists; EMPTY MEANS NONE for both (§F1).
      visibleQuestionKeys: z.array(z.string()).optional(),
      mapAnswerKeys: z.array(z.string()).optional(),
      showMap: z.boolean().optional(),
      // Opt-in tag allowlist (empty = show none — see the model comment). Max length matches
      // nothing in particular; it just bounds a hostile payload.
      visibleTags: z.array(z.string().max(120)).optional(),
      // Opt-in door-goal progress. Same reason as visibleTags: unauthenticated share page.
      showGoal: z.boolean().optional(),
      // Exact doors or areas. On a draft, ordinary settings that take effect at the next
      // Recompute; on a published report, areas → a remap, anything else → Refresh numbers.
      mapMode: z.enum(['pins', 'area']).optional(),
      areaSize: z.enum(['small', 'large']).optional(),
    })
    .optional(),
});
// What a Refresh may ADD to the map (§F3): the map on, map questions, exact doors or areas, a size.
const refreshSchema = z.object({
  map: z
    .object({
      showMap: z.literal(true).optional(),
      mapKeys: z.array(z.string()).optional(),
      mapMode: z.enum(['pins', 'area']).optional(),
      areaSize: z.enum(['small', 'large']).optional(),
    })
    .optional(),
});

async function loadCampaignInOrg(orgId, campaignId) {
  if (!mongoose.isValidObjectId(campaignId)) return null;
  // NOT_DELETING: a mid-delete campaign reads as gone (services/campaigns/deletionState.js).
  return Campaign.findOne({ _id: campaignId, organizationId: orgId, ...NOT_DELETING }).lean();
}
async function resolveTemplate(orgId, campaign) {
  if (!campaign?.surveyTemplateId) return null;
  return SurveyTemplate.findOne({ _id: campaign.surveyTemplateId, organizationId: orgId }).lean();
}

// The report, lean, in the active org and on a campaign the requester manages — or a response sent.
async function loadReportInOrg(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const report = await ClientReport.findOne({ _id: req.params.id, organizationId: activeOrgId(req) }).lean();
  if (!report) {
    res.status(404).json({ error: 'Report not found', code: 'REPORT_NOT_FOUND' });
    return null;
  }
  if (!(await manages(req, res, report.campaignId))) return null;
  return report;
}

// Teams need team attribution (org-level; a fresh org has it, an old one after its backfill).
// Lean on purpose: the model's default would read an unset stamp as ready.
const teamsReady = async (orgId) => !!(await Organization.findById(orgId, { teamAttributionReadyAt: 1 }).lean())?.teamAttributionReadyAt;
const TEAMS_NOT_READY = {
  error: "Team reports need team attribution, which this organization doesn't have yet.",
  code: 'TEAM_ATTRIBUTION_NOT_READY',
};

// Compact row for the report list (drops the heavy per-window breakdowns).
function adminListRow(r) {
  const scope = scopeOf(r);
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    campaignType: r.campaignType || null, // frozen with the numbers; null on a report from before it
    title: r.title || '',
    effortName: r.effortName || null, // walk-list scope label; null = whole campaign
    seriesId: r.seriesId ? String(r.seriesId) : null,
    seriesKey: seriesKeyOf(r),
    scope,
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    timeZone: r.timeZone,
    status: r.status,
    takenDownAt: r.takenDownAt || null,
    mapPointCount: r.mapPointCount || 0,
    areaCellCount: r.areaCellCount || 0,
    hasSnapshot: !!r.snapshotId,
    statsComputedAt: r.statsComputedAt || null,
    viewCount: r.viewCount || 0,
    lastViewedAt: r.lastViewedAt || null,
    views: r.views || null,
    publishedAt: r.publishedAt || null,
    contentEditedAt: r.contentEditedAt || null,
    numbersRefreshedAt: r.numbersRefreshedAt || null,
    nextReportId: r.nextReportId ? String(r.nextReportId) : null,
    build: buildView(r.build),
    updatedAt: r.updatedAt,
    headline: {
      cumulative: r.stats?.cumulative?.totals || {},
      period: r.stats?.period?.totals || {},
    },
  };
}

// ── Share links ──────────────────────────────────────────────────────────────
// The client-link routes (/admin/client-reports/shares…) live in routes/admin/clientReportShares.js,
// mounted AHEAD of this router (routes/index.js), so `/:id` below never sees `:id = "shares"`.

// ── Series (§F4, §O4) ────────────────────────────────────────────────────────────────────────
// A team name covers one or more crews; each tab of the client's page is a series. Declared
// BEFORE the `/:id` report routes, like /shares, so Express doesn't match `:id = "series"`.

async function loadSeriesInOrg(req, res) {
  if (!mongoose.isValidObjectId(req.params.seriesId)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const series = await ClientReportSeries.findOne({ _id: req.params.seriesId, organizationId: activeOrgId(req) }).lean();
  if (!series) {
    res.status(404).json({ error: 'Series not found', code: 'SERIES_NOT_FOUND' });
    return null;
  }
  if (!(await manages(req, res, series.campaignId))) return null;
  return series;
}

// The picker and every series of a campaign, with its current label and crews (G2). The campaign
// must be in the active org — manages() alone is not org scoping (canManageCampaign says yes to any
// org admin for any id): an admin of one org once read another org's crew names here (SEC-1).
router.get('/series', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.query.campaignId || !mongoose.isValidObjectId(req.query.campaignId)) {
      return res.status(400).json({ error: 'campaignId required' });
    }
    const orgId = activeOrgId(req);
    const campaign = await loadCampaignInOrg(orgId, req.query.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found in this org' });
    if (!(await manages(req, res, campaign._id))) return;
    const [picker, ready] = await Promise.all([
      seriesPicker({ organizationId: orgId, campaignId: campaign._id }),
      teamsReady(orgId),
    ]);
    res.json({ ...picker, teamsReady: ready });
  } catch (err) {
    fail(res, next)(err);
  }
});

// The client-report teams a coordinator change moves numbers in (§O4), for the coordinator-change
// confirm (CoordinatorConfirm): the campaign's active teams whose crews, current or past (crewKeys),
// include any of these coordinators, and that have a report — a team with none has no numbers yet.
// Labels only (the names the client already reads), never a count or a person.
router.get('/series/affected', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.query.campaignId || !mongoose.isValidObjectId(req.query.campaignId)) {
      return res.status(400).json({ error: 'campaignId required' });
    }
    const ids = [...new Set(String(req.query.coordinatorIds || '').split(',').map((s) => s.trim()).filter(Boolean))];
    if (ids.length > 50 || ids.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ error: 'Invalid coordinatorIds' });
    }
    const orgId = activeOrgId(req);
    const campaign = await loadCampaignInOrg(orgId, req.query.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found in this org' });
    if (!(await manages(req, res, campaign._id))) return;
    if (!ids.length) return res.json({ teams: [] });
    const { ObjectId } = mongoose.Types;
    const campaignId = campaign._id;
    const teams = await ClientReportSeries.find(
      { organizationId: orgId, campaignId, kind: 'team', endedAt: null, crewKeys: { $in: ids.map((id) => new ObjectId(id)) } },
      { label: 1 }
    )
      .sort({ label: 1 })
      .lean();
    if (!teams.length) return res.json({ teams: [] });
    // A team's reports are its own and those of its teams on one walk list.
    const children = await ClientReportSeries.find({ organizationId: orgId, campaignId, kind: 'team_walk_list', teamSeriesId: { $in: teams.map((t) => t._id) } }, { teamSeriesId: 1 }).lean();
    const teamOfSeries = new Map([...teams.map((t) => [String(t._id), String(t._id)]), ...children.map((c) => [String(c._id), String(c.teamSeriesId)])]);
    const reported = await ClientReport.distinct('seriesId', {
      organizationId: orgId,
      campaignId,
      seriesId: { $in: [...teamOfSeries.keys()].map((id) => new ObjectId(id)) },
    });
    const withReports = new Set(reported.map((id) => teamOfSeries.get(String(id))));
    res.json({ teams: teams.filter((t) => withReports.has(String(t._id))).map((t) => ({ seriesId: String(t._id), label: t.label })) });
  } catch (err) {
    fail(res, next)(err);
  }
});

const teamCreateSchema = z.object({
  campaignId: z.string(),
  label: z.string().max(200),
  coordinatorIds: z.array(z.string()).max(50),
});

// A new team: the name the client reads (never a canvasser's) and the crews it covers.
router.post('/series', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = teamCreateSchema.parse(req.body);
    const campaign = await loadCampaignInOrg(orgId, data.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found in this org' });
    if (!(await manages(req, res, campaign._id))) return;
    if (!(await teamsReady(orgId))) return res.status(400).json(TEAMS_NOT_READY);
    const series = await createTeamSeries({
      organizationId: orgId,
      campaignId: campaign._id,
      label: data.label,
      coordinatorIds: data.coordinatorIds,
      createdBy: req.user._id,
    });
    await writeSeriesHistory(series, SERIES_FIELDS.created, { by: req.user._id, toValue: { label: series.label, coordinatorIds: series.coordinatorIds.map(String) } }).catch(() => {});
    res.status(201).json({ series });
  } catch (err) {
    fail(res, next)(err);
  }
});

const seriesPatchSchema = z.object({
  label: z.string().max(200).optional(),
  confirmLabel: z.boolean().optional(),
  coordinatorIds: z.array(z.string()).max(50).optional(),
  // The team-changed card's choices (§F4, §O4).
  keepPast: z.array(z.string()).max(50).optional(),
  removePast: z.array(z.string()).max(50).optional(),
  makeCurrent: z.array(z.string()).max(50).optional(),
  end: z.boolean().optional(),
  continue: z.boolean().optional(),
  // "End this team" from the card also offers to delete the team's open draft.
  deleteOpenDrafts: z.boolean().optional(),
});

// Edit team: rename, change crews, keep or remove a departed lead's past doors, end, continue.
// Walk-list series: rename. Published reports keep the scope label they froze.
router.patch('/series/:seriesId', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const series = await loadSeriesInOrg(req, res);
    if (!series) return;
    const data = seriesPatchSchema.parse(req.body || {});
    if (series.kind === 'team' && (data.coordinatorIds || data.continue || data.makeCurrent) && !(await teamsReady(activeOrgId(req)))) {
      return res.status(400).json(TEAMS_NOT_READY);
    }
    const { before, after } = await editSeries({ series, patch: data, by: req.user._id });
    const by = req.user._id;
    if (before.label !== after.label) {
      await writeSeriesHistory(after, SERIES_FIELDS.renamed, { by, fromValue: before.label, toValue: after.label }).catch(() => {});
    }
    // Every row below names the team or tab as it reads now (WALK-3): "Paid team · Crews changed",
    // never "A team" — the History can't otherwise tell four tabs apart.
    const label = await seriesLabelOf(after);
    if (before.endedAt && !after.endedAt) {
      await writeSeriesHistory(after, SERIES_FIELDS.continued, { by, toValue: { label, coordinatorIds: (after.coordinatorIds || []).map(String) } }).catch(() => {});
    }
    const ids = (s) => [...(s.coordinatorIds || [])].map(String).sort().join(',') + '|' + [...(s.pastCoordinatorIds || [])].map(String).sort().join(',');
    if (ids(before) !== ids(after)) {
      await writeSeriesHistory(after, SERIES_FIELDS.crewsChanged, {
        by,
        fromValue: { coordinatorIds: (before.coordinatorIds || []).map(String), pastCoordinatorIds: (before.pastCoordinatorIds || []).map(String) },
        toValue: { label, coordinatorIds: (after.coordinatorIds || []).map(String), pastCoordinatorIds: (after.pastCoordinatorIds || []).map(String) },
      }).catch(() => {});
    }
    if (!before.endedAt && after.endedAt) {
      await writeSeriesHistory(after, SERIES_FIELDS.ended, { by, toValue: { label } }).catch(() => {});
      if (data.deleteOpenDrafts) {
        const childIds = (await ClientReportSeries.find({ teamSeriesId: after._id }, { _id: 1 }).lean()).map((s) => s._id);
        const drafts = await ClientReport.find({ organizationId: after.organizationId, seriesId: { $in: [after._id, ...childIds] }, status: 'draft' }, { _id: 1 }).lean();
        for (const d of drafts) {
          await cancelBuild({ reportId: d._id, organizationId: after.organizationId, by });
          // Only what is STILL a draft is deleted, and only a deleted report's rows go: a draft
          // published since it was listed keeps its map (STATE-3). Then as DELETE /:id does — no
          // nextReportId left pointing at it, and a History row.
          const pre = await ClientReport.findOneAndDelete({ _id: d._id, organizationId: after.organizationId, status: 'draft' }).lean();
          if (!pre) continue;
          await ClientReport.updateMany({ organizationId: after.organizationId, nextReportId: pre._id }, { $set: { nextReportId: null } });
          await Promise.all([ClientReportMapPoint.deleteMany({ clientReportId: pre._id }), ClientReportAreaCell.deleteMany({ clientReportId: pre._id })]);
          await writeReportHistory(pre, REPORT_FIELDS.deleted, { by }).catch(() => {});
        }
      }
    }
    res.json({ series: after });
  } catch (err) {
    fail(res, next)(err);
  }
});

// The team-changed card's data: who no longer runs a crew, where her canvassers went, and what
// removing her past doors would take out (§F4, §O4) — counted against the report the card is about
// (NUM-4): `?reportId=`, or else the team's newest draft whose build stopped on the change, or else
// its newest report. Its walk list and its period's end bound "Remove them".
router.get('/series/:seriesId/team-changed', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const series = await loadSeriesInOrg(req, res);
    if (!series) return;
    const team = await teamOf(series);
    if (!team) return res.status(400).json({ error: 'Not a team series', code: 'NOT_A_TEAM' });
    const orgId = activeOrgId(req);
    const family =
      series.kind === 'team_walk_list'
        ? [series._id]
        : [team._id, ...(await ClientReportSeries.find({ organizationId: orgId, teamSeriesId: team._id }, { _id: 1 }).lean()).map((s) => s._id)];
    const fields = { rangeEndUtc: 1, effortId: 1 };
    let report = null;
    if (req.query.reportId) {
      if (!mongoose.isValidObjectId(req.query.reportId)) return res.status(400).json({ error: 'Invalid reportId' });
      report = await ClientReport.findOne({ _id: req.query.reportId, organizationId: orgId, seriesId: { $in: family } }, fields).lean();
      if (!report) return res.status(404).json({ error: 'Report not found', code: 'REPORT_NOT_FOUND' });
    } else {
      const newest = (filter) => ClientReport.findOne({ organizationId: orgId, seriesId: { $in: family }, ...filter }, fields).sort({ rangeEndUtc: -1 }).lean();
      report = (await newest({ status: 'draft', 'build.error.code': 'TEAM_CHANGED' })) || (await newest({}));
    }
    res.json(
      await teamChangedCard({
        organizationId: series.organizationId,
        campaignId: series.campaignId,
        team,
        effortId: report ? report.effortId || null : series.kind === 'team_walk_list' ? series.effortId : null,
        rangeEndUtc: report?.rangeEndUtc || null,
      })
    );
  } catch (err) {
    fail(res, next)(err);
  }
});

// ── Reports ──────────────────────────────────────────────────────────────────────────────────

// What a new draft shows, written out explicitly (§F1: empty means none, so nothing is left to a
// default): every choice question's chart, and on the map every one whose follow-up conditions
// are met by the others — a follow-up of a text question never is.
const defaultVisibility = (template) => {
  const keys = choiceKeysOf(template);
  return {
    visibleQuestionKeys: keys,
    mapAnswerKeys: closeUnderDeps(keys, depsMap(questionDepsOf(template))),
    showMap: true,
    mapMode: 'pins',
    areaSize: 'small',
    visibleTags: [],
    showGoal: false,
  };
};

// Resolve the series a new report belongs to, from what the create form sent (§F4, §O3).
// Returns { series, team, effort, label } or sends a response and returns null.
const resolveCreateSeries = async (req, res, { campaign, data }) => {
  const orgId = activeOrgId(req);
  const findEffort = async (id) => {
    if (!mongoose.isValidObjectId(id)) return null;
    return Effort.findOne({ _id: id, campaignId: campaign._id }, { name: 1 }).lean();
  };
  const ensureWalkList = async (effort) => {
    const existing = await ClientReportSeries.findOne({ campaignId: campaign._id, kind: 'walk_list', effortId: effort._id, endedAt: null }).lean();
    if (!existing) {
      // A walk-list name that matches a canvasser's gets a warning the operator can confirm: place
      // names often are names ("Marco Island").
      const label = data.seriesLabel || effort.name;
      if (!data.confirmLabel) {
        const names = await namesInLabel({ campaignId: campaign._id, label });
        if (names.length) {
          res.status(400).json({
            error: 'This walk list’s name matches a canvasser on this campaign. Confirm it is a place, not a person, or choose the name your client sees.',
            code: 'WALK_LIST_LABEL_HAS_NAME',
            names,
            label,
            confirmable: true,
          });
          return null;
        }
      }
    }
    return existing || ensureSeries({
      organizationId: orgId,
      campaignId: campaign._id,
      kind: 'walk_list',
      effortId: effort._id,
      effortName: effort.name,
      label: data.seriesLabel || null,
      createdBy: req.user._id,
    });
  };

  let series = null;
  let effort = null;
  if (data.seriesId) {
    series = await ClientReportSeries.findOne({ _id: data.seriesId, campaignId: campaign._id }).lean();
    if (!series) {
      res.status(400).json({ error: 'That report series is not on this campaign.', code: 'SERIES_NOT_FOUND' });
      return null;
    }
    if (series.effortId) effort = await findEffort(series.effortId);
  } else if (data.teamSeriesId) {
    const team = await ClientReportSeries.findOne({ _id: data.teamSeriesId, campaignId: campaign._id, kind: 'team' }).lean();
    if (!team) {
      res.status(400).json({ error: 'That team is not on this campaign.', code: 'SERIES_NOT_FOUND' });
      return null;
    }
    series = team;
    if (data.effortId) {
      effort = await findEffort(data.effortId);
      if (!effort) {
        res.status(400).json({ error: 'Walk list not found in this campaign' });
        return null;
      }
      // The combined name ("Paid team · North") carries the walk list's name: the same
      // confirmable warning as a walk-list label (the team's own name was checked when it was made).
      const existing = await ClientReportSeries.exists({ campaignId: campaign._id, kind: 'team_walk_list', teamSeriesId: team._id, effortId: effort._id, endedAt: null });
      if (!existing && !data.confirmLabel) {
        const names = await namesInLabel({ campaignId: campaign._id, label: effort.name });
        if (names.length) {
          res.status(400).json({
            error: 'This walk list’s name matches a canvasser on this campaign. Confirm it is a place, not a person.',
            code: 'WALK_LIST_LABEL_HAS_NAME',
            names,
            label: `${team.label} · ${effort.name}`,
            confirmable: true,
          });
          return null;
        }
      }
      series = await ensureSeries({
        organizationId: orgId,
        campaignId: campaign._id,
        kind: 'team_walk_list',
        effortId: effort._id,
        teamSeriesId: team._id,
        createdBy: req.user._id,
      });
    }
  } else if (data.effortId) {
    effort = await findEffort(data.effortId);
    if (!effort) {
      res.status(400).json({ error: 'Walk list not found in this campaign' });
      return null;
    }
    series = await ensureWalkList(effort);
    if (!series) return null;
  } else {
    series = await ensureSeries({ organizationId: orgId, campaignId: campaign._id, kind: 'campaign', createdBy: req.user._id });
  }
  const team = await teamOf(series);
  if (await seriesEnded(series, team)) {
    res.status(409).json({ error: 'That team or series has ended. Continue it first, or pick another.', code: 'SERIES_ENDED', seriesId: String(team?._id || series._id) });
    return null;
  }
  if (team && !(await teamsReady(orgId))) {
    res.status(400).json(TEAMS_NOT_READY);
    return null;
  }
  const label = await seriesLabelOf(series, { team, effortName: effort ? effort.name : undefined });
  return { series, team, effort, label };
};

// Insert a draft with a recompute ALREADY CLAIMED (§F10), so the builder opens on "Building the
// first numbers…". The enqueue follows; if the queue can't take it the build reads failed with a
// Retry, and the draft is there either way.
const insertDraftWithBuild = async ({ _id = new mongoose.Types.ObjectId(), doc, template, coordinatorIds, by }) => {
  const now = new Date();
  const build = {
    kind: 'recompute',
    status: 'queued',
    jobId: new mongoose.Types.ObjectId().toHexString(),
    inputs: inputsFromSettings({ visibility: doc.visibility, template, coordinatorIds }),
    startedAt: now,
    beatAt: now,
    rebuilds: 0,
    progress: 0,
    requestedBy: by,
  };
  const created = await ClientReport.create({ _id, ...doc, editVersion: 0, build });
  return { report: created.toObject(), build };
};

// Create a draft for a campaign + period, in a series (new or existing), and start its numbers.
router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = createSchema.parse(req.body);
    if (data.weekStart > data.weekEnd) {
      return res.status(400).json({ error: 'weekStart must be on or before weekEnd' });
    }
    const campaign = await loadCampaignInOrg(orgId, data.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found in this org' });
    if (!(await manages(req, res, campaign._id))) return;
    if (data.effortId && !mongoose.isValidObjectId(data.effortId)) {
      return res.status(400).json({ error: 'Invalid effortId' });
    }

    const tz = campaign.timeZone || 'America/New_York';
    const range = zonedDayRange(data.weekStart, data.weekEnd, tz);
    if (!range.$gte || !range.$lt) {
      return res.status(400).json({ error: 'Invalid week range' });
    }
    const resolved = await resolveCreateSeries(req, res, { campaign, data });
    if (!resolved) return;
    const { series, team, effort, label } = resolved;
    const template = await resolveTemplate(orgId, campaign);

    const { report, build } = await insertDraftWithBuild({
      template,
      coordinatorIds: crewKeysOf(team),
      by: req.user._id,
      doc: {
        organizationId: orgId,
        campaignId: campaign._id,
        campaignType: campaign.type,
        title: data.title || '',
        // The walk list's name is FROZEN at creation (the public page never needs a live lookup).
        effortId: effort ? effort._id : null,
        effortName: effort ? effort.name : null,
        seriesId: series._id,
        scope: { kind: series.kind, label },
        weekStart: data.weekStart,
        weekEnd: data.weekEnd,
        timeZone: tz,
        rangeStartUtc: range.$gte,
        rangeEndUtc: range.$lt,
        status: 'draft',
        supportQuestionKey: null,
        visibility: defaultVisibility(template),
        createdBy: req.user._id,
      },
    });
    await enqueueBuild({ reportId: report._id, jobId: build.jobId });
    await writeReportHistory(report, REPORT_FIELDS.created, { by: req.user._id }).catch(() => {});
    const fresh = await ClientReport.findById(report._id).lean();
    res.status(201).json({ report: fresh, build: buildView(fresh.build) });
  } catch (err) {
    fail(res, next)(err);
  }
});

// List reports (optionally for one campaign), newest week first.
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const filter = { organizationId: orgId };
    if (req.query.campaignId) {
      if (!mongoose.isValidObjectId(req.query.campaignId)) {
        return res.status(400).json({ error: 'Invalid campaignId' });
      }
      if (!isOrgAdmin(req) && !(await canManageCampaign(req, req.query.campaignId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      filter.campaignId = new mongoose.Types.ObjectId(req.query.campaignId);
    } else if (!isOrgAdmin(req)) {
      // A lead's report list spans only the campaigns they manage.
      filter.campaignId = { $in: await managedCampaignIds(req) };
    }
    if (req.query.seriesId && mongoose.isValidObjectId(req.query.seriesId)) filter.seriesId = new mongoose.Types.ObjectId(req.query.seriesId);
    const reports = await ClientReport.find(filter, { 'stats.cumulative.surveyBreakdowns': 0, 'stats.period.surveyBreakdowns': 0, 'build.result': 0 })
      .sort({ weekStart: -1, createdAt: -1 })
      .lean();
    const labels = await currentSeriesLabels(reports);
    res.json({
      reports: reports.map((r) => ({ ...adminListRow(r), seriesLabel: r.seriesId ? labels.get(String(r.seriesId)) || null : null })),
    });
  } catch (err) {
    next(err);
  }
});

// Full draft/published doc (admin view), with its build, its series' current label, and what is
// worth a look before publishing (services/reports/clientReportChecks.js).
router.get('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    // Campaign + org names let the builder's PDF export carry the same header the client sees.
    const campaign = await Campaign.findById(report.campaignId, { name: 1, surveyTemplateId: 1, organizationId: 1 }).lean();
    const template = await resolveTemplate(activeOrgId(req), campaign);
    const [live, checks, labels, queuePosition, mctx] = await Promise.all([
      buildIsLive(report),
      publishChecks(report, { template }),
      currentSeriesLabels([report]),
      report.build?.status === 'queued' ? queuePositionOf(report.build.jobId) : null,
      mapContextFor(report),
    ]);
    res.json({
      report,
      campaignName: campaign?.name || '',
      orgName: req.activeOrg?.name || '',
      seriesLabel: report.seriesId ? labels.get(String(report.seriesId)) || null : null,
      // Soft publish gate: unreviewed mock-GPS flags inside this report's scope and CUMULATIVE
      // window. A response sibling on purpose — the only persisted copy is openMockFlagsAtPublish,
      // stamped at freeze time. Never shaped into the client view.
      openMockFlags: checks.openMockFlags,
      build: { ...buildView(report.build, { live }), queuePosition },
      checks,
      // What the live snapshot was built with, as the server reads it (contract C4) — a report from
      // before snapshots through every survey its answers can have come from — so the builder never
      // guesses from the stored settings.
      liveInputs: {
        showMap: mctx.inputs.showMap,
        mapMode: mctx.inputs.mapMode,
        areaSize: mctx.inputs.areaSize,
        mapKeys: mctx.inputs.mapKeys,
        questionDeps: mctx.inputs.questionDeps,
      },
    });
  } catch (err) {
    next(err);
  }
});

const NO_GOAL = (report) => ({
  error: report.effortId
    ? 'Door goals are campaign-wide, so they cannot be shown on a walk-list-scoped report.'
    : isTeamScope(scopeOf(report).kind)
      ? 'Door goals are campaign-wide, so they cannot be shown on a team report.'
      : 'This campaign has no door goal set.',
  code: 'NO_GOAL_SNAPSHOT',
});
// The campaign has a door goal, but this report's numbers were built before it (NUM-5, contract C6).
const GOAL_AFTER_BUILD = {
  error: 'Your door goal was set after these numbers were built. Recompute them — or Refresh numbers, on a published report — to show it.',
  code: 'GOAL_AFTER_BUILD',
};
// An edit made against a status the report no longer has (contract C5): say what it is now.
const STATUS_CHANGED = (current) => ({
  error:
    current.status === 'published'
      ? 'This report was published while you were editing, so your change wasn’t saved.'
      : 'This report changed while you were editing, so your change wasn’t saved.',
  code: 'STATUS_CHANGED',
  status: current.status,
  takenDown: !!current.takenDownAt,
});
// An edit made against a version the report no longer has (contract C8): nothing is written, and the
// report as it stands now rides along (GET /:id's `report`), so the builder merges against it and
// sends only its own changes again — or asks, when both sides changed the same thing.
const CHANGED_ELSEWHERE = (current) => ({
  error: 'This report was changed somewhere else — this page now shows the latest version.',
  code: 'CHANGED_ELSEWHERE',
  editVersion: current.editVersion ?? 0,
  report: current,
});
// A stored editVersion pinned in a filter: a report from before the field reads as 0.
const editVersionIs = (n) => (n === 0 ? { $in: [0, null] } : n);

// Two sets of question dependencies, united (a removal prunes by both: never less than either).
const unitedDeps = (...lists) => {
  const out = new Map();
  for (const list of lists) {
    for (const [key, deps] of depsMap(list)) {
      if (!out.has(key)) out.set(key, new Set());
      for (const d of deps) out.get(key).add(d);
    }
  }
  return out;
};

// Edit a report: a targeted $set of the fields sent, never a whole-document save, so a build's
// commit landing at the same moment can't be lost (§F3). A build never blocks this.
//
// On a PUBLISHED report (shown or taken down) it accepts the words, the headline, the visible
// questions and tags, the goal tick, and two REMOVALS (map off; dropping map questions); Switch to
// areas claims a remap; anything that would ADD to the map is 400 NEEDS_REFRESH (the builder sends
// those through Refresh numbers). Every removal — on a draft or a published report — goes through
// the ONE removal path (§O1): it prunes the live snapshot's inputs, any live or ready build's
// inputs, and the stored rows, in the same request, so nothing removed can come back.
router.patch('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    const orgId = activeOrgId(req);
    const data = updateSchema.parse(req.body);
    const published = report.status === 'published';
    const campaign = await Campaign.findById(report.campaignId).lean();
    const template = await resolveTemplate(orgId, campaign);
    const v = data.visibility || null;

    // An edit made against one status never lands on another (C5): a draft's auto-save arriving after
    // someone published it would put half-written text in front of the client with no confirm
    // (ADMINUX-2). `ifStatus` names the status the builder edited; the update's filter pins the status
    // this request read either way, so the check is atomic with the write.
    if (data.ifStatus && data.ifStatus !== report.status) return res.status(409).json(STATUS_CHANGED(report));
    // Then the version the screen was built on (contract C8, PRIV-1 / CONCUR-1): a page that hasn't
    // seen a change made elsewhere — a chart hidden, a section deleted, an Apply — never writes over
    // it. Checked here (before anything is claimed) and pinned again in the write's own filter below.
    const ifVersion = data.ifEditVersion;
    if (ifVersion !== undefined && (report.editVersion ?? 0) !== ifVersion) return res.status(409).json(CHANGED_ELSEWHERE(report));

    // The live snapshot's inputs. A report from before snapshots takes its follow-up dependencies from
    // every survey its answers can have come from (legacyTemplatesFor), and a map question none of them
    // asks is never served (LEGACY-1); the campaign's current survey stays the one choice questions and
    // drafts are read against.
    const { inputs: live } = await mapContextFor(report);
    const old = report.visibility || {};
    const served = published && live.showMap && old.showMap !== false;
    // LEGACY-2: on a published report whose map is SERVED, a map question the stored list names that
    // the live snapshot doesn't serve (hidden when an old report was frozen, or no question of its
    // surveys) is already gone — narrowed silently, as the migration's step 4 does, and never read as
    // an addition. While the map is off the stored list is the operator's map picks, kept for when it
    // comes back on (§P1) — the live snapshot then serves no question at all, so nothing is narrowed
    // (VERIFY-1: an unrelated edit used to wipe them).
    const stale = new Set(served ? (old.mapAnswerKeys || []).filter((k) => !live.mapKeys.includes(k)) : []);
    const oldMapKeys = (old.mapAnswerKeys || []).filter((k) => !stale.has(k));
    const sentMapKeys = v?.mapAnswerKeys === undefined ? undefined : v.mapAnswerKeys.filter((k) => !stale.has(k));

    // mapAnswerKeys pins an answer to a household's STREET ADDRESS on a link holder's page. A
    // free-text answer there publishes whatever a canvasser typed, verbatim, next to somebody's
    // home — so the map may only ever carry CHOICE answers, whose value set the operator picked in
    // advance. Enforced on the write path. A published report's live map questions pass as they are
    // (a build froze them as choice answers, perhaps from a survey the campaign no longer uses), and
    // so do the picks a map-off report keeps: they reach no map until Refresh numbers turns it on,
    // which checks every question it puts there.
    if (sentMapKeys !== undefined) {
      const allowed = new Set([...choiceKeysOf(template), ...(published ? live.mapKeys : []), ...(published && !served ? oldMapKeys : [])]);
      const rejected = sentMapKeys.filter((k) => !allowed.has(k));
      if (rejected.length) {
        return res.status(400).json({
          error:
            'The report map can only show multiple-choice answers. These are free-text (or unknown) ' +
            `questions and cannot be pinned to an address: ${rejected.join(', ')}`,
          code: 'MAP_ANSWER_KEYS_NOT_CHOICE',
          rejected,
        });
      }
    }

    // Refuse rather than silently render nothing: a walk-list or team report never has a goal, nor
    // a campaign without one. A campaign that HAS one, on a report whose numbers were built without
    // it, says so and points at the rebuild that freezes it (NUM-5).
    if (v?.showGoal === true && !report.goalSnapshot?.target) {
      if (report.effortId || isTeamScope(scopeOf(report).kind) || !(Number(campaign?.doorGoal) > 0)) {
        return res.status(400).json(NO_GOAL(report));
      }
      if (report.snapshotId || published) return res.status(400).json(GOAL_AFTER_BUILD);
    }

    const next = {
      visibleQuestionKeys: v?.visibleQuestionKeys ?? old.visibleQuestionKeys ?? [],
      mapAnswerKeys: sentMapKeys ?? oldMapKeys,
      showMap: v?.showMap ?? old.showMap !== false,
      visibleTags: v?.visibleTags ?? old.visibleTags ?? [],
      showGoal: v?.showGoal ?? !!old.showGoal,
      mapMode: v?.mapMode ?? (old.mapMode === 'area' ? 'area' : 'pins'),
      areaSize: v?.areaSize ?? (old.areaSize === 'large' ? 'large' : 'small'),
    };
    // A ready or running Refresh, and what it would ADD to the map: its map questions that neither
    // the stored list nor the live snapshot has (visibility gets them only at Apply).
    const buildInputs = report.build?.inputs && typeof report.build.inputs === 'object' ? report.build.inputs : null;
    const buildKeys = (buildInputs?.mapKeys || []).map(String);
    const refreshAdds = report.build?.kind === 'refresh' ? buildKeys.filter((k) => !oldMapKeys.includes(k) && !live.mapKeys.includes(k)) : [];
    // The map questions these settings allow, closed under the dependencies — the snapshot's frozen
    // ones united with the survey's current ones (and a pending build's), so a removal prunes by all.
    // A published report maps only questions it froze a chart for; a draft, any of its survey's
    // choice questions.
    const deps = unitedDeps(live.questionDeps, questionDepsOf(template), buildInputs?.questionDeps);
    const universe = new Set(published ? breakdownKeysOf(report) : [...choiceKeysOf(template), ...breakdownKeysOf(report)]);
    const visibleSet = new Set(next.visibleQuestionKeys);
    const allowed = closeUnderDeps(
      [...new Set(next.mapAnswerKeys)].filter((k) => visibleSet.has(k) && universe.has(k)),
      deps
    );
    // A key that leaves the allowed set leaves mapAnswerKeys too (§F1).
    next.mapAnswerKeys = allowed;

    let remap = null;
    if (published && v) {
      const reasons = [];
      if (next.showMap && !served) reasons.push('map_on');
      if (next.showMap && allowed.some((k) => !live.mapKeys.includes(k))) reasons.push('map_questions');
      if (next.showMap && served && v.mapMode === 'pins' && live.mapMode === 'area') reasons.push('back_to_exact_doors');
      if (next.showMap && served && live.mapMode === 'area' && v.areaSize && v.areaSize !== live.areaSize) reasons.push('area_size');
      if (reasons.length) {
        return res.status(400).json({
          error: 'That adds to what this published report shows. Add it with Refresh numbers.',
          code: 'NEEDS_REFRESH',
          reasons,
        });
      }
      if (next.showMap && served && v.mapMode === 'area' && live.mapMode === 'pins') {
        remap = { areaSize: v.areaSize || next.areaSize };
      }
      // A published report's mode and size only ever change through a build (the remap's commit
      // sets them); on screen they follow the live snapshot.
      next.mapMode = live.mapMode;
      next.areaSize = live.areaSize;
    }

    // STATE-2: a pending Refresh's additions are not removals. They stay on its build and in its
    // snapshot's rows unless this edit hides their chart or drops a question they depend on.
    const buildKeep = closeUnderDeps([...new Set([...allowed, ...refreshAdds.filter((k) => visibleSet.has(k))])], deps);
    const keptAdds = new Set(refreshAdds.filter((k) => buildKeep.includes(k)));
    const prevKeys = new Set([...(old.mapAnswerKeys || []), ...live.mapKeys, ...buildKeys]);
    const removedKeys = [...prevKeys].filter((k) => !allowed.includes(k) && !keptAdds.has(k));
    const mapOff = !!v && next.showMap === false && (old.showMap !== false || live.showMap);
    const prune = !!v && (removedKeys.length > 0 || mapOff);
    // What leaves any build's inputs and rows: every key this edit removes or hides, every key
    // depending on one (to a fixpoint), and the pending build's keys the closure above let go. Built
    // as a drop list rather than a keep list so a build claimed after this request read the report
    // loses only what the edit takes out — for the build read here it is exactly buildKeep.
    const known = new Set([...prevKeys, ...choiceKeysOf(template), ...breakdownKeysOf(report)]);
    for (const [k, ds] of deps) for (const d of [k, ...ds]) known.add(d);
    const dropped = new Set([...removedKeys, ...[...known].filter((k) => !visibleSet.has(k)), ...buildKeys.filter((k) => !buildKeep.includes(k))]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [k, ds] of deps) {
        if (!dropped.has(k) && [...ds].some((d) => dropped.has(d))) {
          dropped.add(k);
          grew = true;
        }
      }
    }

    // Switch to areas: claimed FIRST, so a refusal (another build live, a review pending) refuses
    // the whole edit. Its target is the live snapshot's inputs with this edit's removals applied.
    let remapBuild = null;
    if (remap) {
      remapBuild = await claimBuild({
        report,
        kind: 'remap',
        inputs: {
          ...live,
          mapKeys: live.mapKeys.filter((k) => allowed.includes(k)),
          mapMode: 'area',
          areaSize: remap.areaSize === 'large' ? 'large' : 'small',
        },
        by: req.user._id,
        expectStatus: 'published',
      });
    }

    const lit = (x) => ({ $literal: x });
    const set = {};
    if (data.title !== undefined) set.title = lit(data.title);
    if (data.observations !== undefined) set.observations = lit(data.observations.map((s) => ({ heading: s.heading, body: s.body ?? '' })));
    if (data.supportQuestionKey !== undefined) set.supportQuestionKey = lit(data.supportQuestionKey || null);
    if (data.copiedNotesReviewed !== undefined) set.copiedNotesReviewed = lit(data.copiedNotesReviewed);
    if (v) {
      // Only the keys this request sent (CONCUR-3): a key written back from this request's own read
      // would undo a write that landed since — another editor's tick, an Apply turning the map on, a
      // remap's commit. On a published report a sent mode or size follows the live snapshot (above).
      for (const k of ['visibleQuestionKeys', 'showMap', 'visibleTags', 'showGoal', 'mapMode', 'areaSize']) {
        if (v[k] !== undefined) set[`visibility.${k}`] = lit(next[k]);
      }
      // Map questions: as sent, closed under their dependencies — otherwise only what this edit's
      // pruning takes out (a hidden chart takes its map question with it, §F1), removed from the list
      // as it stands at the write, so a question added there meanwhile stays.
      const prunedOut = (old.mapAnswerKeys || []).filter((k) => !allowed.includes(k));
      if (v.mapAnswerKeys !== undefined) set['visibility.mapAnswerKeys'] = lit(allowed);
      else if (prunedOut.length) {
        set['visibility.mapAnswerKeys'] = {
          $filter: { input: { $ifNull: ['$visibility.mapAnswerKeys', []] }, cond: { $not: [{ $in: ['$$this', lit(prunedOut)] }] } },
        };
      }
    }
    set.editVersion = { $add: [{ $ifNull: ['$editVersion', 0] }, 1] };
    const visibleLit = lit([...visibleSet]);
    const droppedLit = lit([...dropped]);
    if (prune) {
      // The map goes off only on a real map-off: an edit that leaves it off while a Refresh turns it
      // on keeps that Refresh's map (STATE-2).
      const pruneInputs = (path, cond) => ({
        $mergeObjects: [
          `$${path}`,
          {
            ...(mapOff ? { showMap: false } : {}),
            mapKeys: { $filter: { input: { $ifNull: [`$${path}.mapKeys`, []] }, cond } },
          },
        ],
      });
      // Only an object is pruned: a report from before snapshots has none (its settings stand in).
      set.snapshotInputs = {
        $cond: [{ $eq: [{ $type: '$snapshotInputs' }, 'object'] }, pruneInputs('snapshotInputs', { $in: ['$$this', lit(allowed)] }), '$snapshotInputs'],
      };
      set.build = {
        $cond: [
          { $eq: [{ $type: '$build.inputs' }, 'object'] },
          {
            $mergeObjects: [
              '$build',
              { inputs: pruneInputs('build.inputs', { $and: [{ $in: ['$$this', visibleLit] }, { $not: [{ $in: ['$$this', droppedLit] }] }] }) },
            ],
          },
          '$build',
        ],
      };
    }
    const now = new Date();
    if (published) {
      set.contentEditedAt = lit(now);
      set.contentEditedBy = lit(req.user._id);
    }
    // The status this request read, and the version the builder sent (C8), pinned in one filter.
    const filter = { _id: report._id, organizationId: orgId, status: report.status };
    if (ifVersion !== undefined) filter.editVersion = editVersionIs(ifVersion);
    const pre = await ClientReport.findOneAndUpdate(filter, [{ $set: set }], { returnDocument: 'before' }).lean();
    if (!pre) {
      // Nothing written — and a switch to areas this request claimed never starts: parked as
      // "Couldn't start", the way an enqueue that fails parks it, so Retry stays on offer.
      if (remapBuild) {
        await ClientReport.updateOne(
          { _id: report._id, 'build.jobId': remapBuild.jobId, 'build.status': 'queued' },
          { $set: { 'build.status': 'failed', 'build.error': { code: 'ENQUEUE_FAILED', message: "Couldn't start — try again." } } }
        );
      }
      const current = await ClientReport.findOne({ _id: report._id, organizationId: orgId }).lean();
      if (!current) return res.status(404).json({ error: 'Report not found', code: 'REPORT_NOT_FOUND' });
      if (current.status !== report.status || ifVersion === undefined) return res.status(409).json(STATUS_CHANGED(current));
      return res.status(409).json(CHANGED_ELSEWHERE(current));
    }
    if (remapBuild) await enqueueBuild({ reportId: report._id, jobId: remapBuild.jobId });

    // The stored rows, every snapshot of this report: the live one keeps exactly `allowed`; a build's
    // (live, ready, or a leftover) loses what the drop list names, so a pending Refresh's additions
    // stay in its rows.
    if (mapOff) {
      await Promise.all([ClientReportMapPoint.deleteMany({ clientReportId: report._id }), ClientReportAreaCell.deleteMany({ clientReportId: report._id })]);
    } else if (prune) {
      const liveSnapshot = report.snapshotId ?? null;
      const pullLive = { $pull: { answers: { questionKey: { $nin: allowed } } } };
      const pullBuilds = { $pull: { answers: { $or: [{ questionKey: { $nin: [...visibleSet] } }, { questionKey: { $in: [...dropped] } }] } } };
      await Promise.all(
        [ClientReportMapPoint, ClientReportAreaCell].flatMap((M) => [
          M.updateMany({ clientReportId: report._id, snapshotId: liveSnapshot }, pullLive),
          M.updateMany({ clientReportId: report._id, snapshotId: { $ne: liveSnapshot } }, pullBuilds),
        ])
      );
    }
    if (published) {
      // The earlier text, from the write's own pre-image, so overlapping edits keep one copy each.
      await writeReportHistory(pre, REPORT_FIELDS.edited, { by: req.user._id, fromValue: earlierTextOf(pre, data) }).catch(() => {});
    }
    const fresh = await ClientReport.findById(report._id).lean();
    res.json({ report: fresh, build: buildView(fresh.build) });
  } catch (err) {
    fail(res, next)(err);
  }
});

// Build a draft's numbers again (202 with the claimed build). Its on-screen settings become the
// build's target, frozen at the claim.
router.post('/:id/recompute', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    if (report.status !== 'draft') {
      return res.status(400).json({ error: 'Only a draft is recomputed. Use Refresh numbers on a published report.', code: 'NOT_DRAFT' });
    }
    const orgId = activeOrgId(req);
    const campaign = await loadCampaignInOrg(orgId, report.campaignId);
    if (!campaign) return res.status(400).json({ error: 'Campaign no longer exists' });
    if (isTeamScope(scopeOf(report).kind) && !(await teamsReady(orgId))) return res.status(400).json(TEAMS_NOT_READY);
    const template = await resolveTemplate(orgId, campaign);
    const inputs = inputsFromSettings({ visibility: report.visibility, template, coordinatorIds: await currentCrewKeysFor(report) });
    const build = await startBuild({ report, kind: 'recompute', inputs, by: req.user._id, expectStatus: 'draft' });
    res.status(202).json({ build: buildView(build) });
  } catch (err) {
    fail(res, next)(err);
  }
});

// Refresh numbers on a published report (§F3): rebuild from today's records, show what moved, and
// change nothing until Apply. Its base is the report's current settings; `map` carries what it adds
// (the map on, map questions — choice, visible, with their parents — exact doors or areas, a size).
// A team report rebuilds with the crews it was built with, so a report already sent never quietly
// starts covering another crew.
router.post('/:id/refresh', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    if (report.status !== 'published') {
      return res.status(400).json({ error: 'Only a published report is refreshed. Recompute a draft instead.', code: 'NOT_PUBLISHED' });
    }
    const orgId = activeOrgId(req);
    const data = refreshSchema.parse(req.body || {});
    const add = data.map || {};
    const campaign = await loadCampaignInOrg(orgId, report.campaignId);
    if (!campaign) return res.status(400).json({ error: 'Campaign no longer exists' });
    const template = await resolveTemplate(orgId, campaign);
    // A report from before snapshots: every survey its answers can have come from (LEGACY-1).
    const { inputs: live } = await mapContextFor(report);
    const visible = new Set(report.visibility?.visibleQuestionKeys || []);
    const choice = new Set(choiceKeysOf(template));
    const rejected = (add.mapKeys || []).filter((k) => !choice.has(k) || !visible.has(k));
    if (rejected.length) {
      return res.status(400).json({ error: 'Only a choice question whose chart is shown can go on the map.', code: 'MAP_KEYS_NOT_ALLOWED', rejected });
    }
    // The map questions it builds are the FINAL list (VERIFY-2): what the live snapshot serves plus
    // the request's additions — or, turning the map on, exactly the request's keys (the dialog offers
    // the picks the report kept while its map was off, ticked, and sends what is still ticked; they
    // used to go on the client's map unseen). A refresh that leaves the map off keeps the picks for
    // later: it builds no map, and Apply leaves them as they are.
    const mapAnswerKeys = mapServed(report, live)
      ? [...new Set([...servedMapKeys(report, live), ...(add.mapKeys || [])])]
      : add.showMap === true
        ? [...new Set(add.mapKeys || [])]
        : report.visibility?.mapAnswerKeys || [];
    const visibility = {
      ...(report.visibility || {}),
      showMap: add.showMap === true ? true : report.visibility?.showMap !== false,
      mapAnswerKeys,
      mapMode: add.mapMode ?? live.mapMode,
      areaSize: add.areaSize ?? live.areaSize,
    };
    const inputs = inputsFromSettings({ visibility, template, coordinatorIds: live.coordinatorIds });
    const missing = (add.mapKeys || []).filter((k) => !inputs.mapKeys.includes(k));
    if (missing.length) {
      const deps = depsMap(inputs.questionDeps);
      return res.status(400).json({
        error: 'A follow-up question can only go on the map with every question it depends on.',
        code: 'MAP_KEYS_NEED_PARENTS',
        keys: missing,
        parents: missing.map((k) => ({ key: k, dependsOn: [...(deps.get(k) || [])] })),
      });
    }
    const build = await startBuild({ report, kind: 'refresh', inputs, by: req.user._id, expectStatus: 'published' });
    res.status(202).json({ build: buildView(build) });
  } catch (err) {
    fail(res, next)(err);
  }
});

// The build's state for the builder's progress bar: status, progress, why it waits, its error, and
// its place in the queue ("Queued (2 ahead)").
router.get('/:id/build', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    const [live, queuePosition] = await Promise.all([
      buildIsLive(report),
      report.build?.status === 'queued' ? queuePositionOf(report.build.jobId) : null,
    ]);
    res.json({ build: { ...buildView(report.build, { live }), queuePosition } });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/refresh/apply', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    const sid = req.body?.snapshotId;
    if (sid != null && !mongoose.isValidObjectId(sid)) return res.status(400).json({ error: 'Invalid snapshotId' });
    res.json({ report: await applyRefresh({ report, by: req.user._id, reviewedSnapshotId: sid ?? null }) });
  } catch (err) {
    fail(res, next)(err);
  }
});

router.post('/:id/refresh/discard', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    const sid = req.body?.snapshotId;
    if (sid != null && !mongoose.isValidObjectId(sid)) return res.status(400).json({ error: 'Invalid snapshotId' });
    res.json({ report: await discardRefresh({ report, by: req.user._id, reviewedSnapshotId: sid ?? null }) });
  } catch (err) {
    fail(res, next)(err);
  }
});

// Cancel a queued, waiting or running build — its rows go, and every write it still makes misses.
router.post('/:id/build/cancel', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    const pre = await cancelBuild({ reportId: report._id, organizationId: report.organizationId, by: req.user._id });
    if (!pre) return res.status(409).json({ error: 'There is no build to cancel.', code: 'NOTHING_TO_CANCEL' });
    res.json({ report: await ClientReport.findById(report._id).lean() });
  } catch (err) {
    fail(res, next)(err);
  }
});

// Publish = freeze what was PREVIEWED (§F3). The builder sends the snapshotId and editVersion it
// previewed; without them it freezes what is live now. Never a build.
router.post('/:id/publish', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    const { snapshotId = null, editVersion = null } = req.body || {};
    if (snapshotId != null && !mongoose.isValidObjectId(snapshotId)) return res.status(400).json({ error: 'Invalid snapshotId' });
    if (editVersion != null && !Number.isInteger(editVersion)) return res.status(400).json({ error: 'Invalid editVersion' });
    const campaign = await loadCampaignInOrg(activeOrgId(req), report.campaignId);
    if (!campaign) return res.status(400).json({ error: 'Campaign no longer exists' });
    const template = await resolveTemplate(activeOrgId(req), campaign);
    // Soft gate audit trail: how many unreviewed mock-GPS flags sat inside this report's scope and
    // cumulative window at the moment of freeze. Publish is never blocked by them — a mock flag can
    // be a false alarm (QA phone, dev mode) — but the number is recorded.
    const openMockFlags = await scopedOpenMockFlags(report);
    const published = await publishReport({
      report,
      by: req.user._id,
      previewedSnapshotId: snapshotId,
      previewedEditVersion: editVersion,
      openMockFlags,
      template,
    });
    res.json({ report: published });
  } catch (err) {
    fail(res, next)(err);
  }
});

const takeDown = async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    res.json({ report: await takeDownReport({ report, by: req.user._id }) });
  } catch (err) {
    fail(res, next)(err);
  }
};
// Take down: hidden from the client, kept exactly as it was. Never back to draft.
router.post('/:id/take-down', takeDown);
// The old Unpublish, kept as an alias so nothing calling it 404s: it takes the report down. It no
// longer returns it to draft — there is no path from published back to draft (§F3).
router.post('/:id/unpublish', takeDown);

router.post('/:id/put-back-up', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    res.json({ report: await putBackUpReport({ report, by: req.user._id }) });
  } catch (err) {
    fail(res, next)(err);
  }
});

// Preview EXACTLY what the client will see — through the public shapers. POST carries the builder's
// ON-SCREEN state as an overlay on the saved report (C5: preview used to show the last save); GET
// previews what is saved. The map follows the live snapshot, never the overlay.
const previewOverlaySchema = updateSchema.partial();
const preview = async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    const overlay = req.method === 'POST' ? previewOverlaySchema.parse(req.body || {}) : {};
    const merged = {
      ...report,
      ...(overlay.title !== undefined ? { title: overlay.title } : {}),
      ...(overlay.observations !== undefined ? { observations: overlay.observations } : {}),
      ...(overlay.supportQuestionKey !== undefined ? { supportQuestionKey: overlay.supportQuestionKey } : {}),
      visibility: { ...(report.visibility || {}), ...(overlay.visibility || {}) },
    };
    const [{ inputs }, earlierTotals, nav, labels] = await Promise.all([
      mapContextFor(report),
      earlierTotalsLine(report),
      seriesNav(report),
      currentSeriesLabels([report]),
    ]);
    // `provenance` rides the INTERNAL response only. shapeReportForClient/shapeWindow are strict
    // whitelists, so it structurally cannot reach the published page.
    res.json({
      report: shapeReportForClient(merged, {
        inputs,
        earlierTotals,
        nav,
        seriesLabel: report.seriesId ? labels.get(String(report.seriesId)) : null,
        // The preview's map reads the SAVED report (previewMap below), so its version does too.
        mapSource: report,
      }),
      survey: mapFilterSurvey(merged, inputs),
      provenance: {
        cumulative: report.stats?.cumulative?.provenance || null,
        period: report.stats?.period?.provenance || null,
      },
    });
  } catch (err) {
    fail(res, next)(err);
  }
};
router.get('/:id/preview', preview);
router.post('/:id/preview', preview);

// The map previews read the LIVE snapshot, exactly as the client's routes do (clientReportMap.js) —
// never a map built on the fly.
const previewMap = (handler) => async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    res.json(await handler(report, req));
  } catch (err) {
    fail(res, next)(err);
  }
};
// The pins and areas payloads go out through the same cache and gzip as the client's (PUBUX-4).
const previewPayload = (mode) => async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    const mctx = await checkMapRequest(report, { snapshotKey: req.query.snapshotKey ?? null, mode });
    await sendMapPayload(req, res, report, mctx, mode);
  } catch (err) {
    fail(res, next)(err);
  }
};
router.get('/:id/preview/map', previewPayload('pins'));
router.get(
  '/:id/preview/map/doors',
  previewMap(async (report, req) => {
    if (!req.query.snapshotKey) throw new MapError(400, 'SNAPSHOT_KEY_REQUIRED', 'snapshotKey is required');
    const mctx = await checkMapRequest(report, { snapshotKey: String(req.query.snapshotKey), mode: 'pins' });
    return doorsPayload(report, mctx, parseRows(req.query.rows));
  })
);
router.get('/:id/preview/areas', previewPayload('area'));

// The period after `report`'s (§F10): the same number of civil days, starting the day after its
// end — a source that is exactly one calendar month rolls by month.
const MONTH_END = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const nextPeriodOf = (report) => {
  const start = addDays(report.weekEnd, 1);
  const [sy, sm, sd] = report.weekStart.split('-').map(Number);
  const [ey, em, ed] = report.weekEnd.split('-').map(Number);
  const wholeMonth = sd === 1 && sy === ey && sm === em && ed === MONTH_END(ey, em);
  if (wholeMonth) {
    const [ny, nm] = start.split('-').map(Number);
    return { weekStart: start, weekEnd: `${start.slice(0, 8)}${String(MONTH_END(ny, nm)).padStart(2, '0')}` };
  }
  return { weekStart: start, weekEnd: addDays(start, daysBetween(report.weekStart, report.weekEnd)) };
};

// Next report, in one click (§F10). Idempotent under a double click: the draft is inserted FIRST
// with a pre-generated _id, then the source is claimed with a CAS on nextReportId; the loser deletes
// its own draft and returns the winner.
router.post('/:id/next', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const source = await loadReportInOrg(req, res);
    if (!source) return;
    const orgId = activeOrgId(req);
    if (source.nextReportId) {
      const existing = await ClientReport.findOne({ _id: source.nextReportId, organizationId: orgId }).lean();
      if (existing) return res.json({ report: existing, build: buildView(existing.build), existing: true });
    }
    const campaign = await loadCampaignInOrg(orgId, source.campaignId);
    if (!campaign) return res.status(400).json({ error: 'Campaign no longer exists' });

    // The source's series, re-validated: ensured for a report from before series, refused if ended.
    let series = source.seriesId ? await ClientReportSeries.findById(source.seriesId).lean() : null;
    if (!series) {
      series = await ensureSeries({
        organizationId: orgId,
        campaignId: campaign._id,
        kind: source.effortId ? 'walk_list' : 'campaign',
        effortId: source.effortId || null,
        effortName: source.effortName || null,
        createdBy: req.user._id,
      });
    }
    const team = await teamOf(series);
    if (await seriesEnded(series, team)) {
      return res.status(409).json({ error: 'That team or series has ended. Continue it first.', code: 'SERIES_ENDED', seriesId: String(team?._id || series._id) });
    }
    if (team && !(await teamsReady(orgId))) return res.status(400).json(TEAMS_NOT_READY);

    const period = nextPeriodOf(source);
    const tz = source.timeZone || campaign.timeZone || 'America/New_York';
    const range = zonedDayRange(period.weekStart, period.weekEnd, tz);
    if (!range.$gte || range.$gte.getTime() !== new Date(source.rangeEndUtc).getTime()) {
      return res.status(409).json({ error: 'The next period does not start where this one ends.', code: 'NEXT_PERIOD_MISMATCH' });
    }
    // Offered only on the latest report of each series.
    const later = await ClientReport.exists({
      organizationId: orgId,
      campaignId: campaign._id,
      seriesId: series._id,
      _id: { $ne: source._id },
      rangeStartUtc: { $gte: source.rangeEndUtc },
    });
    if (later) return res.status(409).json({ error: 'A later report of this series already exists.', code: 'NOT_LATEST_REPORT' });

    const template = await resolveTemplate(orgId, campaign);
    const sv = source.visibility || {};
    const observations = (source.observations || []).map((s) => ({ heading: s.heading, body: s.body ?? '' }));
    const label = await seriesLabelOf(series, { team });
    const _id = new mongoose.Types.ObjectId();
    const staleNext = source.nextReportId && !(await ClientReport.exists({ _id: source.nextReportId })) ? source.nextReportId : null;
    const { report, build } = await insertDraftWithBuild({
      _id,
      template,
      coordinatorIds: crewKeysOf(team),
      by: req.user._id,
      doc: {
        organizationId: orgId,
        campaignId: campaign._id,
        campaignType: campaign.type,
        title: '',
        effortId: source.effortId || null,
        effortName: source.effortName || null,
        seriesId: series._id,
        scope: { kind: series.kind, label: label || scopeOf(source).label || CAMPAIGN_LABEL },
        weekStart: period.weekStart,
        weekEnd: period.weekEnd,
        timeZone: tz,
        rangeStartUtc: range.$gte,
        rangeEndUtc: range.$lt,
        status: 'draft',
        supportQuestionKey: source.supportQuestionKey || null,
        observations,
        copiedFrom: observations.length ? { reportId: source._id, weekStart: source.weekStart, weekEnd: source.weekEnd } : null,
        copiedNotesReviewed: observations.length ? false : null,
        visibility: {
          visibleQuestionKeys: sv.visibleQuestionKeys || [],
          mapAnswerKeys: sv.mapAnswerKeys || [],
          showMap: sv.showMap !== false,
          mapMode: sv.mapMode === 'area' ? 'area' : 'pins',
          areaSize: sv.areaSize === 'large' ? 'large' : 'small',
          visibleTags: sv.visibleTags || [],
          showGoal: !!sv.showGoal,
        },
        createdBy: req.user._id,
      },
    });
    const claimed = await ClientReport.updateOne(
      { _id: source._id, organizationId: orgId, $or: [{ nextReportId: null }, ...(staleNext ? [{ nextReportId: staleNext }] : [])] },
      { $set: { nextReportId: _id } }
    );
    if (!claimed.modifiedCount) {
      // Another click won: drop ours, return theirs.
      await ClientReport.deleteOne({ _id });
      const winner = await ClientReport.findById(source._id, { nextReportId: 1 }).lean();
      const theirs = winner?.nextReportId ? await ClientReport.findById(winner.nextReportId).lean() : null;
      if (!theirs) return res.status(409).json({ error: 'Try again.', code: 'NEXT_RACE' });
      return res.json({ report: theirs, build: buildView(theirs.build), existing: true });
    }
    await enqueueBuild({ reportId: _id, jobId: build.jobId });
    await writeReportHistory(report, REPORT_FIELDS.created, { by: req.user._id }).catch(() => {});
    const today = zonedDayStr(new Date(), tz);
    const fresh = await ClientReport.findById(_id).lean();
    res.status(201).json({
      report: fresh,
      build: buildView(fresh.build),
      warnings: period.weekStart > today ? ['STARTS_AFTER_TODAY'] : [],
    });
  } catch (err) {
    fail(res, next)(err);
  }
});

// Delete a report: the report, any nextReportId pointing at it, then every map row with its id. A
// live build's heartbeat misses and it stops; the nightly sweep catches anything left. An admin may
// erase its earlier text from History in the same act (the confirm offers it).
router.delete('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const report = await loadReportInOrg(req, res);
    if (!report) return;
    const orgId = activeOrgId(req);
    const pre = await ClientReport.findOneAndDelete({ _id: report._id, organizationId: orgId }).lean();
    if (!pre) return res.status(404).json({ error: 'Report not found', code: 'REPORT_NOT_FOUND' });
    await ClientReport.updateMany({ organizationId: orgId, nextReportId: pre._id }, { $set: { nextReportId: null } });
    await Promise.all([ClientReportMapPoint.deleteMany({ clientReportId: pre._id }), ClientReportAreaCell.deleteMany({ clientReportId: pre._id })]);
    await writeReportHistory(pre, REPORT_FIELDS.deleted, { by: req.user._id }).catch(() => {});
    const wantsErase = req.body?.eraseHistory === true || req.query.eraseHistory === '1';
    let erased = null;
    if (wantsErase && isOrgAdmin(req)) {
      erased = await eraseHistory({ campaignId: pre.campaignId, organizationId: orgId, clientReportId: String(pre._id), by: req.user._id });
    }
    res.json({ ok: true, ...(erased ? { erased: erased.rows } : {}) });
  } catch (err) {
    fail(res, next)(err);
  }
});

export default router;
