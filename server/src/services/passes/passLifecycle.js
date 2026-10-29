import crypto from 'node:crypto';
import { Effort } from '../../models/Effort.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { TurfAssignment } from '../../models/TurfAssignment.js';
import { Household } from '../../models/Household.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { CampaignChange } from '../../models/CampaignChange.js';
import { acquireRecutLock, releaseRecutLock } from '../turf/recutLock.js';
import { knocksPipeline } from '../reports/aggregations.js';
import { recomputePassTerritories } from '../turf/generateTurf.js';
import { passLabel } from './passLabel.js';

// THE ONE WRITER of a pass's lifecycle and a walk list's archive state
// (docs/PROPOSAL_WALK_LIST_ARCHIVE.md): archive / unarchive a walk list, archive / bring back /
// activate a pass. Routes and the one-time repair call these; nothing else writes Pass.status,
// except createNextPass (new drafts), discard's conditional active → draft (routes/admin/turfs.js),
// the demo seeder and the delete routes.
//
// The rules, in one place:
//   - Archiving a walk list ENDS its live pass (Effort.endedPassId remembers which) and leaves its
//     drafts as drafts — frozen by the walk-list guard while it is archived.
//   - Unarchive reopens the walk list FIRST, then (if asked) brings that pass back. Never the other
//     way round: a crash in between must leave an open walk list with an ended pass (its own Bring
//     back fixes that), never an archived walk list with a live pass.
//   - Bring back works until a later pass on that walk list goes live (bringBackVerdict).
//   - Every export takes the walk list's LIFECYCLE lock once, then calls unlocked internals — the
//     lock is not re-entrant, so an export calling another export would lose to itself. Exports
//     that end or restore a pass also take that pass's recut lock, to fence book operations.

const LOCK_STALE_MS = 5 * 60 * 1000; // Pass.recutLock's staleness rule (services/turf/recutLock.js)
const REHULL_MAX_DOORS_DEFAULT = 20000; // whole-pass redraw: ~2 s at 16k doors, ~7 s at 60k (laptop)

export class LifecycleError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// For routes: answer a LifecycleError and say so; anything else is the caller's to pass on.
export const sendLifecycleError = (res, err) => {
  if (!(err instanceof LifecycleError)) return false;
  res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
  return true;
};

const busy = () =>
  new LifecycleError(409, 'lifecycle-busy', 'Someone else is changing this walk list right now. Try again in a minute.', {
    temporary: true,
  });
const recutBusy = () =>
  new LifecycleError(409, 'recut-locked', 'This pass is being re-cut, discarded or restored right now. Try again in a minute.', {
    temporary: true,
  });
const walkListMissing = () => new LifecycleError(409, 'walk-list-missing', "This pass's walk list no longer exists.");

// An effort as the routes answer it: never the lifecycle lock's token.
export const publicEffort = (doc) => {
  const { lifecycleLock, ...rest } = doc?.toObject ? doc.toObject() : doc;
  return rest;
};

export { passLabel };
const passRef = (pass) => (pass ? { _id: String(pass._id), roundNumber: pass.roundNumber, name: pass.name } : null);

// ── The lifecycle lock ──

const acquireLifecycleLock = async (effortId) => {
  const token = crypto.randomUUID();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOCK_STALE_MS);
  const res = await Effort.findOneAndUpdate(
    { _id: effortId, $or: [{ 'lifecycleLock.lockedAt': null }, { 'lifecycleLock.lockedAt': { $lt: staleBefore } }] },
    { $set: { lifecycleLock: { lockedAt: now, token } } },
    { new: true, projection: { _id: 1 } }
  ).lean();
  return res ? token : null;
};

const releaseLifecycleLock = (effortId, token) =>
  Effort.updateOne({ _id: effortId, 'lifecycleLock.token': token }, { $set: { lifecycleLock: { lockedAt: null, token: null } } });

// Exported for the walk-list and pass DELETE routes, which change a walk list's passes too.
export const withLifecycleLock = async (effortId, fn) => {
  // A pass from before walk lists existed has none to lock, and its writes were never supported here.
  if (!effortId) throw walkListMissing();
  const token = await acquireLifecycleLock(effortId);
  if (!token) {
    // The compare-and-set also misses when there is no such walk list — that's not "busy", and saying
    // "try again in a minute" would be a promise nothing keeps.
    if (!(await Effort.exists({ _id: effortId }))) throw walkListMissing();
    throw busy();
  }
  try {
    return await fn();
  } finally {
    await releaseLifecycleLock(effortId, token).catch(() => {});
  }
};

