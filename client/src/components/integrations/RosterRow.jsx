import { Badge, Button, IconAlert, IconSpinner, IconSwap, Skeleton, Tooltip } from '../ui/index.js';
import { ROW_FLAG, ROW_STATUS } from '../../lib/fbtimeRoster.js';
import CampaignChips from './CampaignChips.jsx';

const ROLE_LABEL = { admin: 'Admin', lead: 'Team lead', canvasser: 'Canvasser' };

// A missing counterpart is drawn, not left blank: a blank cell in a two-sided
// table reads as "same as the other side", which then makes a genuinely empty
// cell ambiguous.
const Ghost = ({ children }) => (
  <span className="inline-block rounded border border-dashed border-border px-2 py-1 text-xs text-fg-subtle">
    {children}
  </span>
);

const Projects = ({ row, loading }) => {
  if (loading && row.fbtimePersonId) return <Skeleton className="h-4 w-24" />;
  if (!row.fbtimeProjects.length) return <span className="text-fg-subtle">—</span>;
  const [first, ...rest] = row.fbtimeProjects;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {/* Neutral, like the campaign chips opposite. Neither half of the
          comparison is ever painted — see CampaignChips. */}
      <Badge variant="neutral" className="max-w-[11rem] truncate">
        {first.name}
      </Badge>
      {rest.length > 0 && (
        <Tooltip label={rest.map((p) => p.name).join(', ')}>
          <span className="cursor-default rounded-full bg-sunken px-2 py-0.5 text-xs font-medium tabular-nums text-fg-muted">
            +{rest.length}
          </span>
        </Tooltip>
      )}
    </span>
  );
};

const Bridge = ({ row, busy }) => {
  if (busy) return <IconSpinner size={14} className="text-fg-subtle" />;
  if (row.kind === 'orphan') {
    return (
      <Tooltip label="This link points at someone no longer in the organization">
        <span>
          <IconAlert size={16} className="text-danger-fg" />
          <span className="sr-only">Broken link</span>
        </span>
      </Tooltip>
    );
  }
  if (row.kind === 'linked') {
    return (
      <span className="inline-flex flex-col items-center">
        <IconSwap size={16} className="text-fg-subtle" />
        {row.linkSource === 'auto-email' && (
          <span className="text-[10px] leading-tight text-fg-subtle">auto</span>
        )}
      </span>
    );
  }
  return <span className="mx-auto block h-px w-4 border-t border-dashed border-border" />;
};

export default function RosterRow({ row, selected, onToggle, busy, onLink, onUnlink, projectsLoading }) {
  const status = ROW_STATUS[row.status] || ROW_STATUS.linked;
  // ONE rail per row, danger outranking warning: a row with both a broken link and
  // no recent hours is a broken-link row, and the rest is noise until that's fixed.
  // The transparent default is reserved width, so nothing shifts when a rail appears.
  const railClass =
    row.kind === 'orphan' || row.kind === 'ghost'
      ? 'border-danger'
      : row.hasUnmatchedHours
        ? 'border-warning'
        : 'border-transparent';

  const hasDoorline = Boolean(row.userId);
  const hasFbtime = Boolean(row.fbtimePersonId);
  const canUnlink = ['linked', 'orphan'].includes(row.kind);

  return (
    <tr className={`align-top transition-colors hover:bg-sunken/60 ${selected ? 'bg-brand-tint/40' : ''}`}>
      {/* The rail lives on the first CELL, never the row: Preflight sets
          border-collapse, under which a <tr> border is unreliable. */}
      <td className={`w-10 border-l-2 px-3 py-3 ${railClass}`}>
        <input
          type="checkbox"
          aria-label={`Select ${row.name || row.fbtimeName || 'this person'}`}
          checked={selected}
          disabled={busy}
          onChange={() => onToggle(row.key)}
          className="h-3.5 w-3.5 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
        />
      </td>

      <td className="min-w-[200px] px-4 py-2.5">
        {hasDoorline ? (
          <>
            <div
              className={`truncate text-sm font-medium ${
                row.memberDeleted ? 'italic text-fg-subtle' : 'text-fg'
              }`}
            >
              {row.name}
            </div>
            {row.email && <div className="truncate text-xs text-fg-muted">{row.email}</div>}
          </>
        ) : (
          <Ghost>Not in Doorline</Ghost>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          {row.flags
            .filter((f) => ['member-gone', 'member-deleted', 'member-inactive'].includes(f))
            .map((f) => (
              <Badge
                key={f}
                variant={
                  f === 'member-gone' ? 'danger' : f === 'member-deleted' ? 'neutral' : 'warning'
                }
              >
                {ROW_FLAG[f]}
              </Badge>
            ))}
        </div>
      </td>

      <td className="hidden w-[210px] px-4 py-2.5 xl:table-cell">
        <CampaignChips campaigns={row.campaigns} />
        {row.role && (
          <div className="mt-1 text-xs text-fg-muted">{ROLE_LABEL[row.role] || row.role}</div>
        )}
      </td>

      <td className="hidden w-[68px] px-2 py-2.5 text-center xl:table-cell">
        <Bridge row={row} busy={busy} />
      </td>

      <td className="min-w-[200px] px-4 py-2.5">
        {hasFbtime ? (
          <>
            <div className="truncate text-sm font-medium text-fg">
              {row.fbtimeName || <span className="text-fg-subtle">No name in FbTime</span>}
            </div>
            {row.fbtimeEmail && (
              <div className="truncate text-xs text-fg-muted">{row.fbtimeEmail}</div>
            )}
          </>
        ) : (
          <Ghost>Not in FbTime</Ghost>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          {row.flags.includes('fbtime-inactive') && (
            <Badge variant="neutral">{ROW_FLAG['fbtime-inactive']}</Badge>
          )}
          {row.hasUnmatchedHours && (
            <Badge variant="warning">{ROW_FLAG['unmatched-hours']}</Badge>
          )}
        </div>
      </td>

      <td className="hidden w-[220px] px-4 py-2.5 xl:table-cell">
        <Projects row={row} loading={projectsLoading} />
      </td>

      {/* Below xl the two comparison columns FOLD into one stacked cell rather
          than either being dropped — hiding either half deletes the feature. */}
      <td className="px-4 py-2.5 xl:hidden">
        <div className="flex items-center gap-2">
          <Bridge row={row} busy={busy} />
          <div className="min-w-0 space-y-1">
            <CampaignChips campaigns={row.campaigns} />
            <Projects row={row} loading={projectsLoading} />
          </div>
        </div>
      </td>

      <td className="w-[150px] px-4 py-2.5 text-right">
        <Badge variant={status.variant} className="mb-1">
          {status.label}
        </Badge>
        <div>
          {canUnlink ? (
            <Button
              variant={row.kind === 'orphan' ? 'danger' : 'ghost'}
              size="sm"
              disabled={busy}
              onClick={() => onUnlink(row)}
            >
              Unlink
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onLink(row)}>
              {hasFbtime ? 'Link…' : 'Find in FbTime…'}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
