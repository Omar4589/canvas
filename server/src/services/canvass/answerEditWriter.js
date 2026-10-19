import mongoose from 'mongoose';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { applyEditPlan, fingerprint, keysOf } from './answerEdit.js';
import { OTHER_OPTION_ID } from '../surveys/otherOption.js';

// THE WRITER of survey answer edits — docs/PROPOSAL_SURVEY_ANSWER_EDITS.md §G and §H. One module
// serves a bulk run's chunks, a walkthrough step, the profile's Edit and an answer-edit Restore, so
// every path archives, stamps and marks the same way.
//
// The model, in one paragraph. Before a survey changes, its exact bytes are archived
// (SurveyResponseArchive, via 'answer_edit') with the fingerprint of what the edit will write
// (`appliedHash`). The write itself is ONE atomic compare-and-swap over the bytes as read, which
// also pushes the archive row's id onto the survey's `answerEditMarks` — the landing mark. So
// "did this edit land?" is a fact on the survey, and every later pass (a redelivery, a resume, the
// undo) classifies an archive row against the live survey with the table in §G instead of guessing.
//
// The two rules that keep the only copy of an original alive (review round 3's blocker):
//   • a delivery deletes ONLY a row it inserted itself, and only after its own write missed;
//   • a row it finds already there (another delivery's, or a dead attempt's) is ADOPTED — written
//     through again, never deleted. Only the undo deletes rows it didn't write.
//
// RAW DRIVER reads and writes throughout: the compare-and-swap filters on the stored bytes, which a
// Mongoose cast would change (an old row gains optionIds/otherText, keys take schema order).

const { ObjectId } = mongoose.mongo;
const asId = (v) => (v == null ? null : new ObjectId(String(v)));
const SR = () => SurveyResponse.collection;
const ARCH = () => SurveyResponseArchive.collection;

export const slotKey = (voterId, passId) => `${String(voterId)}|${passId ? String(passId) : 'null'}`;
const slotOfRow = (r) => slotKey(r.voterId, r.passId ?? null);

// The survey exactly as it was, plus provenance. `responseId` and `appliedHash` link it to the live
// survey and to what the edit wrote; `answerEditRunId` only when a run made it.
const archiveRowFor = (live, { byUserId, at, runId, appliedHash }) => {
  const { _id, __v, createdAt, updatedAt, ...snapshot } = live;
  const now = new Date();
  return {
    _id: new ObjectId(),
    ...snapshot,
    overwrittenBy: asId(byUserId),
    overwrittenVia: 'answer_edit',
    overwrittenAt: at,
    ...(runId ? { answerEditRunId: asId(runId) } : {}),
    responseId: _id,
    appliedHash,
    createdAt: now,
    updatedAt: now,
  };
};

// What an archive row snapshotted, as a survey (the provenance stripped).
const snapshotOf = (row) => {
  const {
    _id, __v, createdAt, updatedAt, overwrittenBy, overwrittenVia, overwrittenAt, conversionRunId,
    unknockRunId, answerEditRunId, responseId, appliedHash, undoStartedAt, ...snap
  } = row;
  return snap;
};

// The compare-and-swap filter: the survey exactly as read. `answers` compares the whole array,
// element by element and field by field, so any change since the read misses.
const casFilter = (live) => ({
  _id: live._id,
  answers: live.answers === undefined ? { $exists: false } : live.answers,
  userId: live.userId,
  editedBy: live.editedBy ?? null,
  editedAt: live.editedAt ?? null,
});

const hasMark = (live, rowId) => (live?.answerEditMarks || []).some((m) => String(m) === String(rowId));

/**
 * noteCarry: the first time a survey with no note stamp of its own is stamped by an answer edit,
 * the old editedBy/editedAt become the note's stamp in the same write — so an answers-only edit
 * never marks a note edited, and an older note mark survives. "No stamp of its own" means the
 * FIELD IS ABSENT on the raw read (never a `??` fallback: a phone re-survey resets it to null,
 * which is a stamp meaning "not edited"). With the carry in the $set, the filter also requires the
 * field still absent, so a note-only profile save landing in between makes this write miss rather
 * than have its new mark overwritten.
 */
const noteCarry = (live) =>
  live.noteEditedAt === undefined && live.noteEditedBy === undefined
    ? { set: { noteEditedBy: live.editedBy ?? null, noteEditedAt: live.editedAt ?? null }, filter: { noteEditedAt: { $exists: false } } }
    : { set: {}, filter: {} };

