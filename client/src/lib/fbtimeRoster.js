// The Integrations mapping roster: one array of rows folded from BOTH systems.
//
// The old page listed FbTime people only, so a Doorline canvasser with no FbTime
// match — precisely the person whose hours never arrive — appeared nowhere. Rows
// here come from either side, or both, which is what makes "does their campaign
// line up with their FbTime project?" a question the screen can answer at all.
//
// PURE ON PURPOSE: no React, no Date.now(), no locale formatting. Every ordering
// and visibility rule below is a decision somebody can get wrong, so they live
// where `node --test` can pin them (fbtimeRoster.test.js) instead of inside a
// component that only a browser can run.

// One primary pill per row. `rank` doubles as the default group order — the top
// of the list is the work, which is the actual answer to "endless scrolling".
export const ROW_STATUS = {
  orphan: { label: 'Broken link', variant: 'danger', rank: 0 },
  ghost: { label: 'Orphan hours', variant: 'danger', rank: 1 },
  'needs-link-hours': { label: 'Hours not counted', variant: 'warning', rank: 2 },
  suggested: { label: 'Match found', variant: 'info', rank: 3 },
  'needs-link': { label: 'Not linked', variant: 'neutral', rank: 4 },
  'no-fbtime': { label: 'No FbTime person', variant: 'neutral', rank: 5 },
  linked: { label: 'Linked', variant: 'success', rank: 6 },
};

// Secondary chips. Deliberately separate from status: a row can carry several,
// and folding them into one enum produces a combinatorial mess nobody can test.
export const ROW_FLAG = {
  'fbtime-inactive': 'Inactive in FbTime',
  'member-inactive': 'Deactivated in Doorline',
  'member-deleted': 'Account deleted',
  'unmatched-hours': 'Has unassigned hours',
  auto: 'Auto-matched by email',
  'no-campaign': 'On no active campaign',
  'member-gone': 'No longer in this organization',
};

export const SORT_DEFAULT_DIR = {
  status: 'asc',
  person: 'asc',
  fbtime: 'asc',
  campaign: 'asc',
  location: 'desc', // recency, not name — "who clocked in most recently"
};

const lower = (v) => String(v || '').trim().toLowerCase();
const fullName = (first, last) => `${first || ''} ${last || ''}`.trim();

// Two id spaces in one namespace. The FbTime side wins whenever it exists, so a
// pair and the unlinked row it came from share a key — which means linking a
// Doorline-only row CHANGES its key and correctly drops it from the selection on
// the next refetch (it's done; leaving it armed invites a double-apply).
const rowKey = (r) => (r.fbtimePersonId ? `f:${r.fbtimePersonId}` : `d:${r.userId}`);

const memberName = (m) =>
  fullName(m?.user?.firstName, m?.user?.lastName) || m?.user?.email || 'Unknown user';

/**
 * Fold both rosters into one row list.
 *
 * `projects` is the /fbtime/projects payload (recent FbTime project labels). It
 * is optional and arrives on its own query, so every row must render correctly
 * before it lands — a missing entry is an em-dash, never a blank column.
 */
