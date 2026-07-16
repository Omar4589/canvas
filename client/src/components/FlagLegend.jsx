import { Popover } from './ui/Popover.jsx';
import { FLAG_LEGEND, FLAG_LEGEND_FOOTER, REASON_BY_KEY } from '../lib/flags.js';

// A small "(i)" that opens the flag-type legend — what each of the five GPS-audit flags
// means, the four Weak-GPS sub-kinds, and how severities/counts read. Copy lives in
// lib/flags.js (FLAG_LEGEND) so the map, audit page, and entry panel all say one thing.
// Same trigger styling as InfoHint; wider panel with its own scroll (the legend is long).
export default function FlagLegend({ className = '' }) {
  const trigger = (
    <span
      aria-label="What do the flag types mean?"
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border-strong text-[10px] font-bold leading-none text-fg-muted hover:bg-sunken hover:text-fg"
    >
      i
    </span>
  );
  return (
    <span className={`inline-flex ${className}`}>
      <Popover trigger={trigger} width="w-80" className="max-h-[70vh] overflow-y-auto text-xs font-normal normal-case leading-relaxed tracking-normal text-fg-muted">
        <div className="space-y-2.5">
          {FLAG_LEGEND.map((l) => {
            const meta = REASON_BY_KEY[l.key];
            return (
              <div key={l.key}>
                <div className="flex items-center gap-1.5 font-semibold text-fg">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta?.color || '#888' }} />
                  {meta?.label || l.key}
                </div>
                <p className="mt-0.5">{l.text}</p>
                {l.kinds && (
                  <ul className="mt-1 space-y-1 pl-3.5">
                    {l.kinds.map((k) => (
                      <li key={k.label}>
                        <span className="font-medium text-fg">{k.label}</span> — {k.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <p className="border-t border-border pt-2">{FLAG_LEGEND_FOOTER}</p>
        </div>
      </Popover>
    </span>
  );
}
