import { fmt, percent } from '../../lib/siteTraffic.js';

// Parts of a whole as labelled rows: the label, the count and its share, and a thin bar as wide as that share,
// in the one brand hue on a track a step lighter (lib/siteTraffic.js → shareRows builds the rows). Text stays
// in the text tokens; the bar only carries the length.
const ShareRows = ({ rows = [], total = 0, empty = 'None yet.' }) => {
  if (!rows.length) return <p className="text-sm text-fg-subtle">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-fg" title={r.label}>
              {r.label}
            </span>
            <span className="shrink-0 tabular-nums text-fg">
              {fmt(r.count)}
              {percent(r.count, total) && <span className="ml-1.5 text-fg-muted">{percent(r.count, total)}</span>}
            </span>
          </div>
          {r.hint && <div className="text-xs text-fg-muted">{r.hint}</div>}
          <div className="mt-1 h-1.5 rounded-full bg-brand-tint" aria-hidden="true">
            <div className="h-1.5 rounded-full bg-brand-accent/75" style={{ width: `${Math.max(r.share * 100, r.count > 0 ? 1 : 0)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

export default ShareRows;
