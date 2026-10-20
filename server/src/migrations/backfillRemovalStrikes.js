import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { SurveyConversionRun } from '../models/SurveyConversionRun.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { SurveyResponseArchive } from '../models/SurveyResponseArchive.js';
import { ConversionStrike } from '../models/ConversionStrike.js';
import { UnknockRun } from '../models/UnknockRun.js';
import { UnknockRunChunk } from '../models/UnknockRunChunk.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { CampaignChange } from '../models/CampaignChange.js';
import { doorKey } from '../services/canvass/doorKey.js';
import { unknockHistoryRowId } from '../services/canvass/unknockLease.js';

// The records Restore's guard (services/surveys/restoreGuard.js) reads about Door Outcomes removals,
// written for the removals made before each record existed (2026-10-19). Two parts:
//
// 1. CONVERSION STRIKES — the visits every Surveyed → door-outcome conversion took answers from,
//    recovered from what it left behind: its converted entries (reclassified.runId) and its own
//    copies of the answers (SurveyResponseArchive.conversionRunId). Neither lasts — the canvasser
//    re-recording the door deletes the converted entry, and an Erase on the profile removes the copy —
//    and once both were gone, every OTHER kept copy of that visit's answers (a teammate's earlier
//    overwrite, an answer edit's earlier version) read restorable again, and a Restore counted answers
//    the admin had taken off the record. A conversion made from now on writes its own record as it
//    runs; this gives the older ones the same, from whatever still survives. A visit whose entry AND
//    copy are both already gone can't be recovered — nothing left says it was struck.
//      • Per VISIT, never per run: a conversion that ran across the deploy has records for its later
//        batches only, so each visit not yet on record is added beside them (code review round 3).
//      • Each visit gets its OWN time — when its entry was converted and its answers copied — so a
//        door-by-door session spread over days holds each visit's copies to that visit's moment, not
//        to the session's last.
//      • A conversion undone since, whose undo wrote what it couldn't put back (`notRestoredKeys`) on
//        its later records only: its earlier visits whose own copies are still on file AND whose entry
//        isn't back reading Surveyed — the visits that undo could not put back — are added as not put
//        back. A visit whose entry came back but whose answers stayed out (a teammate's survey held the
//        slot) is not: the strike there was lifted (round 4).
//      • A bulk conversion's visit known only by its entry ends when the run finished: a bulk run stamps
//        every entry with its start (round 4). A door-by-door session's never — each door has its own
//        time (round 5: stretching it to the session's Close held a real later survey's copy).
//
// 2. UNKNOCK UNDOS before `notRestoredKeys` — the visits an unknock's undo could not put back (newer
//    work held them), where the strike still stands. Without the field the guard can only read them
//    from a copy the undo left on file, so a visit it couldn't put back that had no answers to keep
//    came free. An undo that put every entry back (rowsNotRestored 0) recorded nothing not put back.
//    Otherwise the candidates are the frozen entries not on file now — which also counts an entry the
//    undo DID put back that the canvasser re-recorded later (round 4) — narrowed to the visits newer
//    work held when the undo ran (an entry there from before it) when exactly the undo's own count of
//    them is found; when it can't be told, all of them, the safe direction.
//
// 3. UNKNOCKS THAT STOPPED PART-WAY before `deletingAt` existed: a pending run with its own copies of
//    answers on file that also REMOVED something — one of its frozen entries is gone with its visit
//    empty now, or the answers at a visit whose entry it never reached are gone (it died between the
//    two deletes; a newer survey in the slot counts as gone when no overwrite kept the original), and
//    no later unknock not undone froze that visit nor, for answers, a later conversion took answers
//    there — is stamped as one that did (`deletingAt`, at its first copy) and listed in History then:
//    Restore holds its strike and its Undo is offered, where it read "nothing was removed" (round 4).
//    A copy alone isn't enough: a run can die between its archive and its deletes (round 5). A later
//    run counts whatever became of it, unless undone — marked by this step or not — so the dry run's
//    count is the apply's (rounds 6 and 8). One that left no copy can't be told from one that never began, and
//    is left — including one that removed only entries with no answers (a residual: it reads "Did not
//    finish"); and answers someone deleted on the profile since read as removed by it (nothing on file
//    records that delete). The doors and voters it left unsettled settle on its Undo. A run marked
//    without its History row (a crash between the two writes) gets the row on the next run.
//
//   npm run migrate:removal-strikes               # dry run — count what would be written
//   npm run migrate:removal-strikes -- --apply    # write the records
//
// Safe + idempotent: a visit already on record is skipped, and an unknock chunk already carrying the
// field is left alone. Safe beside live traffic: a conversion writes its record before it changes a
// visit, and the run's records are read here after its entries and copies, so a visit that batch
// touched is already on record when it's read.
const APPLY = process.argv.includes('--apply');
const PER_RECORD = 500;
// An unknock still pending this long after its last sign of life is not running (unknockLease.js).
const STALE_MS = 10 * 60 * 1000;

