// Dual-read survey answer aggregation. Counts + voter queries key off the STABLE
// option id (answers.optionIds) and fall back to the legacy literal text
// (answers.answer) for responses recorded before ids existed (or whose option was
// renamed/removed). So: renaming an option never breaks a count (id is stable);
// removing one surfaces its old answers as a "retired/legacy" bucket. See docs/SURVEYS.md.

import { tagOptionMap, normalizeTag } from './tags.js';
import { OTHER_OPTION_ID, otherBucketLabel } from './otherOption.js';

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
  // The "Other: ___" write-in is a question FLAG, not a row in options[] — so without this seed
  // every write-in falls to the legacy-orphan branch below and surfaces as a bucket literally
  // labelled `__other__` and badged retired, with a null id that makes its drill-in match nothing.
  //
  // byId ONLY, never byText: seeding the text would let the sentinel clobber a real option an
  // operator named "Other", silently re-attributing that option's legacy text rows to the write-in
  // (measured: the real option's count fell while the sentinel's rose). The sentinel only ever
  // arrives here as an option id, so the id lane alone is sufficient.
  if (question?.otherOption) {
    byId.set(OTHER_OPTION_ID, { id: OTHER_OPTION_ID, text: otherBucketLabel(question), retired: false });
  }
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
  // The write-in bucket has NO stable text — `answer` holds whatever the canvasser typed — so the
  // legacy-text lane is pure noise for it AND an active hazard: it can never find a real write-in
  // ("potholes" is not "Other"), while it does steal an option an operator named "Other", a legacy
  // row whose snapshot happens to read "Other", and any multi-select array containing "Other".
  // Measured against a 3-write-in population, the unguarded clause returned 6. Match by id alone.
  if (optionText != null && optionId !== OTHER_OPTION_ID) {
    ors.push({ answers: { $elemMatch: { questionKey, answer: optionText } } });
  }
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

// Pipeline fragment for "latest answer wins": after the caller's $match, resolve — per
// (voter, question) — the answer keys of the voter's most RECENT in-scope response that
// actually ANSWERS that question. A later response that skipped the question (branching
// drops the answers[] entry entirely) never produces a row for it, so it can neither
// carry a tag forward nor erase an earlier answer — exactly the "latest answer", not
// "latest response", semantics the current-tag rollup is defined on.
export function latestAnswerKeyStages(questionKeys) {
  return [
    { $unwind: '$answers' },
    { $match: { 'answers.questionKey': { $in: questionKeys } } },
    // Dual-read key set — same id-native-first $cond as choiceKeyStages above.
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
    // "Answers the question" = at least one non-null, non-empty key. Ghost rows (an admin
    // edit preserves hidden-question entries with null answers — normalizeAnswers.js with
    // dropHidden:false) carry nothing, so they can neither current NOR un-current a voter.
    {
      $addFields: {
        _validKeys: {
          $filter: {
            input: '$_answerKeys',
            cond: { $and: [{ $ne: ['$$this', null] }, { $ne: ['$$this', ''] }] },
          },
        },
      },
    },
    { $match: { '_validKeys.0': { $exists: true } } },
    // Slim before the blocking sort: sort memory holds only these four fields per row.
    { $project: { voterId: 1, submittedAt: 1, _qk: '$answers.questionKey', _validKeys: 1 } },
    // Latest wins: max submittedAt, tie-break _id desc — the order-dependent $sort + $first
    // pairing (the survey-results preview uses the same idiom). The mirror image of the
    // first-finder attribution's min/asc sort.
    { $sort: { submittedAt: -1, _id: -1 } },
    {
      $group: {
        _id: { voterId: '$voterId', questionKey: '$_qk' },
        latestKeys: { $first: '$_validKeys' },
      },
    },
  ];
}

// One tag's member keys, per question: Map<questionKey, Set<option id | option text>>.
// Both dual-read lanes share one set — a row's latestKeys are ids OR texts, never mixed
// (choiceKeyStages' branch picks one lane per row). No '__other__' case is needed: tags
// live on options[] rows only (tagOptionMap iterates q.options) and the write-in is a
// question FLAG, so the sentinel can never be a tag member.
export function tagMemberKeySets(entry) {
  const byQ = new Map();
  for (const m of entry?.members || []) {
    let set = byQ.get(m.questionKey);
    if (!set) {
      set = new Set();
      byQ.set(m.questionKey, set);
    }
    if (m.optionId) set.add(m.optionId);
    if (m.text != null && m.text !== '') set.add(m.text);
  }
  return byQ;
}

// Fold latestAnswerKeyStages output into the set of voters who CURRENTLY carry the tag:
// a voter is current when ANY member question's latest answer selects a tag-carrying
// option. Rows for non-member questions are ignored (the caller may aggregate once over
// the union of several tags' questions and fold per tag).
export function currentTagVoterSet(rows, entry) {
  const byQ = tagMemberKeySets(entry);
  const out = new Set();
  for (const row of rows || []) {
    const set = byQ.get(row._id.questionKey);
    if (!set) continue;
    if ((row.latestKeys || []).some((k) => set.has(k))) out.add(String(row._id.voterId));
  }
  return out;
}
