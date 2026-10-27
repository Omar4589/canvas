// Add a canvasser on the phone (docs/PROPOSAL_PEOPLE_PAGES.md §G; the web's steps are §E.6): first ask
// who the email belongs to here (POST /admin/campaigns/:id/crew/resolve), then confirm what it turned
// out to be — with the person's doors on this campaign from before, and the crew they'd join — and only
// then add (POST …/crew), and say what happened. It used to add straight away, which could switch
// someone back on without saying so or add an existing account without saying whose. The steps are a
// reducer and the sentences plain functions, so node can test both (addByEmail.test.js).

const fmt = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many) => (n === 1 ? one : many);
const count = (n, one, many) => `${fmt(n)} ${plural(n, one, many)}`;
// 'a' · 'a and b' · 'a, b and c'
const joinAnd = (items) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const teamOf = (name) => (name ? `${name}'s team` : 'No team');
const idOf = (v) => (v ? String(v) : null);

// ── The steps ───────────────────────────────────────────────────────────────────────────────────────
// 'email' (type it) → 'confirm' (what it turned out to be) → 'done' (what happened). `error` is the
// last refusal, shown inside the step it came from: { message, waitMinutes }.
export const initialAdd = (email = '') => ({ step: 'email', email, found: null, result: null, error: null });

export const addReducer = (state, action) => {
  switch (action.type) {
    case 'typed':
      return state.step === 'email' ? { ...state, email: action.email, error: null } : state;
    case 'resolved':
      return { ...state, step: 'confirm', found: action.found, error: null };
    case 'failed':
      return { ...state, error: errorOf(action.error) };
    // Back from the confirm step to the email, which is kept, so a typo is one tap from fixed.
    case 'back':
      return state.step === 'confirm' ? { ...state, step: 'email', found: null, error: null } : state;
    case 'added':
      return { ...state, step: 'done', result: action.result, error: null };
    case 'again':
      return initialAdd();
    default:
      return state;
  }
};

// What Android's back button does: on the confirm step it goes back to the email, kept; anywhere else
// it closes the sheet; while a request is out, nothing.
export const backAction = (state, { busy = false } = {}) => (busy ? 'stay' : state.step === 'confirm' ? 'back' : 'close');

// A refusal, in the step's words. A 429 is the hourly limit on email checks (60 that find nobody, 30
// that name someone: server/src/middleware/crewResolveLimit.js); it says how long to wait.
export const errorOf = (err) => {
  if (err?.status === 429) {
    const s = Number(err.data?.retryAfterSeconds);
    const waitMinutes = Number.isFinite(s) && s > 0 ? Math.max(1, Math.ceil(s / 60)) : null;
    return {
      message: waitMinutes
        ? `Too many email checks this hour. Try again in ${count(waitMinutes, 'minute', 'minutes')}.`
        : 'Too many email checks this hour. Try again in a little while.',
      waitMinutes,
    };
  }
  return { message: err?.message || 'Something went wrong. Try again.', waitMinutes: null };
};

// ── The confirm step ────────────────────────────────────────────────────────────────────────────────
// What it offers, by what the address turned out to be:
//   new           nobody in this organization uses it: their name, phone, password and a crew, then Create & add
//   colleague     in the organization: a crew (their old one picked, when it can still lead), then Add to campaign
//   switched-off  in the organization but switched off: an org admin gets a crew and Switch on & add; a team
//                 lead is told an org admin has to (switching an account on reaches every campaign)
//   switch-on     switched off and already on this campaign: Switch on only, for an org admin; their crew stays
//   here          already on this campaign: nothing to add, so open them instead
export const confirmKind = (found, { isAdmin = false } = {}) => {
  switch (found?.outcome) {
    case 'outside':
      return { kind: 'new', crew: true, submit: 'Create & add' };
    case 'in-org':
      return { kind: 'colleague', crew: true, submit: 'Add to campaign' };
    case 'in-org-inactive':
      return found.onCampaign
        ? { kind: 'switch-on', crew: false, submit: isAdmin ? 'Switch on' : null }
        : { kind: 'switched-off', crew: isAdmin, submit: isAdmin ? 'Switch on & add' : null };
    case 'on-campaign':
      return { kind: 'here', crew: false, submit: null };
    default:
      return { kind: 'unknown', crew: false, submit: null };
  }
};

// The crew picked for them to start with: the first team their doors here count for whose coordinator
// can still run a crew (the server lists the teams newest first), otherwise No crew.
export const prePick = (history) => {
  for (const s of history?.sources || []) if (s.canLead && s.coordinatorId) return String(s.coordinatorId);
  return null;
};

