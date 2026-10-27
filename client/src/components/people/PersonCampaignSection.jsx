import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button } from '../ui/index.js';
import CoordinatorConfirm from '../CoordinatorConfirm.jsx';
import CrewSelect from '../team/CrewSelect.jsx';
import { outcomeInUse } from '../../lib/outcomeToggles.js';
import { crewChangeBody, finishItBody, openTimeLine, teamName } from '../../lib/crewChange.js';
import { firstNameOf, fullNameOf } from '../../lib/personAccess.js';

// "This campaign" in the person panel, on a Team page (docs/PROPOSAL_PEOPLE_PAGES.md §D, §B.6): their
// crew, with the "this many doors move" check before a change, Finish it, and their numbers here.
//
// Opening someone previews their CURRENT crew. That answer says whether an earlier change didn't finish
// (`unfinished`), whether one is still running (`busy`), and how many of their doors here still count
// for another team; `finishIt` decides whether Finish it shows. Finish it goes through the same
// confirm as any change, with the count first, and sends the current crew as both the pick and `from`.
//
// Every change sends the crew its check showed as `fromCoordinatorId`, so it only goes through if the
// crew is still that. A 409 refreshes the roster and the checks, and says why.

const StatBox = ({ label, value }) => (
  <div className="rounded-md border border-border bg-sunken px-3 py-2">
    <div className="text-lg font-semibold tabular-nums text-fg">{value}</div>
    <div className="text-[11px] text-fg-muted">{label}</div>
  </div>
);

