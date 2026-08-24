// Single-home desk restrict — what the web reads off GET /admin/households/:id/activity to decide
// whether a door is Restricted THIS round, whether the mark came from the desk or from a canvasser
// at the door, and whether a desk mark is still on file after a canvasser out-voted it. Shared by
// the Turf Cutting popup (TurfsPage RestrictSection) and the Map page panel (HouseholdDetailPanel
// RestrictedSection) so both pages classify a door the same way. Pure and dependency-free; pinned
// by restrictMark.test.js.
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
//
// SUPERSEDED MARKS (2026-08-24). A canvasser who works a desk-marked door wins — that is the
// designed behavior and a server contract test pins it (bulkRestrict.int.test.js, 'field
// re-disposition overrides a bulk mark'). Their write does NOT delete the admin's row: the
// server's deleteMany is scoped to the recording canvasser's own userId, so the desk row stays
// on file, in `Unmark (N)`, in activityCount and in exports. This module used to return `null`
// for that door, which took the "Unmark restricted" button away from the only surfaces that
// offered it and stranded the row. It now reports the row separately from the status:
//
//   kind        what the round SAYS RIGHT NOW — 'desk' | 'field' | 'none'
//   deskRows    how many via:'bulk' restricted rows sit in this round, wherever they sit
//   superseded  deskRows > 0 && kind !== 'desk' — a mark on file that no longer holds
//
// `kind` and `deskRows` answer different questions and must never be collapsed: `kind` drives
// what the door IS, `deskRows` drives what the undo would DELETE. That is the same split the
// server makes between `bulkRestrictedCount` (rows) and `bulkRestrictedSupersededCount`.
//
// Returns an OBJECT ALWAYS — never null. The old null was tested for truthiness by callers
// (`!mark` meant "not restricted"); every such site has been re-pointed at `isRestricted(mark)`.

const COMPLETION_ACTIONS = new Set(['survey_submitted', 'lit_dropped']);

const NO_MARK = Object.freeze({
  kind: 'none',
  byName: null,
  byId: null,
  at: null,
  passId: null,
  deskRows: 0,
  superseded: false,
  deskByName: null,
  deskById: null,
  deskAt: null,
  supersededBy: null,
});

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

const isDeskEntry = (e) => e?.actionType === 'restricted' && e?.via === 'bulk';

// Is the door Restricted in this round right now? The replacement for the old `!!mark` /
// `!mark` truthiness tests, which an always-object return would silently break.
export const isRestricted = (mark) => mark?.kind === 'desk' || mark?.kind === 'field';

// What the round says, plus what is still on file. The server sorts entries newest-first, so
// `list[0]` is the latest action and decides `kind`; `deskRows` scans the WHOLE round, because a
// superseded mark is by definition no longer at the head.
export const roundMarkFromEntries = (entries) => {
  const list = entries || [];
  if (!list.length) return NO_MARK;

  const deskEntries = list.filter(isDeskEntry);
  const deskHead = deskEntries[0] || null; // newest desk row (list is newest-first)
  const head = list[0];
  // Completion is sticky, so a survey/lit-drop anywhere in the round beats a restricted row even
  // if that row is newer — matching the server's ladder, which skips such a door as `completed`.
  const restrictedNow = head?.actionType === 'restricted' && !completedInRound(list);
  const kind = restrictedNow ? (head.via === 'bulk' ? 'desk' : 'field') : 'none';

  return {
    kind,
    byName: restrictedNow ? head.canvasser || null : null,
    byId: restrictedNow ? head.canvasserId || null : null,
    at: restrictedNow ? head.at || null : null,
    // The round to name when removing the mark. Falls back to the desk row's own passId so a
    // superseded mark can always be unmarked in the round it was made.
    passId: (restrictedNow ? head.passId : null) ?? deskHead?.passId ?? null,
    deskRows: deskEntries.length,
    superseded: deskEntries.length > 0 && kind !== 'desk',
    deskByName: deskHead?.canvasser || null,
    deskById: deskHead?.canvasserId || null,
    deskAt: deskHead?.at || null,
    // What out-voted it — the round's newest entry, so the panel can say "superseded by
    // Dana's survey on Aug 3" rather than only "no longer restricted".
    supersededBy:
      deskEntries.length > 0 && kind !== 'desk' && head
        ? {
            actionType: head.actionType || null,
            canvasser: head.canvasser || null,
            canvasserId: head.canvasserId || null,
            at: head.at || null,
          }
        : null,
  };
};

// The two above composed: the door's mark state in the round `passId`.
export const roundMark = (rounds, passId) => roundMarkFromEntries(pickRound(rounds, passId)?.entries);

// One string for the undo button, so the four per-door surfaces cannot word it differently.
// `rows` is what the server will actually delete — the confirm and the toast reconcile on it.
export const unmarkButtonLabel = ({ deskRows = 0, superseded = false } = {}) => {
  if (deskRows > 1) return `Unmark restricted (${deskRows} desk marks)`;
  return superseded ? 'Remove desk mark' : 'Unmark restricted';
};
