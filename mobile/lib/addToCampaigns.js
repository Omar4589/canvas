// The org view's add by email and a profile's Add to campaigns (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md): which
// step to show, what its button says, the campaigns the picks send, and the sentences after. Pure, and the
// SAME file on the phone (mobile/lib/addToCampaigns.js) and the web (client/src/lib/addToCampaigns.js), so
// both screens say the same thing; client/src/lib/addToCampaigns.parity.test.js holds them to it.
//
// `picks` is { [campaignId]: coordinatorId | '' } — a checked campaign and its crew, '' for No crew. The
// lookup's and the history read's `campaigns` rows are [{ campaignId, onCampaign, history }].

const count = (n, one, many) => `${Number(n || 0).toLocaleString()} ${n === 1 ? one : many}`;

// 'A' · 'A and B' · 'A, B and C'
export const andList = (parts) =>
  parts.length < 2 ? parts[0] || '' : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

const teamOf = (name) => (name ? `${name}’s team` : 'No team');

// What the address turned out to be, as the step to show:
//   new           nobody in this organization uses it (or an account elsewhere, which looks the same on
//                 purpose): their name, phone, password, a role, and campaigns
//   colleague     already in the organization: campaigns
//   switched-off  in the organization, account switched off: Switch on, with or without campaigns
export const orgConfirmKind = (found) => {
  switch (found?.outcome) {
    case 'outside':
      return 'new';
    case 'in-org':
      return 'colleague';
    case 'in-org-inactive':
      return 'switched-off';
    default:
      return 'unknown';
  }
};

// The campaigns they're already on (shown checked and locked), and each campaign's doors from before.
export const onCampaignIds = (rows) => new Set((rows || []).filter((r) => r.onCampaign).map((r) => String(r.campaignId)));
export const historyByCampaign = (rows) => new Map((rows || []).map((r) => [String(r.campaignId), r.history || null]));

// The crew a campaign starts on when it's checked: the first team their doors there count for (newest
// first) whose coordinator can still run a crew and is offered; otherwise No crew ('').
export const prePickFor = (history, choiceIds) => {
  const offered = new Set((choiceIds || []).map(String));
  const s = (history?.sources || []).find((x) => x.canLead && x.coordinatorId && offered.has(String(x.coordinatorId)));
  return s ? String(s.coordinatorId) : '';
};

export const pickCount = (picks) => Object.keys(picks || {}).length;

// The request's campaigns, in the order the screen lists them: [{ campaignId, coordinatorId | null }].
export const picksBody = (picks, campaignIds) =>
  (campaignIds || [])
    .map(String)
    .filter((id) => Object.prototype.hasOwnProperty.call(picks || {}, id))
    .map((id) => ({ campaignId: id, coordinatorId: picks[id] || null }));

// The main button. `kind` is a step from orgConfirmKind, or 'profile' for a profile's Add to campaigns.
// A new admin or team lead gets no campaign list, so their button is just Create.
export const submitLabel = (kind, { n = 0, role = 'canvasser' } = {}) => {
  const campaigns = count(n, 'campaign', 'campaigns');
  if (kind === 'new') return role === 'canvasser' && n ? `Create & add to ${campaigns}` : 'Create';
  if (kind === 'switched-off') return n ? `Switch on & add to ${campaigns}` : 'Switch on';
  if (kind === 'colleague' || kind === 'profile') return n ? `Add to ${campaigns}` : 'Add to campaigns';
  return null;
};

