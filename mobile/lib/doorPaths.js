// The request paths and bodies the door writes queue under — ONE definition, shared by the
// writers (recordAction.js's walk-up add, the survey screen) and by the reader that counts what a
// canvasser still has queued at a door (doorChange.js ownSurveysHere). Plain ESM with no
// react-native imports, so doorChange.test.js builds its queue fixtures from these same functions
// and a fixture can never drift from what production actually queues. Paths carry no /api prefix
// (lib/api.js adds it), which is also how offlineQueue stores them.

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

export const addVoterPath = (householdId) => `/mobile/households/${householdId}/voters`;

// Exactly the body recordAddVoter submits (and the queue stores, plus wasOfflineSubmission). The
// client-minted voterId is the voter's real _id on the server — idempotent on replay.
export const addVoterBody = ({ voterId, firstName, lastName, phone = null, email = null }) => ({
  voterId,
  firstName,
  lastName,
  phone: phone || null,
  email: email || null,
});

export const surveyPath = (voterId) => `/mobile/voters/${voterId}/survey`;
