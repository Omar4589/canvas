// The ONE place the mobile bulk-restrict flow is decided — every entry point (Books map
// promoted sheet, multi-select bar, book-detail menu) builds its prompts here, so no screen
// can drift back to its own scope-less flow — and the single-home desk-mark prompts /
// classifier (admin map door sheet, book-detail house pop-up). Pure data in/out (no
// react-native imports) so restrictBooks.test.js can pin the rules in plain node; the Alert
// presentation lives in restrictBooksConfirm.js.
//
// The rule this file exists to hold (mirrors web's RestrictModal): when the crew has REACHED
// doors (not-home / wrong-address / refused / no-soliciting), the SAFE scope — 'unknocked', leave reached
// doors alone — is the default path, and the reached-inclusive 'incomplete' scope always
// costs a second, explicit confirm. The server defaults an omitted scope to 'incomplete',
// so every mark call built here carries an explicit scope.

// Statuses that count as "reached": touched by the crew but not completed. Matches the
// server's skip clause (restrict-bulk, scope 'unknocked') — surveyed/lit_dropped are
// "completed" and restricted is already marked; all three are skipped server-side either way.
// The server writes that clause as an EXCLUSION, so it picks up each new non-completion status
// automatically. This set does NOT — a status missing here doesn't change what the server marks,
// it just makes the confirm prompt under-report it. Add every new one.
const REACHED = new Set(['not_home', 'wrong_address', 'refused', 'no_soliciting']);

// Per-door statuses (this round) → the three counts the prompts speak in.
export const restrictCounts = (statuses) => {
  let unknocked = 0;
  let reached = 0;
  for (const s of statuses || []) {
    if (s === 'unknocked') unknocked += 1;
    else if (REACHED.has(s)) reached += 1;
  }
  return { unknocked, reached, incomplete: unknocked + reached };
};

// Same counts from a list of per-book statusCounts objects (the /turfs/progress shape the
// Books screen already holds), so it never needs per-door statuses.
export const restrictCountsFromStatusCounts = (statusCountsList) => {
  let unknocked = 0;
  let reached = 0;
  for (const sc of statusCountsList || []) {
    if (!sc) continue;
    unknocked += sc.unknocked || 0;
    reached += (sc.not_home || 0) + (sc.wrong_address || 0) + (sc.refused || 0);
  }
  return { unknocked, reached, incomplete: unknocked + reached };
};

// Mark prompt descriptor. `label` reads like `“Book 4”` or `3 books`.
// - reached === 0: one confirm, scope 'incomplete' (identical to 'unknocked' on an
//   untouched book — the server skips completed/restricted doors regardless).
// - reached > 0: the scope choice. Safe option listed FIRST and plain; the
//   reached-inclusive option is destructive-styled and carries a `confirm` descriptor —
//   the caller must show that second prompt before sending scope 'incomplete'.
export const buildMarkPrompt = ({ label, counts, totalDoors }) => {
  const { unknocked, reached, incomplete } = counts;
  if (!reached) {
    return {
      title: `Mark ${label} restricted?`,
      message:
        `~${totalDoors ?? incomplete} doors get a Restricted Access mark — canvassers see them slate and they ` +
        `stay out of every rate and knock count. Doors completed this round keep their result; ` +
        `already-restricted doors are skipped. Reversible.`,
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark restricted', style: 'destructive', scope: 'incomplete' },
      ],
    };
  }
  return {
    title: `Mark ${label} restricted?`,
    message:
      `Your crew already reached ${reached} door${reached === 1 ? '' : 's'} here. Restrict which doors? ` +
      `Restricted doors go slate and stay out of every rate and knock count. Reversible.`,
    buttons: [
      { text: 'Cancel', style: 'cancel' },
      // The safe default — leaves every reached door exactly as it is.
      { text: `Only unknocked (${unknocked.toLocaleString()})`, scope: 'unknocked' },
      {
        text: `Every unfinished (${incomplete.toLocaleString()})`,
        style: 'destructive',
        scope: 'incomplete',
        confirm: {
          title: 'Also mark reached doors?',
          message:
            `This also marks the ${reached.toLocaleString()} door${reached === 1 ? '' : 's'} your crew already ` +
            `reached (not-home / wrong address / refused). Completed doors keep their result.`,
          confirmText: `Restrict ${incomplete.toLocaleString()} door${incomplete === 1 ? '' : 's'}`,
        },
      },
    ],
  };
};

