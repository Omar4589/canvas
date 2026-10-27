import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button } from '../ui/index.js';
import { ACTION_LABELS, statusColorsForTheme } from '../../lib/statusColors.js';
import { formatRelative } from '../../lib/dates.js';
import { ACTION_STATUS, doorRows, doorsPath, firstDoorsPage, nextDoorsPage } from '../../lib/personDoors.js';

// Recent doors in the person panel: the newest 5, then 10 more per Show more (lib/personDoors.js has
// the paging rule). The Users page reads the org's doors (/admin/memberships/:id/recent-activity); a
// Team page reads that campaign's, through the reports read with the shared action list, so notes
// never show as doors. Desk marks are left out of both.

// This surface's 7-day relative→absolute cutoff is deliberate UX.
const ago = (d) => formatRelative(d, { cutoffDays: 7 });
// The dots' palette follows the theme class index.html sets before paint (what lib/useTheme.js reads),
// without that hook's write-back.
const isDark = () => typeof document !== 'undefined' && !!document.documentElement?.classList?.contains?.('dark');

const PersonRecentDoors = ({ person, campaignId = null, onLink }) => {
  const userId = person.userId;
  const q = useInfiniteQuery({
    queryKey: campaignId ? ['admin', 'campaign-member-doors', campaignId, userId] : ['admin', 'membership-recent-activity', userId],
    queryFn: ({ pageParam, signal }) => api(doorsPath({ userId, campaignId }, pageParam), { signal }),
    initialPageParam: firstDoorsPage,
    getNextPageParam: (_last, pages, lastParam) => nextDoorsPage(pages, lastParam),
    enabled: person.status !== 'deleted',
  });
  const rows = doorRows(q.data?.pages);
  const colors = statusColorsForTheme(isDark());
  const firstCampaign = rows[0]?.campaign;
  const mapTo = campaignId
    ? `/campaigns/${campaignId}/map`
    : firstCampaign?.id || firstCampaign?._id
      ? `/campaigns/${firstCampaign.id || firstCampaign._id}/map`
      : '/campaigns';

  return (
    <div className="border-b border-border px-6 py-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Recent doors</h3>
        <Link to={mapTo} onClick={onLink} className="text-xs font-semibold text-brand-accent hover:underline">
          View on map →
        </Link>
      </div>
      {q.isLoading ? (
        <div className="text-sm text-fg-muted">Loading…</div>
      ) : q.isError && !rows.length ? (
        <div className="text-sm text-danger-fg">
          Couldn’t load their doors: {q.error.message}{' '}
          <Button variant="secondary" size="sm" className="ml-1" disabled={q.isFetching} onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      ) : !rows.length ? (
        <div className="rounded-md border border-dashed border-border bg-sunken px-4 py-6 text-center text-sm text-fg-muted">
          {campaignId ? 'No doors on this campaign yet.' : 'No doors yet.'}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {rows.map((a) => (
              <li key={a.id} className="flex items-start gap-3 bg-card px-3 py-2 text-sm">
                <span
                  aria-hidden
                  className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colors[ACTION_STATUS[a.actionType]] || colors.unknocked }}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-fg">{ACTION_LABELS[a.actionType] || a.actionType}</div>
                  <div className="truncate text-xs text-fg-muted">
                    {a.household
                      ? `${a.household.addressLine1}${a.household.city ? `, ${a.household.city}` : ''}`
                      : 'Address unavailable'}
                    {!campaignId && a.campaign?.name && (
                      <>
                        {' '}
                        <span className="text-fg-subtle">·</span> {a.campaign.name}
                      </>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-fg-muted">{ago(a.timestamp)}</div>
              </li>
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="mt-2 flex justify-end">
              <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                Show more
              </Button>
            </div>
          )}
          {q.isError && rows.length > 0 && <p className="mt-2 text-xs text-danger-fg">Couldn’t load more: {q.error.message}</p>}
        </>
      )}
    </div>
  );
};

export default PersonRecentDoors;
