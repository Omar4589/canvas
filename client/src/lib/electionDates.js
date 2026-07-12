// Campaign key-date helpers. electionDay / earlyVotingStart / earlyVotingEnd are civil
// 'YYYY-MM-DD' STRINGS interpreted in the campaign's own timezone (stored as strings to
// avoid UTC-midnight off-by-one). ISO date strings order chronologically as plain
// strings, so window checks are lexicographic — no Date parsing.
import { todayInTz } from './datePresets.js';

function today(tz) {
  try {
    return todayInTz(tz);
  } catch {
    return todayInTz(); // invalid tz → UTC day
  }
}

// Whole days from today (in tz) to dateStr: 0 = today, negative = passed, null if unset.
export function daysUntil(dateStr, tz) {
  if (!dateStr) return null;
  const [ty, tm, td] = today(tz).split('-').map(Number);
  const [y, m, d] = dateStr.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000;
}

// 'YYYY-MM-DD' → 'Oct 20'. Formats the UTC-anchored parts with timeZone:'UTC' so the
// label never shifts a day in behind-UTC zones (new Date('YYYY-MM-DD') is UTC midnight).
export function formatDateLabel(dateStr, opts) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...opts,
  });
}

// Early-voting window state for today in the campaign's tz. A missing bound is
// open-ended on that side; null when neither bound is set.
export function earlyVotingState(startStr, endStr, tz) {
  if (!startStr && !endStr) return null;
  const t = today(tz);
  if (startStr && t < startStr) {
    // Carry the END date too: "when does early voting end?" is asked long before the window
    // opens, and naming only the start left the admin who typed both dates unable to see one.
    const label = endStr
      ? `Opens ${formatDateLabel(startStr)} · through ${formatDateLabel(endStr)}`
      : `Opens ${formatDateLabel(startStr)}`;
    return { state: 'upcoming', label };
  }
  if (endStr && t > endStr) {
    return { state: 'closed', label: `Ended ${formatDateLabel(endStr)}` };
  }
  let label = 'Open now';
  if (startStr && endStr) label = `Open now · ${formatDateLabel(startStr)} – ${formatDateLabel(endStr)}`;
  else if (endStr) label = `Open now · through ${formatDateLabel(endStr)}`;
  return { state: 'open', label };
}

// Countdown chip text from daysUntil(): 'Today' / '1 day' / 'N days' / 'Passed'.
export function countdownLabel(days) {
  if (days == null) return null;
  if (days === 0) return 'Today';
  if (days < 0) return 'Passed';
  return days === 1 ? '1 day' : `${days} days`;
}
