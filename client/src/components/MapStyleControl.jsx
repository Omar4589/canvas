import { useEffect, useRef, useState } from 'react';
import { MAP_STYLES } from '../lib/mapStyles.js';
import { IconLayers, IconCheck } from './ui/icons.jsx';

// Floating basemap-style picker for the map pages — a "layers" button that opens a
// small menu (Street / Hybrid / Satellite / Outdoors / Dark). Mirrors the mobile
// MapStyleControl. Position + alignment come from the wrapper `className` (absolute
// + offsets + items-start/end); `menuDirection` opens the menu up or down.
export default function MapStyleControl({ value, onChange, className = '', menuDirection = 'up' }) {
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

  const menu = open ? (
    <div className={`min-w-[150px] animate-pop-in rounded-lg border border-border bg-raised p-1 shadow-popover ${menuDirection === 'up' ? 'mb-2' : 'mt-2'}`}>
      {MAP_STYLES.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onChange(s.id);
              setOpen(false);
            }}
            className={`flex w-full items-center justify-between gap-4 rounded-md px-3 py-1.5 text-sm transition-colors ${
              active ? 'bg-brand-tint font-medium text-brand-tint-fg' : 'text-fg hover:bg-sunken'
            }`}
          >
            {s.label}
            {active && <IconCheck size={14} />}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={ref} className={`flex flex-col ${className}`}>
      {menuDirection === 'up' && menu}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change map style"
        title="Change map style"
        className={`flex h-10 w-10 items-center justify-center rounded-lg border border-border shadow-popover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          open ? 'bg-brand-600 text-white' : 'bg-card text-fg-muted hover:text-fg'
        }`}
      >
        <IconLayers size={20} />
      </button>
      {menuDirection === 'down' && menu}
    </div>
  );
}
