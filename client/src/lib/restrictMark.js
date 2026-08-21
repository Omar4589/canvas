// Single-home desk restrict — what the web reads off GET /admin/households/:id/activity to decide
// whether a door is Restricted THIS round and, if it is, whether the mark came from the desk or
// from a canvasser at the door. Shared by the Turf Cutting popup (TurfsPage RestrictSection) and
// the Map page panel (HouseholdDetailPanel RestrictedSection) so both pages classify a door the
// same way. Pure and dependency-free; pinned by restrictMark.test.js.
//
// THE RULE: a desk mark is a `via:'bulk'` row (the model enum is `[null,'bulk']`) — the same row
// class whether it came from "Mark book restricted…" or a single-home mark. Any other `via`,
// including a missing one from an older server, reads as FIELD: the desk never offers an undo
// it cannot honor (unrestrict-doors deletes desk rows only).
//
// Why the round must be EXACT and never guessed: /activity lists only rounds that hold entries,
// roundNumber resets per walk list, and the server tells us which round a mark without an
// explicit passId lands on (`currentPassId`). So callers pass `scopePassId || currentPassId`;
// a door untouched in that round has no round here and is simply not restricted this round.

const COMPLETION_ACTIONS = new Set(['survey_submitted', 'lit_dropped']);

// The round whose passId matches exactly — or null. The `'none'` pseudo-round (legacy rows
// written before passes existed, passId null) is never a match, even for an empty passId.
export const pickRound = (rounds, passId) => {
  const want = String(passId || '');
  if (!want) return null;
  return (rounds || []).find((r) => r?.passId != null && String(r.passId) === want) || null;
};

// Completion is sticky: a survey/lit-drop anywhere in the round means the door keeps that
// result (the server's mark ladder skips it as `completed`), whatever came after.
export const completedInRound = (entries) =>
  (entries || []).some((e) => COMPLETION_ACTIONS.has(e?.actionType));

// What the round's newest entry says (the server sorts newest-first — latest wins):
//   { kind:'desk'|'field', byName, byId, at, passId } when the door is Restricted this round,
//   null when it is not (unknocked, reached, completed, or restricted-then-re-knocked).
export const roundMarkFromEntries = (entries) => {
  const list = entries || [];
  if (!list.length || completedInRound(list)) return null;
  const head = list[0];
  if (head?.actionType !== 'restricted') return null;
  return {
    kind: head.via === 'bulk' ? 'desk' : 'field',
    byName: head.canvasser || null,
    byId: head.canvasserId || null,
    at: head.at || null,
    passId: head.passId ?? null,
  };
};

// The two above composed: the door's mark in the round `passId`, or null.
export const roundMark = (rounds, passId) => roundMarkFromEntries(pickRound(rounds, passId)?.entries);