// For the DELETE routes, which answer from inside the lock: `reply` stands in for `res` there (status and
// json only), and send(res) writes it once the lock is released. A reply sent inside reached the client
// while the lock was still held, so a write sent straight after it could meet lifecycle-busy (code review
// round 2).
export const heldReply = () => {
  const held = { code: 200, body: undefined };
  const reply = {
    status: (code) => {
      held.code = code;
      return reply;
    },
    json: (body) => {
      held.body = body;
      return reply;
    },
  };
  return { reply, send: (res) => res.status(held.code).json(held.body) };
};

const withRecutLock = async (passId, userId, fn) => {
  if (!(await acquireRecutLock(passId, userId))) throw recutBusy();
  try {
    return await fn();
  } finally {
    await releaseRecutLock(passId).catch(() => {});
  }
};

// Every pass's recut lock, or none: one held lock refuses before anything is changed.
const withRecutLocks = async (passIds, userId, fn) => {
  if (!passIds.length) return fn();
  const [first, ...rest] = passIds;
  return withRecutLock(first, userId, () => withRecutLocks(rest, userId, fn));
};

// ── Bring back: the rules (pure, so GET /passes can answer for every pass from one load) ──

// When a sibling pass was last live. lastActivatedAt is stamped on every activation and bring-back
// to live; a pass from before that field existed only has activatedAt (FIRST activation, and it
// survives a discard), so it counts as live until now if it is live, else until it was archived.
export const lastLiveAt = (sibling, now = new Date()) => {
  if (sibling.lastActivatedAt) return new Date(sibling.lastActivatedAt);
  if (!sibling.activatedAt) return null;
  if (sibling.status === 'active') return now;
  return new Date(sibling.archivedAt || sibling.activatedAt);
};

// What the pass comes back as: what it was when archived; for a pass archived before archivedFrom
// existed, live if it ever went live.
const restoreTarget = (pass) => pass.archivedFrom || (pass.activatedAt ? 'active' : 'draft');

// The pass that ended this one by going live — stamped since this change, inferred for older rows
// from the shared timestamp (activation stamps both from one `now`).
export const endingPassOf = (pass, siblings) => {
  if (pass.endedByPassId) return siblings.find((s) => String(s._id) === String(pass.endedByPassId)) || null;
  if (pass.archivedVia || !pass.archivedAt) return null;
  const at = new Date(pass.archivedAt).getTime();
  return siblings.find((s) => s.activatedAt && new Date(s.activatedAt).getTime() === at) || null;
};

// docs/PROPOSAL_WALK_LIST_ARCHIVE.md §B.5. `facts`: { campaign, effort, siblings (the walk list's
// OTHER passes), booksWithDoors, canvassers, recutLocked, viaUnarchive, now }.
// Returns { ok, to, reason, laterPass, books, canvassers, downgraded, temporary }.
export const bringBackVerdict = (pass, facts) => {
  const { campaign, effort, siblings = [], booksWithDoors = 0, canvassers = 0, recutLocked = false, viaUnarchive = false } = facts;
  const now = facts.now || new Date();
  const base = { books: booksWithDoors, canvassers };
  const refuse = (reason, extra = {}) => ({ ok: false, reason, ...base, ...extra });

  if (pass.status !== 'archived') return refuse('not-archived');
  if (!pass.archivedAt) return refuse('unknown-end');
  if (!campaign || campaign.isActive === false) return refuse('campaign-archived');
  if (campaign.deletion?.requestedAt) return refuse('campaign-deleting');
  if (!effort) return refuse('walk-list-missing');
  if (effort.status === 'archived' && !viaUnarchive) return refuse('walk-list-archived');
  if (pass.archivedVia === 'next-pass') return refuse('ended-by-next-pass', { laterPass: passRef(endingPassOf(pass, siblings)) });

  let to = restoreTarget(pass);
  let downgraded = null;
  if (to === 'active') {
    // 4b: >=, because activation stamps the ended pass's archivedAt and the next pass's activation
    // from the same `now`. Only when coming back LIVE — a draft coming back conflicts with nothing.
    const endedAt = new Date(pass.archivedAt).getTime();
    const later = siblings
      .filter((s) => {
        const t = lastLiveAt(s, now);
        return t && t.getTime() >= endedAt;
      })
      .sort((a, b) => lastLiveAt(b, now) - lastLiveAt(a, now))[0];
    if (later) return refuse('later-pass-went-live', { laterPass: passRef(later) });
    const live = siblings.find((s) => s.status === 'active');
    if (live) return refuse('another-pass-live', { laterPass: passRef(live) });
    if (campaign.type === 'survey' && !campaign.surveyTemplateId) return refuse('survey-required');
    if (!booksWithDoors) {
      to = 'draft';
      downgraded = 'no-doors';
    }
  }
  if (recutLocked) return refuse('recut-locked', { temporary: true, to });
  return { ok: true, to, downgraded, ...base };
};

