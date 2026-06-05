import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const ALIGN = {
  center: 'items-start justify-center',
  right: 'items-stretch justify-end',
  left: 'items-stretch justify-start',
};

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

// Headless modal/drawer shell: portal + scrim (click-to-close), Esc-to-close,
// scroll-lock, focus-trap + focus-restore, role="dialog". Modal/Drawer/Popover
// build their panel inside it. `align` positions the panel.
export default function Overlay({ onClose, align = 'center', className = '', children }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    restoreRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first focusable in the panel (or the panel itself).
    const panel = panelRef.current;
    const first = panel?.querySelector(FOCUSABLE);
    (first || panel)?.focus?.();

    function onKey(e) {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const items = panel.querySelectorAll(FOCUSABLE);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className={`fixed inset-0 z-50 flex ${ALIGN[align] || ALIGN.center}`}>
      <div className="absolute inset-0 animate-fade-in bg-overlay/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`relative outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
