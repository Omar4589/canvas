import { Link } from 'react-router-dom';
import { Badge } from './ui/index.js';
import InfoHint from './InfoHint.jsx';
import { metricHelp } from '../lib/metricHelp.js';
import { verdictOf, daysLeftLabel, projectionLabel } from '../lib/goalPace.js';

// Door goal + pace as one thin line in the campaign header, beside the key-date pills.
//
// The placement is the explanation. This is the only number on Home that ignores the date-range,
// walk-list and crew pickers, and as a card in the body it needed a caption apologising for that.
// Up here it sits in campaign-identity space — next to Election Day and the early-voting window,
// which don't react to those filters either — so the exemption reads as obvious instead of odd.
// The sentence itself still exists, in metricHelp.doorGoal behind the (i).
//
// `goal` is the block from services/reports/goalProgress.js. Every number here was computed there;
// this component picks words, colors and what to leave out.

// One muted "· fragment" in the run of numbers. Nothing renders for a null child, so each caller
// can pass a value straight through without guarding.
function Bit({ children }) {
  if (children == null) return null;
  return <span className="text-fg-muted">{children}</span>;
}

export default function GoalStrip({ goal, onShowHistory }) {
  if (!goal?.target) {
    return (
      <span className="text-xs text-fg-subtle">
        No door goal ·{' '}
        <Link to="/campaigns" className="font-medium text-fg-muted underline underline-offset-2 hover:text-fg">
          set one
        </Link>
      </span>
    );
  }

  const v = verdictOf(goal);
  const pct = Math.min(100, Math.max(0, goal.percent || 0));
  const done = goal.verdict === 'complete';
  const projection = projectionLabel(goal);

  // The deadline appears here ONLY when it came from an explicit goalDate. When it fell back to
  // Election Day, the countdown pill directly above already says it, to the day — repeating it
  // is the height this strip exists to give back. An explicit goal date has no other home.
  const ownDate = goal.deadlineSource === 'goalDate' ? daysLeftLabel(goal) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="font-medium text-fg">Goal</span>

      <span className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-sunken">
        <span
          className={`block h-full rounded-full ${done ? 'bg-success' : 'bg-brand-600'}`}
          style={{ width: `${pct}%` }}
        />
      </span>

      <span className="font-semibold tabular-nums text-fg">{pct}%</span>
      <Bit>·</Bit>
      <span className="tabular-nums text-fg">
        {(goal.done || 0).toLocaleString()} / {goal.target.toLocaleString()}
      </span>

      {!done && (
        <>
          <Bit>·</Bit>
          <Bit>{(goal.remaining || 0).toLocaleString()} left</Bit>
          {goal.requiredPerDay != null && (
            <>
              <Bit>·</Bit>
              <span className="font-medium tabular-nums text-fg">
                need {goal.requiredPerDay.toLocaleString()}/day
              </span>
            </>
          )}
          {goal.recentPerDay != null && (
            <>
              <Bit>·</Bit>
              <Bit>doing {goal.recentPerDay.toLocaleString()}/day</Bit>
            </>
          )}
        </>
      )}

      {ownDate && (
        <>
          <Bit>·</Bit>
          <Bit>{ownDate}</Bit>
        </>
      )}

      {v.label && <Badge variant={v.variant} dot>{v.label}</Badge>}

      {projection && <Bit title={projection}>{shortProjection(goal)}</Bit>}

      <InfoHint label="How the door goal is counted">{metricHelp.doorGoal}</InfoHint>

      {onShowHistory && (
        <button
          type="button"
          onClick={onShowHistory}
          className="font-medium text-fg-muted underline underline-offset-2 hover:text-fg"
        >
          History
        </button>
      )}
    </div>
  );
}

// The projection as numbers, not a sentence — the full sentence rides the title attribute.
function shortProjection(goal) {
  const d = goal.projectedDaysLate;
  return d ? `finishing ${d.toLocaleString()}d late` : 'finishing on time';
}
