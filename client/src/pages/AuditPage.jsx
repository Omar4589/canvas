import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import DateRangeSelector, { RANGE_PRESETS } from '../components/DateRangeSelector.jsx';
import { todayInTz, defaultRange, labelForRange } from '../lib/datePresets.js';
import StatCard from '../components/StatCard.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import Segmented from '../components/ui/Segmented.jsx';
import AuditSummaryTable from '../components/AuditSummaryTable.jsx';
import FlaggedEntryList from '../components/FlaggedEntryList.jsx';
import { REASON_META } from '../lib/flags.js';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// The endpoint caps ranges at 62 days, so (like the Timeline) this page drops "All time".
const AUDIT_PRESETS = RANGE_PRESETS.filter((p) => p.id !== 'all');
const AUDIT_MAX_DAYS = 62;
const ENTRY_LIMIT = 500; // fetch cap; the summary is always the full picture

function ymdSpanDays(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

const REVIEW_STATUS = [
  { value: 'open', label: 'Open' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'all', label: 'All' },
];

// Verb shown in the brief post-review confirmation toast.
const FLAG_FLASH_LABEL = { reviewed: 'reviewed', dismissed: 'dismissed', confirmed: 'confirmed as an issue', open: 'reopened' };

// GPS canvassing-quality audit. A per-canvasser flag breakdown (who, how many, why) over the
// range, plus a reviewable drill-in list. Flags are computed live from the door-action ledger;
// the summary (KPIs + table) is always the full picture, while the reason chips + status +
// canvasser selection narrow the entries you review. "View on map" jumps to the geographic view.
export default function AuditPage() {
  const { campaignId } = useParams();
  const orgTz = useOrgTimeZone();
  const { homePath } = useAuth();
  const [dateRange, setDateRange] = useState(null);
  const rangeTouchedRef = useRef(false);
  const [effortId, setEffortId] = useState('');
  const [reasonFilter, setReasonFilter] = useState([]); // [] = all reasons
  const [reviewStatus, setReviewStatus] = useState('open');
  const [userId, setUserId] = useState(''); // drill-in to one canvasser

  const qc = useQueryClient();
  // Brief confirmation after a flag review, mirroring the Map surface.
  const [flagFlash, setFlagFlash] = useState(null);
  const flagFlashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flagFlashTimer.current), []);
  function onFlagReviewed(review) {
    const status = review?.status || 'updated';
    setFlagFlash(FLAG_FLASH_LABEL[status] || 'updated');
    clearTimeout(flagFlashTimer.current);
    flagFlashTimer.current = setTimeout(() => setFlagFlash(null), 2500);
    // Refresh this page + mark the Map's flags query stale (cross-surface sync).
    qc.invalidateQueries({
      predicate: (q) =>
        (q.queryKey?.[0] === 'admin' && q.queryKey?.[1] === 'flags-map') ||
        (q.queryKey?.[0] === 'reports' && q.queryKey?.[1] === 'flags'),
    });
  }

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

  // Reset all campaign-scoped view state when the admin switches campaigns (one mounted
  // element serves every /campaigns/:id/audit).
  const [prevCampaignId, setPrevCampaignId] = useState(campaignId);
  if (prevCampaignId !== campaignId) {
    setPrevCampaignId(campaignId);
    setEffortId('');
    setReasonFilter([]);
    setReviewStatus('open');
    setUserId('');
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

  // Default the range to the campaign's "today" once its tz is known.
  useEffect(() => {
    if (rangeTouchedRef.current || !tzReady) return;
    setDateRange(defaultRange('today', tz));
  }, [tzReady, tz]);

  function onRangeChange(next) {
    rangeTouchedRef.current = true;
    setDateRange(next);
  }

  const today = todayInTz(tz);
  const fromDay = dateRange ? (dateRange.preset === 'today' ? today : dateRange.from) : null;
  const effectiveTo = dateRange ? dateRange.to || today : null;
  const includesToday = !!dateRange && (!dateRange.to || dateRange.to >= today);
  const rangeInvalid =
    !!dateRange && (!fromDay || fromDay > effectiveTo || ymdSpanDays(fromDay, effectiveTo) > AUDIT_MAX_DAYS);

  // Fetch the full summary + entries for the current review status (reason + canvasser are
  // applied client-side so those toggles are instant). userId is NOT sent so the summary
  // table always lists every canvasser.
  const flagsQ = useQuery({
    queryKey: ['reports', 'flags', campaignId, effortId, fromDay, dateRange?.to, reviewStatus],
    queryFn: () =>
      api(
        `/admin/reports/flags${buildQuery({
          campaignId,
          effortId: effortId || undefined,
          from: fromDay,
          to: dateRange.to || undefined,
          reviewStatus: reviewStatus === 'all' ? undefined : reviewStatus,
          limit: ENTRY_LIMIT,
        })}`
      ),
    enabled: !!campaignId && !!fromDay && !rangeInvalid,
    refetchInterval: live && includesToday ? 20_000 : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
  const data = flagsQ.data || {};
  const summary = data.summary || null;
  const totals = summary?.totals || null;
  const entries = data.entries || [];

  const shownEntries = useMemo(() => {
    let list = entries;
    if (userId) list = list.filter((e) => e.userId === userId);
    if (reasonFilter.length) {
      const set = new Set(reasonFilter);
      list = list.filter((e) => e.reasons.some((r) => set.has(r.type)));
    }
    return list;
  }, [entries, userId, reasonFilter]);

  function toggleReason(key) {
    setReasonFilter((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  }

  const rangeLabel = dateRange ? labelForRange(dateRange) : '';
  const selectedName = userId ? summary?.byCanvasser?.find((c) => c.userId === userId)?.name || 'Canvasser' : '';
  const truncated = (data.total || 0) > entries.length;

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
          <div className="mt-1 text-sm text-fg-muted">Audit — GPS &amp; canvassing quality</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {includesToday && (
            <LiveStatus
              live={live}
              onToggle={() => setLive((v) => !v)}
              isFetching={flagsQ.isFetching}
              updatedAt={flagsQ.dataUpdatedAt}
              onRefresh={() => flagsQ.refetch()}
            />
          )}
          {data.tzAbbrev && (
            <span className="self-center text-xs font-medium text-fg-subtle" title={`Times in ${data.timeZone}`}>
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
          <div className="flex flex-wrap gap-1">
            {REASON_META.map((r) => {
              const active = reasonFilter.includes(r.key);
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => toggleReason(r.key)}
                  title={r.hint}
                  className={
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ' +
                    (active
                      ? 'border-brand-600 bg-brand-tint text-brand-accent'
                      : 'border-border bg-card text-fg-muted hover:bg-sunken')
                  }
                >
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                  {r.short}
                </button>
              );
            })}
          </div>
          <Segmented value={reviewStatus} onChange={setReviewStatus} options={REVIEW_STATUS} />
        </div>
        <DateRangeSelector value={dateRange} onChange={onRangeChange} tz={tz} presets={AUDIT_PRESETS} />
      </div>

      {rangeInvalid ? (
        <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center">
          <p className="text-sm font-medium text-fg">That range won't work for the audit</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
            Pick a start date on or before the end date, spanning at most {AUDIT_MAX_DAYS} days.
          </p>
        </div>
      ) : flagsQ.isLoading || !dateRange ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
      ) : flagsQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error: {flagsQ.error.message}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Open" value={(totals?.open || 0).toLocaleString()} hint="Need review" />
            <StatCard label="Far" value={(totals?.far || 0).toLocaleString()} hint="Far from house" />
            <StatCard label="Rapid" value={(totals?.rapid || 0).toLocaleString()} hint="Too fast apart" />
            <StatCard label="One-spot" value={(totals?.oneSpot || 0).toLocaleString()} hint="From one place" />
            <StatCard label="Weak GPS" value={(totals?.weakGps || 0).toLocaleString()} hint="Unreliable fix" />
            <StatCard label="Total" value={(totals?.flaggedActions || 0).toLocaleString()} hint={`All flags · ${rangeLabel}`} />
          </div>

          <AuditSummaryTable rows={summary?.byCanvasser || []} selectedUserId={userId} onSelect={setUserId} />

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-fg">
                {selectedName ? `${selectedName}'s flagged entries` : 'Flagged entries'}
                <span className="ml-2 text-xs font-normal text-fg-muted">
                  {shownEntries.length.toLocaleString()} shown
                </span>
              </h2>
              {userId && (
                <button
                  type="button"
                  onClick={() => setUserId('')}
                  className="text-xs font-medium text-brand-accent hover:underline"
                >
                  Show all canvassers
                </button>
              )}
            </div>
            {truncated && (
              <div className="mb-2 rounded border border-warning/30 bg-warning-tint px-3 py-1.5 text-xs text-warning-fg">
                Showing the first {ENTRY_LIMIT.toLocaleString()} of {(data.total || 0).toLocaleString()} — narrow
                the date range or filters to see the rest.
              </div>
            )}
            <FlaggedEntryList
              entries={shownEntries}
              tz={tz}
              campaignId={campaignId}
              dateFrom={fromDay}
              dateTo={dateRange.to || undefined}
              onReviewed={(review) => onFlagReviewed(review)}
            />
          </div>
        </div>
      )}
      {flagFlash && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-fg px-3 py-1.5 text-xs font-medium text-bg shadow-lg">
          ✓ Flag {flagFlash}
        </div>
      )}
    </div>
  );
}
