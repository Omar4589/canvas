// The import list's map-pin line — the pure half, so `node --test src/` pins the wording.
//
// After an import, services/households/placeStackedPins.js looks up the file's homes that share a
// map spot with other addresses and stores three outcome counts on the ImportJob, or one generic
// sentence (pinPassError) when it was busy or failed. The line reads
//   "Map pins: 412 placed by address · 9 confirmed at their spot · 60 without an exact spot"
// with zero parts left out, and `pinFixes` says whether to link Pin Fixes (homes are left to fix).
// Returns null when there is nothing to say (no shared spots, or an older job without the fields).

const n = (v) => Number(v) || 0;
const fmt = (v) => n(v).toLocaleString();

export const importPinLine = (job) => {
  if (!job) return null;
  if (job.pinPassError) return { text: job.pinPassError, pinFixes: false, failed: true };
  const placed = n(job.pinsPlacedExact);
  const confirmed = n(job.pinsConfirmedInPlace);
  const unplaced = n(job.pinsStillUnplaced);
  const parts = [];
  if (placed > 0) parts.push(`${fmt(placed)} placed by address`);
  if (confirmed > 0) parts.push(`${fmt(confirmed)} confirmed at ${confirmed === 1 ? 'its' : 'their'} spot`);
  if (unplaced > 0) parts.push(`${fmt(unplaced)} without an exact spot`);
  if (!parts.length) return null;
  return { text: `Map pins: ${parts.join(' · ')}`, pinFixes: unplaced > 0, failed: false };
};

// The Status column while the job is checking pins: its own stage, no percent (the write's 100%
// would read as done while lookups are still running). The job's status stays 'importing' through
// the pass (importProcessor.js sets only phase: 'pins'), and a completed or failed job keeps its
// last phase, so the status is checked too.
export const PINS_STAGE_LABEL = 'Checking map pins';
export const isCheckingPins = (job) => job?.phase === 'pins' && job.status === 'importing';

// Super-admin Imports page: the row badge for a pin check that didn't finish cleanly — busy, failed,
// or over the per-import lookup ceiling — with the full cause in its tooltip ("HTTP 401", "timeout",
// "busy: …"). The cause is super-admin only; orgs see just the generic sentence (pinPassError).
export const pinCheckBadge = (row) => {
  if (!row) return null;
  if (row.pinPassError) {
    const busy = String(row.pinPassCause || '').startsWith('busy');
    return { label: busy ? 'pins busy' : 'pins failed', title: row.pinPassCause || row.pinPassError };
  }
  const over = n(row.pinLookupsOverCap);
  if (over > 0) {
    return {
      label: 'pin cap',
      title: `${fmt(over)} ${over === 1 ? 'home was' : 'homes were'} not looked up: the import hit its pin lookup ceiling (PIN_PLACEMENT_MAX_HOMES, 25,000 by default)`,
    };
  }
  return null;
};
