import { useEffect, useState } from 'react';
import { quickRangeFor } from '../lib/datePresets.js';

const QUICK_CHIPS = [
  { key: 'thisWeek', label: 'This week' },
  { key: 'lastWeek', label: 'Last week' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
];

// Boundaries are date-only 'yyyy-mm-dd' (what <input type=date> uses, and what the
// server interprets in the campaign tz). No ISO/UTC conversion → no day shift.
function toInputDate(v) {
  return v ? String(v).slice(0, 10) : '';
}

// Custom from/to range picker. Open-controlled. `tz` anchors the quick chips to the
// campaign/org clock. onApply receives { from: 'yyyy-mm-dd'|null, to: 'yyyy-mm-dd'|null }.
export default function DateRangePickerModal({
  open,
  initialFrom,
  initialTo,
  tz,
  onClose,
  onApply,
}) {
  const [from, setFrom] = useState(toInputDate(initialFrom));
  const [to, setTo] = useState(toInputDate(initialTo));

  useEffect(() => {
    if (open) {
      setFrom(toInputDate(initialFrom));
      setTo(toInputDate(initialTo));
    }
  }, [open, initialFrom, initialTo]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function applyQuick(key) {
    const r = quickRangeFor(key, tz);
    setFrom(r.from || '');
    setTo(r.to || '');
  }

  function apply() {
    let f = from || null;
    let t = to || null;
    if (f && t && f > t) {
      [f, t] = [t, f]; // lexical compare works for yyyy-mm-dd
    }
    onApply({ from: f, to: t });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-fg">
            Custom date range
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {QUICK_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => applyQuick(c.key)}
              className="rounded-full bg-brand-tint px-3 py-1 text-xs font-medium text-brand-accent hover:bg-brand-tint"
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="w-12 text-sm text-fg-muted" htmlFor="range-from">
              From
            </label>
            <input
              id="range-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            {from ? (
              <button
                type="button"
                onClick={() => setFrom('')}
                className="px-1 text-fg-subtle hover:text-fg-muted"
                aria-label="Clear from date"
              >
                ✕
              </button>
            ) : (
              <span className="w-5" />
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="w-12 text-sm text-fg-muted" htmlFor="range-to">
              To
            </label>
            <input
              id="range-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            {to ? (
              <button
                type="button"
                onClick={() => setTo('')}
                className="px-1 text-fg-subtle hover:text-fg-muted"
                aria-label="Clear to date"
              >
                ✕
              </button>
            ) : (
              <span className="w-5" />
            )}
          </div>
        </div>

        <p className="mt-3 text-xs text-fg-subtle">
          Leave either end blank for an open-ended range.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-fg-muted hover:bg-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex-1 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
