// The offline queue's rules and words (docs/PROPOSAL_OFFLINE_QUEUE.md §B, §E, §O).
//
// PLAIN MODULE — no React Native imports — so lib/queueRules.test.js runs under plain node, like
// doorPaths.js and sessionEnd.js. lib/queueCore.js applies these rules; lib/offlineQueue.js wires it
// to the phone.
//
// The three promises it serves: a saved door only ever uploads while the person who recorded it is
// signed in; one the server turns down is never deleted silently; and a deleted account's unsent work
// doesn't linger. Nothing here stores an address: a queued item and a Not saved entry name the house
// by id only (privacy.html promises the walk-list copy, addresses included, is deleted at sign-out).

const DAY_MS = 24 * 60 * 60 * 1000;
// How long an item may wait on the phone for someone else before it's removed (decision 11), and how
// long a turned-down item stays in the Not saved list (decision 2).
export const HELD_LIMIT_MS = 30 * DAY_MS;
export const NOT_SAVED_LIMIT_MS = 30 * DAY_MS;

// The door result paths (doorPaths.js ACTION_PATHS), reversed, so a queued path names its result.
const RESULT_SEGMENTS = {
  'not-home': 'not_home',
  'wrong-address': 'wrong_address',
  'lit-drop': 'lit_dropped',
  refused: 'refused',
  restricted: 'restricted',
  'no-soliciting': 'no_soliciting',
  'not-target': 'not_target',
};

/** What a queued path is: { kind: 'result'|'survey'|'add_person'|'pin_move'|null, actionType, householdId }. */
export const describePath = (path) => {
  const m = /^\/mobile\/(households|voters)\/([^/]+)\/([^/?]+)/.exec(String(path || ''));
  if (!m) return { kind: null, actionType: null, householdId: null };
  const [, root, id, leaf] = m;
  if (root === 'voters') return { kind: leaf === 'survey' ? 'survey' : null, actionType: null, householdId: null };
  if (leaf === 'voters') return { kind: 'add_person', actionType: null, householdId: id };
  if (leaf === 'location') return { kind: 'pin_move', actionType: null, householdId: id };
  const actionType = RESULT_SEGMENTS[leaf] || null;
  return { kind: actionType ? 'result' : null, actionType, householdId: id };
};

/** "Jane D." — what the phone shows of the recorder (decision 1). Null without a first name. */
export const recorderNameOf = (user) => {
  const first = String(user?.firstName || '').trim();
  if (!first) return null;
  const last = String(user?.lastName || '').trim();
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
};

/** The item belongs to the signed-in person. With the hold off (the kill switch), every item does. */
export const isMine = (item, sub, holdOn) => !holdOn || (!!sub && item?.recordedBy === sub);

// The failure came from Doorline's server: a status with our JSON error body. A captive portal's or a
// proxy's error page (hotel wifi) carries none — the same rule as seatedRoster.js answeredByDoorline.
const answeredByDoorline = (err) => Number.isInteger(err?.status) && typeof err.data?.error === 'string';
const isAuthHold = (err) =>
  err?.status === 401 || (err?.status === 403 && err.data?.code === 'PASSWORD_CHANGE_REQUIRED');

/**
 * What a failed upload means for the item:
 *   'retry'   — try again later: no answer, a server error, a throttle, or a page that isn't ours;
 *   'hold'    — the sign-in is the problem, not the door: keep it until the person signs back in;
 *   'refused' — Doorline answered no: it goes to Not saved, never deleted silently.
 */
export const classify = (err) => {
  if (!err?.status || err.status >= 500 || err.status === 429 || !answeredByDoorline(err)) return 'retry';
  if (isAuthHold(err)) return 'hold';
  return err.status >= 400 && err.status < 500 ? 'refused' : 'retry';
};

/**
 * Whether a save that failed its first, live attempt is queued. Not a deleted account's (§E2 step 2):
 * that save can never upload under anyone, so it takes the hard-fail path at the door instead.
 */
export const shouldQueue = (err) => {
  if (err?.status === 401 && err.reason === 'deleted') return false;
  return classify(err) !== 'refused';
};

