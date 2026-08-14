import { Link } from 'react-router-dom';
import RowMenu from '../RowMenu.jsx';
import { useRowNavigation, stopRowClick } from '../../lib/rowNavigation.js';
import { Card, Badge, Button } from '../ui/index.js';
import { formatDateInTz } from '../../lib/datetime.js';
import { daysUntil, formatDateLabel, earlyVotingState, countdownLabel } from '../../lib/electionDates.js';
import { verdictOf, shortCount, daysLeftLabel } from '../../lib/goalPace.js';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </div>
  );
}

// Shared with CampaignsTable + DashboardPage so the type/countdown chips render identically.
export function TypePill({ type }) {
  return (
    <span
      className={
        type === 'lit_drop'
          ? 'rounded-full bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-500'
          : 'rounded-full bg-info-tint px-2 py-0.5 text-xs font-medium text-info-fg'
      }
    >
      {type === 'lit_drop' ? 'Lit drop' : 'Survey'}
    </span>
  );
}

export function StatusBadge({ isActive, deletionStatus }) {
  // Mid-delete states outrank active/archived — the row is on its way out. `deletionStatus`
  // only exists on rows from the deletingCampaigns array (Campaigns page); other callers
  // (DashboardPage) never pass it and are unchanged.
  if (deletionStatus === 'failed') return <Badge variant="danger" dot>Delete failed</Badge>;
  if (deletionStatus) return <Badge variant="warning" dot>Deleting…</Badge>;
  return isActive ? (
    <Badge variant="success" dot>Active</Badge>
  ) : (
    <Badge variant="neutral">Archived</Badge>
  );
}

// Election-Day countdown: brand tint while upcoming (incl. today), muted once passed.
export function CountdownChip({ days }) {
  const label = countdownLabel(days);
  if (label == null) return null;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        days >= 0 ? 'bg-brand-tint text-brand-tint-fg' : 'bg-sunken text-fg-muted'
      }`}
    >
      {label}
    </span>
  );
}

// Door-goal progress, compact. Two shapes, one source: the `goal` block the server puts on each
// campaign row (services/reports/goalProgress.js), which is ALL-TIME and campaign-wide. Shared
// with CampaignsTable so the card and table views can't drift.
function GoalTrack({ goal, className = '' }) {
  const pct = Math.min(100, Math.max(0, goal.percent || 0));
  return (
    <span className={`h-1.5 overflow-hidden rounded-full bg-sunken ${className}`}>
      <span
        className={`block h-full rounded-full ${goal.verdict === 'complete' ? 'bg-success' : 'bg-brand-600'}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

