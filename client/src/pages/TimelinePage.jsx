import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import Segmented from '../components/ui/Segmented.jsx';
import { todayInTz, shiftDays, formatDay } from '../lib/datePresets.js';
import TimelineGrid from '../components/TimelineGrid.jsx';
import TimelineOverlaps from '../components/TimelineOverlaps.jsx';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// Per-campaign Daily Timeline: canvassers × hours of one day, cells = knocks (toggle surveys),
// with per-canvasser/-hour totals and inline overlaps. Mirrors DashboardPage's data/tz patterns.
export default function TimelinePage() {
  const { campaignId } = useParams();
  const orgTz = useOrgTimeZone();
  const [day, setDay] = useState(null);
  const dayTouchedRef = useRef(false);
  const [metric, setMetric] = useState('knocks');
  const [effortId, setEffortId] = useState('');

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const campaigns = campaignsQ.data?.campaigns || [];
  const current = campaigns.find((c) => String(c._id) === String(campaignId)) || undefined;
  const tz = current?.timeZone || orgTz;
  const tzReady = !campaignsQ.isLoading;

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const efforts = effortsQ.data?.efforts || [];

  // Default the day to "today" in the campaign tz once it's known (so it's the campaign's day
  // for every admin). Skips if the admin already stepped the day.
  useEffect(() => {
    if (dayTouchedRef.current || !tzReady) return;
    setDay(todayInTz(tz));
  }, [tzReady, tz]);

  const isToday = !!day && day === todayInTz(tz);
  function stepDay(n) {
    dayTouchedRef.current = true;
    setDay((d) => shiftDays(d, n));
  }

  const timelineQ = useQuery({
    queryKey: ['reports', 'canvasser-timeline', campaignId, effortId, day],
    queryFn: () =>
      api(
        `/admin/reports/canvasser-timeline${buildQuery({
          campaignId,
          effortId: effortId || undefined,
          date: day,
        })}`
      ),
    enabled: !!campaignId && !!day,
    refetchInterval: isToday ? 30_000 : false,
  });
  const data = timelineQ.data || {};
  const hasRows = (data.canvassers || []).length > 0;

  if (!campaignId || (!campaignsQ.isLoading && !current)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-semibold text-fg">Campaign not found</h1>
        <Link
          to="/admin"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          Go to Overview
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{current?.name || 'Campaign'}</h1>
          <div className="mt-1 text-sm text-fg-muted">Daily timeline — activity by hour</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {efforts.length > 1 && (
            <select
              value={effortId}
              onChange={(e) => setEffortId(e.target.value)}
              title="Filter to one walk list"
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">All walk lists</option>
              {efforts.map((ef) => (
                <option key={ef._id} value={ef._id}>
                  {ef.name}
                </option>
              ))}
            </select>
          )}
          <Segmented
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'knocks', label: 'Knocks' },
              { value: 'surveys', label: 'Surveys' },
            ]}
          />
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepDay(-1)}
              disabled={!day}
              aria-label="Previous day"
              className="rounded border border-border-strong px-2 py-1 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
            >
              ‹
            </button>
            <span className="min-w-[7.5rem] text-center text-sm font-semibold tabular-nums text-fg">
              {day ? formatDay(day) : '—'}
            </span>
            <button
              type="button"
              onClick={() => stepDay(1)}
              disabled={!day || isToday}
              aria-label="Next day"
              className="rounded border border-border-strong px-2 py-1 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
            >
              ›
            </button>
          </div>
          {data.tzAbbrev && (
            <span className="self-center text-xs font-medium text-fg-subtle" title={`Times in ${data.tz}`}>
              {data.tzAbbrev}
            </span>
          )}
        </div>
      </div>

      {timelineQ.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
      ) : timelineQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error: {timelineQ.error.message}
        </div>
      ) : !hasRows ? (
        <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center">
          <p className="text-sm font-medium text-fg">No activity on {day ? formatDay(day) : 'this day'}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
            No knocks were recorded for this campaign on the selected day. Use the arrows to pick another day.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <TimelineOverlaps data={data} />
          <TimelineGrid data={data} metric={metric} />
        </div>
      )}
    </div>
  );
}
