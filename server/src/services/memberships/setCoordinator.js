import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { CampaignAssignment } from '../../models/CampaignAssignment.js';
import { CoordinatorChange } from '../../models/CoordinatorChange.js';
import { Membership } from '../../models/Membership.js';
import { User } from '../../models/User.js';
import { restampLedgerCoordinator, previewRestamp, planSources } from './restampCoordinator.js';
import { sweptAfter } from '../platform/lateWriteSweep.js';

// THE choke point for changing a person's crew, within ONE campaign.
//
// Every surface that sets a crew goes through here — the campaign Team tab on web, the mobile crew
// screen, the bulk Move to crew, and every way back onto a campaign roster (joinCampaignCrew) — so
// the ledger re-stamp cannot be forgotten by a new caller. test/coordinatorChokePoint.test.js asserts
// structurally that only this file and its sanctioned siblings write CampaignAssignment.coordinatorId.
//
// resolveCoordinatorId() is deliberately NOT this seam: it is a pure validator that performs no
// write, and the routes run it before anything is written.
//
// ── ONE JOB PER CHANGE, KEPT ON THE ROSTER ROW ─────────────────────────────────────────────────────
// A crew change re-stamps two ledgers with no transaction available (the test harness is a
// standalone mongod), so it can be cut off halfway, and two changes to one person can interleave. So
// every change is one job, noted on the person's roster row (CampaignAssignment.crewJob) in the same
// write that changes the crew (docs/PROPOSAL_PEOPLE_PAGES.md §B.6):
//   1. plan   — what would move, by source team, on both ledgers (no writes);
//   2. claim  — one conditional updateOne: the crew is still what the caller saw (`from`) and no
//               other job holds the row; it sets the crew and the job (token, run, a 150 s hold);
//   3. ledger — the two updateManys, each after a renewal of the hold; a run that lost its hold stops
//               without writing; a second pass ~2 s later catches a knock that read the old crew;
//   4. record — the CoordinatorChange, _id = the job's token; then the release ($unset crewJob).
// A run cut off anywhere leaves the job on the row. Its hold runs out by itself, and then the
// person's panel offers Finish it, which re-runs steps 3-4 under a fresh `run`.
//
// The counterpart rule is unchanged: DEPARTURE never re-stamps (services/users/deleteAccount.js
// releaseAssignedWork clears the crew and the job, and leaves the ledger alone — the 104-door fix).

// Timings. Mutable so integration tests can shrink them; the hold must always outlast a renewal's
// own wait, a connection wait (server.js waitQueueTimeoutMS, 30 s) and one ledger write (maxTimeMS).
export const CREW_JOB = {
  holdMs: 150_000,
  ledgerMaxMs: 60_000,
  secondPassMs: 2_000,
  // A renewal set its `until` before it waited for a connection; one that took longer than this to
  // come back is treated as lost, which keeps the next write inside the hold.
  slowRenewalMs: 30_000,
  // How many people's jobs one request runs at once.
  sideBySide: 4,
};

