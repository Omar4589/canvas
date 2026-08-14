import { useMemo, useState } from 'react';
import DataTable from './ui/DataTable.jsx';
import Badge from './ui/Badge.jsx';
import { Tooltip } from './ui/Popover.jsx';
import InfoHint from './InfoHint.jsx';
import { ratePct, rateLevel } from '../lib/rates.js';
import { formatInTz } from '../lib/datetime.js';
import { metricHelp } from '../lib/metricHelp.js';

// The timeline dashboard's per-canvasser answers table: who knocked, whose crew,
// doors/surveys/rates/pace, when they started and when their last door was. Rows come
// from /admin/reports/canvasser-timeline, which resolves each row's coordinatorName from
// the LEDGER (the team stamped on the knocks) — not from the campaign roster, which is
// what used to blank the crew column the moment somebody was taken off a campaign.

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
    // TWO survey units, named. A door can survey several voters, so these genuinely differ (the
    // candidate works a house deeply: 18 doors, 37 voters). They used to share the bare label
    // "Surveys", which made the Home tab and the Timeline look like they disagreed about the same
    // canvasser. "Survey doors" is the one the connection rate divides by — say so.
    ...(litMode
      ? [{ key: 'dayLit', label: 'Lit drops', numeric: true, help: metricHelp.litDrops }]
      : [
          { key: 'daySurveys', label: 'Survey doors', numeric: true, help: metricHelp.surveyDoors },
          { key: 'dayVoterSurveys', label: 'Surveys taken', numeric: true, help: metricHelp.surveysTaken },
        ]),
    { key: 'connectionRate', label: 'Conn %', numeric: true, help: metricHelp.connectionRate },
    { key: 'contactRate', label: 'Contact %', numeric: true, help: metricHelp.contactRate },
    { key: 'doorsPerHour', label: 'Doors/hr', numeric: true, help: metricHelp.doorsPerHour },
    { key: 'dayNoSoliciting', label: 'No solicit', numeric: true, help: metricHelp.noSoliciting },
    { key: 'dayRestricted', label: 'Restricted', numeric: true, help: metricHelp.restricted },
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
  if (key === 'doorsPerHour') {
    const v = mergedDoorsPerHour(row);
    return v > 0 ? v : null;
  }
  return row[key] ?? null;
}

// The hours-provenance marker beside Doors/hr. It used to be a bare green dot on measured
// rows and NOTHING otherwise — which made the useful half of the feature unreadable, because
// a missing dot has four different meanings and three of them are somebody's to fix. The
// server names which one in `hoursReason`; this maps it to a word.
//
// Two rules hold the noise down. An org that never connected FbTime gets 'not-connected' on
// every row and renders no marker at all — byte-identical to life before the integration.
// And the marker is a WORD, not a hue: at 11px a coloured dot is a coin toss, and these four
// states have to be distinguishable at a glance, not on hover.
const HOURS_MARK = {
  measured: {
    text: 'FbTime',
    variant: 'success',
    tip: 'Measured hours — every day in this range came from their FbTime clock time.',
  },
  mixed: {
    text: 'Part',
    variant: 'info',
    tip: 'Partly measured — some days came from FbTime clock time, the rest are estimated from knock times.',
  },
  'not-linked': {
    text: 'No link',
    variant: 'warning',
    tip: 'Estimated. FbTime is connected but this person is not linked to an FbTime profile, so none of their clocked hours count. Link them on the Integrations page.',
  },
  'stale-shift': {
    text: 'Open shift',
    variant: 'warning',
    tip: 'Estimated. A shift was left open from an earlier day (a missed clock-out), so it was ignored rather than counted as a 30-hour day. Close it in FbTime and this range re-measures itself.',
  },
  'no-hours': {
    text: 'Est',
    variant: 'neutral',
    tip: 'Estimated from knock times. This person is linked, but has no clocked FbTime hours in this range.',
  },
};

// The provider's trust flags, appended to whatever the marker already says. These are the
// answers to two questions the bare number provokes and could not answer: "why is this
// different from the figure I screenshotted at lunch?" (a shift still running keeps accruing)
// and "did a person type this, or did a clock?" (docs/FBTIME_INTEGRATION.md promises the
// report says so). Exceptions only — a normal closed, clocked shift adds no sentence.
const HOURS_FLAG_NOTES = [
  ['hasOpenShift', 'Includes a shift still running, so this number will keep moving until they clock out.'],
  ['hasManualEntry', 'Includes hours entered by hand in FbTime rather than clocked.'],
];

// 'not-connected' and null both mean "nothing to say here" — no org-level flag needed, the
// per-row reason already carries it.
function hoursMark(row) {
  const base =
    row.hoursSource === 'measured' || row.hoursSource === 'mixed'
      ? HOURS_MARK[row.hoursSource]
      : HOURS_MARK[row.hoursReason];
  if (!base) return null;
  // hasStaleShift is deliberately absent: it is already the 'Open shift' marker itself, and
  // repeating it as a trailing sentence would say the same thing twice in one tooltip.
  const notes = HOURS_FLAG_NOTES.filter(([key]) => row.hoursFlags?.[key]).map(([, text]) => text);
  return notes.length ? { ...base, tip: [base.tip, ...notes].join(' ') } : base;
}

// The per-row rate, preferring measured hours where the server sent them.
// Timeline rows keep the derived figure in `doorsPerHour` (old builds sum it)
// and ship the merged hours additively as `measuredHoursOnDoors`; leaderboard
// rows arrive already merged. This composes server figures — never re-derives
// a span (docs/METRICS.md).
function mergedDoorsPerHour(row) {
  if (row.measuredHoursOnDoors != null && row.measuredHoursOnDoors > 0 && row.dayKnocks != null) {
    return row.dayKnocks / row.measuredHoursOnDoors;
  }
  return row.doorsPerHour || 0;
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
          {litMode ? (
            <td className="px-3 py-2 text-right text-fg">{(r.dayLit || 0).toLocaleString()}</td>
          ) : (
            <>
              <td className="px-3 py-2 text-right text-fg">
                {(r.daySurveys || 0).toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right text-fg-muted">
                {(r.dayVoterSurveys || 0).toLocaleString()}
              </td>
            </>
          )}
          <td className={`px-3 py-2 text-right font-medium ${rateClass(r.connectionRate)}`}>
            {ratePct(r.connectionRate)}
          </td>
          <td className="px-3 py-2 text-right text-fg-muted">{ratePct(r.contactRate)}</td>
          <td className="px-3 py-2 text-right text-fg">
            {mergedDoorsPerHour(r) > 0 ? (
              <span className="inline-flex items-center justify-end gap-1.5">
                {mergedDoorsPerHour(r).toFixed(1)}
                {(() => {
                  const mark = hoursMark(r);
                  if (!mark) return null;
                  return (
                    <Tooltip label={mark.tip}>
                      {/* tabIndex so the explanation is reachable without a mouse — it is the
                          only place the four estimated states are spelled out in full. */}
                      <Badge
                        variant={mark.variant}
                        className="cursor-help px-1.5 py-0 text-[10px]"
                        tabIndex={0}
                      >
                        {mark.text}
                      </Badge>
                    </Tooltip>
                  );
                })()}
              </span>
            ) : (
              '—'
            )}
          </td>
          <td className="px-3 py-2 text-right text-fg-muted">
            {(r.dayNoSoliciting || 0).toLocaleString()}
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
