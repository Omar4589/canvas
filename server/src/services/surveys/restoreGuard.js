import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { UnknockRunChunk } from '../../models/UnknockRunChunk.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { ConversionStrike } from '../../models/ConversionStrike.js';
import { unknockRemoving } from '../canvass/unknockLease.js';
import { stepStillSaving } from '../canvass/stepCount.js';

// Can a preserved (archived) survey be restored? Only into a visit that still reads Surveyed.
//
// Restore puts an archived response back as the voter's current one, and when nothing is current it
// re-creates the response and counts it. Both are right when the archived survey's own visit — the
// (door, round, canvasser) it was recorded at — still has its survey_submitted entry: a teammate
// overwrite, a restore swap, or the profile's "delete the current one, then restore the earlier one".
// They are wrong when that entry is gone or no longer says Surveyed: an unknocked visit, a visit an
// admin converted to Not home on Door Outcomes, or one the canvasser re-recorded as a different
// result. Restoring there put a counted survey under a door that says it wasn't surveyed — and, after
// an unknock, swapped the struck fake answers over a real later survey.
//
// ONE owner of the rule, so the profile (which hides Restore up front) and the restore route (which
// refuses) can never disagree.
//
// Answers an ADMIN took off the record — unknocked, or changed from Surveyed on Door Outcomes — need
// more than "the visit reads Surveyed": the canvasser may have come back and surveyed again, which
// writes a NEW entry at the same visit, and the struck answers must never replace that real survey.
// For those, only the removal's OWN undo lifts its hold: once that undo has begun, one of the
// removal's own entries at the visit back — an unknock's frozen entries (UnknockRunChunk.rows), which
// its undo re-inserts; a conversion's converted entries (ConversionStrike.entryIds, its stamps), which
// its undo flips back to Surveyed. An entry merely on file proves nothing: a strike that stopped before
// deleting it, a conversion step that died before flipping it, and another removal's undo putting back
// an earlier entry at the visit each left one, and a Restore then swapped the struck answers over a
// real later survey (round 7 — rounds 1 to 6 read any entry recorded before the removal began).
// (Matching an entry's time to the survey's own is wrong too: at a two-voter door the second survey
// replaces the visit's entry with a newer one, so the first voter's survey has no entry at its own time
// even though its visit plainly still reads Surveyed.)
//
// A strike is a fact about a REMOVAL RUN, read from the run's own record of the visits it struck —
// UnknockRunChunk.visitKeys, ConversionStrike.visitKeys — and it holds while that run stands: not
// reverted (and, for an unknock, past its first removal). It covers every kept copy of the visit's
// answers made before the strike finished, whatever kind — the removal's own, a teammate's overwrite, an answer
// edit's earlier version. Undoing the removal lifts it with no rewrite anywhere (code review round 2:
// a stamp on the copies outlived the undo and refused a legitimate Restore forever). Strikes made
// before ConversionStrike existed are also read from what they left — the removal's own copy at the
// visit, the converted entry — and migrations/backfillRemovalStrikes.js records them durably. A removal
// with nothing on record to read its own entries by (no run on file, an unknock that never reached its
// delete, a conversion from before its records whose undo took its stamps off) is read the old way: an
// entry recorded before it began, reading Surveyed.
const STRUCK_VIAS = new Set(['unknock', 'outcome_convert']);

const visitKey = (r) => `${String(r.householdId)}|${r.passId ? String(r.passId) : 'null'}|${String(r.userId)}`;
const recordedAt = (a) => (a.createdAt ? new Date(a.createdAt) : a._id.getTimestamp());
const time = (d) => (d ? new Date(d) : null);

/**
 * Every strike that still holds at these visits: Map<visitKey, [{ runId, via, start, end, lift }]>,
 * `start` when the removal began, `end` when it finished, `lift` whether its own undo has lifted it
 * there ('yes' | 'no', or 'time' for a removal read the old way — see the header).
 *
 * A removal run's strike holds at a visit while the run stands. Once it is undone, it still holds
 * at a visit the undo could NOT put back — newer work held it — which the undo records
 * (`notRestoredKeys`); an undo from before that field is read from its copies instead: one it
 * couldn't put back is still on file.
 */
