import { formatDateLabel } from './electionDates.js';

// Presentation for the door-goal block the server sends on campaign rows
// (services/reports/goalProgress.js). The MATH all happens server-side — this file only decides
// what the words are, so the campaign Home strip, the campaigns cards and the campaigns table can
// never disagree about how a goal reads.
//
// Mirrored by hand in mobile/lib/goalPace.js, same rule as metricHelp.js: reword one, reword both.
//
// The verdict vocabulary (ahead / on track / behind), the trailing actual rate and the projected
// finish were removed from every surface (owner ruling 2026-08-15), so the words for them are gone
// too. The goal reports progress and what it takes from here; it does not grade anyone.

// "1,234" / "1.2k" — the compact form for card and table rows where the full number crowds out
// everything beside it.
export function shortCount(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(v / 1000)}k`;
}

// "by Oct 28" / "by Election Day · Nov 3" — naming Election Day when that's where the deadline
// came from, so nobody wonders why a date they never typed is driving the countdown.
export function deadlineLabel(goal) {
  if (!goal?.deadline) return null;
  const date = formatDateLabel(goal.deadline);
  return goal.deadlineSource === 'electionDay' ? `by Election Day · ${date}` : `by ${date}`;
}

export function daysLeftLabel(goal) {
  const d = goal?.daysLeft;
  if (d == null) return null;
  if (d < 0) return `${Math.abs(d)} ${Math.abs(d) === 1 ? 'day' : 'days'} ago`;
  if (d === 0) return 'Last day';
  return `${d.toLocaleString()} ${d === 1 ? 'day' : 'days'} left`;
}