const idOf = (v) => (v ? String(v) : null);
const same = (a, b) => idOf(a) === idOf(b);
const jobOf = (row) => (row?.crewJob?.token ? row.crewJob : null);
const isHeld = (job, now = new Date()) => !!job && new Date(job.until).getTime() >= now.getTime();
const secondsLeft = (job, now = new Date()) => Math.max(1, Math.ceil((new Date(job.until).getTime() - now.getTime()) / 1000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class LostHold extends Error {
  constructor() {
    super('lost-hold');
    this.code = 'LOST_HOLD';
  }
}

const noChange = (extra = {}) => ({ changed: false, activities: 0, surveys: 0, doors: 0, restampError: null, ...extra });
const busyAnswer = (job, extra = {}) => noChange({ skip: 'busy', retryAfterSeconds: secondsLeft(job), ...extra });

// 1. Plan: what would move toward `to`, by source team, and the row's job state. No writes.
export const planCrewJob = async ({ organizationId, campaignId, userId, to }) => {
  const row = await CampaignAssignment.findOne({ campaignId, userId }).lean();
  const [counts, sources] = await Promise.all([
    previewRestamp({ organizationId, userId, campaignId, coordinatorId: to }),
    planSources({ organizationId, userId, campaignId, coordinatorId: to }),
  ]);
  const job = jobOf(row);
  const now = new Date();
  return {
    row,
    job,
    from: row ? row.coordinatorId ?? null : null,
    unfinished: !!job && !isHeld(job, now),
    busy: isHeld(job, now),
    retryAfterSeconds: isHeld(job, now) ? secondsLeft(job, now) : null,
    ...counts,
    sources,
  };
};

// Whether the panel offers Finish it for a plan of the CURRENT crew: a job left unfinished, or a real
// coordinator with rows still off their team (drift). Never for crew none with no job — that is what
// every departure leaves, and conforming it is the 104-door bug.
export const finishItOffered = (plan) =>
  !!plan.row && !plan.busy && (plan.unfinished || (!plan.job && !!plan.from && plan.activities + plan.surveys > 0));

// A record's fromCoordinatorId: the one team the rows came from, or the previous crew when none moved.
const recordFrom = (job) => (job.sources?.length === 1 ? job.sources[0].coordinatorId ?? null : job.from ?? null);

const recordFields = ({ organizationId, campaignId, userId, job }) => ({
  organizationId,
  campaignId,
  userId,
  fromCoordinatorId: recordFrom(job),
  toCoordinatorId: job.to ?? null,
  byUserId: job.byUserId ?? null,
  source: job.source,
  sources: (job.sources || []).map((s) => ({
    coordinatorId: s.coordinatorId ?? null,
    activities: s.activities || 0,
    surveys: s.surveys || 0,
    doors: s.doors || 0,
    latest: s.latest || null,
  })),
  // The job's PLANNED counts — what the check showed. A write cut off by maxTimeMS reports no count of
  // its own, so these are the only honest numbers for a change that didn't finish.
  activitiesMoved: job.activities || 0,
  surveysMoved: job.surveys || 0,
  doorsMoved: job.doors || 0,
  run: job.run,
});

// The record's _id is the job's token. Mongoose drops `_id: undefined` from a filter, and the upsert
// would then match some other record, so refuse a token that isn't one.
const assertToken = (token) => {
  if (!mongoose.isValidObjectId(token)) throw new Error('crew job: refusing to write a record without a token');
};

// _id is unique, so two writers racing on one job can't make two rows. MongoDB retries an upsert that
// collides on its exact _id itself; this one retry is insurance.
const withOneRetry = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return fn();
  }
};

// The run that holds the job writes its record outright (a Finish it overwrites its own job's error
// record and clears it).
const writeRecord = async ({ organizationId, campaignId, userId, job, restampError }) => {
  assertToken(job.token);
  return withOneRetry(() =>
    CoordinatorChange.findOneAndUpdate(
      { _id: job.token },
      { $set: { ...recordFields({ organizationId, campaignId, userId, job }), restampError } },
      { upsert: true, new: true }
    ).lean()
  );
};

// A writer that does NOT hold the job — a run that lost its hold, or a claim replacing an expired job —
// writes the record only if none exists. Timestamps off, with both times set here: an existing record
// keeps its updatedAt (the client-report fence reads it), and a new one still gets times, or the next
// change's finishedBy close (by createdAt) would never match it.
const insertOnlyRecord = async ({ organizationId, campaignId, userId, job, restampError }) => {
  assertToken(job.token);
  const now = new Date();
  return withOneRetry(() =>
    CoordinatorChange.updateOne(
      { _id: job.token },
      { $setOnInsert: { ...recordFields({ organizationId, campaignId, userId, job }), restampError, createdAt: now, updatedAt: now } },
      { upsert: true, timestamps: false }
    )
  );
};

// Renew this run's hold before a write. The filter leads with campaignId + userId so it rides the
// roster's unique index (a bare crewJob filter scanned every roster row). A renewal that matched nothing
// lost the hold — to a pause longer than it, to a Finish it (new run) or to another change (new token).
// One that took too long to come back counts as lost too: its `until` was computed before it waited.
const renewHold = async ({ campaignId, userId, job }) => {
  const sentAt = new Date();
  const r = await CampaignAssignment.updateOne(
    { campaignId, userId, 'crewJob.token': job.token, 'crewJob.run': job.run, 'crewJob.until': { $gt: sentAt } },
    { $set: { 'crewJob.until': new Date(sentAt.getTime() + CREW_JOB.holdMs) } }
  );
  return r.matchedCount === 1 && Date.now() - sentAt.getTime() <= CREW_JOB.slowRenewalMs;
};

