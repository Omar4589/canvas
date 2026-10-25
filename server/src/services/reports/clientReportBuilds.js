import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { ClientReport } from '../../models/ClientReport.js';
import { ClientReportMapPoint } from '../../models/ClientReportMapPoint.js';
import { ClientReportAreaCell } from '../../models/ClientReportAreaCell.js';
import { ClientReportSeries } from '../../models/ClientReportSeries.js';
import { Campaign } from '../../models/Campaign.js';
import { SurveyTemplate } from '../../models/SurveyTemplate.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { AnswerEditRun } from '../../models/AnswerEditRun.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { ReclassifyRun } from '../../models/ReclassifyRun.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { CoordinatorChange } from '../../models/CoordinatorChange.js';
import { getQueue, QUEUE_NAMES, queueOp } from '../../queues/index.js';
import { otherChangeRunning, answerEditBusy } from '../canvass/answerEditRuns.js';
import { deletionRequested, sweptAfter } from '../platform/lateWriteSweep.js';
import { KNOCK_ACTIONS, NOT_BULK, withTeam } from './aggregations.js';
import { buildReportSnapshot, remapSnapshot, teamClauseFor } from './buildReportSnapshot.js';
import { teamOf, teamChangedFor, crewKeysOf } from './clientReportSeries.js';
import { writeReportHistory, REPORT_FIELDS } from './clientReportHistory.js';
import {
  buildMapKeysFor,
  questionDepsOf,
  liveInputs,
  isTeamScope,
  scopeOf,
  numbersCutOff,
  closeUnderDeps,
  depsMap,
} from './reportVisibility.js';

// The life of a client-report build (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F2 and §F3, as
// amended by §O1 and §O2). Builds run on the worker (client-report-queue), never in a web request:
// Create, Next and Recompute claim a `recompute` on a draft; Refresh numbers claims a `refresh` on a
// published report, whose result waits for the operator's Apply; Switch to areas claims a `remap`.
//
// The rules that keep it honest:
//   · ONE live build per report, claimed by a compare-and-swap on the report's own `build` object.
//     Every worker write matches on build.jobId AND build.snapshotId, and anything that ends a build
//     (cancel, take down, publish, a reset) REPLACES the whole object — so a cancelled build's
//     heartbeat, commit and failure writes all miss.
//   · Every attempt writes under its OWN snapshot (step 1), so a redelivery never mixes rows with a
//     dead attempt's; nothing ever writes over the live snapshot.
//   · build.inputs is the build's TARGET: what it produces. A removal while it runs prunes it (the
//     one removal path, routes PATCH), and the commit re-reads it inside its own write and pins it in
//     its CAS — so a removal that lands during a build is never undone (round 4's blocker).

const { ObjectId } = mongoose.Types;

export const LIVE_BUILD_STATUSES = ['queued', 'waiting', 'running'];
const LIVE_QUEUE_STATES = ['waiting', 'delayed', 'active', 'prioritized', 'waiting-children'];
const QUEUED_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const RUNNING_STALE_MS = 5 * 60 * 1000;
const SKEW_MS = 60 * 1000;
const waitRetryMs = () => Number(process.env.CLIENT_REPORT_WAIT_RETRY_MS) || 30 * 1000;
const blockedAfterMs = () => Number(process.env.CLIENT_REPORT_BLOCKED_AFTER_MS) || 30 * 60 * 1000;
const beatMs = () => Number(process.env.CLIENT_REPORT_BEAT_MS) || 30 * 1000;
const queueTimeoutMs = () => Number(process.env.CLIENT_REPORT_QUEUE_TIMEOUT_MS) || Number(process.env.QUEUE_ENQUEUE_TIMEOUT_MS) || 5000;

/** An opaque random key for a snapshot — the only version the client ever sees (§F0). */
export const newSnapshotKey = () => crypto.randomBytes(12).toString('base64url');

const isObjectId = (v) => v instanceof ObjectId;

/** An error the routes turn into a JSON response (status + code). */
export class BuildError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// ── Liveness ──────────────────────────────────────────────────────────────────────────────────

/** The queue's word on a job ('unknown' for a lost one), or null when the queue can't be asked. */
export const jobStateOf = async (jobId) => {
  if (!jobId) return null;
  try {
    return await queueOp(getQueue(QUEUE_NAMES.CLIENT_REPORT).getJobState(String(jobId)), queueTimeoutMs());
  } catch {
    return null;
  }
};

/**
 * Is a build live? ONE helper, used by every gate (§F2). Queued and waiting are live while the
 * queue holds the job (waiting, delayed or active) and the claim is under two hours old; running
 * is live while its heartbeat is under five minutes old. Anything else is not live, and the next
 * Publish, Take down or claim resets it in its own CAS.
 */
export const buildIsLive = async (report, { now = Date.now(), jobState = jobStateOf } = {}) => {
  const b = report?.build;
  if (!b?.status) return false;
  if (b.status === 'running') return !!b.beatAt && now - new Date(b.beatAt).getTime() < RUNNING_STALE_MS;
  if (b.status === 'queued' || b.status === 'waiting') {
    if (!b.startedAt || now - new Date(b.startedAt).getTime() >= QUEUED_MAX_AGE_MS) return false;
    return LIVE_QUEUE_STATES.includes(await jobState(b.jobId));
  }
  return false;
};

// ── Rows ──────────────────────────────────────────────────────────────────────────────────────

/** Delete exactly one snapshot's rows of one report ({ snapshotId: null } = the legacy rows). */
export const deleteSnapshotRows = async (reportId, snapshotId) => {
  const filter = { clientReportId: reportId, snapshotId: snapshotId ?? null };
  await Promise.all([ClientReportMapPoint.deleteMany(filter), ClientReportAreaCell.deleteMany(filter)]);
};

/**
 * The ONE discard helper (§O2): Cancel, Take down, map-off, Publish's replacement of `build`, the
 * dead-build reset and Discard all call it with the PRE-IMAGE of their write. It deletes the build's
 * rows only when the pre-image's build.snapshotId is an ObjectId different from the pre-image's live
 * snapshotId; otherwise nothing, and the sweep handles leftovers. So a legacy report's live rows
 * (snapshotId null) can never be deleted by a cancel.
 */
export const discardBuildRows = async (pre) => {
  const sid = pre?.build?.snapshotId;
  if (!isObjectId(sid)) return false;
  if (pre.snapshotId && String(pre.snapshotId) === String(sid)) return false;
  await deleteSnapshotRows(pre._id, sid);
  return true;
};

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────

/** The campaign's survey (lean), or null. */
export const templateFor = async (campaign) =>
  campaign?.surveyTemplateId
    ? SurveyTemplate.findOne({ _id: campaign.surveyTemplateId, organizationId: campaign.organizationId }).lean()
    : null;

const sortIds = (ids) => [...new Set((ids || []).map(String))].sort().map((id) => new ObjectId(id));

