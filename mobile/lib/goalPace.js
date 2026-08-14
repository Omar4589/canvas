// Presentation for the door-goal block the server sends on campaign rows
// (server/src/services/reports/goalProgress.js). The MATH all happens server-side — this file
// only decides words and which theme color a verdict wears.
//
// Mirrored BY HAND from client/src/lib/goalPace.js, the same rule metricHelp.js follows:
// reword one, reword both.

// 'YYYY-MM-DD' → 'Oct 28'. Parts parsed by hand and formatted in UTC so the label can never
// shift a day in a behind-UTC zone (new Date('YYYY-MM-DD') is UTC midnight).
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

// `tone` names a key on the theme's colors — resolved by the caller, since colors come from
// useTheme() and this module has no hook to call.
export const GOAL_VERDICT = {
  complete: { label: 'Goal met', tone: 'success' },
  ahead: { label: 'Ahead', tone: 'success' },
  on_track: { label: 'On track', tone: 'brand' },
  behind: { label: 'Behind', tone: 'danger' },
  past_due: { label: 'Date passed', tone: 'warning' },
  // Deliberately unlabeled: there is a goal, but no honest verdict to give yet.
  no_pace: { label: null, tone: 'muted' },
  no_deadline: { label: 'No date', tone: 'muted' },
};

export const verdictOf = (goal) => GOAL_VERDICT[goal?.verdict] || GOAL_VERDICT.no_deadline;

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

export function projectionLabel(goal) {
  if (!goal?.projectedFinish) return null;
  const when = formatGoalDate(goal.projectedFinish);
  if (goal.projectedDaysLate) {
    const d = goal.projectedDaysLate;
    return `At this pace you finish ${when} — ${d.toLocaleString()} ${d === 1 ? 'day' : 'days'} past the goal date.`;
  }
  return `At this pace you finish ${when}, on time.`;
}

// The caption under the group. Load-bearing: every other number on the campaign screen honors
// the range and walk-list filters, and this one does not.
export const GOAL_FOOTER = 'Campaign-wide, all time — the range and walk-list filters do not change it.';
