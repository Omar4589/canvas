import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { AnswerEditRun } from '../../models/AnswerEditRun.js';
import { AnswerEditRunChunk, ANSWER_EDIT_CHUNK_ITEMS } from '../../models/AnswerEditRunChunk.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { Pass } from '../../models/Pass.js';
import { Effort } from '../../models/Effort.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { UnknockRunChunk } from '../../models/UnknockRunChunk.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { Voter } from '../../models/Voter.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { getQueue, QUEUE_NAMES, queueOp } from '../../queues/index.js';
import { applyChunk, countChunk, undoRunPass, emptyCounts } from './answerEditWriter.js';
import { isRecutLocked } from '../turf/recutLock.js';
import { hydrateCanvassers } from '../reports/canvasserIdentity.js';
import { DOOR_STATUS_LABELS } from '../../utils/statusPrecedence.js';
import { sweepIfDeleting, sweptAfter } from '../platform/lateWriteSweep.js';
import { UNKNOCK_REMOVING } from './unknockLease.js';
import { FRESH_STEP } from './stepCount.js';
import { settleStalledConversions } from './surveyConversion.js';

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
// A door-by-door conversion step is one request; a stamp older than this belongs to one that died.
export { STEP_FRESH_MS } from './stepCount.js';

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

/**
 * After an enqueue that timed out: park the run as stopped ONLY if its job never started (still
 * pending under that job id), and forget the job id — the admin is told nothing changed, so a late
 * delivery must not be able to claim it. Returns the parked run, or null when the job started after
 * all (the change is running; say that instead).
 */
export const parkUnqueued = async (runId, error) => {
  const run = await AnswerEditRun.findById(runId, { queueJobId: 1 }).lean();
  return AnswerEditRun.findOneAndUpdate(
    { _id: runId, status: 'pending', queueJobId: run?.queueJobId ?? null },
    { $set: { status: 'failed', queueJobId: null, error } },
    { new: true }
  ).lean();
};

/** The same for an undo: back to its prior state, job id included, unless the pass already started. */
export const parkUnqueuedUndo = async (runId, prior) => {
  const run = await AnswerEditRun.findById(runId, { undo: 1 }).lean();
  return AnswerEditRun.findOneAndUpdate(
    { _id: runId, 'undo.status': 'pending', 'undo.jobId': run?.undo?.jobId ?? null },
    {
      $set: {
        'undo.status': prior.status,
        'undo.requestedAt': prior.requestedAt,
        'undo.requestedBy': prior.requestedBy,
        'undo.jobId': prior.jobId ?? null,
      },
    },
    { new: true }
  ).lean();
};

// ---------------------------------------------------------------------------
// One change at a time per campaign (§F, §H2)
// ---------------------------------------------------------------------------

const EDIT_BUSY = (campaignId, exceptRunId = null) => ({
  campaignId,
  ...(exceptRunId ? { _id: { $ne: exceptRunId } } : {}),
  $or: [
    { status: { $in: ['pending', 'running', 'open'] } },
    { 'undo.status': { $in: ['pending', 'running'] } },
    // A one-person step still saving after its session was stopped.
    FRESH_STEP(),
  ],
});

/**
 * Is a write of this answer-edit run's still possibly in flight, so its copies must not be erased?
 * A queued or running change only while it shows signs of life — ten minutes without a heartbeat
 * reads stalled on its card (Start again), and its Erase was refused for good (round 4).
 */
export const runStillWriting = async (runId) =>
  !!(await AnswerEditRun.exists({
    _id: runId,
    $or: [
      { mode: 'bulk', status: { $in: ['pending', 'running'] }, updatedAt: { $gte: new Date(Date.now() - WAIT_MS) } },
      FRESH_STEP(),
    ],
  }));

/** Is an answer edit's apply or undo running (or a one-person session open) on this campaign? */
export const answerEditBusy = (campaignId) => AnswerEditRun.exists(EDIT_BUSY(campaignId));

/** The refusal the OTHER Door Outcomes acts send while an answer edit is running. */
export const ANSWER_EDIT_BUSY_ERROR = {
  error:
    'An answer edit is still running on this campaign (or a one-person-at-a-time session is open). Let it finish, or press Stop here on its row, then try again.',
  code: 'ANOTHER_CHANGE_RUNNING',
};

