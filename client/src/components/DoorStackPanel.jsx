import { useMemo } from 'react';
import { formatInTz } from '../lib/datetime.js';
import { baseAddressOf } from '../lib/streetName.js';
import { stackKind, addressGroups } from '../lib/buildings.js';

// Every door hiding under one map pin. The household symbol layer draws with
// icon-allow-overlap, so an 84-unit building used to render as 84 coincident
// icons that read as a single house — and a click resolved to whichever one
// Mapbox hit first, silently. This panel is the disambiguation: the doors are
// listed, counted, and individually openable.
//
// Presentational only — the caller owns selection and the detail panel.
//
// Three kinds of list, one panel:
//   near     — a click that hit separate houses a metre apart (`near`): "N doors near here — pick one";
//   unplaced — different homes that share one map spot (lib/buildings.js stackKind, from the payload's
//              pinSuspect): grouped by street address, each row with its own Move pin (`onMovePin(door)`);
//   building — doors on one pin that belong together, as before.

const unitLabel = (h) => String(h.addressLine2 || '').trim() || h.addressLine1 || 'Door';
const fullLine = (h) => [h.addressLine1, h.addressLine2].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || 'Door';

export default function DoorStackPanel({ doors, selectedId, onSelect, onClose, onMovePin, near = false, statusColors, statusLabels, tz }) {
  // One street line for the whole stack when the units agree; if an import
  // disagreed, say how many doors are here rather than picking one at random.
  //
  // multiStreet drives the honest explainer below, mirroring the SERVER classifier's verdict
  // (utils/stackedPins.js) — both halves of its rule, or the amber note warns about pins the
  // repair won't touch and stops being trustworthy:
  //   · BASE STREETS, never raw lines: real files bake units into line1 ("845 Collier Ct
  //     Apt 104" vs "Apt 204"), so a genuine tower's raw lines all differ while its street
  //     is one.
  //   · The DOMINANT-STREET rule: a pin where one street holds an outright majority is a real
  //     building carrying a few odd rows (an 89-door park with two typo'd lots), not a
  //     placeholder — the repair checks only the strays, so the panel must not cry placeholder.
  const { title, multiStreet } = useMemo(() => {
    const lines = new Set(doors.map((d) => (d.addressLine1 || '').trim()).filter(Boolean));
    const freq = new Map();
    for (const d of doors) {
      // Base address, not street: two towers or 18 same-street houses on one dot both
      // deserve the warning; 89 lots of "900 Aqua Isles Blvd" do not.
      const s = baseAddressOf(d.addressLine1);
      freq.set(s, (freq.get(s) || 0) + 1);
    }
    const modal = Math.max(0, ...freq.values());
    return {
      title: lines.size === 1 ? [...lines][0] : `${doors.length} doors at one pin`,
      multiStreet: freq.size > 1 && modal / doors.length <= 0.5,
    };
  }, [doors]);

  // The flags decide (lib/buildings.js stackKind); multiStreet stays the fallback for a stack whose doors
  // carry no flags at all — a campaign imported before the address lookup existed.
  const kind = near ? 'near' : stackKind(doors);
  const groups = useMemo(() => (kind === 'unplaced' ? addressGroups(doors) : null), [kind, doors]);
  const heading =
    kind === 'near' ? `${doors.length} doors near here` : kind === 'unplaced' ? `${doors.length} homes at one map spot` : title;

  const sorted = useMemo(
    () => [...doors].sort((a, b) => unitLabel(a).localeCompare(unitLabel(b), undefined, { numeric: true })),
    [doors]
  );

  // One row: the door's status and last visit, plus — on a spot of different homes — its own Move pin.
  const row = (d, label) => (
    <li key={d.id} className={'flex items-center ' + (d.id === selectedId ? 'bg-brand-tint' : '')}>
      <button
        type="button"
        onClick={() => onSelect(d.id)}
        className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left text-sm hover:bg-sunken"
      >
        <span
          aria-hidden="true"
          style={{ background: statusColors[d.status] || statusColors.unknocked }}
          className="h-2.5 w-2.5 shrink-0 rounded-full"
        />
        <span className="min-w-0 flex-1 truncate text-fg">{label}</span>
        <span className="shrink-0 text-xs text-fg-muted">
          {statusLabels[d.status] || 'Unknocked'}
          {d.lastActionAt ? ` · ${formatInTz(d.lastActionAt, tz, { month: 'numeric', day: 'numeric' })}` : ''}
        </span>
      </button>
      {kind === 'unplaced' && onMovePin && (
        <button
          type="button"
          onClick={() => onMovePin(d)}
          className="mr-3 shrink-0 rounded border border-border-strong px-1.5 py-0.5 text-[11px] font-medium text-fg-muted hover:bg-sunken"
        >
          Move pin
        </button>
      )}
    </li>
  );

  const worked = doors.filter((d) => d.status && d.status !== 'unknocked').length;
  const first = doors[0];

  return (
    <div>
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">{heading}</div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {first?.city ? `${first.city}, ${first.state} ${first.zipCode || ''}`.trim() : ''}
          </div>
          <div className="mt-1 text-xs text-fg-muted">
            <strong className="tabular-nums text-fg">{doors.length.toLocaleString()}</strong>{' '}
            {kind === 'near' ? 'doors' : kind === 'unplaced' ? 'homes share this spot' : 'doors share this pin'} ·{' '}
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
      {kind === 'near' ? (
        <p className="border-b border-border bg-sunken px-4 py-2 text-[11px] leading-snug text-fg-muted">
          These doors sit close together on the map. Pick one to open it.
        </p>
      ) : kind === 'unplaced' ? (
        <p className="border-b border-warning/30 bg-warning-tint px-4 py-2 text-[11px] leading-snug text-warning-fg">
          These are different homes that share one map spot. Move each pin to its house, or mark it{' '}
          <strong>Looks right</strong> in Pin Fixes if it really is here.
        </p>
      ) : multiStreet ? (
        <p className="border-b border-warning/30 bg-warning-tint px-4 py-2 text-[11px] leading-snug text-warning-fg">
          These doors have <strong>different addresses</strong> but identical map coordinates — usually a
          placeholder pin the voter file stamped on addresses it couldn&apos;t place, not a real building. The doors
          are real and walkable; the dot is what&apos;s wrong. An import looks these homes up by their own address and
          lists the ones it can&apos;t place in <strong>Pin Fixes</strong> (for an older import, import the file
          again); <strong>Move pin</strong> on each door places one by hand.
        </p>
      ) : (
        <p className="border-b border-border bg-sunken px-4 py-2 text-[11px] leading-snug text-fg-muted">
          These doors are all pinned to the same spot, so the map draws them as one building. Pick one to open it.
        </p>
      )}
      {groups ? (
        <ul className="divide-y divide-border">
          {groups.map((g) =>
            g.units.length === 1 ? (
              row(g.units[0], fullLine(g.units[0]))
            ) : (
              <li key={g.base}>
                <div className="bg-sunken px-4 py-1 text-[11px] font-semibold text-fg-muted">
                  {g.address} · {g.units.length} units
                </div>
                <ul className="divide-y divide-border">{g.units.map((d) => row(d, unitLabel(d)))}</ul>
              </li>
            )
          )}
        </ul>
      ) : (
        <ul className="divide-y divide-border">{sorted.map((d) => row(d, unitLabel(d)))}</ul>
      )}
    </div>
  );
}
