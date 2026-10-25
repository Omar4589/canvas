import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Skeleton } from '../ui/index.js';
import { ErrorBanner } from './parts.jsx';

// The team-changed card (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F4, §G2, §O4) — what a team report's
// build shows instead of Retry when a crew lead in the team no longer runs a crew here, or a past one
// runs one again. It says what is true, with live counts ("3 of 5 have no crew; 2 joined Sam's
// crew"), and offers: keep the crew's past doors in the team (the default), remove them (with what
// that takes out), change crews, or end the team. Continue applies the choice and rebuilds.
//
// The card reads GET /series/:id/team-changed for names and counts; `teamSeriesId` is the team the
// failed build named (a team on a walk list names its parent team).

const n = (v) => Number(v || 0).toLocaleString();
const radio = 'mt-0.5 h-4 w-4 shrink-0 accent-brand-accent';

export const teamChangedKey = (seriesId) => ['admin', 'client-report-team-changed', seriesId];

const TeamChangedCard = ({ campaignId, reportId, teamSeriesId, teamLabel = 'this team', onResolved, onChangeCrews, onEnd, compact = false }) => {
  // The report rides along so "the team's totals drop by N doors" is counted up to THIS report's end
  // (NUM-4); without it the server falls back to the team's newest report.
  const q = useQuery({
    queryKey: [...teamChangedKey(teamSeriesId), reportId || null],
    queryFn: () =>
      api(`/admin/client-reports/series/${teamSeriesId}/team-changed${reportId ? `?reportId=${encodeURIComponent(reportId)}` : ''}`),
    enabled: !!teamSeriesId,
  });
  const departed = q.data?.departed || [];
  const returned = q.data?.returned || [];
  // Per crew lead: 'keep' | 'remove' (departed), 'current' | 'remove' (returned).
  const [choice, setChoice] = useState({});
  const pick = (id, v) => setChoice((c) => ({ ...c, [id]: v }));
  const choiceOf = (id, fallback) => choice[id] || fallback;

  const go = useMutation({
    mutationFn: async () => {
      const keepPast = departed.filter((d) => choiceOf(d.coordinatorId, 'keep') === 'keep').map((d) => d.coordinatorId);
      const removePast = [
        ...departed.filter((d) => choiceOf(d.coordinatorId, 'keep') === 'remove').map((d) => d.coordinatorId),
        ...returned.filter((r) => choiceOf(r.coordinatorId, 'current') === 'remove').map((r) => r.coordinatorId),
      ];
      const makeCurrent = returned.filter((r) => choiceOf(r.coordinatorId, 'current') === 'current').map((r) => r.coordinatorId);
      if (keepPast.length || removePast.length || makeCurrent.length) {
        await api(`/admin/client-reports/series/${teamSeriesId}`, { method: 'PATCH', body: { keepPast, removePast, makeCurrent } });
      }
      return api(`/admin/client-reports/${reportId}/recompute`, { method: 'POST' });
    },
    onSuccess: (res) => onResolved?.(res?.build || null),
  });

  return (
    <div className={`rounded-md border border-warning/30 bg-warning-tint/60 ${compact ? 'p-3' : 'p-4'} text-sm`} role="group" aria-label={`${teamLabel} changed`}>
      <div className="font-semibold text-fg">{teamLabel} changed</div>
      {q.isLoading && (
        <div className="mt-2 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {q.isError && <div className="mt-2"><ErrorBanner title="Couldn’t load what changed." error={q.error} /></div>}
      {q.data && !departed.length && !returned.length && (
        <p className="mt-1 text-fg-muted">The team’s crews look right now. Continue builds the numbers again.</p>
      )}

      {departed.map((d) => {
        const keep = choiceOf(d.coordinatorId, 'keep') === 'keep';
        const joined = (d.joined || []).filter((j) => j.count > 0);
        return (
          <div key={d.coordinatorId} className="mt-3">
            <p className="text-fg">{d.name} no longer runs a crew on this campaign.</p>
            {d.crewSize > 0 && (
              <p className="mt-0.5 text-xs text-fg-muted">
                {d.name}’s crew: {n(d.noCrew)} of {n(d.crewSize)} {d.noCrew === 1 ? 'has' : 'have'} no crew now
                {joined.length ? `; ${joined.map((j) => `${n(j.count)} joined ${j.name}’s crew`).join('; ')}` : ''}.
              </p>
            )}
            <label className="mt-2 flex items-start gap-2">
              <input type="radio" className={radio} checked={keep} onChange={() => pick(d.coordinatorId, 'keep')} />
              <span>
                <span className="text-fg">Keep the crew’s past doors in {teamLabel}</span>
                <span className="block text-xs text-fg-muted">
                  They stay in {teamLabel} while those canvassers have no crew. Moving one into another crew moves their past doors too.
                </span>
              </span>
            </label>
            <label className="mt-1.5 flex items-start gap-2">
              <input type="radio" className={radio} checked={!keep} onChange={() => pick(d.coordinatorId, 'remove')} />
              <span className="text-fg">
                Remove them{d.removeDoors ? ` — the team’s totals drop by ${n(d.removeDoors)} ${d.removeDoors === 1 ? 'door' : 'doors'}` : ''}
              </span>
            </label>
          </div>
        );
      })}

      {returned.map((r) => {
        const current = choiceOf(r.coordinatorId, 'current') === 'current';
        return (
          <div key={r.coordinatorId} className="mt-3">
            <p className="text-fg">{r.name} runs a crew again — their past doors are already in {teamLabel}.</p>
            <label className="mt-2 flex items-start gap-2">
              <input type="radio" className={radio} checked={current} onChange={() => pick(r.coordinatorId, 'current')} />
              <span className="text-fg">Make {r.name}’s crew current in {teamLabel}</span>
            </label>
            <label className="mt-1.5 flex items-start gap-2">
              <input type="radio" className={radio} checked={!current} onChange={() => pick(r.coordinatorId, 'remove')} />
              <span className="text-fg">Remove {r.name}’s past doors</span>
            </label>
          </div>
        );
      })}

      {go.error && <div className="mt-3"><ErrorBanner title="Couldn’t continue." error={go.error} /></div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onChangeCrews && (
          <Button size="sm" variant="secondary" disabled={go.isPending} onClick={onChangeCrews}>
            Change crews
          </Button>
        )}
        {onEnd && (
          <Button size="sm" variant="danger" disabled={go.isPending} onClick={onEnd}>
            End this team
          </Button>
        )}
        <Button size="sm" className="ml-auto" loading={go.isPending} disabled={q.isLoading} onClick={() => go.mutate()}>
          Continue
        </Button>
      </div>
      {departed.some((d) => d.noCrew > 0) && (
        <p className="mt-2 text-xs text-fg-muted">
          Canvassers with no crew lead are in no team’s report: see the{' '}
          <Link to={`/campaigns/${campaignId}/team`} className="font-semibold text-brand-accent hover:underline">
            Team tab
          </Link>
          .
        </p>
      )}
    </div>
  );
};

export default TeamChangedCard;
