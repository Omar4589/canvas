import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../../api/client.js';
import { Badge, Button, Card, IconAlert, IconKey, IconSpinner } from '../ui/index.js';
import { syncDoneNote, syncFailedNote, syncOutcome } from '../../lib/fbtimeDoors.js';

// One slim line answering exactly one question: is this working right now.
//
// The key prefix, the hours figure and the linked count deliberately do NOT live
// here — they moved to Settings and to the table's own count line. A strip with a
// fifth fact on it stops answering its one question. Door counts have their own
// card underneath; the only door-count thing here is that the ONE button also
// re-sends them, so it reads "Sync now" while they're on and "Refresh hours" while
// they're off.
export default function StatusStrip({ data, onChanged, onOpenSettings }) {
  const orgId = getActiveOrgId();
  const qc = useQueryClient();
  const doorsOn = Boolean(data.doors?.enabled);

  // Sync now / Refresh hours: the server enqueues a deep run (hours, then door
  // counts) and answers with its requestedAt; completion is read off the
  // connection's own stamps moving past that instant, so both sides of the
  // comparison are the server's clock. The verdict — failed checked FIRST — is
  // syncOutcome() in lib/fbtimeDoors.js. (A 15-minute cron tick landing in the
  // same window can trip "done" a moment before the deep rows land — cosmetic;
  // they arrive on the very next refetch.)
  const [refreshing, setRefreshing] = useState(null); // { at: ms epoch (server), erroredBefore }
  const [refreshNote, setRefreshNote] = useState(null);

  const refreshMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/sync', { method: 'POST' }),
    // `erroredBefore` is the status at the click: a retry of an errored connection
    // must not read its old errored status as this run's failure.
    onSuccess: (res, erroredBefore) => {
      setRefreshNote(null);
      setRefreshing({ at: new Date(res.requestedAt).getTime(), erroredBefore });
    },
  });

  // Poll the status query while a refresh is in flight; give up politely after
  // 90s (the job still runs — the next natural refetch shows its result).
  useEffect(() => {
    if (!refreshing) return undefined;
    const tick = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['admin', 'integrations', 'fbtime', orgId] });
    }, 2000);
    const bail = setTimeout(() => {
      setRefreshing(null);
      setRefreshNote('Still working — it runs in the background. Check back in a minute.');
    }, 90_000);
    return () => {
      clearInterval(tick);
      clearTimeout(bail);
    };
  }, [refreshing, qc, orgId]);

  useEffect(() => {
    if (!refreshing) return;
    const outcome = syncOutcome(data, refreshing);
    if (outcome === 'failed') {
      setRefreshing(null);
      setRefreshNote(syncFailedNote(data, refreshing.at));
    } else if (outcome === 'done') {
      setRefreshing(null);
      setRefreshNote(syncDoneNote(data));
      onChanged(); // every report recomputes against the fresh cache
    }
  }, [data, refreshing, onChanged]);

  const errored = data.status === 'errored';
  const busy = refreshMut.isPending || Boolean(refreshing);

  const badge = errored ? (
    <Badge variant="danger" dot>
      Needs attention
    </Badge>
  ) : busy ? (
    <Badge variant="info">
      <IconSpinner size={12} /> {doorsOn ? 'Syncing' : 'Refreshing'}
    </Badge>
  ) : data.lastSyncAt ? (
    <Badge variant="success" dot>
      Connected
    </Badge>
  ) : (
    <Badge variant="info" dot>
      Connected
    </Badge>
  );

  const middle = errored
    ? data.lastSyncError || (doorsOn ? 'Hours and door counts have stopped syncing.' : 'Hours have stopped syncing.')
    : busy
      ? doorsOn
        ? 'Re-pulling hours and re-sending door counts…'
        : 'Re-pulling the last few months…'
      : data.lastSyncAt
        ? `Synced ${new Date(data.lastSyncAt).toLocaleString()}`
        : 'First sync in progress — hours appear within a few minutes.';

  return (
    <Card
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 ${
        errored ? 'border-danger/30 bg-danger-tint' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {badge}
        <span className="truncate text-sm font-medium text-fg">
          FbTime · {data.fbtimeOrgName || 'Connected'}
        </span>
        <span className="hidden h-4 w-px bg-border sm:block" />
        <span
          className={`min-w-0 truncate text-xs ${errored ? 'text-danger-fg' : 'text-fg-muted'}`}
          title={errored ? data.lastSyncError || '' : undefined}
        >
          {errored && <IconAlert size={12} className="mr-1 inline-block align-[-1px]" />}
          {middle}
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => refreshMut.mutate(errored)}
          title={
            doorsOn
              ? 'Re-pulls hours from FbTime and re-sends door counts — use it after fixing a timesheet there or a door result here.'
              : 'Re-pulls the last few months from FbTime — use it after fixing a timesheet there.'
          }
        >
          {busy ? (doorsOn ? 'Syncing…' : 'Refreshing…') : doorsOn ? 'Sync now' : 'Refresh hours'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onOpenSettings}>
          <IconKey size={14} /> Settings
        </Button>
      </div>

      {(refreshNote || refreshMut.error) && (
        <p
          className={`basis-full text-xs ${refreshMut.error ? 'text-danger' : 'text-fg-muted'}`}
        >
          {refreshMut.error ? refreshMut.error.message : refreshNote}
        </p>
      )}
    </Card>
  );
}
