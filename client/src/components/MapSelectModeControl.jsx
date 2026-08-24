import Segmented from './ui/Segmented.jsx';

// The "Select doors" pill in the map's top-left control cluster, and the mode panel it expands
// into. That slot is the one both pages already own on every screen — it exists before a cut on
// Turf Cutting and it survives fullscreen on both — so the way in never depends on a book, a
// selection, or a panel being open.
//
// Chrome matches the fullscreen / style-picker buttons beside it (bg-card/95 + backdrop-blur over
// the basemap, h-10 so the row lines up). Presentational: the page owns select mode, the hook owns
// the drag.

const TOOL_LABELS = { pan: 'Pan', lasso: 'Lasso', box: 'Box' };

// One line naming the gesture the current tool gives you.
const TOOL_HINTS = {
  lasso: 'Drag a shape around the doors you mean.',
  box: 'Drag a box around the doors you mean.',
  pan: 'Drag to move the map. Pick Lasso to start selecting doors.',
};

export default function MapSelectModeControl({
  active = false,
  onActivate,
  onDone,
  tool = 'lasso', // Lasso is the default tool — the freehand shape is the whole point
  onToolChange,
  tools = ['pan', 'lasso', 'box'],
  panning = false, // Space is held: the map has the drag back for as long as it is
  disabled = false,
  disabledReason = null,
  className = '',
}) {
  if (!active) {
    return (
      <button
        type="button"
        onClick={onActivate}
        disabled={disabled}
        title={disabled ? disabledReason || undefined : 'Pick doors on the map to mark restricted'}
        className={`inline-flex h-10 items-center rounded-md border border-border bg-card/95 px-3 text-sm font-medium text-fg shadow-lg backdrop-blur transition-colors hover:bg-sunken disabled:opacity-50 ${className}`}
      >
        Select doors
      </button>
    );
  }

  return (
    <div
      className={`w-64 rounded-lg border border-border bg-card/95 p-2.5 shadow-lg backdrop-blur ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Select doors</span>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-border-strong bg-card px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:bg-sunken"
        >
          Done
        </button>
      </div>
      <Segmented
        size="sm"
        className="mt-2"
        value={tool}
        onChange={onToolChange}
        options={tools.map((t) => ({ value: t, label: TOOL_LABELS[t] || t }))}
      />
      <p className="mt-2 text-xs leading-relaxed text-fg-muted">
        {panning ? 'Panning — release Space to draw again.' : TOOL_HINTS[tool] || TOOL_HINTS.lasso}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
        Click a dot to toggle one door — a building pin toggles every unit on it. ⌥-drag subtracts, hold Space
        to pan, Esc leaves.
      </p>
    </div>
  );
}