/**
 * What a build of these settings produces — build.inputs, frozen at claim: { showMap, mapMode,
 * areaSize, mapKeys, questionDeps, coordinatorIds }. The map keys are closed under the dependencies
 * the build freezes, so a follow-up never reaches the map without its parents.
 */
export const inputsFromSettings = ({ visibility, template, coordinatorIds = [] }) => {
  const questionDeps = questionDepsOf(template);
  return {
    showMap: visibility?.showMap !== false,
    mapMode: visibility?.mapMode === 'area' ? 'area' : 'pins',
    areaSize: visibility?.areaSize === 'large' ? 'large' : 'small',
    mapKeys: buildMapKeysFor(visibility, template, questionDeps),
    questionDeps,
    coordinatorIds: sortIds(coordinatorIds),
  };
};

/** The crews a team report covers now — its team's crewKeys (current ∪ past) — or [] for any other. */
export const currentCrewKeysFor = async (report) => {
  if (!report?.seriesId || !isTeamScope(scopeOf(report).kind)) return [];
  const series = await ClientReportSeries.findById(report.seriesId).lean();
  return crewKeysOf(await teamOf(series));
};

// ── Claim, enqueue, cancel ────────────────────────────────────────────────────────────────────

const busyError = (build) =>
  new BuildError(
    409,
    'REPORT_BUSY',
    build?.status === 'waiting'
      ? 'This report is waiting for another change on the campaign to finish — wait for it, or cancel it.'
      : build?.status === 'running'
        ? 'This report is building right now — wait for it to finish, or cancel it.'
        : 'This report has a build queued — wait for it, or cancel it.',
    { build: buildView(build) }
  );

/**
 * Claim a build (web, one request). Refused with 409 REVIEW_PENDING over a ready result — apply or
 * discard it first, never a silent discard (§O1) — and 409 REPORT_BUSY over a live build. A dead
 * build is replaced in the claim's own CAS, which pins the job id observed dead, and its rows go
 * through the discard helper. Returns the claimed build.
 */
export const claimBuild = async ({ report, kind, inputs, by, expectStatus }) => {
  const observed = report.build || null;
  if (observed?.status === 'ready') {
    throw new BuildError(409, 'REVIEW_PENDING', 'New numbers are waiting for your review — apply or discard them first.', {
      build: buildView(observed),
    });
  }
  if (await buildIsLive(report)) throw busyError(observed);
  const now = new Date();
  const build = {
    kind,
    status: 'queued',
    jobId: new ObjectId().toHexString(),
    inputs,
    startedAt: now,
    beatAt: now,
    rebuilds: 0,
    progress: 0,
    requestedBy: by || null,
  };
  const pre = await ClientReport.findOneAndUpdate(
    {
      _id: report._id,
      organizationId: report.organizationId,
      status: expectStatus,
      'build.jobId': observed?.jobId ?? null,
      'build.status': { $ne: 'ready' },
    },
    { $set: { build } },
    { returnDocument: 'before' }
  ).lean();
  if (!pre) {
    const now2 = await ClientReport.findById(report._id, { build: 1, status: 1 }).lean();
    if (now2 && now2.status !== expectStatus) {
      throw new BuildError(409, 'STATUS_CHANGED', 'This report was just published or changed — reload it.');
    }
    if (now2?.build?.status === 'ready') {
      throw new BuildError(409, 'REVIEW_PENDING', 'New numbers are waiting for your review — apply or discard them first.', {
        build: buildView(now2.build),
      });
    }
    throw busyError(now2?.build);
  }
  await discardBuildRows(pre);
  return build;
};

/**
 * Enqueue a claimed build. If the queue can't take it, the claim is parked as failed ("Couldn't
 * start — try again") in a CAS on its own job id — the parkUnqueued pattern — so the report never
 * reads "Queued" for a job nobody holds. Returns true when enqueued.
 */
export const enqueueBuild = async ({ reportId, jobId }) => {
  try {
    await queueOp(
      getQueue(QUEUE_NAMES.CLIENT_REPORT).add(
        'build',
        { reportId: String(reportId) },
        // attempts: 1 — a failure is marked on the report and the operator presses Retry; a delayed
        // wait (step 2) re-runs the same job without counting as an attempt.
        { jobId: String(jobId), attempts: 1, removeOnComplete: { age: 24 * 3600, count: 500 }, removeOnFail: { age: 7 * 24 * 3600 } }
      ),
      queueTimeoutMs()
    );
    return true;
  } catch {
    await ClientReport.updateOne(
      { _id: reportId, 'build.jobId': String(jobId), 'build.status': 'queued' },
      { $set: { 'build.status': 'failed', 'build.error': { code: 'ENQUEUE_FAILED', message: "Couldn't start — try again." } } }
    );
    return false;
  }
};

/** Claim + enqueue. Returns the report's build as it now stands. */
export const startBuild = async (args) => {
  const build = await claimBuild(args);
  await enqueueBuild({ reportId: args.report._id, jobId: build.jobId });
  const fresh = await ClientReport.findById(args.report._id, { build: 1 }).lean();
  return fresh?.build || build;
};

/** Best-effort: take a cancelled job out of the queue (one already running stops on its next write). */
const removeQueuedJob = async (jobId) => {
  if (!jobId) return;
  try {
    const job = await queueOp(getQueue(QUEUE_NAMES.CLIENT_REPORT).getJob(String(jobId)), queueTimeoutMs());
    if (job) await queueOp(job.remove(), queueTimeoutMs());
  } catch {
    /* active or gone — its writes miss either way */
  }
};

/**
 * Cancel a queued, waiting or running build. Always REPLACES the whole object, then hands the
 * pre-image to the discard helper. Returns the pre-image, or null when nothing was live to cancel.
 */
export const cancelBuild = async ({ reportId, organizationId, by }) => {
  const pre = await ClientReport.findOneAndUpdate(
    { _id: reportId, organizationId, 'build.status': { $in: LIVE_BUILD_STATUSES } },
    { $set: { build: { status: 'idle', cancelledAt: new Date(), cancelledBy: by || null } } },
    { returnDocument: 'before' }
  ).lean();
  if (!pre) return null;
  await discardBuildRows(pre);
  await removeQueuedJob(pre.build?.jobId);
  return pre;
};

// ── The admin's view of a build ───────────────────────────────────────────────────────────────

