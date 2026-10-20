import mongoose from 'mongoose';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { SurveyResponseArchive } from '../../models/SurveyResponseArchive.js';
import { SurveyConversionRun } from '../../models/SurveyConversionRun.js';
import { UnknockRun } from '../../models/UnknockRun.js';
import { TurfSnapshot } from '../../models/TurfSnapshot.js';
import { AnswerEditRunChunk } from '../../models/AnswerEditRunChunk.js';
import { applyEditPlan, fingerprint, keysOf, idsOfRow } from './answerEdit.js';
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
// Both are enforced on the row, not inferred (code review round 2: a delivery whose row another
// delivery had adopted and landed deleted it, and the original was nowhere): every row carries the
// `writerToken` of the delivery holding it, an adopter claims it by compare-and-swap on that token
// before writing through, and a delivery's delete names its own token — so it misses a row someone
// adopted.
//
// And once an undo has looked at a survey, this run can never land on it again: the undo raises
// `answerEditFence` (the run id) on every survey of a chunk before reading it, and every write of a
// run requires the fence absent. A delivery still running when its run was undone — a stalled job
// beside Start again — otherwise wrote the edit back over the put-back, whose bytes matched what it
// had read (round 2).
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
    unknockRunId, answerEditRunId, responseId, appliedHash, undoStartedAt, undoToken, writerToken, ...snap
  } = row;
  return snap;
};

// Bookkeeping a survey carries that says nothing about what was recorded.
// A team re-stamp moves `coordinatorId` on every survey of a canvasser (attribution, not what was
// recorded); a field stored as null reads the same as one never written (round 3).
const BOOKKEEPING = new Set(['_id', '__v', 'createdAt', 'updatedAt', 'answerEditMarks', 'answerEditUndone', 'answerEditFence', 'coordinatorId']);
const canonical = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return { $d: v.toISOString() };
  if (v instanceof ObjectId || v?._bsontype === 'ObjectId') return { $o: String(v) };
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
    return out;
  }
  return v;
};
const sameValue = (a, b) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
const contentOf = (doc) => {
  const out = {};
  for (const [k, v] of Object.entries(doc || {})) if (!BOOKKEEPING.has(k) && v != null) out[k] = v;
  // A note stamp equal to the survey's own reads the same as none (voterProfile.js, the reports): the
  // first answer edit of a survey writes exactly that (noteCarry), and its undo puts the answers' stamp
  // back beside it — so the survey put back read as different from a twin copy of the same original,
  // and the undo held that twin as a newer change (code review round 4).
  if (sameValue(doc?.noteEditedBy, doc?.editedBy) && sameValue(doc?.noteEditedAt, doc?.editedAt)) {
    delete out.noteEditedBy;
    delete out.noteEditedAt;
  }
  return JSON.stringify(canonical(out));
};

/**
 * Does the survey on file still hold EXACTLY what a copy snapshotted — answers, note, location, who
 * and when, everything but bookkeeping? Only then is the copy redundant. The fingerprint alone (the
 * answers and their stamps) is not enough: a canvasser who re-surveyed with the same picks wrote a
 * new note and position, and the undo deleted the copy holding the old ones (code review round 2).
 */
