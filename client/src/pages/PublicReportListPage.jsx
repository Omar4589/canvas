import { useMemo, useState } from 'react';
import { Link, Navigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Button, Card, Select, Tabs } from '../components/ui/index.js';
import { IconChevronRight } from '../components/ui/icons.jsx';
import { formatWeekRange } from '../lib/datePresets.js';
import { classifyShareError, endsShareSession, SHARE_COPY } from '../lib/shareErrors.js';
import {
  doorsTrend,
  formatCount,
  groupReportsBySeries,
  hubShowsLit,
  latestChangeText,
  pickSeries,
  scopeText,
  seriesHeading,
  shortDate,
  shortRange,
  totalsSinceText,
} from '../lib/reportDerive.js';

// The hub (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §H2): a tab per series — the whole campaign,
// each team, each walk list — and for the chosen one its latest report, a small chart of doors
// knocked in each report, and every report newest first. Read later than the report pages, so it
// names dates ("+412" for "Oct 13 – Oct 19"), never "this week". The tab rides the URL (?tab=), so
// a report's "All reports" link returns to it.
//
// A link to one report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D) has no hub: the server answers
// `single` with that report's row alone, and this page opens the report in its place — `replace`, so
// Back leaves rather than landing here again. A taken-down or removed report (`gone`, or no row)
// says so, with nowhere else to send anyone.

function DeltaPill({ n }) {
  // text-success-fg on the tint passes contrast (§H3); the bare success green didn't.
  return <span className="rounded-full bg-success-tint px-1.5 py-0.5 text-xs font-medium text-success-fg">{`+${formatCount(n)}`}</span>;
}

function Figure({ label, total, delta }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-semibold text-fg">{formatCount(total)}</span>
        {delta > 0 && <DeltaPill n={delta} />}
      </div>
    </div>
  );
}

function LatestCard({ token, report, isLit }) {
  const c = report.headline?.cumulative || {};
  // An all-time report (Latest progress, SIMPLIFY §N) has nothing new to show: no "+" figures.
  const p = report.allTime ? {} : report.headline?.period || {};
  const change = latestChangeText(report);
  const title = report.title || (report.allTime ? 'All time' : '');
  return (
    <Link to={`/r/${token}/reports/${report.id}`} className="block rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="p-5 transition-colors hover:bg-sunken">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            {`Latest · ${formatWeekRange(report.weekStart, report.weekEnd)} · ${scopeText(report)}`}
          </div>
          {change && <div className="text-xs text-fg-muted">{change}</div>}
        </div>
        {title && <div className="mt-1 font-medium text-fg">{title}</div>}
        <div className="mt-3 grid grid-cols-2 gap-4 sm:flex sm:gap-12">
          <Figure label="Doors knocked" total={c.doorsKnocked} delta={p.doorsKnocked} />
          {isLit ? (
            <Figure label="Lit dropped" total={c.litKnocks} delta={p.litKnocks} />
          ) : (
            <Figure label="Surveys taken" total={c.surveysTaken} delta={p.surveysTaken} />
          )}
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          {report.allTime ? (
            totalsSinceText(report)
          ) : (
            <>
              {`Totals since the campaign began. The + figures are for ${shortRange(report.weekStart, report.weekEnd)}.`}
              {report.numbersThrough ? ` Numbers as of ${shortDate(report.numbersThrough)} — the period was still running.` : ''}
            </>
          )}
        </p>
        <div className="mt-2 text-sm font-medium text-brand-accent">Open the report ›</div>
      </Card>
    </Link>
  );
}

/**
 * Doors knocked in each report of the tab, oldest to newest — one series, so no legend: the caption
 * says what it plots with its first and last values, and the aria-label says it in full. Bars from
 * zero (a cut axis would overstate the growth), the latest in the accent. The list below is its table.
 */
