import { CHIPS } from '../../lib/rosterView.js';

// The Team page's quick filters, each with its count (docs/PROPOSAL_PEOPLE_PAGES.md §E.2). The counts
// come from rosterView.quickCounts — after the search and the other filters — so a count always
// equals the rows its chip shows.
export const CHIP_LABEL = {
  current: 'Current team',
  'never-signed-in': 'Never signed in',
  deactivated: 'Deactivated',
  paused: 'Paused',
};

const TeamQuickFilters = ({ value, counts, onChange }) => (
  <div className="flex flex-wrap gap-2" role="group" aria-label="Quick filters">
    {CHIPS.map((c) => {
      const active = value === c;
      return (
        <button
          key={c}
          type="button"
          aria-pressed={active}
          onClick={() => onChange(c)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            active ? 'border-brand-600 bg-brand-tint text-brand-accent' : 'border-border-strong bg-card text-fg-muted hover:bg-sunken hover:text-fg'
          }`}
        >
          {CHIP_LABEL[c]}
          <span className="tabular-nums">{(counts?.[c] ?? 0).toLocaleString()}</span>
        </button>
      );
    })}
  </div>
);

export default TeamQuickFilters;
