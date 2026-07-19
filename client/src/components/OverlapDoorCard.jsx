import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors.js';
import { formatInTz } from '../lib/datetime.js';

// CanvassActivity actionType → door-status key (for color/label).
const ACTION_STATUS = {
  survey_submitted: 'surveyed',
  not_home: 'not_home',
  wrong_address: 'wrong_address',
  refused: 'refused',
  restricted: 'restricted',
  lit_dropped: 'lit_dropped',
};

export function ActionDot({ actionType }) {
  const s = ACTION_STATUS[actionType] || 'unknocked';
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
      {STATUS_LABELS[s] || actionType}
    </span>
  );
}

// One colliding door: address, then each pass with the canvassers who worked it.
//
// Shared by the Timeline's reconciliation list (fed by the date-WINDOWED /overlaps) and the
// standalone Overlaps page (fed by the ANCHORED /overlap-doors). Both payloads carry
// `{ household, passes[{ roundLabel, canvassers[{ userId, firstName, lastName, actionType }] }] }`
// — the anchored one adds `lastAt` + `inRange`, which render only when present. That superset is
// deliberate: it is what lets one card serve two engines without an adapter.
//
// `tz` enables the knock timestamp; `onViewMap` (optional) renders the map deep-link.
export default function OverlapDoorCard({ door, tz, onViewMap }) {
  const h = door.household;
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">
            {h ? (
              <>
                {h.addressLine1}
                {h.addressLine2 ? `, ${h.addressLine2}` : ''}
              </>
            ) : (
              'Door outside the current view'
            )}
          </div>
          {h && (
            <div className="text-xs text-fg-muted">
              {[h.city, h.state, h.zipCode].filter(Boolean).join(', ')}
            </div>
          )}
        </div>
        {onViewMap && h && (
          <button
            type="button"
            onClick={() => onViewMap(door)}
            className="shrink-0 text-xs font-medium text-brand-accent hover:underline"
          >
            View on map
          </button>
        )}
      </div>

      {door.passes.map((p) => (
        <div key={p.passId || 'legacy'} className="mt-1.5 text-xs">
          <span className="font-medium text-fg-muted">{p.roundLabel}</span>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {p.canvassers.map((c, i) => (
              <span key={`${c.userId}-${i}`} className="flex items-center gap-1.5 text-fg">
                {c.firstName} {c.lastName}
                <ActionDot actionType={c.actionType} />
                {/* Anchored payload only: when this knock is the one OUTSIDE the chosen dates, say
                    so — it is the knock that made this a collision the admin couldn't otherwise see. */}
                {c.lastAt && (
                  <span className={c.inRange === false ? 'text-fg-muted italic' : 'text-fg-muted'}>
                    {formatInTz(c.lastAt, tz, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }, false)}
                    {c.inRange === false ? ' · earlier' : ''}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
