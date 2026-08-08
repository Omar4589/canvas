import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { ACTION_LABELS } from '../lib/statusColors.js';


const DOT_CLS = {
  survey_submitted: 'bg-green-500',
  not_home: 'bg-blue-500',
  wrong_address: 'bg-red-500',
  refused: 'bg-amber-500',
  restricted: 'bg-slate-600',
  no_soliciting: 'bg-pink-600',
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
  const navigate = useNavigate();
  // "Load older" pages accumulate below the live window (the feed's `before` param mirrors
  // `since`). The live page keeps polling; older pages are static history. Dedup by id where the
  // two windows meet, since the live boundary shifts between polls.
  const [older, setOlder] = useState([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exhausted, setExhausted] = useState(false);

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
  const live = q.data?.events || [];
  const liveIds = new Set(live.map((e) => e.id));
  const events = [...live, ...older.filter((e) => !liveIds.has(e.id))];
  if (!events.length) {
    return (
      <div className="rounded-md border border-dashed border-border bg-sunken p-4 text-center text-sm text-fg-muted">
        No activity yet.
      </div>
    );
  }

  async function loadOlder() {
    const oldest = events[events.length - 1];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const res = await api(
        `/super-admin/activity-feed?limit=${limit}&before=${encodeURIComponent(oldest.timestamp)}`
      );
      const page = res?.events || [];
      if (page.length === 0) setExhausted(true);
      setOlder((cur) => {
        const have = new Set([...cur.map((e) => e.id), ...liveIds]);
        return [...cur, ...page.filter((e) => !have.has(e.id))];
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <div>
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
                  {ACTION_LABELS[e.actionType] || e.actionType}
                </span>
                {e.organization && (
                  <button
                    onClick={() => navigate(`/organizations?billing=${e.organization.id}`)}
                    title={`Open ${e.organization.name} on the Organizations page`}
                    className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted hover:text-fg"
                  >
                    {e.organization.name}
                  </button>
                )}
              </div>
              <div className="truncate text-xs text-fg-muted">
                {e.canvasser
                  ? `${e.canvasser.firstName} ${e.canvasser.lastName}`
                  : 'Unknown'}
                {/* City/state only — street addresses left this feed on purpose (it is
                    grant-free and unlogged; see the server route's comment). */}
                {e.household?.city && (
                  <>
                    {' '}
                    <span className="text-fg-subtle">·</span> {e.household.city}
                    {e.household.state ? `, ${e.household.state}` : ''}
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
      <div className="mt-2 text-center">
        {exhausted ? (
          <span className="text-xs text-fg-subtle">Beginning of the feed.</span>
        ) : (
          <button
            onClick={loadOlder}
            disabled={loadingOlder}
            className="rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg disabled:opacity-50"
          >
            {loadingOlder ? 'Loading…' : 'Load older'}
          </button>
        )}
      </div>
    </div>
  );
}
