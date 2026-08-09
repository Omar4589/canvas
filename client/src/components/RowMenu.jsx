import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { resolveMenuPosition } from '../lib/rowMenuPosition.js';

// Per-row actions in a kebab (⋮) popover, fixed-positioned so it escapes any scroll/overflow
// container — no clipped or cut-off row actions. items: [{ label, onClick, danger?, disabled?, title? }].
//
// Placement is resolved AFTER the menu renders, from its real MEASURED size, by the pure
// resolveMenuPosition (lib/rowMenuPosition.js — where the rules and their tests live). Opening
// blindly downward was the bug: a card in the second row sits low enough that a 5-item menu ran
// off the bottom of the window, and the item count varies (2 in a mid-delete row, 6 for an org
// admin), so no fixed guess covers the long menus that overflow in the first place.
export default function RowMenu({ items }) {
  const [anchor, setAnchor] = useState(null); // the button's rect at open time
  const [pos, setPos] = useState(null); // resolved { top, left }
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const close = () => { setAnchor(null); setPos(null); };
  const toggle = () => (anchor ? close() : setAnchor(btnRef.current.getBoundingClientRect()));

  // useLayoutEffect, not useEffect: it runs before the browser paints, so the corrected position
  // is the first one drawn — the provisional (hidden) render never reaches the screen.
  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;
    const { offsetHeight, offsetWidth } = menuRef.current;
    setPos(
      resolveMenuPosition({
        anchor,
        menu: { width: offsetWidth, height: offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      })
    );
  }, [anchor]);

  // The menu is fixed-positioned from a viewport rect, so any scroll or resize detaches it from
  // its button. Close instead of chasing: cheap, predictable, and matches how a native menu
  // behaves. Capture phase so scrolls inside any container are caught, not just the window's.
  useEffect(() => {
    if (!anchor) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onEsc);
    };
  }, [anchor]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        className="rounded px-2 py-1 text-base leading-none text-fg-muted hover:bg-sunken"
      >
        ⋮
      </button>
      {anchor && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: pos ? pos.top : 0,
              left: pos ? pos.left : 0,
              // Hidden for the one provisional render the measurement needs. `visibility`
              // rather than `display` on purpose — a display:none element has no size to measure.
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="z-50 w-44 overflow-hidden rounded-md border border-border bg-card py-1 text-left shadow-lg"
          >
            {items.map((it) =>
              it.disabled ? (
                <div key={it.label} title={it.title} className="cursor-not-allowed px-3 py-1.5 text-xs text-fg-subtle">{it.label}</div>
              ) : (
                <button
                  key={it.label}
                  role="menuitem"
                  onClick={() => { close(); it.onClick(); }}
                  className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-sunken ${it.danger ? 'text-danger' : 'text-fg'}`}
                >
                  {it.label}
                </button>
              )
            )}
          </div>
        </>
      )}
    </>
  );
}
