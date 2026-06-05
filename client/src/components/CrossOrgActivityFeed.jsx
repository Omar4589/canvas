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
    return <div className="p-4 text-sm text-fg-muted">Loading activity…</div>;
  }
  if (q.error) {
    return (
      <div className="p-4 text-sm text-danger">
        Couldn&apos;t load activity: {q.error.message}
      </div>
    );
  }
  const events = q.data?.events || [];
  if (!events.length) {
    return (
      <div className="rounded-md border border-dashed border-border bg-sunken p-4 text-center text-sm text-fg-muted">
        No activity yet.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 px-3 py-2 text-sm">
          <span
            className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
              DOT_CLS[e.actionType] || 'bg-gray-400'
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-fg">
                {ACTION_LABEL[e.actionType] || e.actionType}
              </span>
              {e.organization && (
                <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  {e.organization.name}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-fg-muted">
              {e.canvasser
                ? `${e.canvasser.firstName} ${e.canvasser.lastName}`
                : 'Unknown'}
              {e.household?.addressLine1 && (
                <>
                  {' '}
                  <span className="text-fg-subtle">·</span>{' '}
                  {e.household.addressLine1}
                  {e.household.city ? `, ${e.household.city}` : ''}
                </>
              )}
              {e.campaign?.name && (
                <>
                  {' '}
                  <span className="text-fg-subtle">·</span> {e.campaign.name}
                </>
              )}
            </div>
          </div>
          <div className="shrink-0 text-xs text-fg-muted">
            {formatRelative(e.timestamp)}
          </div>
        </li>
      ))}
    </ul>
  );
}
