import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal, Select } from '../ui/index.js';
import { ErrorBanner } from './parts.jsx';
import { defaultPeriod, formatCivil, formatPeriod, periodDays, todayIn, daysBetween } from './reportDates.js';
import { quotedNames } from './TeamDialog.jsx';

// New report (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G2, §F4, §F10). Covers the whole campaign or a
// team (one or more crews under a name the client reads), optionally only one walk list; the period
// defaults to the day after that series' last report — or, after a long gap, to the stretch ending
// yesterday, naming the days no report covers (§O4). Creating claims the first build at once, so the
// builder opens on "Building the first numbers…".
//
// Refusals it answers in place:
//   · WALK_LIST_LABEL_HAS_NAME — a walk list's name matches a canvasser's: "Name your client sees",
//     prefilled, and "This is a place, not a person" (resent with confirmLabel);
//   · TEAM_ATTRIBUTION_NOT_READY — "A team" can't be used yet, and says why;
//   · SERIES_ENDED — the team has ended: Continue it, or pick another. An ended team picked up front
//     (New report from its tab) says the same before Create, never "No team yet" (ADMINUX-10).
//     Continue hands over to the team picker (`onContinueTeam` — Continue re-validates the crews,
//     §O4), which hands back here with the team, the dates and the title as they were.

const box = 'h-4 w-4 accent-brand-accent disabled:cursor-not-allowed disabled:opacity-40';
const crewName = (name) => `${name || 'Unknown user'}’s crew`;
// A day or a period from an earlier year carries its year ("Dec 28, 2025"); this year's doesn't.
const yearOf = (ymd) => String(ymd || '').slice(0, 4);
const dayLabel = (ymd, today) => formatCivil(ymd, { year: yearOf(ymd) !== yearOf(today) });
const periodLabel = (start, end, today) =>
  yearOf(start) === yearOf(end) && yearOf(start) !== yearOf(today) ? `${formatPeriod(start, end)}, ${yearOf(start)}` : formatPeriod(start, end);

// The series a scope belongs to, among GET /series rows, or null when it doesn't exist yet.
const seriesForScope = (series, { teamId, effortId }) => {
  if (teamId && effortId) return series.find((s) => s.kind === 'team_walk_list' && s.teamSeriesId === teamId && s.effortId === effortId) || null;
  if (teamId) return series.find((s) => s.id === teamId) || null;
  if (effortId) return series.find((s) => s.kind === 'walk_list' && s.effortId === effortId && !s.ended) || null;
  return series.find((s) => s.kind === 'campaign' && !s.ended) || null;
};

