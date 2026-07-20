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
import { livePollOptions, liveStatusProps } from '../lib/livePoll.js';
import StatCard from '../components/StatCard.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import CanvasserSummaryTable from '../components/CanvasserSummaryTable.jsx';
import TimelineGrid from '../components/TimelineGrid.jsx';
import TimelineOverlaps from '../components/TimelineOverlaps.jsx';
import TeamBreakdown from '../components/TeamBreakdown.jsx';

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
// "All time" is offered again: it swaps the hour/day grid for campaign-to-date totals, which is
// the only way to see everyone who has ever worked the campaign — including canvassers who left.
const TIMELINE_PRESETS = RANGE_PRESETS;
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

  // allMembers, not members: this is a REPORT. A canvasser who was deactivated still has their
  // knocks on this page, so their coordinator label and their place in the roster count must not
  // vanish the moment their account is switched off.
  const { allMembers: members } = useCampaignTeam(campaignId);

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
  // "All time" = campaign-to-date. It asks the server for totals only (no hour/day buckets), which
  // is what lets it escape the 62-day cap — the cap exists to stop the grid growing a column per
  // day, not to limit the aggregation. This is the only view that shows every canvasser who ever
  // worked the campaign, including the ones who have since left.
  const allTime = dateRange?.preset === 'all';
  const fromDay = dateRange ? (dateRange.preset === 'today' ? today : dateRange.from) : null;
  const effectiveTo = dateRange ? dateRange.to || today : null;
  const isSingleDay = !allTime && !!dateRange && fromDay === effectiveTo;
  const includesToday = allTime || (!!dateRange && (!dateRange.to || dateRange.to >= today));
  // Guard before querying: a custom "Until X" (from:null) is unbounded, a future start
  // inverts the range (the live poll would retry the 400 every 20s), and a long custom
  // range exceeds the endpoint's 62-day cap — show the notice, not a raw error.
  // All-time is bounded by nothing on purpose, so none of that applies to it.
  const rangeInvalid =
    !allTime &&
    !!dateRange &&
    (!fromDay || fromDay > effectiveTo || ymdSpanDays(fromDay, effectiveTo) > TIMELINE_MAX_DAYS);

  function stepDay(n) {
    const next = shiftDays(fromDay, n);
    onRangeChange({ preset: 'custom', from: next, to: next });
  }

  const timelineQ = useQuery({
    queryKey: [
      'reports', 'canvasser-timeline', campaignId, effortId,
      allTime ? 'all' : fromDay, dateRange?.to, coordinatorId,
    ],
    queryFn: () =>
      api(
        `/admin/reports/canvasser-timeline${buildQuery({
          campaignId,
          effortId: effortId || undefined,
          // Team scope goes to the SERVER. It has to: billable doors are deduped by
          // (household, pass) across users, so a team's real figure cannot be summed client-side.
          coordinatorId: coordinatorId || undefined,
          // All-time sends no bounds at all — the server reads that as the whole ledger.
          ...(allTime ? { totals: 1 } : { from: fromDay, to: dateRange.to || undefined }),
        })}`
      ),
    enabled: !!campaignId && (allTime || (!!fromDay && !rangeInvalid)),
    ...livePollOptions(live, includesToday),
    placeholderData: keepPreviousData,
  });
  const data = timelineQ.data || {};

  // The coordinator now comes from the LEDGER — it is stamped onto each knock at the moment it
  // happens. It used to be joined from the campaign roster, which meant a canvasser who was taken
  // off the campaign lost their team and their doors silently fell into "No coordinator" — the
  // bucket admins deliberately exclude when reporting a team's number to a client.
  //
  // The filter is now SERVER-SIDE too (?coordinatorId), which is what makes the deduped billable
  // figure team-correct: distinct doors can't be derived by summing rows in the browser.
  const rows = data.canvassers || [];
  const filteredRows = rows;

  const teamsQ = useQuery({
    queryKey: ['reports', 'team-breakdown', campaignId, effortId, allTime ? 'all' : fromDay, dateRange?.to],
    queryFn: () =>
      api(
        `/admin/reports/team-breakdown${buildQuery({
          campaignId,
          effortId: effortId || undefined,
          ...(allTime ? {} : { from: fromDay, to: dateRange.to || undefined }),
        })}`
      ),
    enabled: !!campaignId && (allTime || (!!fromDay && !rangeInvalid)),
    // This poll is NOT optional: without it the by-team totals froze at page load while the
    // canvasser table beside them refreshed every 20s — and the Live pill, reading only that other
    // query, called the stale team number "updated 3s ago". It also feeds the coordinator dropdown
    // below, so a newly-formed team wouldn't appear in the picker until a manual reload.
    ...livePollOptions(live, includesToday),
    placeholderData: keepPreviousData,
  });
  const breakdown = teamsQ.data || {};

  const coordinatorOptions = useMemo(
    () =>
      (breakdown.teams || [])
        .filter((t) => t.coordinatorId)
        .map((t) => ({ id: t.coordinatorId, name: t.coordinatorName || 'Coordinator' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [breakdown.teams]
  );

  // DOORS is the DEDUPED count, from the server — the number you'd quote a client. It cannot be
  // computed here: summing rows gives the raw event count, which double-counts a house two
  // canvassers both worked. The raw figure still has a home, in the reconciliation line below.
  // The connection rate divides by the same deduped denominator, so it now agrees with the Home
  // tab and the client report instead of quietly using a different base.
  const kpis = useMemo(() => {
    const doors = data.billableKnocks ?? 0;
    // Deduped server-side for exactly the reason DOORS is, and it must be: summing the
    // per-canvasser survey column double-counts a door two canvassers both surveyed, which is
    // what this card used to do. Falls back to the row sum only for a server too old to send it.
    let surveys = data.billableSurveyDoors ?? null;
    let rawSurveys = 0;
    let lit = 0;
    let hours = 0;
    for (const r of filteredRows) {
      rawSurveys += r.daySurveys || 0;
      lit += r.dayLit || 0;
      hours += r.hoursOnDoors || 0;
    }
    if (surveys == null) surveys = rawSurveys;
    const connPct = doors ? Math.round(((surveys + lit) / doors) * 100) : null;
    // Pace stays raw effort: it's per-person time on doors, not a billing figure.
    const rawDoors = filteredRows.reduce((n, r) => n + (r.dayKnocks || 0), 0);
    const doorsPerHour = hours > 0 ? rawDoors / hours : null;
    // The invoice figure when this campaign bills for restricted homes. Deliberately NOT fed
    // into connPct above — a locked gate answered nobody, so it can't sit in a rate denominator.
    return {
      doors,
      surveys,
      connPct,
      doorsPerHour,
      billableDoors: data.billableDoors ?? doors,
      restrictedDoors: data.restrictedDoors ?? 0,
      billRestricted: Boolean(data.billRestrictedDoors),
    };
  }, [
    filteredRows,
    data.billableKnocks,
    data.billableSurveyDoors,
    data.billableDoors,
    data.restrictedDoors,
    data.billRestrictedDoors,
  ]);

  // "Knocking N of M": M = the people this campaign could expect work from in this range, N =
  // how many actually knocked.
  //
  // M is the current roster UNION everyone who knocked in the range — not the roster alone.
  // Somebody who worked the campaign and then quit is deleted from the roster, and counting
  // only the roster silently erased them from BOTH numbers: a campaign whose whole crew turned
  // over read "1 of 1" while four people's work sat in the table below. Their doors were always
  // in the totals; this makes the headcount agree with them. The union also keeps N ⊆ M by
  // construction — every knocker is in M, so "5 of 4" still can't happen.
  const rosterIds = useMemo(() => {
    const canvasserMembers = members.filter((m) => m.role === 'canvasser');
    const scoped = !coordinatorId
      ? canvasserMembers
      : coordinatorId === 'none'
        ? canvasserMembers.filter((m) => !m.user.coordinatorId)
        : canvasserMembers.filter((m) => String(m.user.coordinatorId || '') === coordinatorId);
    const ids = new Set(scoped.map((m) => String(m.user.id)));
    // filteredRows is already coordinator-scoped, so a departed knocker joins the crew's M only
    // when that crew is the one being shown (they land in "No coordinator", having lost their
    // roster row along with their coordinator).
    for (const r of filteredRows) ids.add(String(r.userId));
    return ids;
  }, [members, coordinatorId, filteredRows]);
  // N counts people who actually KNOCKED. A row can exist with zero knocks — someone who only
  // marked doors Restricted has activity but no knock (restricted is deliberately not billable
  // and never in dayKnocks), and the tile says "Knocking".
  const knockingCount = useMemo(
    () => filteredRows.filter((r) => (r.dayKnocks || 0) > 0).length,
    [filteredRows]
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
            // Both queries, not just the timeline: the pill reports the OLDEST of them and its
            // Refresh refetches both, so it can never claim a freshness the team table doesn't have.
            <LiveStatus
              {...liveStatusProps([timelineQ, teamsQ], {
                live,
                onToggle: () => setLive((v) => !v),
              })}
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
            {/* Distinct doors, deduped by (house, round) — the figure you'd give a client. The raw
                event count lives in the reconciliation line below, where it can't be mistaken for
                this one. */}
            <StatCard
              label={kpis.billRestricted ? 'Billable doors' : 'Doors'}
              value={(kpis.billRestricted ? kpis.billableDoors : kpis.doors).toLocaleString()}
              hint={
                kpis.billRestricted
                  ? `${kpis.doors.toLocaleString()} knocked + ${kpis.restrictedDoors.toLocaleString()} restricted · ${rangeLabel}`
                  : `Distinct doors · ${rangeLabel}`
              }
            />
            <StatCard label="Survey doors" value={kpis.surveys.toLocaleString()} hint="Doors with a survey" />
            <StatCard
              label="Connection rate"
              value={ratePct(kpis.connPct)}
              accent={rateAccent(kpis.connPct)}
              hint="Survey doors + lit ÷ doors"
            />
            <StatCard
              label="Doors / hour"
              value={kpis.doorsPerHour != null ? kpis.doorsPerHour.toFixed(1) : '—'}
              hint="While on doors"
            />
            <StatCard
              label="Knocking"
              value={`${knockingCount} of ${rosterIds.size}`}
              hint={coordinatorId ? 'Crew + anyone who worked' : 'Roster + anyone who worked'}
            />
          </div>

          {/* Every team at once. One client asks for their own crew's number; the candidate asks for
              all of them. Filtering one at a time means checking three times and adding up by hand —
              which is where the mistake gets made. The total line proves the arithmetic closes. */}
          {!coordinatorId && breakdown.ready && (breakdown.teams || []).length > 1 && (
            <TeamBreakdown data={breakdown} onPick={setCoordinatorId} />
          )}

          {/* Clicking a team row above swaps the whole page to that crew — and the table you clicked
              disappears with it, leaving the header dropdown as the only (unobvious) way back. This
              is that way back. */}
          {coordinatorId && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-sunken px-3 py-2">
              <span className="text-sm text-fg">
                Showing{' '}
                <span className="font-semibold">
                  {coordinatorId === 'none'
                    ? 'canvassers with no team'
                    : `${coordinatorOptions.find((c) => c.id === coordinatorId)?.name || 'this team'}'s crew`}
                </span>{' '}
                only — every number on this page is scoped to them.
              </span>
              <button
                type="button"
                onClick={() => setCoordinatorId('')}
                className="ml-auto shrink-0 rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-card"
              >
                ← All teams
              </button>
            </div>
          )}

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
              {allTime && (
                <p className="text-sm text-fg-muted">
                  Campaign to date — everyone who has worked this campaign, including anyone who has
                  since left the team. The hour-by-hour grid and overlap reconciliation need a range
                  of {TIMELINE_MAX_DAYS} days or less; pick a shorter range to see them.
                </p>
              )}
              {/* Campaign-to-date ships no hour/day buckets — that is exactly what lets it escape
                  the 62-day cap — so there is no grid to draw and no per-door overlap cards to
                  reconcile. The Doors/Surveys/rates above are complete either way. */}
              {!allTime && (
                <>
                  <TimelineOverlaps
                    data={data}
                    note={coordinatorId ? 'Overlap totals are campaign-wide (not filtered to this crew).' : null}
                  />
                  <TimelineGrid data={data} rows={filteredRows} metric={metric} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
