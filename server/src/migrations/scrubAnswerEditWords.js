import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { AnswerEditRun } from '../models/AnswerEditRun.js';
import { AnswerEditRunChunk } from '../models/AnswerEditRunChunk.js';
import { OTHER_OPTION_ID } from '../services/surveys/otherOption.js';
import { UNLISTED_PICK } from '../services/canvass/answerEditWriter.js';

// Rewrite two kinds of words the first build of Edit answers (589c1c0) stored on its runs to what
// the current code stores (code review 2026-10-19, round 2):
//
//  1. Pick counts keyed by a VOTER'S OWN WORDS. counts.byOption — on the run and on each chunk —
//     keyed a pick of an old text-only answer by its text, so clearing a written answer stored what
//     the voter said, word for word, as its own "pick": sent with every poll of the run and kept
//     after an Erase of the survey's copies. A written-answer question's rows are dropped (it is
//     counted per question, in byQuestion). On a choice question, a key that is one of the
//     question's option TEXTS is that option (the writer's reading, answerEdit.js idsOfRow — round 3:
//     folding it into `unlisted` miscounted it), and any other key that isn't an option id folds
//     into the question's one `__unlisted__` row. Keyed by text, an old answer the edit kept read as
//     that option taken out AND put in; on a Same change for everyone run — one plan for every
//     survey, which never both takes out and puts in one option — those pairs are netted away. A
//     One person at a time session may hold real pairs (one step took the option out, another put
//     it in), so its pairs are left as they are.
//  2. Undo details written as words with a person's name in them ("re-surveyed by Jane Doe"). The
//     current code stores { kind, by } and writes the words when the run is read, so a name follows
//     the account. A string detail can't be traced back to an account, so it becomes { kind } with
//     no one on it ("re-surveyed").
//
//   npm run repair:answer-edit-words              # dry run — count what would change
//   npm run repair:answer-edit-words -- --apply   # rewrite it
//
// Safe + idempotent: what it writes is what it accepts.
const APPLY = process.argv.includes('--apply');

const optionIdsOf = (q) => {
  const ids = new Set((q?.options || []).map((o) => o.id));
  if (q?.otherOption) ids.add(OTHER_OPTION_ID);
  ids.add(UNLISTED_PICK);
  return ids;
};

// One pick row → its clean key and label, or null to drop it.
const cleanKey = (questions, o) => {
  const q = questions.find((x) => x.key === o.questionKey);
  if (q && !(q.options || []).length && !q.otherOption) return null; // a written-answer question
  if (optionIdsOf(q).has(o.key)) return { key: o.key, label: o.label };
  const byText = (q?.options || []).find((opt) => opt.text === o.key);
  return byText ? { key: byText.id, label: byText.text } : { key: UNLISTED_PICK, label: 'unlisted' };
};

const foldRows = (questions, rows, { netPairs }) => {
  const out = new Map();
  let changed = false;
  for (const o of rows) {
    const clean = cleanKey(questions, o);
    if (!clean || clean.key !== o.key) changed = true;
    if (!clean) continue;
    const k = `${o.questionKey}\u0001${clean.key}`;
    const into = out.get(k) || { questionKey: o.questionKey, key: clean.key, label: clean.label, removed: 0, added: 0 };
    into.removed += o.removed || 0;
    into.added += o.added || 0;
    out.set(k, into);
  }
  if (netPairs) {
    for (const [k, row] of out) {
      const pair = Math.min(row.removed, row.added);
      if (!pair) continue;
      changed = true;
      row.removed -= pair;
      row.added -= pair;
      if (!row.removed && !row.added) out.delete(k);
    }
  }
  return { rows: [...out.values()], byKey: Object.fromEntries(out), changed };
};

const NAMED = [
  [/^re-surveyed by /, 'resurveyed'],
  [/^edited by /, 'edited'],
];
const cleanDetail = (d) => {
  if (typeof d !== 'string') return { detail: d, changed: false };
  const hit = NAMED.find(([re]) => re.test(d));
  return hit ? { detail: { kind: hit[1], by: null, at: null }, changed: true } : { detail: d, changed: false };
};

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const total = await AnswerEditRun.countDocuments({});
  console.log(`Answer-edit runs: ${total}. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  let runsWithWords = 0;
  let chunksWithWords = 0;
  let namedDetails = 0;
  for await (const run of AnswerEditRun.find({}, { mode: 1, template: 1, counts: 1, undo: 1 }).lean().cursor()) {
    const questions = run.template?.questions || [];
    const netPairs = run.mode === 'bulk';
    const set = {};

    const byOption = foldRows(questions, run.counts?.byOption || [], { netPairs });
    if (byOption.changed) set['counts.byOption'] = byOption.rows;

    const names = run.undo?.summary?.names || [];
    let named = 0;
    const cleanNames = names.map((n) => {
      const c = cleanDetail(n.detail);
      if (c.changed) named += 1;
      return { ...n, detail: c.detail };
    });
    if (named) set['undo.summary.names'] = cleanNames;
    namedDetails += named;

    if (Object.keys(set).length) {
      runsWithWords += 1;
      if (APPLY) await AnswerEditRun.collection.updateOne({ _id: run._id }, { $set: set });
    }

    for await (const chunk of AnswerEditRunChunk.find({ runId: run._id }, { counts: 1 }).lean().cursor()) {
      const folded = foldRows(questions, Object.values(chunk.counts?.byOption || {}), { netPairs });
      if (!folded.changed) continue;
      chunksWithWords += 1;
      if (APPLY) await AnswerEditRunChunk.collection.updateOne({ _id: chunk._id }, { $set: { 'counts.byOption': folded.byKey } });
    }
  }

  console.log(`${APPLY ? 'Rewrote' : 'Would rewrite'}: ${runsWithWords} run(s), ${chunksWithWords} chunk(s), ${namedDetails} named undo detail(s).`);
  if (!APPLY && (runsWithWords || chunksWithWords)) console.log('Run again with -- --apply to rewrite them.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
