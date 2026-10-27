import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { Card, Button, SkeletonRows } from '../components/ui';
import Pager from '../components/Pager.jsx';
import PersonPanel from '../components/people/PersonPanel.jsx';
import TeamQuickFilters from '../components/team/TeamQuickFilters.jsx';
import TeamToolbar from '../components/team/TeamToolbar.jsx';
import TeamTable from '../components/team/TeamTable.jsx';
import TeamBulkBar from '../components/team/TeamBulkBar.jsx';
import BulkCrewDialog from '../components/team/BulkCrewDialog.jsx';
import BulkConfirmDialog from '../components/team/BulkConfirmDialog.jsx';
import AddPeopleDialog from '../components/team/AddPeopleDialog.jsx';
import { useListParams } from '../lib/useListParams.js';
import { CHIPS, SORTS, clampPage, crewHeadings, filterRoster, pageOf, quickCounts, sortRoster } from '../lib/rosterView.js';
import { coordinatorChoices } from '../lib/crewChange.js';
import { pausedUserIds } from '../lib/pacePause.js';
import { personFromRoster } from '../lib/personAccess.js';
import { pageFor } from '../lib/personStepping.js';
import { removeTargets, resendTargets, selectAllMatching, selectedInFilter, toggleId, SELECT_MAX } from '../lib/teamSelection.js';

// A campaign's Team page (/campaigns/:campaignId/team; docs/PROPOSAL_PEOPLE_PAGES.md §E), built around
// three jobs: fixing logins, organizing crews and staffing the campaign. It reads the campaign roster
// (CampaignAssignment — which gates who sees the campaign on the phone and who can hold its books),
// the same for an org admin and a team lead.
//
//   - Quick filters with counts, a search, and crew and role filters; everyone's crew on screen; sort
//     by any column, by crew (how it opens) with a heading per crew. 25 to a page.
//   - Tick up to 500 people and Move to crew…, Resend invites or Remove from campaign (each a dialog
//     that runs through lib/runInChunks.js).
//   - Add people: by email, or (org admins) from the organization.
//   - Click a person for the person panel (components/people/PersonPanel.jsx), with this campaign's
//     section: their crew, Finish it, and their numbers here.
//
// The filters, sort, page and the open person live in the address, written by replace (lib/listParams.js),
// so Back leaves the page and a link reopens the list and the person as they were. An archived campaign
// is read-only: no Add people, no selection, no crew changes.

const PAGE = 25;
const DEFAULTS = { chip: 'current', q: '', crew: 'all', role: 'all', sort: 'crew', dir: '', page: '1', person: '', add: '' };
// Each column's natural first direction: names A→Z, anything countable or dated biggest/newest first.
const SORT_DEFAULT_DIR = { crew: 'asc', name: 'asc', lastLogin: 'desc', doors: 'desc', lastDoor: 'desc' };

