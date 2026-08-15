// Presentation for the door-goal block the server sends on campaign rows
// (server/src/services/reports/goalProgress.js). The MATH all happens server-side — this file only
// decides the words.
//
// Mirrored BY HAND from client/src/lib/goalPace.js, the same rule metricHelp.js follows:
// reword one, reword both.
//
// The verdict vocabulary, the trailing actual rate and the projected finish were removed from
// every surface (owner ruling 2026-08-15), so the words for them are gone from both mirrors.

// 'YYYY-MM-DD' → 'Oct 28'. Parts parsed by hand and formatted in UTC so the label can never
// shift a day in a behind-UTC zone (new Date('YYYY-MM-DD') is UTC midnight). Also imported by
// lib/campaignHistory.js, which needs the same treatment for the audited date fields.
export function formatGoalDate(dayStr) {
  if (!dayStr) return '';
  const [y, m, d] = String(dayStr).split('-').map(Number);
  if (!y || !m || !d) return String(dayStr);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

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
  const date = formatGoalDate(goal.deadline);
  return goal.deadlineSource === 'electionDay' ? `by Election Day · ${date}` : `by ${date}`;
}

export function daysLeftLabel(goal) {
  const d = goal?.daysLeft;
  if (d == null) return null;
  if (d < 0) return `${Math.abs(d)} ${Math.abs(d) === 1 ? 'day' : 'days'} ago`;
  if (d === 0) return 'Last day';
  return `${d.toLocaleString()} ${d === 1 ? 'day' : 'days'} left`;
}
