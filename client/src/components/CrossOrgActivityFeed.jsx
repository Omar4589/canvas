import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
};

const DOT_CLS = {
  survey_submitted: 'bg-green-500',
  not_home: 'bg-blue-500',
  wrong_address: 'bg-red-500',
  lit_dropped: 'bg-purple-500',
};

function formatRelative(d) {
  if (!d) return '';
  const date = new Date(d);
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function CrossOrgActivityFeed({ limit = 50, refetchMs = 30_000 }) {
  const q = useQuery({
    queryKey: ['super-admin', 'activity-feed', limit],
    queryFn: () => api(`/super-admin/activity-feed?limit=${limit}`),
    refetchInterval: refetchMs,
    refetchIntervalInBackground: true,
  });

  if (q.isLoading) {
    return <div className="p-4 text-sm text-gray-500">Loading activity…</div>;
  }
  if (q.error) {
    return (
      <div className="p-4 text-sm text-red-600">
        Couldn&apos;t load activity: {q.error.message}
      </div>
    );
  }
  const events = q.data?.events || [];
  if (!events.length) {
    return (
      <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
        No activity yet.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-white">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 px-3 py-2 text-sm">
          <span
            className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              DOT_CLS[e.actionType] || 'bg-gray-400'
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">
                {ACTION_LABEL[e.actionType] || e.actionType}
              </span>
              {e.organization && (
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                  {e.organization.name}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-gray-500">
              {e.canvasser
                ? `${e.canvasser.firstName} ${e.canvasser.lastName}`
                : 'Unknown'}
              {e.household?.addressLine1 && (
                <>
                  {' '}
                  <span className="text-gray-400">·</span>{' '}
                  {e.household.addressLine1}
                  {e.household.city ? `, ${e.household.city}` : ''}
                </>
              )}
              {e.campaign?.name && (
                <>
                  {' '}
                  <span className="text-gray-400">·</span> {e.campaign.name}
                </>
              )}
            </div>
          </div>
          <div className="shrink-0 text-xs text-gray-500">
            {formatRelative(e.timestamp)}
          </div>
        </li>
      ))}
    </ul>
  );
}