const REFUSAL_WORDS = {
  'not-archived': () => 'This pass is not archived.',
  'unknown-end': () => "This pass can't be brought back: there is no record of when it ended.",
  'campaign-archived': () => 'This campaign is archived — reactivate it to make changes.',
  'campaign-deleting': () => 'This campaign is being deleted.',
  'walk-list-missing': () => "This pass's walk list no longer exists.",
  'walk-list-archived': () => 'Its walk list is archived — unarchive the walk list to bring this pass back.',
  'ended-by-next-pass': (v) =>
    `This pass ended when ${v.laterPass ? passLabel(v.laterPass) : 'the next pass'} went live, so it can't come back.`,
  'later-pass-went-live': (v) => `${passLabel(v.laterPass)} went live after this one ended, so it can't come back.`,
  'another-pass-live': (v) => `${passLabel(v.laterPass)} is live on this walk list. Archive it first.`,
  'survey-required': () => 'Add a survey to this campaign before a pass can go live again.',
  'recut-locked': () => 'This pass is being re-cut, discarded or restored right now. Try again in a minute.',
};
export const refusalMessage = (verdict) => (REFUSAL_WORDS[verdict.reason] || (() => "This pass can't be brought back."))(verdict);

const verdictError = (verdict) =>
  new LifecycleError(409, verdict.reason, refusalMessage(verdict), {
    ...(verdict.laterPass ? { laterPass: verdict.laterPass } : {}),
    ...(verdict.temporary ? { temporary: true } : {}),
  });

const SIBLING_FIELDS = { roundNumber: 1, name: 1, status: 1, activatedAt: 1, lastActivatedAt: 1, archivedAt: 1 };

// Batch loads for GET /passes: published-books-with-doors and distinct canvassers per pass.
export const bringBackCounts = async (passIds) => {
  if (!passIds.length) return { booksByPass: new Map(), canvassersByPass: new Map() };
  const [books, people] = await Promise.all([
    Turf.aggregate([
      { $match: { passId: { $in: passIds }, status: 'published', doorCount: { $gt: 0 } } },
      { $group: { _id: '$passId', n: { $sum: 1 } } },
    ]),
    TurfAssignment.aggregate([
      { $match: { passId: { $in: passIds } } },
      { $group: { _id: '$passId', users: { $addToSet: '$userId' } } },
    ]),
  ]);
  return {
    booksByPass: new Map(books.map((r) => [String(r._id), r.n])),
    canvassersByPass: new Map(people.map((r) => [String(r._id), r.users.length])),
  };
};

// Is a book operation holding this pass right now? Read off the loaded doc (no query).
export const isRecutLockedDoc = (pass, now = Date.now()) =>
  !!(pass.recutLock?.lockedAt && new Date(pass.recutLock.lockedAt).getTime() >= now - LOCK_STALE_MS);

// Fresh facts for one pass (actions and the previews).
export const evaluateBringBack = async ({ campaign, pass, effort = null, viaUnarchive = false }) => {
  const [eff, siblings, counts] = await Promise.all([
    effort || Effort.findOne({ _id: pass.effortId, campaignId: campaign._id }, { name: 1, status: 1 }).lean(),
    Pass.find({ effortId: pass.effortId, _id: { $ne: pass._id } }, SIBLING_FIELDS).lean(),
    bringBackCounts([pass._id]),
  ]);
  return bringBackVerdict(pass, {
    campaign,
    effort: eff,
    siblings,
    booksWithDoors: counts.booksByPass.get(String(pass._id)) || 0,
    canvassers: counts.canvassersByPass.get(String(pass._id)) || 0,
    recutLocked: isRecutLockedDoc(pass),
    viaUnarchive,
  });
};

