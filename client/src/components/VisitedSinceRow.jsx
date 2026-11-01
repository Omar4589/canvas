import { useEffect, useRef, useState } from 'react';
import { DEFAULT_VISITED_DAYS, VISITED_FLOOR, acceptableSince, daysToSince, maxDays, sinceToDays } from '../lib/visitedSince.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { tzAbbrev } from '../lib/datetime.js';

// "Visited in the last [N] days — since [date]": Turf Cutting's Exclude doors line
// (docs/PROPOSAL_RECENT_VISITS.md). `value` is the committed civil day ('YYYY-MM-DD') or null (unticked);
// `today` is todayInTz(campaign zone). Type a number of days or pick a date; the other follows.
//
// Both boxes keep a draft while you type, so the preview runs once per settled value — not once per
// keystroke — and a half-typed year never becomes the filter. The days box commits 400 ms after you stop
// (typing or the arrows) and at once on blur or Enter; `onPendingChange(true)` while its draft hasn't
// committed yet, so Generate can wait instead of cutting with the previous date.
const VisitedSinceRow = ({ value, onChange, today, tz, onPendingChange }) => {
  const on = !!value;
  const committedDays = on ? sinceToDays(value, today) : DEFAULT_VISITED_DAYS;
  const [daysDraft, setDaysDraft] = useState(null);
  const [dateDraft, setDateDraft] = useState(null);
  const debouncedDays = useDebouncedValue(daysDraft, 400);

  // The latest props for the debounced commit below, so it fires only when the debounced draft changes —
  // never again because the parent re-rendered with a new onChange or an outside change to `value`.
  const latest = useRef({ value, today, onChange });
  latest.current = { value, today, onChange };

  const parseDays = (raw, day) => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= maxDays(day) ? n : null;
  };
  const commitDays = (raw) => {
    const { value: current, today: day, onChange: emit } = latest.current;
    const n = parseDays(raw, day);
    if (n == null) return false;
    const next = daysToSince(n, day);
    if (next !== current) emit(next);
    return true;
  };

  useEffect(() => {
    if (debouncedDays == null) return;
    commitDays(debouncedDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDays]);

  const draftDays = daysDraft != null ? parseDays(daysDraft, today) : null;
  const pending = daysDraft != null && (draftDays == null || daysToSince(draftDays, today) !== value);
  useEffect(() => {
    onPendingChange?.(on && pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, pending]);
  // A row that unmounts mid-edit (the panel collapsed) must not leave Generate waiting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onPendingChange?.(false), []);

  const flushDays = () => {
    if (daysDraft != null) commitDays(daysDraft);
    setDaysDraft(null); // blank or out of range: back to the committed value
  };

  const toggle = (checked) => {
    setDaysDraft(null);
    setDateDraft(null);
    onChange(checked ? daysToSince(DEFAULT_VISITED_DAYS, today) : null);
  };

  const zone = tzAbbrev(tz);
  const inputCls = 'rounded border border-border-strong bg-card px-1 py-0.5 text-fg disabled:opacity-50';
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
          <span>Visited in the last</span>
        </label>
        <input
          type="number"
          min="1"
          max={maxDays(today)}
          disabled={!on}
          aria-label="Days"
          value={daysDraft ?? (on ? String(committedDays ?? '') : String(DEFAULT_VISITED_DAYS))}
          onChange={(e) => setDaysDraft(e.target.value)}
          onBlur={flushDays}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); flushDays(); } }}
          className={`w-14 text-center ${inputCls}`}
        />
        <span>{committedDays === 1 && !daysDraft ? 'day' : 'days'} — since</span>
        <input
          type="date"
          min={VISITED_FLOOR}
          max={today}
          disabled={!on}
          aria-label="Since"
          value={dateDraft ?? (on ? value : daysToSince(DEFAULT_VISITED_DAYS, today))}
          onChange={(e) => {
            const v = e.target.value;
            setDateDraft(v);
            if (acceptableSince(v, today) && v !== value) onChange(v);
          }}
          onBlur={() => setDateDraft(null)}
          className={inputCls}
        />
      </div>
      <p className="mt-0.5 pl-5 text-[11px] text-fg-subtle">
        Any result a canvasser recorded at the door, in any round. Notes and desk marks don't count. Dates follow the
        campaign's time zone{zone ? ` (${zone})` : ''}.
      </p>
    </div>
  );
};

export default VisitedSinceRow;
