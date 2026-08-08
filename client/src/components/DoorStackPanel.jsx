import { useMemo } from 'react';
import { formatInTz } from '../lib/datetime.js';

// Every door hiding under one map pin. The household symbol layer draws with
// icon-allow-overlap, so an 84-unit building used to render as 84 coincident
// icons that read as a single house — and a click resolved to whichever one
// Mapbox hit first, silently. This panel is the disambiguation: the doors are
// listed, counted, and individually openable.
//
// Presentational only — the caller owns selection and the detail panel.

const unitLabel = (h) => String(h.addressLine2 || '').trim() || h.addressLine1 || 'Door';

export default function DoorStackPanel({ doors, selectedId, onSelect, onClose, statusColors, statusLabels, tz }) {
  // One street line for the whole stack when the units agree; if an import
  // disagreed, say how many doors are here rather than picking one at random.
  const title = useMemo(() => {
    const lines = new Set(doors.map((d) => (d.addressLine1 || '').trim()).filter(Boolean));
    return lines.size === 1 ? [...lines][0] : `${doors.length} doors at one pin`;
  }, [doors]);

  const sorted = useMemo(
    () => [...doors].sort((a, b) => unitLabel(a).localeCompare(unitLabel(b), undefined, { numeric: true })),
    [doors]
  );

  const worked = doors.filter((d) => d.status && d.status !== 'unknocked').length;
  const first = doors[0];

  return (
    <div>
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">{title}</div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {first?.city ? `${first.city}, ${first.state} ${first.zipCode || ''}`.trim() : ''}
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            <strong className="tabular-nums text-fg">{doors.length.toLocaleString()}</strong> doors share this pin ·{' '}
            <span className="tabular-nums">{worked.toLocaleString()}</span> worked
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded p-1 text-fg-muted hover:bg-sunken hover:text-fg"
        >
          ✕
        </button>
      </div>
      <p className="border-b border-border bg-sunken px-4 py-2 text-[11px] leading-snug text-fg-muted">
        These doors are all pinned to the same spot, so the map draws them as one building. Pick one to open it.
      </p>
      <ul className="divide-y divide-border">
        {sorted.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onSelect(d.id)}
              className={
                'flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-sunken ' +
                (d.id === selectedId ? 'bg-brand-tint' : '')
              }
            >
              <span
                aria-hidden="true"
                style={{ background: statusColors[d.status] || statusColors.unknocked }}
                className="h-2.5 w-2.5 shrink-0 rounded-full"
              />
              <span className="min-w-0 flex-1 truncate text-fg">{unitLabel(d)}</span>
              <span className="shrink-0 text-xs text-fg-muted">
                {statusLabels[d.status] || 'Unknocked'}
                {d.lastActionAt ? ` · ${formatInTz(d.lastActionAt, tz, { month: 'numeric', day: 'numeric' })}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
