// "Change this door's result?" — the decisions behind the confirmation a canvasser sees before
// recording a DIFFERENT result at a door this round (owner ruling 2026-10-02;
// docs/PROPOSAL_NOT_TARGET_OUTCOME.md §D). Each canvasser keeps one result per door per round, so a
// new tap REPLACES the earlier one — and if they surveyed someone there, it deletes those answers.
// Today both happen without a word; this is what asks first.
//
// Pure data in/out — no react-native imports — so doorChange.test.js pins it in plain node; the
// Alert presentation lives with the caller (recordAction.js, the survey screen), the resurvey.js
// convention.

import { ACTION_PATHS, addVoterPath, doorResultPath, surveyPath } from './doorPaths.js';

const statusOf = (action) => (action === 'survey_submitted' ? 'surveyed' : action);

// null = record without asking. Otherwise which prompt to show:
//   { kind: 'erase', count, to }  — this canvasser's own survey(s) here would be deleted
//   { kind: 'survey', from }      — opening a survey on a door already marked this round
//   { kind: 'change', from, to }  — any other different result
//
// `door` is the household as the phone holds it this round (bootstrap/delta, pending overlay
// applied, so a result tapped seconds ago counts). ORDER MATTERS: the erase check runs before every
// exemption, because a survey still waiting to upload can sit behind a door the cache briefly shows
// as fresh (the pending overlay lapses after 5 minutes or on restart, and a full bootstrap refetch
// repaints the server's 'unknocked') or behind a stale desk mark.
export const changePrompt = ({ door, action, ownSurveys = 0 }) => {
  const current = door?.status || 'unknocked';
  const next = statusOf(action);
  if (ownSurveys > 0 && next !== 'surveyed') return { kind: 'erase', count: ownSurveys, to: next };
  if (current === 'unknocked') return null; // a fresh door this round
  // The office's desk mark: the door card already says "work it normally; what you record here
  // replaces the mark". A canvasser's own Restricted tap is 'field', never 'desk'.
  if (current === 'restricted' && door?.restrictedFrom === 'desk') return null;
  if (next === current) return null; // re-recording the same result
  if (next === 'surveyed') return { kind: 'survey', from: current };
  return { kind: 'change', from: current, to: next };
};

// The voters at a door this canvasser surveyed this round, as the cache holds them. Keys on BOTH
// fields, like shouldConfirmResurvey, so a stale surveyedByMe left on a voter who has gone round-fresh
// by a delta merge cannot count.
export const ownSurveyedIds = (voters = [], householdId) =>
  voters
    .filter((v) => String(v.householdId) === String(householdId) && v.surveyStatus === 'surveyed' && v.surveyedByMe === true)
    .map((v) => String(v._id));

// How many surveys THIS canvasser holds at this door this round — cached or still queued — that the
// result being recorded would delete. `voters` may be the whole bootstrap list; it is scoped to the
// door here, so no caller can count a survey taken at another door. `pending` is the offline queue
// (offlineQueue.getPending()): items are { id, path, body, orgId, enqueuedAt } with paths stored
// WITHOUT the /api prefix, and `body.timestamp` is the tap time the server judges by.
//
// The cache half always counts. A survey already on the server may have been taken AFTER a result
// that is still queued — the server then keeps it, discarding the older replay
// (routes/mobile/canvass.js supersededByNewer) — and the cache cannot tell the two apart; a missed
// warning loses answers, a spare one only asks. recordHouseholdAction clears these marks the moment it
// records a result (clearOwnSurveysAtDoor), which is what keeps the usual case quiet.
//
// The queue half skips a survey a door result here was tapped AFTER: that result deletes it, or —
// replayed after the result landed — the survey is the older replay the server discards. Either way
// the warning would offer to keep answers that are already gone.
export const ownSurveysHere = ({ voters = [], householdId, pending = [] }) => {
  const doorVoterIds = new Set(
    voters.filter((v) => String(v.householdId) === String(householdId)).map((v) => String(v._id))
  );
  // Walk-up voters whose add is still queued. The queued body is exactly what recordAddVoter sends
  // (doorPaths.addVoterBody), so the client-minted id is body.voterId — never _id.
  for (const p of pending) {
    if (p.path === addVoterPath(householdId) && p.body?.voterId) doorVoterIds.add(String(p.body.voterId));
  }
  const ids = new Set(ownSurveyedIds(voters, householdId));
  // The queue half covers what the cache can lose: a full bootstrap refetch replaces voters
  // wholesale, so a survey still queued would otherwise be invisible here.
  const resultPaths = new Set(Object.keys(ACTION_PATHS).map((a) => doorResultPath(householdId, a)));
  const surveyPaths = new Map([...doorVoterIds].map((id) => [surveyPath(id), id]));
  const items = pending.map((p, i) => ({ p, i, at: Date.parse(p.body?.timestamp) }));
  // Tap order: by tap time when both carry one, else by queue position.
  const tappedAfter = (a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) ? a.at > b.at : a.i > b.i);
  const results = items.filter(({ p }) => resultPaths.has(p.path));
  for (const item of items) {
    if (!surveyPaths.has(item.p.path)) continue;
    if (!results.some((r) => tappedAfter(r, item))) ids.add(surveyPaths.get(item.p.path));
  }
  return ids.size;
};

