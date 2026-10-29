// The request paths and bodies the door writes queue under — ONE definition, shared by the
// writers (recordAction.js's door results and walk-up add, the survey screen) and by the reader that
// counts what a canvasser still has queued at a door (doorChange.js ownSurveysHere). Plain ESM with no
// react-native imports, so doorChange.test.js builds its queue fixtures from these same functions
// and a fixture can never drift from what production actually queues. Paths carry no /api prefix
// (lib/api.js adds it), which is also how offlineQueue stores them.
//
// At the bottom: the book each of those writes names, and the two places the phone acts on a door's
// book changing under it (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §E). Pure for the same reason, so
// doorPaths.test.js runs them under plain node.

// The seven door results, each on its own route (routes/mobile/canvass.js). Every one REPLACES this
// canvasser's earlier result at the door this round and deletes their surveys there; the add-a-person
// and pin-fix writes share the /households/:id prefix but replace nothing. A missing key throws in
// recordHouseholdAction AFTER the door screen has latched its buttons — every outcome button the phone
// can show needs its route segment.
export const ACTION_PATHS = Object.freeze({
  not_home: 'not-home',
  wrong_address: 'wrong-address',
  lit_dropped: 'lit-drop',
  refused: 'refused',
  restricted: 'restricted',
  no_soliciting: 'no-soliciting',
  not_target: 'not-target',
});

export const doorResultPath = (householdId, action) => `/mobile/households/${householdId}/${ACTION_PATHS[action]}`;

// Exactly the body recordHouseholdAction submits for a door result (and the queue stores, plus
// wasOfflineSubmission): the canvasser's note and the book the door was tapped in (doorTurfId below).
export const doorResultBody = ({ note = null, turfId = null } = {}) => ({ note, turfId: turfId || null });

export const addVoterPath = (householdId) => `/mobile/households/${householdId}/voters`;

// Exactly the body recordAddVoter submits (and the queue stores, plus wasOfflineSubmission). The
// client-minted voterId is the voter's real _id on the server — idempotent on replay.
export const addVoterBody = ({ voterId, firstName, lastName, phone = null, email = null, turfId = null }) => ({
  voterId,
  firstName,
  lastName,
  phone: phone || null,
  email: email || null,
  turfId: turfId || null,
});

export const surveyPath = (voterId) => `/mobile/voters/${voterId}/survey`;

// Exactly the body the survey screen submits: the form's POST rows, its trimmed note (or null), and
// the book the door was tapped in.
export const surveyBody = ({ surveyTemplateId, answers, note, turfId = null }) => ({
  surveyTemplateId,
  answers,
  note,
  turfId: turfId || null,
});

// --- The book a door write was made in ---------------------------------------------------------
// Every door result, survey and walk-up add names the book the canvasser tapped it in: the door's
// `turfId` in the cached bootstrap (the canvasser's own book for that door — routes/mobile/bootstrap.js
// stamps it), read AT THE TAP. A write that reaches the server after its pass ended then still counts
// in the pass it was made in (server/src/services/canvass/attribution.js). null — a door not in the
// cache — and a server without that change (its body schemas strip the field) both get today's rule:
// the live book that holds the door.
export const doorTurfId = (bootstrap, householdId) => {
  const door = (bootstrap?.households || []).find((h) => String(h._id) === String(householdId));
  return door?.turfId ? String(door.turfId) : null;
};

// The pending overlay's call for one door on a server-sourced write (recordAction.js
// reconcilePendingHouseholds; `entry` is { status, at, turfId } from the tap). Anything but 'hold'
// drops the entry and lets the server's row through:
//   'expired'   — older than the TTL;
//   'moved'     — the door is in a different book than the one it was tapped in (a new pass took it):
//                 the recorded status belongs to the old round and counted there, so painting it on
//                 the new pass's pin would show undone work as done. Only when both books are known;
//   'confirmed' — the server's status agrees;
//   'hold'      — the server is behind on this door: keep painting the recorded status.
export const pendingDoorVerdict = (entry, door, { now, ttlMs }) => {
  if (now - entry.at > ttlMs) return 'expired';
  if (entry.turfId && door?.turfId && String(door.turfId) !== String(entry.turfId)) return 'moved';
  if (door?.status === entry.status) return 'confirmed';
  return 'hold';
};

// The map's "No book right now" (app/(app)/map.jsx): the map is scoped to a book selection, FRESH data
// (never the disk snapshot, whose books list can predate an assignment) lists none of the selected
// books, and no doors are left at all. One wording covers an archived walk list, an unassigned or
// reassigned book and a new pass alike. No selection means the canvasser never had a book, and a
// selected book still listed with no doors left (everyone voted) is not closed: both keep "No turf
// assigned yet". The selection is never cleared here, so a book brought back reappears on the next
// refresh.
export const bookClosed = ({ selectedBookIds, data }) => {
  const selected = [...(selectedBookIds || [])].map(String).filter(Boolean);
  if (!selected.length || !data || data.fromDiskCache) return false;
  if ((data.households || []).length) return false;
  const listed = new Set((data.books || []).map((b) => String(b.id)));
  return !selected.some((id) => listed.has(id));
};
