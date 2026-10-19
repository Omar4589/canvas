import mongoose from 'mongoose';
import { AnswerEditRun } from '../../models/AnswerEditRun.js';
import { AnswerEditRunChunk, ANSWER_EDIT_CHUNK_ITEMS } from '../../models/AnswerEditRunChunk.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { Pass } from '../../models/Pass.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { Voter } from '../../models/Voter.js';
import { getQueue, QUEUE_NAMES, queueOp } from '../../queues/index.js';
import { applyChunk, undoRunPass, emptyCounts } from './answerEditWriter.js';
import { isRecutLocked } from '../turf/recutLock.js';
import { hydrateCanvassers } from '../reports/canvasserIdentity.js';

// The life of an answer-edit run — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §F. Create freezes the
// selection into chunks, the worker applies them (answer-edit-queue, job 'apply'), and every undo
// is a job too ('undo'), so nothing is left stranded in a web request.
//
// Jobs: every enqueue gets a FRESH job id, written to the run before the add. BullMQ's own retries
// and stall redeliveries reuse that id and are welcome (the writer is idempotent); a job whose id
// is no longer the run's (Start again re-enqueued it) stops at its next chunk.

const { ObjectId } = mongoose.mongo;
const WAIT_MS = 10 * 60 * 1000;
const RECUT_STALE_MS = 5 * 60 * 1000;

const enqueueTimeout = () => Number(process.env.ANSWER_EDIT_ENQUEUE_TIMEOUT_MS || process.env.OUTCOME_CONVERT_ENQUEUE_TIMEOUT_MS || 5000);
const jobIdFor = (runId, phase) => `answer-edit-${runId}-${phase}-${Date.now()}`;

/** The run's frozen copy of the survey (§F): the applier and evaluator use it, never the live one. */
export const freezeTemplate = (t) => ({
  surveyTemplateId: t._id,
  version: t.version || 1,
  name: t.name || null,
  flow: t.flow || null,
  questions: (t.questions || []).map((q) => (typeof q.toObject === 'function' ? q.toObject() : q)),
});

/**
 * Freeze the selection and write the run: chunks FIRST (under a pre-minted run id), the run doc
 * last, so a run that exists always has its whole selection behind it. A crash in between leaves
 * orphan chunks the campaign's cascade still reaches, never a run with half its surveys.
 */
export const createAnswerEditRun = async ({ campaign, byUserId, mode, template, plan = [], planSummary = null, selection, scopeSummary = null, items }) => {
  const runId = new ObjectId();
  const chunks = [];
  for (let i = 0, seq = 0; i < items.length; i += ANSWER_EDIT_CHUNK_ITEMS, seq += 1) {
    chunks.push({
      runId,
      campaignId: campaign._id,
      organizationId: campaign.organizationId,
      seq,
      items: items.slice(i, i + ANSWER_EDIT_CHUNK_ITEMS),
    });
  }
  if (chunks.length) await AnswerEditRunChunk.insertMany(chunks, { ordered: true });
  return AnswerEditRun.create({
    _id: runId,
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    byUserId,
    mode,
    template,
    plan,
    planSummary,
    selection,
    scopeSummary,
    editedAt: new Date(),
    status: mode === 'bulk' ? 'pending' : 'open',
    progress: { done: 0, total: items.length },
    counts: { surveysTargeted: items.length },
  });
};

/** Enqueue the apply phase. The job id is on the run before the add, so the failed listener can match it. */
export const enqueueApply = async (run) => {
  const jobId = jobIdFor(run._id, 'apply');
  await AnswerEditRun.updateOne({ _id: run._id }, { $set: { queueJobId: jobId } });
  await queueOp(getQueue(QUEUE_NAMES.ANSWER_EDIT).add('apply', { runId: String(run._id) }, { jobId }), enqueueTimeout());
  return jobId;
};

