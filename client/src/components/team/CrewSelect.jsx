import { Select } from '../ui/index.js';

// The crew choice wherever a crew is picked on the web: a person's panel, Move to crew… and the add
// steps (docs/PROPOSAL_PEOPLE_PAGES.md §E.3). `coordinators` is lib/crewChange.js coordinatorChoices —
// the crew endpoint's list, the same for an org admin and a team lead. It never lists the people being
// added (`exclude`): nobody can be their own crew.
//
// A current coordinator who can't run a crew any more (switched off, or no longer an admin or team lead)
// isn't in that list, but their crew stands, so they show as the current choice, labelled and not
// pickable — not as "No crew" beside a Finish it toward them.
//
// `placeholder` (Move to crew…) starts on a prompt rather than No crew, so nothing is checked until a
// crew is actually picked; `value` is then null until one is.
const PICK = '__pick__';
const CrewSelect = ({ coordinators, value, onChange, exclude = [], current = null, placeholder = null, disabled = false, id, className = '', ...rest }) => {
  const skip = new Set(exclude.map(String));
  const stranded = !!current?.id && !coordinators.some((c) => String(c.id) === String(current.id));
  return (
    <Select
      id={id}
      value={value == null && placeholder ? PICK : value || ''}
      onChange={(e) => e.target.value !== PICK && onChange(e.target.value)}
      disabled={disabled}
      className={`w-full ${className}`}
      {...rest}
    >
      {placeholder && (
        <option value={PICK} disabled>
          {placeholder}
        </option>
      )}
      <option value="">No crew</option>
      {stranded && (
        <option value={String(current.id)} disabled>
          {current.name || 'Unknown'}, switched off
        </option>
      )}
      {coordinators
        .filter((c) => !skip.has(String(c.id)))
        .map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.name}
          </option>
        ))}
    </Select>
  );
};

export default CrewSelect;
