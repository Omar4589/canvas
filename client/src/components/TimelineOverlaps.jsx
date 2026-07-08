import { useState } from 'react';
import Card from './ui/Card.jsx';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors.js';

// CanvassActivity actionType → door-status key (for color/label).
const ACTION_STATUS = {
  survey_submitted: 'surveyed',
  not_home: 'not_home',
  wrong_address: 'wrong_address',
  refused: 'refused',
  restricted: 'restricted',
  lit_dropped: 'lit_dropped',
};

function ActionDot({ actionType }) {
  const s = ACTION_STATUS[actionType] || 'unknocked';
  return (
    <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
      {STATUS_LABELS[s] || actionType}
    </span>
  );
}

// Reconciliation line (sum-of-canvassers vs billable; the gap = overlap doors) + an expandable list
// of the range's colliding doors. This is the first WEB overlaps surface (mobile already had one).
// `note` (optional) renders muted under the line — used when a coordinator filter is active,
// since these totals are campaign-wide and don't follow that filter.
export default function TimelineOverlaps({ data, note }) {
  const [open, setOpen] = useState(false);
  const grand = data?.grandKnocks || 0;
  const billable = data?.billableKnocks || 0;
  const overlapDoors = data?.overlapDoors || 0;
  const nCanvassers = data?.canvassers?.length || 0;
  const overlaps = data?.overlaps || [];
  // The card list truncates server-side (200 worst-first); overlapCount is the true total.
  const totalCards = data?.overlapCount ?? overlaps.length;

  if (!nCanvassers) return null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-fg">
          <span className="font-semibold">{grand.toLocaleString()}</span> knocks across{' '}
          <span className="font-semibold">{nCanvassers}</span> canvasser{nCanvassers === 1 ? '' : 's'}
          {overlapDoors > 0 ? (
            <>
              {' · '}
              <span className="font-semibold text-warning-fg">{overlapDoors.toLocaleString()}</span>{' '}
              overlap door-pass{overlapDoors === 1 ? '' : 'es'} (billed once →{' '}
              <span className="font-semibold">{billable.toLocaleString()}</span>)
            </>
          ) : (
            <span className="text-fg-muted"> · no overlaps</span>
          )}
        </div>
        {overlaps.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-border-strong px-2 py-1 text-xs font-medium text-fg-muted hover:bg-sunken"
          >
            {open
              ? 'Hide'
              : totalCards > overlaps.length
                ? `Review ${overlaps.length} of ${totalCards} overlap doors`
                : `Review ${overlaps.length} overlap door${overlaps.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
      {note ? <div className="mt-1 text-xs text-fg-muted">{note}</div> : null}
      {open && totalCards > overlaps.length ? (
        <div className="mt-1 text-xs text-fg-muted">
          Showing the {overlaps.length} most-collided doors of {totalCards} in this range.
        </div>
      ) : null}

      {open && overlaps.length > 0 && (
        <div className="mt-3 divide-y divide-border border-t border-border">
          {overlaps.map((o) => (
            <div key={o.household.id} className="py-2.5">
              <div className="text-sm font-medium text-fg">
                {o.household.addressLine1}
                {o.household.addressLine2 ? `, ${o.household.addressLine2}` : ''}
              </div>
              <div className="text-xs text-fg-muted">
                {[o.household.city, o.household.state, o.household.zipCode].filter(Boolean).join(', ')}
              </div>
              {o.passes.map((p) => (
                <div key={p.passId || 'legacy'} className="mt-1.5 text-xs">
                  <span className="font-medium text-fg-muted">{p.roundLabel}</span>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {p.canvassers.map((c, i) => (
                      <span key={`${c.userId}-${i}`} className="flex items-center gap-1.5 text-fg">
                        {c.firstName} {c.lastName}
                        <ActionDot actionType={c.actionType} />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