const NewReportDialog = ({ campaignId, campaignTz, reports = [], seriesData, efforts = [], initial = {}, onClose, onCreated, onNewTeam, onContinueTeam }) => {
  const series = seriesData?.series || [];
  const teamsReady = seriesData?.teamsReady !== false;
  const teams = series.filter((s) => s.kind === 'team' && !s.ended);
  const [covers, setCovers] = useState(initial.teamId && teamsReady ? 'team' : 'campaign');
  const [teamId, setTeamId] = useState(initial.teamId || teams[0]?.id || '');
  const [oneWalkList, setOneWalkList] = useState(!!initial.effortId);
  const [effortId, setEffortId] = useState(initial.effortId || efforts[0]?._id || '');
  const [title, setTitle] = useState(initial.title || '');
  const [dates, setDates] = useState(initial.dates || null); // set once the operator edits a date (kept across Continue)
  const [labelPrompt, setLabelPrompt] = useState(null); // { names, label, combined }
  const [clientLabel, setClientLabel] = useState('');
  const [placeConfirmed, setPlaceConfirmed] = useState(false);
  const [ended, setEnded] = useState(null); // { seriesId }
  const [error, setError] = useState(null);

  const scope = { teamId: covers === 'team' ? teamId : null, effortId: oneWalkList ? effortId : null };
  const scopeSeries = seriesForScope(series, scope);
  const team = covers === 'team' ? teams.find((t) => t.id === teamId) || null : null;
  // An ended team picked up front (New report from its tab) — or named by SERIES_ENDED — gets the
  // Continue box, never "No team yet" with Create held and no reason (ADMINUX-10).
  const pickedEnded = covers === 'team' && !team ? series.find((s) => s.kind === 'team' && s.ended && s.id === teamId) || null : null;
  const endedId = ended?.seriesId || pickedEnded?.id || null;
  const endedSeries = endedId ? series.find((s) => s.id === endedId) || null : null;
  const today = todayIn(campaignTz);

  // The series' last report (newest end), for the default period and its explanation.
  const lastReport = useMemo(() => {
    if (!scopeSeries) return null;
    return reports.filter((r) => r.seriesId === scopeSeries.id).sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1))[0] || null;
  }, [reports, scopeSeries]);
  const suggested = defaultPeriod({ lastReport, today });
  const period = dates || { weekStart: suggested.weekStart, weekEnd: suggested.weekEnd };
  const days = periodDays(period.weekStart, period.weekEnd);
  const badRange = !period.weekStart || !period.weekEnd || daysBetween(period.weekStart, period.weekEnd) < 0;
  const scopeTeam = team || pickedEnded;
  const scopeName = scopeTeam ? `${scopeTeam.label}${oneWalkList ? ` · ${efforts.find((e) => String(e._id) === String(effortId))?.name || 'walk list'}` : ''}` : oneWalkList ? efforts.find((e) => String(e._id) === String(effortId))?.name || 'walk list' : 'whole campaign';

  const create = useMutation({
    mutationFn: (extra = {}) =>
      api('/admin/client-reports', {
        method: 'POST',
        body: {
          campaignId,
          weekStart: period.weekStart,
          weekEnd: period.weekEnd,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(scope.teamId ? { teamSeriesId: scope.teamId } : {}),
          ...(scope.effortId ? { effortId: String(scope.effortId) } : {}),
          ...extra,
        },
      }),
    onSuccess: (res) => onCreated(res),
    onError: (e) => {
      setError(e);
      if (e.code === 'WALK_LIST_LABEL_HAS_NAME') {
        setLabelPrompt({ names: e.data?.names || [], label: e.data?.label || '', combined: !!scope.teamId });
        setClientLabel(e.data?.label || '');
        setPlaceConfirmed(false);
      }
      if (e.code === 'SERIES_ENDED') setEnded({ seriesId: e.data?.seriesId || scope.teamId });
    },
  });
  // Continue goes through the team picker (TeamDialog's continue mode), which re-validates the crews
  // the way Change crews does and answers each refusal there; this dialog reopens on the team after.
  const canContinue = !!onContinueTeam && endedSeries?.kind === 'team';

  const submit = () => {
    setError(null);
    if (badRange) return;
    if (labelPrompt) {
      const extra = {};
      if (!labelPrompt.combined && clientLabel.trim() && clientLabel.trim() !== labelPrompt.label) extra.seriesLabel = clientLabel.trim();
      if (placeConfirmed) extra.confirmLabel = true;
      create.mutate(extra);
      return;
    }
    create.mutate({});
  };
  const resetPrompts = () => {
    setLabelPrompt(null);
    setEnded(null);
    setError(null);
  };
  const busy = create.isPending;

  return (
    <Modal
      size="lg"
      title="New report"
      onClose={busy ? undefined : onClose}
      closable={!busy}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={badRange || (covers === 'team' && !team) || (oneWalkList && !effortId) || !!endedId} onClick={submit}>
            Create draft
          </Button>
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <fieldset>
          <legend className="text-xs font-medium text-fg-muted">Covers</legend>
          <label className="mt-1.5 flex items-center gap-2 text-fg">
            <input type="radio" className={box} checked={covers === 'campaign'} onChange={() => { setCovers('campaign'); setDates(null); resetPrompts(); }} />
            Whole campaign
          </label>
          <div className="mt-1.5">
            <label className={`flex flex-wrap items-center gap-2 ${teamsReady ? 'text-fg' : 'text-fg-subtle'}`}>
              <input type="radio" className={box} disabled={!teamsReady} checked={covers === 'team'} onChange={() => { setCovers('team'); setDates(null); resetPrompts(); }} />
              A team
              {teamsReady && covers === 'team' && (teams.length > 0 || pickedEnded) && (
                <Select value={teamId} onChange={(e) => { setTeamId(e.target.value); setDates(null); resetPrompts(); }} className="py-1 text-sm">
                  {pickedEnded && <option value={pickedEnded.id}>{pickedEnded.label} (ended)</option>}
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
              {teamsReady && (
                <button type="button" className="text-xs font-semibold text-brand-accent hover:underline" onClick={onNewTeam}>
                  + New team
                </button>
              )}
            </label>
            {!teamsReady && (
              <p className="ml-6 mt-0.5 text-xs text-fg-muted">Team reports need team attribution, which this organization doesn’t have yet.</p>
            )}
            {teamsReady && covers === 'team' && !teams.length && !pickedEnded && <p className="ml-6 mt-0.5 text-xs text-fg-muted">No team yet — make one with New team.</p>}
            {team && (
              <p className="ml-6 mt-0.5 text-xs text-fg-muted">
                Crews: {[...(team.coordinators || []).map((c) => crewName(c.name)), ...(team.pastCoordinators || []).map((c) => `${crewName(c.name)} (past doors)`)].join(', ') || 'none'}
                . A home both teams visited counts in each team’s report.
              </p>
            )}
          </div>
          <div className="mt-2">
            <label className={`flex flex-wrap items-center gap-2 ${efforts.length ? 'text-fg' : 'text-fg-subtle'}`}>
              <input type="checkbox" className={box} disabled={!efforts.length} checked={oneWalkList} onChange={(e) => { setOneWalkList(e.target.checked); setDates(null); resetPrompts(); }} />
              Only one walk list
              {oneWalkList && (
                <Select value={effortId} onChange={(e) => { setEffortId(e.target.value); setDates(null); resetPrompts(); }} className="py-1 text-sm">
                  {efforts.map((ef) => (
                    <option key={ef._id} value={ef._id}>
                      {ef.name}
                    </option>
                  ))}
                </Select>
              )}
            </label>
            {oneWalkList && <p className="ml-6 mt-0.5 text-xs text-fg-muted">The walk list’s name appears on your client’s report.</p>}
          </div>
        </fieldset>

        <div>
          <span className="text-xs font-medium text-fg-muted">Period</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="First day"
              value={period.weekStart}
              onChange={(e) => setDates({ ...period, weekStart: e.target.value })}
              className="rounded-lg border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
            />
            <span className="text-fg-muted">–</span>
            <input
              type="date"
              aria-label="Last day"
              value={period.weekEnd}
              onChange={(e) => setDates({ ...period, weekEnd: e.target.value })}
              className="rounded-lg border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
            />
            {!badRange && <span className="text-xs text-fg-muted">{days} {days === 1 ? 'day' : 'days'}</span>}
          </div>
          {badRange ? (
            <p className="mt-1 text-xs text-danger-fg">The first day must be on or before the last day.</p>
          ) : (
            <p className={`mt-1 text-xs ${!dates && suggested.skipped ? 'text-warning-fg' : 'text-fg-muted'}`}>
              {!dates && suggested.skipped
                ? `Your last ${scopeName} report ended ${dayLabel(lastReport.weekEnd, today)}. No report covers ${periodLabel(suggested.skipped.start, suggested.skipped.end, today)} — change the dates to cover it.`
                : !dates && suggested.fromLast
                  ? `Starts the day after your last ${scopeName} report (${formatPeriod(lastReport.weekStart, lastReport.weekEnd)}).`
                  : !dates
                    ? 'The seven days ending yesterday.'
                    : formatPeriod(period.weekStart, period.weekEnd)}
              {daysBetween(today, period.weekEnd) >= 0 ? ' This period isn’t over yet — you can build it now and refresh it later.' : ''}
            </p>
          )}
        </div>

        <label className="block">
          <span className="text-xs font-medium text-fg-muted">Title (optional)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder={formatPeriod(period.weekStart, period.weekEnd)}
            className="mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
          />
        </label>

        {labelPrompt && (
          <div className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2.5 text-xs text-warning-fg">
            <p>
              The walk list’s name matches a canvasser on this campaign
              {labelPrompt.names.length ? ` (${quotedNames(labelPrompt.names)})` : ''}. Your client reads this name.
            </p>
            {!labelPrompt.combined && (
              <label className="mt-2 block">
                <span className="font-medium">Name your client sees</span>
                <input
                  value={clientLabel}
                  onChange={(e) => setClientLabel(e.target.value)}
                  maxLength={60}
                  className="mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
                />
              </label>
            )}
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" className={box} checked={placeConfirmed} onChange={(e) => setPlaceConfirmed(e.target.checked)} />
              This is a place, not a person
            </label>
          </div>
        )}
        {endedId && (
          <div className="rounded-md border border-info/30 bg-info-tint px-3 py-2.5 text-xs text-info-fg">
            <p>
              {endedSeries?.label ? `“${endedSeries.label}”` : 'That team'} has ended. Continue it to start a new report
              {teams.some((t) => t.id !== endedId) ? ', or pick another team' : ''}.
            </p>
            {canContinue && (
              <Button size="sm" className="mt-2" onClick={() => onContinueTeam(endedId, { title, dates })}>
                Continue the team
              </Button>
            )}
          </div>
        )}
        {error && !labelPrompt && !ended && <ErrorBanner title="Couldn’t create the draft." error={error} />}
      </div>
    </Modal>
  );
};

export default NewReportDialog;