// Who can save a door on a campaign without a roster row there (routes/mobile/canvass.js
// assertHouseholdAccess): org admins and Doorline staff. Only they can have a knock in flight when
// they join a campaign.
const canKnockOffRoster = async ({ organizationId, userId }) => {
  const [admin, staff] = await Promise.all([
    Membership.exists({ userId, organizationId, role: 'admin' }),
    User.exists({ _id: userId, isSuperAdmin: true }),
  ]);
  return !!(admin || staff);
};

// 3 + 4. Ledger, record, close, release. Shared by a change, a join, a drift repair and Finish it.
//
// `secondPass`: a knock reads the person's crew, then writes its row a few milliseconds later
// (canvass.js), so one saved while the crew changed can keep the old crew. Only a claim that CHANGED
// the crew can have such stragglers; the second pass, after a short wait, moves them.
//
// It never throws for a database error: an error becomes `restampError` and the job stays on the row
// for Finish it, so a join's caller can still say the person was added. Run inside sweptAfter: a record
// that lands after the campaign's or organization's delete cascade swept CoordinatorChange (a run that
// lost its hold to the cascade's roster delete writes one) goes with the tenant (lateWriteSweep.js).
const ledgerRecordRelease = ({ organizationId, campaignId, userId, job, secondPass }) =>
  sweptAfter({ campaignId, organizationId }, async () => {
    const beforeWrite = async () => {
      if (!(await renewHold({ campaignId, userId, job }))) throw new LostHold();
    };
    const pass = () =>
      restampLedgerCoordinator({ organizationId, userId, campaignId, coordinatorId: job.to, beforeWrite, maxTimeMS: CREW_JOB.ledgerMaxMs });
    const planned = { activities: job.activities || 0, surveys: job.surveys || 0, doors: job.doors || 0 };

    // Moves no more rows, so a late write can't undo a later change, and never overwrites a record. The
    // record keeps the ledger's own error when there was one; `now` is the crew the row holds now (the
    // claim may well have landed), for the 409 that tells the client to look again.
    const lostHold = async (error) => {
      const restampError = error || 'lost-hold';
      await insertOnlyRecord({ organizationId, campaignId, userId, job, restampError }).catch(() => {});
      const row = await CampaignAssignment.findOne({ campaignId, userId }, 'coordinatorId').lean().catch(() => null);
      return noChange({ skip: 'lost-hold', ...planned, restampError, now: idOf(row?.coordinatorId) });
    };

    let restampError = null;
    try {
      await pass();
      if (secondPass) {
        await sleep(CREW_JOB.secondPassMs);
        await pass();
      }
    } catch (err) {
      if (err instanceof LostHold) return lostHold(null);
      restampError = err?.message || String(err);
    }

    // Renew once more, so the record and the release land inside the hold.
    const held = await renewHold({ campaignId, userId, job }).catch((err) => {
      restampError = restampError || `renew: ${err?.message || err}`;
      return false;
    });
    if (!held) return lostHold(restampError);

    let rec = null;
    try {
      rec = await writeRecord({ organizationId, campaignId, userId, job, restampError });
    } catch (err) {
      restampError = restampError || `record: ${err?.message || err}`;
    }
    const out = { changed: true, previous: job.from ?? null, next: job.to ?? null, ...planned, restampError };
    // On an error the job stays on the row. Its hold runs out by itself — a write still running on
    // mongod can't overlap a new one — and then Finish it.
    if (restampError) return { ...out, finished: false };

    try {
      // This person's OLDER open error records on this campaign are finished by this one.
      await CoordinatorChange.updateMany(
        { userId, campaignId, restampError: { $ne: null }, finishedBy: null, _id: { $ne: rec._id }, createdAt: { $lte: rec.createdAt } },
        { $set: { finishedBy: rec._id } }
      );
      // Release only this run's job: a stalled run that wakes during a Finish it must not clear Finish
      // it's job.
      await CampaignAssignment.updateOne(
        { campaignId, userId, 'crewJob.token': job.token, 'crewJob.run': job.run },
        { $unset: { crewJob: '' } }
      );
    } catch (err) {
      // The rows moved and the record is written; the job stays until Finish it releases it.
      return { ...out, restampError: `release: ${err?.message || err}`, finished: false };
    }
    return { ...out, finished: true };
  });

