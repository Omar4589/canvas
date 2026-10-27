import { Link } from 'react-router-dom';
import { formatInTz } from '../../lib/datetime.js';
import { statusLine } from '../../lib/pacePause.js';

// A member's automatic pauses, in the person panel (docs/PROPOSAL_PACE_PAUSE.md §G.4): the open one with
// Review, then the past ones. Renders nothing for someone never paused, which is nearly everyone.
//
// The panel reads the pauses (GET /admin/pace-pauses?userId=…&status=all, which the server narrows to a
// lead's own campaigns) and Unpause moved up to the person's state buttons, which ask first
// (docs/PROPOSAL_PEOPLE_PAGES.md §D.5). `elsewhere` is a lead's canvasser paused on a campaign the lead
// doesn't manage: the Audit page's line, and nothing about that campaign. `onLink` is the panel's
// unsaved-changes check, run before Review leaves the page.
const PacePauseProfileSection = ({ pauses = [], tz, elsewhere = false, onLink }) => {
  const open = pauses.find((p) => p.status === 'paused' && p.memberActive);
  const past = pauses.filter((p) => p !== open);
  if (!open && !past.length && !elsewhere) return null;
  return (
    <div className="border-b border-border px-6 py-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">Automatic pause</h3>
      {open && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2">
          <p className="text-sm text-danger-fg">
            Paused for review on {open.campaignName || 'a campaign'} since {formatInTz(open.firedAt, tz)}
            {!open.blocking && ' — not blocking while automatic pause is switched off'}
          </p>
          <Link
            to={`/campaigns/${open.campaignId}/audit/pauses/${open.id}`}
            onClick={onLink}
            className="text-sm font-semibold text-brand-accent hover:underline"
          >
            Review
          </Link>
        </div>
      )}
      {elsewhere && <p className="mb-3 text-sm text-danger-fg">Paused for review — an org admin can unpause.</p>}
      {past.length > 0 && (
        <ul className="space-y-1 text-sm">
          {past.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-fg">
                {formatInTz(p.firedAt, tz)} · {p.campaignName || 'a campaign'}
                <span className="ml-2 text-xs text-fg-muted">{statusLine(p, tz)}</span>
              </span>
              <Link
                to={`/campaigns/${p.campaignId}/audit/pauses/${p.id}`}
                onClick={onLink}
                className="text-xs font-semibold text-brand-accent hover:underline"
              >
                Review
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PacePauseProfileSection;
