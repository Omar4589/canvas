import { useMemo, useRef } from 'react';
import InfoHint from './InfoHint.jsx';
import { ratePct } from '../lib/rates.js';
import { metricHelp } from '../lib/metricHelp.js';
import { foldPasses, foldLabel, morePasses, quietCount, quietPhrase, quietTally } from '../lib/byPassFold.js';

// The campaign Home's By pass table: one row per walk list × pass over the selected range, with the
// server's TOTAL underneath (DashboardPage owns the query, the heading and Export CSV). Passes with
// nothing in the range fold into one line, and so do the passes with numbers past OPEN_CAP — the
// rule, and why it reads the range rather than the pass status, is lib/byPassFold.js. The phone's By
// pass card folds through that module's mirror.
//
// Controlled: the sort and Show all live in DashboardPage (`view` / `onViewChange`), because the
// section unmounts while a new range or filter loads and the admin's choices should survive that.

// Ten keeps a fifty-precinct campaign's table about a screen tall on any range.
const OPEN_CAP = 10;

// Walk list A→Z is the order the server sends (walk list, then pass 1→N, the legacy row last), so
// the default sort is arrival order. Number columns open biggest-first and flip on a second click —
// the Canvassers table's convention, further down the same page.
const DEFAULT_SORT = { key: 'walkList', dir: 'asc' };

const num = (v) => (v || 0).toLocaleString();

// The number columns after Walk list and Pass, in order. `get` is the sort value and `cell` the text.
// Both read field names that a pass row, the fold line's sum and the server's TOTAL all carry, which
// is what keeps the three lined up under one header. Conn % sorts a no-knock row last either way
// (null), as the Canvassers table sinks its dashes.
const columnsFor = (isLitDrop, notTargetInUse, coordinatorId) => [
  { key: 'knocks', label: 'Knocks', get: (r) => r.knocks || 0, cell: (r) => num(r.knocks) },
  isLitDrop
    ? { key: 'litKnocks', label: 'Lit drops', get: (r) => r.litKnocks || 0, cell: (r) => num(r.litKnocks) }
    : { key: 'surveyedKnocks', label: 'Survey doors', get: (r) => r.surveyedKnocks || 0, cell: (r) => num(r.surveyedKnocks) },
  ...(isLitDrop
    ? []
    : [{
        key: 'surveysTaken',
        label: 'Surveys taken',
        helpLabel: 'About surveys taken',
        help: metricHelp.surveysTaken,
        get: (r) => r.surveysTaken || 0,
        cell: (r) => num(r.surveysTaken),
      }]),
  ...(notTargetInUse
    ? [{
        key: 'notTargetKnocks',
        label: 'Not a target',
        helpLabel: 'About not a target',
        help: metricHelp.notTarget,
        get: (r) => r.notTargetKnocks || 0,
        cell: (r) => num(r.notTargetKnocks),
      }]
    : []),
  {
    key: 'connectionRate',
    label: 'Conn %',
    muted: true,
    get: (r) => (r.knocks ? r.connectionRate : null),
    cell: (r) => ratePct(r.connectionRate),
  },
  {
    key: 'coverageGained',
    label: 'New homes reached',
    helpLabel: 'About new homes reached',
    help: (
      <>
        Homes reached for the <strong>first</strong> time (in the selected range, when one is set) —
        a re-knocked door adds a knock but not a new home.
        {coordinatorId ? (
          <>
            {' '}With a crew selected, "first" is still judged campaign-wide: a door counts here only if
            this crew made its first-ever knock.
          </>
        ) : null}
      </>
    ),
    get: (r) => r.coverageGained || 0,
    cell: (r) => num(r.coverageGained),
  },
];

