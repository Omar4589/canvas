import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth, useOrgTimeZone } from '../auth/AuthContext.jsx';
import DateRangeSelector, { RANGE_PRESETS } from '../components/DateRangeSelector.jsx';
import { todayInTz, defaultRange, labelForRange } from '../lib/datePresets.js';
import StatCard from '../components/StatCard.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import { livePollOptions, liveStatusProps } from '../lib/livePoll.js';
import Segmented from '../components/ui/Segmented.jsx';
import AuditSummaryTable from '../components/AuditSummaryTable.jsx';
import FlaggedEntryList from '../components/FlaggedEntryList.jsx';
import FlagLegend from '../components/FlagLegend.jsx';
import BulkReviewBar from '../components/BulkReviewBar.jsx';
import { REASON_META, SEV_RANK } from '../lib/flags.js';
import { postBulkReview, countBulkReview, undoBulkReview, invalidateFlagCaches, BULK_VERB } from '../lib/bulkReview.js';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// The flags endpoint caps ranges at 62 days (detectFlags loads every matched row into memory —
// this is an OOM guard, unlike the Timeline's rendering cap), so this page drops "All time".
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

// MIN-severity filter — "Med+" means med or high, matching the server's `severity` param
// (>= rank). Exact-match chips would make what's selected diverge from what a bulk call
// scoped with the same value writes.
const SEVERITY_OPTIONS = [
  { value: '', label: 'Any severity' },
  { value: 'med', label: 'Med+' },
  { value: 'high', label: 'High' },
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
  const { homePath, isOrgAdmin } = useAuth();
  // Deep link from the dashboard's mock-GPS banner:
  // ?reason=mock_gps&status=open&from=YYYY-MM-DD&to=YYYY-MM-DD — seeded ONCE via the
  // state initializers (MapPage's ?flag=1/?focusActivityId pattern). Initializers don't
  // re-run without a remount, which holds because the banner is the only param-carrying
  // entry point (a different route → fresh mount); sidebar/BottomNav Audit links must
  // stay parameterless.
  const [searchParams] = useSearchParams();
  const [dateRange, setDateRange] = useState(() => {
    const from = searchParams.get('from');
    if (!from) return null;
    return { preset: 'custom', from, to: searchParams.get('to') || null };
  });
  const rangeTouchedRef = useRef(!!searchParams.get('from'));
  const [effortId, setEffortId] = useState('');
  const [reasonFilter, setReasonFilter] = useState(() => {
    const r = searchParams.get('reason');
    return REASON_META.some((m) => m.key === r) ? [r] : []; // [] = all reasons
  });
  const [reviewStatus, setReviewStatus] = useState(() => {
    const s = searchParams.get('status');
    return REVIEW_STATUS.some((o) => o.value === s) ? s : 'open';
  });
  const [severityMin, setSeverityMin] = useState(''); // '' | 'med' | 'high' (min severity)
  const [userId, setUserId] = useState(''); // drill-in to one canvasser

  // Bulk review. `selectedIds` ⊆ the shown entries (checkboxes); `scopeMode` instead acts on
  // EVERY flag matching the displayed filters — the escape hatch when the fetch is capped at
  // ENTRY_LIMIT and checkboxes can't reach the rest. While either is armed the live poll
  // pauses, so the list can't shift under the checkboxes mid-triage.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [scopeMode, setScopeMode] = useState(false);
  const [scopeCount, setScopeCount] = useState(0);
  const [scopeCountLoading, setScopeCountLoading] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkBusy, setBulkBusy] = useState(null);
  const [bulkToast, setBulkToast] = useState(null); // { text, error?, undo?: { scope, ids } }
  const bulkToastTimer = useRef(null);
  useEffect(() => () => clearTimeout(bulkToastTimer.current), []);
  const selectionArmed = scopeMode || selectedIds.size > 0;

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
    // Refresh this page + mark the Map's flags query AND the mock-GPS nudge counts
    // (sidebar/BottomNav badge via ['admin','campaigns'], dashboard banner via the
    // rollup) stale — reviewing a flag must clear the badges immediately.
    qc.invalidateQueries({
      predicate: (q) =>
        (q.queryKey?.[0] === 'admin' && (q.queryKey?.[1] === 'flags-map' || q.queryKey?.[1] === 'campaigns')) ||
        (q.queryKey?.[0] === 'reports' && (q.queryKey?.[1] === 'flags' || q.queryKey?.[1] === 'campaign-rollup')),
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
    setSeverityMin('');
    setUserId('');
    setSelectedIds(new Set());
    setScopeMode(false);
    setBulkNote('');
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
  // Cause kept separately so the notice can say what's actually wrong with the range.
  const rangeNoStart = !!dateRange && !fromDay;
  const rangeInverted = !!dateRange && !!fromDay && fromDay > effectiveTo;
  const rangeTooLong =
    !!dateRange && !!fromDay && !rangeInverted && ymdSpanDays(fromDay, effectiveTo) > AUDIT_MAX_DAYS;
  const rangeInvalid = rangeNoStart || rangeInverted || rangeTooLong;

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
    // Poll pauses while a bulk selection is armed — a refetch would reorder/remove entries
    // under the checkboxes. Cache invalidation after a bulk write still refetches.
    ...livePollOptions(live && !selectionArmed, includesToday),
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
    if (severityMin) {
      const min = SEV_RANK[severityMin] || 0;
      list = list.filter((e) => (SEV_RANK[e.maxSeverity] || 0) >= min);
    }
    return list;
  }, [entries, userId, reasonFilter, severityMin]);

  function toggleReason(key) {
    setReasonFilter((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  }

  // ——— Bulk review ———

  // Keep the selection honest as data/filters change (poll results, chip toggles): anything
  // no longer shown is deselected, so the bar's count always equals visible checkboxes.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const shown = new Set(shownEntries.map((e) => e.actionId));
      const next = new Set([...prev].filter((id) => shown.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [shownEntries]);

  // The DISPLAYED scope — what's actually on screen — NOT the fetch's query. The GET
  // deliberately omits userId (so the summary table lists everyone) and applies
  // userId/reason/severity client-side; a bulk call composed from the fetch params would act
  // far wider than the list the admin is looking at.
  const bulkScope = useMemo(
    () => ({
      campaignId,
      effortId: effortId || undefined,
      from: fromDay,
      to: dateRange?.to || undefined,
      reviewStatus: reviewStatus === 'all' ? undefined : reviewStatus,
      userId: userId || undefined,
      reasonType: reasonFilter.length ? reasonFilter.join(',') : undefined,
      severity: severityMin || undefined,
    }),
    [campaignId, effortId, fromDay, dateRange?.to, reviewStatus, userId, reasonFilter, severityMin]
  );

  const allShownSelected = shownEntries.length > 0 && shownEntries.every((e) => selectedIds.has(e.actionId));

  function toggleSelect(actionId) {
    setScopeMode(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
  }

  function toggleSelectAllShown() {
    setScopeMode(false);
    setSelectedIds(allShownSelected ? new Set() : new Set(shownEntries.map((e) => e.actionId)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setScopeMode(false);
    setBulkNote('');
  }

  function showBulkToast(toast, ms = 10000) {
    setBulkToast(toast);
    clearTimeout(bulkToastTimer.current);
    bulkToastTimer.current = setTimeout(() => setBulkToast(null), ms);
  }

  // "Act on every flag matching the filters" — the exact count comes from a dry run (the
  // shown list is capped at ENTRY_LIMIT, so no local number is trustworthy here).
  async function enterScopeMode() {
    setScopeMode(true);
    setScopeCountLoading(true);
    try {
      setScopeCount(await countBulkReview(bulkScope));
    } catch (err) {
      setScopeMode(false);
      showBulkToast({ text: err?.message || 'Could not count the matching flags.', error: true });
    } finally {
      setScopeCountLoading(false);
    }
  }

  async function runBulk(status) {
    if (bulkBusy) return;
    setBulkBusy(status);
    try {
      const res = await postBulkReview(bulkScope, {
        status,
        note: bulkNote.trim() || undefined,
        ...(scopeMode ? {} : { actionIds: [...selectedIds] }),
      });
      invalidateFlagCaches(qc);
      const created = res.createdActionIds || [];
      const overwritten = (res.overwrittenActionIds || []).length;
      const n = status === 'open' ? res.deleted ?? res.matched : res.matched;
      let text = `${n.toLocaleString()} ${BULK_VERB[status] || 'updated'}`;
      if (overwritten > 0 && status !== 'open') {
        text += ` · ${overwritten.toLocaleString()} already had a decision (updated — not undoable)`;
      }
      showBulkToast({
        text,
        // Undo reopens only the decisions this bulk CREATED — see lib/bulkReview.js.
        undo: status !== 'open' && created.length ? { scope: bulkScope, ids: created } : null,
      });
      clearSelection();
    } catch (err) {
      showBulkToast({ text: err?.message || 'Bulk review failed.', error: true });
    } finally {
      setBulkBusy(null);
    }
  }

  async function runUndo(undo) {
    setBulkToast(null);
    try {
      const res = await undoBulkReview(undo.scope, undo.ids);
      invalidateFlagCaches(qc);
      showBulkToast({ text: `${(res.deleted ?? 0).toLocaleString()} reopened` }, 4000);
    } catch (err) {
      showBulkToast({ text: err?.message || 'Undo failed.', error: true });
    }
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
              {...liveStatusProps([flagsQ], { live, onToggle: () => setLive((v) => !v) })}
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
            <FlagLegend className="ml-0.5 self-center" />
          </div>
          <Segmented value={severityMin} onChange={setSeverityMin} options={SEVERITY_OPTIONS} size="sm" />
          <Segmented value={reviewStatus} onChange={setReviewStatus} options={REVIEW_STATUS} />
        </div>
        <DateRangeSelector value={dateRange} onChange={onRangeChange} tz={tz} presets={AUDIT_PRESETS} requireFrom />
      </div>

      {rangeInvalid ? (
        <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center">
          <p className="text-sm font-medium text-fg">That range won't work for the audit</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
            {rangeNoStart
              ? 'This range has no start date. Pick a From date to bound the audit.'
              : rangeInverted
                ? 'The start date is after the end date. Pick a From date on or before the To date.'
                : `That range spans more than ${AUDIT_MAX_DAYS} days. Narrow the range and try again.`}
          </p>
        </div>
      ) : flagsQ.isLoading || !dateRange ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
      ) : flagsQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error: {flagsQ.error.message}
        </div>
      ) : data.truncated ? (
        <div className="rounded-lg border border-warning/30 bg-warning-tint p-4 text-sm text-warning-fg">
          This range has <strong>{(data.windowActionCount || 0).toLocaleString()}</strong> events — too many to
          audit at once. Narrow the date range (or filter by canvasser) and try again.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-7">
            <StatCard label="Open" value={(totals?.open || 0).toLocaleString()} hint="Need review" />
            <StatCard label="Mock" value={(totals?.mockGps || 0).toLocaleString()} hint="Mock location app" />
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
              <div className="flex items-center gap-3">
                {shownEntries.length > 0 && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-fg-muted">
                    <input
                      type="checkbox"
                      checked={allShownSelected}
                      onChange={toggleSelectAllShown}
                      className="h-3.5 w-3.5 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
                    />
                    Select all shown
                  </label>
                )}
                {userId && (
                  <button
                    type="button"
                    onClick={() => setUserId('')}
                    className="text-xs font-medium text-brand-accent hover:underline"
                  >
                    Show all canvassers
                  </button>
                )}
                {/* Detection → remedy: this page finds the suspect entries, Door Outcomes
                    rewrites them. Hand over the drilled canvasser and this page's window. */}
                {userId && isOrgAdmin && (
                  <Link
                    to={`/campaigns/${campaignId}/outcomes?${new URLSearchParams(
                      Object.fromEntries(
                        Object.entries({
                          userId,
                          dateFrom: dateRange?.from || '',
                          dateTo: dateRange?.to || '',
                        }).filter(([, v]) => v)
                      )
                    )}`}
                    className="text-xs font-medium text-brand-accent hover:underline"
                  >
                    Correct their entries in Door Outcomes
                  </Link>
                )}
              </div>
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
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          </div>
        </div>
      )}
      {selectionArmed && !rangeInvalid && (
        <BulkReviewBar
          count={scopeMode ? scopeCount : selectedIds.size}
          scopeMode={scopeMode}
          scopeCountLoading={scopeCountLoading}
          note={bulkNote}
          onNoteChange={setBulkNote}
          busy={bulkBusy}
          onAction={runBulk}
          onClear={clearSelection}
          showReopen={reviewStatus !== 'open'}
          canSelectAllMatching={truncated && allShownSelected}
          onSelectAllMatching={enterScopeMode}
        />
      )}
      {bulkToast && (
        <div
          className={
            // Sits above the action bar when one is showing (an error toast can coexist with it).
            'fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-fg px-4 py-2 text-xs font-medium text-bg shadow-lg ' +
            (selectionArmed ? 'bottom-24' : 'bottom-6')
          }
        >
          <span>
            {bulkToast.error ? '' : '✓ '}
            {bulkToast.text}
          </span>
          {bulkToast.undo && (
            <button type="button" onClick={() => runUndo(bulkToast.undo)} className="font-semibold underline">
              Undo
            </button>
          )}
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
