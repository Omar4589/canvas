import { useMemo, useRef } from 'react';
import InfoHint from './InfoHint.jsx';
import { ratePct } from '../lib/rates.js';
import { metricHelp } from '../lib/metricHelp.js';
import { foldBooks, knockedShare, sortBooks } from '../lib/byBook.js';

// The campaign Home's By book table: one pass split by book over the selected range — who is on each book,
// its doors, how many were knocked, its connection rate and its surveys — with the not-in-a-book row and the
// server's TOTAL underneath, which is that pass's By pass row (GET /admin/reports/knocks-by-book;
// DashboardPage owns the query, the pass picker and Export CSV). The ad's "Numbers by pass, book and
// canvasser", in one table. Past OPEN_CAP books the rest fold into one line carrying their sum
// (lib/byBook.js), as By pass folds its passes.
//
// Controlled, like ByPassTable: the sort and Show all live in DashboardPage (`view` / `onViewChange`).

const OPEN_CAP = 10;
const DEFAULT_SORT = { key: 'book', dir: 'asc' };
const num = (v) => (v || 0).toLocaleString();
// Three names, then "+N more"; the whole list rides in the cell's title.
const NAMES_SHOWN = 3;

// The number columns after Book and Canvassers. `get` is the sort value and `cell` the text; both read
// fields a book row, the fold line's sum and the server's TOTAL all carry.
const columnsFor = (isLitDrop) => [
  {
    key: 'doors',
    label: 'Doors',
    helpLabel: 'About doors',
    help: 'The doors in the book now — what Turf Cutting cut, not only the ones knocked.',
    get: (r) => (r.doors == null ? null : r.doors),
    cell: (r) => (r.doors == null ? '—' : num(r.doors)),
  },
  {
    key: 'knocks',
    label: 'Knocked',
    helpLabel: 'About knocked',
    help: (
      <>
        Doors knocked in the selected range, once per door — the By pass table&apos;s Knocks for this pass, split
        by book, with the share of the book&apos;s doors beside it. A knock stays with the book it was recorded
        in, and a door moved to another book partway through the pass counts once, in the book it was last
        knocked in — so a book that gave away doors it had knocked shows no share.
      </>
    ),
    get: (r) => r.knocks || 0,
    cell: (r) => {
      const share = knockedShare(r);
      return (
        <>
          {num(r.knocks)}
          {share != null && <span className="ml-1.5 text-fg-muted">{share}%</span>}
        </>
      );
    },
  },
  {
    key: 'connectionRate',
    label: 'Conn %',
    muted: true,
    helpLabel: 'About connection rate',
    help: metricHelp.connectionRate,
    get: (r) => (r.knocks ? r.connectionRate : null),
    cell: (r) => ratePct(r.knocks ? r.connectionRate : null),
  },
  isLitDrop
    ? {
        key: 'litKnocks',
        label: 'Lit drops',
        helpLabel: 'About lit drops',
        help: metricHelp.litDrops,
        get: (r) => r.litKnocks || 0,
        cell: (r) => num(r.litKnocks),
      }
    : {
        key: 'surveysTaken',
        label: 'Surveys taken',
        helpLabel: 'About surveys taken',
        help: metricHelp.surveysTaken,
        get: (r) => r.surveysTaken || 0,
        cell: (r) => num(r.surveysTaken),
      },
];

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

const Canvassers = ({ names = [] }) => {
  if (!names.length) return <span className="text-fg-subtle">—</span>;
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  const more = names.length - NAMES_SHOWN;
  return (
    <span title={names.join(', ')}>
      {shown}
      {more > 0 && <span className="text-fg-subtle"> +{more} more</span>}
    </span>
  );
};

const BookRow = ({ row, columns }) => (
  <tr className="border-t border-border">
    <td className="whitespace-nowrap px-4 py-2 text-fg">{row.name}</td>
    <td className="px-4 py-2 text-fg-muted">
      <Canvassers names={row.canvassers} />
    </td>
    {columns.map((c) => (
      <td key={c.key} className={`whitespace-nowrap px-4 py-2 text-right tabular-nums ${c.muted ? 'text-fg-muted' : 'text-fg'}`}>
        {c.cell(row)}
      </td>
    ))}
  </tr>
);