export function buildRosterRows({
  people = [],
  suggestions = [],
  orphanLinks = [],
  ghostPersonIds = [],
  members = [],
  campaigns = [],
  projects = [],
} = {}) {
  const memberByUserId = new Map(members.map((m) => [String(m.user.id), m]));

  // A campaign id that resolves to nothing is NOT dropped: /admin/campaigns ships
  // campaigns mid-deletion in a separate deletingCampaigns array by design, so a
  // silent drop would make the chips and the filter disagree about the same row.
  const campaignById = new Map(
    campaigns.map((c) => [String(c._id), { id: String(c._id), name: c.name, isActive: c.isActive !== false }])
  );
  const resolveCampaign = (id) =>
    campaignById.get(String(id)) || { id: String(id), name: 'Removed campaign', isActive: false };

  const projectsByPerson = new Map(projects.map((p) => [String(p.fbtimePersonId), p]));
  const suggestByPerson = new Map(suggestions.map((s) => [String(s.fbtimePersonId), String(s.userId)]));
  const suggestByUser = new Map(suggestions.map((s) => [String(s.userId), String(s.fbtimePersonId)]));

  const rows = [];
  const consumedUserIds = new Set();

  const doorlineSide = (member) => {
    const all = (member.campaignIds || []).map(resolveCampaign);
    return {
      userId: String(member.user.id),
      name: memberName(member),
      email: member.user.email || null,
      role: member.role,
      memberActive: member.isActive !== false && member.user.isActive !== false,
      memberDeleted: Boolean(member.user.isDeleted),
      campaigns: all.filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name)),
      campaignIds: all.map((c) => c.id),
      managedCampaignIds: (member.managedCampaignIds || []).map(String),
    };
  };

  const fbtimeSide = (personId, { name, email, isActive }) => {
    const found = projectsByPerson.get(String(personId));
    return {
      fbtimePersonId: String(personId),
      fbtimeName: name || null,
      fbtimeEmail: email || null,
      fbtimeActive: isActive !== false, // absent means unknown, and unknown is not inactive
      fbtimeProjects: found?.projects || [],
      fbtimeLastShiftAt: found?.lastShiftAt || null,
    };
  };

  for (const p of people) {
    const pid = String(p.fbtimePersonId);
    const side = fbtimeSide(pid, {
      name: fullName(p.firstName, p.lastName),
      email: p.email,
      isActive: p.isActive,
    });
    const member = p.linkedUserId ? memberByUserId.get(String(p.linkedUserId)) : null;

    if (p.linkedUserId && member) {
      consumedUserIds.add(String(p.linkedUserId));
      rows.push({
        kind: 'linked',
        ...doorlineSide(member),
        ...side,
        linkSource: p.linkSource || null,
        hasUnmatchedHours: false, // the server only ever sets this on an UNLINKED person
        suggestedUserId: null,
      });
    } else if (p.linkedUserId) {
      // The link points at somebody who is no longer a member. Their hours are
      // still being attributed to a ghost, so this is the most urgent row on the
      // page — and today it renders as the bare word "Linked".
      rows.push({
        kind: 'orphan',
        userId: String(p.linkedUserId),
        // Deliberately NOT the FbTime name: echoing it on the Doorline side makes
        // a broken link render as a healthy pair, which is the exact confusion
        // this row kind exists to end.
        name: 'Former member',
        email: null,
        role: null,
        memberActive: false,
        memberDeleted: false,
        campaigns: [],
        campaignIds: [],
        managedCampaignIds: [],
        ...side,
        linkSource: p.linkSource || null,
        hasUnmatchedHours: false,
        suggestedUserId: null,
      });
    } else {
      rows.push({
        kind: 'needs-link',
        userId: null,
        name: null,
        email: null,
        role: null,
        memberActive: false,
        memberDeleted: false,
        campaigns: [],
        campaignIds: [],
        managedCampaignIds: [],
        ...side,
        linkSource: null,
        hasUnmatchedHours: Boolean(p.hasUnmatchedHours),
        suggestedUserId: suggestByPerson.get(pid) || null,
      });
    }
  }

  // Links whose FbTime person has left the provider's roster entirely: the
  // denormalized name/email on the link row is the only identity left.
  for (const l of orphanLinks) {
    consumedUserIds.add(String(l.userId));
    const member = memberByUserId.get(String(l.userId));
    const side = fbtimeSide(l.fbtimePersonId, {
      name: l.fbtimeName,
      email: l.fbtimeEmail,
      isActive: false,
    });
    rows.push({
      kind: 'orphan',
      ...(member
        ? doorlineSide(member)
        : {
            userId: String(l.userId),
            name: 'Former member',
            email: null,
            role: null,
            memberActive: false,
            memberDeleted: false,
            campaigns: [],
            campaignIds: [],
            managedCampaignIds: [],
          }),
      ...side,
      linkSource: l.source || null,
      hasUnmatchedHours: false,
      suggestedUserId: null,
    });
  }

  // Cached hours belonging to a person the provider no longer lists. GET /fbtime
  // counts these in unmatchedWithHours, so without a row the banner would count
  // something the table cannot show — and they ARE linkable.
  for (const id of ghostPersonIds) {
    rows.push({
      kind: 'ghost',
      userId: null,
      name: null,
      email: null,
      role: null,
      memberActive: false,
      memberDeleted: false,
      campaigns: [],
      campaignIds: [],
      managedCampaignIds: [],
      ...fbtimeSide(id, { name: null, email: null, isActive: false }),
      linkSource: null,
      hasUnmatchedHours: true,
      suggestedUserId: null,
    });
  }

  for (const m of members) {
    const uid = String(m.user.id);
    if (consumedUserIds.has(uid)) continue;
    rows.push({
      kind: 'no-fbtime',
      ...doorlineSide(m),
      fbtimePersonId: null,
      fbtimeName: null,
      fbtimeEmail: null,
      fbtimeActive: false,
      fbtimeProjects: [],
      fbtimeLastShiftAt: null,
      linkSource: null,
      hasUnmatchedHours: false,
      suggestedUserId: suggestByUser.get(uid) || null,
    });
  }

  const decorated = rows.map(decorate);
  return { rows: decorated, byKey: new Map(decorated.map((r) => [r.key, r])) };
}

