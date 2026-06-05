import { useState } from 'react';

// A small "(i)" button that toggles a short explanatory popover on click. No deps;
// closes on blur. Sits above adjacent content (e.g. the turf map) via z-index.
//   <InfoHint label="What is X?">Some explanation…</InfoHint>
export default function InfoHint({ children, label = 'More info', className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] font-bold leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        i
      </button>
      {open && (
        <span className="absolute left-5 top-0 z-40 w-64 rounded-md border border-gray-200 bg-white p-2.5 text-left text-xs font-normal leading-relaxed text-gray-700 shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}