// A conversion holding the campaign: pending, running or being undone, or a door-by-door step in flight.
const conversionBusy = (campaignId, exceptConversionId = null) =>
  SurveyConversionRun.exists({
    campaignId,
    ...(exceptConversionId ? { _id: { $ne: exceptConversionId } } : {}),
    $or: [
      { status: { $in: ['pending', 'running', 'reverting'] } },
      // A door-by-door step in flight, whatever the session's status (it counts itself in and out).
      FRESH_STEP(),
    ],
  });
// ...unless the busy one is a conversion nobody is working on any more: settled, it holds nothing
// (surveyConversion.js settleStalledConversion — round 9: one left busy by two failures in a row
// refused every change on the campaign for good).
const conversionStillBusy = async (campaignId, exceptConversionId = null) =>
  (await conversionBusy(campaignId, exceptConversionId)) &&
  (!(await settleStalledConversions(campaignId, { exceptConversionId })) || (await conversionBusy(campaignId, exceptConversionId)));

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
    conversionStillBusy(campaignId),
    // Still removing — its strike beat lately, however long it has run (unknockLease.js, round 4).
    UnknockRun.exists({ campaignId, ...UNKNOCK_REMOVING() }),
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

/**
 * Why a REMOVAL — an unknock or a survey conversion — can't start, step or be undone right now: another
 * removal is still writing on the campaign. A conversion pending, running or being undone, or with a
 * door-by-door step in flight; an unknock still removing or being undone. None of them writes through a
 * compare-and-swap (they read, archive, then delete or flip by id), so two interleaving on one visit put
 * answers back under a door the other was clearing, or put back what the other had just removed (code
 * review round 6). Nor while a round's knocks are being cleared or restored: a clear-knocks discard
 * snapshots a round and then deletes it, and an undo landing in between was lost from every tool — the
 * run read Undone, its entries gone, its answers held as unknocked (round 7); only a lock taken for the
 * knocks counts (`recutLock.knocks` — round 8: any re-cut, a draft delete or a long claim re-carve held
 * every removal back), and the discard and the restore check this after taking theirs (`exceptRecut`:
 * the lock they hold is their own). The caller's own run is left out. Answer edits have
 * their own check (answerEditBusy).
 */
export const removalBusy = async (campaignId, { exceptUnknockId = null, exceptConversionId = null, exceptRecut = false } = {}) => {
  const recent = new Date(Date.now() - WAIT_MS);
  const [conversion, unknock, passes] = await Promise.all([
    conversionStillBusy(campaignId, exceptConversionId),
    UnknockRun.exists({
      campaignId,
      ...(exceptUnknockId ? { _id: { $ne: exceptUnknockId } } : {}),
      $or: [UNKNOCK_REMOVING(), { revertingAt: { $gte: recent }, revertedAt: null }],
    }),
    exceptRecut ? [] : Pass.find({ campaignId }, { recutLock: 1 }).lean(),
  ]);
  if (conversion) return { error: 'A survey conversion is still running on this campaign. Let it finish, then try again.', code: 'ANOTHER_CHANGE_RUNNING' };
  if (unknock) return { error: 'An unknock is still running on this campaign (removing entries, or being undone). Let it finish, then try again.', code: 'ANOTHER_CHANGE_RUNNING' };
  const staleBefore = new Date(Date.now() - RECUT_STALE_MS);
  if (passes.some((p) => p.recutLock?.knocks && p.recutLock?.lockedAt && new Date(p.recutLock.lockedAt) >= staleBefore)) {
    return { error: 'A round on this campaign is having its knocks cleared or restored right now. Try again in a minute.', code: 'ANOTHER_CHANGE_RUNNING' };
  }
  return null;
};

/**
 * Why a removal's Undo (an unknock's, a conversion's, a relabel's) must wait: a round it touched had its
 * knocks cleared after it, and the snapshot that can bring them back is unrestored. Undone now, the undo
 * finds nothing of the round's to take back, and the restore later brings the change's own work back
 * verbatim — a door stamped by an undone conversion, out of every tool's reach (code review round 8). Only
 * a snapshot its round can still take back holds the Undo: the round on file, not archived, and knocked
 * nowhere since — a round knocked again would get the old entries beside the new, and the restore failed
 * part-way (round 9: the refusal sent admins to exactly that restore, and held an Undo for good once the
 * round was deleted or archived). Past any other, the round's cleared work is gone with its snapshot: the
 * Undo goes ahead and leaves that round alone (unknock.js), and the restore refuses for good once the
 * change is undone (turfs.js). A conversion or a relabel is matched by what the snapshot holds of its own
 * (its stamped entries, its desk answers, its copies); an unknock, whose entries were already gone, by the
 * rounds it struck. By round and time, on the snapshots' own index: only snapshots made after the run are
 * read. Returns the round's name and when it was cleared, or null.
 */