const PersonCampaignSection = ({ person, scope, report, markDirty, canSetCrew = true }) => {
  const qc = useQueryClient();
  const campaignId = String(scope.campaignId);
  const userId = person.userId;
  const name = fullNameOf(person);
  const first = firstNameOf(person);
  const current = person.roster?.coordinatorId ? String(person.roster.coordinatorId) : '';
  const currentName = person.roster?.coordinatorName || null;
  const archived = !!scope.archived;
  // Read-only on an archived campaign, and for a team lead looking at a Doorline staff account.
  const locked = archived || !canSetCrew;
  const previewOf = (pick) => ({
    queryKey: ['admin', 'coordinator-preview', campaignId, userId, pick || 'none'],
    queryFn: ({ signal }) =>
      api(`/admin/campaigns/${campaignId}/crew/${userId}/coordinator-preview?coordinatorId=${pick || 'none'}`, { signal }),
    retry: false,
  });

  const openQ = useQuery(previewOf(current));
  // A crew change stages, previews, then commits. `pick` is the staged crew ('' = No crew).
  const [pick, setPick] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const [conflict, setConflict] = useState(null);
  const staged = pick !== null && pick !== current;
  const pickQ = useQuery({ ...previewOf(pick), enabled: staged });

  // A staged change, or Finish it's check open, is an unsaved edit.
  useEffect(() => {
    markDirty('crew', staged || finishing);
    return () => markDirty('crew', false);
  }, [staged, finishing, markDirty]);

  const summaryQ = useQuery({
    queryKey: ['admin', 'campaign-member-summary', campaignId, userId],
    queryFn: ({ signal }) => api(`/admin/reports/canvassers/${userId}/summary?campaignId=${campaignId}`, { signal }),
  });

  const crewMut = useMutation({
    mutationKey: ['person', userId, 'crew'],
    mutationFn: (body) => api(`/admin/campaigns/${campaignId}/crew/${userId}/coordinator`, { method: 'PATCH', body }),
    // After a change, or a 409: the roster and the checks are read again, so the screen shows what is true now.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'coordinator-preview', campaignId, userId] });
      qc.invalidateQueries({ queryKey: ['admin', 'member-crews', userId] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-history', campaignId] });
      // THIS campaign's by-team numbers just moved.
      qc.invalidateQueries({ queryKey: ['reports', 'team-breakdown'] });
      qc.invalidateQueries({ queryKey: ['reports', 'canvasser-timeline'] });
    },
  });

  const onRefused = (err) => {
    if (err?.status === 409 && err.code === 'busy') {
      setConflict(`Another change for ${first} is still finishing — try again in a minute or two.`);
    } else if (err?.status === 409 && err.code === 'changed-meanwhile') {
      // `now` is the crew they're on now (null for No crew); the roster and the check are read again.
      const now = err.data?.now ? String(err.data.now) : null;
      const nowName = now ? (scope.coordinators || []).find((c) => c.id === now)?.name || 'another crew' : 'No crew';
      setConflict(`${first}’s crew changed since you looked — it’s ${nowName} now. Check what would move again before changing it.`);
    } else {
      setConflict(null);
      report('danger', `Couldn’t change ${first}’s crew: ${err?.message || 'something went wrong'}`);
    }
  };

  const confirmPick = () => {
    setConflict(null);
    const target = pickQ.data?.to?.name || null;
    crewMut.mutate(crewChangeBody({ pick, previewFrom: pickQ.data?.from?.id ?? null }), {
      onSuccess: (res) => {
        setPick(null);
        const moved = res?.restamp?.doors || 0;
        if (res?.restamp?.error) {
          report('warning', `${first}’s crew is now ${target || 'No crew'}, but their earlier doors didn’t finish moving. Choose Finish it in a minute or two.`);
        } else {
          report('success', `${first}’s crew is now ${target || 'No crew'}.${moved ? ` ${moved.toLocaleString()} ${moved === 1 ? 'door' : 'doors'} moved to ${teamName(target)}.` : ''}`);
        }
      },
      onError: onRefused,
    });
  };
  const confirmFinish = () => {
    setConflict(null);
    crewMut.mutate(finishItBody(current || null), {
      onSuccess: (res) => {
        setFinishing(false);
        if (res?.restamp?.error) report('warning', `${first}’s doors still didn’t finish moving. Try Finish it again in a minute or two.`);
        else report('success', `Finished: ${first}’s doors here count for ${teamName(currentName)}.`);
      },
      onError: onRefused,
    });
  };

  const line = openTimeLine(openQ.data, name);
  const kpi = summaryQ.data?.kpi;
  const isSurvey = scope.campaign?.type !== 'lit_drop';
  const notTargetInUse = outcomeInUse(scope.campaign, 'not_target');
  const selectId = `person-crew-${userId}`;

  return (
    <div className="border-b border-border px-6 py-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">This campaign</h3>
      <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-fg-muted">
        Crew
      </label>
      <CrewSelect
        id={selectId}
        coordinators={scope.coordinators || []}
        value={staged ? pick : current}
        onChange={(v) => {
          setFinishing(false);
          setConflict(null);
          setPick(v);
        }}
        exclude={[userId]}
        current={current ? { id: current, name: currentName } : null}
        disabled={locked || crewMut.isPending}
      />
      {staged ? (
        <CoordinatorConfirm
          preview={pickQ.data}
          isLoading={pickQ.isLoading}
          error={pickQ.error}
          subjectName={name}
          busy={crewMut.isPending}
          onCancel={() => {
            setPick(null);
            setConflict(null);
          }}
          onConfirm={confirmPick}
          campaignId={campaignId}
          subjectId={userId}
        />
      ) : finishing ? (
        <CoordinatorConfirm
          preview={openQ.data}
          isLoading={!openQ.data && openQ.isFetching}
          error={openQ.error}
          subjectName={name}
          busy={crewMut.isPending}
          onCancel={() => {
            setFinishing(false);
            setConflict(null);
          }}
          onConfirm={confirmFinish}
          campaignId={campaignId}
          subjectId={userId}
          finishing
        />
      ) : line ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-sm">
          <span className="text-warning-fg">{line.text}</span>
          {line.finishIt && !locked && (
            <Button size="sm" onClick={() => setFinishing(true)}>
              Finish it
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-1 text-xs text-fg-muted">
          {archived
            ? 'This campaign is archived, so its crews can’t change.'
            : !canSetCrew
              ? 'A Doorline staff account’s crew is set by an org admin.'
              : 'The admin or team lead who oversees them here. Their doors count toward this team.'}
        </p>
      )}
      {conflict && <p className="mt-2 text-sm text-danger-fg">{conflict}</p>}

      <div className="mt-4">
        {summaryQ.isLoading ? (
          <div className="text-sm text-fg-muted">Loading…</div>
        ) : kpi ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBox label="Doors knocked" value={(kpi.homesKnocked ?? 0).toLocaleString()} />
            {isSurvey ? (
              <>
                {/* Two units, named: survey doors (houses, the Survey rate's numerator) and surveys taken
                    (voters). surveyDoors ?? surveysSubmitted keeps the panel sane against an older server. */}
                <StatBox label="Survey doors" value={(kpi.surveyDoors ?? kpi.surveysSubmitted ?? 0).toLocaleString()} />
                <StatBox label="Surveys taken" value={(kpi.surveysSubmitted ?? 0).toLocaleString()} />
              </>
            ) : (
              <StatBox label="Lit drops" value={(kpi.litDropped ?? 0).toLocaleString()} />
            )}
            <StatBox label="Days active" value={(kpi.daysActive ?? 0).toLocaleString()} />
            <StatBox label={isSurvey ? 'Survey rate' : 'Drop rate'} value={`${kpi.connectionRatePct ?? 0}%`} />
            {/* Their Not-a-target count and share of their doors, on a campaign that has used the outcome. */}
            {isSurvey && notTargetInUse && (
              <StatBox
                label="Not a target"
                value={`${(kpi.notTarget ?? 0).toLocaleString()} · ${
                  kpi.homesKnocked ? Math.round(((kpi.notTarget ?? 0) / kpi.homesKnocked) * 100) : 0
                }%`}
              />
            )}
          </div>
        ) : (
          <div className="rounded border border-dashed border-border bg-sunken px-3 py-4 text-center text-sm text-fg-muted">
            No activity in this campaign yet.
          </div>
        )}
      </div>
    </div>
  );
};

export default PersonCampaignSection;
