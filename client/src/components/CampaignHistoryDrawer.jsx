import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Drawer, Badge, Skeleton } from './ui/index.js';
import { formatInTz } from '../lib/datetime.js';
import { labelForField, formatValue, isNotable, teamMoveSummary } from '../lib/campaignHistory.js';

// Who changed what on this campaign, newest first.
//
// This is the review surface for two write-side records: CampaignChange (configuration edits —
// the door goal, the key dates, the invoice policy, archiving) and CoordinatorChange (team
// reassignments, which move doors between teams without anyone knocking one). The second has
// existed since the re-stamp feature shipped and was readable only from a database console until
// this drawer.
//
// Reached from the Campaigns ⋮ menu and from the door-goal card on campaign Home — the place you
// browse campaigns, and the place you notice a number looks wrong.

function Row({ item, tz }) {
  const notable = isNotable(item);
  const when = formatInTz(item.at, tz);
  const actor = item.by?.name || 'Unknown user';
  // A departed or deleted actor still gets named — hydrateCanvassers never drops an id — but the
  // feed says so, because "Lee Lead did this" reads differently when Lee left in March.
  const gone = item.by?.status && item.by.status !== 'active';

  return (
    <li className={`px-5 py-3.5 ${notable ? 'border-l-2 border-l-warning bg-warning-tint/30' : ''}`}>
      {item.kind === 'team' ? (
        <TeamBody item={item} />
      ) : (
        <div className="text-sm text-fg">
          <span className="font-medium">{labelForField(item.field)}</span>{' '}
          <span className="text-fg-muted">changed from</span>{' '}
          <span className="font-medium tabular-nums">{formatValue(item.field, item.fromValue)}</span>{' '}
          <span className="text-fg-muted">to</span>{' '}
          <span className="font-medium tabular-nums">{formatValue(item.field, item.toValue)}</span>
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
        <span>{actor}</span>
        {gone && <Badge variant="neutral">{item.by.status}</Badge>}
        <span>·</span>
        <span>{when}</span>
      </div>
    </li>
  );
}

function TeamBody({ item }) {
  const { headline, detail } = teamMoveSummary(item);
  return (
    <>
      <div className="text-sm text-fg">
        <span className="font-medium">Team</span>{' '}
        <span className="text-fg-muted">·</span> <span className="font-medium">{headline}</span>
      </div>
      <div className="mt-0.5 text-xs text-fg-muted">{detail}</div>
      {item.restampError && (
        <div className="mt-1 text-xs text-danger-fg">
          The team was changed but moving their past doors failed — the by-team numbers may not add
          up until this is re-run. ({item.restampError})
        </div>
      )}
    </>
  );
}

export default function CampaignHistoryDrawer({ campaignId, timeZone, onClose }) {
  const q = useQuery({
    queryKey: ['admin', 'campaign-history', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/history`),
    enabled: !!campaignId,
  });

  const items = q.data?.items || [];
  const tz = timeZone || undefined;

  return (
    <Drawer title="Campaign history" onClose={onClose} width="max-w-lg">
      <div className="border-b border-border px-5 py-3">
        <p className="text-xs text-fg-muted">
          Configuration changes and team reassignments, newest first. Knock-by-knock field activity
          lives on the Timeline; GPS quality flags live on Audit.
        </p>
      </div>

      {q.isLoading ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : q.error ? (
        <div className="p-5 text-sm text-danger">Couldn&apos;t load the history: {q.error.message}</div>
      ) : (
        <>
          {q.data?.truncated && (
            <p className="border-b border-border bg-sunken px-5 py-2 text-xs text-fg-muted">
              Showing the most recent changes only — this campaign has more history than fits here.
            </p>
          )}
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <Row key={it.id} item={it} tz={tz} />
            ))}
          </ul>
          {/* The campaign's own birth anchors the bottom, so a campaign nobody has edited reads as
              a timeline with one entry rather than an empty box. */}
          <div className="border-t border-border px-5 py-3.5">
            {items.length === 0 && (
              <p className="mb-2 text-sm text-fg-muted">
                Nothing has been changed since this campaign was created.
              </p>
            )}
            <div className="text-sm text-fg">Campaign created</div>
            <div className="mt-1 text-xs text-fg-muted">
              {q.data?.createdBy?.name || 'Unknown user'} · {formatInTz(q.data?.createdAt, tz)}
            </div>
          </div>
        </>
      )}
    </Drawer>
  );
}
