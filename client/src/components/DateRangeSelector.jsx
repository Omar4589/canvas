import { useState } from 'react';
import DateRangePickerModal from './DateRangePickerModal.jsx';

// Shared date-range presets and helpers for the admin dashboards.
//
// Mirrors mobile/lib/dateRanges.js so the web and mobile surfaces compute the
// same boundaries. `from` is inclusive, `to` is exclusive. A null bound means
// "no lower/upper limit". All boundaries are local-time start-of-day.

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const RANGE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

export function rangeFor(preset, custom) {
  const start = startOfDay(new Date());

  if (preset === 'today') {
    return { from: start.toISOString(), to: null };
  }
  if (preset === 'yesterday') {
    const yStart = new Date(start);
    yStart.setDate(yStart.getDate() - 1);
    return { from: yStart.toISOString(), to: start.toISOString() };
  }
  if (preset === '7d') {
    const s = new Date(start);
    s.setDate(s.getDate() - 6);
    return { from: s.toISOString(), to: null };
  }
  if (preset === '30d') {
    const s = new Date(start);
    s.setDate(s.getDate() - 29);
    return { from: s.toISOString(), to: null };
  }
  if (preset === 'custom' && custom) {
    return { from: custom.from || null, to: custom.to || null };
  }
  return { from: null, to: null };
}

// Convenience for initializing page state in one line.
export function defaultRange(preset) {
  return { preset, ...rangeFor(preset) };
}

export function labelForRange({ preset, from, to }) {
  const p = RANGE_PRESETS.find((x) => x.id === preset);
  if (p && preset !== 'custom') return p.label;
  if (preset === 'custom') {
    const f = from ? new Date(from) : null;
    const t = to ? new Date(to) : null;
    const opts = { month: 'short', day: 'numeric' };
    if (f && t) {
      const same = f.toDateString() === t.toDateString();
      if (same) return f.toLocaleDateString(undefined, opts);
      return `${f.toLocaleDateString(undefined, opts)} – ${t.toLocaleDateString(
        undefined,
        opts
      )}`;
    }
    if (f) return `Since ${f.toLocaleDateString(undefined, opts)}`;
    if (t) return `Until ${t.toLocaleDateString(undefined, opts)}`;
  }
  return 'All time';
}

// Quick chips inside the custom picker.
export function quickRangeFor(key) {
  const start = startOfDay(new Date());
  if (key === 'thisWeek') {
    // Monday-as-week-start
    const day = (start.getDay() + 6) % 7;
    const s = new Date(start);
    s.setDate(s.getDate() - day);
    return { from: s.toISOString(), to: null };
  }
  if (key === 'lastWeek') {
    const day = (start.getDay() + 6) % 7;
    const sThisMon = new Date(start);
    sThisMon.setDate(sThisMon.getDate() - day);
    const sLastMon = new Date(sThisMon);
    sLastMon.setDate(sLastMon.getDate() - 7);
    return { from: sLastMon.toISOString(), to: sThisMon.toISOString() };
  }
  if (key === 'thisMonth') {
    const s = new Date(start.getFullYear(), start.getMonth(), 1);
    return { from: s.toISOString(), to: null };
  }
  if (key === 'lastMonth') {
    const s = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    const e = new Date(start.getFullYear(), start.getMonth(), 1);
    return { from: s.toISOString(), to: e.toISOString() };
  }
  return { from: null, to: null };
}

// Controlled preset bar. value is { preset, from, to }; onChange receives the
// full next object whenever a preset or custom range is chosen. The caller's
// query keys already include from/to, so a new object re-fetches automatically.
export default function DateRangeSelector({ value, onChange }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const activePreset = value?.preset || 'today';

  function selectPreset(id) {
    if (id === 'custom') {
      setPickerOpen(true);
      return;
    }
    const r = rangeFor(id);
    onChange({ preset: id, from: r.from, to: r.to });
  }

  function applyCustom({ from, to }) {
    onChange({ preset: 'custom', from, to });
    setPickerOpen(false);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm shadow-sm">
        {RANGE_PRESETS.map((p) => {
          const active = p.id === activePreset;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPreset(p.id)}
              className={
                'rounded px-3 py-1 transition-colors ' +
                (active
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100')
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {activePreset === 'custom' ? (
        <div className="text-xs italic text-gray-500">{labelForRange(value)}</div>
      ) : null}

      <DateRangePickerModal
        open={pickerOpen}
        initialFrom={value?.from || null}
        initialTo={value?.to || null}
        onClose={() => setPickerOpen(false)}
        onApply={applyCustom}
      />
    </div>
  );
}
