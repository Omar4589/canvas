import mongoose from 'mongoose';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { Voter } from '../../models/Voter.js';
import { answerFilterClause, answerTagClause } from '../surveys/answerAgg.js';
import { formatAnswerCell } from '../surveys/answerDisplay.js';
import { doorKey } from './doorKey.js';

// The survey-answer half of the Door Outcomes filter: "doors where someone answered Y".
//
// The two ledgers share no foreign key, so this is a real join, and both obvious keys are wrong
// (see doorKey.js). The unit here is the TRIPLE — one canvasser's visit to one door in one
// round — which is also exactly the unit convertChunkFromSurvey archives on, so a filter built
// here selects precisely the rows whose conversion would remove the matching answers.
//
// Deliberately NO refusal logic in this module: the gate, the template resolution and every
// ScopeError live in entryScope.js so all four routes refuse identically. This file only knows
// how to turn (template, scope, window) into a CanvassActivity clause.

// The hard bound. The gate (one of canvasser/round/walk list/dates required) keeps the common
// case fast, but it is a speed bump, not the safety: on a one-canvasser campaign `userId`
// narrows nothing, and of the four narrowings only userId and the date window have real index
// support on SurveyResponse. This cap is what makes the worst case bounded — do not drop it on
// the grounds that the gate handles it. Deliberately a DIFFERENT number from
// RECLASSIFY_MAX_IMPACT_ENTRIES (25k): they measure different things (responses vs entries),
// and a shared number would invite reading them as one limit.
export const ANSWER_SCOPE_MAX_RESPONSES = 20000;

// Env override read at CALL time, never at module load — the same pattern as the turf re-hull
// cap. That is what lets the truncation path be exercised by an int test (and raised in an
// emergency) without a rebuild; unset, it is exactly the constant above.
export const answerScopeCap = () => Number(process.env.ANSWER_SCOPE_MAX_RESPONSES) || ANSWER_SCOPE_MAX_RESPONSES;

/**
 * Fold a set of {householdId, passId, userId} triples into ONE Mongo clause a plain find,
 * countDocuments or $match can all take — no $lookup, no per-triple $or.
 *
 * Grouped by (passId, userId) first: the distinct pairs are tiny (one canvasser across a
 * handful of rounds), so even a large triple list collapses to a few clauses each carrying one
 * householdId $in — and the common single-pair case degenerates to a bare object fully served
 * by the {campaignId, passId, householdId} index. `passId: null` matches explicit-null AND
 * absent, which is the legacy-bucket convention everywhere else.
 *
 * Empty in → { _id: null }, the answerAgg matches-nothing sentinel: an answer filter that
 * matched no responses must select no rows, never fall open.
 */
export function tripleClause(triples) {
  const byPair = new Map();
  for (const t of triples) {
    const k = `${t.passId ?? 'null'}|${t.userId ?? 'null'}`;
    if (!byPair.has(k)) byPair.set(k, { passId: t.passId ?? null, userId: t.userId ?? null, householdIds: [] });
    byPair.get(k).householdIds.push(t.householdId);
  }
  const ors = [...byPair.values()].map((g) => ({
    passId: g.passId,
    userId: g.userId,
    householdId: { $in: g.householdIds },
  }));
  if (!ors.length) return { _id: null };
  return ors.length === 1 ? ors[0] : { $or: ors };
}

/**
 * Resolve an answer filter into { clause, responses, doors, truncated }.
 *
 * `template` arrives already loaded and org-verified (entryScope.js): the match scopes on the
 * RESPONSE's surveyTemplateId, never the door's current effective template — question keys and
 * option ids are slugs unique only within one template, and a campaign that swapped surveys
 * keeps its old responses under the old id.
 *
 * Pushdowns are exactly the provably-safe ones:
 *   • userId / passId — components of the join triple itself, so filtering responses on them
 *     equals filtering the resulting triples.
 *   • the date window — submittedAt and the activity's timestamp are written from the same
 *     variable by both the field and desk paths, and the admin edit route can't touch either.
 *   • effortId is NOT pushed down: it is not part of the triple, and the orphan-attribution
 *     repair can re-home an activity row while skipping its paired response on a unique clash —
 *     a narrow drift that would silently UNDER-select here. The activity-side filter already
 *     applies it exactly.
 */