export const roundClearedSince = async (campaignId, { unknock = null, conversion = null }) => {
  const run = unknock || conversion;
  let passIds;
  let match = {};
  if (conversion) {
    passIds = await Pass.distinct('_id', { campaignId });
    match = { $or: [{ 'activities.reclassified.runId': run._id }, { 'responses.deskEntry.runId': run._id }, { 'responseArchives.conversionRunId': run._id }] };
  } else {
    const keys = (await UnknockRunChunk.find({ runId: run._id }, { visitKeys: 1 }).lean()).flatMap((c) => c.visitKeys || []);
    passIds = [...new Set(keys.map((k) => k.split('|')[1]).filter((p) => p && p !== 'null'))].map((id) => new mongoose.Types.ObjectId(id));
  }
  if (!passIds.length) return null;
  const snaps = await TurfSnapshot.find(
    { campaignId, clearedKnocks: true, restoredAt: null, createdAt: { $gt: run.createdAt }, passId: { $in: passIds }, ...match },
    { passId: 1, createdAt: 1 }
  )
    .sort({ createdAt: 1 })
    .lean();
  for (const snap of snaps) {
    const pass = await Pass.findOne({ _id: snap.passId, campaignId, status: { $ne: 'archived' } }, { name: 1, roundNumber: 1, effortId: 1 }).lean();
    if (!pass || (await CanvassActivity.exists({ passId: snap.passId }))) continue;
    const effort = pass.effortId ? await Effort.findById(pass.effortId, { name: 1 }).lean() : null;
    const round = pass.name || `Round ${pass.roundNumber}`;
    return { passId: snap.passId, at: snap.createdAt, round: effort?.name ? `${effort.name} · ${round}` : round };
  }
  return null;
};
// The refusal, naming the round and the day its knocks were cleared (round 9: with several walk lists the
// admin searched every round's snapshots, one of them past the ten Turf Cutting lists).
export const roundClearedRefusal = ({ round, at }, campaign) => {
  let day;
  try {
    day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: campaign?.timeZone || 'America/New_York' }).format(at);
  } catch {
    day = new Date(at).toISOString().slice(0, 10);
  }
  return {
    error: `${round} had its knocks cleared on ${day}, after this change, and that snapshot can still be restored — so this can't be undone yet. Restore it on Turf Cutting (Undo / snapshots), discarding the round's new books first if it has any, then undo this change.`,
    code: 'ROUND_CLEARED_SINCE',
  };
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
  // A one-person session's summary already counts each question's surveys; a step that was still
  // saving when the session stopped is one more.
  if (run.mode === 'queue') {
    const summary = run.planSummary || 'Survey answers edited one at a time';
    return more ? `${summary} (${plural(n, 'more survey')})` : summary;
  }
  const summary = run.planSummary || 'Survey answers edited';
  return `${summary} (${more ? plural(n, 'more survey') : plural(n, 'survey')})`;
};

// A tenant being deleted — checked before each chunk and again before every History row, so a change
// an organization's deletion catches never writes a row after the cascade swept that collection.
const tenantDeleting = async (run) => {
  const [campaign, org] = await Promise.all([
    Campaign.findById(run.campaignId, { deletion: 1 }).lean(),
    Organization.findById(run.organizationId, { deletion: 1 }).lean(),
  ]);
  return !campaign || !!campaign.deletion?.requestedAt || !!org?.deletion?.requestedAt;
};

// History rows go through a small ledger on the run, so a crash, a redelivery or a racing caller
// can neither lose a row nor log one twice (code review round 2: the count moved before the insert,
// so an insert that failed was never retried). A row's id is derived from the run, its phase and
// where its count starts — writing it again is a no-op — and the run's `historyPending` holds what
// the row says until the count has moved past it.
const historyRowId = (runId, phase, from) =>
  new ObjectId(crypto.createHash('sha1').update(`${String(runId)}|${phase}|${from}`).digest('hex').slice(0, 24));

