import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Button, Modal } from '../ui/index.js';
import { ErrorBanner } from './parts.jsx';
import { seriesKey } from './hooks.js';

// New team / Edit team / Rename / Continue (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F4, §G2, §O4). A
// team name is what the client reads, so it never contains a canvasser's name (the server refuses
// one: TEAM_LABEL_HAS_NAME). One team name can cover several crews; a crew belongs to at most one
// team, current or past. Walk-list tabs only get Rename — a walk list's name that matches a canvasser
// gets a warning the operator can confirm ("This is a place, not a person").
//
// Continue brings an ended team back (ADMINUX-10: its tab, New report on it, or Edit team on it —
// never End again, which the server treats as a no-op). It is the picker again, because Continue
// re-validates the crews the way Change crews does (§O4): it starts from the crews that can come back
// (current ones that still run a crew, past ones running one again — the team-changed card's
// default — never one now in another team), settles a departed lead's past doors first as Edit team
// does, says before Continue whose past doors must leave (a past crew now in another team can't stay:
// the crew index), and answers TEAM_CREW_NOT_RUNNING, CREW_IN_OTHER_TEAM, TEAM_LABEL_TAKEN and
// SERIES_CHANGED in place, refreshing the picker.
//
// `series` is the GET /series row (null for a new team); `picker` the same response's crews,
// formerCrews and noCrewCanvassers (crews in ACTIVE teams only — an ended team is in none); `openDrafts`
// how many of the team's drafts are open (End offers to delete them).

const crewName = (name) => `${name || 'Unknown user'}’s crew`;
const box = 'h-4 w-4 accent-brand-accent disabled:cursor-not-allowed disabled:opacity-40';
// Matched canvasser names the way names are written — “Dee”, never “dee” (WALK-9): the server
// matches on lower-case words. Each part after a space, hyphen or apostrophe starts with a capital;
// the rest is kept as sent. Also the New report dialog's walk-list prompt.
export const asName = (word) => String(word || '').replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, ch) => `${sep}${ch.toUpperCase()}`);
export const quotedNames = (names) => (names || []).map((n) => `“${asName(n)}”`).join(', ');

