import { Fragment } from 'react';
import { Badge } from '../ui/index.js';
import { formatRelative } from '../../lib/dates.js';
import { noSignInRecorded, standing } from '../../lib/rosterView.js';

// The Team page's list (docs/PROPOSAL_PEOPLE_PAGES.md §E.3): a checkbox and a name button per row, and
// the columns Member (with a Lead or Admin badge), Crew, Last password login, Doors and Last door.
// The crew is always on screen; below md it moves to each row's second line. Sorted by crew (how the
// page opens), a heading with the crew's count starts each crew — at the top of a page too, so a crew
// split across two pages is named on both.
//
// Each row's button carries data-person-row, which the page uses to put focus back on it when the
// person panel closes.

// Static strings: Tailwind's scanner only emits classes it can see whole in the source.
const ROW_GRID =
  'grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_1.25rem] items-center gap-3 md:grid-cols-[minmax(0,1fr)_9rem_8.5rem_4.5rem_6rem_1.25rem]';

const RoleBadge = ({ role }) =>
  role === 'admin' || role === 'lead' ? (
    <span className="rounded bg-sunken px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
      {role === 'lead' ? 'lead' : 'admin'}
    </span>
  ) : null;

const YouBadge = () => (
  <span className="rounded bg-brand-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-accent">you</span>
);

// A state worth a badge. "No sign-in recorded" isn't one: it isn't a problem, only an older account.
const STATE_BADGE = {
  paused: ['danger', 'Paused'],
  'never-signed-in': ['warning', 'Never signed in'],
  deactivated: ['warning', 'Deactivated'],
  left: ['neutral', 'No longer in the org'],
  deleted: ['danger', 'Account deleted'],
};

const crewLabel = (r) => (r.coordinatorId ? r.coordinatorName || 'Unknown' : 'No crew');

// A column heading that sorts. `nowrap` keeps "Last password login" on one line.
const SortCol = ({ label, sortKey, right = false, nowrap = false, sort, onSort }) => {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${nowrap ? 'whitespace-nowrap ' : ''}uppercase tracking-wide hover:text-fg ${right ? 'text-right' : 'text-left'} ${
        active ? 'text-fg' : ''
      }`}
    >
      {label}
      {active && (sort.dir === 'asc' ? ' ▴' : ' ▾')}
    </button>
  );
};

const TeamTable = ({
  rows,
  sort,
  onSort,
  crewCounts,
  selectable,
  selected,
  onToggle,
  onTogglePage,
  viewerId,
  pausedIds,
  onOpen,
}) => {
  const pageIds = rows.map((r) => String(r.userId));
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const s = { sort, onSort };
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
      <li className="flex items-center gap-3 border-b border-border bg-sunken px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        {selectable && (
          <input
            type="checkbox"
            checked={pageAll}
            onChange={onTogglePage}
            aria-label="Select everyone on this page"
            className="h-4 w-4 shrink-0 rounded border-border-strong text-brand-accent"
          />
        )}
        <div className={ROW_GRID}>
          <SortCol label="Member" sortKey="name" {...s} />
          <span className="hidden md:block">
            <SortCol label="Crew" sortKey="crew" {...s} />
          </span>
          <span className="hidden text-right md:block">
            <SortCol label="Last password login" sortKey="lastLogin" right nowrap {...s} />
          </span>
          <span className="hidden text-right md:block">
            <SortCol label="Doors" sortKey="doors" right {...s} />
          </span>
          <span className="hidden text-right md:block">
            <SortCol label="Last door" sortKey="lastDoor" right {...s} />
          </span>
          <span aria-hidden />
        </div>
      </li>
      {rows.map((r, i) => {
        const id = String(r.userId);
        const prev = i > 0 ? rows[i - 1] : null;
        const heading = sort.key === 'crew' && (!prev || String(prev.coordinatorId || '') !== String(r.coordinatorId || ''));
        const st = standing(r, pausedIds);
        const badge = STATE_BADGE[st];
        const name = `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.email || 'Unnamed';
        return (
          <Fragment key={id}>
            {heading && (
              <li className="bg-sunken/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                {r.coordinatorId ? `${r.coordinatorName || 'Unknown'}’s crew` : 'No crew'} ·{' '}
                {(crewCounts.get(String(r.coordinatorId || '')) || 0).toLocaleString()}
              </li>
            )}
            <li className={`flex items-center gap-3 px-3 py-2 text-sm ${selected.has(id) ? 'bg-brand-tint/40' : ''}`}>
              {selectable && (
                <input
                  type="checkbox"
                  checked={selected.has(id)}
                  onChange={() => onToggle(id)}
                  aria-label={`Select ${name}`}
                  className="h-4 w-4 shrink-0 rounded border-border-strong text-brand-accent"
                />
              )}
              <button type="button" data-person-row={id} onClick={() => onOpen(id)} className={`${ROW_GRID} rounded text-left transition-colors hover:bg-sunken`}>
                {/* Spans, not divs: a button holds phrasing content only. */}
                <span className="block min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate font-medium text-fg">{name}</span>
                    <RoleBadge role={r.role} />
                    {badge && <Badge variant={badge[0]}>{badge[1]}</Badge>}
                    {String(r.userId) === String(viewerId) && <YouBadge />}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">{r.email}</span>
                  <span className="block truncate text-xs text-fg-muted md:hidden">{crewLabel(r)}</span>
                </span>
                <span className={`hidden truncate text-sm md:block ${r.coordinatorId ? 'text-fg' : 'text-fg-muted'}`}>{crewLabel(r)}</span>
                <span className="hidden text-right text-xs text-fg-muted md:block">
                  {noSignInRecorded(r) ? 'Not recorded' : formatRelative(r.lastLoginAt, { never: 'Never' })}
                </span>
                <span className="hidden text-right text-sm tabular-nums text-fg md:block">{(r.doors ?? 0).toLocaleString()}</span>
                <span className="hidden text-right text-xs text-fg-muted md:block">{formatRelative(r.lastDoorAt, { never: '—' })}</span>
                <span className="shrink-0 text-right text-fg-subtle" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
};

export default TeamTable;