const writeHistoryRow = (run, phase, pending, fromValue = null) =>
  CampaignChange.updateOne(
    { _id: historyRowId(run._id, phase, pending.from) },
    {
      $setOnInsert: {
        organizationId: run.organizationId,
        campaignId: run.campaignId,
        field: phase === 'undo' ? 'answerEditUndo' : 'answerEdit',
        fromValue,
        toValue: pending.line,
        byUserId: pending.by || null,
        source: 'answer_edit',
      },
    },
    { upsert: true }
  );

/**
 * Report a run's changed surveys to Campaign History: everything so far the first time, and on a
 * later call only what changed since — a run that stopped part-way is logged when it stops, and
 * again ("N more surveys") when Pick up finishes it. Each segment is claimed on `historyCount`,
 * written, and only then counted.
 */
export const writeRunHistory = async (runId) => {
  for (let i = 0; i < 5; i += 1) {
    let run = await AnswerEditRun.findById(runId, {
      organizationId: 1, campaignId: 1, byUserId: 1, mode: 1, planSummary: 1, counts: 1, historyCount: 1, historyPending: 1,
    }).lean();
    if (!run) return;
    let pending = run.historyPending;
    if (!pending) {
      const total = run.counts?.surveysChanged || 0;
      const from = run.historyCount || 0;
      if (total <= from) return;
      run = await AnswerEditRun.findOneAndUpdate(
        { _id: runId, historyCount: from === 0 ? { $in: [0, null] } : from, historyPending: null },
        { $set: { historyPending: { from, to: total, line: historyLine(run, total - from, from > 0), by: run.byUserId } } },
        { new: true }
      ).lean();
      if (!run) continue; // another caller moved it: read again
      pending = run.historyPending;
    }
    if (await tenantDeleting(run)) return;
    await writeHistoryRow(run, 'apply', pending);
    // A deletion stamped between that check and the row: the row is swept with the tenant's.
    if (await sweepIfDeleting(run)) return;
    await AnswerEditRun.updateOne(
      { _id: runId, 'historyPending.from': pending.from, 'historyPending.to': pending.to },
      { $set: { historyCount: pending.to, historyPending: null } }
    );
  }
};

/**
 * The undo's History: one row for its first pass whatever it put back (an undo that kept every
 * survey's newer answers is still an undo someone pressed), and after that a row only for what a
 * later pass adds. Counted from the cumulative summary, so a pass cut off part-way, a redelivery and
 * two deliveries at once each log every put-back once (round 2). Only the pass that owns the undo
 * claims a new row; any pass finishes one already claimed.
 */
const writeUndoHistory = async (runId, jobId, summary, legacyCredited = 0) => {
  for (let i = 0; i < 5; i += 1) {
    let run = await AnswerEditRun.findById(runId, {
      organizationId: 1, campaignId: 1, byUserId: 1, planSummary: 1, undo: 1,
    }).lean();
    if (!run) return;
    let pending = run.undo?.historyPending;
    if (!pending) {
      if (run.undo?.jobId !== String(jobId)) return; // superseded: the owning pass logs
      // Logged so far: the ledger's count, or — an undo the first build began, whose every pass
      // logged its own put-backs — the put-backs credited to it (round 3: its stored summary counted
      // only its last pass, and the rest were logged again). After exactly one finished pass of the
      // first build, that pass's own summary is exact — it logged what it counted — so a put-back a
      // later first-build pass made before it died is reported, not taken as logged (round 5); but no
      // more than this pass can still prove, or one put back and changed since drops out of `to` and
      // takes a new put-back's row with it (round 6).
      const stored = run.undo?.historyLogged;
      const firstBuildOnePass = !run.undo?.receipts && run.undo?.passes === 1 && Number.isFinite(run.undo?.summary?.putBack);
      const logged = stored ?? (firstBuildOnePass ? Math.min(run.undo.summary.putBack, legacyCredited) : run.undo?.passes > 0 ? legacyCredited : null);
      const to = summary.putBack;
      if (logged != null && to <= logged) return;
      const from = logged == null ? -1 : logged;
      run = await AnswerEditRun.findOneAndUpdate(
        { _id: runId, 'undo.jobId': String(jobId), 'undo.historyPending': null, 'undo.historyLogged': stored ?? null },
        {
          $set: {
            'undo.historyPending': {
              from,
              to,
              line: undoLine({ ...summary, putBack: to - Math.max(0, from) }),
              // Whoever pressed Undo; a run undone before the field existed falls back to its author.
              by: run.undo?.requestedBy || run.byUserId,
            },
          },
        },
        { new: true }
      ).lean();
      if (!run) continue;
      pending = run.undo.historyPending;
    }
    if (await tenantDeleting(run)) return;
    await writeHistoryRow(run, 'undo', pending, run.planSummary || null);
    if (await sweepIfDeleting(run)) return;
    await AnswerEditRun.updateOne(
      { _id: runId, 'undo.historyPending.from': pending.from, 'undo.historyPending.to': pending.to },
      { $set: { 'undo.historyLogged': pending.to, 'undo.historyPending': null } }
    );
  }
};