const TeamPage = ({ campaignId }) => {
  const qc = useQueryClient();
  const { selected: campaign, isLoading: campaignLoading } = useCampaignSelection(campaignId);
  const { user, isOrgAdmin } = useAuth();
  const viewerId = user?.id ? String(user.id) : null;
  const archived = campaign?.isActive === false;

  const [params, setParams] = useListParams(DEFAULTS);
  const chip = CHIPS.includes(params.chip) ? params.chip : 'current';
  const sortKey = SORTS.includes(params.sort) ? params.sort : 'crew';
  const dir = params.dir === 'asc' || params.dir === 'desc' ? params.dir : SORT_DEFAULT_DIR[sortKey];
  const personId = params.person || null;

  const [selected, setSelected] = useState(() => new Set());
  const [bulk, setBulk] = useState(null);
  const [adding, setAdding] = useState(null);
  const [notice, setNotice] = useState('');

  // ONE campaign-scoped read for both roles: the roster, plus who can run a crew here.
  const crewQ = useQuery({
    queryKey: ['admin', 'campaign-crew', campaignId],
    queryFn: ({ signal }) => api(`/admin/campaigns/${campaignId}/crew`, { signal }),
    enabled: !!campaignId,
  });
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', campaignId],
    queryFn: ({ signal }) => api(`/admin/campaigns/${campaignId}/assignments`, { signal }),
    enabled: !!campaignId,
  });
  // The campaign leaderboard (all time), for Doors and Last door. Ledger-sourced, so someone who has
  // knocked nothing has no row — the columns read 0 / —.
  const activityQ = useQuery({
    queryKey: ['admin', 'report-canvassers', campaignId],
    queryFn: ({ signal }) => api(`/admin/reports/canvassers?campaignId=${campaignId}`, { signal }),
    enabled: !!campaignId,
  });
  // The org list, for an org admin's panel (role, billing, the multi-org lock) and Add from the org.
  const directoryQ = useQuery({
    queryKey: ['memberships'],
    queryFn: ({ signal }) => api('/admin/memberships', { signal }),
    enabled: isOrgAdmin,
  });
  // Who is paused right now — the badge, the Paused filter, and a lead's roster lines. Polled, like the
  // Users page's (the same query).
  const pausedQ = useQuery({
    queryKey: ['admin', 'pace-pauses', 'list', 'org-paused'],
    queryFn: ({ signal }) => api('/admin/pace-pauses?status=paused', { signal }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const activityByUser = useMemo(
    () => new Map((Array.isArray(activityQ.data) ? activityQ.data : []).map((r) => [String(r.userId), r])),
    [activityQ.data]
  );
  const roster = useMemo(
    () =>
      (assignmentsQ.data?.assignments || []).map((a) => {
        const act = activityByUser.get(String(a.userId));
        return { ...a, userId: String(a.userId), doors: act?.knocks ?? 0, lastDoorAt: act?.lastActivityAt ?? null };
      }),
    [assignmentsQ.data, activityByUser]
  );
  const rosterById = useMemo(() => new Map(roster.map((r) => [r.userId, r])), [roster]);
  const membershipById = useMemo(
    () => new Map((directoryQ.data?.members || []).map((m) => [String(m.user.id), m])),
    [directoryQ.data]
  );
  const peopleById = useMemo(
    () => new Map(roster.map((r) => [r.userId, personFromRoster(r, membershipById.get(r.userId) || null)])),
    [roster, membershipById]
  );
  const pausedIds = useMemo(() => pausedUserIds(pausedQ.data), [pausedQ.data]);
  const coordinators = useMemo(() => coordinatorChoices(crewQ.data), [crewQ.data]);

  const counts = useMemo(
    () => quickCounts(roster, { q: params.q, crew: params.crew, role: params.role, pausedIds }),
    [roster, params.q, params.crew, params.role, pausedIds]
  );
  const filtered = useMemo(
    () => sortRoster(filterRoster(roster, { chip, q: params.q, crew: params.crew, role: params.role, pausedIds }), { key: sortKey, dir }),
    [roster, chip, params.q, params.crew, params.role, pausedIds, sortKey, dir]
  );
  const rosterIds = useMemo(() => new Set(roster.map((r) => r.userId)), [roster]);
  const liveIds = useMemo(() => filtered.map((r) => r.userId), [filtered]);
  const page = clampPage(params.page, filtered.length, PAGE);
  const pageRows = pageOf(filtered, page, PAGE);
  const crewCounts = useMemo(() => new Map(crewHeadings(filtered).map((g) => [g.coordinatorId || '', g.count])), [filtered]);
  // The crew filter's choices: every crew on the roster — and the one picked, even once nobody is left on
  // it, so it can be cleared — each with how many people picking it would show under the other filters.
  const crewOptions = useMemo(() => {
    const names = new Map();
    for (const r of roster) {
      if (r.coordinatorId && !names.has(String(r.coordinatorId))) names.set(String(r.coordinatorId), r.coordinatorName || 'Unknown');
    }
    const picked = params.crew && params.crew !== 'all' && params.crew !== 'none' ? String(params.crew) : null;
    if (picked && !names.has(picked)) names.set(picked, coordinators.find((c) => c.id === picked)?.name || 'Unknown');
    const counts = new Map();
    let none = 0;
    for (const r of filterRoster(roster, { chip, q: params.q, role: params.role, pausedIds })) {
      if (!r.coordinatorId) none += 1;
      else counts.set(String(r.coordinatorId), (counts.get(String(r.coordinatorId)) || 0) + 1);
    }
    return {
      crews: [...names].map(([id, name]) => ({ id, name, count: counts.get(id) || 0 })).sort((a, b) => a.name.localeCompare(b.name)),
      none,
    };
  }, [roster, chip, params.q, params.role, params.crew, coordinators, pausedIds]);

  // Search: the box answers at once, the address a moment later (replace, and only when it changed).
  // A search the address changes some other way (Clear filters) shows in the box too.
  const [search, setSearch] = useState(params.q);
  const [seenQ, setSeenQ] = useState(params.q);
  if (params.q !== seenQ) {
    setSeenQ(params.q);
    if (params.q !== search.trim()) setSearch(params.q);
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() === params.q) return;
      setParams({ q: search.trim(), page: 1 });
      setSelected(new Set());
    }, 150);
    return () => clearTimeout(t);
  }, [search, params.q, setParams]);

  // A filter change clears the selection: it only ever covers people in the current filter.
  const setFilter = (patch) => {
    setParams({ ...patch, page: 1 });
    setSelected(new Set());
  };
  const onSort = (key) => {
    const next = key === sortKey ? (dir === 'asc' ? 'desc' : 'asc') : SORT_DEFAULT_DIR[key];
    setParams({ sort: key, dir: next === SORT_DEFAULT_DIR[key] ? '' : next, page: 1 });
  };

  // Add people, also opened by a link (?add=, the Campaigns page's Assignments window); the address
  // forgets it once it's open.
  useEffect(() => {
    if (!params.add) return;
    if (!archived) setAdding(params.add === 'org' && isOrgAdmin ? 'org' : 'email');
    setParams({ add: null });
  }, [params.add, archived, isOrgAdmin, setParams]);

  // The person panel: ?person= opens it; stepping turns the list's page with it; closing puts focus
  // back on the row of the person you were on — after `person` turns null, so after the drawer's own
  // focus restore.
  const lastPersonRef = useRef(null);
  const lookup = useCallback((id) => peopleById.get(String(id)) || null, [peopleById]);
  const place = useCallback(
    (id) => {
      const r = rosterById.get(String(id));
      return r ? sortRoster([...filtered, r], { key: sortKey, dir }).map((x) => x.userId) : null;
    },
    [rosterById, filtered, sortKey, dir]
  );
  const openPerson = (id) => setParams({ person: id });
  const stepTo = (id) => setParams({ person: id, page: pageFor(liveIds, id, PAGE, page) });
  const closePanel = () => {
    lastPersonRef.current = personId;
    setParams({ person: null });
  };
  useEffect(() => {
    if (personId || !lastPersonRef.current) return;
    const id = lastPersonRef.current;
    lastPersonRef.current = null;
    document.querySelector(`[data-person-row="${id}"]`)?.focus();
  }, [personId]);

  const scope = useMemo(
    () => ({
      kind: 'campaign',
      campaignId: String(campaignId),
      campaign,
      archived,
      coordinators,
      roster,
      pausedIds,
      rosterLines: pausedQ.data?.rosterLines || [],
    }),
    [campaignId, campaign, archived, coordinators, roster, pausedIds, pausedQ.data]
  );

  const afterAdd = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', campaignId] });
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', campaignId] });
    qc.invalidateQueries({ queryKey: ['memberships'] });
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-history', campaignId] });
    qc.invalidateQueries({ queryKey: ['reports', 'team-breakdown'] });
  };

  if (!campaignLoading && !campaign) return <Navigate to="/campaigns" replace />;

  const loading = assignmentsQ.isLoading;
  // The panel snapshots the list once what orders and filters it is in: the roster, the leaderboard
  // (the Doors and Last door sorts) and the pause list (the Paused filter). A read that failed counts
  // as in.
  const listReady = !!assignmentsQ.data && !activityQ.isLoading && !pausedQ.isLoading;
  const chosen = selectedInFilter(selected, filtered);
  const resend = resendTargets(chosen, { isOrgAdmin, pausedIds });
  const remove = removeTargets(chosen, { isOrgAdmin, viewerId });
  const nameOf = (id) => {
    const r = rosterById.get(String(id));
    return r ? `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.email || 'Someone' : 'Someone';
  };
  const togglePage = () =>
    setSelected((s) => {
      const ids = pageRows.map((r) => r.userId);
      const next = new Set(s);
      if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
      else for (const id of ids) if (next.size < SELECT_MAX) next.add(id);
      return next;
    });
  const filtering = chip !== 'current' || params.q || params.crew !== 'all' || params.role !== 'all';

  return (
    <div className={chosen.length ? 'pb-24' : ''}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Team</h1>
        <div className="flex items-center gap-3">
          {isOrgAdmin && (
            <Link to="/users" className="text-xs font-medium text-fg-muted hover:underline">
              Org users ›
            </Link>
          )}
          {!archived && (
            <Button size="sm" onClick={() => setAdding('email')}>
              Add people
            </Button>
          )}
        </div>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-fg-muted">
        {roster.length.toLocaleString()} {roster.length === 1 ? 'person' : 'people'} on{' '}
        <span className="font-medium text-fg">{campaign?.name || 'this campaign'}</span>. Only people on this team can be
        given books and see the campaign in the mobile app. Click anyone to fix their login, set their crew, or see
        their doors.
      </p>

      {archived && (
        <div className="mb-4 rounded-md border border-border bg-sunken px-3 py-2 text-sm text-fg-muted">
          This campaign is archived, so its team is read-only. Reactivate it on the Campaigns page to make changes.
        </div>
      )}
      {notice && (
        <div role="status" className="mb-4 flex items-start gap-3 rounded-md border border-brand-600 bg-brand-tint px-3 py-2 text-sm text-fg">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="shrink-0 font-semibold hover:opacity-70" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <Card className="flex flex-col gap-3 p-4">
        <TeamQuickFilters value={chip} counts={counts} onChange={(c) => setFilter({ chip: c })} />
        <TeamToolbar
          search={search}
          onSearch={setSearch}
          crew={params.crew}
          crews={crewOptions.crews}
          noCrewCount={crewOptions.none}
          onCrew={(c) => setFilter({ crew: c })}
          role={params.role}
          onRole={(r) => setFilter({ role: r })}
        />
        {loading ? (
          <SkeletonRows />
        ) : assignmentsQ.isError ? (
          <div className="rounded border border-danger/30 bg-danger-tint px-4 py-3 text-sm text-danger-fg">
            Couldn’t load the team — {assignmentsQ.error.message}{' '}
            <Button variant="secondary" size="sm" className="ml-1" onClick={() => assignmentsQ.refetch()}>
              Retry
            </Button>
          </div>
        ) : !roster.length ? (
          <div className="rounded border border-dashed border-border bg-sunken px-4 py-8 text-center text-sm text-fg-muted">
            No one yet
            {!archived && (
              <>
                {' '}
                —{' '}
                <button type="button" onClick={() => setAdding('email')} className="font-medium text-brand-accent hover:underline">
                  add people
                </button>{' '}
                by their email address{isOrgAdmin ? ' or from your organization' : ''}.
              </>
            )}
          </div>
        ) : !filtered.length ? (
          <div className="rounded border border-dashed border-border bg-sunken px-4 py-8 text-center text-sm text-fg-muted">
            No one on this team matches.{' '}
            {filtering && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setFilter({ chip: 'current', q: '', crew: 'all', role: 'all' });
                }}
                className="font-medium text-brand-accent hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <TeamTable
              rows={pageRows}
              sort={{ key: sortKey, dir }}
              onSort={onSort}
              crewCounts={crewCounts}
              selectable={!archived}
              selected={selected}
              onToggle={(id) => setSelected((s) => toggleId(s, id))}
              onTogglePage={togglePage}
              viewerId={viewerId}
              pausedIds={pausedIds}
              onOpen={openPerson}
            />
            {filtered.length > PAGE && (
              <Pager
                skip={(page - 1) * PAGE}
                limit={PAGE}
                total={filtered.length}
                onChange={(skip) => setParams({ page: Math.floor(skip / PAGE) + 1 })}
              />
            )}
          </>
        )}
      </Card>

      {!archived && (
        <TeamBulkBar
          count={chosen.length}
          matching={filtered.length}
          onSelectAll={() => setSelected(selectAllMatching(filtered))}
          onClear={() => setSelected(new Set())}
          onMove={() => setBulk({ kind: 'move', ids: chosen.map((r) => r.userId) })}
          resendCount={resend.length}
          onResend={() => setBulk({ kind: 'resend', people: resend })}
          removeCount={remove.length}
          onRemove={() => setBulk({ kind: 'remove', people: remove })}
        />
      )}

      {bulk?.kind === 'move' && (
        <BulkCrewDialog
          campaignId={String(campaignId)}
          ids={bulk.ids}
          nameOf={nameOf}
          coordinators={coordinators}
          onClose={() => setBulk(null)}
          onRan={() => setSelected(new Set())}
        />
      )}
      {(bulk?.kind === 'resend' || bulk?.kind === 'remove') && (
        <BulkConfirmDialog
          kind={bulk.kind}
          campaignId={String(campaignId)}
          campaignName={campaign?.name || 'this campaign'}
          people={bulk.people}
          roster={roster}
          onClose={() => setBulk(null)}
          onRan={() => setSelected(new Set())}
        />
      )}
      {adding && campaign && (
        <AddPeopleDialog
          campaign={campaign}
          isOrgAdmin={isOrgAdmin}
          rosterIds={rosterIds}
          startTab={adding}
          onAdded={afterAdd}
          onOpenPerson={(id) => {
            setAdding(null);
            openPerson(id);
          }}
          onClose={() => setAdding(null)}
        />
      )}

      {personId && (
        <PersonPanel
          personId={personId}
          ids={liveIds}
          place={place}
          lookup={lookup}
          loaded={listReady}
          scope={scope}
          onStep={stepTo}
          onClose={closePanel}
          onDeleted={setNotice}
        />
      )}
    </div>
  );
};

// Each campaign's page starts fresh: the selection, the search box, an open dialog and the panel's
// list belong to the campaign they were made on, and the panel's Everywhere links move between
// campaigns' Team pages on this same route.
const CampaignTeamPage = () => {
  const { campaignId } = useParams();
  return <TeamPage key={campaignId} campaignId={campaignId} />;
};

export default CampaignTeamPage;
