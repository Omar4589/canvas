import { Link } from 'react-router-dom';
import { formatInTz } from '../../lib/datetime.js';
import { statusLine } from '../../lib/pacePause.js';

// The Audit page's "Paused canvassers" panel (docs/PROPOSAL_PACE_PAUSE.md §G.2). Pure view: the page owns the
// query (GET /admin/pace-pauses?campaignId=…, its own live poll) and passes the answer in.
// Renders nothing when there is nothing to show, so the Audit page looks as it always did for most orgs.
const PausedCanvassers = ({ data, tz, campaignId, showResolved, onToggleResolved, selectedId }) => {
  const pauses = data?.pauses || [];
  const rosterLines = data?.rosterLines || [];
  const open = pauses.filter((p) => p.status === 'paused' && p.memberActive);
  const rest = pauses.filter((p) => !(p.status === 'paused' && p.memberActive));
  if (!open.length && !rosterLines.length && !rest.length) return null;

  const row = (p) => (
    <li key={p.id} className={'flex flex-wrap items-center justify-between gap-2 px-4 py-3 ' + (p.id === selectedId ? 'bg-sunken' : '')}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">
          {p.name || 'A canvasser'}
          <span className="ml-2 text-xs font-normal text-fg-muted">
            paused {formatInTz(p.firedAt, tz)} · {p.fails} {p.fails === 1 ? 'door' : 'doors'} faster than possible
          </span>
        </p>
        <p className={'text-xs ' + (p.status === 'paused' && p.blocking ? 'text-danger' : 'text-fg-muted')}>{statusLine(p, tz)}</p>
      </div>
      <Link to={`/campaigns/${campaignId}/audit/pauses/${p.id}`} className="text-xs font-semibold text-brand-accent hover:underline">
        Review
      </Link>
    </li>
  );

  return (
    <section className="mb-6 rounded-lg border border-danger/30 bg-card" aria-label="Paused canvassers">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">
          Paused canvassers
          {open.length > 0 && (
            <span className="ml-2 rounded-full bg-danger-tint px-2 py-0.5 text-xs font-semibold text-danger">{open.length}</span>
          )}
        </h2>
        {rest.length > 0 && (
          <button type="button" onClick={onToggleResolved} className="text-xs font-medium text-brand-accent hover:underline">
            {showResolved ? 'Hide resolved' : `Show resolved (${rest.length})`}
          </button>
        )}
      </div>
      <ul className="divide-y divide-border">
        {open.map(row)}
        {rosterLines.map((l) => (
          <li key={`roster-${l.userId}`} className="px-4 py-3">
            <p className="text-sm font-medium text-fg">{l.name || 'A canvasser'}</p>
            <p className="text-xs text-danger">Paused for review — an org admin can unpause.</p>
          </li>
        ))}
        {showResolved && rest.map(row)}
      </ul>
      {!open.length && !rosterLines.length && !showResolved && (
        <p className="px-4 py-3 text-xs text-fg-muted">Nobody on this campaign is paused right now.</p>
      )}
    </section>
  );
};

export default PausedCanvassers;
