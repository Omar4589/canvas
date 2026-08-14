import { formatDateLabel } from './electionDates.js';

// Presentation for the door-goal block the server sends on campaign rows
// (services/reports/goalProgress.js). The MATH all happens server-side — this file only decides
// what the words and colors are, so the campaign Home card, the campaigns cards and the
// campaigns table can never disagree about what "behind" looks like.
//
// Mirrored by hand in mobile/lib/goalPace.js, same rule as metricHelp.js: reword one, reword both.

// `variant` feeds Badge; `dot` is the compact list-row indicator. Deep -fg tones come from
// Badge's own variants, which is what keeps small status text readable (status TINTS alone fail
// contrast at this size).
export const GOAL_VERDICT = {
  complete: { label: 'Goal met', variant: 'success', dot: 'bg-success' },
  ahead: { label: 'Ahead', variant: 'success', dot: 'bg-success' },
  on_track: { label: 'On track', variant: 'brand', dot: 'bg-brand-accent' },
  behind: { label: 'Behind', variant: 'danger', dot: 'bg-danger' },
  past_due: { label: 'Date passed', variant: 'warning', dot: 'bg-warning' },
  // Deliberately unlabeled states: there is a goal, but no honest verdict to give yet.
  no_pace: { label: null, variant: 'neutral', dot: 'bg-fg-subtle' },
  no_deadline: { label: 'No date', variant: 'neutral', dot: 'bg-fg-subtle' },
};

export const verdictOf = (goal) => GOAL_VERDICT[goal?.verdict] || GOAL_VERDICT.no_deadline;

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

// The projection sentence, or null. Only ever present when the server reached a real verdict.
export function projectionLabel(goal) {
  if (!goal?.projectedFinish) return null;
  const when = formatDateLabel(goal.projectedFinish);
  if (goal.projectedDaysLate) {
    const d = goal.projectedDaysLate;
    return `At this pace you finish ${when} — ${d.toLocaleString()} ${d === 1 ? 'day' : 'days'} past the goal date.`;
  }
  return `At this pace you finish ${when}, on time.`;
}