/** Enqueue an undo pass. */
export const enqueueUndo = async (run) => {
  const jobId = jobIdFor(run._id, 'undo');
  await AnswerEditRun.updateOne({ _id: run._id }, { $set: { 'undo.jobId': jobId } });
  await queueOp(getQueue(QUEUE_NAMES.ANSWER_EDIT).add('undo', { runId: String(run._id) }, { jobId }), enqueueTimeout());
  return jobId;
};

// ---------------------------------------------------------------------------
// One change at a time per campaign (§F, §H2)
// ---------------------------------------------------------------------------

const EDIT_BUSY = (campaignId, exceptRunId = null) => ({
  campaignId,
  ...(exceptRunId ? { _id: { $ne: exceptRunId } } : {}),
  $or: [{ status: { $in: ['pending', 'running', 'open'] } }, { 'undo.status': { $in: ['pending', 'running'] } }],
});

/** Is an answer edit's apply or undo running (or a one-person session open) on this campaign? */
export const answerEditBusy = (campaignId) => AnswerEditRun.exists(EDIT_BUSY(campaignId));

/** The refusal the OTHER Door Outcomes acts send while an answer edit is running. */
export const ANSWER_EDIT_BUSY_ERROR = {
  error:
    'An answer edit is still running on this campaign (or a one-person-at-a-time session is open). Let it finish, or press Stop here on its row, then try again.',
  code: 'ANOTHER_CHANGE_RUNNING',
};

/**
 * Why an answer edit can't start right now on this campaign, or null. Neither conversions nor
 * unknock write through a compare-and-swap (they read, archive, then delete by id), so two acts
 * interleaving on one survey could lose a write; and a clear-knocks re-cut reads a round's surveys
 * and archive rows in two reads, so an undo landing between them would leave the snapshot holding
 * the edit with its original nowhere (round 3).
 */
export const otherChangeRunning = async (campaignId, { exceptRunId = null } = {}) => {
  const recent = new Date(Date.now() - WAIT_MS);
  const [conversion, unknock, unknockRevert, passes, edit] = await Promise.all([
    SurveyConversionRun.exists({ campaignId, status: { $in: ['pending', 'running', 'reverting'] } }),
    UnknockRun.exists({ campaignId, status: 'pending', createdAt: { $gte: recent } }),
    UnknockRun.exists({ campaignId, revertingAt: { $gte: recent } }),
    Pass.find({ campaignId }, { recutLock: 1 }).lean(),
    AnswerEditRun.exists(EDIT_BUSY(campaignId, exceptRunId)),
  ]);
  if (edit) return { error: 'Another answer edit is still running on this campaign (or a one-person-at-a-time session is open). Let it finish, or press Stop here on its row.', code: 'ANOTHER_CHANGE_RUNNING' };
  if (conversion) return { error: 'A survey conversion is still running on this campaign. Let it finish, then edit answers.', code: 'ANOTHER_CHANGE_RUNNING' };
  if (unknock || unknockRevert) return { error: 'An unknock is still running on this campaign. Let it finish, then edit answers.', code: 'ANOTHER_CHANGE_RUNNING' };
  const staleBefore = new Date(Date.now() - RECUT_STALE_MS);
  if (passes.some((p) => p.recutLock?.lockedAt && new Date(p.recutLock.lockedAt) >= staleBefore)) {
    return { error: 'A round on this campaign is being re-cut right now. Try again in a minute.', code: 'ANOTHER_CHANGE_RUNNING' };
  }
  return null;
};

// ---------------------------------------------------------------------------
// The processor
// ---------------------------------------------------------------------------

const mapSum = (into, from) => {
  for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + v;
};

/**
 * Sum the chunks' counts onto the run (each chunk holds its own, written with its `done` flag, so
 * a re-processed chunk replaced rather than added) and hydrate the sample names.
 */
