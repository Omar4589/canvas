import { ratePct, rateAccent } from '../lib/rates.js';

const RATE_TEXT = { green: 'text-success', amber: 'text-warning', red: 'text-danger' };

// 9 → "9a", 12 → "12p", 17 → "5p"
function formatHour(h) {
  const ampm = h < 12 ? 'a' : 'p';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}${ampm}`;
}

// Heatmap grid: rows = canvassers, columns = the day's active hours, cells = knocks (or surveys).
// First column is frozen (sticky) so it stays visible while the hour columns scroll horizontally.
export default function TimelineGrid({ data, metric }) {
  const hours = data?.hours || [];
  const canvassers = data?.canvassers || [];
  const byHourKey = metric === 'surveys' ? 'surveysByHour' : 'knocksByHour';
  const totalsKey = metric === 'surveys' ? 'surveys' : 'knocks';
  const hourTotals = data?.hourTotals?.[totalsKey] || {};

  // Grid-wide max for the active metric → heatmap intensity basis (recomputed when metric flips).
  let maxCell = 0;
  for (const c of canvassers) {
    for (const h of hours) {
      const v = c[byHourKey]?.[h] || 0;
      if (v > maxCell) maxCell = v;
    }
  }
  const cellBg = (v) => (v && maxCell ? `rgba(59,130,246,${(0.12 + 0.88 * (v / maxCell)).toFixed(3)})` : undefined);

  // name + hours + Knocks + Surveys + Conn
  const gridTemplateColumns = `220px repeat(${hours.length}, minmax(40px, 1fr)) 64px 64px 56px`;
  const FROZEN = 'sticky left-0 z-10';

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="min-w-max text-sm" style={{ display: 'grid', gridTemplateColumns }}>
        {/* Header */}
        <div className={`${FROZEN} border-b border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted`}>
          Canvasser
        </div>
        {hours.map((h) => (
          <div key={h} className="border-b border-border px-1 py-2 text-center text-xs font-medium tabular-nums text-fg-muted">
            {formatHour(h)}
          </div>
        ))}
        <div className="border-b border-border px-2 py-2 text-right text-xs font-semibold text-fg-muted">Knocks</div>
        <div className="border-b border-border px-2 py-2 text-right text-xs font-semibold text-fg-muted">Surveys</div>
        <div className="border-b border-border px-2 py-2 text-right text-xs font-semibold text-fg-muted">Conn</div>

        {/* Rows */}
        {canvassers.map((c) => (
          <Row key={c.userId} c={c} hours={hours} byHourKey={byHourKey} cellBg={cellBg} frozen={FROZEN} />
        ))}

        {/* Totals footer */}
        <div className={`${FROZEN} border-t border-border bg-sunken px-3 py-2 text-xs font-semibold text-fg`}>Total</div>
        {hours.map((h) => (
          <div key={h} className="border-t border-border bg-sunken px-1 py-2 text-center text-xs font-semibold tabular-nums text-fg">
            {hourTotals[h] || ''}
          </div>
        ))}
        <div className="border-t border-border bg-sunken px-2 py-2 text-right text-xs font-bold tabular-nums text-fg">
          {(data?.grandKnocks || 0).toLocaleString()}
        </div>
        <div className="border-t border-border bg-sunken px-2 py-2 text-right text-xs font-bold tabular-nums text-fg">
          {(data?.grandSurveys || 0).toLocaleString()}
        </div>
        <div className="border-t border-border bg-sunken px-2 py-2 text-right text-xs text-fg-muted">—</div>
      </div>
    </div>
  );
}

function Row({ c, hours, byHourKey, cellBg, frozen }) {
  return (
    <>
      <div className={`${frozen} border-b border-border bg-card px-3 py-2`}>
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-fg">
            {c.firstName} {c.lastName}
          </span>
          {c.inOverlap && (
            <span title="Knocked an overlapping door today" className="text-warning-fg">
              ⚠
            </span>
          )}
          {c.isActive === false && (
            <span className="rounded bg-sunken px-1 text-[10px] font-medium text-fg-subtle">inactive</span>
          )}
        </div>
        <div className="truncate text-xs text-fg-muted">{c.email}</div>
      </div>
      {hours.map((h) => {
        const v = c[byHourKey]?.[h] || 0;
        return (
          <div
            key={h}
            className="border-b border-border px-1 py-2 text-center text-xs tabular-nums text-fg"
            style={{ backgroundColor: cellBg(v) }}
          >
            {v || ''}
          </div>
        );
      })}
      <div className="border-b border-border px-2 py-2 text-right text-xs font-semibold tabular-nums text-fg">
        {(c.dayKnocks || 0).toLocaleString()}
      </div>
      <div className="border-b border-border px-2 py-2 text-right text-xs tabular-nums text-fg">
        {(c.daySurveys || 0).toLocaleString()}
      </div>
      <div className={`border-b border-border px-2 py-2 text-right text-xs font-semibold tabular-nums ${RATE_TEXT[rateAccent(c.connectionRate)] || 'text-fg-muted'}`}>
        {ratePct(c.connectionRate)}
      </div>
    </>
  );
}