// What recording a door result does to the cached voters, mirroring the server: it deletes this
// canvasser's surveys at the door this round (routes/mobile/canvass.js), and a voter holds at most
// one survey per round ({voterId, passId} is unique), so every voter they surveyed here reads
// round-fresh again — the wire's 'not_surveyed' with no surveyedByMe (bootstrap.js
// stampPerRoundSurvey). A teammate's survey (surveyedByMe === false) is untouched, and so is a voter
// at a legacy book, which carries no flag. The server's reply carries only the household, so without
// this the next change here warned about answers already gone.
export const clearOwnSurveysAtDoor = (bootstrap, householdId) => {
  if (!bootstrap?.voters) return bootstrap;
  const mine = new Set(ownSurveyedIds(bootstrap.voters, householdId));
  if (!mine.size) return bootstrap;
  const voters = bootstrap.voters.map((v) => {
    if (!mine.has(String(v._id))) return v;
    const { surveyedByMe, ...rest } = v;
    return { ...rest, surveyStatus: 'not_surveyed' };
  });
  return { ...bootstrap, voters };
};

// The inverse, for a result the server REJECTED (a 4xx: nothing was deleted). Puts back exactly the
// marks clearOwnSurveysAtDoor removed — `voterIds` from ownSurveyedIds before the clear — unless the
// voter has been rewritten since (a delta, or another survey), which is newer truth than this undo.
export const restoreOwnSurveys = (bootstrap, voterIds = []) => {
  if (!bootstrap?.voters || !voterIds.length) return bootstrap;
  const ids = new Set(voterIds.map(String));
  let changed = false;
  const voters = bootstrap.voters.map((v) => {
    if (!ids.has(String(v._id)) || v.surveyStatus !== 'not_surveyed' || 'surveyedByMe' in v) return v;
    changed = true;
    return { ...v, surveyStatus: 'surveyed', surveyedByMe: true };
  });
  return changed ? { ...bootstrap, voters } : bootstrap;
};

// The words, from a changePrompt result and a status → label map (theme.js statusLabels). Never
// promises the door CHANGES — "Record Refused instead?" — because a teammate's survey or drop can
// hold the round's status whatever this canvasser records.
export const buildChangePrompt = (prompt, labels) => {
  const label = (s) => labels?.[s] || s;
  if (prompt.kind === 'erase') {
    const n = prompt.count;
    return {
      title: 'You surveyed someone here',
      message:
        `You took ${n} ${n === 1 ? 'survey' : 'surveys'} at this door this round. Recording "${label(prompt.to)}" ` +
        'replaces your result for this door and deletes those answers. ' +
        'If you surveyed someone, the door is already done.',
      cancelText: 'Keep my survey',
      confirmText: 'Replace anyway',
      destructive: true,
    };
  }
  if (prompt.kind === 'survey') {
    return {
      title: `This door is marked ${label(prompt.from)}`,
      message: `This door is already marked ${label(prompt.from)} this round. Take a survey instead?`,
      cancelText: 'Cancel',
      confirmText: 'Continue',
      destructive: false,
    };
  }
  return {
    title: "Change this door's result?",
    message: `This door is already marked ${label(prompt.from)} this round. Record ${label(prompt.to)} instead?`,
    cancelText: 'Cancel',
    confirmText: 'Record',
    destructive: false,
  };
};