// For the Door Outcomes undo guard (answerEditRuns.js roundClearedSince): could this round's cleared
// snapshot ever be restored? An open round, yes. An archived one, if it could ever come back —
// ignoring the campaign's archive, the walk list's archive and locks, all of which can be undone.
export const couldComeBack = async (pass) => {
  if (pass.status !== 'archived') return true;
  if (!pass.archivedAt || pass.archivedVia === 'next-pass') return false;
  if (!pass.effortId || !(await Effort.exists({ _id: pass.effortId }))) return false;
  if (restoreTarget(pass) !== 'active') return true;
  const siblings = await Pass.find({ effortId: pass.effortId, _id: { $ne: pass._id } }, SIBLING_FIELDS).lean();
  const endedAt = new Date(pass.archivedAt).getTime();
  const now = new Date();
  return !siblings.some((s) => {
    const t = lastLiveAt(s, now);
    return t && t.getTime() >= endedAt;
  });
};

// ── Stakes for the archive box ──

export const passStakes = async (campaign, pass) => {
  const [books, people, knockRows] = await Promise.all([
    Turf.countDocuments({ passId: pass._id, status: 'published' }),
    TurfAssignment.distinct('userId', { passId: pass._id }),
    CanvassActivity.aggregate(knocksPipeline({ campaignId: campaign._id, passId: pass._id }, { byPass: true })),
  ]);
  return {
    _id: String(pass._id),
    roundNumber: pass.roundNumber,
    name: pass.name,
    books,
    canvassers: people.length,
    knocks: knockRows[0]?.knocks || 0,
  };
};

export const walkListArchivePreview = async ({ campaign, effort }) => {
  const [live, drafts, doors] = await Promise.all([
    Pass.findOne({ effortId: effort._id, status: 'active' }).sort({ lastActivatedAt: -1, activatedAt: -1 }).lean(),
    Pass.countDocuments({ effortId: effort._id, status: 'draft' }),
    Household.countDocuments({ campaignId: campaign._id, effortId: effort._id, isActive: true }),
  ]);
  return { livePass: live ? await passStakes(campaign, live) : null, drafts, doors };
};

export const walkListUnarchivePreview = async ({ campaign, effort, nameOf = () => null }) => {
  const ended = effort.endedPassId ? await Pass.findOne({ _id: effort.endedPassId, campaignId: campaign._id }).lean() : null;
  if (!ended) return { endedPass: null };
  const bringBack = await evaluateBringBack({ campaign, pass: ended, effort, viaUnarchive: true });
  return {
    endedPass: {
      _id: String(ended._id),
      roundNumber: ended.roundNumber,
      name: ended.name,
      archivedAt: ended.archivedAt,
      archivedVia: ended.archivedVia,
      archivedByName: nameOf(ended.archivedBy),
      bringBack,
      // The refusal in words, so the dialog never keeps its own copy of the server's sentences.
      ...(bringBack.ok ? {} : { bringBackMessage: refusalMessage(bringBack) }),
    },
  };
};

// ── History ──

const history = ({ campaign, field, fromValue, toValue, details, userId }) =>
  CampaignChange.create({
    organizationId: campaign.organizationId,
    campaignId: campaign._id,
    field,
    fromValue,
    toValue,
    details,
    byUserId: userId || null,
    source: 'walk_list_lifecycle',
  }).catch((err) => console.error('[passLifecycle] history row not written:', err?.message || err));

// ── Internal steps (no lifecycle lock — the calling export holds it) ──

// Conditional on the status the caller read, so a racing discard or activation can't be overwritten.
const endPass = async ({ pass, via, userId, endedByPassId = null, now = new Date() }) => {
  const res = await Pass.updateOne(
    { _id: pass._id, status: pass.status },
    {
      $set: {
        status: 'archived',
        archivedAt: now,
        archivedFrom: pass.status === 'draft' ? 'draft' : 'active',
        archivedVia: via,
        archivedBy: userId || null,
        endedByPassId,
      },
    }
  );
  if (!res.modifiedCount) {
    throw new LifecycleError(409, 'pass-changed', 'This pass changed while you were working on it. Refresh and try again.');
  }
};

// Several live passes on one walk list exist only on data from before the one-live-pass index, and a
// pass from then has no lastActivatedAt: it counts as live until it ended (lastLiveAt). So the pass
// Unarchive offers back (`offer`, or null) ends LAST, a moment after the others — ended first, rule 4b
// would read the others as live after it and it could never come back. onEnded(pass) runs after each.
const endPassesOfferingLast = async ({ offer, others, via, userId, onEnded = async () => {} }) => {
  const now = new Date();
  for (const pass of others) {
    await endPass({ pass, via, userId, now });
    await onEnded(pass);
  }
  if (offer) {
    await endPass({ pass: offer, via, userId, now: others.length ? new Date(now.getTime() + 1) : now });
    await onEnded(offer);
  }
};