// Why a claim matched nothing. Nothing was written by it.
const whyNot = async ({ campaignId, userId }) => {
  const row = await CampaignAssignment.findOne({ campaignId, userId }).lean();
  if (!row) return null;
  const job = jobOf(row);
  if (isHeld(job)) return busyAnswer(job);
  return noChange({ skip: 'changed-meanwhile', now: idOf(row.coordinatorId) });
};

const newJob = ({ from, to, plan, actorUserId, source, now }) => ({
  token: new mongoose.Types.ObjectId(),
  run: crypto.randomUUID(),
  until: new Date(now.getTime() + CREW_JOB.holdMs),
  from: from ?? null,
  to: to ?? null,
  sources: plan.sources,
  activities: plan.activities,
  surveys: plan.surveys,
  doors: plan.doors || 0,
  byUserId: actorUserId ?? null,
  source,
});

// 2. Claim, then run. `from` is what the caller saw, or what the server just read.
const runCrewJob = async ({ organizationId, campaignId, userId, from, to, plan, actorUserId, source }) => {
  const now = new Date();
  // A claim that replaces an EXPIRED job first records it as interrupted, insert-only: otherwise a
  // crash followed by a different pick would leave no trace of the first change.
  if (plan.job && !isHeld(plan.job, now)) {
    await insertOnlyRecord({ organizationId, campaignId, userId, job: plan.job, restampError: 'interrupted' });
  }
  const job = newJob({ from, to, plan, actorUserId, source, now });
  const claim = await CampaignAssignment.updateOne(
    // $not $gte matches no job, a row from before the field existed, and a job whose hold has passed.
    { campaignId, userId, coordinatorId: from ?? null, 'crewJob.until': { $not: { $gte: now } } },
    { $set: { coordinatorId: to ?? null, crewJob: job } }
  );
  if (!claim.matchedCount) return whyNot({ campaignId, userId });
  // Stragglers need a knock in flight under the old crew, so every claim that changed the crew gets the
  // second pass — someone with no rows here yet may be saving their first door right now (§B.6 step 3).
  return ledgerRecordRelease({ organizationId, campaignId, userId, job, secondPass: !same(from, to) });
};

// Finish it: claim the unfinished job by its token once its hold has passed, with a NEW run — which is
// what stops an earlier, stalled run of the same job. The crew is not touched, so no knock can be in
// flight with an older crew, and no second pass is needed.
const finishCrewJob = async ({ organizationId, campaignId, userId, token }) => {
  assertToken(token);
  const now = new Date();
  const row = await CampaignAssignment.findOneAndUpdate(
    { campaignId, userId, 'crewJob.token': token, 'crewJob.until': { $lt: now } },
    { $set: { 'crewJob.run': crypto.randomUUID(), 'crewJob.until': new Date(now.getTime() + CREW_JOB.holdMs) } },
    { new: true }
  ).lean();
  if (!row) {
    const cur = await CampaignAssignment.findOne({ campaignId, userId }).lean();
    if (!cur) return null;
    const job = jobOf(cur);
    if (job && String(job.token) === String(token) && isHeld(job)) return busyAnswer(job);
    // Another change replaced the job; the answer shows the row as it is now.
    return noChange({ skip: 'changed-meanwhile', now: idOf(cur.coordinatorId) });
  }
  return { ...(await ledgerRecordRelease({ organizationId, campaignId, userId, job: row.crewJob, secondPass: false })), finishedJob: true };
};