/** A build as the builder shows it — never its rows, inputs' internals or worker bookkeeping. */
export const buildView = (build, { live = null } = {}) => {
  if (!build?.status) return { status: 'idle' };
  const stalled = build.status === 'running' && (!build.beatAt || Date.now() - new Date(build.beatAt).getTime() >= RUNNING_STALE_MS);
  return {
    kind: build.kind || null,
    status: stalled ? 'stalled' : build.status,
    live,
    progress: build.progress ?? null,
    waitingFor: build.status === 'waiting' ? build.waitingFor || null : null,
    error: build.status === 'failed' ? build.error || { code: 'FAILED', message: 'The build failed — try again.' } : null,
    startedAt: build.startedAt || null,
    finishedAt: build.finishedAt || build.readyAt || null,
    cancelledAt: build.cancelledAt || null,
    snapshotId: build.status === 'ready' && build.snapshotId ? String(build.snapshotId) : null,
    result:
      build.status === 'ready' && build.result
        ? {
            totals: {
              cumulative: build.result.stats?.cumulative?.totals || {},
              period: build.result.stats?.period?.totals || {},
            },
            mapPointCount: build.result.mapPointCount || 0,
            areaCellCount: build.result.areaCellCount || 0,
            statsComputedAt: build.result.statsComputedAt || null,
            arrivedDuringBuild: build.result.arrivedDuringBuild || 0,
            mapShown: !!build.inputs?.showMap,
            mapMode: build.inputs?.mapMode || 'pins',
            areaSize: build.inputs?.areaSize === 'large' ? 'large' : 'small',
            // What the map will carry once applied, so the review can name it (VERIFY-2).
            mapKeys: build.inputs?.showMap ? (build.inputs.mapKeys || []).map(String) : [],
          }
        : null,
    // Single-choice map questions that show no answers by area — a ready refresh's, or a switch to
    // areas that just finished (WALK-7): [{ key, label }].
    areaWithoutAnswers:
      build.status === 'ready'
        ? build.result?.areaWithoutAnswers || []
        : build.kind === 'remap' && build.status === 'idle'
          ? build.areaWithoutAnswers || []
          : [],
  };
};

/** How many builds are ahead of this one in the queue ("Queued (2 ahead)"), or null. */
export const queuePositionOf = async (jobId) => {
  if (!jobId) return null;
  try {
    const jobs = await queueOp(getQueue(QUEUE_NAMES.CLIENT_REPORT).getJobs(['waiting', 'prioritized'], 0, 500, true), queueTimeoutMs());
    const i = jobs.findIndex((j) => String(j?.id) === String(jobId));
    return i === -1 ? null : i;
  } catch {
    return null;
  }
};

// ── The worker ────────────────────────────────────────────────────────────────────────────────

class StopBuild extends Error {}

const failBuild = async ({ reportId, jobId, snapshotId, error }) => {
  const r = await ClientReport.updateOne(
    {
      _id: reportId,
      'build.jobId': jobId,
      'build.status': { $in: LIVE_BUILD_STATUSES },
      ...(snapshotId ? { 'build.snapshotId': snapshotId } : {}),
    },
    { $set: { 'build.status': 'failed', 'build.error': error, 'build.snapshotId': null, 'build.finishedAt': new Date() } }
  );
  if (snapshotId) await deleteSnapshotRowsIfNotLive(reportId, snapshotId);
  return r.matchedCount > 0;
};

// Delete a snapshot's rows only after re-reading that it isn't the report's live one (§F2 step 9).
const deleteSnapshotRowsIfNotLive = async (reportId, snapshotId) => {
  const live = await ClientReport.findById(reportId, { snapshotId: 1 }).lean();
  if (live?.snapshotId && String(live.snapshotId) === String(snapshotId)) return;
  await deleteSnapshotRows(reportId, snapshotId);
};

// What is holding the campaign, in a report's words ("Waiting for the answer edit on this campaign
// to finish"). otherChangeRunning is the one check; its sentence is written for Door Outcomes, so
// the kind is read off it here.
const waitingWords = async (campaignId, blocked) => {
  if (await answerEditBusy(campaignId)) return { kind: 'answer_edit', text: 'for the answer edit on this campaign to finish' };
  const msg = String(blocked?.error || '');
  if (/conversion/i.test(msg)) return { kind: 'conversion', text: 'for the survey conversion on this campaign to finish' };
  if (/unknock/i.test(msg)) return { kind: 'unknock', text: 'for the unknock on this campaign to finish' };
  return { kind: 'recut', text: 'for a round on this campaign to finish being re-cut' };
};

// The rows of every change source within the clock-skew window of the fence (§F2 step 7, §O9's
// fenceSeen): id + version, so the later check counts only what is new or changed since.
const sourcesNear = async ({ campaignId, fenceAt, team }) => {
  const since = new Date(fenceAt.getTime() - SKEW_MS);
  const recent = { campaignId, updatedAt: { $gte: since } };
  const [edits, conversions, unknocks, relabels, snapshots, crews] = await Promise.all([
    AnswerEditRun.find(recent, { updatedAt: 1 }).lean(),
    SurveyConversionRun.find(recent, { updatedAt: 1 }).lean(),
    UnknockRun.find(recent, { updatedAt: 1 }).lean(),
    ReclassifyRun.find(recent, { updatedAt: 1 }).lean(),
    TurfSnapshot.find(
      { campaignId, clearedKnocks: true, $or: [{ createdAt: { $gte: since } }, { restoredAt: { $gte: since } }] },
      { updatedAt: 1, restoredAt: 1 }
    ).lean(),
    team ? CoordinatorChange.find({ campaignId, createdAt: { $gte: since } }, { createdAt: 1 }).lean() : [],
  ]);
  const v = (d) => new Date(d || 0).getTime();
  return [
    ...edits.map((r) => ({ m: 'AnswerEditRun', id: String(r._id), v: v(r.updatedAt) })),
    ...conversions.map((r) => ({ m: 'SurveyConversionRun', id: String(r._id), v: v(r.updatedAt) })),
    ...unknocks.map((r) => ({ m: 'UnknockRun', id: String(r._id), v: v(r.updatedAt) })),
    ...relabels.map((r) => ({ m: 'ReclassifyRun', id: String(r._id), v: v(r.updatedAt) })),
    ...snapshots.map((r) => ({ m: 'TurfSnapshot', id: String(r._id), v: Math.max(v(r.updatedAt), v(r.restoredAt)) })),
    ...crews.map((r) => ({ m: 'CoordinatorChange', id: String(r._id), v: v(r.createdAt) })),
  ];
};

/** Did anything finish changing this campaign's records since the fence (§F2 step 7)? */
const changedSinceFence = async ({ campaignId, fenceAt, fenceSeen, team }) => {
  const seen = new Map((fenceSeen || []).map((s) => [`${s.m}:${s.id}`, s.v]));
  const now = await sourcesNear({ campaignId, fenceAt, team });
  if (now.some((s) => seen.get(`${s.m}:${s.id}`) !== s.v)) return true;
  // A row of either ledger changed in place (Mongoose bumps updatedAt on updateMany — verified).
  const inPlace = { campaignId, createdAt: { $lte: fenceAt }, updatedAt: { $gt: fenceAt } };
  const [act, resp] = await Promise.all([CanvassActivity.exists(inPlace), SurveyResponse.exists(inPlace)]);
  return !!(act || resp);
};