// Unmark prompt descriptor — desk marks only (a whole book's or a single home's; the server
// counts ROWS on the doors currently in the book for its round); field-recorded restricted
// marks survive.
export const buildUnmarkPrompt = ({ label, bulkMarks }) => ({
  title: 'Remove desk restricted marks?',
  message:
    `${bulkMarks.toLocaleString()} desk mark${bulkMarks === 1 ? '' : 's'} will be removed from ${label}. ` +
    `Restricted marks canvassers recorded at the door are kept.`,
  removeText: 'Remove',
});

// ── Single-home desk marks ─────────────────────────────────────────────────────────────
// One door, one round: the same row class as a book-level mark (via:'bulk'), written by
// POST /turfs/restrict-doors and removed by POST /turfs/unrestrict-doors. The phone sends ONE
// id and NO scope, so the prompts below stay a single confirm — a lone door is either marked
// for the round or it isn't, and the server's default ('incomplete') is exactly that. The route
// itself does take an optional scope ('incomplete' | 'unknocked') since 2026-08-22, for the web
// maps' lassoed multi-door selection, where a selection can hold doors the crew already reached
// and the choice matters; omitting it here keeps this path byte-for-byte what it always was.

const NO_MARK = Object.freeze({
  kind: 'none',
  by: null,
  at: null,
  passId: null,
  deskRows: 0,
  superseded: false,
  deskBy: null,
  deskAt: null,
  supersededBy: null,
});

const COMPLETION_ACTIONS = new Set(['survey_submitted', 'lit_dropped']);

// Per-round restricted state of ONE door, from the `rounds` list of
// GET /admin/households/:id/activity. EXACT round only — callers pass the round the surface
// speaks for (`scope.passId || currentPassId`); a door untouched in that round has no entry
// in the list, so a missing round is 'none' (not restricted this round). Deliberately NO
// newest/active fallback: roundNumber resets per walk list and the list holds only rounds
// with entries, so "newest" would be a guess. The 'none' pseudo-round (legacy null-pass
// rows) is skipped. The head entry is the latest (the server sorts newest-first); restricted
// there → kind by `via === 'bulk'`. THE RULE: a missing/undefined `via` is FIELD — the desk
// never offers an undo it can't honor (unrestrict-doors deletes via:'bulk' rows only).
//
// SUPERSEDED marks (2026-08-24). A canvasser who works a desk-marked door wins — by design, and
// the server does NOT delete the admin's row when they do (its deleteMany is scoped to the
// recording canvasser's own userId). So `kind` and "is there a row on file" are different
// questions: `kind` is what the round SAYS now, `deskRows` is what the undo would DELETE, and
// `superseded` is the gap. Gating the Unmark affordance on `kind` alone stranded those rows.
//
// Completion is sticky, matching the server's ladder and the web's restrictMark.js: a survey or
// lit drop anywhere in the round beats a restricted row even a NEWER one, because
// getPassStatusMap resolves the door to its completion regardless of order. (Until this rule was
// added here, that one case classified 'desk' on the phone and 'none' on the web.)
export const doorMarkState = (rounds, passId) => {
  if (!passId) return NO_MARK;
  const round = (rounds || []).find((r) => r && r.passId != null && String(r.passId) === String(passId));
  if (!round) return NO_MARK;
  const entries = round.entries || [];
  const deskEntries = entries.filter((e) => e && e.actionType === 'restricted' && e.via === 'bulk');
  const deskHead = deskEntries[0] || null; // newest desk row — the list is newest-first
  const head = entries[0];
  const completed = entries.some((e) => COMPLETION_ACTIONS.has(e?.actionType));
  const restrictedNow = !!head && head.actionType === 'restricted' && !completed;
  const kind = restrictedNow ? (head.via === 'bulk' ? 'desk' : 'field') : 'none';
  if (kind === 'none' && !deskEntries.length) return NO_MARK;
  return {
    kind,
    by: restrictedNow ? head.canvasser || null : null,
    at: restrictedNow ? head.at || null : null,
    passId: String(round.passId),
    deskRows: deskEntries.length,
    superseded: deskEntries.length > 0 && kind !== 'desk',
    deskBy: deskHead ? deskHead.canvasser || null : null,
    deskAt: deskHead ? deskHead.at || null : null,
    supersededBy:
      deskEntries.length > 0 && kind !== 'desk' && head
        ? { actionType: head.actionType || null, canvasser: head.canvasser || null, at: head.at || null }
        : null,
  };
};