/**
 * For the delete cascades: wait (bounded) until no Door Outcomes change of this tenant is mid-write —
 * an answer edit or its undo, a conversion or its undo, a one-person or door-by-door step, an unknock
 * or its undo. The jobs stop at their next batch once their campaign or organization is being
 * deleted, and the rest are single requests, so this is seconds. Called BEFORE the cascade's first
 * sweep (round 3: waiting only before the last one let a conversion write a survey after the sweep had
 * passed it, and a re-created survey outlived the deletion); heartbeats while it waits.
 */
export const waitForDoorOutcomesToStop = async (
  tenant,
  { heartbeat = () => {}, maxMs = Number(process.env.DOOR_OUTCOMES_DELETE_WAIT_MS) || 60 * 1000, everyMs = 500 } = {}
) => {
  const until = Date.now() + maxMs;
  for (;;) {
    const now = Date.now();
    const recent = { $gte: new Date(now - WAIT_MS) };
    const stepping = FRESH_STEP(now);
    const busy = (
      await Promise.all([
        AnswerEditRun.exists({
          ...tenant,
          $or: [{ status: 'running', updatedAt: recent }, { 'undo.status': 'running', updatedAt: recent }, stepping],
        }),
        SurveyConversionRun.exists({ ...tenant, $or: [{ status: { $in: ['running', 'reverting'] }, updatedAt: recent }, stepping] }),
        UnknockRun.exists({ ...tenant, $or: [UNKNOCK_REMOVING(now), { revertingAt: recent }] }),
      ])
    ).some(Boolean);
    heartbeat();
    if (!busy || Date.now() >= until) return !busy;
    await new Promise((r) => setTimeout(r, everyMs));
  }
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
  if (await tenantDeleting(run)) throw new StopRun('tenant-deleting');
  // A round being re-cut: wait it out (BullMQ's retry backoff) rather than race its two reads. If
  // the re-cut outlasts the retries, the run stops and says what to press.
  const passIds = [...new Set((chunk?.items || []).map((it) => (it.p ? String(it.p) : null)).filter(Boolean))];
  for (const p of passIds) {
    if (await isRecutLocked(p)) {
      throw new Error(
        field === 'queueJobId'
          ? 'A round in this change was being re-cut, so the change paused. Press Pick up where it stopped once the re-cut is done.'
          : 'A round in this change was being re-cut, so the undo paused. Press Retry undo once the re-cut is done.'
      );
    }
  }
};

/**
 * A chunk's done-write: counted from the database, not from what this delivery did (countChunk),
 * by compare-and-swap on `countRev` — re-read and recounted on a miss — so a copy another delivery
 * recorded as landed (`a`) is never written away, and the last delivery to finish has every
 * delivery's work in its counts (round 3). Never over a chunk an undo has fenced: what it read there
 * is what it classified.
 */
const recordChunk = async (run, chunkId, mine) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await AnswerEditRunChunk.findById(chunkId, { items: 1, countRev: 1, fenced: 1 }).lean();
    if (!current || current.fenced) return;
    const merged = (current.items || []).map((it, i) => {
      const a = it.a || mine[i]?.a;
      const { a: _drop, ...rest } = it;
      return a ? { ...rest, a } : rest;
    });
    const { counts, items } = await countChunk({ run, items: merged });
    counts.items = items.length;
    const r = await AnswerEditRunChunk.updateOne(
      { _id: chunkId, fenced: { $ne: true }, countRev: current.countRev ?? { $exists: false } },
      { $set: { done: true, counts, items }, $inc: { countRev: 1 } }
    );
    if (r.matchedCount === 1) return;
  }
  console.error(`[answer-edits] chunk ${chunkId} could not record its counts after 10 tries`);
};