const rehullMaxDoors = () => Number(process.env.TURF_BRING_BACK_REHULL_MAX_DOORS) || REHULL_MAX_DOORS_DEFAULT;

// Pin re-hulls skip archived passes and import pin placement logs nothing to detect a move by, so a
// pass coming back always has its outlines redrawn — best-effort, display only, under a cap that
// keeps the request well inside Heroku's 30 s router (npm run recompute:territories heals the rest).
const redrawOutlines = async (passId) => {
  try {
    const [row] = await Turf.aggregate([
      { $match: { passId, status: { $in: ['draft', 'published'] } } },
      { $group: { _id: null, doors: { $sum: { $size: '$householdIds' } } } },
    ]);
    const doors = row?.doors || 0;
    if (!doors) return;
    if (doors > rehullMaxDoors()) {
      console.warn(`[passLifecycle] outlines of pass ${passId} not redrawn (${doors} doors); run npm run recompute:territories -- --apply`);
      return;
    }
    await recomputePassTerritories(passId, { withCentroid: true });
  } catch (err) {
    console.error(`[passLifecycle] outline redraw for pass ${passId} failed:`, err?.message || err);
  }
};

const bringBackStep = async ({ campaign, passId, effort, userId, viaUnarchive }) =>
  withRecutLock(passId, userId, async () => {
    // Re-read under the lock: everything below is decided on what the pass is NOW.
    const pass = await Pass.findOne({ _id: passId, campaignId: campaign._id }).lean();
    if (!pass) throw new LifecycleError(404, 'pass-not-found', 'Pass not found');
    const verdict = await evaluateBringBack({ campaign, pass: { ...pass, recutLock: null }, effort, viaUnarchive });
    if (!verdict.ok) throw verdictError(verdict);
    const set = { status: verdict.to, archivedAt: null, archivedFrom: null, archivedVia: null, archivedBy: null, endedByPassId: null };
    if (verdict.to === 'active') set.lastActivatedAt = new Date();
    try {
      const res = await Pass.updateOne({ _id: pass._id, status: 'archived' }, { $set: set });
      if (!res.modifiedCount) {
        throw new LifecycleError(409, 'pass-changed', 'This pass changed while you were working on it. Refresh and try again.');
      }
    } catch (err) {
      if (err?.code === 11000) {
        throw new LifecycleError(409, 'another-pass-live', 'Another pass on this walk list is live. Archive it first.');
      }
      throw err;
    }
    await redrawOutlines(pass._id);
    return { pass, verdict };
  });

// ── Exports ──

