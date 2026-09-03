import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../../api/client.js';
import { Badge, Button, Card, IconAlert, IconKey, IconSpinner } from '../ui/index.js';

// One slim line answering exactly one question: is this working right now.
//
// The key prefix, the hours figure and the linked count deliberately do NOT live
// here — they moved to Settings and to the table's own count line. A strip with a
// fifth fact on it stops answering its one question.
export default function StatusStrip({ data, onChanged, onOpenSettings }) {
  const orgId = getActiveOrgId();
  const qc = useQueryClient();

  // "Refresh hours now": the server enqueues a deep re-pull and answers with
  // its requestedAt; completion is read off the connection's own sync stamps
  // moving past that instant, so both sides of the comparison are the server's
  // clock. (A 15-minute cron tick landing in the same window can trip the
  // "refreshed" note a moment before the deep rows land — cosmetic; the rows
  // arrive on the very next refetch.)
  const [refreshingSince, setRefreshingSince] = useState(null); // ms epoch, server time
  const [refreshNote, setRefreshNote] = useState(null);

  const refreshMut = useMutation({
    mutationFn: () => api('/admin/integrations/fbtime/sync', { method: 'POST' }),
    onSuccess: (res) => {
      setRefreshNote(null);
      setRefreshingSince(new Date(res.requestedAt).getTime());
    },
  });

  // Poll the status query while a refresh is in flight; give up politely after
  // 90s (the job still runs — the next natural refetch shows its result).
  useEffect(() => {
    if (!refreshingSince) return undefined;
    const tick = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['admin', 'integrations', 'fbtime', orgId] });
    }, 2000);
    const bail = setTimeout(() => {
      setRefreshingSince(null);
      setRefreshNote('Still working — the refresh runs in the background. Check back in a minute.');
    }, 90_000);
    return () => {
      clearInterval(tick);
      clearTimeout(bail);
    };
  }, [refreshingSince, qc, orgId]);

  // lastSyncAt past our request = done; lastErrorAt past it = the sync ran and
  // failed, and the error banner already says why.
  useEffect(() => {
    if (!refreshingSince) return;
    const syncedAt = data.lastSyncAt ? new Date(data.lastSyncAt).getTime() : 0;
    const failedAt = data.lastErrorAt ? new Date(data.lastErrorAt).getTime() : 0;
    if (syncedAt >= refreshingSince) {
      setRefreshingSince(null);
      setRefreshNote('Hours refreshed.');
      onChanged(); // every report recomputes against the fresh cache
    } else if (failedAt >= refreshingSince) {
      setRefreshingSince(null);
      setRefreshNote(null);
    }
  }, [data.lastSyncAt, data.lastErrorAt, refreshingSince, onChanged]);

  const errored = data.status === 'errored';
  const refreshing = refreshMut.isPending || Boolean(refreshingSince);

  const badge = errored ? (
    <Badge variant="danger" dot>
      Needs attention
    </Badge>
  ) : refreshing ? (
    <Badge variant="info">
      <IconSpinner size={12} /> Refreshing
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
    ? data.lastSyncError || 'Hours have stopped syncing.'
    : refreshing
      ? 'Re-pulling the last few months…'
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
          disabled={refreshing}
          onClick={() => refreshMut.mutate()}
          title="Re-pulls the last few months from FbTime — use it after fixing a timesheet there."
        >
          {refreshing ? 'Refreshing…' : 'Refresh hours'}
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
