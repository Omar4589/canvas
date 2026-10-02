// "Change this door's result?" — the decisions behind the confirmation a canvasser sees before
// recording a DIFFERENT result at a door this round (owner ruling 2026-10-02;
// docs/PROPOSAL_NOT_TARGET_OUTCOME.md §D). Each canvasser keeps one result per door per round, so a
// new tap REPLACES the earlier one — and if they surveyed someone there, it deletes those answers.
// Today both happen without a word; this is what asks first.
//
// Pure data in/out — no react-native imports — so doorChange.test.js pins it in plain node; the
// Alert presentation lives with the caller (recordAction.js, the survey screen), the resurvey.js
// convention.

import { addVoterPath, surveyPath } from './doorPaths.js';

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

// How many surveys THIS canvasser holds at this door this round — cached or still queued.
// `voters` may be the whole bootstrap list; it is scoped to the door here, so no caller can count a
// survey taken at another door. `pending` is the offline queue (offlineQueue.getPending()): items
// are { id, path, body, orgId, enqueuedAt } with paths stored WITHOUT the /api prefix.
export const ownSurveysHere = ({ voters = [], householdId, pending = [] }) => {
  const doorVoters = voters.filter((v) => String(v.householdId) === String(householdId));
  const doorVoterIds = new Set(doorVoters.map((v) => String(v._id)));
  // Walk-up voters whose add is still queued. The queued body is exactly what recordAddVoter sends
  // (doorPaths.addVoterBody), so the client-minted id is body.voterId — never _id.
  for (const p of pending) {
    if (p.path === addVoterPath(householdId) && p.body?.voterId) doorVoterIds.add(String(p.body.voterId));
  }
  // The cache half keys on BOTH fields, like shouldConfirmResurvey, so a stale surveyedByMe left on
  // a voter who has gone round-fresh by a delta merge cannot fire it.
  const ids = new Set(
    doorVoters.filter((v) => v.surveyStatus === 'surveyed' && v.surveyedByMe === true).map((v) => String(v._id))
  );
  // The queue half covers what the cache can lose: a full bootstrap refetch replaces voters
  // wholesale, so a survey still queued would otherwise be invisible here.
  const queuedPaths = new Set(pending.map((p) => p.path));
  for (const id of doorVoterIds) if (queuedPaths.has(surveyPath(id))) ids.add(id);
  return ids.size;
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
