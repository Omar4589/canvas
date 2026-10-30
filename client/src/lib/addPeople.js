import { andList, teamName } from './crewChange.js';

// Add people (docs/PROPOSAL_PEOPLE_PAGES.md §E.6): the pre-pick and the sentences around it. Pure, so
// they are tested directly (addPeople.test.js); components/team/AddPeopleDialog.jsx lays them out.

const count = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// The crew a returning person's add starts on: the first team their doors here count for (newest
// first) whose coordinator can still run a crew (`canLead`), when the select offers them; else No crew.
export const prePick = (history, choiceIds) => {
  const offered = new Set((choiceIds || []).map(String));
  const s = (history?.sources || []).find((x) => x.canLead && x.coordinatorId && offered.has(String(x.coordinatorId)));
  return s ? String(s.coordinatorId) : '';
};

// "Pat has 120 doors here from before: 100 on Dana Cruz’s team, 20 on No team." `history.doors` is
// the person's doors, each once; each team's count is its own, so a door with work on two teams counts
// for both, and the teams can add up to more than the total — said, never summed.
export const historyLine = (first, history) => {
  const doors = history?.doors || 0;
  if (!doors) return null;
  const teams = (history.sources || []).filter((s) => s.doors > 0);
  const parts = teams.map((s) => `${s.doors.toLocaleString()} on ${teamName(s.name)}`);
  const overlap = teams.reduce((n, s) => n + s.doors, 0) > doors ? ' Some doors count for more than one team.' : '';
  return `${first} has ${count(doors, 'door', 'doors')} here from before${parts.length ? `: ${parts.join(', ')}` : ''}.${overlap}`;
};

// The teams a pick moves doors off: every team their doors here count for other than the picked crew's
// (joining moves all their work there, §B.7).
export const joinMoves = (history, pick) => ({
  sources: (history?.sources || []).filter((s) => s.doors > 0 && String(s.coordinatorId || '') !== String(pick || '')),
});

// What the pick does, under the select: "All 120 doors will count for Dana Cruz’s team; the ones on No
// team move there." Null for someone with no doors here. No count of the doors that move: the teams'
// own counts can overlap, so only the total is exact.
export const joinLine = (history, pick, pickName) => {
  const doors = history?.doors || 0;
  if (!doors) return null;
  const target = pick ? teamName(pickName) : 'No team';
  const leaving = joinMoves(history, pick).sources;
  const all = doors === 1 ? 'Their 1 door' : `All ${doors.toLocaleString()} doors`;
  if (!leaving.length) return `${all} already ${doors === 1 ? 'counts' : 'count'} for ${target}.`;
  const staying = (history.sources || []).some((s) => s.doors > 0 && String(s.coordinatorId || '') === String(pick || ''));
  if (!staying) return `${all} will count for ${target}.`;
  return `${all} will count for ${target}; the ones on ${andList(leaving.map((s) => teamName(s.name)))} move there.`;
};

// After the add, when earlier work moved (restamp from POST /crew): "Pat’s 120 earlier doors moved
// from Dana Cruz’s team to No team." Null when nothing moved.
export const movedReport = (first, restamp, toName) => {
  if (!restamp) return null;
  const doors = restamp.doors || 0;
  const surveys = restamp.surveys || 0;
  const rows = restamp.activities || 0;
  if (!doors && !surveys && !rows) return null;
  const what = doors
    ? `${first}’s ${count(doors, 'earlier door', 'earlier doors')}`
    : surveys
      ? `${first}’s ${count(surveys, 'earlier survey', 'earlier surveys')}`
      : `${first}’s earlier notes and marks`;
  const from = (restamp.sources || []).filter((s) => s.doors > 0).map((s) => teamName(s.name));
  const to = toName ? teamName(toName) : 'No team';
  if (restamp.error) return `${what} didn’t finish moving to ${to}. Open ${first} and choose Finish it.`;
  return `${what} moved${from.length ? ` from ${andList(from)}` : ''} to ${to}.`;
};

// Typed details for someone who already has an account (the Done step of an add that attached them).
export const typedIgnoredLine = (first) => `${first} already has an account, so what you typed wasn’t used.`;

// A 429 from the lookup, with the limiter's wait.
export const waitLine = (retryAfterSeconds) => {
  const minutes = Math.max(1, Math.ceil((Number(retryAfterSeconds) || 60) / 60));
  return `You’ve checked a lot of email addresses in the last hour. Try again in ${count(minutes, 'minute', 'minutes')}.`;
};

// From your organization: what one or more POST /assignments answers added up to.
export const fromOrgSummary = (answers) => {
  const out = { added: 0, already: 0, unfinished: 0, failed: 0, doors: 0 };
  for (const a of answers || []) {
    out.added += a.created || 0;
    out.doors += a.crew?.doors || 0;
    for (const s of a.crew?.skipped || []) {
      if (s.reason === 'already-on-campaign') out.already += 1;
      else if (s.reason === 'unfinished') out.unfinished += 1;
      else out.failed += 1;
    }
  }
  return out;
};

// The summary's sentences.
export const fromOrgLines = (s, toName) => {
  const lines = [`Added ${count(s.added, 'person', 'people')}.`];
  if (s.doors) lines.push(`Their ${count(s.doors, 'earlier door', 'earlier doors')} here now count for ${toName ? teamName(toName) : 'No team'}.`);
  if (s.already) lines.push(`${count(s.already, 'person was', 'people were')} already on this campaign, so nothing changed for them.`);
  if (s.unfinished) lines.push(`${count(s.unfinished, 'person’s', 'people’s')} earlier doors didn’t finish moving. Open them and choose Finish it.`);
  if (s.failed) lines.push(`${count(s.failed, 'person', 'people')} couldn’t be added. Try them again.`);
  return lines;
};