// The entries (not notes) at these visits now, read by door and kept to each visit here — one `$or`
// clause per visit is minutes at scale (code review round 4).
const entriesAtVisits = async (visits, projection) => {
  const keys = new Set(visits.map((v) => doorKey(v)));
  const doors = [...new Set(visits.map((v) => String(v.householdId)))].map((d) => new mongoose.Types.ObjectId(d));
  const out = [];
  for (let i = 0; i < doors.length; i += PER_RECORD) {
    const rows = await CanvassActivity.find(
      { householdId: { $in: doors.slice(i, i + PER_RECORD) }, actionType: { $ne: 'note_added' } },
      { householdId: 1, passId: 1, userId: 1, ...projection }
    ).lean();
    out.push(...rows.filter((r) => keys.has(doorKey(r))));
  }
  return out;
};

// Map<visitKey, { start, end, entryIds }> — each visit's own window, from its entries' conversion
// time and its copies' archive time.
const visitWindows = (entries, copies) => {
  const out = new Map();
  const note = (key, t, entryId, fromCopy) => {
    const w = out.get(key) || { start: null, end: null, entryIds: [], hasCopy: false };
    if (t) {
      const d = new Date(t);
      if (!w.start || d < w.start) w.start = d;
      if (!w.end || d > w.end) w.end = d;
    }
    if (entryId) w.entryIds.push(entryId);
    if (fromCopy) w.hasCopy = true;
    out.set(key, w);
  };
  for (const e of entries) note(doorKey(e), e.reclassified?.at, e._id, false);
  for (const c of copies) note(doorKey(c), c.overwrittenAt, null, true);
  return out;
};

// The records for these visits: one per shared window, PER_RECORD keys at most.
const strikeDocs = (run, windows, keys, { notRestored = false } = {}) => {
  const fallbackAt = run.startedAt || run.createdAt;
  const groups = new Map();
  for (const key of keys) {
    const w = windows.get(key);
    const at = w.start || fallbackAt;
    // A bulk conversion stamps every entry with its START, so a visit known only by its entry ends when
    // the run did. Never a door-by-door session's: each door is stamped with its own time, and
    // stretching a visit to the session's Close held a copy of the canvasser's real later survey as
    // struck (code review round 5). A copy's time is its own batch's either way.
    const ends = [w.end, run.mode === 'bulk' && !w.hasCopy ? run.completedAt : null].filter(Boolean).map((d) => new Date(d));
    const doneAt = ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : at;
    const g = `${new Date(at).getTime()}|${new Date(doneAt).getTime()}`;
    if (!groups.has(g)) groups.set(g, { at, doneAt, keys: [] });
    groups.get(g).keys.push(key);
  }
  const docs = [];
  for (const { at, doneAt, keys: groupKeys } of groups.values()) {
    for (let i = 0; i < groupKeys.length; i += PER_RECORD) {
      const slice = groupKeys.slice(i, i + PER_RECORD);
      docs.push({
        runId: run._id,
        campaignId: run.campaignId,
        organizationId: run.organizationId,
        visitKeys: slice,
        entryIds: slice.flatMap((k) => windows.get(k).entryIds),
        at,
        doneAt,
        source: 'backfill',
        ...(notRestored ? { notRestoredKeys: slice } : {}),
      });
    }
  }
  return docs;
};

