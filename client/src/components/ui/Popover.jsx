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

// Hover/focus tooltip — multi-line capable, themed.
export function Tooltip({ label, children, className = '' }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && label && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-pre rounded-md border border-border bg-raised px-2 py-1 text-xs text-fg shadow-popover ${className}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
