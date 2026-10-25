import { Badge, Button } from '../ui/index.js';
import RowMenu from '../RowMenu.jsx';
import { BuildStatus } from './parts.jsx';
import TeamChangedCard from './TeamChangedCard.jsx';
import { buildStateOf } from './buildState.js';
import { formatDayOf, formatPeriod } from './reportDates.js';
import { noUsableLinkReason, opensLine, usableLinks } from './linkState.js';
import { useBuildPoll } from './hooks.js';

// One report on the Client Reports tab (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G1):
//
//   Oct 13 – Oct 19  Published · Edited Oct 21
//   3,412 doors (+412) · 1,980 surveys (+260)
//   Opened via Candidate: about 2 visits
//   [Open] [Next report] [Copy message] [⋮]
//
// Its build is polled while live (useBuildPoll). Next report appears only on the latest report of its
// tab; Copy message only on a report the client can see, and only with a usable link — otherwise it
// is disabled and the row says why, in the Publish confirm's words.

const n = (v) => Number(v || 0).toLocaleString();
const plus = (v) => `${Number(v || 0) >= 0 ? '+' : '−'}${n(Math.abs(Number(v || 0)))}`;

/** "Published · Edited Oct 21" — the status a row and the builder's header wear. */
export const statusOf = (r) => {
  if (r.status === 'draft') return { label: 'Draft', variant: 'neutral' };
  if (r.takenDownAt) return { label: `Taken down ${formatDayOf(r.takenDownAt, r.timeZone)}`.trim(), variant: 'warning' };
  return { label: 'Published', variant: 'success' };
};
export const editedNotes = (r) =>
  [
    r.status === 'published' && r.publishedAt ? `Published ${formatDayOf(r.publishedAt, r.timeZone)}` : null,
    r.contentEditedAt ? `Edited ${formatDayOf(r.contentEditedAt, r.timeZone)}` : null,
    r.numbersRefreshedAt ? `Numbers refreshed ${formatDayOf(r.numbersRefreshedAt, r.timeZone)}` : null,
  ].filter(Boolean);

/** "3,412 doors (+412) · 1,980 surveys (+260)" — lit-drop campaigns count lit dropped instead. */
export const kpiLine = (r, campaignType) => {
  const c = r.headline?.cumulative || {};
  const p = r.headline?.period || {};
  const second = campaignType === 'lit_drop' ? `${n(c.litKnocks)} lit dropped (${plus(p.litKnocks)})` : `${n(c.surveysTaken)} surveys (${plus(p.surveysTaken)})`;
  return `${n(c.doorsKnocked)} doors (${plus(p.doorsKnocked)}) · ${second}`;
};

const ReportRow = ({
  row,
  campaignId,
  campaignType,
  listUpdatedAt,
  isLatest,
  seriesEnded,
  teamLabel,
  shares,
  busy,
  onOpen,
  onNext,
  onCopy,
  onTakeDown,
  onPutBackUp,
  onDelete,
  onCancelBuild,
  onRetry,
  onSettled,
  onTeamResolved,
  onChangeCrews,
  onEndTeam,
}) => {
  const { build } = useBuildPoll({ reportId: row.id, build: row.build, sourceUpdatedAt: listUpdatedAt, onSettled: () => onSettled(row.id) });
  const state = buildStateOf(build, { hasSnapshot: row.hasSnapshot });
  const status = statusOf(row);
  const shown = row.status === 'published' && !row.takenDownAt;
  const linkReason = shown ? noUsableLinkReason(shares) : null;
  const canCopy = shown && usableLinks(shares).length > 0;
  const opens = row.status === 'published' ? opensLine(row, shares) : '';
  const hasNumbers = row.hasSnapshot || row.status === 'published';
  const menu = [
    shown ? { label: 'Take down', onClick: () => onTakeDown(row) } : null,
    row.status === 'published' && row.takenDownAt ? { label: 'Put back up', onClick: () => onPutBackUp(row) } : null,
    { label: 'Delete', danger: true, onClick: () => onDelete(row) },
  ].filter(Boolean);

  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" onClick={() => onOpen(row)} className="text-sm font-semibold text-fg hover:underline">
          {formatPeriod(row.weekStart, row.weekEnd)}
        </button>
        <Badge variant={status.variant} dot>
          {status.label}
        </Badge>
        {editedNotes(row)
          .filter((t) => !t.startsWith('Published'))
          .map((t) => (
            <span key={t} className="text-xs text-fg-muted">
              · {t}
            </span>
          ))}
        {row.title && <span className="min-w-0 truncate text-xs text-fg-muted">— {row.title}</span>}
      </div>
      <div className="mt-1 text-xs text-fg-muted">{hasNumbers ? kpiLine(row, campaignType) : 'No numbers yet'}</div>
      {opens && <div className="mt-0.5 text-xs text-fg-muted">{opens}</div>}
      {state && !state.teamChanged && (
        <div className="mt-1.5">
          <BuildStatus
            compact
            state={state}
            busy={busy?.id === row.id ? busy.kind : null}
            onCancel={() => onCancelBuild(row)}
            onRetry={() => onRetry(row, build)}
            onReview={() => onOpen(row, { review: true })}
          />
        </div>
      )}
      {state?.teamChanged && (
        <div className="mt-2">
          <TeamChangedCard
            compact
            campaignId={campaignId}
            reportId={row.id}
            teamSeriesId={state.seriesId}
            teamLabel={teamLabel || 'This team'}
            onResolved={() => onTeamResolved(row.id)}
            onChangeCrews={() => onChangeCrews(state.seriesId)}
            // An ended team is never offered End again (ADMINUX-10): its tab offers Continue.
            onEnd={seriesEnded ? undefined : () => onEndTeam(state.seriesId)}
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => onOpen(row)}>
          Open
        </Button>
        {isLatest && !seriesEnded && (
          <Button size="sm" variant="secondary" loading={busy?.id === row.id && busy.kind === 'next'} onClick={() => onNext(row)}>
            Next report
          </Button>
        )}
        {shown && (
          <Button size="sm" variant="secondary" disabled={!canCopy} onClick={() => onCopy(row)}>
            Copy message
          </Button>
        )}
        <span className="ml-auto">
          <RowMenu items={menu} />
        </span>
      </div>
      {shown && !canCopy && linkReason && <p className="mt-1 text-xs text-fg-muted">Copy message: {linkReason.text}</p>}
    </li>
  );
};

export default ReportRow;
