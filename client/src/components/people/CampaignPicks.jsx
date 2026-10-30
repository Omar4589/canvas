import CrewSelect from '../team/CrewSelect.jsx';
import { historyLine, joinLine } from '../../lib/addPeople.js';
import { prePickFor } from '../../lib/addToCampaigns.js';

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

// The campaign list of the Users page's Add member and a person panel's Add to campaigns
// (docs/PROPOSAL_ADD_TO_CAMPAIGNS.md §E.1), the phone's mobile/components/CampaignPicks.jsx in the web's
// grammar. One checkbox per active campaign and nothing checked to start — it never means "every
// campaign". A campaign they're already on shows checked and locked. Checking one opens ITS OWN crew
// (owner ruling 2026-10-30), picked from their doors there when that coordinator can still run one, with
// the doors-from-before line and what joining does to those doors (lib/addPeople.js, the Team page's words).
//
// `picks` is { [campaignId]: coordinatorId | '' } ('' = No crew); onChange gets the next one.
const CampaignPicks = ({
  idBase,
  campaigns = [], // [{ _id, name }] active campaigns, in the order to list them
  lockedIds = new Set(), // the campaigns they're already on
  histories = new Map(), // campaignId → { doors, sources }
  coordinators = [], // lib/crewChange.js coordinatorChoices — who can run a crew
  exclude = [], // never a choice: the person being added
  firstName = '', // for the doors line
  picks,
  onChange,
  disabled = false,
}) => {
  const skip = new Set(exclude.map(String));
  const choiceIds = coordinators.filter((c) => !skip.has(String(c.id))).map((c) => c.id);
  const toggle = (id, checked) => {
    const next = { ...picks };
    if (checked) next[id] = prePickFor(histories.get(id), choiceIds);
    else delete next[id];
    onChange(next);
  };

  if (!campaigns.length) return <p className="text-sm text-fg-muted">No active campaigns yet.</p>;

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {campaigns.map((c) => {
        const id = String(c._id);
        const locked = lockedIds.has(id);
        const on = locked || has(picks, id);
        const history = histories.get(id) || null;
        const pick = picks?.[id] || '';
        // A pick is always one of `coordinators`: the pre-pick is chosen from them (prePickFor) and so is the select.
        const pickName = pick ? coordinators.find((x) => String(x.id) === pick)?.name || null : null;
        const doors = historyLine(firstName || 'They', history);
        const moves = joinLine(history, pick, pickName);
        return (
          <li key={id} className="px-3 py-2">
            <label className={`flex items-center gap-2 text-sm ${locked ? 'text-fg-muted' : 'cursor-pointer text-fg'}`}>
              <input type="checkbox" checked={on} disabled={disabled || locked} onChange={(e) => toggle(id, e.target.checked)} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {locked && <span className="shrink-0 text-xs text-fg-muted">on it</span>}
            </label>
            {on && !locked && (
              <div className="mt-2 space-y-1.5 pl-6">
                {doors && <p className="text-xs text-fg">{doors}</p>}
                <label htmlFor={`${idBase}-crew-${id}`} className="block text-xs font-medium text-fg-muted">
                  Crew on {c.name}
                </label>
                <CrewSelect
                  id={`${idBase}-crew-${id}`}
                  coordinators={coordinators}
                  exclude={exclude}
                  value={pick}
                  onChange={(v) => onChange({ ...picks, [id]: v })}
                  disabled={disabled}
                />
                {moves && <p className="text-xs text-fg">{moves}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default CampaignPicks;