export const archiveWalkList = async ({ campaign, effortId, userId, confirm = false }) =>
  withLifecycleLock(effortId, async () => {
    const effort = await Effort.findOne({ _id: effortId, campaignId: campaign._id });
    if (!effort) throw new LifecycleError(404, 'walk-list-not-found', 'Walk list not found');
    // Several live passes only on data from before the one-live-pass index; the latest is the one
    // Unarchive offers back.
    const live = await Pass.find({ effortId: effort._id, status: 'active' }).sort({ lastActivatedAt: -1, activatedAt: -1 }).lean();
    if (effort.status === 'archived' && !live.length) {
      throw new LifecycleError(409, 'already-archived', `Walk list "${effort.name}" is already archived.`);
    }
    if (live.length && !confirm) {
      throw new LifecycleError(409, 'archive-confirm-required', `${passLabel(live[0])} is live. Confirm to archive "${effort.name}".`);
    }
    if (live.length) {
      // Under every live pass's recut lock: a refusal there changes nothing. Then record which pass
      // this archive ends (the walk list is still open, and the field is read only while archived),
      // then end it.
      await withRecutLocks(live.map((p) => p._id), userId, async () => {
        effort.endedPassId = live[0]._id;
        await effort.save();
        await endPassesOfferingLast({ offer: live[0], others: live.slice(1), via: 'walk-list', userId });
      });
    } else if (effort.endedPassId) {
      // Nothing live. Keep a pointer left by an archive that stopped after ending its pass; drop any
      // other (a stale one would offer back a pass this archive didn't end).
      const prior = await Pass.findOne({ _id: effort.endedPassId, effortId: effort._id }, { status: 1, archivedVia: 1 }).lean();
      if (!(prior?.status === 'archived' && prior.archivedVia === 'walk-list')) effort.endedPassId = null;
    }
    const wasArchived = effort.status === 'archived';
    if (!wasArchived) {
      effort.status = 'archived';
      effort.archivedAt = new Date();
      effort.archivedBy = userId || null;
    }
    await effort.save();
    const ended = live[0] || null;
    if (wasArchived) {
      // "End Pass 3" on a walk list archived before this change: the walk list wasn't archived now, its
      // passes were ended — say that, one pass row each.
      for (const pass of live) {
        await history({
          campaign,
          field: 'passArchived',
          fromValue: `${effort.name} · ${passLabel(pass)} · live`,
          toValue: `${effort.name} · ${passLabel(pass)} · archived`,
          details: { walkList: effort.name, pass: passLabel(pass), outcome: 'by-hand' },
          userId,
        });
      }
    } else {
      await history({
        campaign,
        field: 'walkListArchived',
        fromValue: ended ? `${effort.name} · live (${passLabel(ended)})` : `${effort.name} · open`,
        toValue: ended ? `${effort.name} · archived · ${passLabel(ended)} ended` : `${effort.name} · archived`,
        details: { walkList: effort.name, pass: ended ? passLabel(ended) : null, outcome: ended ? 'ended' : 'nothing-live' },
        userId,
      });
    }
    // The pass this archive ended, named: the box's preview can be a step behind (a pass that went live
    // after it opened), and the Undo it offers brings back exactly this one.
    const endedPass = ended
      ? passRef(ended)
      : effort.endedPassId
        ? passRef(await Pass.findById(effort.endedPassId, { roundNumber: 1, name: 1 }).lean())
        : null;
    return { effort: publicEffort(effort), endedPassId: effort.endedPassId ? String(effort.endedPassId) : null, endedPass };
  });

export const unarchiveWalkList = async ({ campaign, effortId, userId, bringBack = false }) =>
  withLifecycleLock(effortId, async () => {
    const effort = await Effort.findOne({ _id: effortId, campaignId: campaign._id });
    if (!effort) throw new LifecycleError(404, 'walk-list-not-found', 'Walk list not found');
    if (effort.status !== 'archived') {
      throw new LifecycleError(409, 'not-archived', `Walk list "${effort.name}" is not archived.`);
    }
    const ended = effort.endedPassId
      ? await Pass.findOne({ _id: effort.endedPassId, campaignId: campaign._id }).lean()
      : null;
    if (bringBack) {
      if (!ended) throw new LifecycleError(409, 'nothing-to-bring-back', 'No pass ended when this walk list was archived.');
      // Decide before changing anything: a refusal leaves the walk list archived.
      const verdict = await evaluateBringBack({ campaign, pass: ended, effort: effort.toObject(), viaUnarchive: true });
      if (!verdict.ok) throw verdictError(verdict);
    }
    // Reopen FIRST (see the header), then bring the pass back.
    effort.status = 'active';
    effort.archivedAt = null;
    effort.archivedBy = null;
    await effort.save();
    let broughtBack = null;
    let to = null;
    let bringBackError = null;
    if (bringBack) {
      try {
        const out = await bringBackStep({ campaign, passId: ended._id, effort: effort.toObject(), userId, viaUnarchive: false });
        broughtBack = String(ended._id);
        to = out.verdict.to;
      } catch (err) {
        if (!(err instanceof LifecycleError)) throw err;
        bringBackError = { code: err.code, error: `"${effort.name}" is unarchived, but ${passLabel(ended)} couldn't come back: ${err.message}` };
      }
    }
    effort.endedPassId = null;
    await effort.save();
    const outcome = broughtBack ? 'brought-back' : ended ? 'stayed-ended' : 'nothing-ended';
    await history({
      campaign,
      field: 'walkListUnarchived',
      fromValue: `${effort.name} · archived`,
      toValue:
        outcome === 'brought-back'
          ? `${effort.name} · open · ${passLabel(ended)} brought back`
          : outcome === 'stayed-ended'
            ? `${effort.name} · open · ${passLabel(ended)} stayed ended`
            : `${effort.name} · open`,
      details: { walkList: effort.name, pass: ended ? passLabel(ended) : null, outcome },
      userId,
    });
    return { effort: publicEffort(effort), broughtBack, to, ...(bringBackError ? { bringBackError } : {}) };
  });

