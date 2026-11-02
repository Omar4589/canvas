// The campaign Home's By book table (components/ByBookTable.jsx): which pass it opens on, how its rows
// sort and fold, and what a folded line adds up to. Pure, so byBook.test.js can pin it. The numbers come
// from GET /admin/reports/knocks-by-book — one pass split by book, adding up to that pass's By pass row.

// A By pass row that is a pass that still exists: the legacy row has no passId, and the bucket of a
// deleted pass's knocks keeps its passId but has no pass behind it (no roundNumber) — neither has books.
const isPass = (r) => r.passId && r.roundNumber != null;

// The passes the picker offers, in the By pass rows' order — walk list, then pass 1→N.
export const bookPassOptions = (rounds = []) =>
  rounds
    .filter(isPass)
    .map((r) => ({ passId: r.passId, label: r.effortName ? `${r.effortName} · ${r.roundLabel}` : r.roundLabel, status: r.status }));

// The pass the table opens on: the active pass with the most knocks in the range, else any pass with the
// most knocks, else the last active pass, else the first pass. null when there is none.
export const defaultBookPass = (rounds = []) => {
  const real = rounds.filter(isPass);
  if (!real.length) return null;
  const most = (rows) => rows.reduce((best, r) => ((r.knocks || 0) > (best.knocks || 0) ? r : best), rows[0]);
  const active = real.filter((r) => r.status === 'active');
  const worked = real.filter((r) => (r.knocks || 0) > 0);
  const workedActive = active.filter((r) => (r.knocks || 0) > 0);
  if (workedActive.length) return most(workedActive).passId;
  if (worked.length) return most(worked).passId;
  if (active.length) return active[active.length - 1].passId;
  return real[0].passId;
};

// The share of a book's doors knocked in the range — null for a row with no doors (the not-in-a-book
// row), and for one with more knocks than doors: knocks stay with the book they were recorded in while
// doors are the book now, so a book that gave doors away can hold more knocks than it has doors, and a
// share over 100% would be wrong rather than impressive. TOTAL passes `shareKnocks`, the books' own knocks:
// a knock outside every book has no door to count against.
export const knockedShare = (row) => {
  const knocks = row?.shareKnocks ?? row?.knocks ?? 0;
  return row?.doors > 0 && knocks <= row.doors ? Math.round((knocks / row.doors) * 100) : null;
};

// The count columns a folded line sums, and its rates worked out from those sums — never averaged, the
// server's formulas (services/reports/aggregations.js connectionRate, contactRate).
const COUNTS = ['doors', 'knocks', 'surveyedKnocks', 'surveysTaken', 'litKnocks', 'refusedKnocks', 'noSolicitingKnocks', 'notTargetKnocks', 'contactKnocks'];
export const sumBooks = (rows = []) => {
  const sum = Object.fromEntries(COUNTS.map((k) => [k, rows.reduce((n, r) => n + (r[k] || 0), 0)]));
  sum.connectionRate = sum.knocks ? Math.round(((sum.surveyedKnocks + sum.litKnocks) / sum.knocks) * 100) : 0;
  sum.contactRate = sum.knocks ? Math.round((sum.contactKnocks / sum.knocks) * 100) : 0;
  return sum;
};

// Book order is the server's (natural: Book 2 before Book 10), so ascending is arrival order and
// descending its reverse. A number column sorts by value with the arrival order breaking ties, so equal
// rows keep their places and a poll never shuffles them; a value of null (no knocks for a rate) sinks.
export const sortBooks = (rows = [], sort = { key: 'book', dir: 'asc' }, get = null) => {
  if (!get) return sort.dir === 'desc' ? [...rows].reverse() : rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((a, b) => {
      if (a.v == null || b.v == null) return a.v != null ? -1 : b.v != null ? 1 : a.i - b.i;
      return (a.v - b.v) * sign || a.i - b.i;
    })
    .map(({ row }) => row);
};

// Past `cap` books the table shows the first `cap` in the current sort and folds the rest into one line
// carrying their sum, so the lines on screen still add up to TOTAL. A fold never hides exactly one book.
export const foldBooks = (rows = [], cap = 10) => {
  if (rows.length <= cap + 1) return { open: rows, hidden: [], hiddenSum: null };
  const hidden = rows.slice(cap);
  return { open: rows.slice(0, cap), hidden, hiddenSum: sumBooks(hidden) };
};
