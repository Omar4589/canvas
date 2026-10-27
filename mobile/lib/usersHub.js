// The phone's Users hub list (docs/PROPOSAL_PEOPLE_PAGES.md §G): who each row is, the status pills, the
// campaign view's Crew filter and Crew sort, 50 rows a section with Show 50 more, and who each "all
// shown" row acts on — the rows actually on screen, never one further down the list. Pure, so node can
// test it (usersHub.test.js). Who is Never signed in, and the crew order, come from rosterView.js (the
// Team page's own list logic, mirrored from the web), so the phone and the web can't disagree on either.
import { standing, isAccountOn, sortRoster } from './rosterView.js';
import { DELETED_ACCOUNT_LABEL } from './memberDeletion.js';

// Rows per section before "Show 50 more" (owner default N.2.4: 50 at a time on the phone).
export const PAGE_STEP = 50;
// One bulk preview reads at most 500 people, and its door total is exact only within one call
// (server/src/routes/admin/leadCrew.js coordinator-bulk/preview), so an "all shown" run covers 500 at most.
export const BULK_MAX = 500;

const NONE = new Set();

// ── Rows ────────────────────────────────────────────────────────────────────────────────────────────
// A row is rosterView's shape — { userId, firstName, lastName, email, role, status, lastLoginAt,
// createdAt, coordinatorId, coordinatorName } — plus what the hub itself shows: addedAt (joined the org,
// for "Recently joined"), isSuperAdmin, isDeleted, deletion (who deleted a tombstone row), inOrg and
// onCampaign. `status` is the server's standing: 'active' | 'deactivated' | 'deleted' | 'removed'.

// An org member, as GET /admin/memberships returns one.
export const memberRow = (m) => {
  const u = m.user || {};
  return {
    userId: String(u.id),
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    email: u.email || '',
    role: m.role || 'canvasser',
    status: u.isDeleted ? 'deleted' : m.isActive && u.isActive ? 'active' : 'deactivated',
    lastLoginAt: u.lastLoginAt || null,
    createdAt: u.createdAt || null,
    addedAt: m.addedAt || null,
    isSuperAdmin: !!u.isSuperAdmin,
    isDeleted: !!u.isDeleted,
    deletion: m.deletion || null,
    inOrg: true,
    onCampaign: false,
    coordinatorId: null,
    coordinatorName: null,
  };
};

// The campaign view: everyone on the roster (GET /admin/campaigns/:id/assignments), each with their org
// member's facts when they have one, then the org's members who aren't on it. A roster row whose person
// is no longer in the organization still shows — as No longer in the org — so it can be taken off. The
// roster's standing is the one the server works out for this campaign, so it wins over the membership's.
export const campaignRows = (members = [], roster = []) => {
  const memberOf = new Map(members.map((m) => [String(m.user?.id), m]));
  const on = roster.map((a) => {
    const m = memberOf.get(String(a.userId));
    const base = m
      ? memberRow(m)
      : {
          userId: String(a.userId),
          firstName: a.firstName || '',
          lastName: a.lastName || '',
          email: a.email || '',
          role: a.role || 'canvasser',
          status: a.status || 'removed',
          lastLoginAt: a.lastLoginAt || null,
          createdAt: a.createdAt || null,
          addedAt: null,
          isSuperAdmin: !!a.isSuperAdmin,
          isDeleted: a.status === 'deleted',
          deletion: null,
          inOrg: false,
        };
    return {
      ...base,
      status: a.status || base.status,
      coordinatorId: a.coordinatorId ? String(a.coordinatorId) : null,
      coordinatorName: a.coordinatorName || null,
      onCampaign: true,
    };
  });
  const onIds = new Set(on.map((r) => r.userId));
  return { on, off: members.map(memberRow).filter((r) => !onIds.has(r.userId)) };
};

