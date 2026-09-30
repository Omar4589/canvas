// The Voter-ID column picker shared by Early Voting, Do Not Contact and Walk lists (from CSV).
//
// Two states. After a preview, the inline form: "Matched on column [dropdown]", every column in the
// file offered, the one the server matched on selected; changing it re-runs the preview on that
// column. When the server could not detect a column at all (400 with the column list), the
// warning-box form: pick a column and press Match column. Both are the same control so the three
// pages cannot drift.
//
// The rule that matters is the caller's: the APPLY sends the column from the last preview
// RESPONSE (pv.idColumn), never a local dropdown value that may be newer than what was previewed.

const selectClass = 'rounded border border-border-strong bg-card text-fg';

export default function IdColumnPicker({ columns = [], value = '', onChange, busy = false, undetected = false, onMatch }) {
  if (undetected) {
    return (
      <div className="mt-3 rounded border border-warning/30 bg-warning-tint p-3 text-xs text-warning-fg">
        Couldn&apos;t find a Voter ID column. Pick the column that holds Voter IDs:
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={busy}
            aria-label="Voter ID column"
            className={`${selectClass} px-2 py-1 text-sm`}
          >
            <option value="">— Choose column —</option>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={onMatch}
            disabled={!value || busy}
            className="rounded border border-border-strong px-2 py-1 text-sm font-medium hover:bg-card disabled:opacity-50"
          >
            Match column
          </button>
        </div>
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      Matched on column
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
        aria-label="Voter ID column"
        className={`${selectClass} px-1.5 py-0.5 font-mono text-xs`}
      >
        {columns.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </span>
  );
}