const conversionStrikes = async () => {
  const runs = await SurveyConversionRun.find(
    { direction: { $ne: 'to_survey' } },
    { campaignId: 1, organizationId: 1, mode: 1, createdAt: 1, startedAt: 1, completedAt: 1, revertedAt: 1 }
  ).lean();
  const out = { standing: 0, runsAdded: 0, visitsAdded: 0, nothingLeft: 0, undoneAdded: 0, undoneVisits: 0 };
  for (const run of runs) {
    if (run.revertedAt) {
      // Undone: only an undo that recorded what it couldn't put back needs its earlier visits beside it.
      const records = await ConversionStrike.find({ runId: run._id }, { visitKeys: 1, notRestoredKeys: 1 }).lean();
      if (!records.some((r) => Array.isArray(r.notRestoredKeys))) continue;
      const copies = await SurveyResponseArchive.find({ conversionRunId: run._id }, { householdId: 1, passId: 1, userId: 1, overwrittenAt: 1 }).lean();
      const recorded = new Set(records.flatMap((r) => r.visitKeys));
      const windows = visitWindows([], copies);
      const unrecorded = [...windows.keys()].filter((k) => !recorded.has(k));
      // Back: the visit's own entry — from before the conversion — reads Surveyed again.
      const startedAt = new Date(run.startedAt || run.createdAt);
      const back = new Set(
        (await entriesAtVisits(copies, { actionType: 1, createdAt: 1 }))
          .filter((e) => e.actionType === 'survey_submitted' && (!e.createdAt || new Date(e.createdAt) <= startedAt))
          .map((e) => doorKey(e))
      );
      const missing = unrecorded.filter((k) => !back.has(k));
      if (!missing.length) continue;
      out.undoneAdded += 1;
      out.undoneVisits += missing.length;
      if (APPLY) await ConversionStrike.insertMany(strikeDocs(run, windows, missing, { notRestored: true }), { ordered: true });
      continue;
    }
    out.standing += 1;
    const [entries, copies] = await Promise.all([
      CanvassActivity.find(
        { 'reclassified.runId': run._id, 'reclassified.kind': 'from_survey' },
        { householdId: 1, passId: 1, userId: 1, 'reclassified.at': 1 }
      ).lean(),
      SurveyResponseArchive.find({ conversionRunId: run._id }, { householdId: 1, passId: 1, userId: 1, overwrittenAt: 1 }).lean(),
    ]);
    const windows = visitWindows(entries, copies);
    if (!windows.size) {
      out.nothingLeft += 1;
      continue;
    }
    // Read AFTER the entries and copies (see the header): every visit a batch has touched by now is on record.
    const recorded = new Set((await ConversionStrike.find({ runId: run._id }, { visitKeys: 1 }).lean()).flatMap((r) => r.visitKeys));
    const missing = [...windows.keys()].filter((k) => !recorded.has(k));
    if (!missing.length) continue;
    out.runsAdded += 1;
    out.visitsAdded += missing.length;
    if (APPLY) await ConversionStrike.insertMany(strikeDocs(run, windows, missing), { ordered: true });
  }
  return out;
};

const unknockUndos = async () => {
  const runs = await UnknockRun.find({ revertedAt: { $ne: null } }, { counts: 1, revertedAt: 1 }).lean();
  const out = { runs: 0, chunks: 0, visitsHeld: 0 };
  for (const run of runs) {
    const chunks = await UnknockRunChunk.find(
      { runId: run._id, notRestoredKeys: { $exists: false } },
      { 'rows._id': 1, 'rows.householdId': 1, 'rows.passId': 1, 'rows.userId': 1 }
    ).lean();
    if (!chunks.length) continue;
    out.runs += 1;
    out.chunks += chunks.length;
    // What the undo couldn't put back, as one set of entry ids for the whole run.
    let held = new Set();
    const notRestored = run.counts?.rowsNotRestored;
    if (notRestored !== 0) {
      const rows = chunks.flatMap((c) => c.rows || []);
      const onFile = new Set();
      for (let i = 0; i < rows.length; i += PER_RECORD) {
        const ids = rows.slice(i, i + PER_RECORD).map((r) => r._id);
        for (const r of await CanvassActivity.find({ _id: { $in: ids } }, { _id: 1 }).lean()) onFile.add(String(r._id));
      }
      const candidates = rows.filter((r) => !onFile.has(String(r._id)));
      held = new Set(candidates.map((r) => String(r._id)));
      if (typeof notRestored === 'number' && candidates.length > notRestored) {
        // More candidates than the undo counted: some it put back were re-recorded since. The ones
        // newer work held when it ran have an entry at their visit from before the undo.
        const before = new Date(run.revertedAt);
        const heldVisits = new Set(
          (await entriesAtVisits(candidates, { createdAt: 1 }))
            .filter((e) => e.createdAt && new Date(e.createdAt) < before)
            .map((e) => doorKey(e))
        );
        const narrowed = candidates.filter((r) => heldVisits.has(doorKey(r)));
        if (narrowed.length === notRestored) held = new Set(narrowed.map((r) => String(r._id)));
      }
    }
    for (const c of chunks) {
      const keys = [...new Set((c.rows || []).filter((r) => held.has(String(r._id))).map((r) => doorKey(r)))];
      out.visitsHeld += keys.length;
      if (APPLY) await UnknockRunChunk.updateOne({ _id: c._id, notRestoredKeys: { $exists: false } }, { $set: { notRestoredKeys: keys } });
    }
  }
  return out;
};

