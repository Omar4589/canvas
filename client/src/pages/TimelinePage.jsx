import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import Segmented from '../components/ui/Segmented.jsx';
import DateRangeSelector, { RANGE_PRESETS } from '../components/DateRangeSelector.jsx';
import { todayInTz, shiftDays, formatDay, defaultRange, labelForRange } from '../lib/datePresets.js';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';
import { ratePct, rateAccent } from '../lib/rates.js';
import StatCard from '../components/StatCard.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import CanvasserSummaryTable from '../components/CanvasserSummaryTable.jsx';
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

// The endpoint caps ranges (62 days), so this page doesn't offer "All time" and
// validates custom ranges before querying (the server 400s as a backstop).
const TIMELINE_PRESETS = RANGE_PRESETS.filter((p) => p.id !== 'all');
const TIMELINE_MAX_DAYS = 62;

// Inclusive day count between two YYYY-MM-DD strings (UTC calendar math).
function ymdSpanDays(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

// Per-campaign canvasser timeline: a live performance dashboard. KPI totals for the
// range, a sortable per-canvasser table (who knocked, whose crew, doors, surveys,
// rates, pace, start/last door), and the heatmap grid — hour columns for a single day,
// day columns for a range. Coordinator filter scopes KPIs + table + grid (client-side);
// the overlaps reconciliation card stays campaign-wide. Mirrors MapPage's live-refresh
// pattern (LiveStatus + 20s poll while the range includes today).
export default function TimelinePage() {
  const { campaignId } = useParams();
  const orgTz = useOrgTimeZone();
  const { homePath } = useAuth(); // /admin for admins, /campaigns for leads (no Overview)
  const [dateRange, setDateRange] = useState(null);
  const rangeTouchedRef = useRef(false);
  const [metric, setMetric] = useState('knocks');
  const [effortId, setEffortId] = useState('');
  const [coordinatorId, setCoordinatorId] = useState(''); // '' = all, 'none' = no coordinator
  const [live, setLive] = useState(true);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const campaigns = campaignsQ.data?.campaigns || [];
  const current = campaigns.find((c) => String(c._id) === String(campaignId)) || undefined;
  const tz = current?.timeZone || orgTz;
  const tzReady = !campaignsQ.isLoading;

  // The same mounted element serves every /campaigns/:id/timeline — reset ALL
  // campaign-scoped view state synchronously when the admin switches campaigns, or
  // stale filters, the picked range, and the live toggle bleed from A into B (and a
  // touched range would keep B from reseeding to its own "today").
  const [prevCampaignId, setPrevCampaignId] = useState(campaignId);
  if (prevCampaignId !== campaignId) {
    setPrevCampaignId(campaignId);
    setCoordinatorId('');
    setEffortId('');
    setLive(true);
    setDateRange(defaultRange('today', tz));
    rangeTouchedRef.current = false;
  }

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const efforts = effortsQ.data?.efforts || [];

  const { members } = useCampaignTeam(campaignId);

  // Default the range to "today" in the campaign tz once it's known (so it's the
  // campaign's day for every admin). Skips if the admin already picked a range.
  useEffect(() => {
    if (rangeTouchedRef.current || !tzReady) return;
    setDateRange(defaultRange('today', tz));
  }, [tzReady, tz]);

  function onRangeChange(next) {
    rangeTouchedRef.current = true;
    setDateRange(next);
  }

  // Relative presets keep to:null (open through today); resolve for display/stepping.
  // Recomputed every render so the poll self-corrects after campaign-tz midnight — the
  // 'today' preset re-pins `from` to the CURRENT today (its stored `from` was captured at
  // selection time and would silently widen into a 2-day range overnight).
  const today = todayInTz(tz);
  const fromDay = dateRange ? (dateRange.preset === 'today' ? today : dateRange.from) : null;
  const effectiveTo = dateRange ? dateRange.to || today : null;
  const isSingleDay = !!dateRange && fromDay === effectiveTo;
  const includesToday = !!dateRange && (!dateRange.to || dateRange.to >= today);
  // Guard before querying: a custom "Until X" (from:null) is unbounded, a future start
  // inverts the range (the live poll would retry the 400 every 20s), and a long custom
  // range exceeds the endpoint's 62-day cap — show the notice, not a raw error.
  const rangeInvalid =
    !!dateRange &&
    (!fromDay || fromDay > effectiveTo || ymdSpanDays(fromDay, effectiveTo) > TIMELINE_MAX_DAYS);

  function stepDay(n) {
    const next = shiftDays(fromDay, n);
    onRangeChange({ preset: 'custom', from: next, to: next });
  }

  const timelineQ = useQuery({
    queryKey: ['reports', 'canvasser-timeline', campaignId, effortId, fromDay, dateRange?.to],
    queryFn: () =>
      api(
        `/admin/reports/canvasser-timeline${buildQuery({
          campaignId,
          effortId: effortId || undefined,
          from: fromDay,
          to: dateRange.to || undefined, // server defaults a missing `to` to today
        })}`
      ),
    enabled: !!campaignId && !!fromDay && !rangeInvalid,
    refetchInterval: live && includesToday ? 20_000 : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
  const data = timelineQ.data || {};

  // Coordinator join: the roster cache (shared with the Team page) knows each
  // canvasser's coordinator; the timeline rows don't. Off-roster canvassers
  // (removed, cross-campaign) resolve to null → '—' / "No coordinator".
  const coordByUserId = useMemo(() => {
    const m = new Map();
    for (const member of members) {
      m.set(String(member.user.id), {
        coordinatorId: member.user.coordinatorId ? String(member.user.coordinatorId) : null,
        coordinatorName: member.user.coordinatorName || null,
      });
    }
    return m;
  }, [members]);

  const rows = useMemo(() => {
    return (data.canvassers || []).map((c) => ({
      ...c,
      coordinatorId: coordByUserId.get(String(c.userId))?.coordinatorId || null,
      coordinatorName: coordByUserId.get(String(c.userId))?.coordinatorName || null,
    }));
  }, [data.canvassers, coordByUserId]);

  const coordinatorOptions = useMemo(() => {
    const seen = new Map();
    for (const r of rows) {
      if (r.coordinatorId && !seen.has(r.coordinatorId)) seen.set(r.coordinatorId, r.coordinatorName);
    }
    // Also offer coordinators whose whole crew hasn't knocked yet (from the roster).
    for (const member of members) {
      const cid = member.user.coordinatorId ? String(member.user.coordinatorId) : null;
      if (cid && !seen.has(cid)) seen.set(cid, member.user.coordinatorName);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name: name || 'Coordinator' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, members]);

  const filteredRows = useMemo(() => {
    if (!coordinatorId) return rows;
    if (coordinatorId === 'none') return rows.filter((r) => !r.coordinatorId);
    return rows.filter((r) => r.coordinatorId === coordinatorId);
  }, [rows, coordinatorId]);

  // KPI totals from the visible rows, so the coordinator filter scopes them too.
  const kpis = useMemo(() => {
    let doors = 0;
    let surveys = 0;
    let lit = 0;
    let hours = 0;
    for (const r of filteredRows) {
      doors += r.dayKnocks || 0;
      surveys += r.daySurveys || 0;
      lit += r.dayLit || 0;
      hours += r.hoursOnDoors || 0;
    }
    const connPct = doors ? Math.round(((surveys + lit) / doors) * 100) : null;
    const doorsPerHour = hours > 0 ? doors / hours : null;
    return { doors, surveys, connPct, doorsPerHour };
  }, [filteredRows]);

  // "Knocking N of M": M = roster canvassers (this crew's when filtered), N = the subset
  // of them with at least one knock in the range. Intersecting with the roster keeps
  // N ⊆ M — admins/leads/off-roster knockers still show in the table, but "5 of 4"
  // would read as a bug.
  const rosterIds = useMemo(() => {
    const canvasserMembers = members.filter((m) => m.role === 'canvasser');
    const scoped = !coordinatorId
      ? canvasserMembers
      : coordinatorId === 'none'
        ? canvasserMembers.filter((m) => !m.user.coordinatorId)
        : canvasserMembers.filter((m) => String(m.user.coordinatorId || '') === coordinatorId);
    return new Set(scoped.map((m) => String(m.user.id)));
  }, [members, coordinatorId]);
  const knockingCount = useMemo(
    () => filteredRows.filter((r) => rosterIds.has(String(r.userId))).length,
    [filteredRows, rosterIds]
  );

  const hasRows = rows.length > 0;
  const rangeLabel = dateRange ? labelForRange(dateRange) : '';

  if (!campaignId || (!campaignsQ.isLoading && !current)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-semibold text-fg">Campaign not found</h1>
        <Link
          to={homePath}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          {homePath === '/campaigns' ? 'Go to Campaigns' : 'Go to Overview'}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{current?.name || 'Campaign'}</h1>
          <div className="mt-1 text-sm text-fg-muted">Timeline — who's knocking, and how it's going</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {includesToday && (
            <LiveStatus
              live={live}
              onToggle={() => setLive((v) => !v)}
              isFetching={timelineQ.isFetching}
              updatedAt={timelineQ.dataUpdatedAt}
              onRefresh={() => timelineQ.refetch()}
            />
          )}
          {data.tzAbbrev && (
            <span className="self-center text-xs font-medium text-fg-subtle" title={`Times in ${data.tz}`}>
              {data.tzAbbrev}
            </span>
          )}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
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
          {coordinatorOptions.length > 0 && (
            <select
              value={coordinatorId}
              onChange={(e) => setCoordinatorId(e.target.value)}
              title="Filter to one coordinator's crew"
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">All coordinators</option>
              {coordinatorOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">No coordinator</option>
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
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isSingleDay && (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => stepDay(-1)}
                aria-label="Previous day"
                className="rounded border border-border-strong px-2 py-1 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
              >
                ‹
              </button>
              <span className="min-w-[7.5rem] text-center text-sm font-semibold tabular-nums text-fg">
                {formatDay(fromDay)}
              </span>
              <button
                type="button"
                onClick={() => stepDay(1)}
                disabled={fromDay >= today}
                aria-label="Next day"
                className="rounded border border-border-strong px-2 py-1 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
          <DateRangeSelector value={dateRange} onChange={onRangeChange} tz={tz} presets={TIMELINE_PRESETS} />
        </div>
      </div>

      {rangeInvalid ? (
        <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center">
          <p className="text-sm font-medium text-fg">That range won't work for the timeline</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
            Pick a start date on or before the end date, spanning at most {TIMELINE_MAX_DAYS} days.
          </p>
        </div>
      ) : timelineQ.isLoading || !dateRange ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
      ) : timelineQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error: {timelineQ.error.message}
        </div>
      ) : !hasRows ? (
        <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center">
          <p className="text-sm font-medium text-fg">No activity — {rangeLabel}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
            No knocks were recorded for this campaign in the selected range. Pick another range above.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Doors" value={kpis.doors.toLocaleString()} hint={rangeLabel} />
            <StatCard label="Surveys" value={kpis.surveys.toLocaleString()} hint="Doors with a survey" />
            <StatCard
              label="Connection rate"
              value={ratePct(kpis.connPct)}
              accent={rateAccent(kpis.connPct)}
              hint="Surveys + lit ÷ doors"
            />
            <StatCard
              label="Doors / hour"
              value={kpis.doorsPerHour != null ? kpis.doorsPerHour.toFixed(1) : '—'}
              hint="While on doors"
            />
            <StatCard
              label="Knocking"
              value={`${knockingCount} of ${rosterIds.size}`}
              hint={coordinatorId ? 'Crew canvassers' : 'Roster canvassers'}
            />
          </div>

          {filteredRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center">
              <p className="text-sm font-medium text-fg">No activity for this coordinator's crew</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
                Nobody on this crew knocked in the selected range.
              </p>
            </div>
          ) : (
            <>
              <CanvasserSummaryTable
                rows={filteredRows}
                tz={tz}
                singleDay={isSingleDay}
                litMode={current?.type === 'lit_drop'}
              />
              <TimelineOverlaps
                data={data}
                note={coordinatorId ? 'Overlap totals are campaign-wide (not filtered to this crew).' : null}
              />
              <TimelineGrid data={data} rows={filteredRows} metric={metric} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