// The earlier report this build compares its earlier totals with (§F4, §O9): the same series'
// published, shown report with the latest end on or before this one's start (tie-break publishedAt
// descending, then _id). Its cards are recounted as of its own cut-off: rows timed before its
// period's end that it had received by the cut-off, or timed before it (NUM-3, buildReportSnapshot).
// Its live snapshot is frozen with the recount, so a refresh of that report hides the line (NUM-1).
const comparedReportFor = async (report) => {
  const series = report.seriesId
    ? { seriesId: report.seriesId }
    : { seriesId: null, effortId: report.effortId || null };
  const prev = await ClientReport.findOne(
    {
      organizationId: report.organizationId,
      campaignId: report.campaignId,
      _id: { $ne: report._id },
      status: 'published',
      takenDownAt: null,
      rangeEndUtc: { $lte: report.rangeStartUtc },
      ...series,
    },
    { rangeEndUtc: 1, statsComputedAt: 1, publishedAt: 1, snapshotId: 1 }
  )
    .sort({ rangeEndUtc: -1, publishedAt: -1, _id: -1 })
    .lean();
  if (!prev) return null;
  return { reportId: prev._id, end: prev.rangeEndUtc, cut: numbersCutOff(prev), snapshotId: prev.snapshotId ?? null };
};

// Wait OUTSIDE the worker slot (§F2 step 2): mark the build waiting and move the job back to the
// delayed set — DelayedError frees the slot and is not an attempt (verified in bullmq 5.77). Thirty
// minutes after it first waited, the build fails BLOCKED, naming what is running.
const waitOrFail = async ({ job, token, report, jobId, snapshotId, blocked, waitingSince }) => {
  const words = await waitingWords(report.campaignId, blocked);
  const now = new Date();
  const since = waitingSince ? new Date(waitingSince) : now;
  if (now.getTime() - since.getTime() >= blockedAfterMs()) {
    await failBuild({
      reportId: report._id,
      jobId,
      snapshotId,
      error: {
        code: 'BLOCKED',
        message:
          words.kind === 'answer_edit'
            ? 'Waited 30 minutes for the answer edit on this campaign. If a one-person-at-a-time edit is open, press Stop on Door Outcomes, then try again.'
            : `Waited 30 minutes ${words.text}. Try again once it is done.`,
        waitingFor: words.kind,
      },
    });
    return 'blocked';
  }
  await deleteSnapshotRows(report._id, snapshotId);
  const r = await ClientReport.updateOne(
    { _id: report._id, 'build.jobId': jobId, 'build.snapshotId': snapshotId },
    { $set: { 'build.status': 'waiting', 'build.waitingFor': words.text, 'build.beatAt': now, 'build.waitingSince': since } }
  );
  if (!r.matchedCount) return 'superseded';
  await job.moveToDelayed(Date.now() + waitRetryMs(), token);
  throw new DelayedError();
};

// The heartbeat (§F2 step 4): a timer CASes beatAt and progress on { jobId, snapshotId }; a miss means
// the build was cancelled or replaced, and the batch loop stops at its next batch. A miss counts only
// once a re-read confirms it: the build's job id changed, or its snapshot is neither the one the beat
// matched on nor the attempt's current one. A beat sent just before step 7 moves the build to its
// rebuild's snapshot lands after the move; latching that stopped the rebuild as "superseded", which
// completes the job and left the report reading running for good (STATE-1).
const startHeartbeat = ({ reportId, jobId, getSnapshotId, getProgress }) => {
  let missed = false;
  const beat = async () => {
    try {
      const sent = getSnapshotId();
      const r = await ClientReport.updateOne(
        { _id: reportId, 'build.jobId': jobId, 'build.snapshotId': sent },
        { $set: { 'build.beatAt': new Date(), 'build.progress': getProgress() } }
      );
      if (r.matchedCount) return;
      const now = (await ClientReport.findById(reportId, { 'build.jobId': 1, 'build.snapshotId': 1 }).lean())?.build;
      const ours = [sent, getSnapshotId()].filter(Boolean).map(String);
      if (String(now?.jobId ?? '') !== String(jobId) || !now?.snapshotId || !ours.includes(String(now.snapshotId))) missed = true;
    } catch {
      /* a lost beat is retried by the next one */
    }
  };
  const timer = setInterval(beat, beatMs());
  timer.unref?.();
  return {
    beat,
    stop: () => clearInterval(timer),
    get missed() {
      return missed;
    },
  };
};

/** Knocks in the report's scope that arrived after the fence, timed before the period ended. */
const arrivalsAfter = async ({ report, fenceAt, inputs, team }) => {
  const base = { organizationId: report.organizationId, campaignId: report.campaignId, ...(report.effortId ? { effortId: report.effortId } : {}) };
  const scoped = team ? { ...withTeam(base, teamClauseFor(inputs.coordinatorIds)), ...NOT_BULK } : base;
  return CanvassActivity.countDocuments({
    ...scoped,
    actionType: { $in: KNOCK_ACTIONS },
    createdAt: { $gt: fenceAt },
    timestamp: { $lt: report.rangeEndUtc },
  });
};

// Prune this snapshot's rows to the inputs the commit is about to pin (§F2 step 9, §O1): nothing at
// all when the map is off, otherwise no answer outside the map keys.
const pruneRowsToInputs = async (reportId, snapshotId, inputs) => {
  const filter = { clientReportId: reportId, snapshotId };
  if (!inputs.showMap) {
    await deleteSnapshotRows(reportId, snapshotId);
    return;
  }
  const keep = inputs.mapKeys || [];
  await Promise.all([
    ClientReportMapPoint.updateMany(filter, { $pull: { answers: { questionKey: { $nin: keep } } } }),
    ClientReportAreaCell.updateMany(filter, { $pull: { answers: { questionKey: { $nin: keep } } } }),
  ]);
};

const keysPin = (keys) => (keys.length ? { $all: keys, $size: keys.length } : { $size: 0 });

// The single-choice map questions an area snapshot shows no answers by area for (§O5, WALK-7): on
// the map the commit pins (chart shown, parents mapped — what a reader serves) but not among the
// questions the build's area rule let through (`areaQuestions`). The Refresh review and the builder
// name them; Before you publish does the same for a draft.
const areaWithoutAnswersOf = ({ inputs, visibility, breakdowns, areaQuestions }) => {
  if (!inputs.showMap || inputs.mapMode !== 'area') return [];
  const visible = new Set(visibility?.visibleQuestionKeys || []);
  const onMap = new Set(closeUnderDeps((inputs.mapKeys || []).filter((k) => visible.has(k)), depsMap(inputs.questionDeps)));
  const shown = new Set(areaQuestions || []);
  return (breakdowns || [])
    .filter((b) => b.type === 'single_choice' && onMap.has(b.questionKey) && !shown.has(b.questionKey))
    .map((b) => ({ key: b.questionKey, label: b.questionLabel || b.questionKey }));
};