export const rollUp = async (runId) => {
  const chunks = await AnswerEditRunChunk.find({ runId }, { counts: 1, done: 1, seq: 1, 'items.r': 1 }).lean();
  const total = emptyCounts();
  let done = 0;
  for (const c of chunks) {
    if (c.done) done += (c.items || []).length;
    const k = c.counts;
    if (!k) continue;
    total.changed += k.changed || 0;
    total.changedSinceReview += k.changedSinceReview || 0;
    total.notFound += k.notFound || 0;
    total.droppedFollowUps += k.droppedFollowUps || 0;
    total.endsScript += k.endsScript || 0;
    mapSum(total.skipped, k.skipped);
    for (const [key, o] of Object.entries(k.byOption || {})) {
      total.byOption[key] ||= { questionKey: o.questionKey, key: o.key, label: o.label, removed: 0, added: 0 };
      total.byOption[key].removed += o.removed || 0;
      total.byOption[key].added += o.added || 0;
    }
    for (const [key, o] of Object.entries(k.byQuestion || {})) {
      total.byQuestion[key] ||= { label: o.label, surveys: 0 };
      total.byQuestion[key].surveys += o.surveys || 0;
    }
    for (const s of k.samples || []) if (total.samples.length < 200) total.samples.push(s);
  }
  const voters = total.samples.length
    ? await Voter.find({ _id: { $in: total.samples.map((s) => s.voterId) } }, { fullName: 1 }).lean()
    : [];
  const nameOf = new Map(voters.map((v) => [String(v._id), v.fullName]));
  const run = await AnswerEditRun.findByIdAndUpdate(
    runId,
    {
      $set: {
        'counts.surveysChanged': total.changed,
        'counts.changedSinceReview': total.changedSinceReview,
        'counts.notFound': total.notFound,
        'counts.skipped': total.skipped,
        'counts.droppedFollowUps': total.droppedFollowUps,
        'counts.endsScript': total.endsScript,
        'counts.byOption': Object.values(total.byOption),
        'counts.byQuestion': total.byQuestion,
        'progress.done': done,
        samples: total.samples.map((s) => ({ voterId: s.voterId, voterName: nameOf.get(String(s.voterId)) || 'Voter', reason: s.reason })),
        samplesTruncated: total.changedSinceReview + total.notFound > total.samples.length,
        samplesTotal: total.changedSinceReview + total.notFound,
      },
    },
    { new: true }
  ).lean();
  return run;
};

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A run's line in Campaign History: the frozen plan in the survey's own words, and the count. */
const historyLine = (run, n, more) => {
  const summary = run.planSummary || 'Survey answers edited';
  return `${summary} (${more ? plural(n, 'more survey') : plural(n, 'survey')})`;
};

/**
 * Report a run's changed surveys to Campaign History: everything so far the first time, and on a
 * later call only what changed since — a run that stopped part-way is logged when it stops, and
 * again ("N more surveys") when Pick up finishes it. CAS'd on `historyCount` and the count it read,
 * so a redelivery or a racing caller never reports a survey twice; the call that loses the race
 * leaves the rest to the next one.
 */
export const writeRunHistory = async (runId) => {
  const run = await AnswerEditRun.findById(runId, { counts: 1, historyCount: 1 }).lean();
  const total = run?.counts?.surveysChanged || 0;
  const already = run?.historyCount || 0;
  if (total <= already) return;
  const claim = await AnswerEditRun.findOneAndUpdate(
    { _id: runId, historyCount: already === 0 ? { $in: [0, null] } : already, 'counts.surveysChanged': total },
    { $set: { historyCount: total } },
    { new: true }
  ).lean();
  if (!claim) return;
  await CampaignChange.create({
    organizationId: claim.organizationId,
    campaignId: claim.campaignId,
    field: 'answerEdit',
    fromValue: null,
    toValue: historyLine(claim, total - already, already > 0),
    byUserId: claim.byUserId,
    source: 'answer_edit',
  });
};

