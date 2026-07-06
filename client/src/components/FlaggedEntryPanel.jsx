import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import { FAR_WARN_M, primaryReason, reasonColor } from '../lib/flags.js';
import FlagReasonBadges from './FlagReasonBadges.jsx';
import FlagReviewControl from './FlagReviewControl.jsx';

function actionLabel(t) {
  switch (t) {
    case 'not_home':
      return 'Not home';
    case 'wrong_address':
      return 'Wrong address';
    case 'refused':
      return 'Refused';
    case 'survey_submitted':
      return 'Survey submitted';
    case 'lit_dropped':
      return 'Lit dropped';
    case 'note_added':
      return 'Note added';
    default:
      return t || '—';
  }
}

// The Map's flagged-entry review panel. Mirrors CanvasserPingPanel's layout (action +
// canvasser + time, house, distance, GPS accuracy) and adds the reason badges + the shared
// review control. `entry` is a /admin/reports/flags entry.
export default function FlaggedEntryPanel({ entry, household, onOpenHousehold, onClose, onReviewed, tz }) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  if (!entry) return null;

  const dist = entry.distanceFromHouseMeters;
  const distFar = dist != null && dist > FAR_WARN_M;
  const accentColor = reasonColor(primaryReason(entry)?.type);
  const h = household || entry.household;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accentColor }} />
            <span className="text-xs uppercase tracking-wide text-fg-muted">
              Flagged · {actionLabel(entry.actionType)}
            </span>
          </div>
          {entry.canvasser?.name && <div className="mt-1 truncate font-medium text-fg">{entry.canvasser.name}</div>}
          <div className="text-xs text-fg-muted">
            {formatInTz(
              entry.timestamp,
              zone,
              { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' },
              true
            ) || '—'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
          </svg>
        </button>
      </div>

      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">Why it's flagged</div>
        <FlagReasonBadges reasons={entry.reasons} />
      </div>

      {h && (
        <div className="border-b border-border px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-fg-muted">House</div>
          <div className="mt-1 text-fg">{h.addressLine1}</div>
          <div className="text-xs text-fg-muted">
            {h.city}, {h.state} {h.zipCode}
          </div>
        </div>
      )}

      <div className="border-b border-border px-4 py-3 text-sm">
        <div className="text-xs uppercase tracking-wide text-fg-muted">Distance</div>
        {dist == null ? (
          <div className="mt-1 text-fg-muted">unknown</div>
        ) : (
          <div className={'mt-1 font-medium ' + (distFar ? 'text-danger' : 'text-fg')}>
            {Math.round(dist)} m from house{distFar ? ' — far' : ''}
          </div>
        )}
        {entry.location?.accuracy != null && (
          <div className="text-xs text-fg-muted">GPS accuracy ±{Math.round(entry.location.accuracy)} m</div>
        )}
        {entry.wasOfflineSubmission && (
          <div className="mt-1 text-xs text-fg-subtle">Synced offline — timestamp is the device's record time.</div>
        )}
      </div>

      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">Review</div>
        <FlagReviewControl entry={entry} tz={zone} onReviewed={onReviewed} compact />
      </div>

      {h && onOpenHousehold && (
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => onOpenHousehold(h.id)}
            className="w-full rounded border border-border bg-card px-3 py-1.5 text-sm text-brand-accent hover:bg-sunken"
          >
            Open household
          </button>
        </div>
      )}
    </div>
  );
}