// The labelled picks a changed row took out and put in: keys before but not after are removed,
// after but not before added — the same unit the results count in.
const pickDelta = (questions, change) => {
  const q = (questions || []).find((x) => x.key === change.questionKey);
  const before = keysOf(change.before);
  const after = keysOf(change.after);
  const label = (k) => {
    if (k === OTHER_OPTION_ID) return 'Other';
    return (q?.options || []).find((o) => o.id === k)?.text || k;
  };
  return {
    removed: before.filter((k) => !after.includes(k)).map((k) => ({ key: k, label: label(k) })),
    added: after.filter((k) => !before.includes(k)).map((k) => ({ key: k, label: label(k) })),
  };
};

export const emptyCounts = () => ({
  changed: 0,
  changedSinceReview: 0,
  notFound: 0,
  skipped: {},
  droppedFollowUps: 0,
  endsScript: 0,
  byOption: {},
  byQuestion: {},
  samples: [],
});

/** Fold one changed survey's applyEditPlan result into a counts object. */
export const fold = (counts, questions, res) => {
  counts.changed += 1;
  if (res.endsScript) counts.endsScript += 1;
  for (const c of res.rows) {
    if (c.kind === 'dropped') counts.droppedFollowUps += 1;
    else {
      const q = (questions || []).find((x) => x.key === c.questionKey);
      counts.byQuestion[c.questionKey] ||= { label: q?.label || c.questionKey, surveys: 0 };
      counts.byQuestion[c.questionKey].surveys += 1;
    }
    const { removed, added } = pickDelta(questions, c);
    for (const p of removed) {
      const k = `${c.questionKey}\u0001${p.key}`;
      counts.byOption[k] ||= { questionKey: c.questionKey, key: p.key, label: p.label, removed: 0, added: 0 };
      counts.byOption[k].removed += 1;
    }
    for (const p of added) {
      const k = `${c.questionKey}\u0001${p.key}`;
      counts.byOption[k] ||= { questionKey: c.questionKey, key: p.key, label: p.label, removed: 0, added: 0 };
      counts.byOption[k].added += 1;
    }
  }
};

const SAMPLE_CAP = 200;
const sample = (counts, voterId, reason) => {
  if (counts.samples.length < SAMPLE_CAP) counts.samples.push({ voterId, reason });
};

/**
 * Apply a bulk run's plan to one frozen chunk. Idempotent and safe against a second delivery of
 * the same chunk running at the same time (§G). Returns { counts, items } — `items` with `a` (the
 * landed archive row) filled in for every survey this run's edit is now what's on file.
 */
