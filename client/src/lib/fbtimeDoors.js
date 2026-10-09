// Door counts to FbTime — what the web does with the server's `doors` block.
//
// The block is computed by ONE owner on the server (doorsStatus in
// server/src/services/fbtime/doorCounts.js) and the web only renders it: no state,
// reason or eligibility is re-derived here. What is left for a screen to decide —
// whether the card is drawn, how the last send reads, what Sync now's stamps mean,
// what a pasted key can do — lives in this file for the reason fbtimeRoster.js does:
// PURE (no React, no Date.now(), no locale formatting), so node --test pins it
// (fbtimeDoors.test.js). Copy and formatting live in the components.

export const SCOPE_DOORS_WRITE = 'doors:write';
export const FEATURE_REPORTED_WINS = 'doors:reported-wins';

// While the first send or a clear is under way the status query polls, so the card
// notices it finishing (and announces it) without a reload. GET /fbtime reads only
// Doorline's own database — no provider call rides on this.
export const DOORS_POLL_MS = 15_000;

const ms = (v) => (v ? new Date(v).getTime() : 0);

/** Any clear still waiting — a first pass, or the confirm pass 15 minutes after it. */
export const clearsWaiting = (doors) =>
  Boolean(doors?.pendingClears?.all || doors?.pendingClears?.persons?.length);

/** The card exists when the feature is released, door counts are on, or a clear waits. */
export const showDoorsCard = (doors) =>
  Boolean(doors && (doors.available || doors.enabled || clearsWaiting(doors)));

/** Off with nothing waiting is one compact line. */
export const doorsCompact = (doors) => doors?.state === 'off' && !clearsWaiting(doors);

/** react-query refetchInterval for the status query (GET /fbtime). */
export const doorsPollInterval = (data) =>
  ['starting', 'clearing'].includes(data?.doors?.state) ? DOORS_POLL_MS : false;

/**
 * What a key may do, from POST /fbtime/test: `key.scopes` is THIS key's, `features` is
 * FbTime's build (server-wide). It can fill in door counts only with both.
 */
export const keyCanWriteDoors = (tested) =>
  Array.isArray(tested?.key?.scopes) && tested.key.scopes.includes(SCOPE_DOORS_WRITE);
export const keyCanFillDoors = (tested) =>
  keyCanWriteDoors(tested) &&
  Array.isArray(tested?.features) &&
  tested.features.includes(FEATURE_REPORTED_WINS);

/**
 * The last send, as the card words it: total people, and each window group that had
 * anyone in it ("the last 7 days, 40 people; the last 120 days, 2 people").
 */
export const sendSummary = (lastResult) => {
  const groups = (lastResult || [])
    .filter((g) => (g.people || 0) > 0)
    .map((g) => ({ windowDays: g.windowDays, people: g.people }))
    .sort((a, b) => a.windowDays - b.windowDays);
  return { people: groups.reduce((n, g) => n + g.people, 0), groups };
};

/** "Ann", "Ann and Bo", "Ann, Bo and Cy", "Ann, Bo, Cy and 2 more". */
export const nameList = (names, max = 3) => {
  const list = names.map((n) => n || 'an FbTime person');
  if (list.length <= 1) return list[0] || '';
  if (list.length <= max) return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  return `${list.slice(0, max).join(', ')} and ${list.length - max} more`;
};

/**
 * End a sentence that may end in a name. FbTime names are often initials ("Maria D."),
 * and "…sent for Maria D.." is what a plain trailing period gives.
 */
export const withPeriod = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** Whom the waiting clears are for: "everyone", or the people by name. */
export const clearWho = (pendingClears) =>
  pendingClears?.all ? 'everyone' : nameList((pendingClears?.persons || []).map((p) => p.name));

/**
 * Off, Doorline sent numbers, and a clear can't be asked for now (`canClearAll` is the
 * server's answer): which explanation the card gives. null when nothing needs saying —
 * the clear is offered, one already waits (its notice says why it can't run), or the
 * off hint already names the cause (another organization sends).
 * → null | 'connection' | 'hours-only-key' | 'fbtime-outdated'
 */