export async function resolveAnswerScope({ campaign, template, scope, timestamp, householdIdIn = null }) {
  const match = {
    campaignId: campaign._id,
    surveyTemplateId: template._id,
    ...(scope.userId ? { userId: new mongoose.Types.ObjectId(String(scope.userId)) } : {}),
    ...(scope.passId ? { passId: new mongoose.Types.ObjectId(String(scope.passId)) } : {}),
    // The address search's door set — a triple COMPONENT, so pushing it down is provably equal
    // to filtering the resulting triples (the userId/passId argument), and it is what makes an
    // address search a legitimate gate-satisfier for the answer filter.
    ...(householdIdIn ? { householdId: { $in: householdIdIn } } : {}),
    ...(timestamp ? { submittedAt: timestamp } : {}),
    // $and, never a bare key or a merge: every clause from answerAgg is $or-shaped (or the
    // {_id: null} sentinel), and only $and composes several without one clobbering another.
    // Multiple options within one question are already an $in (OR); multiple questions AND
    // together — the same voter answered all of them.
    $and: [
      ...(scope.answerFilters || []).map((af) => answerFilterClause(af.questionKey, af.values || [], af.texts || [])),
      ...(scope.answerTagFilters || []).map((tf) => answerTagClause(template, tf.tag)),
    ],
  };

  // The +1 read is the truncation probe; the sort is served free by {campaignId, submittedAt:-1}
  // so "the most recent CAP" is a real statement, not whatever Mongo happened to return.
  const cap = answerScopeCap();
  const rows = await SurveyResponse.find(match, { householdId: 1, passId: 1, userId: 1, _id: 0 })
    .sort({ submittedAt: -1 })
    .limit(cap + 1)
    .lean();
  const truncated = rows.length > cap;
  const kept = truncated ? rows.slice(0, cap) : rows;

  const byKey = new Map();
  const households = new Set();
  for (const r of kept) {
    households.add(String(r.householdId));
    const k = doorKey(r);
    if (!byKey.has(k)) byKey.set(k, { householdId: r.householdId, passId: r.passId ?? null, userId: r.userId ?? null });
  }

  return {
    clause: tripleClause([...byKey.values()]),
    responses: kept.length,
    doors: households.size,
    truncated,
    cap,
    // The response-side clauses, for RE-application to a known id set — how the entries table
    // and the removal preview mark which voter matched the filter, using the exact clause
    // semantics (dual-read, __other__ carve-out) rather than a JS reimplementation.
    responseAnd: match.$and,
  };
}

/**
 * The survey evidence behind a PAGE of entries: who answered at each surveyed row's visit, and —
 * under an answer filter — which of them matched it. Returns Map<rowId, bucket>.
 *
 * The table is about to let an admin rewrite what these rows say, and the Surveyed direction
 * archives EVERY answer at the row's triple regardless of who matched — so the cell must
 * distinguish "this voter matched your filter" from "this voter is at the same visit and their
 * answers go too", or the removal count reads as a bug.
 *
 * Page-bounded by construction: at most `limit` rows in, so at most ~limit $or branches, each
 * served by the {householdId, passId} index; skipped entirely when the page holds no surveyed
 * rows. `matched` re-applies the resolved response-side clauses (q.answerMatch) to the page's
 * own response ids — the exact dual-read semantics, never a JS reimplementation.
 */
