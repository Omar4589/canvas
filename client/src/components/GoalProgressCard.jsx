import { Link } from 'react-router-dom';
import { Card, Badge } from './ui/index.js';
import InfoHint from './InfoHint.jsx';
import { metricHelp } from '../lib/metricHelp.js';
import { verdictOf, deadlineLabel, daysLeftLabel, projectionLabel } from '../lib/goalPace.js';

// Door goal + pace on the campaign Home page.
//
// The caption is load-bearing, not decoration: every other number on this page honors the date
// range, walk-list and crew pickers, and this one does not. Without saying so, "3,412 / 10,000"
// silently reads as "3,412 this week" the moment someone filters.
//
// `goal` is the block from services/reports/goalProgress.js — all the arithmetic already
// happened there. This component picks words and colors; it never computes a rate.

function Figure({ label, value, sub }) {
  return (
    <div>
      <div className="text-xs font-medium text-fg-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{value}</div>
      {sub && <div className="text-xs text-fg-muted">{sub}</div>}
    </div>
  );
}

export default function GoalProgressCard({ goal, onShowHistory, className = '' }) {
  if (!goal?.target) {
    return (
      <Card className={`px-4 py-3 ${className}`}>
        <p className="text-sm text-fg-muted">
          No door goal set.{' '}
          <Link to="/campaigns" className="font-semibold text-brand-accent underline underline-offset-2">
            Set one
          </Link>{' '}
          to track progress and see how many doors a day it takes to get there.
        </p>
      </Card>
    );
  }

  const v = verdictOf(goal);
  const pct = Math.min(100, Math.max(0, goal.percent || 0));
  const deadline = deadlineLabel(goal);
  const days = daysLeftLabel(goal);
  const projection = projectionLabel(goal);
  const done = goal.verdict === 'complete';

  return (
    <Card className={`overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">Door goal</span>
          <InfoHint label="How the door goal is counted">{metricHelp.doorGoal}</InfoHint>
          {v.label && <Badge variant={v.variant} dot>{v.label}</Badge>}
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span>{days ? `${days}${deadline ? ` · ${deadline}` : ''}` : deadline || 'No goal date'}</span>
          {/* A goal is a number someone chose, and it can be changed. When it looks wrong, the
              next question is always "who moved it?" — so the answer is one click from the
              number rather than three pages away. */}
          {onShowHistory && (
            <button
              type="button"
              onClick={onShowHistory}
              className="font-semibold text-fg-muted underline underline-offset-2 hover:text-fg"
            >
              History
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pb-3 pt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-fg">
            {(goal.done || 0).toLocaleString()}
          </span>
          <span className="text-sm text-fg-muted">
            of {goal.target.toLocaleString()} doors
          </span>
          <span className="ml-auto text-sm font-semibold tabular-nums text-fg-muted">{pct}%</span>
        </div>
      </div>

      <div className="h-1.5 w-full bg-sunken">
        <div
          className={`h-full transition-all ${done ? 'bg-success' : 'bg-brand-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {!done && (
        <div className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-3">
          <Figure label="Doors left" value={(goal.remaining || 0).toLocaleString()} />
          {goal.requiredPerDay != null && (
            <Figure
              label="Needed"
              value={`${goal.requiredPerDay.toLocaleString()} / day`}
              sub={goal.requiredPerWeek != null ? `${goal.requiredPerWeek.toLocaleString()} / week` : null}
            />
          )}
          {goal.recentPerDay != null && (
            <Figure
              label="Current pace"
              value={`${goal.recentPerDay.toLocaleString()} / day`}
              sub={`last ${goal.paceWindowDays} ${goal.paceWindowDays === 1 ? 'day' : 'days'}`}
            />
          )}
        </div>
      )}

      <div className="border-t border-border px-4 py-2.5 text-xs text-fg-muted">
        {projection && <p className="mb-1 text-fg">{projection}</p>}
        {goal.verdict === 'no_pace' && (
          <p className="mb-1">
            Not enough canvassing yet to judge the pace — the target above is still what it takes.
          </p>
        )}
        {goal.verdict === 'past_due' && (
          <p className="mb-1">
            The goal date has passed with {(goal.remaining || 0).toLocaleString()} doors to go.
          </p>
        )}
        {goal.verdict === 'no_deadline' && (
          <p className="mb-1">
            Add a goal date (or an Election Day) to see how many doors a day this takes.
          </p>
        )}
        <p>Campaign-wide, all time — not affected by the filters above.</p>
      </div>
    </Card>
  );
}
