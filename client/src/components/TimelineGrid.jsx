import { shiftDays } from '../lib/datePresets.js';

// 9 → "9a", 12 → "12p", 17 → "5p"
function formatHour(h) {
  const ampm = h < 12 ? 'a' : 'p';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}${ampm}`;
}

// "2026-07-06" → "7/6" (label) — pure string math, no Date/tz involved.
function formatDayCol(ymd) {
  const [, m, d] = ymd.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// "2026-01-05" → "2026-01-05 – 2026-01-11", clipped to the requested range so a partial
// first/last week's tooltip never names days outside the window (lexical ymd compare).
function weekTitle(weekStart, range) {
  const start = range?.from && range.from > weekStart ? range.from : weekStart;
  let end = shiftDays(weekStart, 6);
  if (range?.to && range.to < end) end = range.to;
  return `${start} – ${end}`;
}

// Heatmap grid: rows = canvassers, columns = the day's active hours (single-day view), the
// range's days (multi-day view), or the range's weeks (bucket:'week' — days[] carries Monday
// week-starts and the maps are keyed by them, so the column plumbing is identical; only the
// tooltip says a column is a span). Cells = knocks (or surveys). First column is frozen
// (sticky) so it stays visible while the bucket columns scroll horizontally.
//
// `rows` is the (possibly coordinator-filtered) canvasser list from TimelinePage — column
// and grand totals are derived from it, NOT from data.hourTotals/grandKnocks, so the grid
// always agrees with the filtered table and KPIs above it. Per-row summary columns live in
// CanvasserSummaryTable now, not here.
export default function TimelineGrid({ data, rows, metric }) {
  const isRange = data?.mode === 'range';
  const isWeek = data?.bucket === 'week';
  const columns = isRange
    ? (data?.days || []).map((d) => ({
        key: d,
        label: formatDayCol(d),
        title: isWeek ? weekTitle(d, data?.range) : d,
      }))
    : (data?.hours || []).map((h) => ({ key: h, label: formatHour(h), title: undefined }));
  const bucketKey = isRange
    ? metric === 'surveys'
      ? 'surveysByDay'
      : 'knocksByDay'
    : metric === 'surveys'
      ? 'surveysByHour'
      : 'knocksByHour';
  const canvassers = rows || [];

  // Grid-wide max for the active metric → heatmap intensity basis (recomputed when metric flips).
  let maxCell = 0;
  for (const c of canvassers) {
    for (const col of columns) {
      const v = c[bucketKey]?.[col.key] || 0;
      if (v > maxCell) maxCell = v;
    }
  }
  const cellBg = (v) => (v && maxCell ? `rgba(59,130,246,${(0.12 + 0.88 * (v / maxCell)).toFixed(3)})` : undefined);

  // Column totals from the visible rows (respects the coordinator filter).
  const colTotals = {};
  let grandTotal = 0;
  for (const c of canvassers) {
    for (const col of columns) {
      const v = c[bucketKey]?.[col.key] || 0;
      if (v) colTotals[col.key] = (colTotals[col.key] || 0) + v;
    }
    grandTotal += metric === 'surveys' ? c.daySurveys || 0 : c.dayKnocks || 0;
  }

  const gridTemplateColumns = `220px repeat(${columns.length}, minmax(40px, 1fr)) 72px`;
  const FROZEN = 'sticky left-0 z-10';

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="min-w-max text-sm" style={{ display: 'grid', gridTemplateColumns }}>
        {/* Header */}
        <div className={`${FROZEN} border-b border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted`}>
          Canvasser
        </div>
        {columns.map((col) => (
          <div
            key={col.key}
            title={col.title}
            className="border-b border-border px-1 py-2 text-center text-xs font-medium tabular-nums text-fg-muted"
          >
            {col.label}
          </div>
        ))}
        <div className="border-b border-border px-2 py-2 text-right text-xs font-semibold text-fg-muted">
          {metric === 'surveys' ? 'Surveys' : 'Knocks'}
        </div>

        {/* Rows */}
        {canvassers.map((c) => (
          <Row key={c.userId} c={c} columns={columns} bucketKey={bucketKey} metric={metric} cellBg={cellBg} frozen={FROZEN} />
        ))}

        {/* Totals footer */}
        <div className={`${FROZEN} border-t border-border bg-sunken px-3 py-2 text-xs font-semibold text-fg`}>Total</div>
        {columns.map((col) => (
          <div
            key={col.key}
            className="border-t border-border bg-sunken px-1 py-2 text-center text-xs font-semibold tabular-nums text-fg"
          >
            {colTotals[col.key] || ''}
          </div>
        ))}
        <div className="border-t border-border bg-sunken px-2 py-2 text-right text-xs font-bold tabular-nums text-fg">
          {grandTotal.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function Row({ c, columns, bucketKey, metric, cellBg, frozen }) {
  return (
    <>
      <div className={`${frozen} border-b border-border bg-card px-3 py-2`}>
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-fg">
            {c.firstName} {c.lastName}
          </span>
          {c.inOverlap && (
            <span title="Knocked an overlapping door in this range" className="text-warning-fg">
              ⚠
            </span>
          )}
          {c.isActive === false && (
            <span className="rounded bg-sunken px-1 text-[10px] font-medium text-fg-subtle">inactive</span>
          )}
        </div>
        <div className="truncate text-xs text-fg-muted">{c.email}</div>
      </div>
      {columns.map((col) => {
        const v = c[bucketKey]?.[col.key] || 0;
        return (
          <div
            key={col.key}
            className="border-b border-border px-1 py-2 text-center text-xs tabular-nums text-fg"
            style={{ backgroundColor: cellBg(v) }}
          >
            {v || ''}
          </div>
        );
      })}
      <div className="border-b border-border px-2 py-2 text-right text-xs font-semibold tabular-nums text-fg">
        {(metric === 'surveys' ? c.daySurveys || 0 : c.dayKnocks || 0).toLocaleString()}
      </div>
    </>
  );
}
