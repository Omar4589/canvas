import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

function formatDateTime(d, tz) {
  if (!d) return '—';
  return (
    formatInTz(
      d,
      tz,
      { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' },
      true
    ) || '—'
  );
}

function actionLabel(t) {
  switch (t) {
    case 'not_home':
      return 'Not home';
    case 'wrong_address':
      return 'Wrong address';
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

const ACTION_COLORS = {
  survey_submitted: '#22c55e',
  lit_dropped: '#a855f7',
  not_home: '#3b82f6',
  wrong_address: '#ef4444',
  note_added: '#9ca3af',
};

export default function CanvasserPingPanel({ activity, household, onOpenHousehold, onClose, tz }) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  if (!activity) return null;
  const dist = activity.distanceFromHouseMeters;
  const distFar = dist != null && dist > 100;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: ACTION_COLORS[activity.actionType] || '#888' }}
            />
            <span className="text-xs uppercase tracking-wide text-fg-muted">
              {actionLabel(activity.actionType)}
            </span>
          </div>
          {activity.canvasser && (
            <div className="mt-1 truncate font-medium text-fg">
              {activity.canvasser.firstName} {activity.canvasser.lastName}
            </div>
          )}
          <div className="text-xs text-fg-muted">{formatDateTime(activity.timestamp, zone)}</div>
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

      {household && (
        <div className="border-b border-border px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-fg-muted">House</div>
          <div className="mt-1 text-fg">{household.addressLine1}</div>
          <div className="text-xs text-fg-muted">
            {household.city}, {household.state} {household.zipCode}
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
        {activity.location?.accuracy != null && (
          <div className="text-xs text-fg-muted">
            GPS accuracy ±{Math.round(activity.location.accuracy)} m
          </div>
        )}
      </div>

      {household && onOpenHousehold && (
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => onOpenHousehold(household.id)}
            className="w-full rounded border border-border bg-card px-3 py-1.5 text-sm text-brand-accent hover:bg-sunken"
          >
            Open household
          </button>
        </div>
      )}
    </div>
  );
}