/**
 * The item has waited 30 days for someone else (decision 11). Counted from when the phone first saw it
 * waiting (`heldSince`, stamped while someone else was signed in), never only from when it was saved —
 * a phone whose clock was wrong at the tap must not lose the door the moment the clock corrects. A
 * date in the future is never stale.
 */
export const heldStale = (item, now) => {
  const held = Number(item?.heldSince);
  if (!Number.isFinite(held) || held <= 0) return false;
  const queued = Date.parse(item?.enqueuedAt);
  const since = Math.max(held, Number.isFinite(queued) ? queued : 0);
  if (since > now) return false;
  return now - since > HELD_LIMIT_MS;
};

/** The Not saved list without entries older than 30 days (a future date is kept). */
export const pruneNotSaved = (list, now) =>
  (Array.isArray(list) ? list : []).filter((e) => {
    const at = Date.parse(e?.refusedAt);
    return !Number.isFinite(at) || at > now || now - at <= NOT_SAVED_LIMIT_MS;
  });

/**
 * Who else's items wait on this phone, for the waiting line: [{ recordedBy, name, count }], plus how
 * many items predate the update (no recorder yet — they upload under the next person signed in).
 * Hidden entirely while the hold is off.
 */
export const groupWaiting = (queue, sub, holdOn) => {
  if (!holdOn) return { others: [], unstamped: 0 };
  const bySub = new Map();
  let unstamped = 0;
  for (const it of Array.isArray(queue) ? queue : []) {
    if (!it?.recordedBy) {
      unstamped += 1;
      continue;
    }
    if (sub && it.recordedBy === sub) continue;
    const row = bySub.get(it.recordedBy) || { recordedBy: it.recordedBy, name: null, count: 0 };
    row.count += 1;
    if (!row.name && it.recorderName) row.name = it.recorderName;
    bySub.set(it.recordedBy, row);
  }
  return { others: [...bySub.values()], unstamped: sub ? 0 : unstamped };
};

// ── Why it wasn't saved ───────────────────────────────────────────────────────────────────────
// Chosen by code, kind AND message: a FORBIDDEN_ROLE on a pin move is the lead-only rule, but the same
// code with "No active org membership" (middleware/auth.js requireOrgMember) means they lost the org.

/** A stable key for a refusal — the phone and the console word the same key their own way. */
export const reasonKey = ({ status, code, message, kind, sentAsOther = false }) => {
  if (sentAsOther) return 'sent_as_other';
  if (code === 'NOT_ASSIGNED') return 'not_assigned';
  if (code === 'ORG_CONTEXT') return 'no_membership';
  if (code === 'FORBIDDEN_ROLE') return /no active org membership/i.test(message || '') ? 'no_membership' : kind === 'pin_move' ? 'pin_role' : 'no_membership';
  if (code === 'SUPPORT_ACCESS_REQUIRED') return 'support_access';
  if (code === 'SURVEY_TEMPLATE_MISMATCH') return 'survey_switched';
  if (code === 'DO_NOT_CONTACT') return 'do_not_contact';
  if (code === 'HOUSEHOLD_NOT_FOUND') return 'house_gone';
  if (code === 'VOTER_NOT_FOUND' || code === 'HOUSEHOLD_FOR_VOTER_NOT_FOUND') return kind === 'survey' ? 'person_missing' : 'house_gone';
  if (code === 'CAMPAIGN_NOT_FOUND' || code === 'campaign-deleting') return 'campaign_deleted';
  if (code === 'campaign-archived') return 'campaign_archived';
  if (code === 'subscription-inactive' || status === 402) return 'account_paused';
  if (code === 'out_of_bounds' || code === 'invalid_coords') return 'pin_bounds';
  if (code === 'VOTER_ID_CONFLICT') return 'id_conflict';
  return 'other';
};

const PHONE_REASONS = {
  sent_as_other: 'It uploaded while someone else was signed in.',
  not_assigned: "You were no longer on this campaign's team when it uploaded.",
  no_membership: 'You were no longer in this organization when it uploaded.',
  support_access: 'Doorline staff need an access grant for this organization.',
  survey_switched: "The walk list's survey was changed after this was recorded.",
  do_not_contact: "This voter asked not to be contacted, so the survey wasn't saved.",
  house_gone: 'This house is no longer in the campaign.',
  person_missing: "The person this survey was for isn't in this campaign.",
  campaign_deleted: 'This campaign was deleted.',
  campaign_archived: 'This campaign is archived.',
  account_paused: "The account was paused, so this wasn't saved.",
  pin_role: 'Only team leads and admins can move a house pin.',
  pin_bounds: "The new pin was outside the campaign's area.",
  id_conflict: "This person couldn't be added. Add them again.",
};

