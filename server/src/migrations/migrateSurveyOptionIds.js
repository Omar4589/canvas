import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { SurveyTemplate } from '../models/SurveyTemplate.js';
import { SurveyResponse } from '../models/SurveyResponse.js';

// Stable-id foundation for surveys. Two additive, idempotent steps:
//   A. Templates — convert each question's plain-string options to { id, text, ... }
//      objects with a STABLE per-question id (so wording is freely editable without
//      breaking reports). Already-object options are left untouched.
//   B. Responses — enrich each answer with optionIds[] by mapping its snapshot `answer`
//      text to the template's option ids (exact text match). NOTHING is rewritten: the
//      `answer` text stays as the legacy/display fallback; unmatched values (renamed
//      options, free text, "Other") simply get no id and keep reporting under their text.
// Reads via the native driver so legacy string options don't trip Mongoose casting.
// Safe to re-run. Run with --apply WITH/BEFORE the deploy that ships dual-read reporting.
//
// Usage: node src/migrations/migrateSurveyOptionIds.js [--apply]
const APPLY = process.argv.includes('--apply');

function slugify(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

// Unique option id within one question (mirrors the builder's deriveKey collision rule).
function optionId(text, used) {
  const base = slugify(text) || 'opt';
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}

// Step A: returns templateId -> { questionKey -> { optionText -> optionId } } for step B,
// built for EVERY template (not just changed ones) so all responses can be enriched.
async function backfillTemplates() {
  const coll = SurveyTemplate.collection;
  let scanned = 0;
  let changed = 0;
  const textToId = new Map();

  for await (const doc of coll.find({})) {
    scanned++;
    let touched = false;
    const qmap = {};
    const questions = (doc.questions || []).map((q) => {
      const used = new Set();
      const options = (q.options || []).map((o, i) => {
        if (o && typeof o === 'object' && o.id) {
          used.add(o.id);
          return o; // already migrated
        }
        const text = o && typeof o === 'object' ? String(o.text ?? '') : String(o);
        touched = true;
        return { id: optionId(text, used), text, tag: null, script: null, retired: false, order: i };
      });
      qmap[q.key] = Object.fromEntries(options.map((o) => [o.text, o.id]));
      return { ...q, options };
    });
    textToId.set(String(doc._id), qmap);
    if (touched) {
      changed++;
      if (APPLY) await coll.updateOne({ _id: doc._id }, { $set: { questions } });
    }
  }
  console.log(`templates: scanned ${scanned} · ${changed} had legacy string options ${APPLY ? '(converted)' : '(would convert)'}`);
  return textToId;
}

// Step B: add optionIds[] to existing response answers (additive; `answer` text untouched).
async function enrichResponses(textToId) {
  const coll = SurveyResponse.collection;
  let scanned = 0;
  let enriched = 0;

  for await (const r of coll.find({ surveyTemplateId: { $exists: true } })) {
    scanned++;
    const qmap = textToId.get(String(r.surveyTemplateId));
    if (!qmap) continue; // template gone — answers stay legacy text
    let touched = false;
    const answers = (r.answers || []).map((a) => {
      if (Array.isArray(a.optionIds) && a.optionIds.length) return a; // already enriched
      const opts = qmap[a.questionKey];
      if (!opts) return a; // question removed, or free-text (no options)
      const vals = Array.isArray(a.answer) ? a.answer : a.answer == null ? [] : [a.answer];
      const ids = vals.map((v) => opts[v]).filter(Boolean); // unmatched → stays legacy via `answer`
      if (!ids.length) return a;
      touched = true;
      return { ...a, optionIds: ids };
    });
    if (touched) {
      enriched++;
      if (APPLY) await coll.updateOne({ _id: r._id }, { $set: { answers } });
    }
  }
  console.log(`responses: scanned ${scanned} · ${enriched} enriched with optionIds ${APPLY ? '' : '(dry run)'}`);
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}`);
  await connectDb(process.env.MONGODB_URI);
  const textToId = await backfillTemplates();
  await enrichResponses(textToId);
  await mongoose.disconnect();
  console.log(APPLY ? '\nDone.' : '\nDry run — re-run with --apply.');
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
