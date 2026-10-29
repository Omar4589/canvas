// The Voter-ID column picker shared by Early Voting, Do Not Contact and Saved Searches (from a list).
//
// Two states. After a preview, the inline form: "Matched on column [dropdown]", every column in the
// file offered, the one the server matched on selected; changing it re-runs the preview on that
// column. When the server could not detect a column at all (400 with the column list), the
// warning-box form: pick a column and press Match column. Both are the same control so the three
// pages cannot drift.
//
// The rule that matters is the caller's: the APPLY sends the column from the last preview
// RESPONSE (pv.idColumn), never a local dropdown value that may be newer than what was previewed.
//
// The warning box also says which tab of a workbook it read (`note`, from sheetNote), where column
// names belong and, when the server saw a title row, which row they seem to be in (`headerRowHint`);
// and it can come up with the last upload's column already chosen (`suggested`) — chosen, never
// matched: nothing runs until Match column.
import { rowOneLine, headerRowHintText } from '../lib/idListPreview.js';

const selectClass = 'rounded border border-border-strong bg-card text-fg';

// Which tab of a workbook the IDs came from (or, on a refusal, which tab was read), when it had others
// — the Voter Import's note. text-info-fg, not text-info: 12px text on the info tint needs it for
// contrast (4.24:1 → 5.49:1).
export const SheetNote = ({ note, className = '' }) => {
  if (!note) return null;
  return (
    <div className={`rounded border border-info/30 bg-info-tint px-3 py-2 text-xs text-info-fg ${className}`}>
      {note.lead} <strong>{note.sheetName}</strong> tab — the first tab in the file, and the only one read.{' '}
      {note.ignored} {note.tail}
    </div>
  );
};

export default function IdColumnPicker({
  columns = [],
  value = '',
  onChange,
  busy = false,
  undetected = false,
  onMatch,
  note = null,
  headerRowHint = null,
  suggested = null,
  excel = true,
}) {
  if (undetected) {
    return (
      <div className="mt-3 rounded border border-warning/30 bg-warning-tint p-3 text-xs text-warning-fg">
        {note && <SheetNote note={note} className="mb-2" />}
        Couldn&apos;t find a Voter ID column. {rowOneLine({ excel })}
        {headerRowHint ? ` ${headerRowHintText(headerRowHint)}` : ''}
        <p className="mt-1">Pick the column that holds Voter IDs:</p>
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
        {suggested && value === suggested && <p className="mt-1">Your last upload used {suggested}.</p>}
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