// Did this unknock remove anything before it stopped? An entry it removed: one of its frozen entries
// gone, its visit holding no entry now, and frozen by no later unknock that hasn't been undone — that one
// may have removed it (round 7). Or answers it removed: a copy of this run at a visit whose frozen entry
// is still on file reading Surveyed (it died between the two deletes), or is gone because a later unknock
// not undone froze it again (round 7; round 8: standing or not), whose survey is no longer on file — its slot empty, or
// refilled by a newer survey with no copy of the original kept, after this run's, by an overwrite or an
// edit (round 6: a teammate's later re-survey hid the removal; round 7: a profile edit's copy from before
// hid one) — and that no later removal took: none holds a copy of it there, and none at a visit a later
// conversion struck (round 6: a conversion whose copy was erased and then undone left an empty slot). One
// residual: a later unknock that took the survey and whose copy was erased since reads as this run's
// removal. A later run counts whether or not it stands, so what this step marks can't change the verdict
// on an older run: the order of the runs on file doesn't, and a dry run counts what the apply marks
// (round 6; round 8: only standing ones counted, and an older run whose answers a later one found gone
// was never marked).
const removedSomething = async (run) => {
  const chunks = await UnknockRunChunk.find({ runId: run._id }, { frozenAt: 1, visitKeys: 1, 'rows._id': 1, 'rows.householdId': 1, 'rows.passId': 1, 'rows.userId': 1 }).lean();
  const rows = chunks.flatMap((c) => c.rows || []);
  if (!rows.length) return false;
  const onFile = new Map();
  for (let i = 0; i < rows.length; i += PER_RECORD) {
    const ids = rows.slice(i, i + PER_RECORD).map((x) => x._id);
    for (const r of await CanvassActivity.find({ _id: { $in: ids } }, { actionType: 1, reclassified: 1 }).lean()) onFile.set(String(r._id), r);
  }

  // The later removals at these visits, read first: what they froze and took decides what this one can
  // be credited with.
  const frozenAt = chunks.reduce((m, c) => (c.frozenAt && (!m || c.frozenAt > m) ? c.frozenAt : m), null);
  const keys = [...new Set(rows.map((r) => doorKey(r)))];
  const later = [];
  const convertedLater = new Set();
  for (let i = 0; i < keys.length; i += PER_RECORD) {
    const slice = keys.slice(i, i + PER_RECORD);
    later.push(
      ...(await UnknockRunChunk.find(
        { campaignId: run.campaignId, runId: { $ne: run._id }, visitKeys: { $in: slice }, ...(frozenAt ? { frozenAt: { $gt: frozenAt } } : {}) },
        { runId: 1, visitKeys: 1, 'rows._id': 1 }
      ).lean())
    );
    for (const c of await ConversionStrike.find({ campaignId: run.campaignId, visitKeys: { $in: slice }, ...(frozenAt ? { at: { $gt: frozenAt } } : {}) }, { visitKeys: 1 }).lean()) {
      for (const k of c.visitKeys || []) convertedLater.add(k);
    }
  }
  const laterIds = [...new Set(later.map((c) => String(c.runId)))];
  const laterRuns = laterIds.length ? await UnknockRun.find({ _id: { $in: laterIds } }, { revertedAt: 1 }).lean() : [];
  const notUndone = new Set(laterRuns.filter((r) => !r.revertedAt).map((r) => String(r._id)));
  // Frozen by a later unknock that hasn't been undone, whatever became of it: a gone entry there may be
  // that one's removal, not this one's (round 7: one that died after removing entries with no answers —
  // no copy, so never marked — let an older run be marked for its removal).
  const frozenLater = new Set(later.filter((c) => notUndone.has(String(c.runId))).flatMap((c) => (c.rows || []).map((r) => String(r._id))));

  const gone = rows.filter((r) => !onFile.has(String(r._id)));
  const occupied = gone.length ? new Set((await entriesAtVisits(gone, {})).map((e) => doorKey(e))) : new Set();
  const entriesRemoved = gone.filter((r) => !occupied.has(doorKey(r)) && !frozenLater.has(String(r._id)));

  // The answers: this run's copies at a visit whose frozen entry is still on file reading Surveyed (it
  // died between the two deletes), or whose frozen entry a later unknock not undone froze again by id and
  // removed — standing or not: one that died after its entries' delete, with no answers left to copy, is
  // never marked itself (round 7: never counted, and the run was never marked — that run's Undo brought the
  // entries back with no surveys; round 8: so did a later run that never stood).
  const surveyedOnFile = new Set(
    rows.filter((r) => { const e = onFile.get(String(r._id)); return e && e.actionType === 'survey_submitted' && !e.reclassified; }).map((r) => doorKey(r))
  );
  const refrozen = new Set(rows.filter((r) => !onFile.has(String(r._id)) && frozenLater.has(String(r._id))).map((r) => doorKey(r)));
  const copies = (await SurveyResponseArchive.find({ unknockRunId: run._id }, { voterId: 1, passId: 1, householdId: 1, userId: 1, submittedAt: 1, overwrittenAt: 1 }).lean()).filter((c) =>
    surveyedOnFile.has(doorKey(c)) || refrozen.has(doorKey(c))
  );
  const slotOf = (c) => `${c.voterId}|${c.passId ?? 'null'}`;
  const madeAt = (c) => new Date(c.overwrittenAt || c._id.getTimestamp()).getTime();
  const sameSubmission = (a, b) => String(a.userId) === String(b.userId) && new Date(a.submittedAt || 0).getTime() === new Date(b.submittedAt || 0).getTime();
  const holders = new Map();
  const others = new Map(); // slot -> the other copies of it: { userId, submittedAt, made, unknockRunId, conversionRunId, key }
  for (let i = 0; i < copies.length; i += PER_RECORD) {
    const slice = copies.slice(i, i + PER_RECORD);
    const slots = slice.map((c) => ({ voterId: c.voterId, passId: c.passId ?? null }));
    for (const h of await SurveyResponse.find({ $or: slots }, { voterId: 1, passId: 1, userId: 1, submittedAt: 1 }).lean()) holders.set(slotOf(h), h);
    for (const k of await SurveyResponseArchive.find(
      { $or: slots, unknockRunId: { $ne: run._id } },
      { voterId: 1, passId: 1, householdId: 1, userId: 1, submittedAt: 1, overwrittenAt: 1, unknockRunId: 1, conversionRunId: 1 }
    ).lean()) {
      if (!others.has(slotOf(k))) others.set(slotOf(k), []);
      others.get(slotOf(k)).push(k);
    }
  }
  const answersRemoved = copies.filter((c) => {
    const kept = others.get(slotOf(c)) || [];
    // A later removal that took this survey from the visit holds a copy of it there: it removed it.
    if (kept.some((k) => doorKey(k) === doorKey(c) && ((k.unknockRunId && notUndone.has(String(k.unknockRunId))) || k.conversionRunId) && madeAt(k) > madeAt(c))) return false;
    const h = holders.get(slotOf(c));
    if (!h) return true;
    if (sameSubmission(h, c)) return false;
    // The same submission kept by a copy made AFTER this run's — an overwrite, a profile edit — was on file
    // after this run stopped: this run didn't remove it. One made before says nothing (round 7: a profile
    // edit's earlier-answers copy hid a real removal).
    return !kept.some((k) => sameSubmission(k, c) && madeAt(k) > madeAt(c));
  });
  // ...and none at a visit a later conversion struck: its copy may have been erased and its undo left the
  // slot empty (round 6) — the safe direction, as a run marked wrongly logs a removal it never made.
  return entriesRemoved.length > 0 || answersRemoved.some((c) => !convertedLater.has(doorKey(c)));
};