function decorate(r) {
  const flags = [];
  if (r.fbtimePersonId && !r.fbtimeActive && r.kind !== 'ghost') flags.push('fbtime-inactive');
  if (r.kind === 'orphan') flags.push('member-gone');
  else if (r.userId && r.memberDeleted) flags.push('member-deleted');
  else if (r.userId && !r.memberActive && r.kind !== 'orphan') flags.push('member-inactive');
  if (r.hasUnmatchedHours) flags.push('unmatched-hours');
  if (r.linkSource === 'auto-email') flags.push('auto');
  if (r.kind === 'linked' && r.campaigns.length === 0) flags.push('no-campaign');

  let status = r.kind;
  if (r.kind === 'needs-link') {
    // Money on the floor outranks a convenient match: a person whose hours are
    // already accruing into nothing needs attention before one who just matches.
    if (r.hasUnmatchedHours) status = 'needs-link-hours';
    else if (r.suggestedUserId) status = 'suggested';
  }

  // Which rows the "Include inactive" toggle may hide. Deliberately narrow:
  //  · a LINKED row is never hidden — hiding a pairing makes it unfixable;
  //  · a row with unassigned hours is never hidden, whatever either side's state;
  //  · orphan and ghost rows are never hidden, they are the urgent ones.
  // So only a dormant unlinked FbTime person, or a switched-off member with no
  // FbTime side at all, is ever noise.
  const inactiveSide =
    (r.kind === 'needs-link' && !r.fbtimeActive && !r.hasUnmatchedHours) ||
    (r.kind === 'no-fbtime' && (!r.memberActive || r.memberDeleted));

  const searchText = [
    r.name,
    r.email,
    r.fbtimeName,
    r.fbtimeEmail,
    ...r.campaigns.map((c) => c.name),
    ...r.fbtimeProjects.map((p) => p.name),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return {
    ...r,
    key: rowKey(r),
    status,
    flags,
    inactiveSide,
    searchText,
    sortName: lower(r.name),
    sortFbtime: lower(r.fbtimeName),
    sortCampaign: lower(r.campaigns[0]?.name),
    sortLocation: r.fbtimeLastShiftAt ? new Date(r.fbtimeLastShiftAt).getTime() : null,
  };
}

export function filterRosterRows(rows, { term = '', campaignId = '', status = 'all', includeInactive = false } = {}) {
  const q = lower(term);
  return rows.filter((r) => {
    if (!includeInactive && r.inactiveSide) return false;
    if (q && !r.searchText.includes(q)) return false;
    // Matches ALL assignment ids, not the active-only chips, so filtering to an
    // archived campaign still finds the people who were on it.
    if (campaignId && !r.campaignIds.includes(String(campaignId))) return false;
    if (status === 'needs-link') return r.kind !== 'linked';
    if (status === 'linked') return r.kind === 'linked';
    if (status === 'problems') return ['orphan', 'ghost'].includes(r.kind) || r.hasUnmatchedHours;
    return true;
  });
}

// Null-sink is absolute, never direction-relative: a row with no FbTime name must
// stay at the BOTTOM on `fbtime desc` too, or every empty one floats to the top
// and the sort is useless in exactly one of its two directions.
const partitionSort = (rows, valueOf, cmp, dir) => {
  const has = [];
  const missing = [];
  for (const r of rows) (valueOf(r) === null || valueOf(r) === undefined || valueOf(r) === '' ? missing : has).push(r);
  has.sort((a, b) => (dir === 'desc' ? -cmp(a, b) : cmp(a, b)));
  missing.sort((a, b) => (a.sortName || a.sortFbtime || '').localeCompare(b.sortName || b.sortFbtime || ''));
  return [...has, ...missing];
};

export function sortRosterRows(rows, { key = 'status', dir = 'asc' } = {}) {
  const list = [...rows];
  // Tie-break on `key` everywhere, so two refetches never reorder equal rows.
  const byName = (a, b) =>
    (a.sortName || a.sortFbtime || '').localeCompare(b.sortName || b.sortFbtime || '') ||
    a.key.localeCompare(b.key);

  if (key === 'status') {
    const rank = (r) => ROW_STATUS[r.status]?.rank ?? 99;
    list.sort((a, b) => (dir === 'desc' ? rank(b) - rank(a) : rank(a) - rank(b)) || byName(a, b));
    return list;
  }
  if (key === 'person') return partitionSort(list, (r) => r.sortName, byName, dir);
  if (key === 'fbtime') {
    return partitionSort(list, (r) => r.sortFbtime, (a, b) => a.sortFbtime.localeCompare(b.sortFbtime) || a.key.localeCompare(b.key), dir);
  }
  if (key === 'campaign') {
    return partitionSort(list, (r) => r.sortCampaign, (a, b) => a.sortCampaign.localeCompare(b.sortCampaign) || byName(a, b), dir);
  }
  if (key === 'location') {
    return partitionSort(list, (r) => r.sortLocation, (a, b) => a.sortLocation - b.sortLocation || byName(a, b), dir);
  }
  list.sort(byName);
  return list;
}

export function rosterCounts(allRows, visibleRows) {
  return {
    shown: visibleRows.length,
    total: allRows.length,
    inactiveHidden: allRows.filter((r) => r.inactiveSide).length,
    linked: allRows.filter((r) => r.kind === 'linked').length,
    needsLink: allRows.filter((r) => r.kind !== 'linked').length,
    problems: allRows.filter((r) => ['orphan', 'ghost'].includes(r.kind) || r.hasUnmatchedHours).length,
  };
}

// The bulk bar always acts on selected ∩ visible. Narrowing the search must never
// leave an off-screen row armed for a destructive action.
export function resolveSelection(selectedKeys, visibleRows) {
  const visible = new Set(visibleRows.map((r) => r.key));
  return visibleRows.filter((r) => selectedKeys.has(r.key) && visible.has(r.key));
}

/**
 * Who this row can be linked to. Drawn from the SAME rows the table renders, so
 * the picker can never disagree with what is on screen.
 */
export function linkCandidates(allRows, target, { includeInactive = false } = {}) {
  if (!target?.row) return [];
  const { side, row } = target;
  const wantEmail = lower(side === 'doorline' ? row.fbtimeEmail : row.email);
  const wantLast = lower((side === 'doorline' ? row.fbtimeName : row.name)?.split(/\s+/).pop());

  const pool =
    side === 'doorline'
      ? allRows.filter((r) => r.kind === 'no-fbtime' && !r.memberDeleted && (includeInactive || r.memberActive))
      : allRows.filter((r) => ['needs-link', 'ghost'].includes(r.kind) && (includeInactive || r.fbtimeActive || r.hasUnmatchedHours));

  return pool
    .map((r) => {
      const primary = side === 'doorline' ? r.name : r.fbtimeName || 'Unnamed FbTime person';
      const secondary = side === 'doorline' ? r.email : r.fbtimeEmail;
      const exact = Boolean(wantEmail) && lower(secondary) === wantEmail;
      const sameLast = Boolean(wantLast) && lower(primary.split(/\s+/).pop()) === wantLast;
      return {
        id: side === 'doorline' ? r.userId : r.fbtimePersonId,
        key: r.key,
        primary,
        secondary: secondary || null,
        // The OTHER side's context is what lets an admin tell two people with the
        // same name apart — which the old <select> of bare names could not.
        context:
          side === 'doorline'
            ? r.campaigns.map((c) => c.name).join(' · ') || null
            : r.fbtimeProjects.map((p) => p.name).join(' · ') || null,
        badge: exact ? 'Same email' : sameLast ? 'Similar name' : null,
        rank: exact ? 0 : sameLast ? 1 : 2,
        active: side === 'doorline' ? r.memberActive : r.fbtimeActive,
      };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.active) - Number(a.active) ||
        a.primary.localeCompare(b.primary)
    );
}

/**
 * The email matches the server already computed and the old page threw away.
 *
 * Deduped by userId, first-wins: two FbTime people sharing one email both suggest
 * the same member, and applying both would 409 against the {organizationId,userId}
 * unique index. Skipping the second here turns a confusing failure into a counted,
 * explainable one.
 */
export function suggestedPairs(allRows) {
  const takenUsers = new Set(allRows.filter((r) => r.kind === 'linked').map((r) => r.userId));
  const memberByUserId = new Map(allRows.filter((r) => r.userId).map((r) => [r.userId, r]));
  const pairs = [];
  let skippedConflicts = 0;

  for (const r of allRows) {
    if (r.kind !== 'needs-link' || !r.suggestedUserId) continue;
    if (takenUsers.has(r.suggestedUserId)) {
      skippedConflicts += 1;
      continue;
    }
    takenUsers.add(r.suggestedUserId);
    const member = memberByUserId.get(r.suggestedUserId);
    pairs.push({
      key: r.key,
      fbtimePersonId: r.fbtimePersonId,
      userId: r.suggestedUserId,
      fbtimeName: r.fbtimeName,
      fbtimeEmail: r.fbtimeEmail,
      fbtimeProjects: r.fbtimeProjects,
      userName: member?.name || 'Unknown user',
      userEmail: member?.email || null,
      campaigns: member?.campaigns || [],
    });
  }
  return { pairs, skippedConflicts };
}
