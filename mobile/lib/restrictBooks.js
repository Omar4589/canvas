// The ONE place the mobile bulk-restrict flow is decided — every entry point (Books map
// promoted sheet, multi-select bar, book-detail menu) builds its prompts here, so no screen
// can drift back to its own scope-less flow. Pure data in/out (no react-native imports) so
// restrictBooks.test.js can pin the rules in plain node; the Alert presentation lives in
// restrictBooksConfirm.js.
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

// Unmark prompt descriptor — bulk marks only; field-recorded restricted marks survive.
export const buildUnmarkPrompt = ({ label, bulkMarks }) => ({
  title: 'Remove bulk restricted marks?',
  message:
    `${bulkMarks.toLocaleString()} bulk mark${bulkMarks === 1 ? '' : 's'} will be removed from ${label}. ` +
    `Restricted marks canvassers recorded at the door are kept.`,
  removeText: 'Remove',
});
