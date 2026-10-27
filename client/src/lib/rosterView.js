// The campaign Team page's list logic — standing, quick-filter counts, filters, sort, crew headings,
// paging (docs/PROPOSAL_PEOPLE_PAGES.md §E.2). Pure, so it is tested directly (rosterView.test.js).
// MIRRORED on the phone by mobile/lib/rosterView.js — change one, change both
// (rosterView.parity.test.js compares the two).
//
// A row is a campaign roster row as GET /admin/campaigns/:id/assignments returns it:
// { userId, firstName, lastName, email, status, isActive, lastLoginAt, createdAt, role, coordinatorId,
//   coordinatorName }, plus `doors` and `lastDoorAt` when the page has joined the leaderboard in.

// Doorline didn't record sign-ins before this date, so an older account with no sign-in on record
// may well have signed in (server/src/services/users/deleteAccount.js CLOCKS_RELIABLE_FROM).
export const CLOCKS_RELIABLE_FROM = new Date('2026-05-15T00:00:00.000Z');

const NONE = new Set();
const idOf = (v) => (v ? String(v) : null);

// No sign-in on record, on an account older than the sign-in clock (or of unknown age): they may well
// have signed in. True whatever else holds (switched off, paused), so a blank last login reads "not
// recorded" rather than "never" wherever it shows.
export const noSignInRecorded = (row) => {
  if (row.lastLoginAt) return false;
  const made = row.createdAt ? new Date(row.createdAt) : null;
  return !made || made.getTime() < CLOCKS_RELIABLE_FROM.getTime();
};

// Where a person stands, first match wins.
//   deleted · left (no longer in the org) · deactivated · paused · never-signed-in ·
//   no-sign-in-recorded · active
export const standing = (row, pausedIds = NONE) => {
  if (row.status === 'deleted') return 'deleted';
  if (row.status === 'removed') return 'left';
  if (row.status === 'deactivated') return 'deactivated';
  if (pausedIds.has(idOf(row.userId))) return 'paused';
  if (!row.lastLoginAt) return noSignInRecorded(row) ? 'no-sign-in-recorded' : 'never-signed-in';
  return 'active';
};

// The account is switched on, whatever else is true — the Users page's "Active".
export const isAccountOn = (row) => row.status !== 'deleted' && row.status !== 'deactivated';

export const CHIPS = ['current', 'never-signed-in', 'deactivated', 'paused'];

const inChip = (row, chip, pausedIds) => {
  if (chip === 'never-signed-in') return standing(row, pausedIds) === 'never-signed-in';
  if (chip === 'deactivated') return row.status === 'deactivated';
  if (chip === 'paused') return pausedIds.has(idOf(row.userId));
  return row.status !== 'deleted'; // current: everyone on the campaign's team
};

const words = (q) => String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
const haystack = (row) => `${row.firstName || ''} ${row.lastName || ''} ${row.email || ''}`.toLowerCase();

// Search, crew and role — everything but the quick filter.
const matches = (row, { q, crew = 'all', role = 'all' }) => {
  if (crew === 'none' ? !!row.coordinatorId : crew !== 'all' && idOf(row.coordinatorId) !== String(crew)) return false;
  if (role !== 'all' && (row.role || 'canvasser') !== role) return false;
  const terms = words(q);
  if (!terms.length) return true;
  const text = haystack(row);
  return terms.every((t) => text.includes(t));
};

export const filterRoster = (rows, { chip = 'current', q = '', crew = 'all', role = 'all', pausedIds = NONE } = {}) =>
  rows.filter((r) => inChip(r, chip, pausedIds) && matches(r, { q, crew, role }));

// Each quick filter's count, after the search and the other filters, so a count always equals the
// rows that chip shows.
export const quickCounts = (rows, { q = '', crew = 'all', role = 'all', pausedIds = NONE } = {}) => {
  const out = Object.fromEntries(CHIPS.map((c) => [c, 0]));
  for (const r of rows) {
    if (!matches(r, { q, crew, role })) continue;
    for (const c of CHIPS) if (inChip(r, c, pausedIds)) out[c] += 1;
  }
  return out;
};

const nameKey = (r) => `${r.lastName || ''} ${r.firstName || ''}`.toLowerCase().trim();
const time = (d) => (d ? new Date(d).getTime() : null);
// Missing values sort last in either direction.
const byNullable = (a, b, dir) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir * (a < b ? -1 : a > b ? 1 : 0);
};

export const SORTS = ['crew', 'name', 'lastLogin', 'doors', 'lastDoor'];

// Sort a copy. Crew (how the page opens): coordinators A-Z, No crew last, then names. Two coordinators
// with the same name stay apart (by id), so each keeps one heading and its own count.
export const sortRoster = (rows, { key = 'crew', dir = 'asc' } = {}) => {
  const d = dir === 'desc' ? -1 : 1;
  const cmp = {
    crew: (a, b) =>
      byNullable(a.coordinatorId ? (a.coordinatorName || '').toLowerCase() : null, b.coordinatorId ? (b.coordinatorName || '').toLowerCase() : null, d) ||
      (idOf(a.coordinatorId) || '').localeCompare(idOf(b.coordinatorId) || '') ||
      nameKey(a).localeCompare(nameKey(b)),
    name: (a, b) => d * nameKey(a).localeCompare(nameKey(b)),
    lastLogin: (a, b) => byNullable(time(a.lastLoginAt), time(b.lastLoginAt), d) || nameKey(a).localeCompare(nameKey(b)),
    doors: (a, b) => byNullable(a.doors ?? 0, b.doors ?? 0, d) || nameKey(a).localeCompare(nameKey(b)),
    lastDoor: (a, b) => byNullable(time(a.lastDoorAt), time(b.lastDoorAt), d) || nameKey(a).localeCompare(nameKey(b)),
  }[SORTS.includes(key) ? key : 'crew'];
  return [...rows].sort(cmp);
};

// The crew headings over rows already sorted by crew: one group per coordinator, in order, with a count.
export const crewHeadings = (sortedRows) => {
  const groups = [];
  for (const r of sortedRows) {
    const id = idOf(r.coordinatorId);
    const last = groups[groups.length - 1];
    if (last && last.coordinatorId === id) last.rows.push(r);
    else groups.push({ coordinatorId: id, name: id ? r.coordinatorName || 'Unknown' : null, rows: [r] });
  }
  return groups.map((g) => ({ ...g, count: g.rows.length }));
};

// Paging: a page number that exists for `total` rows, and that page's rows.
export const pageCount = (total, pageSize) => Math.max(1, Math.ceil(total / pageSize));
export const clampPage = (page, total, pageSize) => Math.min(Math.max(1, Number(page) || 1), pageCount(total, pageSize));
export const pageOf = (rows, page, pageSize) => {
  const p = clampPage(page, rows.length, pageSize);
  return rows.slice((p - 1) * pageSize, p * pageSize);
};
// The page a row sits on, so stepping through people in the panel can turn the list's page with it.
export const pageOfIndex = (index, pageSize) => Math.floor(Math.max(0, index) / pageSize) + 1;