/** Build a queue session's plan summary from what its steps changed, frozen at close. */
export const queueSummary = (run) => {
  const qs = Object.values(run.counts?.byQuestion || {});
  if (!qs.length) return 'Survey answers edited one at a time';
  return `One at a time: ${qs.map((q) => `${q.label} (${plural(q.surveys, 'survey')})`).join(', ')}`;
};

class StopRun extends Error {}

const mayContinue = async (runId, jobId, chunk, field = 'queueJobId') => {
  const run = await AnswerEditRun.findById(runId, { status: 1, queueJobId: 1, undo: 1, campaignId: 1, organizationId: 1 }).lean();
  if (!run) throw new StopRun('run-gone');
  const owner = field === 'queueJobId' ? run.queueJobId : run.undo?.jobId;
  if (owner !== String(jobId)) throw new StopRun('superseded');
  if (field === 'queueJobId' && run.undo?.status) throw new StopRun('undo-started');
  // A tenant being deleted: never re-insert copies into it.
  const [campaign, org] = await Promise.all([
    Campaign.findById(run.campaignId, { deletion: 1 }).lean(),
    Organization.findById(run.organizationId, { deletion: 1 }).lean(),
  ]);
  if (!campaign || campaign.deletion?.requestedAt || org?.deletion?.requestedAt) throw new StopRun('tenant-deleting');
  // A round being re-cut: wait it out (BullMQ's retry backoff) rather than race its two reads.
  const passIds = [...new Set((chunk?.items || []).map((it) => (it.p ? String(it.p) : null)).filter(Boolean))];
  for (const p of passIds) {
    if (await isRecutLocked(p)) throw new Error('A round in this change is being re-cut — the change picks up again shortly.');
  }
};

const runApply = async (job) => {
  const runId = job.data.runId;
  const claimed = await AnswerEditRun.findOneAndUpdate(
    { _id: runId, queueJobId: String(job.id), 'undo.status': null, status: { $in: ['pending', 'running', 'failed'] } },
    { $set: { status: 'running', error: null }, $min: { startedAt: new Date() } },
    { new: true }
  ).lean();
  if (!claimed) return { skipped: 'not-claimable' };
  const chunks = await AnswerEditRunChunk.find({ runId, done: { $ne: true } }).sort({ seq: 1 }).lean();
  try {
    for (const chunk of chunks) {
      await mayContinue(runId, job.id, chunk);
      const { counts, items } = await applyChunk({ run: claimed, chunk });
      counts.items = items.length;
      await AnswerEditRunChunk.updateOne({ _id: chunk._id }, { $set: { done: true, counts, items } });
      const rolled = await rollUp(runId);
      if (job.updateProgress) await job.updateProgress(Math.round(((rolled.progress?.done || 0) / Math.max(1, rolled.progress?.total || 1)) * 100)).catch(() => {});
    }
  } catch (err) {
    if (err instanceof StopRun) return { stopped: err.message };
    throw err;
  }
  await rollUp(runId);
  await AnswerEditRun.updateOne(
    { _id: runId, queueJobId: String(job.id), status: 'running' },
    { $set: { status: 'completed', completedAt: new Date() } }
  );
  await writeRunHistory(runId);
  return { completed: true };
};

// The reason words the run card and Details show, built once per pass with the campaign's zone.
const hydrateUndoNames = async (run, names) => {
  if (!names.length) return [];
  const campaign = await Campaign.findById(run.campaignId, { timeZone: 1 }).lean();
  const tz = campaign?.timeZone || 'America/New_York';
  const voters = await Voter.find({ _id: { $in: names.map((n) => n.voterId) } }, { fullName: 1 }).lean();
  const vName = new Map(voters.map((v) => [String(v._id), v.fullName]));
  const people = await hydrateCanvassers(names.map((n) => n.detail?.by).filter(Boolean), run.organizationId);
  const who = (id) => {
    const u = id ? people.get(String(id)) : null;
    return u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || 'someone' : 'someone';
  };
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: tz });
  const day = (d) => (d ? fmt.format(new Date(d)) : '');
  const words = (n) => {
    const d = n.detail;
    if (n.reason === 'waiting') return d?.kind === 'unknock' ? `Unknock, ${day(d.at)}` : `Surveyed → Not home, ${day(d.at)}`;
    if (n.reason === 'changed_since') {
      if (d?.kind === 'resurveyed') return `re-surveyed by ${who(d.by)}`;
      if (d?.kind === 'edited') return `edited by ${who(d.by)}`;
      return null;
    }
    return null;
  };
  return names.map((n) => ({ voterId: n.voterId, voterName: vName.get(String(n.voterId)) || 'Voter', reason: n.reason, detail: words(n) }));
};