// "Pat has 120 doors here from before: 100 on Dana Cruz's team, 20 on No team."
export const historyLine = (person, history) => {
  const doors = history?.doors || 0;
  if (!doors) return null;
  const who = person?.firstName || 'They';
  const verb = person?.firstName ? 'has' : 'have';
  const sources = history.sources || [];
  if (sources.length === 1) {
    return `${who} ${verb} ${count(doors, 'door', 'doors')} here from before, on ${teamOf(sources[0].coordinatorId ? sources[0].name : null)}.`;
  }
  const parts = sources.map((s) => `${fmt(s.doors)} on ${teamOf(s.coordinatorId ? s.name : null)}`);
  return `${who} ${verb} ${count(doors, 'door', 'doors')} here from before: ${parts.join(', ')}.`;
};

// Under the crew: what joining it does to those doors. They all count for the crew they join (doors
// follow the person, plan §B.7). It names the teams they leave but no count of the doors that move: the
// teams' own counts can overlap (a door re-knocked under two teams counts in both), so only the total is
// exact. The web's sentence (client/src/lib/addPeople.js joinLine).
export const joinLine = (history, pickId, pickName) => {
  const doors = history?.doors || 0;
  if (!doors) return null;
  const team = teamOf(pickId ? pickName : null);
  const sources = (history.sources || []).filter((s) => (s.doors || 0) > 0);
  const leaving = sources.filter((s) => idOf(s.coordinatorId) !== idOf(pickId));
  const all = doors === 1 ? 'Their 1 door here' : `All ${fmt(doors)} doors here`;
  if (!leaving.length) return `${all} already ${doors === 1 ? 'counts' : 'count'} for ${team}.`;
  if (!sources.some((s) => idOf(s.coordinatorId) === idOf(pickId))) return `${all} will count for ${team}.`;
  return `${all} will count for ${team}; the ones on ${joinAnd(leaving.map((s) => teamOf(s.coordinatorId ? s.name : null)))} move there.`;
};

// ── After the add ───────────────────────────────────────────────────────────────────────────────────
// What happened, from POST …/crew's answer, and whether to offer "Open {name}" — where their crew can
// be changed with the usual count first. `crewName` is the crew picked (null for No crew); the answer
// names the teams the earlier doors came FROM (`restamp.sources`), not where they went.
export const doneView = (result, { crewName = null } = {}) => {
  const u = result?.user || {};
  const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'They';
  const first = u.firstName || name;
  // Somebody else added them while this sheet was open, or they were already here: nothing changed.
  if (result?.outcome === 'on-campaign') {
    return { title: 'Already here', lines: [`${name} is already on this campaign. Nothing changed.`], open: true, first };
  }
  const lines = [];
  const r = result?.restamp || {};
  if (result?.outcome === 'in-org-inactive' && !r.changed) {
    lines.push(`${name}'s account is switched back on. Their crew here is as it was.`);
  } else if (result?.outcome === 'in-org-inactive') {
    lines.push(`${name}'s account is switched back on, and they're on this campaign.`);
  } else {
    lines.push(`${name} is on this campaign.`);
  }
  // The typed name was discarded in favour of a real person the operator hadn't met yet. Say so, or
  // they go looking for someone who was never created.
  if (result?.attached) {
    lines.push(
      `That email already had a Doorline account, so we added ${name} rather than a new person. They keep their own password, and what you typed wasn't used. If that isn't who you meant, remove them from the campaign and check the address.`
    );
  }
  if (result?.outcome === 'created') lines.push("They've been emailed a link to set their own password.");
  const from = (r.sources || []).filter((s) => s.doors > 0).map((s) => teamOf(s.coordinatorId ? s.name : null));
  if (r.error) {
    lines.push(`Their earlier doors here didn't finish moving. Open ${first} and choose Finish it.`);
  } else if (r.doors > 0) {
    lines.push(
      `${first}'s ${count(r.doors, 'earlier door', 'earlier doors')} moved${from.length ? ` from ${joinAnd(from)}` : ''} to ${teamOf(crewName)}.`
    );
  } else if (r.surveys > 0) {
    lines.push(`${first}'s ${count(r.surveys, 'earlier survey', 'earlier surveys')} moved to ${teamOf(crewName)}.`);
  }
  return {
    title: result?.outcome === 'in-org-inactive' ? 'Switched on' : 'Added',
    lines,
    open: !!r.error || r.doors > 0 || r.surveys > 0,
    first,
  };
};
