import { useState } from 'react';
import { api } from '../api/client.js';
import { formatInTz } from '../lib/datetime.js';
import { REVIEW_STATUS_META } from '../lib/flags.js';

// Shared review control used by the Map flag panel AND the Audit drill-in list. POSTs the
// reviewer's decision to /admin/reports/flags/review and calls onReviewed(review, entry) so
// the parent can update/invalidate. "Open" is the absence of a decision; Reopen deletes it.
const CHOICES = [
  { status: 'reviewed', label: 'Reviewed', active: 'border-fg-muted bg-sunken text-fg' },
  { status: 'dismissed', label: 'Dismiss', active: 'border-fg-subtle bg-sunken text-fg-muted' },
  { status: 'confirmed', label: 'Confirm issue', active: 'border-danger bg-danger-tint text-danger' },
];

export default function FlagReviewControl({ entry, tz, onReviewed, compact = false }) {
  const current = entry.review?.status || 'open';
  const [note, setNote] = useState(entry.review?.note || '');
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  async function submit(status) {
    if (saving) return;
    setSaving(status);
    setError(null);
    try {
      const res = await api('/admin/reports/flags/review', {
        method: 'POST',
        body: {
          actionModel: entry.actionModel,
          actionId: entry.actionId,
          status,
          note: status === 'open' ? null : note.trim() || null,
          reasonsAtReview: (entry.reasons || []).map((r) => r.type),
        },
      });
      onReviewed?.(res.review, entry);
    } catch (err) {
      setError(err?.message || 'Could not save the review.');
    } finally {
      setSaving(null);
    }
  }

  const reviewedLine =
    current !== 'open' && entry.review?.reviewedByName
      ? `${REVIEW_STATUS_META[current]?.label || current} by ${entry.review.reviewedByName}` +
        (entry.review.reviewedAt
          ? ` · ${formatInTz(entry.review.reviewedAt, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }, true) || ''}`
          : '')
      : null;

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)…"
        rows={compact ? 2 : 2}
        className="w-full resize-none rounded border border-border bg-card px-2 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <div className="flex flex-wrap gap-1.5">
        {CHOICES.map((c) => {
          const isActive = current === c.status;
          return (
            <button
              key={c.status}
              type="button"
              disabled={!!saving}
              onClick={() => submit(c.status)}
              className={
                'rounded border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ' +
                (isActive ? c.active : 'border-border bg-card text-fg-muted hover:bg-sunken')
              }
            >
              {saving === c.status ? 'Saving…' : c.label}
            </button>
          );
        })}
        {current !== 'open' && (
          <button
            type="button"
            disabled={!!saving}
            onClick={() => submit('open')}
            className="rounded border border-transparent px-2 py-1 text-xs font-medium text-brand-accent hover:underline disabled:opacity-50"
          >
            {saving === 'open' ? 'Reopening…' : 'Reopen'}
          </button>
        )}
      </div>
      {reviewedLine && <div className="text-xs text-fg-subtle">{reviewedLine}</div>}
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}