const standingStrikes = async (visits, campaignIds, entries) => {
  const keys = [...visits.keys()];
  const byCampaign = campaignIds.length ? { campaignId: { $in: campaignIds } } : {};
  const [unknockChunks, conversionStrikes, removalCopies] = await Promise.all([
    // Each frozen entry's id and visit too: only its own entries back say a run's undo put a visit back.
    UnknockRunChunk.find(
      { ...byCampaign, visitKeys: { $in: keys } },
      { runId: 1, visitKeys: 1, frozenAt: 1, notRestoredKeys: 1, 'rows._id': 1, 'rows.householdId': 1, 'rows.passId': 1, 'rows.userId': 1 }
    ).lean(),
    ConversionStrike.find({ ...byCampaign, visitKeys: { $in: keys } }, { runId: 1, visitKeys: 1, entryIds: 1, at: 1, doneAt: 1, notRestoredKeys: 1 }).lean(),
    SurveyResponseArchive.find(
      { $or: [...visits.values()], overwrittenVia: { $in: [...STRUCK_VIAS] } },
      { householdId: 1, passId: 1, userId: 1, overwrittenAt: 1, overwrittenVia: 1, unknockRunId: 1, conversionRunId: 1 }
    ).lean(),
  ]);
  const convertedEntries = entries.filter((a) => a.reclassified?.kind === 'from_survey' && a.reclassified.runId);

  const unknockIds = [...unknockChunks.map((c) => c.runId), ...removalCopies.map((c) => c.unknockRunId).filter(Boolean)];
  const conversionIds = [
    ...conversionStrikes.map((c) => c.runId),
    ...removalCopies.map((c) => c.conversionRunId).filter(Boolean),
    ...convertedEntries.map((a) => a.reclassified.runId),
  ];
  const [unknocks, conversions] = await Promise.all([
    unknockIds.length
      ? UnknockRun.find({ _id: { $in: unknockIds } }, { status: 1, completedAt: 1, revertedAt: 1, undoBegunAt: 1, deletingAt: 1, heartbeatAt: 1, stoppedAt: 1, createdAt: 1 }).lean()
      : [],
    conversionIds.length
      ? SurveyConversionRun.find({ _id: { $in: conversionIds } }, { completedAt: 1, revertedAt: 1, status: 1, stepping: 1, steppingAt: 1, revertClaimedAt: 1 }).lean()
      : [],
  ]);
  // 'standing' | 'reverted' | 'unfinished' (an unknock that never reached its delete: what it froze is
  // still on file, so its record proves nothing; one that crashed after `deletingAt` did delete, and
  // stands — round 3) — an id with no run on file is 'unknown'.
  const state = new Map([
    ...unknocks.map((r) => [String(r._id), r.revertedAt ? 'reverted' : r.status === 'completed' || r.deletingAt ? 'standing' : 'unfinished']),
    ...conversions.map((r) => [String(r._id), r.revertedAt ? 'reverted' : 'standing']),
  ]);
  const stateOf = (runId) => (runId ? state.get(String(runId)) || 'unknown' : 'unknown');
  // When an unknock's strike finished. One that stopped part-way ended when it stopped — the moment it
  // failed (`stoppedAt`), else its last beat; one still removing hasn't ended, so it holds every copy
  // (round 4: a stopped strike ended at its freeze, and a teammate's copy of the struck answers made
  // while it removed came free; round 6: so did every copy once round 5 marked a failed strike with an
  // epoch heartbeat). The same for one undone after it stopped. An older run with neither reads its
  // chunks' frozenAt.
  const unknockById = new Map(unknocks.map((r) => [String(r._id), r]));
  const unknockEnd = (runId, frozenAt) => {
    const r = unknockById.get(String(runId));
    if (r?.completedAt) return { end: time(r.completedAt) };
    // Still removing: no end yet, and in flight — see `inFlight` below.
    if (r?.deletingAt) {
      if (r.status === 'pending' && unknockRemoving(r)) return { end: null, inFlight: true };
      return { end: time(r.stoppedAt) || time(r.heartbeatAt) || time(r.deletingAt) };
    }
    return { end: time(frozenAt) };
  };
  // A conversion batch or door still writing: its record has no doneAt yet and its run is running or
  // has a step in flight. One whose record never got a doneAt because its step died (a closed or
  // finished run) is over.
  const conversionById = new Map(conversions.map((r) => [String(r._id), r]));
  const conversionInFlight = (runId, doneAt) => {
    const r = conversionById.get(String(runId));
    return !doneAt && !!r && !r.revertedAt && (['pending', 'running'].includes(r.status) || stepStillSaving(r));
  };

  // What each undone run's undo recorded it couldn't put back, and whether it recorded at all.
  const notRestored = new Map(); // runId -> Set<visitKey>
  for (const rec of [...unknockChunks, ...conversionStrikes]) {
    if (!Array.isArray(rec.notRestoredKeys)) continue;
    const set = notRestored.get(String(rec.runId)) || new Set();
    for (const k of rec.notRestoredKeys) set.add(k);
    notRestored.set(String(rec.runId), set);
  }
  const ownCopyAt = new Set(removalCopies.map((c) => `${String(c.unknockRunId || c.conversionRunId)}|${visitKey(c)}`));
  const holds = (runId, key) => {
    const st = stateOf(runId);
    if (st === 'standing') return true;
    if (st !== 'reverted') return false;
    const recorded = notRestored.get(String(runId));
    return recorded ? recorded.has(key) : ownCopyAt.has(`${String(runId)}|${key}`);
  };

  // A removal's own entries at each visit (`${runId}|${visitKey}`): on record, and back on file. An
  // unknock's undo re-inserts its frozen entries; a conversion's undo flips its converted entries back
  // to Surveyed, stamped by the run until the undo finishes, then by nothing — one another change has
  // stamped since is that change's.
  const onFileIds = new Set(entries.map((a) => String(a._id)));
  const entryById = new Map(entries.map((a) => [String(a._id), a]));
  const ownKnown = new Set();
  const ownBack = new Set();
  for (const c of unknockChunks) {
    for (const r of c.rows || []) {
      const k = `${String(c.runId)}|${visitKey(r)}`;
      ownKnown.add(k);
      if (onFileIds.has(String(r._id))) ownBack.add(k);
    }
  }
  const recordsEntries = new Set(conversionStrikes.filter((c) => (c.entryIds || []).length).map((c) => String(c.runId)));
  for (const c of conversionStrikes) {
    for (const id of c.entryIds || []) {
      const a = entryById.get(String(id));
      if (a && a.actionType === 'survey_submitted' && (!a.reclassified?.runId || String(a.reclassified.runId) === String(c.runId))) {
        ownBack.add(`${String(c.runId)}|${visitKey(a)}`);
      }
    }
  }
  for (const a of entries) {
    if (a.reclassified?.kind !== 'from_survey' || !a.reclassified.runId) continue;
    const k = `${String(a.reclassified.runId)}|${visitKey(a)}`;
    ownKnown.add(k);
    if (a.actionType === 'survey_submitted') ownBack.add(k);
  }
  // Has its undo begun? An unknock's undo stamps `undoBegunAt` once its checks pass, and for good; a
  // conversion's has once it stopped part-way or finished, or once its queued job has claimed it — never at
  // the route's own `reverting`, which its claim sets before its checks and its enqueue, either of which can
  // give the run back to completed (round 8: a Restore in that window swapped removed answers over a real
  // survey; round 9: a Retry undo held again, for its whole run, what its first attempt had freed).
  const undoBegun = (via, runId) => {
    if (via === 'unknock') {
      const r = unknockById.get(String(runId));
      return !!r && (!!r.revertedAt || !!r.undoBegunAt);
    }
    const r = conversionById.get(String(runId));
    return !!r && (!!r.revertedAt || ['revert_failed', 'reverted'].includes(r.status) || (r.status === 'reverting' && !!r.revertClaimedAt));
  };
  // Lifted at this visit only by its own undo: begun, and one of its own entries there back (round 7:
  // any entry recorded before it began lifted it — one a stopped strike never deleted, one a dead step
  // never flipped, another removal's undo putting back an earlier entry). Before its undo begins it
  // holds whatever the entries say; still removing, always.
  const liftOf = (via, runId, key, inFlight = false) => {
    if (inFlight) return 'no';
    const st = stateOf(runId);
    if (st === 'unknown' || st === 'unfinished') return 'time';
    if (!undoBegun(via, runId)) return 'no';
    const k = `${String(runId)}|${key}`;
    const known = via === 'unknock' ? ownKnown.has(k) : recordsEntries.has(String(runId)) || ownKnown.has(k);
    if (!known) return 'time';
    return ownBack.has(k) ? 'yes' : 'no';
  };

  const out = new Map();
  const add = (key, strike) => {
    if (!visits.has(key)) return;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(strike);
  };
  for (const c of unknockChunks) {
    for (const key of c.visitKeys) {
      if (!holds(c.runId, key)) continue;
      const end = unknockEnd(c.runId, c.frozenAt);
      add(key, {
        runId: String(c.runId), via: 'unknock', undone: stateOf(c.runId) === 'reverted', start: time(c.frozenAt), ...end,
        lift: liftOf('unknock', c.runId, key, !!end.inFlight),
      });
    }
  }
  for (const c of conversionStrikes) {
    for (const key of c.visitKeys) {
      if (!holds(c.runId, key)) continue;
      // Still writing: no end yet (it holds every copy of the visit made meanwhile) — see `inFlight`.
      const inFlight = conversionInFlight(c.runId, c.doneAt);
      add(key, {
        runId: String(c.runId), via: 'outcome_convert', undone: stateOf(c.runId) === 'reverted', start: time(c.at),
        end: inFlight ? null : time(c.doneAt) || time(c.at), inFlight, lift: liftOf('conversion', c.runId, key, inFlight),
      });
    }
  }
  for (const c of removalCopies) {
    const runId = c.unknockRunId || c.conversionRunId;
    const key = visitKey(c);
    // A removal copy holds its own visit until its run's undo lifts it there; one whose run can't be
    // read that way — no run id, no run on file, or one that never finished — as it always did.
    const st = stateOf(runId);
    if (st === 'reverted' ? !holds(runId, key) : false) continue;
    // Its removal still writing (the unknock removing, the conversion batch or door saving): the copy
    // is held whatever the entries say (round 5).
    const inFlight = c.unknockRunId
      ? !!unknockById.get(String(c.unknockRunId)) && unknockRemoving(unknockById.get(String(c.unknockRunId)))
      : !!c.conversionRunId && conversionInFlight(c.conversionRunId, null);
    add(key, {
      runId: runId ? String(runId) : null, via: c.overwrittenVia, undone: st === 'reverted', start: time(c.overwrittenAt), end: time(c.overwrittenAt), inFlight,
      lift: liftOf(c.unknockRunId ? 'unknock' : 'conversion', runId, key, inFlight),
    });
  }
  for (const a of convertedEntries) {
    // Still converted: its conversion hasn't been undone here.
    if (stateOf(a.reclassified.runId) === 'reverted') continue;
    add(visitKey(a), {
      runId: String(a.reclassified.runId), via: 'outcome_convert', start: time(a.reclassified.at), end: time(a.reclassified.at),
      lift: liftOf('conversion', a.reclassified.runId, visitKey(a)),
    });
  }
  return out;
};