// Coordinator id → name, for the result's "moved … to Dana Cruz’s team".
export const coordinatorNames = (coordinators) =>
  new Map((coordinators || []).map((c) => [String(c.id), `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown']));

// The per-campaign lines after an add: where earlier doors moved, where nothing changed, and what
// couldn't be done. Doors follow the person (docs/PROPOSAL_PEOPLE_PAGES.md §B.7), so a returning person's
// doors on a campaign now count for the crew they joined there.
export const campaignLines = (campaigns, { first, crewNameById = new Map() } = {}) => {
  const rows = campaigns || [];
  const lines = [];
  for (const c of rows.filter((x) => x.result === 'joined')) {
    const r = c.restamp || {};
    const crewName = c.coordinatorId ? crewNameById.get(String(c.coordinatorId)) : null;
    const to = c.coordinatorId ? (crewName ? teamOf(crewName) : 'the crew you picked') : 'No team';
    const from = (r.sources || []).filter((s) => (s.doors || 0) > 0).map((s) => teamOf(s.coordinatorId ? s.name : null));
    if (r.error) {
      lines.push(`On ${c.campaignName}, ${first}’s earlier doors didn’t finish moving. Open ${first} on that campaign and choose Finish it.`);
    } else if (r.doors > 0) {
      lines.push(`On ${c.campaignName}, ${first}’s ${count(r.doors, 'earlier door', 'earlier doors')} moved${from.length ? ` from ${andList(from)}` : ''} to ${to}.`);
    } else if (r.surveys > 0) {
      lines.push(`On ${c.campaignName}, ${first}’s ${count(r.surveys, 'earlier survey', 'earlier surveys')} moved to ${to}.`);
    }
  }
  const already = rows.filter((x) => x.result === 'already-on').map((x) => x.campaignName);
  if (already.length) lines.push(`${first} was already on ${andList(already)}, so nothing changed there.`);
  const failed = rows.filter((x) => x.result === 'error').map((x) => x.campaignName);
  if (failed.length) lines.push(`${first} couldn’t be added to ${andList(failed)}. Try again.`);
  return lines;
};

// What happened, from POST /admin/memberships/by-email's answer.
export const orgDoneView = (result, { crewNameById = new Map() } = {}) => {
  const u = result?.user || {};
  const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'They';
  const first = u.firstName || name;
  const rows = result?.campaigns || [];
  const joined = rows.filter((c) => c.result === 'joined').map((c) => c.campaignName);
  const lines = [];
  if (result?.outcome === 'in-org-inactive') {
    lines.push(joined.length ? `${name}’s account is switched back on, and they’re on ${andList(joined)}.` : `${name}’s account is switched back on.`);
  } else if (result?.outcome === 'in-org') {
    lines.push(joined.length ? `${name} is now on ${andList(joined)}.` : `Nothing changed for ${name}.`);
  } else {
    lines.push(joined.length ? `${name} is in your organization, on ${andList(joined)}.` : `${name} is in your organization.`);
  }
  // The typed name was discarded in favour of a real person the operator hadn't met yet. Say so, or they
  // go looking for someone who was never created.
  if (result?.attached) {
    lines.push(
      `That email already had a Doorline account, so we added ${name} rather than a new person. They keep their own password, and what you typed wasn’t used. If that isn’t who you meant, remove them from your organization and check the address.`
    );
  }
  if (result?.outcome === 'created') lines.push('They’ve been emailed a link to set their own password.');
  if ((result?.outcome === 'created' || result?.attached) && result?.role === 'canvasser' && !rows.length) {
    lines.push(`${first} isn’t on any campaign yet, so the app won’t show them one. You can add them to one later from Users.`);
  }
  lines.push(...campaignLines(rows, { first, crewNameById }));
  const title = result?.outcome === 'in-org-inactive' ? 'Switched on' : result?.outcome === 'in-org' && !joined.length ? 'Nothing changed' : 'Added';
  return { title, lines, first };
};

// What happened, from a profile's POST /admin/memberships/:userId/campaigns.
export const profileDoneView = (campaigns, { firstName, crewNameById = new Map() } = {}) => {
  const first = firstName || 'This person';
  const joined = (campaigns || []).filter((c) => c.result === 'joined').map((c) => c.campaignName);
  return {
    title: joined.length ? 'Added' : 'Nothing changed',
    lines: [...(joined.length ? [`${first} is now on ${andList(joined)}.`] : []), ...campaignLines(campaigns, { first, crewNameById })],
  };
};

// The question before Remove on a profile or the web panel's campaign list: the campaign member sheet's
// words (mobile/components/MemberSheet.jsx confirmUnassign) with the web Team panel's line about shared
// books (client/src/components/people/PersonActions.jsx), which is what the server does — books are shared,
// so co-assigned canvassers keep theirs (server/src/routes/admin/assignments.js). `crewSize` is how many
// people there have them as coordinator (GET /admin/memberships/:userId/crews).
export const removeQuestion = ({ name, campaignName, crewSize = 0 }) => ({
  title: `Remove ${name} from ${campaignName || 'this campaign'}?`,
  message:
    'Any books they hold here go back to the pool, so you can hand them to someone else. Books shared with other canvassers stay assigned to them. This doesn’t affect their other campaigns. Their work is kept — every door they knocked still counts toward this campaign.' +
    (crewSize > 0
      ? `\n\n${name} runs a crew here: ${count(crewSize, 'person', 'people')} will have no coordinator. Their past doors stay on ${name}’s team.`
      : ''),
});