// The pass Archive button. Same confirm gate as before (live, or recorded knocks).
export const archivePass = async ({ campaign, passId, userId, confirm = false }) => {
  const first = await Pass.findOne({ _id: passId, campaignId: campaign._id }, { effortId: 1 }).lean();
  if (!first) throw new LifecycleError(404, 'pass-not-found', 'Pass not found');
  // A live pass with no walk list (data from before walk lists; the repair leaves those alone) has no
  // lifecycle lock to take and nothing to race — activating or bringing one back is refused — but its
  // books still reach phones, so it can still be ended.
  const run = async () => {
    const pass = await Pass.findOne({ _id: passId, campaignId: campaign._id }).lean();
    if (!pass) throw new LifecycleError(404, 'pass-not-found', 'Pass not found');
    const effort = pass.effortId ? await Effort.findOne({ _id: pass.effortId }, { name: 1, status: 1 }).lean() : null;
    if (effort?.status === 'archived') {
      throw new LifecycleError(409, 'walk-list-archived', `Walk list "${effort.name}" is archived — unarchive it to change it.`);
    }
    if (pass.status === 'archived') throw new LifecycleError(409, 'already-archived', `${passLabel(pass)} is already archived.`);
    if (!confirm) {
      const knockCount = await CanvassActivity.countDocuments({ passId: pass._id });
      if (pass.status === 'active' || knockCount > 0) {
        throw new LifecycleError(
          409,
          'archive-confirm-required',
          pass.status === 'active' ? 'This pass is live. Confirm to archive it.' : 'This pass has recorded knocks. Confirm to archive it.',
          { isActive: pass.status === 'active', knockCount }
        );
      }
    }
    await withRecutLock(pass._id, userId, () => endPass({ pass, via: 'pass', userId }));
    await history({
      campaign,
      field: 'passArchived',
      fromValue: `${effort?.name || 'Walk list'} · ${passLabel(pass)} · ${pass.status === 'active' ? 'live' : 'draft'}`,
      toValue: `${effort?.name || 'Walk list'} · ${passLabel(pass)} · archived`,
      details: { walkList: effort?.name || null, pass: passLabel(pass), outcome: 'by-hand' },
      userId,
    });
    return Pass.findById(pass._id).lean();
  };
  return first.effortId ? withLifecycleLock(first.effortId, run) : run();
};

export const bringBackPass = async ({ campaign, passId, userId }) => {
  const first = await Pass.findOne({ _id: passId, campaignId: campaign._id }, { effortId: 1 }).lean();
  if (!first) throw new LifecycleError(404, 'pass-not-found', 'Pass not found');
  return withLifecycleLock(first.effortId, async () => {
    const effort = await Effort.findOne({ _id: first.effortId }, { name: 1, status: 1 }).lean();
    const { pass, verdict } = await bringBackStep({ campaign, passId, effort, userId, viaUnarchive: false });
    await history({
      campaign,
      field: 'passBroughtBack',
      fromValue: `${effort?.name || 'Walk list'} · ${passLabel(pass)} · archived`,
      toValue: `${effort?.name || 'Walk list'} · ${passLabel(pass)} · ${verdict.to === 'active' ? 'live again' : 'back as a draft'}`,
      details: { walkList: effort?.name || null, pass: passLabel(pass), outcome: verdict.to === 'active' ? 'live' : 'draft' },
      userId,
    });
    return { pass: await Pass.findById(pass._id).lean(), to: verdict.to, downgraded: verdict.downgraded };
  });
};