export function DoorsTrend({ reports }) {
  const points = useMemo(() => doorsTrend(reports), [reports]);
  const [hover, setHover] = useState(null);
  if (points.length < 2) return null;
  const max = Math.max(1, ...points.map((pt) => pt.value));
  const first = points[0];
  const last = points[points.length - 1];
  const label = `Doors knocked in each report: from ${formatCount(first.value)} in the ${first.label} report to ${formatCount(last.value)} in the ${last.label} report, across ${points.length} reports.`;
  const focus = hover != null ? points[hover] : null;
  return (
    <Card className="p-4">
      <figure role="img" aria-label={label} className="m-0">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-fg-muted">
          <span>
            Doors knocked in each report: <span className="font-semibold text-fg">{formatCount(first.value)}</span> …{' '}
            <span className="font-semibold text-fg">{formatCount(last.value)}</span>
          </span>
          <span className="text-xs">{focus ? `${focus.label}: ${formatCount(focus.value)} doors` : `${first.label} to ${last.label}`}</span>
        </figcaption>
        <div className="mt-3 flex h-14 items-end gap-0.5" onMouseLeave={() => setHover(null)}>
          {points.map((pt, i) => (
            <div key={pt.id} className="flex h-full min-w-0 max-w-[24px] flex-1 items-end" onMouseEnter={() => setHover(i)}>
              <div
                className={`w-full rounded-t ${i === points.length - 1 ? 'bg-brand-600' : 'bg-fg-subtle'} ${hover === i ? 'opacity-75' : ''}`}
                style={{ height: `${Math.max(3, (pt.value / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      </figure>
    </Card>
  );
}

function ReportRows({ token, reports }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">All reports, newest first</h2>
      <Card className="divide-y divide-border p-0">
        {reports.map((r) => {
          const c = r.headline?.cumulative || {};
          // An all-time report (§N): no "+" figure, and "All time" when it has no title of its own.
          const p = r.allTime ? {} : r.headline?.period || {};
          const change = latestChangeText(r);
          const title = r.title || (r.allTime ? 'All time' : '');
          return (
            <Link
              key={r.id}
              to={`/r/${token}/reports/${r.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken focus:outline-none focus-visible:bg-sunken"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-fg">
                  {formatWeekRange(r.weekStart, r.weekEnd)}
                  {title ? <span className="font-normal text-fg-muted"> · {title}</span> : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                  <span>
                    <span className="font-semibold text-fg">{formatCount(c.doorsKnocked)}</span> doors
                  </span>
                  {p.doorsKnocked > 0 && <DeltaPill n={p.doorsKnocked} />}
                  {change && <span className="text-xs">{change}</span>}
                  {r.numbersThrough && <span className="text-xs">Numbers as of {shortDate(r.numbersThrough)}</span>}
                </div>
              </div>
              <IconChevronRight size={16} className="shrink-0 text-fg-subtle" />
            </Link>
          );
        })}
      </Card>
    </section>
  );
}

export default function PublicReportListPage() {
  const { token, hubQ } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const groups = useMemo(() => groupReportsBySeries(hubQ.data?.reports || []), [hubQ.data]);
  const current = pickSeries(groups, params.get('tab'));
  const choose = (key) => setParams({ tab: key }, { replace: true });

  if (hubQ.isLoading) return <div className="text-sm text-fg-muted">Loading…</div>;
  if (hubQ.error) {
    // A 401 or a dead link already took the page to the gate or the notice.
    if (endsShareSession(classifyShareError(hubQ.error).kind)) return null;
    return (
      <Card className="p-6 text-sm text-fg-muted">
        {SHARE_COPY.retry} the reports.{' '}
        <Button variant="secondary" size="sm" className="ml-2" onClick={() => hubQ.refetch()}>
          Try again
        </Button>
      </Card>
    );
  }
  if (hubQ.data?.single) {
    const row = hubQ.data.gone ? null : hubQ.data.reports?.[0];
    if (row) return <Navigate replace to={`/r/${token}/reports/${row.id}`} />;
    return <Card className="p-6 text-sm text-fg-muted">{SHARE_COPY.reportGoneSingle}</Card>;
  }
  if (!current) {
    return <Card className="p-6 text-sm text-fg-muted">No reports are available on this link right now.</Card>;
  }

  const isLit = hubShowsLit(current.reports);
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-fg">{seriesHeading(current.reports)}</h1>
      {groups.length > 1 && (
        <>
          <div className="hidden md:block">
            <Tabs label="Reports for" tabs={groups.map((g) => ({ key: g.key, label: g.label }))} value={current.key} onChange={choose} />
          </div>
          <label className="block md:hidden">
            <span className="sr-only">Reports for</span>
            <Select className="w-full" value={current.key} onChange={(e) => choose(e.target.value)}>
              {groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </Select>
          </label>
        </>
      )}
      <div id={`panel-${current.key}`} role={groups.length > 1 ? 'tabpanel' : undefined} aria-labelledby={groups.length > 1 ? `tab-${current.key}` : undefined} className="space-y-5">
        <LatestCard token={token} report={current.reports[0]} isLit={isLit} />
        <DoorsTrend reports={current.reports} />
        <ReportRows token={token} reports={current.reports} />
      </div>
    </div>
  );
}