/**
 * The commit (§F2 step 9). One CAS on { _id, build.jobId, build.snapshotId, status } that also PINS
 * the inputs it re-read after its last row write, as a pipeline update that reads $build.inputs
 * inside the write — retried on a miss, so a removal landing during the build is never undone.
 */
const commitBuild = async ({ ctx, kind, result, fenceAt, arrived }) => {
  const { report, jobId, claimStatus } = ctx;
  const snapshotId = ctx.snapshotId;
  const snapshotKey = ctx.snapshotKey;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cur = await ClientReport.findOne(
      { _id: report._id, 'build.jobId': jobId, 'build.snapshotId': snapshotId },
      { build: 1, status: 1, visibility: 1 }
    ).lean();
    if (!cur) break;
    const inputs = cur.build.inputs || {};
    await pruneRowsToInputs(report._id, snapshotId, inputs);
    const showMap = !!inputs.showMap;
    const now = new Date();
    const numbers = {
      mapPointCount: showMap ? result.mapPointCount || 0 : 0,
      areaCellCount: showMap ? result.areaCellCount || 0 : 0,
      extent: showMap ? result.extent || null : null,
    };
    // A refresh's numbers are new; a remap keeps the live ones (§F5).
    const areaWithoutAnswers = kind === 'recompute'
      ? []
      : areaWithoutAnswersOf({
          inputs,
          visibility: cur.visibility,
          breakdowns: (kind === 'refresh' ? result.stats : report.stats)?.cumulative?.surveyBreakdowns,
          areaQuestions: result.areaQuestions,
        });
    const filter = {
      _id: report._id,
      'build.jobId': jobId,
      'build.snapshotId': snapshotId,
      status: claimStatus,
      'build.inputs.showMap': showMap,
      'build.inputs.mapKeys': keysPin(inputs.mapKeys || []),
    };
    let update;
    if (kind === 'recompute') {
      update = [
        {
          $set: {
            stats: { $literal: result.stats },
            goalSnapshot: { $literal: result.goalSnapshot },
            mapPointCount: { $literal: numbers.mapPointCount },
            areaCellCount: { $literal: numbers.areaCellCount },
            extent: { $literal: numbers.extent },
            earlierTotals: { $literal: result.earlierTotals },
            comparedReportId: { $literal: result.comparedReportId },
            comparedSnapshotId: { $literal: result.comparedSnapshotId ?? null },
            arrivedDuringBuild: { $literal: arrived },
            snapshotId: { $literal: snapshotId },
            snapshotKey: { $literal: snapshotKey },
            snapshotInputs: '$build.inputs',
            statsComputedAt: { $literal: fenceAt },
            campaignType: { $literal: ctx.campaign.type || null },
            build: { $literal: { kind: 'recompute', status: 'idle', finishedAt: now } },
          },
        },
      ];
    } else if (kind === 'refresh') {
      update = [
        {
          $set: {
            'build.status': 'ready',
            'build.readyAt': { $literal: now },
            'build.beatAt': { $literal: now },
            'build.progress': 100,
            'build.result': {
              $literal: {
                stats: result.stats,
                goalSnapshot: result.goalSnapshot,
                mapPointCount: numbers.mapPointCount,
                areaCellCount: numbers.areaCellCount,
                extent: numbers.extent,
                earlierTotals: result.earlierTotals,
                comparedReportId: result.comparedReportId,
                comparedSnapshotId: result.comparedSnapshotId ?? null,
                arrivedDuringBuild: arrived,
                statsComputedAt: fenceAt,
                areaWithoutAnswers,
              },
            },
          },
        },
      ];
    } else {
      // remap: the numbers don't change; the map becomes the cells, the client sees "Edited". The
      // map view is a setting the builder edits, so its version moves (contract C8): an edit opened
      // before the switch merges onto it instead of writing over it.
      update = [
        {
          $set: {
            snapshotId: { $literal: snapshotId },
            snapshotKey: { $literal: snapshotKey },
            snapshotInputs: '$build.inputs',
            'visibility.mapMode': '$build.inputs.mapMode',
            'visibility.areaSize': '$build.inputs.areaSize',
            areaCellCount: { $literal: numbers.areaCellCount },
            mapPointCount: 0,
            extent: { $literal: numbers.extent },
            contentEditedAt: { $literal: now },
            contentEditedBy: { $literal: cur.build.requestedBy || null },
            editVersion: { $add: [{ $ifNull: ['$editVersion', 0] }, 1] },
            build: { $literal: { kind: 'remap', status: 'idle', finishedAt: now, areaWithoutAnswers } },
          },
        },
      ];
    }
    const pre = await ClientReport.findOneAndUpdate(filter, update, { returnDocument: 'before' }).lean();
    if (!pre) continue; // the inputs moved under us (a removal): re-read, prune again, pin again
    if (kind !== 'refresh') {
      // The previous live snapshot's rows — exactly those ({ snapshotId: null } = legacy rows).
      await deleteSnapshotRows(report._id, pre.snapshotId ?? null);
    }
    if (kind === 'remap') {
      await writeReportHistory(pre, REPORT_FIELDS.remapped, {
        by: cur.build.requestedBy || null,
        toValue: { mapMode: 'area', areaSize: inputs.areaSize || 'small' },
      }).catch(() => {});
    }
    return { committed: true };
  }
  // A commit that misses (§F2 step 9): SUPERSEDED, if the build is still its own; its rows go only
  // after re-reading that the report's live snapshot isn't this one.
  await ClientReport.updateOne(
    { _id: report._id, 'build.jobId': jobId, 'build.snapshotId': snapshotId },
    {
      $set: {
        'build.status': 'failed',
        'build.error': { code: 'SUPERSEDED', message: 'This report changed while it was building — try again.' },
        'build.snapshotId': null,
        'build.finishedAt': new Date(),
      },
    }
  );
  await deleteSnapshotRowsIfNotLive(report._id, snapshotId);
  return { committed: false, code: 'SUPERSEDED' };
};