const ByBookTable = ({ books = [], notInBook = null, totals, isLitDrop, view, onViewChange }) => {
  const toggleRef = useRef(null);
  const columns = useMemo(() => columnsFor(isLitDrop), [isLitDrop]);
  // A sort on a column this campaign no longer shows (its type changed) falls back to book order.
  const sort = view?.sort && (view.sort.key === 'book' || columns.some((c) => c.key === view.sort.key)) ? view.sort : DEFAULT_SORT;
  const expanded = !!view?.expanded;
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    return sortBooks(books, sort, col ? col.get : null);
  }, [books, sort, columns]);
  const fold = useMemo(() => foldBooks(sorted, OPEN_CAP), [sorted]);
  // TOTAL's knocked share counts the books' knocks only (lib/byBook.js knockedShare).
  const bookKnocks = useMemo(() => books.reduce((n, b) => n + (b.knocks || 0), 0), [books]);
  const foldable = fold.hidden.length > 0;
  const span = 2 + columns.length;

  const onSort = (key, numeric) =>
    onViewChange({
      sort: sort.key === key ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: numeric ? 'desc' : 'asc' },
    });
  // Folding back removes the rows scrolled past to reach Show fewer: bring the control back into view.
  const onToggle = () => {
    onViewChange({ expanded: !expanded });
    if (expanded) {
      requestAnimationFrame(() => {
        const row = toggleRef.current;
        if (row?.querySelector('[aria-expanded="false"]')) row.scrollIntoView({ block: 'nearest' });
      });
    }
  };

  if (!books.length && !notInBook) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-sunken px-4 py-6 text-center text-sm text-fg-muted">
        This pass has no books yet. Cut it on Turf Cutting and its books show here.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full text-sm">
        <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <SortHeader label="Book" sortKey="book" sort={sort} onSort={onSort} />
            <th className="px-4 py-2 text-left">
              <span className="inline-flex items-center gap-1">
                Canvassers
                <InfoHint label="About the canvassers column">
                  Who is assigned to the book now. Export CSV lists every name.
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
        {/* Fixed slots — the rows, the toggle, the not-in-a-book row — so the toggle stays the SAME element
            when the table folds or unfolds and keyboard focus stays on it. */}
        <tbody>
          {(foldable && !expanded ? fold.open : sorted).map((r) => (
            <BookRow key={r.turfId} row={r} columns={columns} />
          ))}
          {foldable ? (
            <tr key="fold-toggle" ref={toggleRef} className="border-t border-border">
              <td className="px-4 py-2" colSpan={expanded ? span : 2}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={onToggle}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-accent hover:underline"
                >
                  <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                  {expanded ? 'Show fewer' : `Show all ${books.length} books`}
                </button>
                {!expanded && (
                  <div className="pl-4 text-xs text-fg-muted">
                    {fold.hidden.length} more {fold.hidden.length === 1 ? 'book' : 'books'}, added up here
                  </div>
                )}
              </td>
              {expanded
                ? null
                : columns.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-fg-muted">
                      {c.cell(fold.hiddenSum)}
                    </td>
                  ))}
            </tr>
          ) : null}
          {notInBook ? (
            <tr key="not-in-book" className="border-t border-border">
              <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
                <span className="inline-flex items-center gap-1">
                  Not in a book
                  <InfoHint label="About not in a book">
                    Knocks and surveys from this pass that no current book holds: saved with no book, or in a
                    book that has since been merged into another or deleted.
                  </InfoHint>
                </span>
              </td>
              <td className="px-4 py-2" />
              {columns.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-fg-muted">
                  {c.cell({ ...notInBook, doors: null })}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t border-border bg-sunken/50 font-semibold text-fg">
              <td className="px-4 py-2" colSpan={2}>
                TOTAL
              </td>
              {columns.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                  {c.cell({ ...totals, shareKnocks: bookKnocks })}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

export default ByBookTable;
