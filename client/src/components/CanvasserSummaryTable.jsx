import { useMemo, useState } from 'react';
import DataTable from './ui/DataTable.jsx';
import Badge from './ui/Badge.jsx';
import InfoHint from './InfoHint.jsx';
import { ratePct, rateLevel } from '../lib/rates.js';
import { formatInTz } from '../lib/datetime.js';
import { metricHelp } from '../lib/metricHelp.js';

// The timeline dashboard's per-canvasser answers table: who knocked, whose crew,
// doors/surveys/rates/pace, when they started and when their last door was. Rows come
// from /admin/reports/canvasser-timeline (already coordinator-joined by TimelinePage).
// Not CanvasserTable: that one renders the leaderboard row shape and opens the
// responses modal on click; this one is sortable and range/day aware.

const TIME_ONLY = { hour: 'numeric', minute: '2-digit' };

const RATE_TEXT = {
  good: 'text-success-fg',
  caution: 'text-warning-fg',
  low: 'text-danger-fg',
};

function rateClass(pct) {
  return RATE_TEXT[rateLevel(pct)] || 'text-fg';
}

// Columns depend on campaign type: the survey column becomes a lit-drop column for
// lit-drop campaigns (both read the corresponding per-canvasser field).
function columnsFor(litMode) {
  return [
    { key: 'name', label: 'Canvasser', numeric: false },
    { key: 'coordinatorName', label: 'Coordinator', numeric: false, help: metricHelp.coordinator },
    { key: 'dayKnocks', label: 'Doors', numeric: true, help: metricHelp.doors },
    litMode
      ? { key: 'dayLit', label: 'Lit drops', numeric: true, help: metricHelp.litDrops }
      : { key: 'daySurveys', label: 'Surveys', numeric: true, help: metricHelp.surveys },
    { key: 'connectionRate', label: 'Conn %', numeric: true, help: metricHelp.connectionRate },
    { key: 'contactRate', label: 'Contact %', numeric: true, help: metricHelp.contactRate },
    { key: 'doorsPerHour', label: 'Doors/hr', numeric: true, help: metricHelp.doorsPerHour },
    { key: 'dayRestricted', label: 'Restricted', numeric: true, help: 'Inaccessible homes flagged — recorded and shown, but never counted as a knock.' },
    { key: 'firstActivityAt', label: 'Start', numeric: true, help: metricHelp.start },
    { key: 'lastActivityAt', label: 'Last door', numeric: true, help: metricHelp.lastDoor },
  ];
}

function sortValue(row, key) {
  if (key === 'name') return `${row.lastName || ''} ${row.firstName || ''}`.trim().toLowerCase();
  if (key === 'coordinatorName') return (row.coordinatorName || '').toLowerCase() || null;
  if (key === 'firstActivityAt' || key === 'lastActivityAt') {
    return row[key] ? new Date(row[key]).getTime() : null;
  }
  if (key === 'doorsPerHour') return row.doorsPerHour > 0 ? row.doorsPerHour : null;
  return row[key] ?? null;
}

export default function CanvasserSummaryTable({ rows, tz, singleDay, litMode = false, onRowClick }) {
  const columns = columnsFor(litMode);
  // Numeric columns open desc (biggest first — the leaderboard instinct); text asc.
  const [sort, setSort] = useState({ key: 'dayKnocks', dir: 'desc' });

  function onSort(col) {
    setSort((s) =>
      s.key === col.key
        ? { key: col.key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
        : { key: col.key, dir: col.numeric ? 'desc' : 'asc' }
    );
  }

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      // Nulls ('—' cells) always sink to the bottom, whichever direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Stable tiebreak so live refetches don't shuffle equal rows.
      const an = sortValue(a, 'name') || '';
      const bn = sortValue(b, 'name') || '';
      return an < bn ? -1 : an > bn ? 1 : a.userId < b.userId ? -1 : 1;
    });
  }, [rows, sort]);

  const timeOpts = singleDay ? TIME_ONLY : undefined;

  return (
    <DataTable
      head={
        <>
          {columns.map((col) => (
            <th
              key={col.key}
              aria-sort={
                sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
              }
              className={`px-3 py-2 ${col.numeric ? 'text-right' : ''}`}
            >
              <span className={`inline-flex items-center gap-1 ${col.numeric ? 'justify-end' : ''}`}>
                <button
                  type="button"
                  onClick={() => onSort(col)}
                  className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg"
                >
                  {col.label}
                  <span className={sort.key === col.key ? 'text-fg' : 'invisible'}>
                    {sort.key === col.key && sort.dir === 'asc' ? '▲' : '▼'}
                  </span>
                </button>
                {col.help ? <InfoHint label={`What "${col.label}" counts`}>{col.help}</InfoHint> : null}
              </span>
            </th>
          ))}
        </>
      }
    >
      {sorted.map((r) => (
        <tr
          key={r.userId}
          onClick={onRowClick ? () => onRowClick(r) : undefined}
          className={`hover:bg-sunken/60 ${onRowClick ? 'cursor-pointer' : ''}`}
        >
          <td className="px-3 py-2">
            <div className="flex items-center gap-1.5 font-medium text-fg">
              {r.firstName} {r.lastName}
              {r.inOverlap ? (
                <span title="Knocked an overlapping door in this range" className="text-warning-fg">
                  ⚠
                </span>
              ) : null}
              {!r.isActive ? <Badge variant="neutral">Inactive</Badge> : null}
            </div>
            <div className="text-xs text-fg-muted">{r.email}</div>
          </td>
          <td className="px-3 py-2 text-fg">{r.coordinatorName || '—'}</td>
          <td className="px-3 py-2 text-right font-medium text-fg">
            {(r.dayKnocks || 0).toLocaleString()}
          </td>
          <td className="px-3 py-2 text-right text-fg">
            {((litMode ? r.dayLit : r.daySurveys) || 0).toLocaleString()}
          </td>
          <td className={`px-3 py-2 text-right font-medium ${rateClass(r.connectionRate)}`}>
            {ratePct(r.connectionRate)}
          </td>
          <td className="px-3 py-2 text-right text-fg-muted">{ratePct(r.contactRate)}</td>
          <td className="px-3 py-2 text-right text-fg">
            {r.doorsPerHour > 0 ? r.doorsPerHour.toFixed(1) : '—'}
          </td>
          <td className="px-3 py-2 text-right text-fg-muted">
            {(r.dayRestricted || 0).toLocaleString()}
          </td>
          <td className="px-3 py-2 text-right text-fg-muted">
            {r.firstActivityAt ? formatInTz(r.firstActivityAt, tz, timeOpts, false) : '—'}
          </td>
          <td className="px-3 py-2 text-right text-fg-muted">
            {r.lastActivityAt ? formatInTz(r.lastActivityAt, tz, timeOpts, false) : '—'}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