const runAttempt = async ({ job, token, jobId, kind, claimStatus, pre, tenant, snapshotId, snapshotKey }) => {
  const ctx = { report: pre, jobId, claimStatus, snapshotId, snapshotKey };
  const report = pre;
  // §F2 step 5: a tenant being deleted stops the build for good.
  if (await deletionRequested(tenant)) throw new UnrecoverableError('The campaign or organization is being deleted.');
  const campaign = await Campaign.findOne({ _id: report.campaignId, organizationId: report.organizationId }).lean();
  if (!campaign) throw new UnrecoverableError('Campaign not found');
  ctx.campaign = campaign;
  const scope = scopeOf(report);
  const team = isTeamScope(scope.kind);

  if (kind !== 'remap') {
    // Step 2: wait outside the slot while another change holds the campaign.
    const blocked = await otherChangeRunning(report.campaignId);
    if (blocked) {
      const outcome = await waitOrFail({ job, token, report, jobId, snapshotId: ctx.snapshotId, blocked, waitingSince: pre.build.waitingSince });
      return { stopped: outcome };
    }
    // Before a recompute of a team report, every coordinator must still run a crew here and no
    // past one may run one again (§F4, §O4) — a card for the operator, never a Retry. Refreshes of
    // a report already sent rebuild with its frozen crews and skip this.
    if (kind === 'recompute' && team && report.seriesId) {
      const series = await ClientReportSeries.findById(report.seriesId).lean();
      const parent = await teamOf(series);
      const changed = await teamChangedFor(parent, report.campaignId);
      if (!parent || changed.departed.length || changed.returned.length) {
        await failBuild({
          reportId: report._id,
          jobId,
          snapshotId: ctx.snapshotId,
          error: {
            code: 'TEAM_CHANGED',
            message: changed.departed.length
              ? 'A crew lead in this team no longer runs a crew on this campaign.'
              : 'A past crew lead of this team runs a crew again.',
            seriesId: parent ? String(parent._id) : null,
            departed: changed.departed,
            returned: changed.returned,
          },
        });
        return { stopped: 'team-changed' };
      }
    }
  }

  const template = await templateFor(campaign);
  // The bar's denominator: a remap bins the live snapshot's pins; a build walks the households with
  // activity before the period's end, which buildReportSnapshot counts before it starts and hands
  // over with each batch (STATE-4).
  let total = kind === 'remap' ? Math.max(1, report.mapPointCount || 1) : 1;
  let done = 0;
  const hb = startHeartbeat({
    reportId: report._id,
    jobId,
    getSnapshotId: () => ctx.snapshotId,
    getProgress: () => Math.min(99, Math.round((done / total) * 100)),
  });
  const beforeBatch = async () => {
    if (hb.missed) throw new StopBuild('superseded');
    if (await deletionRequested(tenant)) throw new UnrecoverableError('The campaign or organization is being deleted.');
  };
  const onBatch = async ({ done: d, total: t }) => {
    done = d;
    if (t) total = Math.max(1, t);
    if (job.updateProgress) await job.updateProgress(Math.min(99, Math.round((done / total) * 100))).catch(() => {});
    // A beat per batch too: the progress bar moves, and a cancel is seen at this batch rather than
    // up to a timer's period later.
    await hb.beat();
    if (hb.missed) throw new StopBuild('superseded');
  };

  try {
    let result;
    let fenceAt = null;
    let rebuilds = pre.build.rebuilds || 0;
    for (;;) {
      const cur = await ClientReport.findOne(
        { _id: report._id, 'build.jobId': jobId, 'build.snapshotId': ctx.snapshotId },
        { build: 1 }
      ).lean();
      if (!cur) throw new StopBuild('superseded');
      const inputs = cur.build.inputs || {};
      if (kind === 'remap') {
        result = await remapSnapshot({ report, inputs, snapshotId: ctx.snapshotId, beforeBatch });
        break;
      }
      // Step 3: the fence, with every change source's rows in the skew window (fenceSeen), written
      // in the same CAS; waitingSince ends here.
      fenceAt = new Date();
      const fenceSeen = await sourcesNear({ campaignId: report.campaignId, fenceAt, team });
      const fenced = await ClientReport.updateOne(
        { _id: report._id, 'build.jobId': jobId, 'build.snapshotId': ctx.snapshotId },
        {
          $set: { 'build.fenceAt': fenceAt, 'build.fenceSeen': fenceSeen, 'build.status': 'running', 'build.beatAt': fenceAt },
          $unset: { 'build.waitingSince': 1, 'build.waitingFor': 1 },
        }
      );
      if (!fenced.matchedCount) throw new StopBuild('superseded');
      const compared = await comparedReportFor(report);
      result = await buildReportSnapshot({
        report,
        campaign,
        template,
        inputs,
        team,
        snapshotId: ctx.snapshotId,
        fenceAt,
        compared,
        beforeBatch,
        onBatch,
      });

      // Step 7: did anything change the campaign's records during the build?
      const blocked = await otherChangeRunning(report.campaignId);
      if (blocked) {
        // A change still in flight: back to waiting (rows deleted, delayed), not a rebuild.
        hb.stop();
        const outcome = await waitOrFail({ job, token, report, jobId, snapshotId: ctx.snapshotId, blocked, waitingSince: null });
        return { stopped: outcome };
      }
      if (!(await changedSinceFence({ campaignId: report.campaignId, fenceAt, fenceSeen, team }))) break;
      if (rebuilds >= 1) {
        await failBuild({
          reportId: report._id,
          jobId,
          snapshotId: ctx.snapshotId,
          error: {
            code: 'CHANGED_DURING_BUILD',
            message: 'The campaign’s records changed twice while these numbers were being built — try again in a few minutes.',
          },
        });
        return { stopped: 'changed-during-build' };
      }
      // A finished change rebuilds ONCE, under a new snapshot and fence; the count lives on the
      // document so a redelivery remembers it.
      rebuilds += 1;
      const oldSnapshot = ctx.snapshotId;
      const nextSnapshot = new ObjectId();
      const nextKey = newSnapshotKey();
      const moved = await ClientReport.updateOne(
        { _id: report._id, 'build.jobId': jobId, 'build.snapshotId': oldSnapshot },
        { $set: { 'build.snapshotId': nextSnapshot, 'build.snapshotKey': nextKey, 'build.rebuilds': rebuilds } }
      );
      // Not moved: the catch below deletes the first build's rows.
      if (!moved.matchedCount) throw new StopBuild('superseded');
      // The attempt follows the move at once, BEFORE the first build's rows go: a beat during that
      // delete CASes the new snapshot, never the old one (STATE-1).
      ctx.snapshotId = nextSnapshot;
      ctx.snapshotKey = nextKey;
      done = 0;
      await deleteSnapshotRows(report._id, oldSnapshot);
    }
    hb.stop();
    const inputsNow = (await ClientReport.findById(report._id, { build: 1 }).lean())?.build?.inputs || {};
    const arrived = kind === 'remap' ? null : await arrivalsAfter({ report, fenceAt, inputs: inputsNow, team });
    return await commitBuild({ ctx, kind, result, fenceAt, arrived });
  } catch (err) {
    if (err instanceof StopBuild) {
      await deleteSnapshotRowsIfNotLive(report._id, ctx.snapshotId);
      return { stopped: err.message };
    }
    if (err?.code === 'INVARIANT') {
      await failBuild({
        reportId: report._id,
        jobId,
        snapshotId: ctx.snapshotId,
        error: { code: 'INVARIANT', message: 'These numbers failed a consistency check, so they were not saved. Try again; if it repeats, contact support.' },
      });
      console.error(`[client-report] build ${jobId} failed its invariants: ${err.message}`);
      return { stopped: 'invariant' };
    }
    throw err;
  } finally {
    hb.stop();
  }
};