const runApply = async (job) => {
  const runId = job.data.runId;
  const claimed = await AnswerEditRun.findOneAndUpdate(
    { _id: runId, queueJobId: String(job.id), 'undo.status': null, status: { $in: ['pending', 'running', 'failed'] } },
    { $set: { status: 'running', error: null } },
    { new: true }
  ).lean();
  // When the change first started (`$min` can't do this: a null sorts below every date).
  if (claimed && !claimed.startedAt) await AnswerEditRun.updateOne({ _id: runId, startedAt: null }, { $set: { startedAt: new Date() } });
  if (!claimed) {
    // A redelivery after the run completed: finish a History row a crash may have cut off.
    const r = await AnswerEditRun.findById(runId, { status: 1 }).lean();
    if (r?.status === 'completed') await writeRunHistory(runId);
    return { skipped: 'not-claimable' };
  }
  const chunks = await AnswerEditRunChunk.find({ runId, done: { $ne: true } }).sort({ seq: 1 }).lean();
  try {
    for (const chunk of chunks) {
      await mayContinue(runId, job.id, chunk);
      const out = await applyChunk({ run: claimed, chunk });
      // An undo reached this chunk while this delivery worked on it: it owns these surveys now.
      if (out.fenced) throw new StopRun('undo-started');
      await recordChunk(claimed, chunk._id, out.items);
      const rolled = await rollUp(runId);
      if (job.updateProgress) await job.updateProgress(Math.round(((rolled.progress?.done || 0) / Math.max(1, rolled.progress?.total || 1)) * 100)).catch(() => {});
    }
  } catch (err) {
    if (err instanceof StopRun) {
      // A campaign or organization being deleted stops the change for good: it reads Stopped, never
      // "Working" forever (that blocked every change on the campaign, with no button to press) — and
      // what its last batch wrote is swept with the tenant's (lateWriteSweep.js, round 3).
      if (err.message === 'tenant-deleting') {
        await AnswerEditRun.updateOne(
          { _id: runId, queueJobId: String(job.id), status: 'running' },
          { $set: { status: 'failed', error: 'The campaign or organization is being deleted, so this change stopped.' } }
        );
      }
      return { stopped: err.message };
    }
    throw err;
  }
  await rollUp(runId);
  // History before "completed": a redelivery can't claim a completed run, so a crash between the two
  // in the other order lost the row for good.
  await writeRunHistory(runId);
  await AnswerEditRun.updateOne(
    { _id: runId, queueJobId: String(job.id), status: 'running' },
    { $set: { status: 'completed', completedAt: new Date() } }
  );
  return { completed: true };
};

// The names an undo pass stores: the voter's, and the detail as ids and dates — never a user's name
// (see AnswerEditRun's nameSchema). undoWords turns the detail into words at read time.
const hydrateUndoNames = async (names) => {
  if (!names.length) return [];
  const voters = await Voter.find({ _id: { $in: names.map((n) => n.voterId) } }, { fullName: 1 }).lean();
  const vName = new Map(voters.map((v) => [String(v._id), v.fullName]));
  const detailOf = (d) =>
    d && d.kind ? { kind: d.kind, by: d.by ? new ObjectId(String(d.by)) : null, at: d.at || null, ...(d.to ? { to: d.to } : {}) } : null;
  return names.map((n) => ({ voterId: n.voterId, voterName: vName.get(String(n.voterId)) || 'Voter', reason: n.reason, detail: detailOf(n.detail) }));
};

/**
 * The words of a run's stored undo names, written now: "re-surveyed by ‹name›" through the same
 * identity hydration every other surface uses — a deleted account reads as every report reads it:
 * the name its deletion snapshot keeps for the retention window, then "Deleted user"; an id with no
 * account at all reads "a removed user" — and dates in the campaign's zone. A detail with no one on
 * it (one the words scrub rewrote) reads without a name.
 */
