// The Books screen's book-status filter: which status keys a book carries, and whether it
// matches the selected chips. MIRROR of client/src/lib/bookStatusFilter.js — same rules on
// both platforms so a book never reads Completed on the phone and Restricted on the web;
// change one, change both. Pure data in/out (no react-native imports) so
// bookStatusFilter.test.js can pin the rules in plain node.
//
// The chips are TWO groups, not one flat set — coverage (assigned/unassigned) and
// progress (completed/in-progress/not-started/restricted) — OR'd within a group and
// AND'd across them. The one flat union this replaced made the obvious admin ask
// inexpressible: selecting Not started + In progress + Unassigned pulled every
// completed-but-unassigned book back in (it matched on "unassigned"), which on a
// desk-restricted round surfaced the exact books being filtered away. Now that click
// means "unassigned AND unfinished"; selecting from one group only leaves the other
// unconstrained, so single-chip behavior is unchanged.

export const COVERAGE_KEYS = ['assigned', 'unassigned'];
export const PROGRESS_KEYS = ['completed', 'in_progress', 'not_started', 'restricted'];

// A book's progress bucket from its /turfs/progress row ({ total, knocked, statusCounts }).
// "Knocked" counts every non-unknocked door — restricted and no-soliciting included — so a
// fully off-limits book would read completed; the `restricted` bucket names that case
// instead (taken off the table, not finished work). A finished book with any real work in
// it stays `completed`. A book with no eligible doors carries no progress bucket at all.
export const bookProgressKey = (p) => {
  if (!p || !(p.total > 0)) return null;
  if (!p.knocked) return 'not_started';
  if (p.knocked < p.total) return 'in_progress';
  const c = p.statusCounts || {};
  return (c.restricted || 0) + (c.no_soliciting || 0) >= p.total ? 'restricted' : 'completed';
};

// Every status key a book carries: exactly one coverage key + at most one progress key.
export const bookStatusSet = ({ assigned, progress }) => {
  const s = new Set([assigned ? 'assigned' : 'unassigned']);
  const key = bookProgressKey(progress);
  if (key) s.add(key);
  return s;
};

// A group passes when nothing in it is selected (unconstrained) or the book carries any
// selected key; the book must pass BOTH groups. Empty filter = every book.
export const matchesBookStatus = (statuses, filter) => {
  if (!filter.size) return true;
  const groupPasses = (keys) => {
    const sel = keys.filter((k) => filter.has(k));
    return sel.length === 0 || sel.some((k) => statuses.has(k));
  };
  return groupPasses(COVERAGE_KEYS) && groupPasses(PROGRESS_KEYS);
};