const sameContent = (snapshot, live) => contentOf(snapshot) === contentOf(live);

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
// after but not before added. An old text-only row is read the way the editor seeds it (texts that
// match an option ARE that option), so writing it back id-native isn't "every text out, every id in".
//
// Keys are option ids, never a voter's own words: these counts are stored on the run and its chunks
// and sent with every poll, and they outlive an Erase of the survey's copies (code review round 2: a
// cleared written answer was stored word for word as its own "pick"). A written-answer question is
// counted per question only (byQuestion); an old text no option matches counts as one `unlisted`.
export const UNLISTED_PICK = '__unlisted__';
// One key per pick: an id stored twice is one pick, and each distinct old text no option matches is
// one `unlisted` pick (round 3: two such texts read as one, and a doubled id as two).
const pickKeys = (q, row) => {
  if (!row) return [];
  const unlisted = (texts) => [...new Set(texts)].map(() => UNLISTED_PICK);
  if (!q) {
    const ids = Array.isArray(row.optionIds) ? row.optionIds.filter((k) => typeof k === 'string' && k.trim()) : [];
    if (ids.length) return [...new Set(ids)];
    return unlisted(keysOf(row));
  }
  if (!(q.options || []).length && !q.otherOption) return [];
  const { ids, unmapped } = idsOfRow(q, row);
  return [...new Set(ids), ...unlisted(unmapped)];
};
// Keys before but not after are taken out, after but not before put in — as multisets, so two
// unlisted texts that go are two picks out.
const minus = (a, b) => {
  const left = [...b];
  return a.filter((k) => {
    const i = left.indexOf(k);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
};
const pickDelta = (questions, change) => {
  const q = (questions || []).find((x) => x.key === change.questionKey);
  const before = pickKeys(q, change.before);
  const after = pickKeys(q, change.after);
  const label = (k) => {
    if (k === OTHER_OPTION_ID) return 'Other';
    if (k === UNLISTED_PICK) return 'unlisted';
    return (q?.options || []).find((o) => o.id === k)?.text || k;
  };
  return {
    removed: minus(before, after).map((k) => ({ key: k, label: label(k) })),
    added: minus(after, before).map((k) => ({ key: k, label: label(k) })),
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
// `already` (a one-person session's survey saved again): the questions its earlier saves counted — the
// survey and each of those questions are counted once, however many times it is saved (round 5).
export const fold = (counts, questions, res, already = null) => {
  if (!already) counts.changed += 1;
  if (res.endsScript && !already) counts.endsScript += 1;
  for (const c of res.rows) {
    if (c.kind === 'dropped') {
      if (!already?.has(c.questionKey)) counts.droppedFollowUps += 1;
    } else {
      const q = (questions || []).find((x) => x.key === c.questionKey);
      counts.byQuestion[c.questionKey] ||= { label: q?.label || c.questionKey, surveys: 0 };
      if (!already?.has(c.questionKey)) counts.byQuestion[c.questionKey].surveys += 1;
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
// How many compare-and-swaps go to the database at once.
const CAS_PARALLEL = 25;

export const applyChunk = async ({ run, chunk }) => {
  const questions = run.template?.questions || [];
  const plan = run.plan || [];
  const flow = run.template?.flow || null;
  const items = chunk.items.map((it) => ({ ...it }));
  const counts = emptyCounts();
  if (!items.length) return { counts, items };
  // This delivery's hold on the copies it writes through (see the header).
  const token = String(new ObjectId());

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
    // Re-surveyed under another survey since the review: this run's questions aren't its questions
    // (round 3: the bulk path wrote the plan into it; the one-person step already skipped it).
    if (String(live.surveyTemplateId) !== String(run.template?.surveyTemplateId)) {
      counts.changedSinceReview += 1;
      sample(counts, item.v, 'changed_since_review');
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
      const row = { ...archiveRowFor(live, { byUserId: run.byUserId, at: run.editedAt, runId: run._id, appliedHash }), writerToken: token };
      writes.push({ item, live, res, row, inserted: true, appliedHash });
    }
  }

  // An undo of this run that has begun owns this chunk's surveys (see the header): looked for
  // before anything is claimed or copied, and again before anything is written — the survey-level
  // fence can't cover a survey the undo didn't find on file (round 3).
  const fenced = async () => !!(await AnswerEditRunChunk.exists({ _id: chunk._id, fenced: true }));
  const stopped = () => ({ counts: emptyCounts(), items: chunk.items.map((it) => ({ ...it })), fenced: true });
  if (writes.length && (await fenced())) return stopped();

  // 3. Adopted rows are claimed first, by compare-and-swap on the token as read: a row another
  //    delivery holds now (it may be landing it this instant) or one gone is left alone. Then the
  //    fresh copies, before any survey is touched: a crash after this leaves a row that never
  //    landed, which the next pass adopts. Ordered, so a write failure throws first.
  for (const w of writes) {
    if (w.inserted) continue;
    const claim = await ARCH().updateOne(
      { _id: w.row._id, writerToken: w.row.writerToken ?? { $exists: false } },
      { $set: { writerToken: token } }
    );
    if (claim.matchedCount !== 1) w.lostClaim = true;
  }
  const fresh = writes.filter((w) => w.inserted).map((w) => w.row);
  if (fresh.length) await ARCH().insertMany(fresh, { ordered: true });
  if (writes.length && (await fenced())) {
    // Never landed: this delivery's own fresh copies go, by its token.
    if (fresh.length) await ARCH().deleteMany({ _id: { $in: fresh.map((r) => r._id) }, writerToken: token });
    return stopped();
  }

  // 4. One compare-and-swap per survey, a slice at a time. Each write's OWN result says whether it
  //    landed — never a later read of the mark, which a re-survey (it $unsets the marks) or a profile
  //    Delete can remove between the write and the read: that misread once deleted the only copy of
  //    the original (code review 2026-10-19, round 1). No write lands once an undo of this run has
  //    fenced the survey.
  const opFor = (w, live) => {
    const carry = noteCarry(live);
    return {
      updateOne: {
        filter: { ...casFilter(live), ...carry.filter, answerEditFence: { $ne: run._id } },
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
  const active = writes.filter((w) => !w.lostClaim);
  for (let i = 0; i < active.length; i += CAS_PARALLEL) {
    await Promise.all(
      active.slice(i, i + CAS_PARALLEL).map(async (w) => {
        const op = opFor(w, w.live).updateOne;
        const r = await SR().updateOne(op.filter, op.update);
        w.landed = r.matchedCount === 1;
      })
    );
  }

  // 5. Count what landed; classify each miss (and each lost claim) from a fresh read.
  const missed = writes.filter((w) => !w.landed);
  for (const w of writes) {
    if (!w.landed) continue;
    fold(counts, questions, w.res);
    w.item.a = w.row._id;
  }
  if (missed.length) {
    const after = await SR().find({ _id: { $in: missed.map((w) => w.live._id) } }).toArray();
    const afterById = new Map(after.map((r) => [String(r._id), r]));
    for (const w of missed) {
      let now = afterById.get(String(w.live._id));
      // This run's edit is on file under one of its rows — another delivery landed it, possibly
      // through THIS delivery's own row, which it adopted: counted as changed. Only a different row
      // this delivery inserted is a never-landed duplicate; its own token keeps a row someone
      // adopted from being deleted.
      const other = now
        ? (await ARCH().find({ answerEditRunId: run._id, _id: { $in: (now.answerEditMarks || []).map(asId) } }).toArray()).find(
            (row) => row.appliedHash === fingerprint(now)
          )
        : null;
      if (other) {
        if (String(other._id) !== String(w.row._id)) {
          // Another delivery's copy landed, not this one. One this delivery adopted goes too when it holds
          // exactly what the landed one holds: a never-landed twin of the same original, which the undo
          // once read as a newer change and so never reported the survey put back (round 4). Still by
          // this delivery's token, so a row someone has claimed since stays.
          if (w.inserted || (!w.lostClaim && sameContent(snapshotOf(w.row), snapshotOf(other)))) {
            await ARCH().deleteOne({ _id: w.row._id, writerToken: token });
          }
        }
        fold(counts, questions, w.res);
        w.item.a = other._id;
        continue;
      }
      // A miss on bytes alone (the canonical fingerprint still matches): retry once on its own.
      if (!w.lostClaim && now && fingerprint(now) === fingerprint(w.live)) {
        const retry = applyEditPlan(questions, now.answers || [], plan, { mode: 'bulk', flow });
        const hash = fingerprint({ ...now, answers: retry.answers, editedBy: run.byUserId, editedAt: run.editedAt });
        if (retry.changed && hash === w.appliedHash) {
          const op = opFor({ ...w, res: retry }, now).updateOne;
          const r = await SR().updateOne(op.filter, op.update);
          if (r.matchedCount === 1) {
            fold(counts, questions, retry);
            w.item.a = w.row._id;
            continue;
          }
        }
      }
      // It changed under us (or another delivery holds the row and hasn't landed it). Only a row
      // THIS delivery inserted and still holds is removed; an adopted one stays.
      if (w.inserted) await ARCH().deleteOne({ _id: w.row._id, writerToken: token });
      counts.changedSinceReview += 1;
      sample(counts, w.item.v, 'changed_since_review');
    }
  }

  return { counts, items };
};

/**
 * A chunk's counts and landed copies, read from the database — what the chunk's done-write stores,
 * so it reflects every delivery's work, not only the one writing (round 3: a delivery that lost a
 * claim wrote the chunk last and erased another's landed edit from the run). Classification only,
 * no writes. A recorded `a` (some delivery saw that copy land) still counts as changed after the
 * survey moved on, as long as its copy is on file.
 */
export const countChunk = async ({ run, items }) => {
  const questions = run.template?.questions || [];
  const plan = run.plan || [];
  const flow = run.template?.flow || null;
  const counts = emptyCounts();
  const out = items.map((it) => ({ ...it }));
  if (!out.length) return { counts, items: out };
  const liveRows = await SR()
    .find({ $or: out.map((it) => ({ voterId: asId(it.v), passId: it.p ? asId(it.p) : null })) })
    .toArray();
  const liveBySlot = new Map(liveRows.map((r) => [slotOfRow(r), r]));
  const rowsBySlot = await runCopiesBySlot(run, out);
  for (const item of out) {
    const key = slotKey(item.v, item.p);
    const live = liveBySlot.get(key);
    const rows = rowsBySlot.get(key) || [];
    const landed = live && rows.find((row) => hasMark(live, row._id) && row.appliedHash === fingerprint(live));
    const recorded = !landed && item.a ? rows.find((row) => String(row._id) === String(item.a)) : null;
    if (landed || recorded) {
      const res = applyEditPlan(questions, snapshotOf(landed || recorded).answers || [], plan, { mode: 'bulk', flow });
      if (res.changed) fold(counts, questions, res);
      item.a = (landed || recorded)._id;
      continue;
    }
    if (!live) {
      counts.notFound += 1;
      sample(counts, item.v, 'not_found');
      continue;
    }
    if (String(live.surveyTemplateId) !== String(run.template?.surveyTemplateId) || fingerprint(live) !== item.h) {
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
    // Would change, but this run's edit isn't on it: its write missed.
    counts.changedSinceReview += 1;
    sample(counts, item.v, 'changed_since_review');
  }
  return { counts, items: out };
};

/**
 * The fences a survey must carry when it is written back from an older copy — a turf snapshot
 * restore, an unknock or conversion undo, a profile restore into an empty slot or a full swap: every
 * answer-edit run whose undo has reached that slot (its chunk is fenced). Without it the survey came
 * back unfenced and a delivery of that run still running could land on it (round 3).
 * Map<slotKey, ObjectId[]>.
 */
export const fencesForSlots = async (campaignId, slots) => {
  const out = new Map();
  if (!slots.length) return out;
  const wanted = new Set(slots.map((x) => slotKey(x.voterId, x.passId ?? null)));
  const chunks = await AnswerEditRunChunk.find(
    { campaignId: asId(campaignId), fenced: true, 'items.v': { $in: [...new Set(slots.map((x) => String(x.voterId)))].map(asId) } },
    { runId: 1, items: 1 }
  ).lean();
  for (const c of chunks) {
    for (const it of c.items || []) {
      const k = slotKey(it.v, it.p ?? null);
      if (!wanted.has(k)) continue;
      if (!out.has(k)) out.set(k, []);
      if (!out.get(k).some((id) => String(id) === String(c.runId))) out.get(k).push(asId(c.runId));
    }
  }
  return out;
};

/** A survey document about to be written back, with every fence it must keep (fencesForSlots). */
export const withFences = (doc, fences, keep = []) => {
  const all = [...(doc.answerEditFence || []), ...keep, ...(fences.get(slotKey(doc.voterId, doc.passId ?? null)) || [])];
  const ids = [...new Map(all.map((id) => [String(id), asId(id)])).values()];
  return ids.length ? { ...doc, answerEditFence: ids } : doc;
};

// This run's copies for a chunk's surveys, BY SLOT (voter + round) — never only by the survey ids
// the chunk froze: a survey re-created under a new id before the edit reached it keeps its copy
// under that new id, and the undo once missed it (round 3).
const runCopiesBySlot = async (run, items) => {
  const wanted = new Set(items.map((it) => slotKey(it.v, it.p)));
  const rows = await ARCH()
    .find({ answerEditRunId: asId(run._id), voterId: { $in: [...new Set(items.map((it) => String(it.v)))].map(asId) } })
    .toArray();
  const bySlot = new Map();
  for (const row of rows) {
    const k = slotOfRow(row);
    if (!wanted.has(k)) continue;
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(row);
  }
  return bySlot;
};

/**
 * Edit ONE survey — a walkthrough step, the profile's Edit, an answer-edit Restore into the
 * survey's own visit. `live` is the raw survey as the caller read it (its version check is the
 * caller's), `nextAnswers` the full answer set to write (null = answers unchanged), `nextNote`
 * the note to write (undefined = unchanged). Archives first, then one compare-and-swap; a miss
 * deletes the row it inserted and reports a conflict.
 */
export const writeOneSurvey = async ({ live, nextAnswers = null, nextNote, byUserId, at = new Date(), runId = null, consumedMark = null }) => {
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
    // A one-person step of a run whose undo has reached this survey never lands.
    ...(runId ? { answerEditFence: { $ne: asId(runId) } } : {}),
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
  // Restoring an answer-edit copy into its own visit consumes it: its mark comes off in the same
  // write (left on, the run's Undo read the survey as "erased" when it had been restored). One
  // update can't $push and $pull one array, so the marks are set from the read — the filter pins them.
  let update = { $set, $push: { answerEditMarks: row._id } };
  if (consumedMark) {
    filter.answerEditMarks = live.answerEditMarks === undefined ? { $exists: false } : live.answerEditMarks;
    const kept = (live.answerEditMarks || []).filter((m) => String(m) !== String(consumedMark));
    update = { $set: { ...$set, answerEditMarks: [...kept, row._id] } };
  }
  const res = await SR().updateOne(filter, update);
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
      const conv = await SurveyConversionRun.findById(h.conversionRunId, { revertedAt: 1, createdAt: 1, to: 1 }).lean();
      // Its target too: the words name the outcome the survey was changed to (round 3).
      if (conv && !conv.revertedAt) return { kind: 'conversion', at: conv.createdAt, to: conv.to || null };
    }
    if (h.unknockRunId) {
      const unk = await UnknockRun.findById(h.unknockRunId, { status: 1, revertedAt: 1, createdAt: 1, deletingAt: 1 }).lean();
      // Standing as Restore reads it: completed, or past its first removal (one that stopped part-way
      // is undoable too — round 4: its surveys read gone, and the edit's row offered no Undo again).
      const standing = unk && !unk.revertedAt && (unk.status === 'completed' || (unk.status === 'pending' && unk.deletingAt));
      if (standing) return { kind: 'unknock', at: unk.createdAt };
    }
  }
  return null;
};

/**
 * One undo pass over a run's chunks — re-entrant, so Undo again finishes whatever a pass couldn't.
 * Classifies every archive row of the run against the live survey (§G's table) and every frozen
 * survey whose landed row is gone (§H2), and returns the summary the run stores. The summary is the
 * whole undo's, every pass so far included: History logs what it adds (answerEditRuns.js).
 */
const undone = (live, rowId) => (live?.answerEditUndone || []).some((m) => String(m) === String(rowId));

export const undoRunPass = async ({ run, chunks, beforeChunk = null, legacy = false }) => {
  // `putBack` counts every survey this run's undo has put back, in any pass: each proven put-back is
  // recorded on its frozen item (`u`), so the count only grows, whatever happens to the survey after
  // (round 3: a survey put back and later deleted dropped out of the count, and so out of History).
  // The proof of a put-back is the copy's id in the survey's `answerEditUndone`, written by the
  // put-back itself (round 1). A run first undone by the first build, which wrote no receipts
  // (`legacy`), also accepts a survey holding exactly the answers that were reviewed.
  const summary = { putBack: 0, changedSince: 0, restoredOnProfile: 0, waiting: 0, cleared: 0, erased: 0, gone: 0 };
  let legacyCredited = 0;
  const names = [];
  let namesTotal = 0;
  const name = (voterId, reason, detail = null) => {
    namesTotal += 1;
    if (names.length < UNDO_NAME_CAP) names.push({ voterId, reason, detail });
  };
  const newestFirst = (x, y) =>
    new Date(y.overwrittenAt || 0) - new Date(x.overwrittenAt || 0) || String(y._id).localeCompare(String(x._id));

  for (const listed of chunks) {
    if (!(listed.items || []).length) continue;
    if (beforeChunk) await beforeChunk(listed);
    // The fence first (see the header): from here on no delivery of this run lands on these surveys
    // or rewrites this chunk, so nothing read below changes under the classification.
    await AnswerEditRunChunk.updateOne({ _id: listed._id }, { $set: { fenced: true } });
    const slotsOr = listed.items.map((it) => ({ voterId: asId(it.v), passId: it.p ? asId(it.p) : null }));
    await SR().updateMany({ $or: slotsOr }, { $addToSet: { answerEditFence: asId(run._id) } });
    // The chunk as the last apply delivery left it — one may have finished after the caller read it.
    const chunk = (await AnswerEditRunChunk.findById(listed._id, { items: 1 }).lean()) || listed;
    const items = chunk.items || [];
    // The copies BEFORE the surveys: another pass of this undo (a redelivery running beside this one)
    // puts a survey back and only then deletes its copy, so a copy this read missed was put back
    // before the survey read below — which then shows the receipt (round 2). By slot (round 3), each
    // survey's newest first: a one-person session that saved one survey twice is undone in one pass.
    const rowsBySlot = await runCopiesBySlot(run, items);
    const liveRows = await SR().find({ $or: slotsOr }).toArray();
    const liveBySlot = new Map(liveRows.map((r) => [slotOfRow(r), r]));
    // A survey put back that still carries an edit of this run whose copy is gone — erased on the
    // profile, the original with it — can't go back any further: it reads erased, not put back (round
    // 5: a one-person session saved a survey twice, the first copy was erased, and Undo said "put back"
    // while the survey held the session's own first save). This run's marks are the ones made since it
    // began; copies on file are read once per chunk (an undo's own put-backs pull their marks).
    const marks = [...new Set(liveRows.flatMap((r) => (r.answerEditMarks || []).map(String)))];
    const copiesOnFile = new Set(
      (marks.length ? await ARCH().find({ _id: { $in: marks.map(asId) } }, { projection: { _id: 1 } }).toArray() : []).map((r) => String(r._id))
    );
    // Which marks are this run's: a Same change for everyone run lands one copy per survey (`a`), a
    // one-person session one per save (`as`) — round 6: any mark made since the run began counted, and
    // a note-only profile edit whose copy was erased read a survey put back as erased. A session from
    // before `as` falls back to the marks made since the run began. A survey left at exactly the answers
    // that were reviewed is put back, whatever else it carries.
    // ...and, for one, the marks made while it was open: a session's saves end at its Close (round 7: a
    // profile edit's copy erased after the session closed read as the session's).
    const runBegan = new Date(run.createdAt || 0).getTime() - 1000;
    const runEnded = run.completedAt ? new Date(run.completedAt).getTime() + 1000 : Infinity;
    const madeWhileOpen = (m) => {
      const t = asId(m).getTimestamp().getTime();
      return t >= runBegan && t <= runEnded;
    };
    const runCopiesOf = (item) => (item.as?.length ? item.as.map(String) : run.mode === 'queue' ? null : item.a ? [String(item.a)] : []);
    const holdsErasedEdit = (live, item) => {
      if (!live || (item.h && fingerprint(live) === item.h)) return false;
      const mine = runCopiesOf(item);
      return (live.answerEditMarks || []).some(
        (m) => !copiesOnFile.has(String(m)) && !undone(live, m) && (mine ? mine.includes(String(m)) : madeWhileOpen(m))
      );
    };
    // The copy whose edit is on the survey first, then newest first: two copies of one original (one
    // that never landed, beside the one that did) share their moment, and the twin read first held the
    // survey as changed before the landed one was put back (round 4).
    for (const [k, list] of rowsBySlot) {
      const live = liveBySlot.get(k);
      const landedHere = (row) => (live && hasMark(live, row._id) && fingerprint(live) === row.appliedHash ? 1 : 0);
      list.sort((x, y) => landedHere(y) - landedHere(x) || newestFirst(x, y));
    }
    const proven = new Map(); // item index -> the copy whose put-back proves it
    const provenLegacy = new Set(); // ...of those, the first build's (no receipt)

    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      const key = slotKey(item.v, item.p);
      const slotRows = rowsBySlot.get(key) || [];
      const liveAtStart = liveBySlot.get(key) || null;

      // A put-back is recorded on its item (`u`) as it lands, and settled (`us`) once the pass that made it
      // has finished the survey: until then it is provisional — a pass that died in between may have put
      // back only the later of a session's copies (round 8: the retry took the survey as done, and it kept
      // the session's first save), or not yet have read it erased. So a survey with a copy of this run still
      // landed on it goes through the copies again, and only a provisional put-back is read for erased: a
      // settled one only ever counts, whatever is erased after (round 8: one that flipped dropped another
      // survey's put-back from History). And only with the survey on file: off file, a later change took it —
      // an unknock, a conversion, a re-cut — perhaps with a copy of this run still landed on it, and it is
      // read below (round 9: counted and settled here, it came back with that change's Undo holding the
      // session's first save, and the run read Undone with no Undo again).
      const stillLanded = !!liveAtStart && slotRows.some((row) => hasMark(liveAtStart, row._id) && fingerprint(liveAtStart) === row.appliedHash);
      if (item.u && liveAtStart && !stillLanded) {
        // Put back by an earlier pass. A copy a pass that died left behind (C6), or a redundant one,
        // goes; anything else stays as history.
        const live = liveBySlot.get(key) || null;
        if (!item.us && holdsErasedEdit(live, item)) {
          summary.erased += 1;
          name(item.v, 'erased');
        } else {
          summary.putBack += 1;
          if (item.l) legacyCredited += 1;
          if (!item.us) proven.set(idx, item.u);
        }
        for (const row of slotRows) {
          if (live && (undone(live, row._id) || sameContent(snapshotOf(row), live))) await ARCH().deleteOne({ _id: row._id });
        }
        continue;
      }

      if (!slotRows.length) {
        const live = liveBySlot.get(key) || null;
        // Nothing of this run's left for this survey. Only a survey this run's edit landed on
        // has anything to report.
        if (!item.a) continue;
        if (live && undone(live, item.a) && holdsErasedEdit(live, item)) {
          summary.erased += 1;
          name(item.v, 'erased');
        } else if (live && undone(live, item.a)) {
          // Put back by an earlier pass of this undo.
          proven.set(idx, item.a);
          summary.putBack += 1;
        } else if (!live) {
          // Off file with no copy of this run left: a re-cut that cleared the round holds it, with any copy of
          // the session's (round 9: only its last copy was looked for, and a session's earlier one, still
          // landed, went into the snapshot with the survey); else a put-back an earlier pass made still
          // counts, the survey deleted since (round 7).
          const mine = [...new Set([...(item.as || []), item.a, item.u].filter(Boolean).map(String))].map(asId);
          const snap = await TurfSnapshot.exists({ passId: item.p ?? null, 'responseArchives._id': { $in: mine } });
          if (snap) {
            summary.cleared += 1;
            name(item.v, 'cleared');
          } else if (item.u) {
            summary.putBack += 1;
            if (item.l) legacyCredited += 1;
            if (!item.us) proven.set(idx, item.u);
          } else {
            summary.gone += 1;
            name(item.v, 'gone');
          }
        } else if (hasMark(live, item.a)) {
          summary.erased += 1;
          name(item.v, 'erased');
        } else if (legacy && item.h && fingerprint(live) === item.h) {
          // Put back by the first build's undo, which wrote no receipt.
          proven.set(idx, item.a);
          provenLegacy.add(idx);
          summary.putBack += 1;
          legacyCredited += 1;
        } else {
          summary.restoredOnProfile += 1;
          name(item.v, 'restored_on_profile');
        }
        continue;
      }

      // Every copy of this survey, the landed one first, then newest first. A survey any of them put
      // back counts as put back; otherwise the first one that can't be put back names its reason.
      let outcome = null;
      let putBackId = item.u || null;
      // Held off file by a later change with a copy of this run still landed on it (see below).
      let waitingFor = null;
      const hold = (bucket, reason, detail = null) => {
        if (!outcome) outcome = { bucket, reason, detail };
      };
      // A put-back proven only by its receipt: its record and its copy's delete go at once, and the delete
      // landed alone — the survey holds the receipt of a copy of this run's that is no longer on file (round
      // 9: never counted while another copy of the survey remained).
      if (!putBackId && liveAtStart) {
        const onFile = new Set(slotRows.map((row) => String(row._id)));
        const proof = (runCopiesOf(item) || (item.a ? [String(item.a)] : [])).find((id) => !onFile.has(String(id)) && undone(liveAtStart, id));
        if (proof) putBackId = asId(proof);
      }
      // A put-back is recorded on its item (`u`, provisional) together with its copy's delete — the two at
      // once, in no set order: a pass that died after the copy went, and then a Delete of the survey on the
      // profile, left a put-back nothing proved, and History counted one fewer (round 7; one after the other
      // they made a 37,500-survey undo a third slower). A survey that then reads erased takes it off again.
      let recorded = false;
      // The first build's credit for this survey (below) depends only on the survey as read and the copies
      // on file, so it is known before any put-back and rides the same record as `u` (round 8: written
      // after, a pass that died between them logged the survey a second time).
      let legacyA = !!(legacy && item.a && liveAtStart && !slotRows.some((row) => String(row._id) === String(item.a)) && !hasMark(liveAtStart, item.a) && !undone(liveAtStart, item.a));
      // ...never where a profile Restore has swapped answers in since that copy was made: the Restore, not the
      // first build, took it away (round 8: credited as logged, a real put-back went unlogged).
      if (legacyA && (await ARCH().findOne({ voterId: asId(item.v), passId: item.p ? asId(item.p) : null, overwrittenVia: 'restore', overwrittenAt: { $gt: asId(item.a).getTimestamp() } }, { projection: { _id: 1 } }))) legacyA = false;
      const putBackGoes = async (id) => {
        recorded = true;
        await Promise.all([
          AnswerEditRunChunk.updateOne({ _id: chunk._id }, { $set: { [`items.${idx}.u`]: asId(id), ...(legacyA ? { [`items.${idx}.l`]: true } : {}) } }),
          ARCH().deleteOne({ _id: id }),
        ]);
      };
      for (const row of slotRows) {
        // Re-read per row: a put-back earlier in this loop changed what's on file.
        const live = liveBySlot.get(key) || null;
        if (!live) {
          const holder = await heldBy(row);
          if (holder) {
            waitingFor = waitingFor || holder;
            hold('waiting', 'waiting', holder);
          } else hold('gone', 'gone');
          continue;
        }
        const fpLive = fingerprint(live);
        if (hasMark(live, row._id) && fpLive === row.appliedHash) {
          // Put back: stamp first (C6) — the stamp is what keeps an Erase out until the copy is put
          // back. Then one compare-and-swap writing only the answers and the edit stamp, so a later
          // team re-stamp or note edit stays.
          const stamped = await ARCH().updateOne({ _id: row._id }, { $set: { undoStartedAt: new Date() } });
          if (stamped.matchedCount !== 1) {
            // The copy left since the read: put back by another pass (its receipt says so),
            // restored on the profile (that consumes the copy's mark), or erased (an Erase leaves it).
            const now = await SR().findOne({ _id: live._id });
            if (now) liveBySlot.set(key, now);
            if (!now) {
              // ...and the survey has left too: nothing of this run's is on file for it (round 4: read
              // as restored on the profile).
              const holder = await heldBy(row);
              if (holder) hold('waiting', 'waiting', holder);
              else hold('gone', 'gone');
            } else if (undone(now, row._id)) putBackId = row._id;
            else if (hasMark(now, row._id)) {
              // Erased since the copies were read: what it held is gone, so the one erased rule below reads
              // it so too — a put-back of a later copy no longer reads "put back" (round 7).
              copiesOnFile.delete(String(row._id));
              hold('erased', 'erased');
            } else hold('restoredOnProfile', 'restored_on_profile');
            continue;
          }
          const snap = snapshotOf(row);
          const res = await SR().updateOne(casFilter(live), {
            $set: {
              answers: snap.answers ?? [],
              editedBy: snap.editedBy ?? null,
              editedAt: snap.editedAt ?? null,
              updatedAt: new Date(),
            },
            $pull: { answerEditMarks: row._id },
            $addToSet: { answerEditUndone: row._id },
          });
          if (res.matchedCount === 1) {
            await putBackGoes(row._id);
            putBackId = row._id;
            // The survey is now the snapshot: the next copy for this slot compares to that.
            const fresh = await SR().findOne({ _id: live._id });
            if (fresh) liveBySlot.set(key, fresh);
            continue;
          }
          const now = await SR().findOne({ _id: live._id });
          if (now) liveBySlot.set(key, now);
          if (now && undone(now, row._id)) {
            // Another pass of this undo put it back first.
            putBackId = row._id;
            continue;
          }
          // Missed: nothing was put back, so the stamp comes off — a stamp left on read as a landed
          // put-back on Undo again and deleted the only copy of the original.
          await ARCH().updateOne({ _id: row._id }, { $unset: { undoStartedAt: '' } });
          hold('changedSince', 'changed_since', { kind: 'changed', by: null });
          continue;
        }
        if (undone(live, row._id)) {
          // Put back in a pass that died before deleting the copy (C6) — proven by the put-back's
          // own record on the survey, whatever happened to the survey since.
          await putBackGoes(row._id);
          putBackId = row._id;
          continue;
        }
        if (legacy && row.undoStartedAt && !hasMark(live, row._id) && sameContent(snapshotOf(row), live)) {
          // The first build's put-back, from a pass that died before deleting the copy: it pulled the
          // mark and wrote no receipt, and the survey holds the copy (round 4: never counted).
          await putBackGoes(row._id);
          putBackId = row._id;
          continue;
        }
        if (row.undoStartedAt) {
          // Stamped, but no put-back landed (it missed, or the pass died first): unstamp, classify.
          await ARCH().updateOne({ _id: row._id }, { $unset: { undoStartedAt: '' } });
        }
        if (sameContent(snapshotOf(row), live)) {
          // The edit never landed and nothing about the survey changed since: the copy holds nothing
          // the survey doesn't. The fence keeps a delivery still holding it from landing after.
          await ARCH().deleteOne({ _id: row._id });
          continue;
        }
        hold('changedSince', 'changed_since', changedSinceDetail(live, row, run));
      }
      if (!liveAtStart && waitingFor) {
        // Off file, held by a later change with a copy of this run still landed on it: it comes back holding
        // this run's edit, whatever an earlier pass put back — waiting, ahead of any copy that reads gone, its
        // put-back left provisional for the Undo again that change's undo makes possible (round 9).
        summary.waiting += 1;
        name(item.v, 'waiting', waitingFor);
      } else if (putBackId && !item.us && holdsErasedEdit(liveBySlot.get(key), item)) {
        if (recorded) await AnswerEditRunChunk.updateOne({ _id: chunk._id }, { $unset: { [`items.${idx}.u`]: '' } });
        summary.erased += 1;
        name(item.v, 'erased');
      } else if (putBackId) {
        // Put back — whatever an older copy of this run still holds; that one stays on the profile as
        // history (round 4: its hold hid the put-back, and History read "0 put back"). A first-build
        // put-back proven by its copy still on file came from a pass that died, which logged nothing:
        // it is not credited as already in History (round 5).
        proven.set(idx, putBackId);
        summary.putBack += 1;
        // A first-build session that saved this survey more than once, whose undo's one pass put back its
        // latest copy (`a`) and logged it: that copy is gone, its mark pulled, and no receipt names it —
        // this pass put back an older one. Already in History (round 7: credited nothing, the next row
        // logged the same survey a second time).
        if (item.l || legacyA) {
          provenLegacy.add(idx);
          legacyCredited += 1;
        }
        // ...on its item too, at once: the put-back already is.
        if (provenLegacy.has(idx)) await AnswerEditRunChunk.updateOne({ _id: chunk._id }, { $set: { [`items.${idx}.l`]: true } });
      } else if (outcome?.bucket === 'changedSince' && holdsErasedEdit(liveBySlot.get(key), item)) {
        // Nothing could go back, and an edit of this run whose copy was erased is still on the survey: the
        // answers from before it are gone — erased, not "kept newer answers" (round 7).
        summary.erased += 1;
        name(item.v, 'erased');
      } else if (outcome) {
        summary[outcome.bucket] += 1;
        name(item.v, outcome.reason, outcome.detail);
      }
    }

    // Each proven put-back on its item, field by field, so two passes at once never lose one.
    if (proven.size) {
      await AnswerEditRunChunk.updateOne(
        { _id: chunk._id },
        {
          $set: Object.fromEntries(
            [...proven].flatMap(([i, id]) => [[`items.${i}.u`, asId(id)], [`items.${i}.us`, true], ...(provenLegacy.has(i) ? [[`items.${i}.l`, true]] : [])])
          ),
        }
      );
    }
  }
  return { summary, names, namesTotal, legacyCredited };
};