export const undoWords = async (run, names) => {
  if (!names?.length) return [];
  const structured = names.filter((n) => n.detail && typeof n.detail === 'object');
  const people = structured.length
    ? await hydrateCanvassers(structured.map((n) => n.detail.by).filter(Boolean), run.organizationId)
    : new Map();
  const campaign = structured.length ? await Campaign.findById(run.campaignId, { timeZone: 1 }).lean() : null;
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: campaign?.timeZone || 'America/New_York' });
  const day = (d) => (d ? fmt.format(new Date(d)) : '');
  const who = (id) => {
    const u = id ? people.get(String(id)) : null;
    return u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || 'a removed user' : 'a removed user';
  };
  const words = (n) => {
    const d = n.detail;
    if (!d) return null;
    if (typeof d === 'string') return d;
    if (n.reason === 'waiting') return d.kind === 'unknock' ? `Unknock, ${day(d.at)}` : `Surveyed → ${DOOR_STATUS_LABELS[d.to] || 'Not home'}, ${day(d.at)}`;
    if (n.reason === 'changed_since') {
      if (d.kind === 'resurveyed') return d.by ? `re-surveyed by ${who(d.by)}` : 're-surveyed';
      if (d.kind === 'edited') return d.by ? `edited by ${who(d.by)}` : 'edited';
    }
    return null;
  };
  return names.map((n) => ({ voterId: n.voterId ? String(n.voterId) : null, voterName: n.voterName, reason: n.reason, detail: words(n) }));
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
  const before = await AnswerEditRun.findOneAndUpdate(
    { _id: runId, 'undo.jobId': String(job.id), 'undo.status': { $in: ['pending', 'running', 'failed'] }, status: { $in: ['completed', 'failed'] } },
    // lastRunAt is the pass's heartbeat (touched per chunk): an undo silent for 10 minutes reads
    // stalled and offers Start again.
    { $set: { 'undo.status': 'running', 'undo.error': null, 'undo.lastRunAt': new Date() } },
    { new: false }
  ).lean();
  if (!before) return { skipped: 'not-claimable' };
  // An undo the first build began wrote no receipts, so its put-backs are read another way until a
  // pass of this build finishes (undoRunPass's legacy reading): one that finished a pass, or one it
  // began and that died inside its first — it left `running` (or, after the failed listener,
  // `failed`) with no `lastRunAt`, which only a finished pass of the first build and every claim of
  // this one write (round 5: round 4 looked for a `startedAt` the first build never managed to set —
  // its `$min` over null left it null). Retry undo overwrites that status, so the revert route keeps
  // the reading on the run (`undo.legacy`); a redelivered first-build job still shows it here.
  const legacy =
    !before.undo?.receipts &&
    (!!before.undo?.legacy ||
      (before.undo?.passes || 0) > 0 ||
      (!before.undo?.writesReceipts && !before.undo?.lastRunAt && ['running', 'failed'].includes(before.undo?.status)));
  if (legacy && !before.undo?.legacy) await AnswerEditRun.updateOne({ _id: runId, 'undo.jobId': String(job.id) }, { $set: { 'undo.legacy': true } });
  if (!before.undo?.startedAt) {
    await AnswerEditRun.updateOne({ _id: runId, 'undo.startedAt': null }, { $set: { 'undo.startedAt': new Date() } });
  }
  const claimed = await AnswerEditRun.findById(runId).lean();
  if (!claimed) return { skipped: 'run-gone' };
  const chunks = await AnswerEditRunChunk.find({ runId }).sort({ seq: 1 }).lean();
  let pass;
  try {
    await mayContinue(runId, job.id, { items: chunks.flatMap((c) => c.items || []) }, 'undo.jobId');
    pass = await undoRunPass({
      run: claimed,
      chunks,
      legacy,
      beforeChunk: async (chunk) => {
        await mayContinue(runId, job.id, chunk, 'undo.jobId');
        await AnswerEditRun.updateOne({ _id: runId, 'undo.jobId': String(job.id) }, { $set: { 'undo.lastRunAt': new Date() } });
      },
    });
  } catch (err) {
    if (err instanceof StopRun) {
      if (err.message === 'tenant-deleting') {
        await AnswerEditRun.updateOne(
          { _id: runId, 'undo.jobId': String(job.id), 'undo.status': 'running' },
          { $set: { 'undo.status': 'failed', 'undo.error': 'The campaign or organization is being deleted, so this undo stopped.' } }
        );
      }
      return { stopped: err.message };
    }
    throw err;
  }
  const { summary, names, namesTotal, legacyCredited } = pass;
  // History first: what this undo has put back that History hasn't reported yet (the ledger above).
  await writeUndoHistory(runId, job.id, summary, legacyCredited);
  const hydrated = await hydrateUndoNames(names);
  await AnswerEditRun.updateOne(
    { _id: runId, 'undo.jobId': String(job.id) },
    {
      $set: {
        'undo.status': 'done',
        'undo.lastRunAt': new Date(),
        'undo.summary': { ...summary, names: hydrated, namesTotal },
        // From here every put-back has a receipt or its item's `u` (the legacy reading is done).
        'undo.receipts': true,
      },
      $inc: { 'undo.passes': 1 },
    }
  );
  return { undone: true, summary };
};

