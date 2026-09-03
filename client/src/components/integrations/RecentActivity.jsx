import { useQuery } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../../api/client.js';
import { IconChevronRight } from '../ui/index.js';

const EVENT_COPY = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  'key-rotated': 'API key replaced',
  'figure-changed': 'Hours figure changed',
  'link-created': 'Canvasser linked',
  'link-removed': 'Canvasser unlinked',
  'auto-matched': 'Auto-matched by email',
  'sync-failed': 'Sync started failing',
  'sync-recovered': 'Sync recovered',
};

// A native <details>: keyboard-accessible for free, and there is no Accordion
// primitive in the kit to reach for instead.
export default function RecentActivity() {
  const orgId = getActiveOrgId();
  const eventsQ = useQuery({
    queryKey: ['admin', 'integrations', 'fbtime', 'events', orgId],
    queryFn: () => api('/admin/integrations/fbtime/events'),
    enabled: Boolean(orgId),
  });

  const events = eventsQ.data?.events || [];
  if (!events.length) return null;

  return (
    <details className="group rounded-card border border-border bg-card shadow-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-fg marker:hidden">
        <IconChevronRight
          size={16}
          className="text-fg-subtle transition-transform group-open:rotate-90"
        />
        Recent activity
        <span className="text-xs font-normal text-fg-muted">Last {events.length} changes</span>
      </summary>
      <ul className="space-y-1.5 border-t border-border px-4 py-3">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg">
              {EVENT_COPY[e.type] || e.type}
              {e.detail?.count != null && ` — ${e.detail.count}`}
              {e.detail?.code && ` (${e.detail.code})`}
              {e.detail?.to && ` → ${e.detail.to}`}
            </span>
            <span className="shrink-0 text-xs text-fg-subtle">
              {new Date(e.at).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