const strikeHistoryRow = (run, at) =>
  CampaignChange.updateOne(
    { _id: unknockHistoryRowId(run._id, 'strike') },
    {
      $setOnInsert: {
        organizationId: run.organizationId, campaignId: run.campaignId, field: 'unknock', fromValue: 'recorded', toValue: 'unknocked',
        byUserId: run.byUserId || null, source: 'unknock', createdAt: at, updatedAt: at,
      },
    },
    { upsert: true, timestamps: false }
  );

const stoppedUnknocks = async () => {
  const quiet = new Date(Date.now() - STALE_MS);
  const runs = await UnknockRun.find(
    {
      status: 'pending',
      revertedAt: null,
      deletingAt: null,
      $or: [{ heartbeatAt: null, createdAt: { $lt: quiet } }, { heartbeatAt: { $lt: quiet } }],
    },
    { _id: 1, campaignId: 1, organizationId: 1, byUserId: 1, createdAt: 1 }
  )
    .sort({ createdAt: -1 })
    .lean();
  const out = { pending: runs.length, stamped: 0, historyWritten: 0 };
  for (const run of runs) {
    const first = await SurveyResponseArchive.findOne({ unknockRunId: run._id }, { overwrittenAt: 1 }).sort({ overwrittenAt: 1 }).lean();
    if (!first) continue;
    // A copy says it reached its archive step, not that it removed anything: it may have died before
    // its deletes (round 5: an Undo then reported every answer "not put back" and logged an undo of an
    // unknock History never listed).
    if (!(await removedSomething(run))) continue;
    out.stamped += 1;
    if (APPLY) {
      const deletingAt = first.overwrittenAt || first._id.getTimestamp();
      // ...and listed in History at that moment, as a strike now is when it stamps (round 5): its Undo
      // then logs the opposite of a row History shows. The strike's own row id, so it is written once.
      await UnknockRun.updateOne({ _id: run._id, status: 'pending', deletingAt: null, revertedAt: null }, { $set: { deletingAt } });
      await strikeHistoryRow(run, deletingAt);
    }
  }
  // Every run this step has marked has its History row — one a crash between the two writes above left
  // without it gets it now (round 6). The step's marks are the runs with a stamp and no heartbeat (this
  // build's strikes always beat).
  const marked = await UnknockRun.find({ deletingAt: { $ne: null }, heartbeatAt: null }, { _id: 1, campaignId: 1, organizationId: 1, byUserId: 1, deletingAt: 1 }).lean();
  for (const run of marked) {
    if (await CampaignChange.exists({ _id: unknockHistoryRowId(run._id, 'strike') })) continue;
    out.historyWritten += 1;
    if (APPLY) await strikeHistoryRow(run, run.deletingAt);
  }
  return out;
};

