// Dual-read survey answer aggregation. Counts + voter queries key off the STABLE
// option id (answers.optionIds) and fall back to the legacy literal text
// (answers.answer) for responses recorded before ids existed (or whose option was
// renamed/removed). So: renaming an option never breaks a count (id is stable);
// removing one surfaces its old answers as a "retired/legacy" bucket. See docs/SURVEYS.md.

import { tagOptionMap, normalizeTag } from './tags.js';

// Pipeline fragment for one choice question: after the caller's $match on the response
// set, explode one row per chosen answer-key — the option id(s) for id-native rows, or
// the literal text (wrapped to an array) for legacy rows. Works for single + multiple.
export function choiceKeyStages(questionKey) {
  return [
    { $unwind: '$answers' },
    { $match: { 'answers.questionKey': questionKey } },
    {
      $addFields: {
        _answerKeys: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ['$answers.optionIds', []] } }, 0] },
            '$answers.optionIds',
            { $cond: [{ $isArray: '$answers.answer' }, '$answers.answer', ['$answers.answer']] },
          ],
        },
      },
    },
    { $unwind: '$_answerKeys' },
    { $match: { _answerKeys: { $ne: null } } },
  ];
}

// Merge raw aggregation rows ({ _id: <option id | legacy text>, count, responseIds? })
// onto the question's CURRENT options (matched by id, then by text). Leftover texts with
// no current option become retired orphan buckets (id:null). Returns
// [{ id, text, retired, count, responseIds }] sorted desc by count.
export function mergeOptionRows(question, rows, { previewLimit = 0 } = {}) {
  const byId = new Map((question.options || []).map((o) => [o.id, o]));
  const byText = new Map((question.options || []).map((o) => [o.text, o]));
  const merged = new Map();
  const bump = (mapKey, base, row) => {
    const cur = merged.get(mapKey) || { ...base, count: 0, responseIds: [] };
    cur.count += row.count;
    if (row.responseIds) cur.responseIds.push(...row.responseIds);
    merged.set(mapKey, cur);
  };
  for (const row of rows) {
    if (row._id == null || row._id === '') continue;
    const opt = byId.get(row._id) || byText.get(row._id);
    if (opt) bump(opt.id, { id: opt.id, text: opt.text, retired: !!opt.retired }, row);
    else bump(`legacy:${row._id}`, { id: null, text: String(row._id), retired: true }, row);
  }
  const out = [...merged.values()].sort((a, b) => b.count - a.count);
  if (previewLimit > 0) for (const o of out) o.responseIds = o.responseIds.slice(0, previewLimit);
  return out;
}

// Match clause for "voters who chose this option": id-native OR legacy text.
// `optionId` may be null for an orphan/legacy bucket (then match by text only).
// (A $elemMatch on `answer` also matches multi-select arrays that CONTAIN the text.)
export function voterAnswerClause(questionKey, optionId, optionText) {
  const ors = [];
  if (optionId) ors.push({ answers: { $elemMatch: { questionKey, optionIds: optionId } } });
  if (optionText != null) ors.push({ answers: { $elemMatch: { questionKey, answer: optionText } } });
  return ors.length ? { $or: ors } : { _id: null }; // nothing selectable → matches nothing
}

// Filter clause for Saved Searches / targeted rounds: match any of the chosen option
// ids (id-native) OR their current texts (legacy). `ids` + `texts` are parallel-ish
// sets describing the selected options.
export function answerFilterClause(questionKey, values = [], texts = []) {
  const ors = [];
  if (values.length) ors.push({ answers: { $elemMatch: { questionKey, optionIds: { $in: values } } } });
  // `values` may be option ids (new) OR literal text (legacy saved filters); try both as
  // answer text, plus any explicit current texts passed for the chosen ids.
  const textVals = [...new Set([...values, ...texts])];
  if (textVals.length) ors.push({ answers: { $elemMatch: { questionKey, answer: { $in: textVals } } } });
  return ors.length ? { $or: ors } : { _id: null };
}

// Match clause for "voters who chose ANY option carrying this tag" — a single $or across
// the tag's (questionKey, optionId | legacy text) members, ACROSS questions. Reuses
// voterAnswerClause per member. Returns { $or: [...] } or { _id: null } (matches nothing).
export function answerTagClause(template, tag) {
  const entry = tagOptionMap(template).get(normalizeTag(tag));
  if (!entry || !entry.members.length) return { _id: null };
  const ors = [];
  for (const m of entry.members) {
    const c = voterAnswerClause(m.questionKey, m.optionId, m.text);
    if (c.$or) ors.push(...c.$or);
  }
  return ors.length ? { $or: ors } : { _id: null };
}