// Activation, moved here from routes/admin/passes.js. It does NOT take the ending pass's recut lock:
// starting the next pass never waits, as before, even while a claim or supplemental job runs on the
// old one (those keep working on an archived donor). No History row: routine, and it would crowd
// the feed's 200-row cap.
export const activatePass = async ({ campaign, passId, userId }) => {
  const first = await Pass.findOne({ _id: passId, campaignId: campaign._id }, { effortId: 1 }).lean();
  if (!first) throw new LifecycleError(404, 'pass-not-found', 'Pass not found');
  return withLifecycleLock(first.effortId, async () => {
    const pass = await Pass.findOne({ _id: passId, campaignId: campaign._id }).lean();
    if (!pass) throw new LifecycleError(404, 'pass-not-found', 'Pass not found');
    if (pass.status === 'archived') {
      throw new LifecycleError(409, 'pass-archived', `${passLabel(pass)} is archived — use Bring back.`);
    }
    const effort = await Effort.findOne({ _id: pass.effortId }, { name: 1, status: 1 }).lean();
    if (effort?.status === 'archived') {
      throw new LifecycleError(409, 'walk-list-archived', `Walk list "${effort.name}" is archived — unarchive it to change it.`);
    }
    // Survey requirement: a survey campaign can be built out freely, but a round can't go LIVE
    // without a survey for canvassers to submit.
    if (campaign.type === 'survey' && !campaign.surveyTemplateId) {
      throw new LifecycleError(400, 'survey-required', 'Add a survey to this campaign before activating a pass.');
    }
    const published = await Turf.countDocuments({ passId: pass._id, status: 'published' });
    if (!published) throw new LifecycleError(400, 'no-books', 'Generate and accept books before activating this pass');
    if (pass.status === 'active') return pass;

    const now = new Date();
    // End only the other live rounds OF THE SAME WALK LIST — other walk lists keep theirs.
    const live = await Pass.find({ effortId: pass.effortId, status: 'active', _id: { $ne: pass._id } }).lean();
    for (const s of live) {
      await Pass.updateOne(
        { _id: s._id, status: 'active' },
        { $set: { status: 'archived', archivedAt: now, archivedFrom: 'active', archivedVia: 'next-pass', archivedBy: userId || null, endedByPassId: pass._id } }
      );
    }
    const set = { status: 'active', lastActivatedAt: now };
    if (!pass.activatedAt) set.activatedAt = now;
    try {
      const updated = await Pass.findOneAndUpdate({ _id: pass._id, status: pass.status }, { $set: set }, { new: true }).lean();
      if (!updated) throw new LifecycleError(409, 'pass-changed', 'This pass changed while you were working on it. Refresh and try again.');
      return updated;
    } catch (err) {
      if (err?.code === 11000) {
        throw new LifecycleError(409, 'another-pass-live', 'Another pass on this walk list just went live. Refresh and try again.');
      }
      throw err;
    }
  });
};

// ── The one-time repair (migrations/repairArchivedWalkLists.js) ──

// Ends every live pass of an ARCHIVED walk list (the walk list's own archive date is kept), or every
// live pass but the latest of an OPEN walk list holding several. Bypasses the archived-campaign
// refusal on purpose: a later Reactivate must not revive these passes. Returns what it ended.
export const repairWalkList = async ({ campaign, effortId }) =>
  withLifecycleLock(effortId, async () => {
    const effort = await Effort.findOne({ _id: effortId, campaignId: campaign._id });
    if (!effort) return { ended: [] };
    const live = await Pass.find({ effortId: effort._id, status: 'active' }).sort({ lastActivatedAt: -1, activatedAt: -1 }).lean();
    const archived = effort.status === 'archived';
    const toEnd = archived ? live : live.slice(1);
    if (!toEnd.length) return { ended: [] };
    // Which pass Unarchive offers back: the latest one this repair (or an archive) already ended, when a
    // run stopped partway — a re-run must not re-point it at an older pass it ends now.
    const pointer = archived && effort.endedPassId
      ? await Pass.findOne({ _id: effort.endedPassId, effortId: effort._id }, { status: 1, archivedVia: 1 }).lean()
      : null;
    const keepPointer = pointer?.status === 'archived' && ['repair', 'walk-list'].includes(pointer.archivedVia);
    const offer = archived && !keepPointer ? toEnd[0] : null;
    const ended = [];
    // Under every pass's recut lock: a held one skips this walk list with nothing changed, as in
    // archiveWalkList — the pointer is recorded inside them, never before.
    await withRecutLocks(toEnd.map((p) => p._id), null, async () => {
      if (offer) {
        effort.endedPassId = offer._id;
        await effort.save();
      }
      await endPassesOfferingLast({
        offer,
        others: offer ? toEnd.slice(1) : toEnd,
        via: 'repair',
        userId: null,
        onEnded: async (pass) => {
          ended.push(pass);
          await history({
            campaign,
            field: 'passArchived',
            fromValue: `${effort.name} · ${passLabel(pass)} · live`,
            toValue: `${effort.name} · ${passLabel(pass)} · archived (one-time check)`,
            details: { walkList: effort.name, pass: passLabel(pass), outcome: 'repair' },
            userId: null,
          });
        },
      });
    });
    return { ended };
  });