const TeamDialog =({ mode, campaignId, series = null, picker, openDrafts = 0, initialEnding = false, onClose, onSaved, onEnded }) => {
  const qc = useQueryClient();
  const isRename = mode === 'rename';
  // An ended team's Edit is its Continue: ending it again would do nothing (ADMINUX-10).
  const isContinue = mode === 'continue' || (mode === 'edit' && !!series?.ended);
  const isEdit = mode === 'edit' && !isContinue;
  const teamId = series?.id || null;
  const crews = picker?.crews || [];
  // The other ACTIVE team a crew is in, current or past, or null — such a crew can't be in this one.
  const crewElsewhere = (c) => (c.inSeries && c.inSeries.id !== teamId ? c.inSeries : c.pastInSeries && c.pastInSeries.id !== teamId ? c.pastInSeries : null);
  const freeCrew = (id) => crews.some((c) => c.coordinatorId === id && !crewElsewhere(c));
  const [label, setLabel] = useState(series?.label || '');
  const currentIds = useMemo(() => (series?.coordinators || []).filter((c) => c.runsCrew).map((c) => c.id), [series]);
  const [picked, setPicked] = useState(() =>
    isContinue
      ? new Set([...currentIds, ...(series?.pastCoordinators || []).filter((p) => p.runsCrew).map((p) => p.id)].filter(freeCrew))
      : new Set(currentIds)
  );
  // What Save / Continue send: ticked crews still listed and in no other team (a refetch can move one).
  const pickedIds = () => [...picked].filter(freeCrew);
  // A former crew lead's past doors: kept (the default) or removed; and past crews to drop. The
  // picker's formerCrews name active teams only, so an ended team's departed leads are read off its row.
  const formers = useMemo(
    () =>
      isContinue
        ? (series?.coordinators || []).filter((c) => !c.runsCrew).map((c) => ({ coordinatorId: c.id, name: c.name }))
        : (picker?.formerCrews || []).filter((f) => f.seriesId === teamId),
    [isContinue, series, picker, teamId]
  );
  const [formerChoice, setFormerChoice] = useState(() => Object.fromEntries(formers.map((f) => [f.coordinatorId, 'keep'])));
  const [dropPast, setDropPast] = useState(() => new Set());
  const [confirmPlace, setConfirmPlace] = useState(false);
  const [needsPlace, setNeedsPlace] = useState(null); // names the server matched
  const [ending, setEnding] = useState(initialEnding && !isContinue);
  const [deleteDrafts, setDeleteDrafts] = useState(false);
  const [continueOffer, setContinueOffer] = useState(null); // { seriesId, label }
  const [error, setError] = useState(null);

  const patch = (id, body) => api(`/admin/client-reports/series/${id}`, { method: 'PATCH', body });
  const pastHereIds = new Set((series?.pastCoordinators || []).map((p) => p.id));
  const past = (series?.pastCoordinators || []).filter((p) => !p.runsCrew || !picked.has(p.id));
  // Continue: a past crew now in another team can't stay in this one, so its past doors leave with
  // Continue — said in the dialog, never a refusal after.
  const pastElsewhereOf = (p) => {
    const c = crews.find((x) => x.coordinatorId === p.id);
    return c ? crewElsewhere(c) : null;
  };
  const forcedDrop = isContinue ? past.filter((p) => pastElsewhereOf(p)) : [];

  const save = useMutation({
    mutationFn: async () => {
      const name = label.replace(/\s+/g, ' ').trim();
      if (mode === 'new') {
        return api('/admin/client-reports/series', { method: 'POST', body: { campaignId, label: name, coordinatorIds: pickedIds() } });
      }
      if (isRename) return patch(teamId, { label: name, ...(confirmPlace ? { confirmLabel: true } : {}) });
      // Edit team. A former crew lead can't stay a current crew (the server only accepts crews that
      // still run here), so their past doors are settled first — kept or removed — and the crews after.
      const keep = formers.filter((f) => formerChoice[f.coordinatorId] !== 'remove').map((f) => f.coordinatorId);
      const remove = formers.filter((f) => formerChoice[f.coordinatorId] === 'remove').map((f) => f.coordinatorId);
      if (keep.length || remove.length) await patch(teamId, { keepPast: keep, removePast: remove });
      const body = {};
      if (name !== (series?.label || '')) body.label = name;
      const ids = pickedIds();
      const crewsChanged = ids.length !== currentIds.length || currentIds.some((id) => !ids.includes(id));
      if (crewsChanged) body.coordinatorIds = ids;
      if (dropPast.size) body.removePast = [...dropPast];
      return Object.keys(body).length ? patch(teamId, body) : { series };
    },
    onSuccess: (res) => onSaved?.(res?.series || null),
    onError: (e) => {
      setError(e);
      if (e.code === 'WALK_LIST_LABEL_HAS_NAME') setNeedsPlace(e.data?.names || []);
      if (e.code === 'SERIES_NAME_ENDED' && e.data?.canContinue) setContinueOffer({ seriesId: e.data.seriesId, label: label.trim() });
    },
  });
  const cont = useMutation({
    mutationFn: () => patch(continueOffer.seriesId, { continue: true, coordinatorIds: pickedIds() }),
    onSuccess: (res) => onSaved?.(res?.series || null),
    onError: setError,
  });
  // Continue this team (ADMINUX-10). A departed crew lead can't be a current crew, so their past doors
  // are settled first — kept or removed — as Edit team does; then one PATCH continues it with the
  // picked crews, any renaming, and the past doors that must or may leave.
  const continueTeam = useMutation({
    mutationFn: async () => {
      const keep = formers.filter((f) => formerChoice[f.coordinatorId] !== 'remove').map((f) => f.coordinatorId);
      const remove = formers.filter((f) => formerChoice[f.coordinatorId] === 'remove').map((f) => f.coordinatorId);
      if (keep.length || remove.length) await patch(teamId, { keepPast: keep, removePast: remove });
      const name = label.replace(/\s+/g, ' ').trim();
      const drop = [...new Set([...dropPast, ...forcedDrop.map((p) => p.id)])];
      return patch(teamId, {
        continue: true,
        coordinatorIds: pickedIds(),
        ...(name !== (series?.label || '') ? { label: name } : {}),
        ...(drop.length ? { removePast: drop } : {}),
      });
    },
    onSuccess: (res) => onSaved?.(res?.series || null),
    onError: (e) => {
      setError(e);
      // The crews moved since the picker loaded: refresh it (a crew now in another team then reads
      // "(in …)" and unticks), and untick a crew the server says no longer runs.
      if (['TEAM_CREW_NOT_RUNNING', 'CREW_IN_OTHER_TEAM', 'TEAM_NEEDS_CREW', 'SERIES_CHANGED'].includes(e.code)) {
        qc.invalidateQueries({ queryKey: seriesKey(campaignId) });
      }
      if (e.code === 'TEAM_CREW_NOT_RUNNING') {
        const gone = new Set((e.data?.coordinatorIds || []).map(String));
        setPicked((s) => new Set([...s].filter((id) => !gone.has(String(id)))));
      }
    },
  });
  const end = useMutation({
    mutationFn: () => patch(teamId, { end: true, ...(deleteDrafts ? { deleteOpenDrafts: true } : {}) }),
    onSuccess: (res) => (onEnded || onSaved)?.(res?.series || null, { deletedDrafts: deleteDrafts }),
    onError: setError,
  });

  const busy = save.isPending || cont.isPending || end.isPending || continueTeam.isPending;
  const title = mode === 'new' ? 'New team' : isRename ? 'Rename this tab' : isContinue ? `Continue ${series?.label || 'this team'}` : 'Edit team';
  const errText = (() => {
    if (!error) return null;
    if (error.code === 'TEAM_LABEL_HAS_NAME') {
      const names = quotedNames(error.data?.names);
      return `Team names can’t include a canvasser’s name${names ? ` — ${names} matches someone on this campaign` : ''}.`;
    }
    // Continue: the crew the index refused can be a PAST one, which the server can't name.
    if (isContinue && error.code === 'CREW_IN_OTHER_TEAM') {
      const other = error.data?.otherLabel ? `“${error.data.otherLabel}”` : 'another team';
      return `A crew in this team, current or past, is now in ${other}. Untick it, or remove its past doors, then continue.`;
    }
    if (isContinue && error.code === 'TEAM_CREW_NOT_RUNNING') return 'A crew you picked no longer runs on this campaign, so it’s unticked. Check the crews, then continue.';
    return null;
  })();

  if (ending) {
    return (
      <Modal
        size="md"
        title={`End ${series?.label || 'this team'}?`}
        onClose={busy ? undefined : initialEnding ? onClose : () => setEnding(false)}
        closable={!busy}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={initialEnding ? onClose : () => setEnding(false)}>
              {initialEnding ? 'Cancel' : 'Back'}
            </Button>
            <Button variant="danger" loading={end.isPending} onClick={() => end.mutate()}>
              End this team
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-fg-muted">
          <p>Its published reports stay exactly as they were sent. You can’t start a new report for it unless you continue it later.</p>
          {openDrafts > 0 && (
            <label className="flex items-center gap-2 text-fg">
              <input type="checkbox" className={box} checked={deleteDrafts} onChange={(e) => setDeleteDrafts(e.target.checked)} />
              Also delete its open {openDrafts === 1 ? 'draft' : `${openDrafts} drafts`}
            </label>
          )}
          {error && <ErrorBanner error={error} />}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      size="lg"
      title={title}
      onClose={busy ? undefined : onClose}
      closable={!busy}
      footer={
        <>
          {isEdit && (
            <Button variant="danger" className="mr-auto" disabled={busy} onClick={() => setEnding(true)}>
              End this team
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {isContinue ? (
            <Button loading={continueTeam.isPending} disabled={busy || !label.trim() || pickedIds().length === 0} onClick={() => continueTeam.mutate()}>
              Continue this team
            </Button>
          ) : (
            <Button loading={save.isPending} disabled={!label.trim() || (!isRename && mode === 'new' && pickedIds().length === 0)} onClick={() => save.mutate()}>
              {mode === 'new' ? 'Create team' : 'Save'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {isContinue && (
          <p className="text-fg-muted">It takes new reports again. Pick the crews it covers from now on — its published reports stay exactly as they were sent.</p>
        )}
        <label className="block">
          <span className="text-xs font-medium text-fg-muted">Name your client sees</span>
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setNeedsPlace(null);
              setConfirmPlace(false);
              setContinueOffer(null);
            }}
            maxLength={60}
            placeholder={isRename ? 'e.g. North' : 'e.g. Paid team'}
            className="mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
          />
          <span className="mt-1 block text-xs text-fg-muted">No canvasser names — the client sees this.</span>
        </label>

        {needsPlace && (
          <div className="rounded-md border border-warning/30 bg-warning-tint px-3 py-2 text-xs text-warning-fg">
            <p>
              This name matches a canvasser on this campaign{needsPlace.length ? ` (${quotedNames(needsPlace)})` : ''}. Change it, or confirm it names a place.
            </p>
            <label className="mt-1.5 flex items-center gap-2 font-medium">
              <input type="checkbox" className={box} checked={confirmPlace} onChange={(e) => setConfirmPlace(e.target.checked)} />
              This is a place, not a person
            </label>
          </div>
        )}

        {!isRename && (
          <fieldset>
            <legend className="text-xs font-medium text-fg-muted">Crews</legend>
            {crews.length === 0 ? (
              <p className="mt-1 text-xs text-fg-muted">Nobody runs a crew on this campaign yet. Give canvassers a crew lead on the Team tab first.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {crews.map((c) => {
                  const elsewhere = c.inSeries && c.inSeries.id !== teamId ? c.inSeries : null;
                  const pastElsewhere = !elsewhere && c.pastInSeries && c.pastInSeries.id !== teamId ? c.pastInSeries : null;
                  // The picker marks past crews of ACTIVE teams only; an ended team's are on its row.
                  const pastHere = isContinue ? pastHereIds.has(c.coordinatorId) : c.pastInSeries && c.pastInSeries.id === teamId;
                  const blocked = !!(elsewhere || pastElsewhere);
                  return (
                    <li key={c.coordinatorId}>
                      <label className={`flex flex-wrap items-center gap-2 ${blocked ? 'text-fg-subtle' : 'text-fg'}`}>
                        <input
                          type="checkbox"
                          className={box}
                          disabled={blocked}
                          // A crew that a refetch shows in another team reads unticked: it can't be sent,
                          // and a ticked box that can't be unticked would be a dead end.
                          checked={picked.has(c.coordinatorId) && !blocked}
                          onChange={(e) =>
                            setPicked((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(c.coordinatorId);
                              else next.delete(c.coordinatorId);
                              return next;
                            })
                          }
                        />
                        <span>{crewName(c.name)}</span>
                        <span className="text-xs text-fg-muted">· {c.members} {c.members === 1 ? 'canvasser' : 'canvassers'}</span>
                        {elsewhere && <span className="text-xs text-fg-muted">(in {elsewhere.label})</span>}
                        {pastElsewhere && <span className="text-xs text-fg-muted">(Past in {pastElsewhere.label})</span>}
                        {pastHere && !blocked && (isContinue || !picked.has(c.coordinatorId)) && (
                          <span className="text-xs text-info-fg">(a past crew of this team — runs a crew again)</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {isContinue && crews.length > 0 && pickedIds().length === 0 && <p className="mt-1.5 text-xs text-fg-muted">Pick at least one crew to continue the team.</p>}
            {formers.length > 0 && (
              <div className="mt-3 space-y-2">
                {formers.map((f) => (
                  <div key={f.coordinatorId} className="rounded-md border border-border bg-sunken/60 px-3 py-2 text-xs">
                    <p className="text-fg">Former: {crewName(f.name)} — no longer coordinates here.</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-fg-muted">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" className={box} checked={formerChoice[f.coordinatorId] !== 'remove'} onChange={() => setFormerChoice((s) => ({ ...s, [f.coordinatorId]: 'keep' }))} />
                        Keep its past doors in this team
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" className={box} checked={formerChoice[f.coordinatorId] === 'remove'} onChange={() => setFormerChoice((s) => ({ ...s, [f.coordinatorId]: 'remove' }))} />
                        Remove them
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {past.length > 0 && (
              <div className="mt-3 text-xs text-fg-muted">
                {past.some((p) => !forcedDrop.includes(p)) && <p>Past doors kept (these crews no longer run here, and still count in this team):</p>}
                <ul className="mt-1 space-y-1">
                  {past.map((p) => {
                    const movedTo = forcedDrop.includes(p) ? pastElsewhereOf(p) : null;
                    return (
                      <li key={p.id}>
                        {movedTo ? (
                          <p className="text-warning-fg">
                            {crewName(p.name)} is now in {movedTo.label}, so its past doors leave this team when you continue.
                          </p>
                        ) : (
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className={box}
                              checked={dropPast.has(p.id)}
                              onChange={(e) =>
                                setDropPast((s) => {
                                  const next = new Set(s);
                                  if (e.target.checked) next.add(p.id);
                                  else next.delete(p.id);
                                  return next;
                                })
                              }
                            />
                            Remove {crewName(p.name)}’s past doors
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {picker?.noCrewCanvassers > 0 && (
              <p className="mt-3 text-xs text-fg-muted">
                {picker.noCrewCanvassers} {picker.noCrewCanvassers === 1 ? 'canvasser has' : 'canvassers have'} no crew lead, so they’re in no team’s report. Give them a crew lead on the Team tab.
              </p>
            )}
          </fieldset>
        )}

        {continueOffer && (
          <div className="rounded-md border border-info/30 bg-info-tint px-3 py-2 text-xs text-info-fg">
            <p>“{continueOffer.label}” is a team you ended, and its reports were sent. Continue it, or choose a different name.</p>
            <Button size="sm" className="mt-2" loading={cont.isPending} onClick={() => cont.mutate()}>
              Continue “{continueOffer.label}”
            </Button>
          </div>
        )}
        {error && !continueOffer && (errText ? <ErrorBanner>{errText}</ErrorBanner> : error.code !== 'WALK_LIST_LABEL_HAS_NAME' && <ErrorBanner error={error} />)}
      </div>
    </Modal>
  );
};

export default TeamDialog;