// Walk list never re-compares names: the browser's collation can disagree with the server's (and the
// CSV's), so ascending IS arrival order, and descending flips whole walk lists — passes stay 1→N
// inside each, and rows with no walk list (the legacy row) stay last. Rows are grouped by name in
// order of first appearance rather than by runs: the server can interleave two lists whose names
// collate equal ("Precinct 7" and the same name with an invisible character), and grouping by runs
// would then put Pass 2 above Pass 1. A number column sorts by value with the arrival index breaking
// ties, so equal rows keep the server's order and a 30 s poll never shuffles them.
const sortRows = (rows, sort, columns) => {
  const col = columns.find((c) => c.key === sort.key);
  if (!col) {
    if (sort.dir === 'asc') return rows;
    const groups = new Map();
    for (const row of rows) {
      const name = row.effortName || null;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    const named = [...groups].filter(([name]) => name !== null).map(([, g]) => g);
    return [...named.reverse(), groups.get(null) || []].flat();
  }
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: col.get(row) }))
    .sort((a, b) => {
      if (a.v == null || b.v == null) return a.v != null ? -1 : b.v != null ? 1 : a.i - b.i;
      return (a.v - b.v) * sign || a.i - b.i;
    })
    .map(({ row }) => row);
};

const SortHeader = ({ label, sortKey, numeric = false, help, helpLabel, sort, onSort }) => {
  const active = sort.key === sortKey;
  return (
    <th
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`px-4 py-2 ${numeric ? 'text-right' : 'text-left'}`}
    >
      <span className={`inline-flex items-center gap-1 ${numeric ? 'justify-end' : ''}`}>
        <button
          type="button"
          onClick={() => onSort(sortKey, numeric)}
          className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-fg"
        >
          {label}
          <span className={active ? 'text-fg' : 'invisible'}>{active && sort.dir === 'asc' ? '▲' : '▼'}</span>
        </button>
        {help ? <InfoHint label={helpLabel}>{help}</InfoHint> : null}
      </span>
    </th>
  );
};

const PassRow = ({ row, columns, showActive }) => {
  const active = showActive && row.status === 'active';
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2 text-fg">{row.effortName || '—'}</td>
      <td className="px-4 py-2 text-fg-muted">
        {/* The dot's slot is kept on every row (invisible when not active) so the pass names
            line up down the column. */}
        <span
          className="inline-flex items-center gap-1.5"
          title={active ? 'Active pass' : undefined}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-success' : 'invisible'}`}
          />
          {active && <span className="sr-only">Active: </span>}
          {row.roundLabel}
        </span>
      </td>
      {columns.map((c) => (
        <td key={c.key} className={`px-4 py-2 text-right tabular-nums ${c.muted ? 'text-fg-muted' : 'text-fg'}`}>
          {c.cell(row)}
        </td>
      ))}
    </tr>
  );
};

