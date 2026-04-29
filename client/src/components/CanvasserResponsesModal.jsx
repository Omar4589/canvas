import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

const PAGE_SIZE = 50;

function formatAnswer(answer) {
  if (answer == null || answer === '') return <span className="text-gray-400">—</span>;
  if (Array.isArray(answer)) {
    if (!answer.length) return <span className="text-gray-400">—</span>;
    return answer.join(', ');
  }
  return String(answer);
}

function formatDateTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function ResponseCard({ r }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium text-gray-900">
            {r.voter?.fullName || 'Unknown voter'}
          </div>
          <div className="text-xs text-gray-500">
            {r.household
              ? `${r.household.addressLine1}, ${r.household.city}, ${r.household.state}`
              : 'No address'}
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          <div>{formatDateTime(r.submittedAt)}</div>
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
            <div key={i} className="rounded bg-gray-50 p-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">{a.questionLabel}</dt>
              <dd className="mt-0.5 text-sm text-gray-900">{formatAnswer(a.answer)}</dd>
            </div>
          ))}
        </dl>
      )}
      {r.note && (
        <div className="mt-3 rounded border-l-2 border-brand-300 bg-brand-50 px-3 py-2 text-sm text-gray-700">
          <span className="text-xs font-medium uppercase tracking-wide text-brand-700">Note: </span>
          {r.note}
        </div>
      )}
    </div>
  );
}

export default function CanvasserResponsesModal({ canvasser, dateRange, onClose }) {
  const [skip, setSkip] = useState(0);
  const [accumulated, setAccumulated] = useState([]);

  useEffect(() => {
    setSkip(0);
    setAccumulated([]);
  }, [canvasser?.userId, dateRange?.from, dateRange?.to]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const userId = canvasser?.userId;
  const queryString = buildQuery({
    from: dateRange?.from,
    to: dateRange?.to,
    skip,
    limit: PAGE_SIZE,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'canvasser-responses', userId, dateRange?.from, dateRange?.to, skip],
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
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-gray-900">
              {canvasser.firstName} {canvasser.lastName}
            </div>
            <div className="text-xs text-gray-500">{canvasser.email}</div>
            <div className="mt-1 text-sm text-gray-700">
              <span className="font-semibold">{total}</span>{' '}
              {total === 1 ? 'response' : 'responses'} in selected range
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
          {isLoading && skip === 0 && (
            <div className="text-sm text-gray-500">Loading…</div>
          )}
          {error && (
            <div className="text-sm text-red-600">Error: {error.message}</div>
          )}
          {!isLoading && !error && accumulated.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
              No responses in this range.
            </div>
          )}
          {accumulated.map((r) => (
            <ResponseCard key={r.id} r={r} />
          ))}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => setSkip(skip + PAGE_SIZE)}
                disabled={isLoading}
                className="rounded border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
