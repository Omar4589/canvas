// What a viewer may do to one person on the phone — the member sheet (components/MemberSheet.jsx) and the
// profile (app/(app)/admin/users/[id].jsx) — and the buttons at the top for where that person stands
// (docs/PROPOSAL_PEOPLE_PAGES.md Part 1 "The person panel", §D.5, §G). A display gate only: the server
// decides, and this keeps dead buttons off the screen. Also the words of the crew checks the sheet
// shows, and the profile's recent-doors paging. Pure, so node can test it (personActions.test.js).
// Where someone stands (`st`) is rosterView.standing, the Team page's own rule.

const fmt = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many) => (n === 1 ? one : many);
const count = (n, one, many) => `${fmt(n)} ${plural(n, one, many)}`;
// 'a' · 'a and b' · 'a, b and c'
const joinAnd = (items) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// The state word beside their email, for where they stand (rosterView.standing). Active says nothing.
export const STATE_WORDS = {
  deleted: 'Deleted account',
  left: 'No longer in the org',
  deactivated: 'Deactivated',
  paused: 'Paused for review',
  'never-signed-in': 'Never signed in',
  'no-sign-in-recorded': 'No sign-in recorded',
};

export const isAdminRole = (viewerRole) => viewerRole === 'admin' || viewerRole === 'super';

// target: { userId, role, status, isSuperAdmin, lastLoginAt } — status is the server's standing
// ('active' | 'deactivated' | 'deleted' | 'removed'). The same gate as the web panel's
// (client/src/lib/personAccess.js):
//   manage        name, email and phone. An org admin, for anyone; a team lead, for canvassers (on
//                 their campaigns: the server's leadMayManageTarget). Never Doorline staff ("Managed
//                 by Doorline staff"), never an account that is deleted or gone.
//   resend        Resend invite: as manage, for someone with no password sign-in on record — a fresh
//                 link kills any earlier one, so a working account is never offered it. Never yourself.
//   tempPassword  as manage, never yourself: it would lock you out until you chose a new one.
//   switchAccount Deactivate and Reactivate (org-wide), as manage, never yourself.
//   remove        Remove from this campaign: an org admin, anyone; a team lead, canvassers, people no
//                 longer in the organization, and themselves (item 41). Not on an archived campaign.
//   crew          their crew here, for anyone on the team; a team lead never sets Doorline staff's
//                 (the bulk route's own rule). Changing it needs the campaign writable too.
//   assign        Assign to this campaign: org admins, for an account that is on.
export const personAccess = ({ viewerRole, viewerId = null, target, onCampaign = false, campaignWritable = false }) => {
  const admin = isAdminRole(viewerRole);
  const self = !!viewerId && String(viewerId) === String(target.userId);
  const gone = target.status === 'deleted' || target.status === 'removed';
  const staff = !!target.isSuperAdmin;
  const manage = !gone && !staff && (admin || target.role === 'canvasser');
  const crew = onCampaign && !gone && (admin || !staff);
  return {
    self,
    staff,
    manage,
    resend: manage && !self && !target.lastLoginAt,
    tempPassword: manage && !self,
    switchAccount: manage && !self,
    // A Doorline staff row is never a lead's to remove, even with no membership here (the server's 403).
    remove: onCampaign && campaignWritable && (admin || self || (!staff && (target.status === 'removed' || target.role === 'canvasser'))),
    crew,
    crewWritable: crew && campaignWritable,
    assign: !onCampaign && admin && campaignWritable && target.status === 'active',
  };
};

// The buttons at the top for where they stand (Part 1's table), and what folds away under More options —
// the web panel's actionsFor, so a person offers the same buttons on both:
//   Deactivated           Reactivate account
//   Never signed in       Resend invite, Set temporary password
//   No sign-in recorded   Set temporary password; Resend invite under More options
//   Paused for review     Unpause, when the viewer can (it asks first), with Set temporary password under
//                         More options; when they can't, Set temporary password at the top
//   No longer in the org  none; Remove from this campaign under More options
//   Otherwise             Set temporary password
// Deactivate account and Remove from this campaign always fold away under More options, and so does
// Unpause for an open pause that isn't blocking right now (the account is switched off, or automatic
// pause is off): the web's actionsFor. The caller passes `canUnpause` for such a pause to an org admin
// only (plan §D.5: a team lead lifts only a pause that blocks).
export const personButtons = ({ st, access, canUnpause = false }) => {
  const top = [];
  const more = [];
  const unpause = canUnpause && !access.self;
  if (st === 'deactivated') {
    if (access.switchAccount) top.push('reactivate');
  } else if (st === 'never-signed-in') {
    if (access.resend) top.push('resend');
    if (access.tempPassword) top.push('temp-password');
  } else if (st === 'no-sign-in-recorded') {
    if (access.tempPassword) top.push('temp-password');
    if (access.resend) more.push('resend');
  } else if (st === 'paused') {
    if (unpause) top.push('unpause');
    if (access.tempPassword) (unpause ? more : top).push('temp-password');
    if (access.resend) more.push('resend');
  } else if (st === 'active') {
    if (access.tempPassword) top.push('temp-password');
  }
  const accountOn = st === 'active' || st === 'paused' || st === 'never-signed-in' || st === 'no-sign-in-recorded';
  if (unpause && st !== 'paused' && st !== 'deleted' && st !== 'left') more.push('unpause');
  if (access.switchAccount && accountOn) more.push('deactivate');
  if (access.remove) more.push('remove');
  return { top, more };
};