export const applyChunk = async ({ run, chunk }) => {
  const questions = run.template?.questions || [];
  const plan = run.plan || [];
  const flow = run.template?.flow || null;
  const items = chunk.items.map((it) => ({ ...it }));
  const counts = emptyCounts();
  if (!items.length) return { counts, items };

  // 1. The live surveys, by SLOT ({voterId, passId}, the unique key) — never by the frozen id.
  const liveRows = await SR()
    .find({ $or: items.map((it) => ({ voterId: asId(it.v), passId: it.p ? asId(it.p) : null })) })
    .toArray();
  const liveBySlot = new Map(liveRows.map((r) => [slotOfRow(r), r]));

  // 2. This run's archive rows for these surveys, by the frozen id and the live id.
  const ids = [...new Set([...items.map((it) => String(it.r)), ...liveRows.map((r) => String(r._id))])].map(asId);
  const existing = await ARCH().find({ answerEditRunId: run._id, responseId: { $in: ids } }).toArray();
  const rowsBySlot = new Map();
  for (const row of existing) {
    const k = slotOfRow(row);
    if (!rowsBySlot.has(k)) rowsBySlot.set(k, []);
    rowsBySlot.get(k).push(row);
  }

  const writes = []; // { item, live, next, row, inserted, res }
  for (const item of items) {
    const key = slotKey(item.v, item.p);
    const live = liveBySlot.get(key);
    const rows = rowsBySlot.get(key) || [];
    if (!live) {
      counts.notFound += 1;
      sample(counts, item.v, 'not_found');
      continue;
    }
    const fpLive = fingerprint(live);

    // Already this run's edit on file (a redelivery, a resume): re-counted from its own snapshot,
    // so the per-pick totals stay exact.
    const landed = rows.find((row) => hasMark(live, row._id) && row.appliedHash === fpLive);
    if (landed) {
      const res = applyEditPlan(questions, snapshotOf(landed).answers || [], plan, { mode: 'bulk', flow });
      if (res.changed) fold(counts, questions, res);
      item.a = landed._id;
      continue;
    }

    // A row whose snapshot is what's on file: that edit never landed (a dead attempt, or another
    // delivery whose write hasn't landed yet). Adopt it — write through it, never delete it.
    const adoptable = rows.find((row) => fingerprint(snapshotOf(row)) === fpLive);
    if (!adoptable && rows.length) {
      // Rows exist, but the survey matches neither what they snapshotted nor what they wrote: it
      // changed since. Leave the rows (history) and name the voter.
      counts.changedSinceReview += 1;
      sample(counts, item.v, 'changed_since_review');
      continue;
    }
    if (!adoptable && fpLive !== item.h) {
      counts.changedSinceReview += 1;
      sample(counts, item.v, 'changed_since_review');
      continue;
    }

    const res = applyEditPlan(questions, live.answers || [], plan, { mode: 'bulk', flow });
    if (!res.changed) {
      const reason = res.skipped[0]?.reason || 'same_answer';
      counts.skipped[reason] = (counts.skipped[reason] || 0) + 1;
      continue;
    }
    const appliedHash = fingerprint({ ...live, answers: res.answers, editedBy: run.byUserId, editedAt: run.editedAt });
    if (adoptable && adoptable.appliedHash === appliedHash) {
      writes.push({ item, live, res, row: adoptable, inserted: false, appliedHash });
    } else {
      const row = archiveRowFor(live, { byUserId: run.byUserId, at: run.editedAt, runId: run._id, appliedHash });
      writes.push({ item, live, res, row, inserted: true, appliedHash });
    }
  }

  // 3. The archive copies first: a crash after this leaves a row that never landed, which the
  //    next pass adopts. Ordered, so a write failure throws before any survey is touched.
  const fresh = writes.filter((w) => w.inserted).map((w) => w.row);
  if (fresh.length) await ARCH().insertMany(fresh, { ordered: true });

  // 4. One compare-and-swap per survey, all in one round trip.
  const opFor = (w, live) => {
    const carry = noteCarry(live);
    return {
      updateOne: {
        filter: { ...casFilter(live), ...carry.filter },
        update: {
          $set: {
            answers: w.res.answers,
            editedBy: asId(run.byUserId),
            editedAt: run.editedAt,
            updatedAt: new Date(),
            ...carry.set,
          },
          $push: { answerEditMarks: w.row._id },
        },
      },
    };
  };
  if (writes.length) await SR().bulkWrite(writes.map((w) => opFor(w, w.live)), { ordered: false });

  // 5. Read back what landed. A miss is classified, never assumed.
  if (writes.length) {
    const after = await SR().find({ _id: { $in: writes.map((w) => w.live._id) } }).toArray();
    const afterById = new Map(after.map((r) => [String(r._id), r]));
    for (const w of writes) {
      let now = afterById.get(String(w.live._id));
      if (hasMark(now, w.row._id)) {
        fold(counts, questions, w.res);
        w.item.a = w.row._id;
        continue;
      }
      // Another delivery landed this run's edit with its own row: counted as changed, and a row
      // this delivery inserted is a never-landed duplicate.
      const other = now
        ? (await ARCH().find({ answerEditRunId: run._id, _id: { $in: (now.answerEditMarks || []).map(asId) } }).toArray()).find(
            (row) => row.appliedHash === fingerprint(now)
          )
        : null;
      if (other) {
        if (w.inserted) await ARCH().deleteOne({ _id: w.row._id });
        fold(counts, questions, w.res);
        w.item.a = other._id;
        continue;
      }
      // A miss on bytes alone (the canonical fingerprint still matches): retry once on its own.
      if (now && fingerprint(now) === fingerprint(w.live)) {
        const retry = applyEditPlan(questions, now.answers || [], plan, { mode: 'bulk', flow });
        const hash = fingerprint({ ...now, answers: retry.answers, editedBy: run.byUserId, editedAt: run.editedAt });
        if (retry.changed && hash === w.appliedHash) {
          const r = await SR().updateOne(opFor({ ...w, res: retry }, now).updateOne.filter, opFor({ ...w, res: retry }, now).updateOne.update);
          if (r.matchedCount === 1) {
            fold(counts, questions, retry);
            w.item.a = w.row._id;
            continue;
          }
          now = await SR().findOne({ _id: w.live._id });
          if (hasMark(now, w.row._id)) {
            fold(counts, questions, retry);
            w.item.a = w.row._id;
            continue;
          }
        }
      }
      // It changed under us. Only a row THIS delivery inserted is removed; an adopted one stays.
      if (w.inserted) await ARCH().deleteOne({ _id: w.row._id });
      counts.changedSinceReview += 1;
      sample(counts, w.item.v, 'changed_since_review');
    }
  }

  return { counts, items };
};