/**
 * Map<archiveId, { restorable, reason }> for a set of archive rows (lean). `reason` is null when
 * restorable, else 'unknocked' (the visit's entry was unknocked), 'converted' (an admin changed it
 * from Surveyed on Door Outcomes), 'kept_after_undo' (one of those, undone, but the undo couldn't put
 * this visit back) or 'not_surveyed' (it now holds another result, usually the canvasser's own
 * re-recording).
 */
export const restoreStates = async (archiveRows) => {
  const out = new Map();
  if (!archiveRows.length) return out;
  const visits = new Map();
  for (const r of archiveRows) {
    visits.set(visitKey(r), { householdId: r.householdId, passId: r.passId ?? null, userId: r.userId });
  }
  const campaignIds = [...new Set(archiveRows.map((r) => (r.campaignId ? String(r.campaignId) : null)).filter(Boolean))];
  const entries = await CanvassActivity.find(
    { $or: [...visits.values()], actionType: { $ne: 'note_added' } },
    { householdId: 1, passId: 1, userId: 1, actionType: 1, createdAt: 1, 'reclassified.kind': 1, 'reclassified.runId': 1, 'reclassified.at': 1 }
  ).lean();
  const byVisit = new Map();
  for (const a of entries) {
    const k = visitKey(a);
    const v = byVisit.get(k) || { surveyedAt: [], convertedAway: false };
    if (a.actionType === 'survey_submitted') v.surveyedAt.push(recordedAt(a));
    if (a.reclassified?.kind === 'from_survey') v.convertedAway = true;
    byVisit.set(k, v);
  }
  const strikes = await standingStrikes(visits, campaignIds, entries);

  // Every standing strike this copy is held to: one that finished when or after the copy was made —
  // its own removal's included — or one still removing. A copy made after a strike finished holds
  // later work, never the struck answers: those were off the record by then.
  const strikesHolding = (r) => {
    const made = time(r.overwrittenAt);
    return (strikes.get(visitKey(r)) || []).filter((x) => !made || !x.end || x.end >= made);
  };
  for (const r of archiveRows) {
    const v = byVisit.get(visitKey(r));
    // EVERY strike holding it must be lifted by its own undo (standingStrikes, round 7). Judging only the
    // latest let a later removal whose undo stopped after flipping its entry back unlock an earlier
    // unknock's struck answers, and a Restore swapped them over the canvasser's real survey (round 4).
    // A strike still removing blocks whatever the entries say: its own entry reads Surveyed only because
    // the removal hasn't reached it yet (round 5: a Restore mid-strike put struck answers back counted,
    // under a door the strike then unknocked or converted). Once every one is lifted, the visit must
    // still read Surveyed, as for any copy.
    const blocking = strikesHolding(r).filter(
      (x) => !(x.lift === 'yes' || (x.lift === 'time' && v && x.start && v.surveyedAt.some((t) => t <= x.start)))
    );
    if (blocking.length) {
      // Named by the latest one standing in the way — unless one still holds after its removal was
      // undone (the undo couldn't put this visit back): nothing will lift that one, so its own reason,
      // and the words never send the admin to undo something that won't help (rounds 3 and 5).
      const strike = blocking.some((x) => x.undone) ? blocking.find((x) => x.undone) : blocking.reduce((a, b) => (b.start > a.start ? b : a));
      out.set(String(r._id), { restorable: false, reason: strike.undone ? 'kept_after_undo' : strike.via === 'unknock' ? 'unknocked' : 'converted' });
      continue;
    }
    if (v?.surveyedAt.length) out.set(String(r._id), { restorable: true, reason: null });
    else out.set(String(r._id), { restorable: false, reason: !v ? 'unknocked' : v.convertedAway ? 'converted' : 'not_surveyed' });
  }
  return out;
};

// The refusal the restore route sends, worded by cause. The web card says the same thing up front.
export const RESTORE_BLOCKED_MESSAGES = {
  unknocked:
    "These answers were removed when this visit was unknocked on Door Outcomes, so they can't go back from here. Undo that unknock on Door Outcomes to bring them back.",
  converted:
    "These answers were removed when this visit was changed from Surveyed on Door Outcomes, so they can't go back from here. Undo that change on Door Outcomes to bring them back.",
  not_surveyed:
    "This visit no longer reads Surveyed — the canvasser recorded a different result at this door — so there's no survey to put these answers into.",
  kept_after_undo:
    "These answers were removed on Door Outcomes. That change was undone later, but by then this visit had been recorded again, so these answers can't go back from here.",
};
