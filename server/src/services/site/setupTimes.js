// How long a voter-file import takes, from production history — the evidence behind the homepage's
// "From voter file to knocking, often the same day" (docs/PROPOSAL_AAPC_LANDING.md, decision 5). Pure:
// migrations/reportSetupTimes.js reads the rows and prints what this returns.
//
// An import's clock: `createdAt` (the upload was queued), `startedAt` (processing began — reset on a
// retry, so it marks the attempt that finished) and `completedAt`. "Upload to ready" is what a customer
// waits; "processing" is the worker's own time.

export const BUCKETS = [
  { label: 'Under 10,000 rows', max: 9_999 },
  { label: '10,000–49,999 rows', max: 49_999 },
  { label: '50,000–99,999 rows', max: 99_999 },
  { label: '100,000+ rows', max: Infinity },
];

const median = (sorted) => {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** "40 s", "6 min", "1 h 12 min" — a duration in ms, rounded for a reader. */
export const formatDuration = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

/**
 * rows: [{ totalRows, createdAt, startedAt, completedAt }] for completed imports. Rows missing a clock
 * are skipped. Returns one entry per bucket ({ label, count, waitMedian, waitMax, runMedian, runMax },
 * in ms), plus the largest import.
 */
export const summarizeImportTimes = (rows) => {
  const usable = rows.filter((r) => r.createdAt && r.completedAt && r.completedAt >= r.createdAt);
  const buckets = BUCKETS.map((b) => ({ ...b, waits: [], runs: [] }));
  let largest = null;
  for (const r of usable) {
    const rowsN = Number(r.totalRows) || 0;
    const wait = new Date(r.completedAt) - new Date(r.createdAt);
    const run = r.startedAt ? new Date(r.completedAt) - new Date(r.startedAt) : null;
    const b = buckets.find((x) => rowsN <= x.max);
    b.waits.push(wait);
    if (run != null && run >= 0) b.runs.push(run);
    if (!largest || rowsN > largest.rows) largest = { rows: rowsN, wait };
  }
  return {
    total: usable.length,
    largest,
    buckets: buckets.map(({ label, waits, runs }) => {
      const w = [...waits].sort((a, c) => a - c);
      const r = [...runs].sort((a, c) => a - c);
      return {
        label,
        count: w.length,
        waitMedian: median(w),
        waitMax: w.length ? w[w.length - 1] : null,
        runMedian: median(r),
        runMax: r.length ? r[r.length - 1] : null,
      };
    }),
  };
};
