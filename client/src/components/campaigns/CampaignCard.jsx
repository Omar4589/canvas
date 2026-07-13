import { Link } from 'react-router-dom';
import RowMenu from '../RowMenu.jsx';
import { Card, Badge, Button } from '../ui/index.js';
import { formatDateInTz } from '../../lib/datetime.js';
import { daysUntil, formatDateLabel, earlyVotingState, countdownLabel } from '../../lib/electionDates.js';

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

export function StatusBadge({ isActive }) {
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

export default function CampaignCard({ campaign: c, menuItems, onAssign }) {
  const households = c.counts?.households || 0;
  const knocked = c.counts?.knocked || 0;
  const knockedPct = households ? Math.round((100 * knocked) / households) : 0;
  const days = daysUntil(c.electionDay, c.timeZone);
  const ev = earlyVotingState(c.earlyVotingStart, c.earlyVotingEnd, c.timeZone);
  const hasDates = !!(c.electionDay || c.earlyVotingStart || c.earlyVotingEnd || c.datesNote);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/campaigns/${c._id}`}
          className="font-semibold text-fg hover:text-brand-accent hover:underline"
        >
          {c.name}
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <TypePill type={c.type} />
          <StatusBadge isActive={c.isActive} />
        </div>
      </div>

      {c.stepsTotal != null && !c.setupComplete && (
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
          <StatRow label="Voters surveyed" value={fmt(c.counts?.surveysSubmitted)} />
        )}
        <StatRow label="Created" value={formatDateInTz(c.createdAt, c.timeZone) || '—'} />
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <Button variant="secondary" size="sm" onClick={() => onAssign(c)}>
          Assignments
        </Button>
        <div className="flex items-center gap-1">
          <Link
            to={`/campaigns/${c._id}`}
            className="text-xs font-medium text-fg-muted hover:text-brand-accent"
          >
            Open dashboard →
          </Link>
          <RowMenu items={menuItems(c)} />
        </div>
      </div>
    </Card>
  );
}