// Change one person's crew on one campaign (§B.6 steps 1-7). Returns null when they aren't on it.
//
// `from`: undefined is a released client — the server uses the crew it just read; null or an id is
// what the caller previewed, and a mismatch answers `changed-meanwhile`.
export const setMemberCoordinator = async ({
  organizationId,
  userId,
  campaignId,
  coordinatorId,
  actorUserId = null,
  source,
  from: expectedFrom,
}) => {
  if (!campaignId) throw new Error('setMemberCoordinator: campaignId is required');
  const to = coordinatorId ?? null;
  const plan = await planCrewJob({ organizationId, campaignId, userId, to });
  // The crew lives on the campaign ROSTER row, so no roster row means there is nothing to set: this
  // person is not on this campaign. Callers surface that as a 404.
  if (!plan.row) return null;
  const current = plan.from;
  const tag = { previous: current, next: to };

  if (expectedFrom !== undefined && !same(expectedFrom, current)) {
    if (plan.busy) return busyAnswer(plan.job, tag);
    return noChange({ skip: 'changed-meanwhile', now: idOf(current), ...tag });
  }
  if (same(to, current)) {
    // A job on the row: finish it (busy while its hold lasts). The job always names the row's
    // current crew — every crew write outside a job clears it.
    if (plan.job) {
      if (plan.busy) return busyAnswer(plan.job, tag);
      return finishCrewJob({ organizationId, campaignId, userId, token: plan.job.token });
    }
    // A bare No-crew repeat is a silent no-op: "roster none, doors on a real team" is what every
    // departure leaves. A real coordinator with rows still off their team runs a job that moves them.
    if (!to || !(plan.activities + plan.surveys)) return noChange({ skip: 'same-crew', ...tag });
  }
  return runCrewJob({ organizationId, campaignId, userId, from: current, to, plan, actorUserId, source });
};

// Join a campaign: put someone on its roster with a crew (or none), and move their earlier doors on it
// to that crew — the owner's 2026-10-25 rule, for every role (2026-10-26). The roster insert IS the
// claim; the job rides in $setOnInsert only when there are rows to move, so a hire with no history is
// a plain insert with no job and no record. Returns { joined: false } when someone else's insert won.
export const joinCampaignCrew = async ({ organizationId, campaignId, userId, coordinatorId = null, actorUserId = null, source = 'campaign_join' }) => {
  const to = coordinatorId ?? null;
  const now = new Date();
  const insert = (extra = {}) =>
    CampaignAssignment.updateOne(
      { campaignId, userId },
      { $setOnInsert: { campaignId, userId, organizationId, assignedBy: actorUserId ?? null, assignedAt: now, coordinatorId: to, ...extra } },
      { upsert: true }
    );

  let plan;
  try {
    const [counts, sources] = await Promise.all([
      previewRestamp({ organizationId, userId, campaignId, coordinatorId: to }),
      planSources({ organizationId, userId, campaignId, coordinatorId: to }),
    ]);
    plan = { ...counts, sources };
  } catch (err) {
    // The plan threw before the insert. Fall back to a plain insert — no move, no record — so the
    // person the screen calls added is on the roster; Finish it or the team-count check finds the rest.
    const up = await insert();
    return noChange({ joined: !!up.upsertedCount, sources: [], restampError: `plan: ${err?.message || err}` });
  }

  const job = plan.activities + plan.surveys ? newJob({ from: null, to, plan, actorUserId, source, now }) : null;
  const up = await insert(job ? { crewJob: job } : {});
  if (!up.upsertedCount) return noChange({ joined: false, sources: [] });
  if (!job) return noChange({ joined: true, sources: [] });
  // From here on the person IS added, whatever fails: the caller must still say so (and send the add's
  // email), with the job left on the row for Finish it.
  try {
    // Only an org admin or Doorline staff can have a knock in flight without a roster row, and theirs
    // stamps No team — which a join to No crew already matches. So only a join to a real crew by
    // someone who can knock off the roster needs the second pass.
    const secondPass = !!to && (await canKnockOffRoster({ organizationId, userId }).catch(() => true));
    return { joined: true, sources: plan.sources, ...(await ledgerRecordRelease({ organizationId, campaignId, userId, job, secondPass })) };
  } catch (err) {
    const planned = { activities: job.activities || 0, surveys: job.surveys || 0, doors: job.doors || 0 };
    return { joined: true, sources: plan.sources, changed: true, ...planned, restampError: err?.message || String(err), finished: false };
  }
};

// The `restamp` block every assignment endpoint appends to its 200. One shape, so the org Users admin
// and the team-lead crew panel can't drift into reporting the same act differently.
export const restampSummary = (r) => ({
  changed: !!r?.changed,
  activities: r?.activities || 0,
  surveys: r?.surveys || 0,
  doors: r?.doors || 0,
  error: r?.restampError || null,
});
