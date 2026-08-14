import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Click-triggered floating panel: outside-click + Esc dismiss. `trigger` is the
// clickable node; `children` is the panel content. `align` = left|right edge.
// The panel is portalled to <body> with fixed positioning (computed from the
// trigger rect) so it floats above any scroll/overflow container instead of
// living inside it — otherwise it forces scrollbars / gets clipped.
export function Popover({ trigger, children, align = 'left', width = 'w-64', className = '' }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Anchor the panel's left or right edge to the trigger, just below it.
    setPos(
      align === 'right'
        ? { top: r.bottom + 6, right: window.innerWidth - r.right }
        : { top: r.bottom + 6, left: r.left }
    );
  }, [align]);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onMove() {
      reposition();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, reposition]);

  return (
    <span ref={triggerRef} className="relative inline-flex">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card rounded">
        {trigger}
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', ...pos }}
            className={`z-50 animate-pop-in rounded-lg border border-border bg-raised p-3 text-sm text-fg-muted shadow-popover ${width} ${className}`}
          >
            {children}
          </div>,
          document.body
        )}
    </span>
  );
}

// Hover/focus tooltip — multi-line capable, themed. THE tooltip: the native
// `title` attribute it replaces takes about a second to appear, is drawn by the
// OS instead of by our tokens, and is easy to miss entirely.
//
//   <Tooltip label="Measured hours (FbTime)"><span>6.2h</span></Tooltip>
//
// PORTALLED to <body> like Popover above, not merely absolute- or fixed-
// positioned. Absolute is clipped by any `overflow` ancestor — DataTable wraps
// every table in `overflow-x-auto`, and CSS resolves the other axis to `auto`
// too whenever one axis is not `visible`, so a tip on a table cell was cut off
// at the card edge. Fixed survives that but not a transformed ancestor, which
// becomes the containing block. Only the portal holds in both.
//
// aria-hidden, deliberately: the trigger owns the accessible name (an aria-label
// on a collapsed nav item, the visible cell text otherwise), and announcing the
// tip too reads it twice. Callers with no other accessible text should label the
// trigger themselves.
const TOOLTIP_DELAY_MS = 120;

const PLACEMENTS = {
  // Horizontally centred above the trigger — the default, and the table-cell
  // case, where a tip to the right would fall off a narrow numeric column.
  top: (r) => ({
    top: r.top - 8,
    left: r.left + r.width / 2,
    transform: 'translate(-50%, -100%)',
  }),
  // Vertically centred beside it — the sidebar rail's geometry.
  right: (r) => ({
    top: r.top + r.height / 2,
    left: r.right + 10,
    transform: 'translateY(-50%)',
  }),
};

export function Tooltip({
  label,
  children,
  enabled = true,
  placement = 'top',
  delay = TOOLTIP_DELAY_MS,
  block = false,
  className = '',
}) {
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // The timer outlives the trigger whenever a row re-sorts out from under the
  // cursor or a modal closes mid-hover, so it is cleared on unmount too.
  useEffect(() => clear, [clear]);

  const show = useCallback(
    (immediate) => {
      if (!enabled || !label) return;
      clear();
      const open = () => {
        const el = triggerRef.current;
        if (!el) return; // unmounted between the hover and the timer firing
        const r = el.getBoundingClientRect();
        const base = (PLACEMENTS[placement] || PLACEMENTS.top)(r);
        // Clamped so a trigger at the very top or bottom of a scrolled list
        // still gets a fully visible tip.
        setPos({ ...base, top: Math.min(Math.max(base.top, 8), window.innerHeight - 8) });
      };
      if (immediate || delay <= 0) open();
      else timerRef.current = setTimeout(open, delay);
    },
    [enabled, label, placement, delay, clear]
  );

  const hide = useCallback(() => {
    clear();
    setPos(null);
  }, [clear]);

  return (
    <span
      ref={triggerRef}
      className={block ? 'block' : 'inline-flex'}
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      // Keyboard focus opens at once: that user has already committed to the
      // target, so the anti-flicker delay would only read as latency.
      onFocus={() => show(true)}
      onBlur={hide}
    >
      {children}
      {enabled && pos
        ? createPortal(
            <span
              aria-hidden="true"
              style={{ position: 'fixed', top: pos.top, left: pos.left, transform: pos.transform }}
              className={`pointer-events-none z-50 max-w-xs rounded-md border border-border bg-raised px-2 py-1 text-xs leading-snug text-fg shadow-popover ${className}`}
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
