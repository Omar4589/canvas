import { useEffect, useRef } from 'react';
import { DataTable, EmptyState, SkeletonRows, IconUsers } from '../ui/index.js';
import { SORT_DEFAULT_DIR } from '../../lib/fbtimeRoster.js';
import RosterRow from './RosterRow.jsx';

// A limit nobody in the stated population reaches (~300 combined rows) — it
// exists so an org that triples finds a sentence instead of a frozen tab.
const RENDER_CAP = 400;
const COL_COUNT = 7;

// aria-sort belongs on the element with the columnheader role, i.e. the <th>.
// (CampaignTeamPage puts it on the button because its markup is a <ul> with no
// <th> to use; here there is one, and screen readers query it off the header.)
function SortCol({ label, sortKey, sort, onSort, className = '' }) {
  const active = sort.key === sortKey;
  return (
    <th
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-2.5 ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label}${active ? `, currently ${sort.dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
        className={`uppercase tracking-wide hover:text-fg ${active ? 'text-fg' : ''}`}
      >
        {label}
        {active && <span aria-hidden="true">{sort.dir === 'asc' ? ' ▴' : ' ▾'}</span>}
      </button>
    </th>
  );
}

export default function RosterTable({
  rows,
  totalRows,
  isLoading,
  sort,
  onSortChange,
  selected,
  onToggle,
  onToggleAll,
  busyKeys,
  onLink,
  onUnlink,
  projectsLoading,
  emptyHint,
}) {
  const allRef = useRef(null);
  const shown = rows.slice(0, RENDER_CAP);
  const selectedHere = shown.filter((r) => selected.has(r.key)).length;

  // `indeterminate` is an IDL property, not an attribute — it can only be set
  // imperatively.
  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = selectedHere > 0 && selectedHere < shown.length;
    }
  }, [selectedHere, shown.length]);

  const onSort = (key) =>
    onSortChange(
      sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: SORT_DEFAULT_DIR[key] || 'asc' }
    );

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-card border border-border bg-card shadow-card">
        <SkeletonRows />
      </div>
    );
  }

  return (
    <>
      {/* The height cap is what makes the shared DataTable's sticky header work:
          its wrapper is overflow-x-auto, so the other axis resolves to auto, but
          with no cap the box never scrolls and the header sticks to something
          that scrolls away with the page. */}
      <DataTable
        className="max-h-[calc(100vh-22rem)]"
        head={
          <>
            <th className="w-10 px-3 py-2.5">
              <input
                ref={allRef}
                type="checkbox"
                aria-label="Select all shown people"
                checked={shown.length > 0 && selectedHere === shown.length}
                onChange={() => onToggleAll(shown)}
                className="h-3.5 w-3.5 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
              />
            </th>
            <SortCol label="Doorline person" sortKey="person" sort={sort} onSort={onSort} />
            <SortCol
              label="Campaigns"
              sortKey="campaign"
              sort={sort}
              onSort={onSort}
              className="hidden xl:table-cell"
            />
            <th className="hidden w-[68px] px-2 py-2.5 xl:table-cell">
              <span className="sr-only">Link</span>
            </th>
            <SortCol label="FbTime person" sortKey="fbtime" sort={sort} onSort={onSort} />
            <SortCol
              label="Recent project"
              sortKey="location"
              sort={sort}
              onSort={onSort}
              className="hidden xl:table-cell"
            />
            <th className="px-4 py-2.5 xl:hidden">Campaign · FbTime project</th>
            <th className="w-[150px] px-4 py-2.5 text-right">Status</th>
          </>
        }
      >
        {shown.map((row) => (
          <RosterRow
            key={row.key}
            row={row}
            selected={selected.has(row.key)}
            busy={busyKeys.has(row.key)}
            onToggle={onToggle}
            onLink={onLink}
            onUnlink={onUnlink}
            projectsLoading={projectsLoading}
          />
        ))}

        {shown.length === 0 && (
          <tr>
            <td colSpan={COL_COUNT}>
              {totalRows === 0 ? (
                <EmptyState
                  icon={<IconUsers size={22} />}
                  title="No people in FbTime yet"
                  hint="Add your staff in FbTime, then refresh hours."
                />
              ) : (
                <p className="px-4 py-14 text-center text-sm text-fg-muted">{emptyHint}</p>
              )}
            </td>
          </tr>
        )}

        {rows.length > RENDER_CAP && (
          <tr>
            <td
              colSpan={COL_COUNT}
              className="bg-sunken px-4 py-3 text-center text-xs text-fg-muted"
            >
              Showing the first {RENDER_CAP} of {rows.length.toLocaleString()} — search or filter to
              narrow this list.
            </td>
          </tr>
        )}
      </DataTable>
    </>
  );
}
