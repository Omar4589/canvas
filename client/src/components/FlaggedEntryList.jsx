import { Link } from 'react-router-dom';
import { formatInTz } from '../lib/datetime.js';
import {
  REVIEW_STATUS_META,
  correctionContextText,
  isDowngradedCorrection,
  isPinDowngraded,
  pinCorrectionText,
} from '../lib/flags.js';
import FlagReasonBadges from './FlagReasonBadges.jsx';
import FlagReviewControl from './FlagReviewControl.jsx';

function houseLine(h) {
  if (!h) return '—';
  const l2 = h.addressLine2 ? ` ${h.addressLine2}` : '';
  return `${h.addressLine1 || ''}${l2}, ${h.city || ''} ${h.state || ''}`.trim();
}

// The Audit page drill-in: one card per flagged entry with reasons, a review control, and a
// "View on map" deep-link (carries the date window + canvasser so the map lands scoped).
// When `onToggleSelect` is provided each card grows a checkbox for bulk review (selection
// state lives on the page; `selectedIds` is a Set of actionIds).
export default function FlaggedEntryList({
  entries = [],
  tz,
  campaignId,
  dateFrom,
  dateTo,
  onReviewed,
  selectedIds = null,
  onToggleSelect = null,
}) {
  if (!entries.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center text-sm text-fg-muted">
        No flagged entries match these filters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((e) => {
        const status = e.review?.status || 'open';
        const meta = REVIEW_STATUS_META[status] || REVIEW_STATUS_META.open;
        const correction = correctionContextText(e);
        const mapHref =
          `/campaigns/${campaignId}/map?flag=1&focusActivityId=${e.actionId}` +
          `&userId=${e.userId}` +
          (dateFrom ? `&from=${dateFrom}` : '') +
          (dateTo ? `&to=${dateTo}` : '');
        const selected = !!selectedIds?.has(e.actionId);
        return (
          <div
            key={e.actionId}
            className={
              'rounded-lg border bg-card p-3 ' + (selected ? 'border-brand-600' : 'border-border')
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2.5">
                {onToggleSelect && (
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelect(e.actionId)}
                    aria-label="Select this flagged entry for bulk review"
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-border-strong text-brand-accent focus-visible:ring-ring"
                  />
                )}
                <div className="min-w-0">
                  <div className="font-medium text-fg">{e.canvasser?.name || 'Canvasser'}</div>
                  <div className="truncate text-sm text-fg-muted">{houseLine(e.household)}</div>
                  <div className="text-xs text-fg-subtle">
                    {formatInTz(
                      e.timestamp,
                      tz,
                      { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' },
                      true
                    ) || '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + meta.chip}>{meta.label}</span>
                <Link
                  to={mapHref}
                  className="rounded border border-border px-2 py-1 text-xs font-medium text-brand-accent hover:bg-sunken"
                >
                  View on map
                </Link>
              </div>
            </div>
            <div className="mt-2">
              <FlagReasonBadges reasons={e.reasons} />
            </div>
            {correction && (
              <div className="mt-1 text-xs text-fg-muted">
                {correction}
                {isDowngradedCorrection(e) ? ' · counted as low severity' : ''}
              </div>
            )}
            {pinCorrectionText(e) && (
              <div className="mt-1 text-xs text-fg-muted">
                {pinCorrectionText(e)}
                {isPinDowngraded(e) ? ' · counted as low severity' : ''}
              </div>
            )}
            <div className="mt-3 border-t border-border pt-3">
              <FlagReviewControl entry={e} tz={tz} onReviewed={onReviewed} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