export const clearHow = (doors, connectionStatus) => {
  if (!doors?.everSent || doors.canClearAll || doors.state !== 'off') return null;
  if (clearsWaiting(doors) || doors.reason === 'conflict') return null;
  if (connectionStatus && connectionStatus !== 'connected') return 'connection';
  if (doors.canWrite !== true) return 'hours-only-key';
  if (doors.reportedWins !== true) return 'fbtime-outdated';
  return null;
};

/**
 * The card's aria-live line for a state change it observed on a refetch (one its own
 * button caused is announced by the button instead). Only the two completions.
 */
export const transitionNote = (prev, next, doors) => {
  if (prev === 'starting' && next === 'sending') return 'Door counts sent to FbTime.';
  if (prev === 'clearing' && next !== 'clearing' && !clearsWaiting(doors)) {
    return 'Doorline finished clearing the numbers you asked it to clear.';
  }
  return null;
};

/**
 * Sync now's verdict, read off the connection's own stamps against the `requestedAt`
 * POST /fbtime/sync answered with — both the server's clock.
 *
 * FAILED IS CHECKED FIRST: a 15-minute tick can move lastSyncAt past the request while
 * the requested run itself fails, and "done" would then hide the failure. A failure is
 * the connection turning errored, or either error stamp moving past the request. An
 * errored connection is the one case where the click is a RETRY (the run probes the key
 * and self-heals), so when it was already errored at the click, only a fresh error stamp
 * counts — otherwise the first poll, before the run even starts, would end the wait.
 *
 * DONE is lastSyncAt past the request and, while door counts are on, the door step's
 * lastFinishedAt too (every evaluation past "nothing to do" stamps it, a gate stop
 * included).
 * → 'failed' | 'done' | null (still running)
 */
export const syncOutcome = (data, { at, erroredBefore = false } = {}) => {
  if (!data || !at) return null;
  const failed =
    (data.status === 'errored' && !erroredBefore) ||
    ms(data.lastErrorAt) > at ||
    ms(data.doors?.lastErrorAt) > at;
  if (failed) return 'failed';
  const hoursDone = ms(data.lastSyncAt) > at;
  const doorsDone = !data.doors?.enabled || ms(data.doors.lastFinishedAt) > at;
  return hoursDone && doorsDone ? 'done' : null;
};

/** The note under the status bar once Sync now is done. */
export const syncDoneNote = (data) =>
  data?.doors?.enabled
    ? 'Sync finished — hours refreshed, and the door counts card shows the latest send.'
    : 'Hours refreshed.';

/**
 * The note once Sync now failed. null when the bar itself already says why (an errored
 * connection prints its error in the bar); a transient hours failure or a door-count
 * failure would otherwise vanish without a word.
 */
export const syncFailedNote = (data, at) => {
  if (data?.status === 'errored') return null;
  if (ms(data?.lastErrorAt) > at) {
    return `Couldn’t refresh hours${data.lastSyncError ? ` — ${data.lastSyncError}` : ''}. Doorline tries again at the next sync.`;
  }
  return `Hours refreshed, but door counts hit an error${
    data?.doors?.lastError ? ` — ${data.doors.lastError}` : ''
  }. Doorline tries again at the next send.`;
};

/**
 * The flags Replace key's "Use this key" sends after a 409. One request may carry both
 * (§I): the org change is confirmed, and a clear that's waiting — known from the card,
 * or named by a DOORS_CLEAR_PENDING — is abandoned with it. An org change drops the
 * whole door-count record, so leaving a waiting clear is what it does anyway.
 * `confirm` = null | { orgChange?, clearPending? }
 */
export const replaceKeyFlags = (confirm, doors) => {
  if (!confirm) return {};
  const flags = {};
  if (confirm.orgChange) flags.confirmOrgChange = true;
  if (confirm.clearPending || (confirm.orgChange && clearsWaiting(doors))) flags.leaveDoorCounts = true;
  return flags;
};