/**
 * The client-report-queue processor (§F2 "Each attempt"). `token` is BullMQ's, for moveToDelayed.
 * Step 1 owns the attempt with a fresh snapshot, and hands the previous attempt's rows (a stall or
 * a delayed redelivery) to the discard helper. Everything after runs inside sweptAfter, so a write
 * that outlasts a delete cascade is swept by this writer itself.
 */
export const processClientReportJob = async (job, token) => {
  const reportId = job?.data?.reportId;
  if (!reportId || !mongoose.isValidObjectId(reportId)) return { skipped: 'no-report' };
  const jobId = String(job.id);
  const head = await ClientReport.findOne({ _id: reportId, 'build.jobId': jobId }, { build: 1 }).lean();
  if (!head?.build) return { skipped: 'superseded' };
  const kind = head.build.kind;
  const claimStatus = kind === 'recompute' ? 'draft' : 'published';
  const snapshotId = new ObjectId();
  const snapshotKey = newSnapshotKey();
  const pre = await ClientReport.findOneAndUpdate(
    { _id: reportId, 'build.jobId': jobId, 'build.status': { $in: LIVE_BUILD_STATUSES }, status: claimStatus },
    { $set: { 'build.status': 'running', 'build.snapshotId': snapshotId, 'build.snapshotKey': snapshotKey, 'build.beatAt': new Date() } },
    { returnDocument: 'before' }
  ).lean();
  if (!pre) return { skipped: 'not-claimable' };
  await discardBuildRows(pre);
  const tenant = { campaignId: pre.campaignId, organizationId: pre.organizationId };
  return sweptAfter(tenant, () => runAttempt({ job, token, jobId, kind, claimStatus, pre, tenant, snapshotId, snapshotKey }));
};

/**
 * The worker's `failed` listener (attempts: 1, so once per failure). Its CAS covers only a build
 * still queued, waiting or running under this job — never a `ready` one, so a throw after a
 * refresh reached ready doesn't lose the review — and clears build.snapshotId, leaving that
 * attempt's rows to the sweep. The message is generic: never campaign or voter content.
 */
export const reconcileFailedClientReportJob = async (job, err) => {
  const reportId = job?.data?.reportId;
  if (!reportId || !mongoose.isValidObjectId(reportId)) return;
  const deleting = /being deleted|not found/i.test(String(err?.message || ''));
  await ClientReport.updateOne(
    { _id: reportId, 'build.jobId': String(job.id), 'build.status': { $in: LIVE_BUILD_STATUSES } },
    {
      $set: {
        'build.status': 'failed',
        'build.error': deleting
          ? { code: 'DELETING', message: 'The campaign or organization is being deleted, so this build stopped.' }
          : { code: 'FAILED', message: 'The build failed — try again.' },
        'build.snapshotId': null,
        'build.finishedAt': new Date(),
      },
    }
  );
};

// ── Publish, Apply, Discard, Take down, Put back up (§F3) ─────────────────────────────────────

const replaceBuildIdle = (by, pre) =>
  LIVE_BUILD_STATUSES.includes(pre?.build?.status) || pre?.build?.status === 'ready'
    ? { status: 'idle', cancelledAt: new Date(), cancelledBy: by || null }
    : { status: 'idle' };

/**
 * Publish is NOT a build: it freezes the draft's live snapshot, exactly as previewed (§F3). Refused
 * with RECOMPUTE_NEEDED when there is no snapshot or the on-screen settings ADD to what it was built
 * with; SNAPSHOT_CHANGED when a recompute landed since the preview; SAVING when an edit landed since.
 * Setting `build` cancels a recompute still queued or running: what you previewed wins.
 */
export const publishReport = async ({ report, by, previewedSnapshotId, previewedEditVersion, openMockFlags, template }) => {
  if (report.status !== 'draft') {
    throw new BuildError(409, 'ALREADY_PUBLISHED', 'This report is already published. Use Edit or Refresh numbers to change it.');
  }
  if (!report.snapshotId) {
    throw new BuildError(409, 'RECOMPUTE_NEEDED', 'This report has no numbers yet — recompute first.', { reasons: ['no_snapshot'] });
  }
  const si = liveInputs(report);
  const onScreen = inputsFromSettings({
    visibility: report.visibility,
    template,
    coordinatorIds: await currentCrewKeysFor(report),
  });
  const reasons = [];
  if (onScreen.showMap && !si.showMap) reasons.push('map_on');
  if (onScreen.showMap && onScreen.mapKeys.some((k) => !si.mapKeys.includes(k))) reasons.push('map_questions');
  if (onScreen.showMap && si.showMap && onScreen.mapMode !== si.mapMode) reasons.push('map_mode');
  if (onScreen.showMap && si.showMap && onScreen.mapMode === 'area' && onScreen.areaSize !== si.areaSize) reasons.push('area_size');
  if (isTeamScope(scopeOf(report).kind)) {
    const a = onScreen.coordinatorIds.map(String).sort();
    const b = (si.coordinatorIds || []).map(String).sort();
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) reasons.push('crews');
  }
  if (reasons.length) {
    throw new BuildError(409, 'RECOMPUTE_NEEDED', 'Your settings add to what these numbers were built with — recompute first.', { reasons });
  }
  const snapshotId = previewedSnapshotId ?? report.snapshotId;
  const editVersion = previewedEditVersion ?? report.editVersion ?? 0;
  const now = new Date();
  const pre = await ClientReport.findOneAndUpdate(
    {
      _id: report._id,
      organizationId: report.organizationId,
      status: 'draft',
      snapshotId: new ObjectId(String(snapshotId)),
      editVersion: editVersion === 0 ? { $in: [0, null] } : editVersion,
    },
    {
      $set: {
        status: 'published',
        publishedAt: now,
        publishedBy: by || null,
        openMockFlagsAtPublish: openMockFlags,
        takenDownAt: null,
        takenDownBy: null,
        build: replaceBuildIdle(by, report),
      },
    },
    { returnDocument: 'before' }
  ).lean();
  if (!pre) {
    const cur = await ClientReport.findById(report._id, { status: 1, snapshotId: 1, editVersion: 1 }).lean();
    if (!cur || cur.status !== 'draft') throw new BuildError(409, 'ALREADY_PUBLISHED', 'This report was just published.');
    if (String(cur.snapshotId) !== String(snapshotId)) {
      throw new BuildError(409, 'SNAPSHOT_CHANGED', 'Your numbers were just rebuilt — look at the preview, then publish.');
    }
    throw new BuildError(409, 'SAVING', 'Your latest changes are still saving — publish again in a moment.');
  }
  await discardBuildRows(pre);
  if (LIVE_BUILD_STATUSES.includes(pre.build?.status)) await removeQueuedJob(pre.build.jobId);
  await writeReportHistory(pre, REPORT_FIELDS.published, { by }).catch(() => {});
  return ClientReport.findById(report._id).lean();
};

