import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { setStoredCampaignId } from './CampaignSelector.jsx';
import { Card, Badge, Button, SkeletonRows } from './ui/index.js';

// Per-campaign cold-start checklist. NON-BLOCKING: it signposts the ordered
// chain (survey → campaign → voters → doors → round → books → assign → live) and
// the next action, but never gates navigation — every step links straight to its
// screen. Data comes from GET /admin/campaigns/:id/setup-status (refreshes as the
// admin advances; mutations elsewhere invalidate ['admin','setup-status', id]).
const STATUS_BADGE = {
  done: { variant: 'success', dot: true, label: 'Done' },
  current: { variant: 'brand', dot: true, label: 'Now' },
  todo: { variant: 'neutral', dot: false, label: 'To do' },
  skipped: { variant: 'neutral', dot: false, label: 'n/a' },
};

export default function SetupProgress({ campaignId }) {
  const navigate = useNavigate();
  const [showSteps, setShowSteps] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'setup-status', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/setup-status`),
    enabled: !!campaignId,
    refetchInterval: 30_000,
  });

  if (!campaignId) return null;

  // Deep-link a step pre-scoped to THIS campaign (target pages read the stored id).
  function go(route) {
    setStoredCampaignId(campaignId);
    navigate(route);
  }

  if (isLoading || !data) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-fg">Setup progress</div>
        <SkeletonRows rows={4} />
      </Card>
    );
  }

  const { steps, stepsDone, stepsTotal, complete, nextStepKey, nextStepRoute } = data;

  // Done + live: collapse to a slim confirmation, with a way to re-open the steps.
  if (complete && !showSteps) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge variant="success" dot>Live</Badge>
          <span className="text-sm text-fg-muted">Setup complete — this campaign is live.</span>
        </div>
        <button
          type="button"
          onClick={() => setShowSteps(true)}
          className="text-xs font-semibold text-fg-muted underline underline-offset-2"
        >
          Show steps
        </button>
      </Card>
    );
  }

  const nextStep = steps.find((s) => s.key === nextStepKey) || null;
  const pct = stepsTotal ? Math.round((stepsDone / stepsTotal) * 100) : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">Setup progress</span>
          <Badge variant={complete ? 'success' : 'brand'}>
            {stepsDone}/{stepsTotal}
          </Badge>
        </div>
        {complete && (
          <button
            type="button"
            onClick={() => setShowSteps(false)}
            className="text-xs font-semibold text-fg-muted underline underline-offset-2"
          >
            Hide
          </button>
        )}
      </div>

      <div className="h-1.5 w-full bg-sunken">
        <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ul className="divide-y divide-border">
        {steps.map((s) => {
          const b = STATUS_BADGE[s.status] || STATUS_BADGE.todo;
          return (
            <li key={s.key} className="flex items-center gap-3 px-4 py-2.5">
              <Badge variant={b.variant} dot={b.dot} className="w-14 shrink-0 justify-center">
                {b.label}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg">{s.label}</div>
                <div className="truncate text-xs text-fg-muted">
                  {s.value}
                  {s.warn ? <span className="text-warning-fg"> · {s.warn}</span> : null}
                </div>
              </div>
              {s.status !== 'skipped' && (
                <Button size="sm" variant="secondary" onClick={() => go(s.route)} className="shrink-0">
                  {s.status === 'done' ? 'View' : 'Open'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {nextStep && nextStepRoute && (
        <div className="border-t border-border px-4 py-3">
          <Button size="sm" variant="primary" onClick={() => go(nextStepRoute)}>
            Next: {nextStep.label} →
          </Button>
        </div>
      )}
    </Card>
  );
}
