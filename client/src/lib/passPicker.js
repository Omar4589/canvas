// Which pass the Turf Cutting page lands on when you arrive without a ?passId deep link.
//
// The old rule ranked purely on the PASS (uncut → active → most recent) and never looked at the
// walk list the pass belongs to. So with one active walk list you could still land on a pass
// belonging to a draft or archived one, just because that pass happened to be uncut — the
// opposite of what the page is for.
//
// Now the walk list's own status is the PRIMARY key, and the old pass ranking is the secondary
// one within each tier (owner ruling, Aug 2026):
//
//   1. ACTIVE walk list  · pass with 0 books cut      ← work to do, on a list that's running
//   2. ACTIVE walk list  · pass whose own status is active
//   3. ACTIVE walk list  · most recent pass
//   4. DRAFT walk list   · same three, in the same order  (mid-setup is still real work)
//   5. anything else, incl. archived walk lists and archived passes
//
// Ties — several active walk lists each holding uncut work — break on the WALK LIST's creation
// date, newest first: the list you just built is almost always the one you came to cut. Same-list
// ties then break on the pass's own date.
//
// Pure and dependency-free so the ranking is testable; the picker component only renders it.

const EFFORT_TIER = { active: 0, draft: 1 }; // archived, missing, or unknown → 2

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

  return [...passes]
    .map((p) => {
      const effort = effortById.get(String(p.effortId)) || null;
      return {
        pass: p,
        tier: EFFORT_TIER[effort?.status] ?? 2,
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

// Dropdown grouping: every pass stays reachable (you may need to look back at an old round's
// books), but they sit under their walk list's state so active work is at the top and archived
// falls to the bottom. Returns [{ key, label, passes }], empty groups dropped.
export const PASS_GROUPS = [
  { key: 'active', label: 'Active walk lists' },
  { key: 'draft', label: 'Draft' },
  { key: 'archived', label: 'Archived' },
];

export function groupPassesByEffortStatus({ passes = [], efforts = [] } = {}) {
  const effortById = new Map((efforts || []).map((e) => [String(e._id), e]));
  const buckets = new Map(PASS_GROUPS.map((g) => [g.key, []]));
  for (const p of passes) {
    const status = effortById.get(String(p.effortId))?.status;
    // A pass whose walk list is missing or in an unrecognized state is filed under Archived
    // rather than dropped — the picker must never silently hide a pass that exists.
    buckets.get(buckets.has(status) ? status : 'archived').push(p);
  }
  return PASS_GROUPS.map((g) => ({ ...g, passes: buckets.get(g.key) })).filter(
    (g) => g.passes.length > 0
  );
}