/** The phone's sentence for a Not saved entry, falling back to the server's own message. */
export const reasonText = (entry) =>
  PHONE_REASONS[reasonKey(entry)] || (entry?.message ? String(entry.message) : "Doorline couldn't save this.");

// ── Words ─────────────────────────────────────────────────────────────────────────────────────

const items = (n) => (n === 1 ? '1 saved item' : `${n} saved items`);
const has = (n) => (n === 1 ? "hasn't" : "haven't");
const is = (n) => (n === 1 ? 'is' : 'are');

export const SIGN_OUT_TITLE = 'Items not uploaded yet';

/** The sign-out question (decision 10: Sign out · Cancel, no Upload now). Today's words with the hold off. */
export const signOutQuestion = (n, holdOn) =>
  holdOn
    ? `${items(n)} ${has(n)} uploaded yet. ${n === 1 ? "It'll" : "They'll"} stay on this phone and upload the next time you sign in here.`
    : `${items(n)} ${has(n)} uploaded yet. ${n === 1 ? "It'll" : "They'll"} upload with the next person who signs in on this phone.`;

export const FINISHING_SAVE = 'Finishing a save…';

/** The waiting line: someone else's items on this phone (sign-in screen, the drawer, Books). */
export const waitingLine = ({ count, name }) =>
  name
    ? `${items(count)} from ${name} ${is(count)} waiting on this phone. ${count === 1 ? "It'll" : "They'll"} upload when ${name.split(' ')[0]} signs in here.`
    : `${items(count)} from another account ${is(count)} waiting on this phone. ${count === 1 ? "It'll" : "They'll"} upload when that person signs in here.`;

/**
 * The password screen when someone ELSE signed in on it: the phone signs out, and the first person's
 * saves stay behind. The reader is the second person, so it names the first. (With the kill switch off
 * the screen says today's words instead — lib/sessionEnd.js notYouConfirm.)
 */
export const otherAccountSignOutLine = ({ count, name }) =>
  `${items(count)} from ${name || 'the account signed in here'} stay${count === 1 ? 's' : ''} on this phone and upload${count === 1 ? 's' : ''} when ${name ? name.split(' ')[0] : 'that person'} signs in here. Sign out?`;

/** Items saved before the update have no recorder: say what really happens to them. */
export const preUpdateLine = (n) =>
  `${items(n)} from before the app update will upload under the next person who signs in.`;

/** Someone else's items that waited 30 days and were removed (decision 11). */
export const waitedLine = ({ count, name }) =>
  `${items(count)} from ${name || 'another account'} waited 30 days and ${count === 1 ? 'was' : 'were'} removed from this phone.`;

/** A deleted account's unsent items, removed (decision 7). No name: the account is gone. */
export const deletedAccountLine = (n) =>
  `${items(n)} from a deleted account ${n === 1 ? 'was' : 'were'} removed from this phone.`;

export const DELETED_HARD_FAIL = "This account was deleted. This door wasn't saved.";
export const NO_SESSION_MESSAGE = 'Sign in again to record this door.';

/** The banner over the map and Books (and the screens that can replace them). */
export const notSavedBanner = (n) => `${n === 1 ? '1 item' : `${n} items`} ${n === 1 ? "wasn't" : "weren't"} saved — tap to see why`;

/** What a Not saved entry was, in a few words. */
export const kindLabel = ({ kind, actionType }) => {
  if (kind === 'survey') return 'Survey';
  if (kind === 'add_person') return 'Added a person';
  if (kind === 'pin_move') return 'Moved a pin';
  return (
    {
      not_home: 'Not home',
      wrong_address: 'Wrong address',
      lit_dropped: 'Lit dropped',
      refused: 'Refused',
      restricted: 'Restricted access',
      no_soliciting: 'No soliciting',
      not_target: 'Not a target voter',
    }[actionType] || 'Door result'
  );
};
