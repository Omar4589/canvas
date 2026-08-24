import { Fragment } from 'react';

// The floating "Move pin" card that sits over the map while a pin is being dragged — title, the
// one-line instruction with the address in bold, the amber "corrects the pin only" caveat, the
// inline error, Cancel / Save. Presentational: useMovePin owns the marker, the PATCH and the
// cache drops, and movePin.js owns every string in `copy`. Both the Map page and the Turf
// Cutting page render this one card; they differ only in where they pin it (className / style).
//
//   <MovePinCard copy={movePin.copy} error={movePin.error} saving={movePin.saving}
//                onCancel={movePin.cancel} onSave={movePin.save}
//                className="absolute right-3 top-3 z-10 w-72" />
const MovePinCard = ({ copy, error, saving, onCancel, onSave, className = '', style }) => {
  if (!copy) return null;
  return (
    <div style={style} className={`rounded-lg border border-border bg-card p-4 shadow-lg ${className}`}>
      <div className="text-sm font-semibold text-fg">{copy.title}</div>
      <p className="mt-1 text-xs text-fg-muted">
        {copy.body.map((seg, i) =>
          seg.strong ? <strong key={i}>{seg.text}</strong> : <Fragment key={i}>{seg.text}</Fragment>
        )}
      </p>
      <p className="mt-2 rounded border border-warning/30 bg-warning-tint px-2 py-1.5 text-[11px] leading-snug text-warning-fg">
        {copy.caveat}
      </p>
      {error && <div className="mt-2 text-xs text-danger">{error}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-sunken"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : copy.saveLabel}
        </button>
      </div>
    </div>
  );
};

export default MovePinCard;
