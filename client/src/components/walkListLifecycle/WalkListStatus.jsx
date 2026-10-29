import { Badge } from '../ui';

// A walk list's one status (lib/walkListState.js): the Walk Lists page's Status cell and the Passes
// page's title chip. The badge names the state; the detail beside it says which pass and when.
const WalkListStatus = ({ state, className = '' }) => {
  if (!state) return null;
  const full = state.detail ? `${state.label} · ${state.detail}` : state.label;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${className}`} title={full}>
      <Badge variant={state.tone} dot>
        {state.label}
      </Badge>
      {state.detail && (
        <span className={`text-xs ${state.tone === 'warning' ? 'font-medium text-warning-fg' : 'text-fg-muted'}`}>{state.detail}</span>
      )}
    </span>
  );
};

export default WalkListStatus;
