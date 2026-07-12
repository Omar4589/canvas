// Campaign key-date helpers. Inputs are civil 'YYYY-MM-DD' strings interpreted
// in the campaign's timeZone — never new Date('YYYY-MM-DD') for display (the
// implied UTC midnight shifts a day in US zones).

export function todayInTz(tz) {
  // An invalid tz string makes Intl throw — fall back to the device zone rather
  // than crashing the campaign picker on bad server data.
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date());
  }
}

// Whole days from today (campaign zone) to dateStr: 0 = today, negative = passed.
export function daysUntil(dateStr, tz) {
  if (!dateStr) return null;
  const [y1, m1, d1] = todayInTz(tz).split('-').map(Number);
  const [y2, m2, d2] = dateStr.split('-').map(Number);
  return (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000;
}

// 'YYYY-MM-DD' -> 'Oct 20' (or 'Tue Nov 3' with { weekday: 'short' }), via UTC parts
// so the civil date never shifts.
export function formatDay(dateStr, opts) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC', ...opts,
  });
}

// True when a campaign has any key date worth showing. The chip's own null-check AND any
// caller drawing chrome AROUND the chip (the Books header's divider) must agree, so both
// ask this and only this — `campaign` is truthy even with no dates set, so a naive
// caller-side check would leave a hairline hanging over nothing.
export function hasKeyDates({
  electionDay,
  earlyVotingStart,
  earlyVotingEnd,
  datesNote,
  showNote = false,
} = {}) {
  return !!(electionDay || earlyVotingStart || earlyVotingEnd || (showNote && datesNote));
}

// { state: 'upcoming'|'open'|'closed', label, urgent } or null when neither bound set.
// The FULL window rides in the label at EVERY phase — "when does early voting end?" is a
// question canvassers get at the door, and the old copy only answered it once the window
// had already opened. A missing bound is open-ended on that side; lexicographic compare is
// safe on 'YYYY-MM-DD'.
export function earlyVotingState(startStr, endStr, tz) {
  if (!startStr && !endStr) return null;
  const today = todayInTz(tz);
  // Tight en dash (no spaces) — a few points narrower, which is the difference between one
  // line and two in the floating Books card on a small phone.
  const range = startStr && endStr ? `${formatDay(startStr)}–${formatDay(endStr)}` : null;

  if (startStr && today < startStr) {
    const opensTomorrow = daysUntil(startStr, tz) === 1;
    const base = range ? `Early voting ${range}` : `Early voting opens ${formatDay(startStr)}`;
    return {
      state: 'upcoming',
      label: opensTomorrow ? `${base} · opens tomorrow` : base,
      urgent: opensTomorrow, // tomorrow the door script changes
    };
  }
  if (endStr && today > endStr)
    return { state: 'closed', label: `Early voting ended ${formatDay(endStr)}`, urgent: false };
  if (endStr && today === endStr)
    return { state: 'open', label: 'Early voting · last day today', urgent: true };

  let label = 'Early voting open';
  if (range) label = `Early voting ${range} · open now`;
  else if (endStr) label = `Early voting open · ends ${formatDay(endStr)}`;
  return { state: 'open', label, urgent: false };
}