// Mark prompt — one plain confirm (no scope choice, no second confirm): the server skips a
// completed / already-restricted door on its own, so there is nothing to choose.
export const buildMarkDoorPrompt = ({ address }) => ({
  title: 'Mark this home restricted?',
  message:
    `${address || 'This home'} gets a Restricted Access mark — canvassers see it slate and it stays out of ` +
    `every rate and knock count. If it was completed this round it keeps its result and nothing changes. ` +
    `A desk mark, not anyone's work. Reversible.`,
  confirmText: 'Mark restricted',
});

// Unmark prompt — the desk mark only; field-recorded marks are never in reach here.
// `superseded` — a canvasser already worked this door, so the mark is not what is keeping anyone
// out and the copy must not claim removing it changes access. It only clears the record.
export const buildUnmarkDoorPrompt = ({ address, markedBy, markedWhen, superseded = false }) => ({
  title: 'Remove the desk mark?',
  message:
    `${address || 'This home'} was marked from the desk by ${markedBy || 'a removed user'}` +
    `${markedWhen ? ` · ${markedWhen}` : ''}. ` +
    (superseded
      ? 'Your crew has since worked this door, so the mark is no longer in effect — removing it only clears it from the record and from this book’s desk-mark count.'
      : 'Removing it makes the door knockable again this round. ') +
    `Marks canvassers recorded at the door are never touched here.`,
  removeText: 'Remove',
});

// Alert copy for a restrict-doors response ({ marked, skipped:{ completed, alreadyRestricted,
// ineligible, reached } }) — one door, so exactly one of these is the story.
export const describeMarkDoorResult = (res) => {
  const skips = res?.skipped || {};
  if ((res?.marked || 0) > 0) {
    return {
      title: 'Marked restricted',
      message: 'Canvassers now see this door slate for the round; it stays out of every rate and knock count. Reversible here.',
    };
  }
  if (skips.alreadyRestricted) {
    return { title: 'Already restricted', message: 'This door is already restricted this round — nothing changed.' };
  }
  if (skips.completed) {
    return { title: 'Not marked', message: 'Completed this round — it keeps its result. Nothing changed.' };
  }
  if (skips.ineligible) {
    return {
      title: 'Not marked',
      message: "Not a knockable door — fully voted, all residents do-not-contact, or not in this round's walk list.",
    };
  }
  return { title: 'Nothing changed', message: 'No door was marked.' };
};

// Alert copy for an unrestrict-doors response ({ unmarked, households }). `unmarked` counts
// ROWS (two desk rows on one door are reachable); zero means only field marks were there.
export const describeUnmarkDoorResult = (res) => {
  const n = res?.unmarked || 0;
  if (n > 0) {
    return {
      title: 'Desk mark removed',
      message:
        `${n === 1 ? 'The desk mark is gone' : `${n} desk marks removed`} — this door is knockable again this round.`,
    };
  }
  return {
    title: 'Nothing to remove',
    message: 'No desk mark on this door for this round. Marks canvassers recorded at the door stay.',
  };
};

// Error → Alert message. lib/api.js attaches only `status` + `data` to a failed request
// (`err.code` is reserved for ORG_CONTEXT / FORBIDDEN_ROLE / …), so the server's
// PASS_REQUIRED code is read from `e.data.code`, never `e.code`.
export const deskMarkErrorMessage = (e) => {
  if (e?.data?.code === 'PASS_REQUIRED') {
    const reason = e.data.unresolved?.[0]?.reason;
    return reason === 'intake'
      ? "This door isn't in a walk list yet."
      : 'This walk list has no current round — open the door from its book and try again.';
  }
  // An older server has no restrict-doors route: the request falls through to the /api 404
  // ({ error:'Not found' }). The route's OWN 404 — { error:'Pass not found' }, an explicit
  // passId that is not this campaign's (e.g. a deep-link round deleted on the web) — is a
  // current server telling the truth, so it falls through to its message.
  if (e?.status === 404 && e?.data?.error !== 'Pass not found') return "Your server doesn't support this yet.";
  return e?.message || 'Please try again.';
};
