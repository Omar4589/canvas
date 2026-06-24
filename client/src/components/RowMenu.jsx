import { useState, useRef } from 'react';

// Per-row actions in a kebab (⋮) popover, fixed-positioned so it escapes any scroll/overflow
// container — no clipped or cut-off row actions. items: [{ label, onClick, danger?, disabled?, title? }].
export default function RowMenu({ items }) {
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  function toggle() {
    if (pos) return setPos(null);
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }
  return (
    <>
      <button ref={btnRef} onClick={toggle} aria-label="Actions" className="rounded px-2 py-1 text-base leading-none text-fg-muted hover:bg-sunken">⋮</button>
      {pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <div style={{ position: 'fixed', top: pos.top, right: pos.right }} className="z-50 w-44 overflow-hidden rounded-md border border-border bg-card py-1 text-left shadow-lg">
            {items.map((it) =>
              it.disabled ? (
                <div key={it.label} title={it.title} className="cursor-not-allowed px-3 py-1.5 text-xs text-fg-subtle">{it.label}</div>
              ) : (
                <button
                  key={it.label}
                  onClick={() => { setPos(null); it.onClick(); }}
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
