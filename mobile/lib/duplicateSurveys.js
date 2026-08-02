// The Duplicate surveys screen's decisions, kept out of the component so they can be pinned in
// plain node (duplicateSurveys.test.js) — mobile has no component-test harness, so anything worth
// testing has to live in lib/. Pure data in/out: no react-native imports, no theme lookups. The
// Alert presentation and the token→color mapping stay with their callers.

export const KIND_ALL = 'all';
export const KIND_SAME_DAY = 'sameCanvasserSameDay';
export const KIND_DIFFERENT = 'differentCanvassers';

// TabSwitcher tabs. The keys ARE the server's `?kind=` values, so nothing translates in between.
export const KIND_TABS = [
  { key: KIND_ALL, label: 'All' },
  { key: KIND_SAME_DAY, label: 'Same canvasser, same day' },
  { key: KIND_DIFFERENT, label: 'Different canvassers' },
];

const canvasserName = (c) =>
  `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || c?.email || 'Unknown canvasser';

// The badge row. `tone` is a token name the card maps to colors — this file stays theme-free.
// BOTH flags can be true at once (a same-day repeat that also pulled in a third canvasser), and
// both must show: hiding one behind the other was the web bug fixed in the same batch as this
// screen, and an auditor needs to see that a third person was involved.
export const badgesFor = (dupe) => {
  const badges = [{ key: 'count', tone: 'neutral', text: `${dupe?.count || 0}× surveyed` }];
  if (dupe?.sameCanvasserSameDay) {
    badges.push({ key: 'sameDay', tone: 'danger', text: 'Same canvasser · same day' });
  }
  if (dupe?.differentCanvassers) {
    badges.push({ key: 'different', tone: 'info', text: 'Different canvassers' });
  }
  return badges;
};

// The one-line summary under the address when the card is collapsed.
export const summaryFor = (dupe) => {
  const people = new Set((dupe?.responses || []).map((r) => String(r?.canvasser?.userId)));
  const rounds = new Set((dupe?.responses || []).map((r) => r?.roundLabel).filter(Boolean));
  return [
    `${people.size} canvasser${people.size === 1 ? '' : 's'}`,
    `${rounds.size} round${rounds.size === 1 ? '' : 's'}`,
  ].join(' · ');
};

// Every response is deletable. The report cannot say which one is authoritative — that judgement
// is the whole reason an operator opens this screen — and guessing would be wrong as often as
// right (for a double-tap the SECOND submit is usually the good one; for a cross-round revisit the
// LATER one is the current truth). There is also no last-response case to guard: the endpoint only
// returns groups with count > 1, so a card can only go 3→2→gone.
export const deletableResponses = (dupe) => dupe?.responses || [];

// The destructive confirm. Descriptor only (no Alert here) so the copy can be pinned in a test —
// copy that names what is destroyed is exactly what rots silently.
//
// The second paragraph is a factual claim about the server and it is load-bearing: the delete route
// bumps ONLY stats.surveyCount, deliberately leaving the survey_submitted CanvassActivity row in
// place, so the knock still counts and the door still reads surveyed. campaignStats.int.test.js
// ('admin survey delete decrements surveyCount only') is what keeps that true — if it ever fails,
// this copy is a lie and must change with it.
export const buildDeletePrompt = ({ dupe, response, formatTime }) => {
  const who = canvasserName(response?.canvasser);
  const voter = dupe?.voter?.fullName || 'this voter';
  const when = formatTime ? formatTime(response?.submittedAt) : '';
  const round = response?.roundLabel || 'Unknown round';
  return {
    title: `Delete ${who}'s response?`,
    message:
      `${voter} · ${round}${when ? ` · ${when}` : ''}\n\n` +
      'The answers are erased permanently — there is no undo. The knock itself stays on the ' +
      "timeline and the door still reads surveyed; only this response goes, and the campaign's " +
      'Surveys total drops by one.',
    confirmText: 'Delete response',
  };
};

// Delete failures, worded by status. The timeout case is the one that matters: api.js turns a 20s
// abort into an Error with a code but NO status, which is indistinguishable from "the server did
// it and the reply was lost". A DELETE is not idempotent from the operator's point of view — a
// blind retry of a delete that succeeded returns 404 and reads like a bug — so never say "failed"
// when we cannot know.
export const deleteErrorMessage = (err) => {
  if (err?.code === 'TIMEOUT' || !err?.status) {
    return {
      title: "Couldn't confirm the delete",
      message:
        "The request didn't come back, so it may or may not have gone through. Pull down to " +
        'refresh the list before trying again.',
    };
  }
  if (err.status === 404) {
    return {
      title: 'Already deleted',
      message: 'Someone else removed this response. Pull down to refresh.',
    };
  }
  if (err.status === 403) {
    return {
      title: 'Admins only',
      message: 'Only an organization admin can delete a survey response.',
    };
  }
  return {
    title: "Couldn't delete the response",
    message: err?.message || 'Try again in a moment.',
  };
};
