import { useRef, useState } from 'react';
import { chartTop, fmt } from '../../lib/siteTraffic.js';

// A column chart in plain markup and theme tokens — the Website page's visits per day and by the hour. One
// series in the brand hue; the selected column at full strength, the rest a step lighter (both clear 3:1 on
// a card, light and dark). Every column is its own hit target, full height, and shows its tooltip on hover
// and on keyboard focus alike; the table view under the daily chart carries every number without hovering.
//
// items: [{ key, value, axis?, axisMinor?, title, lines?: string[], dot?, pending? }]
//   axis    the label under the column (null for none); axisMinor hides it on a phone, where every
//           other label would collide
//   title   the tooltip's first line, and with `lines` the column's accessible name
//   dot     a mark in the strip under the baseline (a day with a demo request)
//   pending a column whose time hasn't come (a later hour today): drawn empty
// selected / onSelect: a selectable chart (the days); without onSelect the columns only describe themselves.
// marks: [{ key, label }] — a labelled hairline across the plot at that column (the AAPC event).
// Keyboard: one Tab stop for the whole chart (roving tabindex, as in ui/Tabs.jsx), then the arrow keys,
// Home and End move from column to column — ninety days would otherwise be ninety Tab presses.
const VisitColumns = ({ items = [], selected = null, onSelect = null, marks = [], height = 168, label, empty = 'No visits in this period.' }) => {
  const [active, setActive] = useState(null);
  // The column holding the Tab stop, by key, so it never lands on a different day when the range changes.
  const [cursorKey, setCursorKey] = useState(null);
  const refs = useRef([]);
  const n = items.length;
  const top = chartTop(Math.max(0, ...items.map((i) => i.value || 0)));
  const at = (i) => `${((i + 0.5) / n) * 100}%`;
  const shown = active == null ? null : items[active];
  // A tooltip near either edge is pinned to that edge rather than centred, so it never leaves the card.
  const tipSide = active == null ? '' : active < n * 0.2 ? 'left' : active > n * 0.8 ? 'right' : 'center';
  const hasDots = items.some((i) => i.dot);
  // Ninety days on a phone leave about 3 px a column: a 1 px gap keeps the bars visible.
  const gap = n > 45 ? 'gap-px' : 'gap-0.5';
  const cursorIndex = items.findIndex((i) => i.key === cursorKey);
  const selectedIndex = items.findIndex((i) => i.key === selected);
  const stop = cursorIndex >= 0 ? cursorIndex : selectedIndex >= 0 ? selectedIndex : n - 1;
  const onKeyDown = (e) => {
    const next = { ArrowRight: stop + 1, ArrowLeft: stop - 1, Home: 0, End: n - 1 }[e.key];
    if (next == null || next < 0 || next >= n) return;
    e.preventDefault();
    setCursorKey(items[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div className={`pl-9 ${marks.length ? 'pt-5' : ''}`}>
      <div className="relative" style={{ height }} onPointerLeave={() => setActive(null)}>
        {top > 0 &&
          [top / 2, top].map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden="true">
              <span className="absolute -left-9 -top-2 w-8 text-right text-[11px] tabular-nums text-fg-subtle">{fmt(t)}</span>
            </div>
          ))}
        <div className="absolute inset-x-0 bottom-0 border-t border-border-strong" aria-hidden="true" />
        {top === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-subtle">{empty}</p>}
        {marks.map((m) => {
          const i = items.findIndex((it) => it.key === m.key);
          if (i === -1) return null;
          return (
            <div key={m.key} className="pointer-events-none absolute inset-y-0 border-l border-fg-subtle" style={{ left: at(i) }} aria-hidden="true">
              <span className={`absolute -top-5 whitespace-nowrap text-[11px] font-medium text-fg-muted ${i > n * 0.8 ? 'right-1' : 'left-1'}`}>
                {m.label}
              </span>
            </div>
          );
        })}
        <div role={onSelect ? 'group' : 'list'} aria-label={label} onKeyDown={onKeyDown} className={`absolute inset-0 flex items-end ${gap}`}>
          {items.map((item, i) => {
            const isSelected = item.key === selected;
            const bar = !item.pending && item.value > 0 && (
              <span
                className={`block w-full max-w-6 rounded-t transition-colors ${
                  isSelected ? 'bg-brand-accent' : active === i ? 'bg-brand-accent/90' : 'bg-brand-accent/75'
                }`}
                style={{ height: `${top > 0 ? (item.value / top) * 100 : 0}%` }}
              />
            );
            const props = {
              ref: (el) => {
                refs.current[i] = el;
              },
              tabIndex: i === stop ? 0 : -1,
              'aria-label': [item.title, ...(item.lines || [])].join(', '),
              onPointerEnter: () => setActive(i),
              onFocus: () => {
                setActive(i);
                setCursorKey(item.key);
              },
              onBlur: () => setActive(null),
              className: `flex h-full min-w-0 flex-1 items-end justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                item.pending ? 'bg-sunken/60' : ''
              }`,
            };
            return onSelect ? (
              <button key={item.key} {...props} type="button" aria-pressed={isSelected} onClick={() => onSelect(item.key)}>
                {bar}
              </button>
            ) : (
              <div key={item.key} {...props} role="listitem">
                {bar}
              </div>
            );
          })}
        </div>
        {shown && (
          <div
            className={`pointer-events-none absolute top-0 z-10 w-max max-w-64 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-popover ${
              tipSide === 'center' ? '-translate-x-1/2' : tipSide === 'right' ? '-translate-x-full' : ''
            }`}
            style={{ left: tipSide === 'left' ? `${(active / n) * 100}%` : tipSide === 'right' ? `${((active + 1) / n) * 100}%` : at(active) }}
          >
            <div className="font-semibold text-fg">{shown.title}</div>
            {(shown.lines || []).map((line) => (
              <div key={line} className="text-fg-muted">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
      {hasDots && (
        <div className={`mt-1 flex h-2 ${gap}`} aria-hidden="true">
          {items.map((item) => (
            <div key={item.key} className="flex min-w-0 flex-1 justify-center">
              {item.dot && <span className="h-2 w-2 shrink-0 rounded-full bg-fg-muted" />}
            </div>
          ))}
        </div>
      )}
      <div className={`mt-1.5 flex ${gap}`} aria-hidden="true">
        {items.map((item, i) => (
          <div key={item.key} className="relative h-4 min-w-0 flex-1">
            {item.axis && (
              <span
                className={`absolute top-0 whitespace-nowrap text-[11px] ${item.key === selected ? 'font-semibold text-fg' : 'text-fg-muted'} ${
                  i === 0 ? 'left-0' : i === n - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
                } ${item.axisMinor ? 'hidden sm:block' : ''}`}
              >
                {item.axis}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default VisitColumns;