async function main() {
  await connectDb(process.env.MONGODB_URI);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const conv = await conversionStrikes();
  console.log(`Surveyed → door-outcome conversions still in effect: ${conv.standing}.`);
  console.log(`  ${APPLY ? 'Recorded' : 'Would record'} ${conv.visitsAdded} visit(s) for ${conv.runsAdded} of them; nothing left to record (entries and copies both gone) for ${conv.nothingLeft}.`);
  console.log(`  Undone conversions with earlier visits not on record: ${conv.undoneAdded} (${conv.undoneVisits} visit(s) not put back) — ${APPLY ? 'recorded' : 'would record'}.`);

  const unk = await unknockUndos();
  console.log(`Unknock undos from before the record of what they couldn't put back: ${unk.runs} (${unk.chunks} batch(es), ${unk.visitsHeld} visit(s) not put back) — ${APPLY ? 'recorded' : 'would record'}.`);

  const stopped = await stoppedUnknocks();
  console.log(`Unknocks that stopped part-way before the stamp existed: ${stopped.stamped} of ${stopped.pending} unfinished — ${APPLY ? 'marked' : 'would mark'} as stopped part-way (Undo offered).`);
  if (stopped.historyWritten) console.log(`  Marked earlier without their History row: ${stopped.historyWritten} — ${APPLY ? 'written' : 'would write'}.`);

  if (!APPLY && (conv.runsAdded || conv.undoneAdded || unk.runs || stopped.stamped || stopped.historyWritten)) console.log('Run again with -- --apply to write them.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