// `archived`: the campaign is archived, so none of its passes is marked active whatever its status
// says (archiving a campaign leaves its passes as they were) — no dots, and "no knocks yet" loses the
// "yet". The dot itself promises nothing about who can canvass (a suspended org's phones can't),
// only that this is the walk list's active pass.
const ByPassTable = ({
  rounds = [],
  totals,
  isLitDrop,
  notTargetInUse,
  coordinatorId,
  rangePreset,
  archived = false,
  view,
  onViewChange,
}) => {
  const toggleRef = useRef(null);
  const columns = useMemo(
    () => columnsFor(isLitDrop, notTargetInUse, coordinatorId),
    [isLitDrop, notTargetInUse, coordinatorId]
  );
  // A sort on a column this campaign no longer shows (its type or outcomes changed mid-session)
  // falls back to the default rather than sorting silently by something off screen.
  const sort =
    view?.sort && (view.sort.key === 'walkList' || columns.some((c) => c.key === view.sort.key))
      ? view.sort
      : DEFAULT_SORT;
  const expanded = !!view?.expanded;
  const fold = useMemo(() => foldPasses(sortRows(rounds, sort, columns), OPEN_CAP), [rounds, sort, columns]);
  const words = { preset: rangePreset, crew: !!coordinatorId, archived };
  const span = 2 + columns.length;

  const onSort = (key, numeric) =>
    onViewChange({
      sort: sort.key === key ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: numeric ? 'desc' : 'asc' },
    });
  // Folding back removes every row the admin scrolled past to reach Show fewer, which would leave
  // the viewport sitting on whatever was below the table — so bring the control back into view. Only
  // if it is still folded when the frame comes: a fold and re-open inside one frame must not scroll
  // to the toggle at the foot of the re-opened table.
  const onToggle = () => {
    onViewChange({ expanded: !expanded });
    if (expanded) {
      requestAnimationFrame(() => {
        const row = toggleRef.current;
        if (row?.querySelector('[aria-expanded="false"]')) row.scrollIntoView({ block: 'nearest' });
      });
    }
  };

  const passRows = (rows) =>
    rows.map((r) => <PassRow key={r.passId || 'legacy'} row={r} columns={columns} showActive={!archived} />);
  const unfolded = fold.foldable && expanded;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full text-sm">
        <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <SortHeader label="Walk list" sortKey="walkList" sort={sort} onSort={onSort} />
            <th className="px-4 py-2 text-left">
              <span className="inline-flex items-center gap-1">
                Pass
                <InfoHint label="About the pass column">
                  {archived
                    ? 'This campaign is archived, so no pass is marked active. '
                    : "A green dot marks each walk list's active pass. "}
                  A long list folds into one line above TOTAL: open it to list every pass. Export CSV
                  always includes every pass.
                </InfoHint>
              </span>
            </th>
            {columns.map((c) => (
              <SortHeader
                key={c.key}
                label={c.label}
                sortKey={c.key}
                numeric
                help={c.help}
                helpLabel={c.helpLabel}
                sort={sort}
                onSort={onSort}
              />
            ))}
          </tr>
        </thead>
        {/* Four fixed slots — rows, the quiet label, the quiet rows, the toggle — so the toggle row
            and its button stay the SAME elements when the table folds or unfolds: keyboard focus
            stays on the button instead of dropping to the page. Unfolded, the passes with numbers
            list first, in the current sort, then the quiet ones under a label, so opening the fold
            adds rows below the ones already read instead of reshuffling them. */}
        <tbody>
          {passRows(unfolded ? fold.worked : fold.open)}
          {unfolded && fold.quiet.length > 0 ? (
            <tr key="quiet-label" className="border-t border-border">
              <td colSpan={span} className="px-4 pb-1 pt-3 text-xs font-medium text-fg-muted">
                {(() => {
                  const phrase = quietPhrase(words);
                  return `${phrase[0].toUpperCase()}${phrase.slice(1)} · ${quietTally(fold, words)}`;
                })()}
              </td>
            </tr>
          ) : null}
          {passRows(unfolded ? fold.quiet : [])}
          {fold.foldable ? (
            <tr key="fold-toggle" ref={toggleRef} className="border-t border-border">
              <td className="px-4 py-2" colSpan={unfolded ? span : 2}>
                <button
                  type="button"
                  aria-expanded={unfolded}
                  onClick={onToggle}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-accent hover:underline"
                >
                  <span aria-hidden="true">{unfolded ? '▾' : '▸'}</span>
                  {unfolded ? 'Show fewer' : foldLabel(fold, words)}
                </button>
                {/* Hiding passes with numbers, the line carries their sum under the same headers, so
                    the lines on screen still add up to TOTAL; hiding only quiet passes, it has none. */}
                {!unfolded && fold.hiddenSum ? (
                  <div className="pl-4 text-xs text-fg-muted">
                    {[morePasses(fold), fold.quiet.length ? quietCount(fold, words) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                ) : null}
              </td>
              {unfolded ? null : fold.hiddenSum ? (
                columns.map((c) => (
                  <td key={c.key} className="px-4 py-2 text-right tabular-nums text-fg-muted">
                    {c.cell(fold.hiddenSum)}
                  </td>
                ))
              ) : (
                <td colSpan={columns.length} />
              )}
            </tr>
          ) : null}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t border-border bg-sunken/50 font-semibold text-fg">
              <td className="px-4 py-2" colSpan={2}>TOTAL</td>
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-2 text-right tabular-nums">
                  {c.cell(totals)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

export default ByPassTable;