// ── Filters ─────────────────────────────────────────────────────────────────────────────────────────
// The status pills. The phone keeps its "Inactive" word until the terms sweep (plan §I): Active is an
// account that is on and in this organization, Inactive is everyone else. Paused and Never signed in
// are the Team page's own rules (rosterView).
export const STATUS_PILLS = [
  { key: 'all', label: 'All status' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'paused', label: 'Paused' },
  { key: 'never-signed-in', label: 'Never signed in' },
];

const isOn = (row) => isAccountOn(row) && row.status !== 'removed';

export const inStatus = (row, status, pausedIds = NONE) => {
  if (status === 'active') return isOn(row);
  if (status === 'inactive') return !isOn(row);
  if (status === 'paused') return pausedIds.has(row.userId);
  if (status === 'never-signed-in') return standing(row, pausedIds) === 'never-signed-in';
  return true;
};

// 'all', 'none' (No crew) or a coordinator's id — rosterView's crew rule.
export const crewMatches = (row, crew = 'all') =>
  crew === 'all' || (crew === 'none' ? !row.coordinatorId : row.coordinatorId === String(crew));

const words = (q) => String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
// A deleted account's row matches only the label it shows: never its scrubbed name, nor its email, the
// tombstone address, neither of which is on screen.
const haystack = (r) =>
  (r.status === 'deleted' ? DELETED_ACCOUNT_LABEL : `${r.firstName} ${r.lastName} ${r.email}`).toLowerCase();

// Search (every word, in the name or email), role, status and crew.
export const filterHubRows = (rows, { q = '', role = 'all', status = 'all', crew = 'all', pausedIds = NONE } = {}) => {
  const terms = words(q);
  return rows.filter(
    (r) =>
      (role === 'all' || r.role === role) &&
      inStatus(r, status, pausedIds) &&
      crewMatches(r, crew) &&
      (!terms.length || terms.every((t) => haystack(r).includes(t)))
  );
};

// The Crew sheet: every crew on this roster (A–Z), then No crew, each with how many rows it would show
// once the other filters have had their say, so a count always equals the rows it shows. The crew
// picked stays listed even after its last person has moved off it, so it can be cleared.
export const crewOptions = (rosterRows, otherwiseFiltered, picked = null) => {
  const names = new Map();
  for (const r of rosterRows) {
    if (r.coordinatorId && !names.has(r.coordinatorId)) names.set(r.coordinatorId, r.coordinatorName || 'Unknown');
  }
  if (picked?.key && picked.key !== 'all' && picked.key !== 'none' && !names.has(picked.key)) {
    names.set(picked.key, picked.label || 'Unknown');
  }
  const count = (key) => otherwiseFiltered.filter((r) => crewMatches(r, key)).length;
  return [
    { key: 'all', label: 'All crews', count: otherwiseFiltered.length },
    ...[...names]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, label]) => ({ key, label, count: count(key) })),
    { key: 'none', label: 'No crew', count: count('none') },
  ];
};

// ── Sort ────────────────────────────────────────────────────────────────────────────────────────────
// Crew only means something on a campaign, so it is offered only there.
export const SORT_OPTIONS = [
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' },
  { key: 'recent-joined', label: 'Recently joined' },
  // lastLoginAt, and says so — it used to be labeled "Recently active", which it never was. "Password
  // login" because a used sign-in is extended without one (docs/PROPOSAL_SESSION_EXPIRY.md).
  { key: 'recent-signin', label: 'Recent password login' },
  { key: 'crew', label: 'Crew', campaignOnly: true },
];

export const sortOptionsFor = (campaignChosen) => SORT_OPTIONS.filter((o) => campaignChosen || !o.campaignOnly);

const compareName = (a, b, dir) => {
  const an = `${a.lastName} ${a.firstName}`.toLowerCase();
  const bn = `${b.lastName} ${b.firstName}`.toLowerCase();
  if (an < bn) return dir === 'asc' ? -1 : 1;
  if (an > bn) return dir === 'asc' ? 1 : -1;
  return 0;
};