export async function hydrateSurveyEvidence(rows, q, { matchedCap = 2, namesCap = 5, withVoterDetail = false } = {}) {
  const out = new Map();
  const surveyed = rows.filter((r) => r.actionType === 'survey_submitted');
  if (!surveyed.length) return out;

  // Two fetch shapes for one result: a page (≤ ~50 rows) is cheapest as an $or of exact triples
  // on the {householdId, passId} index; an export (up to 50k rows) would make that a 50k-branch
  // query document, so it flips to one householdId $in and lets the doorKey membership test do
  // the triple narrowing in process. Same rows either way.
  const projection = { householdId: 1, passId: 1, userId: 1, voterId: 1, answers: 1 };
  const wantedKeys = new Set(surveyed.map((r) => doorKey(r)));
  let responses;
  if (surveyed.length <= 200) {
    const or = surveyed.map((r) => ({ householdId: r.householdId, passId: r.passId ?? null, userId: r.userId }));
    responses = await SurveyResponse.find({ $or: or }, projection).lean();
  } else {
    const householdIds = [...new Set(surveyed.map((r) => String(r.householdId)))];
    responses = (
      await SurveyResponse.find({ householdId: { $in: householdIds } }, projection).lean()
    ).filter((resp) => wantedKeys.has(doorKey(resp)));
  }
  if (!responses.length) {
    // A surveyed row with no live responses is a legitimate state (an admin deleted the one
    // response; the conversion tool counts these as entriesNoResponses) — report zeros rather
    // than omitting the field, so the client renders "0 voters" instead of nothing.
    for (const r of surveyed) out.set(String(r._id), { voters: 0, answers: 0, matchedVoters: 0, matched: [], otherNames: [], others: [] });
    return out;
  }

  const matchedIds = q.answerMatch
    ? new Set(
        (
          await SurveyResponse.find({ _id: { $in: responses.map((r) => r._id) }, $and: q.answerMatch }, { _id: 1 }).lean()
        ).map((r) => String(r._id))
      )
    : new Set();

  const voterIds = [...new Set(responses.map((r) => String(r.voterId)))];
  const voters = await Voter.find(
    { _id: { $in: voterIds } },
    withVoterDetail ? { fullName: 1, 'doNotContact.flagged': 1 } : { fullName: 1 }
  ).lean();
  const voterById = new Map(voters.map((v) => [String(v._id), v]));
  const nameById = new Map(voters.map((v) => [String(v._id), v.fullName]));
  // A matched cell shows only the FILTERED questions' answers — that is what put the row here.
  // Tag-only filters name no single question, so they fall back to the whole answer set.
  const filterKeys = new Set((q.raw?.answerFilters || []).map((f) => f.questionKey));

  const byVisit = new Map();
  for (const resp of responses) {
    const k = doorKey(resp);
    if (!byVisit.has(k)) byVisit.set(k, { voters: 0, answers: 0, matchedVoters: 0, matched: [], otherNames: [], others: [] });
    const b = byVisit.get(k);
    b.voters += 1;
    b.answers += (resp.answers || []).length;
    const vid = String(resp.voterId);
    const v = voterById.get(vid);
    const name = v?.fullName || 'Unknown voter';
    const dnc = !!v?.doNotContact?.flagged;
    if (matchedIds.has(String(resp._id))) {
      b.matchedVoters += 1;
      if (b.matched.length < matchedCap) {
        b.matched.push({
          voterId: vid,
          voterName: name,
          ...(withVoterDetail ? { dnc } : {}),
          answers: (resp.answers || [])
            .filter((a) => !filterKeys.size || filterKeys.has(a.questionKey))
            .map((a) => ({ questionKey: a.questionKey, label: a.questionLabel, text: formatAnswerCell(a) })),
        });
      }
    } else {
      if (b.otherNames.length < namesCap) b.otherNames.push(name);
      // Id-carrying sibling of otherNames, for callers that must TAG the people they write
      // (record-level audit on exports) or mark their DNC standing. Absent from the table wire.
      if (withVoterDetail) b.others.push({ voterId: vid, name, dnc });
    }
  }

  for (const r of surveyed) {
    out.set(
      String(r._id),
      byVisit.get(doorKey(r)) || { voters: 0, answers: 0, matchedVoters: 0, matched: [], otherNames: [], others: [] }
    );
  }
  return out;
}
