import { reasonColor, reasonLabel, reasonDetailText } from '../lib/flags.js';

// Renders an entry's flag reasons as colored pills with a human detail (e.g. "Far from
// house · 205 ft from house"). Shared by the Map flag panel and the Audit drill-in list.
export default function FlagReasonBadges({ reasons = [] }) {
  if (!reasons.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.map((r) => (
        <span
          key={r.type}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs"
        >
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: reasonColor(r.type) }} />
          <span className="font-medium text-fg">{reasonLabel(r.type)}</span>
          <span className="text-fg-subtle">· {reasonDetailText(r)}</span>
        </span>
      ))}
    </div>
  );
}