// Newest first; a row with no date sorts last.
const compareDate = (a, b, key) => {
  const av = a[key] ? new Date(a[key]).getTime() : 0;
  const bv = b[key] ? new Date(b[key]).getTime() : 0;
  if (av === 0 && bv === 0) return 0;
  if (av === 0) return 1;
  if (bv === 0) return -1;
  return bv - av;
};

// A sorted copy. Crew is the Team page's order: coordinators A–Z, No crew last, then names.
export const sortHubRows = (rows, mode) => {
  if (mode === 'crew') return sortRoster(rows, { key: 'crew' });
  const list = rows.slice();
  if (mode === 'name-desc') list.sort((a, b) => compareName(a, b, 'desc'));
  else if (mode === 'recent-joined') list.sort((a, b) => compareDate(a, b, 'addedAt'));
  else if (mode === 'recent-signin') list.sort((a, b) => compareDate(a, b, 'lastLoginAt'));
  else list.sort((a, b) => compareName(a, b, 'asc'));
  return list;
};

// ── The row's one badge ─────────────────────────────────────────────────────────────────────────────
// The most exceptional state wins: deleted, no longer in the org, inactive, paused, never signed in.
// `tone` picks the colors on screen: danger (the badge's default) or warn.
export const rowBadge = (row, pausedIds = NONE) => {
  const st = standing(row, pausedIds);
  if (st === 'deleted') return { text: 'deleted', tone: 'danger' };
  if (st === 'left') return { text: 'not in org', tone: 'danger' };
  if (st === 'deactivated') return { text: 'inactive', tone: 'danger' };
  if (st === 'paused') return { text: 'paused', tone: 'danger' };
  if (st === 'never-signed-in') return { text: 'never signed in', tone: 'warn' };
  return null;
};

// ── 50 at a time ────────────────────────────────────────────────────────────────────────────────────
// Each section (the campaign's people, the rest of the org, the org view's one list) shows 50 rows,
// then "Show 50 more" adds 50. `key` is the filters the rows were drawn with: a new search, filter,
// sort or campaign starts every section at 50 again. The screen keeps the reducer's state and reads
// it through `limitOf(paging, key, section)`, so a stale key never shows for even one frame.
export const pagingFor = (key) => ({ key, limits: {} });

export const limitOf = (paging, key, section) => (paging.key === key ? paging.limits[section] ?? PAGE_STEP : PAGE_STEP);

export const pagingReducer = (paging, action) => {
  const base = action.key === paging.key ? paging : pagingFor(action.key);
  if (action.type === 'more') {
    return { ...base, limits: { ...base.limits, [action.section]: limitOf(base, action.key, action.section) + PAGE_STEP } };
  }
  return base; // 'reset'
};

// The rows a section renders, how many are left below them, and what the next "Show N more" adds.
export const pageOfRows = (rows, limit = PAGE_STEP) => {
  const shown = rows.slice(0, Math.max(0, limit));
  const left = rows.length - shown.length;
  return { shown, left, next: Math.min(PAGE_STEP, left) };
};

// ── "All shown" ─────────────────────────────────────────────────────────────────────────────────────
// Who each "all shown" row acts on, out of the rows a section actually renders:
//   Move all shown to a crew…    everyone shown on the campaign; the server skips who it must, and says
//                                why (already on that crew, the coordinator picked, Doorline staff…)
//   Resend invites to all shown  shown people who never signed in, on an account that is on — never
//                                Doorline staff, and for a team lead canvassers only
//   Assign all shown             shown people not on the campaign whose account is on
export const moveTargets = (shown) => shown.filter((r) => r.onCampaign);

export const resendTargets = (shown, { pausedIds = NONE, lead = false } = {}) =>
  shown.filter(
    (r) => standing(r, pausedIds) === 'never-signed-in' && !r.isSuperAdmin && (!lead || r.role === 'canvasser')
  );

export const assignTargets = (shown) => shown.filter((r) => !r.onCampaign && r.status === 'active');

// The label of an "all shown" row, carrying its count.
export const allShownLabel = (verb, n) => `${verb} (${n.toLocaleString()})`;
