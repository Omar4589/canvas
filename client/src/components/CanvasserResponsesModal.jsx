import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

const PAGE_SIZE = 50;

function formatAnswer(answer) {
  if (answer == null || answer === '') return <span className="text-fg-subtle">—</span>;
  if (Array.isArray(answer)) {
    if (!answer.length) return <span className="text-fg-subtle">—</span>;
    return answer.join(', ');
  }
  return String(answer);
}

function formatDateTime(d, tz) {
  if (!d) return '';
  return formatInTz(
    d,
    tz,
    { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    true
  );
}

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function ResponseCard({ r, tz }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium text-fg">
            {r.voter?.fullName || 'Unknown voter'}
          </div>
          <div className="text-xs text-fg-muted">
            {r.household
              ? `${r.household.addressLine1}, ${r.household.city}, ${r.household.state}`
              : 'No address'}
          </div>
        </div>
        <div className="text-right text-xs text-fg-muted">
          <div>{formatDateTime(r.submittedAt, tz)}</div>
          {r.surveyTemplate && (
            <div className="mt-0.5">
              {r.surveyTemplate.name} v{r.surveyTemplate.version}
            </div>
          )}
        </div>
      </div>
      {r.answers?.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {r.answers.map((a, i) => (
            <div key={i} className="rounded bg-sunken p-2">
              <dt className="text-xs uppercase tracking-wide text-fg-muted">{a.questionLabel}</dt>
              <dd className="mt-0.5 text-sm text-fg">{formatAnswer(a.answer)}</dd>
            </div>
          ))}
        </dl>
      )}
      {r.note && (
        <div className="mt-3 rounded border-l-2 border-brand-accent/40 bg-brand-tint px-3 py-2 text-sm text-fg-muted">
          <span className="text-xs font-medium uppercase tracking-wide text-brand-accent">Note: </span>
          {r.note}
        </div>
      )}
    </div>
  );
}

export default function CanvasserResponsesModal({ canvasser, dateRange, campaignId, onClose, tz }) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  const [skip, setSkip] = useState(0);
  const [accumulated, setAccumulated] = useState([]);

  useEffect(() => {
    setSkip(0);
    setAccumulated([]);
  }, [canvasser?.userId, dateRange?.from, dateRange?.to, campaignId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const userId = canvasser?.userId;
  const queryString = buildQuery({
    campaignId,
    from: dateRange?.from,
    to: dateRange?.to,
    skip,
    limit: PAGE_SIZE,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'reports',
      'canvasser-responses',
      userId,
      campaignId,
      dateRange?.from,
      dateRange?.to,
      skip,
    ],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/responses${queryString}`),
    enabled: !!userId,
  });

  useEffect(() => {
    if (!data?.responses) return;
    setAccumulated((prev) => {
      if (skip === 0) return data.responses;
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...data.responses.filter((r) => !seen.has(r.id))];
    });
  }, [data, skip]);

  if (!canvasser) return null;

  const total = data?.total ?? 0;
  const hasMore = accumulated.length < total;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-overlay/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-fg">
              {canvasser.firstName} {canvasser.lastName}
            </div>
            <div className="text-xs text-fg-muted">{canvasser.email}</div>
            <div className="mt-1 text-sm text-fg-muted">
              <span className="font-semibold">{total}</span>{' '}
              {total === 1 ? 'response' : 'responses'} in selected range
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
          {isLoading && skip === 0 && (
            <div className="text-sm text-fg-muted">Loading…</div>
          )}
          {error && (
            <div className="text-sm text-danger">Error: {error.message}</div>
          )}
          {!isLoading && !error && accumulated.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-sunken p-6 text-center text-sm text-fg-muted">
              No responses in this range.
            </div>
          )}
          {accumulated.map((r) => (
            <ResponseCard key={r.id} r={r} tz={zone} />
          ))}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => setSkip(skip + PAGE_SIZE)}
                disabled={isLoading}
                className="rounded border border-border bg-card px-4 py-1.5 text-sm text-fg-muted hover:bg-sunken disabled:opacity-50"
              >
                {isLoading ? 'Loading…' : `Load more (${total - accumulated.length} left)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