const undoLine = (s) => {
  const parts = [`${plural(s.putBack, 'survey')} put back`];
  if (s.changedSince) parts.push(`${s.changedSince.toLocaleString()} kept newer answers`);
  if (s.waiting) parts.push(`${s.waiting.toLocaleString()} waiting on a later change`);
  if (s.restoredOnProfile) parts.push(`${s.restoredOnProfile.toLocaleString()} restored on the profile`);
  if (s.cleared) parts.push(`${s.cleared.toLocaleString()} cleared with a re-cut`);
  if (s.erased) parts.push(`${s.erased.toLocaleString()} erased`);
  if (s.gone) parts.push(`${s.gone.toLocaleString()} no longer on file`);
  return parts.join(', ');
};

const runUndo = async (job) => {
  const runId = job.data.runId;
  const claimed = await AnswerEditRun.findOneAndUpdate(
    { _id: runId, 'undo.jobId': String(job.id), 'undo.status': { $in: ['pending', 'running', 'failed'] }, status: { $in: ['completed', 'failed'] } },
    { $set: { 'undo.status': 'running', 'undo.error': null }, $min: { 'undo.startedAt': new Date() } },
    { new: true }
  ).lean();
  if (!claimed) return { skipped: 'not-claimable' };
  const chunks = await AnswerEditRunChunk.find({ runId }).sort({ seq: 1 }).lean();
  try {
    await mayContinue(runId, job.id, { items: chunks.flatMap((c) => c.items || []) }, 'undo.jobId');
  } catch (err) {
    if (err instanceof StopRun) return { stopped: err.message };
    throw err;
  }
  const { summary, names, namesTotal } = await undoRunPass({ run: claimed, chunks });
  const hydrated = await hydrateUndoNames(claimed, names);
  const updated = await AnswerEditRun.findOneAndUpdate(
    { _id: runId, 'undo.jobId': String(job.id) },
    {
      $set: {
        'undo.status': 'done',
        'undo.lastRunAt': new Date(),
        'undo.summary': { ...summary, names: hydrated, namesTotal },
      },
      $inc: { 'undo.passes': 1 },
    },
    { new: true }
  ).lean();
  if (updated && (summary.putBack || !claimed.undo?.passes)) {
    await CampaignChange.create({
      organizationId: updated.organizationId,
      campaignId: updated.campaignId,
      field: 'answerEditUndo',
      fromValue: updated.planSummary || null,
      toValue: undoLine(summary),
      // Whoever pressed Undo; a run undone before the field existed falls back to its author.
      byUserId: updated.undo?.requestedBy || updated.byUserId,
      source: 'answer_edit',
    });
  }
  return { undone: true, summary };
};

/** BullMQ processor for answer-edit-queue: 'apply' or 'undo'. */
export const processAnswerEditJob = async (job) => {
  if (!job?.data?.runId) return { skipped: 'no-run' };
  if (job.name === 'undo') return runUndo(job);
  return runApply(job);
};

/**
 * The worker's `failed` listener for this queue: only after the LAST attempt, and only while the
 * failing job is still the run's own (a superseded job's failure changes nothing). What landed
 * stays landed — every edited survey is individually correct and individually undoable.
 */
