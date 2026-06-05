import { useEffect, useRef, useState } from 'react';

// Click-triggered floating panel: outside-click + Esc dismiss. `trigger` is the
// clickable node; `children` is the panel content. `align` = left|right edge.
export function Popover({ trigger, children, align = 'left', width = 'w-64', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card rounded">
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute top-full z-40 mt-1.5 animate-pop-in rounded-lg border border-border bg-raised p-3 text-sm text-fg-muted shadow-popover ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${width} ${className}`}
        >
          {children}
        </div>
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
