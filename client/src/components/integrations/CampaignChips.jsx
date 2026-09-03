import { Badge, Tooltip } from '../ui/index.js';

// Active campaigns as chips, overflow behind a tooltip.
//
// NEUTRAL ALWAYS, deliberately. This is one half of a side-by-side comparison
// with the FbTime project column, and painting either half would render a verdict
// the page does not make: the two labels come from different systems and free text
// ("Miami Field Office" legitimately runs "FL-27 GOTV"), so the eye compares them
// and nothing on screen ever claims they disagree.
export default function CampaignChips({ campaigns = [], max = 2, empty = '—' }) {
  if (!campaigns.length) return <span className="text-fg-subtle">{empty}</span>;
  const shown = campaigns.slice(0, max);
  const rest = campaigns.slice(max);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((c) => (
        <Badge key={c.id} variant="neutral" className="max-w-[11rem] truncate">
          {c.name}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Tooltip label={rest.map((c) => c.name).join(', ')}>
          <span className="cursor-default rounded-full bg-sunken px-2 py-0.5 text-xs font-medium tabular-nums text-fg-muted">
            +{rest.length}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
