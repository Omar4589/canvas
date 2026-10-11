import { Fragment } from 'react';

// Pin Fixes' "Place along the street" rail (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.3): replaces the
// list while placing. The homes in order with the current one highlighted, the sentence for the armed home
// (movePin.js placeAtCopy), the save's error, and Skip / Back / Exit. Presentational: the page owns the
// mode, the map click (useMovePin's click mode) and the camera.
//
//   placeMode  { title, rows, index, placed: [rowKey] }    copy   movePin.clickCopy (null when not armed)
//   saving     a click is being saved                       error  movePin.error
//   onSkip · onBack · onExit · onPick(index) · onResume
const PlaceAlongRail = ({ placeMode, copy, saving = false, error = null, onSkip, onBack, onExit, onPick, onResume }) => {
  if (!placeMode) return null;
  const { rows, index, placed = [] } = placeMode;
  const done = index >= rows.length;
  const current = done ? null : rows[index];
  const placedSet = new Set(placed);
  return (
    <div>
      <div className="border-b border-border p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">Place along the street</div>
        <div className="mt-1 text-sm font-semibold text-fg">
          {done
            ? 'All done'
            : `Placing · ${current.street || placeMode.title} · ${(index + 1).toLocaleString()} of ${rows.length.toLocaleString()}`}
        </div>
        {done ? (
          <p className="mt-1 text-xs text-fg-muted">
            {placedSet.size.toLocaleString()} placed
            {rows.length - placedSet.size > 0 ? ` · ${(rows.length - placedSet.size).toLocaleString()} skipped` : ''}.
            Skipped homes stay in Pin Fixes.
          </p>
        ) : copy ? (
          <p className="mt-1 text-xs text-fg-muted">
            {copy.body.map((seg, i) =>
              seg.strong ? <strong key={i}>{seg.text}</strong> : <Fragment key={i}>{seg.text}</Fragment>
            )}{' '}
            The map is in satellite view; house numbers of the street&apos;s placed homes are labelled.
          </p>
        ) : (
          <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
            Paused.
            <button type="button" onClick={onResume} className="font-semibold text-brand-accent hover:underline">
              Resume
            </button>
          </div>
        )}
        {saving && <div className="mt-1 text-xs text-fg-muted">Saving…</div>}
        {error && <div className="mt-1 text-xs text-danger">{error}</div>}
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={saving || index <= 0}
            className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={saving || done}
            className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onExit}
            disabled={saving}
            className="ml-auto rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {done ? 'Done' : 'Exit'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">
          Back re-arms the previous home: click its right roof to move it again. Esc exits.
        </p>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r, i) => (
          <button
            key={r.rowKey}
            type="button"
            onClick={() => onPick?.(i)}
            disabled={saving}
            className={
              'flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-sunken ' +
              (i === index ? 'bg-brand-tint/60' : '')
            }
          >
            <span className="w-4 shrink-0 text-xs text-brand-accent">{placedSet.has(r.rowKey) ? '✓' : ''}</span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-fg">{r.label}</span>
              {r.sub && <span className="block truncate text-[11px] text-fg-subtle">{r.sub}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PlaceAlongRail;
