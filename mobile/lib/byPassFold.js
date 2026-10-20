// The campaign screen's By pass card: which pass rows stay open, which fold away, and what the
// fold rows say and sum. MIRROR of client/src/lib/byPassFold.js (the campaign Home's By pass table)
// — everything below this header is byte-identical to it; change one, change both. Pure data in/out
// (no react-native imports) so byPassFold.test.js can pin the rules in plain node, and
// client/src/lib/byPassFold.parity.test.js holds the two in step.

// Why fold at all: the server returns EVERY pass of every walk list (a 0-knock round is real
// information — server/src/services/reports/knocksByPass.js), and Home opens on Today. A campaign
// cut into one walk list per precinct is fifty rows of mostly zeros, pushing the sections below it a
// long scroll down.
//
// The rule reads the RANGE, not Pass.status. A finished precinct's pass stays active until someone
// archives it by hand or the walk list's next pass goes live, so "active passes only" would still
// list every precinct. A row folds on its own only when it is QUIET — every count it can show is 0
// in the selected range — so folding never hides a number. Rows with numbers stay open up to the
// caller's cap; past it they fold into a "more passes" line that carries their SUM, so what is on
// screen still adds up (Σ rounds === totals, docs/METRICS.md). The TOTAL row and Export CSV are
// untouched: always every pass.

// Every count a By pass row can show, on either platform and either campaign type. Surveys taken
// is here on purpose: the response ledger is windowed on submittedAt, so a pass can have forms in
// range and no knocks (knocksByPass.js unions the survey buckets for exactly that row). Restricted
// doors are not — neither table shows them, so a restricted-only pass has nothing to show.
export const PASS_COUNTS = [
  'knocks',
  'surveyedKnocks',
  'litKnocks',
  'surveysTaken',
  'notTargetKnocks',
  'coverageGained',
];

export const isQuietPass = (row) => PASS_COUNTS.every((k) => !(row?.[k] > 0));

// Rows summed into one row-shaped object — the "more passes" line's numbers. The rate is recomputed
// from the summed counts with the server's own formula (connectionRate in
// server/src/services/reports/aggregations.js: survey + lit doors ÷ knocks, rounded, 0 with no
// knocks), the way the server builds the totals' rate — never an average of the rows' rates, which
// would weigh a 3-door pass like a 300-door one.
export const sumPasses = (rows) => {
  const sum = Object.fromEntries(PASS_COUNTS.map((k) => [k, 0]));
  for (const row of rows) for (const k of PASS_COUNTS) sum[k] += row[k] || 0;
  sum.connectionRate = sum.knocks
    ? Math.round(((sum.surveyedKnocks + sum.litKnocks) / sum.knocks) * 100)
    : 0;
  return sum;
};

// Splits rows — already in display order — for the folded view:
//   open          the rows shown while folded
//   worked        every row with a number, in order; unfolded, these list first…
//   quiet         …then these: the rows with nothing in the range
//   hiddenWorked  rows with numbers past `cap`; hiddenSum is their sum, for the "more passes" line
//   foldable      false when folding would save no room — then `open` is every row, in order, as the
//                 table always read, and the other lists are empty
// A fold must save at least one row: the fold control takes a row, and on the phone the sum takes
// one more (`sumOwnRow` — an action row there can't carry a number), so hiding rows only to add as
// many back would just put numbers behind a tap. The cap never hides exactly one row with numbers.
export const foldPasses = (rows, cap, { sumOwnRow = false } = {}) => {
  const worked = rows.filter((r) => !isQuietPass(r));
  const quiet = rows.filter(isQuietPass);
  const saved = (hidden) => hidden.length + quiet.length - 1 - (hidden.length && sumOwnRow ? 1 : 0);
  let hiddenWorked = worked.length > cap + 1 ? worked.slice(cap) : [];
  if (hiddenWorked.length && saved(hiddenWorked) < 1) hiddenWorked = [];
  if (saved(hiddenWorked) < 1) {
    return { foldable: false, total: rows.length, open: rows, worked: [], quiet: [], hiddenWorked: [], hiddenSum: null };
  }
  return {
    foldable: true,
    total: rows.length,
    open: worked.slice(0, worked.length - hiddenWorked.length),
    worked,
    quiet,
    hiddenWorked,
    hiddenSum: hiddenWorked.length ? sumPasses(hiddenWorked) : null,
  };
};

// When "no knocks" was — the range preset read as words. The preset ids are the same on both
// platforms (client/src/lib/datePresets.parity.test.js). An archived campaign's all-time view says
// nothing: "yet" would promise knocks that can no longer come.
export const quietWhen = (preset, archived = false) => {
  if (preset === 'today') return 'today';
  if (preset === 'yesterday') return 'yesterday';
  if (preset === '7d') return 'in the last 7 days';
  if (preset === '30d') return 'in the last 30 days';
  if (preset === 'all') return archived ? '' : 'yet';
  return 'in this range';
};

// What a quiet row means under the page's filters: "no knocks today", "no knocks from this crew
// yet". With a crew picked, the rows count only that crew's work while every pass is still listed,
// so a pass another crew worked reads quiet — "from this crew" keeps the sentence true.
// `words` is { preset, crew, archived }.
export const quietPhrase = ({ preset, crew = false, archived = false } = {}) =>
  [crew ? 'no knocks from this crew' : 'no knocks', quietWhen(preset, archived)].filter(Boolean).join(' ');

const count = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// How many of the quiet passes are their walk list's ACTIVE pass — live passes nobody has knocked in
// the range, the Election Day question ("which precincts has nobody touched today?"). Counted on a
// live campaign only: an archived one marks nothing active. Said as "(14 active)" right after the
// quiet count it belongs to, and left out at 0.
export const quietActive = (fold, words) =>
  words?.archived ? 0 : fold.quiet.filter((r) => r.status === 'active').length;
const activeNote = (fold, words) => {
  const n = quietActive(fold, words);
  return n ? ` (${n.toLocaleString()} active)` : '';
};

// The fold control's words while folded. With numbered rows hidden it offers the whole list; with
// only quiet rows hidden it says what they are.
export const foldLabel = (fold, words) =>
  fold.hiddenWorked.length
    ? `Show all ${count(fold.total, 'pass', 'passes')}`
    : `Show ${count(fold.quiet.length, 'pass', 'passes')} with ${quietPhrase(words)}${activeNote(fold, words)}`;

// The pieces each platform builds the fold's explanation from: "30 more passes" (the rows the sum
// covers), "7 with no knocks yet (3 active)", and — over the quiet rows once unfolded — "7 passes
// (3 active)".
export const morePasses = (fold) => count(fold.hiddenWorked.length, 'more pass', 'more passes');
export const quietCount = (fold, words) =>
  `${fold.quiet.length.toLocaleString()} with ${quietPhrase(words)}${activeNote(fold, words)}`;
export const quietTally = (fold, words) => `${count(fold.quiet.length, 'pass', 'passes')}${activeNote(fold, words)}`;
