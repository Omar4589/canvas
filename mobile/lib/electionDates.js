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

// 'YYYY-MM-DD' -> 'Oct 20', via UTC parts so the civil date never shifts.
export function formatDay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

// { state: 'upcoming'|'open'|'closed', label } or null when neither bound set.
// A missing bound is open-ended on that side. Lexicographic compare is safe.
export function earlyVotingState(startStr, endStr, tz) {
  if (!startStr && !endStr) return null;
  const today = todayInTz(tz);
  if (startStr && today < startStr)
    return { state: 'upcoming', label: `Early voting opens ${formatDay(startStr)}` };
  if (endStr && today > endStr)
    return { state: 'closed', label: 'Early voting closed' };
  return {
    state: 'open',
    label: endStr ? `Early voting open · thru ${formatDay(endStr)}` : 'Early voting open',
  };
}