// ── The crew checks on the member sheet ─────────────────────────────────────────────────────────────
// The member sheet keeps the word "coordinator" until the terms sweep (plan §I).
const crewWord = (name) => name || 'no coordinator';

// The open-time check of their CURRENT crew (GET …/crew/:userId/coordinator-preview with the crew they
// have): the line above Finish it, or the wait while another change for them finishes.
export const crewCheckLine = (preview, name) => {
  if (!preview) return null;
  if (preview.busy) return `Another change for ${name} is still finishing — try again in a minute or two.`;
  if (!preview.finishIt) return null;
  if (preview.unfinished) return `A crew change to ${crewWord(preview.to?.name)} didn't finish.`;
  const doors = preview.doors || 0;
  return doors > 0
    ? `${fmt(doors)} of their doors here still ${plural(doors, 'counts', 'count')} for another team.`
    : 'Some of their work here still counts for another team.';
};

// The check before a crew change — or before Finish it, whose pick is the crew they already have: what
// moves, from which teams (`sources`, so several read as several), to which, and the runs-a-crew warning.
export const crewChangeLines = (preview, { name, finishing = false } = {}) => {
  const doors = preview?.doors || 0;
  const surveys = preview?.surveys || 0;
  const lines = [];
  if (doors > 0 || surveys > 0) {
    const what =
      doors > 0
        ? `${count(doors, 'door', 'doors')}${surveys > 0 ? ` and ${count(surveys, 'survey', 'surveys')}` : ''}`
        : count(surveys, 'survey', 'surveys');
    const sources = preview?.sources || [];
    const from = sources.length
      ? sources.map((s) => crewWord(s.coordinatorId ? s.name || 'Unknown' : null))
      : [crewWord(preview?.from?.name)];
    lines.push(`Move ${what} from ${joinAnd(from)} to ${crewWord(preview?.to?.name)}?`);
    lines.push('This campaign only, all time.');
  } else {
    lines.push(finishing ? 'Nothing is left to move; Finish it records the change.' : `${name} has no past doors to move.`);
  }
  if (preview?.subjectRunsCrew) lines.push(`${name} runs a crew. Their own doors move; their crew's doors stay with them.`);
  return lines;
};

// Assign to this campaign, for one person: what their earlier doors here do on the crew picked (the
// bulk preview's row for them).
export const assignOneLine = (row, crewName) => {
  if (!row) return null;
  const team = crewName ? `${crewName}'s team` : 'No team';
  const doors = row.doors || 0;
  if (!doors) return 'No earlier doors here to move.';
  const from = (row.sources || []).map((s) => (s.coordinatorId ? `${s.name || 'Unknown'}'s team` : 'No team'));
  return `Their ${count(doors, 'earlier door', 'earlier doors')} here move to ${team}${from.length ? `, from ${joinAnd(from)}` : ''}.`;
};

// The 409s a crew change can answer (server/src/routes/admin/leadCrew.js crewConflict), for the sheet.
export const crewConflictLine = (err, name) => {
  const code = err?.data?.code;
  if (code === 'busy') return `Another change for ${name} is still finishing — try again in a minute or two.`;
  if (code === 'changed-meanwhile') return 'Their crew changed since you looked. Check it again before changing it.';
  return null;
};

// ── Recent doors ────────────────────────────────────────────────────────────────────────────────────
// Every door outcome plus restricted, never notes: the list the web panel passes to the reports read
// too (plan §B.2). Without it that read counts a note as a door.
export const RECENT_DOOR_ACTIONS = 'not_home,wrong_address,refused,survey_submitted,lit_dropped,no_soliciting,not_target,restricted';

// The profile shows the newest 5, then Show more adds 10.
export const RECENT_FIRST = 5;
export const RECENT_MORE = 10;
export const recentLimit = (skip) => (skip ? RECENT_MORE : RECENT_FIRST);

// The next `skip` for Show more, or undefined when there's no more. /recent-activity has no total, so
// it stops on a page that came back short, or one that added no new ids (a server that predates `skip`
// answers page one again).
export const nextRecentSkip = (pages = []) => {
  if (!pages.length) return 0;
  const last = pages[pages.length - 1]?.activities || [];
  if (last.length < recentLimit(pages.length === 1 ? 0 : 1)) return undefined;
  if (pages.length > 1) {
    const seen = new Set(pages.slice(0, -1).flatMap((p) => (p.activities || []).map((a) => String(a.id))));
    if (last.every((a) => seen.has(String(a.id)))) return undefined;
  }
  return pages.reduce((n, p) => n + (p.activities?.length || 0), 0);
};

// Every page's doors, in order, each once.
export const recentRows = (pages = []) => {
  const seen = new Set();
  const out = [];
  for (const p of pages) {
    for (const a of p.activities || []) {
      if (seen.has(String(a.id))) continue;
      seen.add(String(a.id));
      out.push(a);
    }
  }
  return out;
};