export const reconcileFailedAnswerEditJob = async (job, err) => {
  if (!job?.data?.runId) return;
  const attemptsAllowed = job.opts?.attempts || 1;
  if ((job.attemptsMade || 0) < attemptsAllowed && !job.finishedOn) return; // a retry is coming
  const error = String(err?.message || err || 'unknown');
  if (job.name === 'undo') {
    await AnswerEditRun.updateOne(
      { _id: job.data.runId, 'undo.jobId': String(job.id), 'undo.status': { $in: ['pending', 'running'] } },
      { $set: { 'undo.status': 'failed', 'undo.error': error } }
    );
    return;
  }
  const stopped = await AnswerEditRun.updateOne(
    { _id: job.data.runId, queueJobId: String(job.id), status: { $in: ['pending', 'running'] } },
    { $set: { status: 'failed', error } }
  );
  // What landed before it stopped is in History now, not only if Pick up finishes it: an admin who
  // undoes what landed instead must find the change it undoes.
  if (stopped.modifiedCount) await writeRunHistory(job.data.runId);
};

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/** What the clients see of a run. Never the frozen selection or the template's questions. */
export const answerEditRunWire = (r, by = null) => {
  const now = Date.now();
  return {
    id: String(r._id),
    kind: 'answerEdit',
    mode: r.mode,
    status: r.status,
    planSummary: r.mode === 'queue' && r.status === 'open' ? queueSummary(r) : r.planSummary || null,
    scopeSummary: r.scopeSummary || null,
    byIds: !!r.selection?.byIds,
    template: { id: String(r.template?.surveyTemplateId), name: r.template?.name || null, version: r.template?.version || 1 },
    counts: {
      surveysTargeted: r.counts?.surveysTargeted || 0,
      surveysChanged: r.counts?.surveysChanged || 0,
      changedSinceReview: r.counts?.changedSinceReview || 0,
      notFound: r.counts?.notFound || 0,
      skipped: r.counts?.skipped || {},
      droppedFollowUps: r.counts?.droppedFollowUps || 0,
      endsScript: r.counts?.endsScript || 0,
      byOption: r.counts?.byOption || [],
      byQuestion: r.counts?.byQuestion || {},
    },
    progress: { done: r.progress?.done || 0, total: r.progress?.total || 0 },
    cursor: r.cursor || 0,
    undo: {
      status: r.undo?.status || null,
      summary: r.undo?.summary
        ? {
            putBack: r.undo.summary.putBack || 0,
            changedSince: r.undo.summary.changedSince || 0,
            restoredOnProfile: r.undo.summary.restoredOnProfile || 0,
            waiting: r.undo.summary.waiting || 0,
            cleared: r.undo.summary.cleared || 0,
            erased: r.undo.summary.erased || 0,
            gone: r.undo.summary.gone || 0,
            names: (r.undo.summary.names || []).map((n) => ({ voterId: n.voterId ? String(n.voterId) : null, voterName: n.voterName, reason: n.reason, detail: n.detail || null })),
            namesTotal: r.undo.summary.namesTotal || 0,
          }
        : null,
      passes: r.undo?.passes || 0,
      error: r.undo?.error || null,
      lastRunAt: r.undo?.lastRunAt || null,
      waitingForWorker: r.undo?.status === 'pending' && r.undo?.requestedAt && now - new Date(r.undo.requestedAt).getTime() > WAIT_MS,
    },
    waitingForWorker: r.status === 'pending' && now - new Date(r.updatedAt || r.createdAt).getTime() > WAIT_MS,
    samples: (r.samples || []).map((s) => ({ voterId: s.voterId ? String(s.voterId) : null, voterName: s.voterName, reason: s.reason })),
    samplesTruncated: !!r.samplesTruncated,
    samplesTotal: r.samplesTotal || 0,
    error: r.error || null,
    createdAt: r.createdAt,
    completedAt: r.completedAt || null,
    editedAt: r.editedAt,
    by,
  };
};