/**
 * Edit ONE survey — a walkthrough step, the profile's Edit, an answer-edit Restore into the
 * survey's own visit. `live` is the raw survey as the caller read it (its version check is the
 * caller's), `nextAnswers` the full answer set to write (null = answers unchanged), `nextNote`
 * the note to write (undefined = unchanged). Archives first, then one compare-and-swap; a miss
 * deletes the row it inserted and reports a conflict.
 */
export const writeOneSurvey = async ({ live, nextAnswers = null, nextNote, byUserId, at = new Date(), runId = null }) => {
  const answersChanged = nextAnswers != null;
  const noteChanged = nextNote !== undefined;
  if (!answersChanged && !noteChanged) return { changed: false };

  const after = {
    ...live,
    answers: answersChanged ? nextAnswers : live.answers,
    editedBy: answersChanged ? byUserId : live.editedBy,
    editedAt: answersChanged ? at : live.editedAt,
  };
  const appliedHash = fingerprint(after);
  const row = archiveRowFor(live, { byUserId, at, runId, appliedHash });
  await ARCH().insertOne(row);

  const filter = {
    ...casFilter(live),
    note: live.note === undefined ? null : live.note,
    noteEditedAt: live.noteEditedAt === undefined ? { $exists: false } : live.noteEditedAt ?? null,
  };
  const $set = { updatedAt: new Date() };
  if (answersChanged) {
    $set.answers = nextAnswers;
    $set.editedBy = asId(byUserId);
    $set.editedAt = at;
    if (!noteChanged && live.noteEditedAt === undefined && live.noteEditedBy === undefined) {
      $set.noteEditedBy = live.editedBy ?? null;
      $set.noteEditedAt = live.editedAt ?? null;
    }
  }
  if (noteChanged) {
    $set.note = nextNote;
    $set.noteEditedBy = asId(byUserId);
    $set.noteEditedAt = at;
  }
  const res = await SR().updateOne(filter, { $set, $push: { answerEditMarks: row._id } });
  if (res.matchedCount !== 1) {
    await ARCH().deleteOne({ _id: row._id });
    return { conflict: true };
  }
  return { changed: true, rowId: row._id, appliedHash };
};

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

const UNDO_NAME_CAP = 200;

/**
 * Who changed a survey since the edit, in words the run card can show.
 */
const changedSinceDetail = (live, row, run) => {
  if (String(live.userId) !== String(row.userId)) return { kind: 'resurveyed', by: live.userId };
  if (live.submittedAt && row.submittedAt && new Date(live.submittedAt) > new Date(row.submittedAt)) {
    return { kind: 'resurveyed', by: live.userId };
  }
  const ms = (d) => (d ? new Date(d).getTime() : null);
  if (live.editedBy && (String(live.editedBy) !== String(run.byUserId) || ms(live.editedAt) !== ms(run.editedAt))) {
    return { kind: 'edited', by: live.editedBy };
  }
  return { kind: 'changed', by: null };
};

/**
 * Which later Door Outcomes change holds a survey that left the record with this edit's mark on
 * it: an `outcome_convert` or `unknock` copy of the same slot whose snapshot carries the mark,
 * whose fingerprint is this edit's own write, and whose run can still be reverted. That revert
 * brings the survey back, mark and all — and Undo again finishes it.
 */
const heldBy = async (row) => {
  const holders = await ARCH()
    .find({
      voterId: row.voterId,
      passId: row.passId ?? null,
      overwrittenVia: { $in: ['outcome_convert', 'unknock'] },
      answerEditMarks: row._id,
    })
    .toArray();
  for (const h of holders) {
    if (fingerprint(snapshotOf(h)) !== row.appliedHash) continue;
    if (h.conversionRunId) {
      const conv = await SurveyConversionRun.findById(h.conversionRunId, { revertedAt: 1, createdAt: 1 }).lean();
      if (conv && !conv.revertedAt) return { kind: 'conversion', at: conv.createdAt };
    }
    if (h.unknockRunId) {
      const unk = await UnknockRun.findById(h.unknockRunId, { status: 1, revertedAt: 1, createdAt: 1 }).lean();
      if (unk && unk.status === 'completed' && !unk.revertedAt) return { kind: 'unknock', at: unk.createdAt };
    }
  }
  return null;
};

/**
 * One undo pass over a run's chunks — re-entrant, so Undo again finishes whatever a pass couldn't.
 * Classifies every archive row of the run against the live survey (§G's table) and every frozen
 * survey whose landed row is gone (§H2), and returns the summary the run stores.
 */