/**
 * BullMQ processor for answer-edit-queue: 'apply' or 'undo'. Either is swept after on a campaign or
 * organization being deleted, however it ends — a batch that stalled past the delete cascade writes
 * after its last sweep (lateWriteSweep.js, round 3).
 */
export const processAnswerEditJob = async (job) => {
  if (!job?.data?.runId) return { skipped: 'no-run' };
  const go = () => (job.name === 'undo' ? runUndo(job) : runApply(job));
  const tenant = await AnswerEditRun.findById(job.data.runId, { campaignId: 1, organizationId: 1 }).lean();
  return tenant ? sweptAfter(tenant, go) : go();
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

/**
 * Mark which of these runs have no copy on file — nothing of theirs landed, so nothing to undo
 * (`nothingOnFile`). Counts can't say it: a delivery's counts can miss a copy another delivery
 * landed (round 3), and a run the first build stopped inside its first chunk counted nothing at all.
 * One indexed `distinct` for the runs that could be empty; the rest are left unmarked.
 */
export const markNothingOnFile = async (runs) => {
  const maybe = runs.filter((r) => !r.undo?.status && ['completed', 'failed'].includes(r.status) && !(r.counts?.surveysChanged > 0));
  if (!maybe.length) return runs;
  const withCopies = new Set(
    (await SurveyResponseArchive.distinct('answerEditRunId', { answerEditRunId: { $in: maybe.map((r) => r._id) } })).map(String)
  );
  for (const r of maybe) r.nothingOnFile = !withCopies.has(String(r._id));
  return runs;
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
    // The page checks it before following a run an action answered with (a reply that lands after
    // a campaign switch belongs to the campaign the admin left).
    campaignId: r.campaignId ? String(r.campaignId) : null,
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
            // Words for the detail are written per request (undoWords — the routes that show names
            // call it); a stored structure never goes out as-is, a pre-fix string does.
            names: (r.undo.summary.names || []).map((n) => ({
              voterId: n.voterId ? String(n.voterId) : null,
              voterName: n.voterName,
              reason: n.reason,
              detail: typeof n.detail === 'string' ? n.detail : null,
            })),
            namesTotal: r.undo.summary.namesTotal || 0,
          }
        : null,
      passes: r.undo?.passes || 0,
      error: r.undo?.error || null,
      lastRunAt: r.undo?.lastRunAt || null,
      waitingForWorker: r.undo?.status === 'pending' && r.undo?.requestedAt && now - new Date(r.undo.requestedAt).getTime() > WAIT_MS,
      // Running with no heartbeat for 10 minutes: its job is gone (a lost queue entry, a worker that
      // died without a retry). Start again re-queues it.
      stalled: r.undo?.status === 'running' && now - new Date(r.undo?.lastRunAt || r.undo?.startedAt || r.updatedAt).getTime() > WAIT_MS,
    },
    waitingForWorker: r.status === 'pending' && now - new Date(r.updatedAt || r.createdAt).getTime() > WAIT_MS,
    stalled: r.status === 'running' && now - new Date(r.updatedAt || r.createdAt).getTime() > WAIT_MS,
    samples: (r.samples || []).map((s) => ({ voterId: s.voterId ? String(s.voterId) : null, voterName: s.voterName, reason: s.reason })),
    samplesTruncated: !!r.samplesTruncated,
    samplesTotal: r.samplesTotal || 0,
    error: r.error || null,
    createdAt: r.createdAt,
    // Null on a change the worker never took (its queue timed out).
    startedAt: r.startedAt || null,
    // No copy of this change's is on file: nothing landed, so there is nothing to undo — Pick up is
    // its only button (markNothingOnFile; absent when the route didn't ask).
    nothingOnFile: r.nothingOnFile === true,
    completedAt: r.completedAt || null,
    editedAt: r.editedAt,
    by,
  };
};
