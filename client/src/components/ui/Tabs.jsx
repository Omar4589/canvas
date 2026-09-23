import { useRef } from 'react';
import Badge from './Badge.jsx';

// PAGE-LEVEL tabs: an underline bar with real tab semantics.
//
// Distinct from Segmented, which is a compact filter control inside a panel. This is the thing
// that switches what a whole page is about, so it carries the ARIA a screen reader needs to say
// "tab 3 of 5, selected" and the arrow-key roving a keyboard user expects there.
//
// tabs: [{ key, label, count?, tone? }] — `count` renders a Badge, `tone` colours it.
export default function Tabs({ tabs = [], value, onChange, className = '', label = 'Sections' }) {
  const refs = useRef([]);

  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.key === value);
    if (i === -1) return;
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].key);
    // Move focus with the selection, which is what makes arrow-key browsing usable rather than
    // just technically present.
    refs.current[next]?.focus();
  };

  return (
    <div className={`border-b border-border ${className}`}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t, i) => {
          const active = t.key === value;
          return (
            <button
              key={t.key}
              ref={(el) => { refs.current[i] = el; }}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls={`panel-${t.key}`}
              id={`tab-${t.key}`}
              // Roving tabindex: only the selected tab is in the tab order, so Tab moves PAST the
              // bar into the panel rather than through every tab in it.
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.key)}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? 'border-brand-accent text-fg'
                  : 'border-transparent text-fg-muted hover:border-border-strong hover:text-fg'
              }`}
            >
              {t.label}
              {t.count != null && (
                <Badge variant={t.tone || 'neutral'} className="px-1.5 py-0 text-[11px]">
                  {t.count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