export const undoRunPass = async ({ run, chunks }) => {
  const summary = { putBack: 0, changedSince: 0, restoredOnProfile: 0, waiting: 0, cleared: 0, erased: 0, gone: 0 };
  const names = [];
  let namesTotal = 0;
  const name = (voterId, reason, detail = null) => {
    namesTotal += 1;
    if (names.length < UNDO_NAME_CAP) names.push({ voterId, reason, detail });
  };

  for (const chunk of chunks) {
    const items = chunk.items || [];
    if (!items.length) continue;
    const liveRows = await SR()
      .find({ $or: items.map((it) => ({ voterId: asId(it.v), passId: it.p ? asId(it.p) : null })) })
      .toArray();
    const liveBySlot = new Map(liveRows.map((r) => [slotOfRow(r), r]));
    const ids = [...new Set([...items.map((it) => String(it.r)), ...liveRows.map((r) => String(r._id))])].map(asId);
    const landedIds = items.filter((it) => it.a).map((it) => asId(it.a));
    const rows = await ARCH()
      .find({ answerEditRunId: run._id, $or: [{ responseId: { $in: ids } }, { _id: { $in: landedIds } }] })
      .toArray();
    const rowsBySlot = new Map();
    const seenRow = new Set();
    for (const row of rows) {
      if (seenRow.has(String(row._id))) continue;
      seenRow.add(String(row._id));
      const k = slotOfRow(row);
      if (!rowsBySlot.has(k)) rowsBySlot.set(k, []);
      rowsBySlot.get(k).push(row);
    }

    for (const item of items) {
      const key = slotKey(item.v, item.p);
      const slotRows = rowsBySlot.get(key) || [];

      if (!slotRows.length) {
        const live = liveBySlot.get(key) || null;
        // Nothing of this run's left for this survey. Only a survey this run's edit landed on
        // has anything to report.
        if (!item.a) continue;
        if (!live) {
          const snap = await TurfSnapshot.exists({ passId: item.p ?? null, 'responseArchives._id': asId(item.a) });
          if (snap) {
            summary.cleared += 1;
            name(item.v, 'cleared');
          } else {
            summary.gone += 1;
            name(item.v, 'gone');
          }
        } else if (hasMark(live, item.a)) {
          summary.erased += 1;
          name(item.v, 'erased');
        } else {
          summary.restoredOnProfile += 1;
          name(item.v, 'restored_on_profile');
        }
        continue;
      }

      for (const row of slotRows) {
        // Re-read per row: a put-back earlier in this loop changed what's on file.
        const live = liveBySlot.get(key) || null;
        if (!live) {
          const holder = await heldBy(row);
          if (holder) {
            summary.waiting += 1;
            name(item.v, 'waiting', holder);
          } else {
            summary.gone += 1;
            name(item.v, 'gone');
          }
          continue;
        }
        const fpLive = fingerprint(live);
        const marked = hasMark(live, row._id);
        if (marked && fpLive === row.appliedHash) {
          // Put back: stamp first (C6), then one compare-and-swap writing only the answers and the
          // edit stamp, so a later team re-stamp or note edit stays.
          await ARCH().updateOne({ _id: row._id }, { $set: { undoStartedAt: new Date() } });
          const snap = snapshotOf(row);
          const res = await SR().updateOne(casFilter(live), {
            $set: {
              answers: snap.answers ?? [],
              editedBy: snap.editedBy ?? null,
              editedAt: snap.editedAt ?? null,
              updatedAt: new Date(),
            },
            $pull: { answerEditMarks: row._id },
          });
          if (res.matchedCount === 1) {
            await ARCH().deleteOne({ _id: row._id });
            summary.putBack += 1;
            // The survey is now the snapshot: the next row for this slot (rare) compares to that.
            const fresh = await SR().findOne({ _id: live._id });
            if (fresh) liveBySlot.set(key, fresh);
          } else {
            summary.changedSince += 1;
            name(item.v, 'changed_since', { kind: 'changed', by: null });
          }
          continue;
        }
        if (fingerprint(snapshotOf(row)) === fpLive) {
          // The edit never landed, or was already put back: the row is redundant.
          await ARCH().deleteOne({ _id: row._id });
          continue;
        }
        if (row.undoStartedAt && !marked) {
          // A put-back that landed in a pass that died before deleting its row (C6).
          await ARCH().deleteOne({ _id: row._id });
          summary.putBack += 1;
          continue;
        }
        summary.changedSince += 1;
        name(item.v, 'changed_since', changedSinceDetail(live, row, run));
      }
    }
  }
  return { summary, names, namesTotal };
};
