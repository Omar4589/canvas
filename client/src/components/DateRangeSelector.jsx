import { useState } from 'react';
import DateRangePickerModal from './DateRangePickerModal.jsx';
import {
  RANGE_PRESETS,
  rangeFor,
  quickRangeFor,
  defaultRange,
  labelForRange,
} from '../lib/datePresets.js';

// Re-export the pure preset helpers so existing imports keep working.
export { RANGE_PRESETS, rangeFor, quickRangeFor, defaultRange, labelForRange };

// Controlled preset bar. `value` is { preset, from, to }; `tz` is the anchor
// (campaign/org) timezone so presets resolve to the campaign's days, not the device's.
// onChange receives the full next object whenever a preset or custom range is chosen.
export default function DateRangeSelector({ value, onChange, tz }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const activePreset = value?.preset || 'today';

  function selectPreset(id) {
    if (id === 'custom') {
      setPickerOpen(true);
      return;
    }
    const r = rangeFor(id, null, tz);
    onChange({ preset: id, from: r.from, to: r.to });
  }

  function applyCustom({ from, to }) {
    onChange({ preset: 'custom', from, to });
    setPickerOpen(false);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-sm shadow-sm">
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
                  : 'text-fg-muted hover:bg-sunken')
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {activePreset === 'custom' ? (
        <div className="text-xs italic text-fg-muted">{labelForRange(value)}</div>
      ) : null}

      <DateRangePickerModal
        open={pickerOpen}
        initialFrom={value?.from || null}
        initialTo={value?.to || null}
        tz={tz}
        onClose={() => setPickerOpen(false)}
        onApply={applyCustom}
      />
    </div>
  );
}
