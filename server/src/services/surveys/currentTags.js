// The "current" tag unit — voters whose LATEST answer still carries a tag.
//
// One owner on purpose: /survey-results, /tag-teams, and the client-report freeze all call
// this, so the three surfaces cannot drift on what "current" means. The semantics (owner
// ruling, Aug 2026): per member QUESTION of the tag, the voter's most recent in-scope
// response THAT ANSWERS the question decides — a later response that skipped it (branching)
// does not override — and the voter is current when ANY member question's latest answer
// selects a tag-carrying option. Latest ANSWER wins, not latest response. Dual-read like
// everything else (stable option ids, legacy text fallback). Current ⊆ identified by
// construction: a qualifying latest answer necessarily matches answerTagClause too.
//
// "Current" is SCOPE-RELATIVE: within a match narrowed to round 1, a round-2 flip is
// invisible — the latest answer *in that scope* is the round-1 one. UIs label accordingly.

import { SurveyResponse } from '../../models/SurveyResponse.js';
import { tagOptionMap, normalizeTag } from './tags.js';
import { latestAnswerKeyStages, currentTagVoterSet } from './answerAgg.js';

// ONE aggregation serves every tag: the per-(voter, question) latest-keys table is
// tag-independent, so we run it once over the union of all member questionKeys and fold
// per tag in JS. `match` is the caller's full response scope (org/campaign/template/date/
// pass/crew — spread-safe: crew clauses arrive under $and via withTeam, never a top-level
// $or). `onlyTags` restricts the fold (array of tag strings, any casing), null = all.
// Returns Map<normalizedTag, Set<voterIdString>>. SurveyResponseArchive never counts —
// separate collection, never aggregated here.
export async function currentVoterSetsByTag(match, template, onlyTags = null) {
  const wanted = onlyTags ? new Set(onlyTags.map(normalizeTag)) : null;
  const entries = [...tagOptionMap(template).entries()].filter(
    ([key]) => !wanted || wanted.has(key)
  );
  if (!entries.length) return new Map();

  const qKeys = [...new Set(entries.flatMap(([, e]) => e.members.map((m) => m.questionKey)))];
  const rows = await SurveyResponse.aggregate([
    // The answers.questionKey pre-filter skips responses with no member-question answer at
    // all before the unwind; latestAnswerKeyStages re-matches per entry after it.
    { $match: { ...match, 'answers.questionKey': { $in: qKeys } } },
    ...latestAnswerKeyStages(qKeys),
  ]);

  const out = new Map();
  for (const [key, entry] of entries) out.set(key, currentTagVoterSet(rows, entry));
  return out;
}