/**
 * Apply a ready refresh (§F3): swap in the result, the snapshot and its inputs, and the map settings
 * from build.inputs — read inside the write (a pipeline), never intersected with anything else
 * (round 3's blocker). Then the previous live rows go.
 */
export const applyRefresh = async ({ report, by, reviewedSnapshotId = null }) => {
  const sid = reviewedSnapshotId ?? report.build?.snapshotId;
  if (report.build?.status !== 'ready' || !sid) {
    throw new BuildError(409, 'NOTHING_TO_APPLY', 'There are no new numbers to apply.');
  }
  const now = new Date();
  const pre = await ClientReport.findOneAndUpdate(
    {
      _id: report._id,
      organizationId: report.organizationId,
      status: 'published',
      'build.status': 'ready',
      'build.snapshotId': new ObjectId(String(sid)),
    },
    [
      {
        $set: {
          stats: '$build.result.stats',
          goalSnapshot: '$build.result.goalSnapshot',
          mapPointCount: '$build.result.mapPointCount',
          areaCellCount: '$build.result.areaCellCount',
          extent: '$build.result.extent',
          earlierTotals: '$build.result.earlierTotals',
          comparedReportId: '$build.result.comparedReportId',
          // A result from before the field reads as null, so a compared report with a snapshot of its
          // own hides the line: fail closed (NUM-1).
          comparedSnapshotId: { $ifNull: ['$build.result.comparedSnapshotId', null] },
          arrivedDuringBuild: '$build.result.arrivedDuringBuild',
          statsComputedAt: '$build.result.statsComputedAt',
          snapshotId: '$build.snapshotId',
          snapshotKey: '$build.snapshotKey',
          snapshotInputs: '$build.inputs',
          'visibility.showMap': '$build.inputs.showMap',
          'visibility.mapMode': '$build.inputs.mapMode',
          'visibility.areaSize': '$build.inputs.areaSize',
          // A refresh that leaves the map off builds no map questions: the picks the report keeps
          // for when its map comes back on stay as they are (§P1, VERIFY-1).
          'visibility.mapAnswerKeys': {
            $cond: [{ $eq: ['$build.inputs.showMap', true] }, '$build.inputs.mapKeys', { $ifNull: ['$visibility.mapAnswerKeys', []] }],
          },
          // The map settings it swaps in are ones the builder edits (contract C8): an edit opened
          // before the Apply merges onto them instead of writing over them.
          editVersion: { $add: [{ $ifNull: ['$editVersion', 0] }, 1] },
          numbersRefreshedAt: { $literal: now },
          numbersRefreshedBy: { $literal: by || null },
          build: { $literal: { kind: 'refresh', status: 'idle', appliedAt: now } },
        },
      },
    ],
    { returnDocument: 'before' }
  ).lean();
  if (!pre) throw new BuildError(409, 'NOTHING_TO_APPLY', 'These numbers were already applied, discarded or replaced — reload.');
  await deleteSnapshotRows(report._id, pre.snapshotId ?? null);
  const before = pre.stats?.cumulative?.totals || {};
  const after = pre.build?.result?.stats?.cumulative?.totals || {};
  const pick = (t) => ({ doorsKnocked: t.doorsKnocked ?? 0, surveysTaken: t.surveysTaken ?? 0, surveyedVoters: t.surveyedVoters ?? 0, litKnocks: t.litKnocks ?? 0 });
  await writeReportHistory(pre, REPORT_FIELDS.numbersRefreshed, { by, fromValue: pick(before), toValue: pick(after) }).catch(() => {});
  return ClientReport.findById(report._id).lean();
};

/** Discard a ready refresh: CAS ready → idle, and its rows go only when the CAS matched. */
export const discardRefresh = async ({ report, by, reviewedSnapshotId = null }) => {
  const sid = reviewedSnapshotId ?? report.build?.snapshotId;
  if (report.build?.status !== 'ready' || !sid) throw new BuildError(409, 'NOTHING_TO_DISCARD', 'There are no new numbers to discard.');
  const pre = await ClientReport.findOneAndUpdate(
    { _id: report._id, organizationId: report.organizationId, 'build.status': 'ready', 'build.snapshotId': new ObjectId(String(sid)) },
    { $set: { build: { status: 'idle', discardedAt: new Date(), discardedBy: by || null } } },
    { returnDocument: 'before' }
  ).lean();
  if (!pre) throw new BuildError(409, 'NOTHING_TO_DISCARD', 'These numbers were already applied or discarded — reload.');
  await discardBuildRows(pre);
  await writeReportHistory(pre, REPORT_FIELDS.refreshDiscarded, { by }).catch(() => {});
  return ClientReport.findById(report._id).lean();
};

/**
 * Take down (§F3): hidden from the client, kept exactly as it was — numbers, publishedAt — and any
 * live build or ready result is cancelled (the build object replaced, its rows discarded).
 */
export const takeDownReport = async ({ report, by }) => {
  const pre = await ClientReport.findOneAndUpdate(
    { _id: report._id, organizationId: report.organizationId, status: 'published', takenDownAt: null },
    { $set: { takenDownAt: new Date(), takenDownBy: by || null, build: replaceBuildIdle(by, report) } },
    { returnDocument: 'before' }
  ).lean();
  if (!pre) {
    const cur = await ClientReport.findById(report._id, { status: 1, takenDownAt: 1 }).lean();
    if (cur?.status === 'published' && cur.takenDownAt) return ClientReport.findById(report._id).lean(); // already down
    throw new BuildError(409, 'NOT_PUBLISHED', 'Only a published report can be taken down.');
  }
  await discardBuildRows(pre);
  if (LIVE_BUILD_STATUSES.includes(pre.build?.status)) await removeQueuedJob(pre.build.jobId);
  await writeReportHistory(pre, REPORT_FIELDS.takenDown, { by }).catch(() => {});
  return ClientReport.findById(report._id).lean();
};

/** Put back up: shown again, unchanged, with its original publish date. */
export const putBackUpReport = async ({ report, by }) => {
  const pre = await ClientReport.findOneAndUpdate(
    { _id: report._id, organizationId: report.organizationId, status: 'published', takenDownAt: { $ne: null } },
    { $set: { takenDownAt: null, takenDownBy: null } },
    { returnDocument: 'before' }
  ).lean();
  if (!pre) {
    const cur = await ClientReport.findById(report._id, { status: 1, takenDownAt: 1 }).lean();
    if (cur?.status === 'published' && !cur.takenDownAt) return ClientReport.findById(report._id).lean();
    throw new BuildError(409, 'NOT_PUBLISHED', 'Only a published report can be put back up.');
  }
  await writeReportHistory(pre, REPORT_FIELDS.putBackUp, { by }).catch(() => {});
  return ClientReport.findById(report._id).lean();
};