// Table cell: "3.4k / 10k" + bar + a verdict dot. The dot alone never carries the meaning —
// it's title-ed, and the row's own Home page states it in words.
export function GoalCell({ goal }) {
  if (!goal?.target) return <span className="block text-right text-fg-muted">—</span>;
  const v = verdictOf(goal);
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="tabular-nums">
        {shortCount(goal.done)} / {shortCount(goal.target)}
      </span>
      <GoalTrack goal={goal} className="w-16" />
      {v.label && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v.dot}`} title={v.label} />}
    </div>
  );
}

// Card block: the same numbers with room for the verdict in words.
export function GoalBlock({ goal }) {
  if (!goal?.target) return null;
  const v = verdictOf(goal);
  const days = daysLeftLabel(goal);
  return (
    <div className="space-y-1.5 rounded-lg bg-sunken px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-fg-muted">Door goal</span>
        <span className="flex items-center gap-1.5">
          <span className="font-medium tabular-nums text-fg">
            {shortCount(goal.done)} / {shortCount(goal.target)}
          </span>
          {v.label && <Badge variant={v.variant} dot>{v.label}</Badge>}
        </span>
      </div>
      <GoalTrack goal={goal} className="block w-full" />
      {(goal.requiredPerDay != null || days) && (
        <p className="text-xs text-fg-muted">
          {[days, goal.requiredPerDay != null ? `${goal.requiredPerDay.toLocaleString()} a day needed` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

export default function CampaignCard({ campaign: c, menuItems, onAssign }) {
  const households = c.counts?.households || 0;
  const knocked = c.counts?.knocked || 0;
  const knockedPct = households ? Math.round((100 * knocked) / households) : 0;
  const days = daysUntil(c.electionDay, c.timeZone);
  const ev = earlyVotingState(c.earlyVotingStart, c.earlyVotingEnd, c.timeZone);
  const hasDates = !!(c.electionDay || c.earlyVotingStart || c.earlyVotingEnd || c.datesNote);
  // Mid-delete rows are inert: no drill-in (campaign-scoped routes already 404), no
  // Assignments; the page's menuItems() shrinks to Retry (failed) or nothing.
  const gone = !!c.deletionStatus;
  const items = menuItems(c);
  const href = `/campaigns/${c._id}`;
  // Whole-card click → the dashboard. Rules and rationale live in lib/rowNavigation.js; the
  // card's own controls sit inside a stopRowClick wrapper in the footer below.
  const openDashboard = useRowNavigation(href);

  return (
    <Card
      onClick={gone ? undefined : openDashboard}
      className={`flex flex-col gap-3 p-4 ${
        // Matches the clickable-row affordance already used in TeamBreakdown /
        // CanvasserSummaryTable, plus a border lift a bordered card can afford.
        gone ? '' : 'cursor-pointer transition-colors hover:border-border-strong hover:bg-sunken/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {gone ? (
          <span className="font-semibold text-fg">{c.name}</span>
        ) : (
          // stopRowClick so the Link navigates once, not twice (it and the card handler both
          // target this URL — harmless, but a double navigate is sloppy). The Link stays because
          // it, not the card, is what keyboard and screen-reader users use.
          <Link
            to={href}
            onClick={stopRowClick}
            className="font-semibold text-fg hover:text-brand-accent hover:underline"
          >
            {c.name}
          </Link>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          <TypePill type={c.type} />
          <StatusBadge isActive={c.isActive} deletionStatus={c.deletionStatus} />
        </div>
      </div>

      {!gone && c.stepsTotal != null && !c.setupComplete && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-tint-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-accent" />
          Setup {c.stepsDone}/{c.stepsTotal} · not live
        </span>
      )}

      {hasDates && (
        <div className="space-y-1.5 rounded-lg bg-sunken px-3 py-2">
          {c.electionDay && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-fg-muted">Election Day</span>
              <span className="flex items-center gap-1.5 font-medium text-fg">
                {formatDateLabel(c.electionDay)}
                <CountdownChip days={days} />
              </span>
            </div>
          )}
          {ev && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-fg-muted">Early voting</span>
              {ev.state === 'open' ? (
                <Badge variant="success">{ev.label}</Badge>
              ) : (
                <span className="text-xs font-medium text-fg-muted">{ev.label}</span>
              )}
            </div>
          )}
          {c.datesNote && <p className="text-xs text-fg-muted">{c.datesNote}</p>}
        </div>
      )}

      {!gone && <GoalBlock goal={c.goal} />}

      <div className="space-y-1.5">
        <StatRow label="State" value={c.state || '—'} />
        <StatRow
          label="Survey template"
          value={c.surveyTemplateId?.name || (c.type === 'survey' ? '— none' : '—')}
        />
        <StatRow label="Households" value={fmt(c.counts?.households)} />
        <StatRow label="Houses knocked" value={`${fmt(c.counts?.knocked)} (${knockedPct}%)`} />
        {c.type === 'lit_drop' ? (
          <StatRow label="Lit drops" value={fmt(c.counts?.litDropped)} />
        ) : (
          <StatRow label="Surveys taken" value={fmt(c.counts?.surveysSubmitted)} />
        )}
        <StatRow label="Created" value={formatDateInTz(c.createdAt, c.timeZone) || '—'} />
      </div>

      {/* Every control lives inside this one stopPropagation boundary, so the whole-card click
          above can never fire alongside them. It wraps rather than annotating each control
          because that is the invariant worth enforcing in one place: anything interactive added
          to this footer later is covered automatically. Note the kebab is included — RowMenu's
          popover is position:fixed but still a React child, and React events bubble through the
          component tree, so a menu-item click is caught here too. */}
      <div
        onClick={stopRowClick}
        className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3"
      >
        {gone ? (
          <>
            <p className={`text-xs ${c.deletionStatus === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
              {c.deletionStatus === 'failed'
                ? c.deletionError || 'The delete stopped partway. Retry to finish removing this campaign.'
                : 'Removing doors and voters in the background…'}
            </p>
            {items.length > 0 && <RowMenu items={items} />}
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => onAssign(c)}>
              Assignments
            </Button>
            <div className="flex items-center gap-1">
              <Link
                to={href}
                className="text-xs font-medium text-fg-muted hover:text-brand-accent"
              >
                Open dashboard →
              </Link>
              <RowMenu items={items} />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
