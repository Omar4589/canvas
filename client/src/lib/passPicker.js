// Which pass the Turf Cutting page lands on when you arrive without a ?passId deep link.
//
// The old rule ranked purely on the PASS (uncut → active → most recent) and never looked at the
// walk list the pass belongs to. So with one active walk list you could still land on a pass
// belonging to a draft or archived one, just because that pass happened to be uncut — the
// opposite of what the page is for.
//
// Now the walk list's own state is the PRIMARY key, and the old pass ranking is the secondary
// one within each tier (owner ruling, Aug 2026):
//
//   1. RUNNING walk list · pass with 0 books cut      ← work to do, on a list being walked
//   2. RUNNING walk list · pass whose own status is active
//   3. RUNNING walk list · most recent pass
//   4. IDLE walk list    · same three, in the same order  (mid-setup is still real work)
//   5. ARCHIVED walk list, and archived passes
//
// Ties — several running walk lists each holding uncut work — break on the WALK LIST's creation
// date, newest first: the list you just built is almost always the one you came to cut. Same-list
// ties then break on the pass's own date.
//
// ── WHAT COUNTS AS "RUNNING" — read this before touching effortTier ──
// NOT `Effort.status`. That field DEFAULTS TO 'active' (Effort.js), so a walk list is 'active'
// from the moment it is created and stays that way until someone archives it — it is an
// archived-or-not lifecycle flag, not "is anyone walking this". Ranking on it put every list in
// the top tier, which collapsed this whole function back to the old pass-only behaviour and
// reproduced the exact bug it was written to fix.
//
// A walk list is RUNNING when it has a pass whose own status is 'active' — the same signal the
// Walk Lists page prints in its "Active pass" column and links "Cut / assign books" from. It is
// derived from the passes array we already have, so there is no extra field to keep in sync.
// `Effort.status === 'archived'` still demotes to the bottom tier, since that IS what that field
// is for.
//
// Pure (its one import, walkListOptions.js, is pure too) so the ranking is testable; the picker
// component only renders it.

import { isArchivedWalkList, passOptionLabel } from './walkListOptions.js';

const effortTier = (effort, hasActivePass) => {
  if (effort?.status === 'archived') return 2;
  return hasActivePass ? 0 : 1;
};

// Pass-level rank WITHIN a walk-list tier. An archived pass sorts last everywhere — it is never
// "work to do" — but stays reachable, because tier 2 exists precisely as the last resort for a
// campaign whose only passes are archived.
const passRank = (p) => {
  if (p.status === 'archived') return 3;
  if ((p.turfCount || 0) === 0) return 0;
  if (p.status === 'active') return 1;
  return 2;
};

const ts = (d) => {
  const t = new Date(d || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
};

// `passes` and `efforts` are the two lists the picker already fetches. Returns the chosen pass
// object, or null when there are none.
export function pickDefaultPass({ passes = [], efforts = [] } = {}) {
  if (!passes.length) return null;
  const effortById = new Map((efforts || []).map((e) => [String(e._id), e]));
  // Which walk lists are actually being walked right now — derived from the passes themselves.
  const runningEffortIds = new Set(
    passes.filter((p) => p.status === 'active').map((p) => String(p.effortId))
  );

  return [...passes]
    .map((p) => {
      const effort = effortById.get(String(p.effortId)) || null;
      return {
        pass: p,
        tier: effortTier(effort, runningEffortIds.has(String(p.effortId))),
        rank: passRank(p),
        effortAt: ts(effort?.createdAt),
        passAt: ts(p.createdAt),
      };
    })
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.rank - b.rank ||
        b.effortAt - a.effortAt || // newest walk list wins the tie
        b.passAt - a.passAt // then the newest pass on it
    )[0].pass;
}

// ── Dropdown grouping ──
// Every pass stays reachable (you may need to look back at an old round's books), grouped by what
// each pass IS — Live, Drafts, Archived (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.3). The old headings
// came from the walk-list tiers above, which put an ended pass under "Active round", a finished
// precinct under "Not started" and a pass canvassers were still walking under "Archived".
//
// The headings and the landing rule above now answer different questions, so they no longer share
// a key. What still holds, and passPicker.test.js pins it: the default is never under Archived
// unless every pass is.
export const PASS_GROUPS = [
  { key: 'live', label: 'Live' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'archived', label: 'Archived' },
];

// A pass's own status decides, except that EVERY pass of an archived walk list is Archived: its
// drafts are frozen there, and a pass still live there predates the one-time repair. A pass whose
// walk list is missing goes by its own status — the picker never silently hides a pass that exists.
export const passState = (pass, effort) => {
  if (pass?.status === 'archived' || isArchivedWalkList(effort)) return 'archived';
  return pass?.status === 'active' ? 'live' : 'drafts';
};

// "North · Pass 3 · GOTV" (passOptionLabel skips a name that only repeats "Pass N"). A pass of an
// archived walk list says so, and says what it was when that is not plain from the heading:
// "West · Pass 2 (draft) · walk list archived".
export const passPickerLabel = (pass, effort) => {
  const label = passOptionLabel(pass, effort?.name);
  if (!isArchivedWalkList(effort)) return label;
  const was = pass?.status === 'draft' ? ' (draft)' : pass?.status === 'active' ? ' (still live)' : '';
  return `${label}${was} · walk list archived`;
};

// Walk list name, then round number. Two walk lists sharing a name stay apart (their id breaks the
// tie before the round does), so one list's passes never interleave with the other's.
const byWalkListThenRound = (a, b) =>
  a.walkList.localeCompare(b.walkList, undefined, { numeric: true, sensitivity: 'base' }) ||
  a.effortKey.localeCompare(b.effortKey) ||
  (a.pass.roundNumber ?? 0) - (b.pass.roundNumber ?? 0);

// Returns [{ key, label, options: [{ value, label, pass }] }], empty groups dropped.
export const groupPassesByState = ({ passes = [], efforts = [] } = {}) => {
  const effortById = new Map((efforts || []).map((e) => [String(e._id), e]));
  const buckets = new Map(PASS_GROUPS.map((g) => [g.key, []]));
  for (const pass of passes || []) {
    const effort = effortById.get(String(pass.effortId)) || null;
    buckets.get(passState(pass, effort)).push({
      pass,
      label: passPickerLabel(pass, effort),
      walkList: effort?.name || 'Walk list',
      effortKey: String(pass.effortId ?? ''),
    });
  }
  return PASS_GROUPS.map((g) => ({
    ...g,
    options: buckets
      .get(g.key)
      .sort(byWalkListThenRound)
      .map(({ pass, label }) => ({ value: String(pass._id), label, pass })),
  })).filter((g) => g.options.length > 0);
};
