import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz, formatDateInTz } from '../lib/datetime.js';
import {
  ACCURACY_CIRCLE_CAPTION,
  correctionContextText,
  farDowngradeLines,
  farLabelState,
  formatDistanceImperial,
  gpsAccuracyText,
  hasUsableAccuracy,
  pinCorrectionText,
  pinMovedAfterReview,
  pinPrecisionText,
  primaryReason,
  reasonColor,
} from '../lib/flags.js';
import { ACCURACY_RING_MAX_M, ringRadiusM } from '../lib/accuracyRing.js';
import FlagReasonBadges from './FlagReasonBadges.jsx';
import FlagReviewControl from './FlagReviewControl.jsx';
import FlagLegend from './FlagLegend.jsx';
import { actionLabel } from '../lib/statusColors.js';


// The Map's flagged-entry review panel. Mirrors CanvasserPingPanel's layout (action +
// canvasser + time, house, distance, GPS accuracy) and adds the reason badges + the shared
// review control. `entry` is a /admin/reports/flags entry.
export default function FlaggedEntryPanel({ entry, household, onOpenHousehold, onClose, onReviewed, tz }) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  if (!entry) return null;

  const dist = entry.distanceFromHouseMeters;
  // "far" only when the audit says so: its own far reason, never the raw distance (the panel used
  // to call any knock past ~250 ft far, even one the phone's accuracy explained).
  const farState = farLabelState(entry);
  const acc = entry.location?.accuracy;
  const accuracyLine = gpsAccuracyText(dist, acc);
  const accentColor = reasonColor(primaryReason(entry)?.type);
  const h = household || entry.household;
  const pinPrecision = pinPrecisionText(h, (d) => formatDateInTz(d, zone));
  // The pin may have been corrected since this door was recorded. `dist` is frozen against the
  // pin as it stood then, while the map's leader line is drawn to the pin as it stands NOW — so
  // whenever the two differ, both numbers are labelled rather than letting the panel and the map
  // silently disagree.
  const pinDist = (entry.reasons || []).find((r) => r.type === 'far')?.detail?.pinCorrectedMeters ?? null;

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
              { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' },
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
        <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-fg-muted">
          Why it's flagged <FlagLegend />
        </div>
        <FlagReasonBadges reasons={entry.reasons} />
      </div>

      {h && (
        <div className="border-b border-border px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-fg-muted">House</div>
          <div className="mt-1 text-fg">{h.addressLine1}</div>
          <div className="text-xs text-fg-muted">
            {h.city}, {h.state} {h.zipCode}
          </div>
          {pinPrecision && (
            <div className={'mt-1.5 text-xs ' + (h.locationConfirmedAt ? 'text-fg-muted' : 'text-warning-fg')}>{pinPrecision}</div>
          )}
        </div>
      )}

      <div className="border-b border-border px-4 py-3 text-sm">
        <div className="text-xs uppercase tracking-wide text-fg-muted">Distance</div>
        {dist == null ? (
          <div className="mt-1 text-fg-muted">unknown</div>
        ) : (
          <div className={'mt-1 font-medium ' + (farState === 'far' ? 'text-danger' : 'text-fg')}>
            {formatDistanceImperial(dist)} from {pinDist == null ? 'house' : 'the pin at the time'}
            {farState === 'far' ? ' — far' : farState === 'low' ? ' — far, flagged low' : ''}
          </div>
        )}
        {accuracyLine && <div className="text-xs text-fg-muted">{accuracyLine}</div>}
        {hasUsableAccuracy(acc) && acc > ACCURACY_RING_MAX_M && (
          <div className="text-xs text-fg-muted">Too wide to draw on the map</div>
        )}
        {ringRadiusM(acc) != null && <div className="mt-1 text-xs text-fg-muted">{ACCURACY_CIRCLE_CAPTION}</div>}
        {pinDist != null && (
          <div className="mt-0.5 font-medium text-fg">
            {formatDistanceImperial(pinDist)} from the pin's current spot
          </div>
        )}
        {correctionContextText(entry) && (
          <div className="mt-1 text-xs text-fg-muted">{correctionContextText(entry)}</div>
        )}
        {pinCorrectionText(entry) && (
          <div className="mt-1 text-xs text-fg-muted">{pinCorrectionText(entry)}</div>
        )}
        {farDowngradeLines(entry).map((t) => (
          <div key={t} className="mt-1 text-xs text-fg-muted">
            {t}
          </div>
        ))}
        {pinMovedAfterReview(entry) && (
          <div className="mt-1 text-xs text-fg-subtle">The pin was moved after this was reviewed.</div>
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
