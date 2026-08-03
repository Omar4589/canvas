// The smart re-survey confirm's decisions, kept out of the survey screen so they can be pinned
// in plain node (resurvey.test.js). Pure data in/out — no react-native imports; the Alert
// presentation lives with the caller (the restrictBooks.js / duplicateSurveys.js convention).
//
// THE gate. Strict === false: `surveyedByMe` is only on the wire when the voter's per-round
// surveyStatus is 'surveyed' — true when the requesting canvasser took it (the designed one-tap
// self-heal), false when a TEAMMATE did. Absent/undefined/null (old server, stale disk cache,
// pre-flag bootstrap) FAILS OPEN: no confirm, because a possibly-wrong warning at a door is worse
// than none — and the server-side preservation catches every collision the confirm misses. The
// double-key on surveyStatus also defends against the delta spread-merge leaving a stale flag on
// a voter who has gone round-fresh.
export const shouldConfirmResurvey = (voter) =>
  voter?.surveyStatus === 'surveyed' && voter?.surveyedByMe === false;

// Descriptor only, and deliberately NAMELESS and COUNTLESS — the wire carries no authorship
// beyond the boolean, and a stale flag must never make this copy a lie. The preservation claim
// ("stays visible to your campaign admins") is load-bearing and true regardless of staleness:
// the server archives every cross-canvasser replacement (pinned by
// server/test/surveyOverwrite.int.test.js, 'cross-canvasser overwrite preserves the full
// replaced response'). Proceeding is legitimate — the canvasser at the door outranks a
// possibly-stale phone — so the confirm button is NOT destructive-styled.
export const buildResurveyPrompt = () => ({
  title: 'Already surveyed this round',
  message:
    'Another canvasser already surveyed this voter this round. Your answers will replace ' +
    'theirs — the earlier response stays visible to your campaign admins.',
  confirmText: 'Survey anyway',
  cancelText: 'Cancel',
});
